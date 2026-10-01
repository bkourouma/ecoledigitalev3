/**
 * Cas d'usage d'encaissement manuel et d'imputation.
 *
 * Encaissement manuel (espèces, chèque, virement, carte, mobile money saisi) :
 *   idempotent par clé fournie ⇒ un rejeu renvoie le même paiement et le même reçu ;
 *   espèces ⇒ rattachées à la session de caisse OUVERTE du caissier ;
 *   imputation automatique (échéance la plus ancienne d'abord, configurable) ou manuelle ;
 *   reçu `REC-aaaa-nnnnnn` émis dans la même transaction (numéro sans trou).
 */
import {
  err,
  ok,
  Money,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import {
  planAutoAllocation,
  validateManualAllocations,
  type AllocationPlan,
  type AllocationTarget,
  type ManualAllocationRequest,
} from "../domain/allocation";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import { FinanceEvents } from "../domain/events";
import { PAYABLE_INVOICE_STATUSES } from "../domain/invoice";
import {
  idempotencyConflict,
  paymentFingerprint,
  unallocatedAmount,
  validateIdempotencyKey,
  validateManualPaymentRules,
} from "../domain/payment";
import type { PaymentRecord, ReceiptRecord } from "../domain/records";
import type { AllocationOrder, PayerKind, PaymentMethod, Uuid } from "../domain/types";
import { PAYER_KINDS } from "../domain/types";
import { getInstallmentsByIds, getInvoiceLines, lockInvoices, lockOpenTargets } from "../infrastructure/billing-repository";
import { getOpenSessionForCashier } from "../infrastructure/cash-repository";
import {
  getPayment,
  getPaymentByIdempotencyKey,
  getReceipt,
  getReceiptByPayment,
  insertPaymentIdempotent,
  listPayments,
  listReceipts,
  netAllocatedByLine,
  type PaymentListFilter,
} from "../infrastructure/payments-repository";
import { applyAllocations, issueReceipt, loadPaymentView, type PaymentView } from "./billing-core";
import { EventBuffer, inTx, moneyPayload, type FinanceDeps } from "./deps";

export type AllocationSpec =
  | { mode: "AUTO"; order?: AllocationOrder; invoiceIds?: Uuid[] }
  | { mode: "MANUAL"; items: ManualAllocationRequest[] }
  | { mode: "NONE" };

/** Cibles d'imputation manuelle : échéances désignées, factures verrouillées et contrôlées. */
async function manualTargets(
  tx: Tx,
  payment: PaymentRecord,
  items: ReadonlyArray<ManualAllocationRequest>,
): Promise<Result<Map<Uuid, AllocationTarget>, AppError>> {
  const ids = [...new Set(items.map((i) => i.installmentId))];
  const pre = await getInstallmentsByIds(tx, ids);
  if (pre.length !== ids.length) {
    return err(conflict(FinanceCode.ALLOCATION_INVALID_TARGET, "Une échéance désignée est introuvable.", { installmentIds: ids }));
  }
  const invoices = await lockInvoices(tx, pre.map((i) => i.invoiceId));
  const byInvoice = new Map(invoices.map((i) => [i.id, i]));
  const fresh = await getInstallmentsByIds(tx, ids);
  const targets = new Map<Uuid, AllocationTarget>();
  for (const inst of fresh) {
    const inv = byInvoice.get(inst.invoiceId);
    if (
      !inv ||
      inv.learnerId !== payment.learnerId ||
      inv.payerKind !== payment.payerKind ||
      inv.payerRef !== payment.payerRef ||
      inv.currency !== payment.amount.currency
    ) {
      return err(
        conflict(FinanceCode.ALLOCATION_INVALID_TARGET, "L'échéance ne concerne pas le même apprenant, payeur ou la même devise que le paiement.", {
          installmentId: inst.id,
        }),
      );
    }
    if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status)) {
      return err(conflict(FinanceCode.INVOICE_NOT_PAYABLE, "Cette facture n'est pas encaissable.", { invoiceId: inv.id, status: inv.status }));
    }
    const remaining = inst.amount.subtract(inst.paid).subtract(inst.credited);
    if (remaining.isPositive()) {
      targets.set(inst.id, {
        invoiceId: inst.invoiceId,
        installmentId: inst.id,
        dueDate: inst.dueDate,
        seq: inst.seq,
        invoiceIssuedAt: (inv.issuedAt ?? inv.createdAt).toISOString(),
        remaining,
      });
    }
  }
  // Suivi par ligne : la somme fléchée sur une ligne ne dépasse pas son total.
  const lineItems = items.filter((i) => i.lineId);
  if (lineItems.length > 0) {
    for (const invoiceId of new Set([...targets.values()].map((t) => t.invoiceId))) {
      const lines = new Map((await getInvoiceLines(tx, invoiceId)).map((l) => [l.id, l]));
      const already = await netAllocatedByLine(tx, invoiceId);
      const asked = new Map<Uuid, number>();
      for (const item of lineItems) {
        const target = targets.get(item.installmentId);
        if (!target || target.invoiceId !== invoiceId) continue;
        const line = lines.get(item.lineId!);
        if (!line) {
          return err(conflict(FinanceCode.ALLOCATION_INVALID_TARGET, "La ligne désignée n'appartient pas à la facture.", { lineId: item.lineId }));
        }
        const total = (asked.get(line.id) ?? 0) + item.amount.amount;
        asked.set(line.id, total);
        if ((already.get(line.id) ?? 0) + total > line.total.amount) {
          return err(
            conflict(FinanceCode.ALLOCATION_EXCEEDS_REMAINING, "L'imputation dépasse le total de la ligne désignée.", {
              lineId: line.id,
              lineTotal: line.total.amount,
            }),
          );
        }
      }
    }
  }
  return ok(targets);
}

/** Calcule le plan d'imputation d'un paiement confirmé (verrouille les factures concernées). */
async function planAllocation(
  deps: FinanceDeps,
  tx: Tx,
  payment: PaymentRecord,
  spec: AllocationSpec,
): Promise<Result<AllocationPlan & { lineIds: Map<string, Uuid | null> }, AppError>> {
  const available = unallocatedAmount(payment);
  const none = (): Result<AllocationPlan & { lineIds: Map<string, Uuid | null> }, AppError> =>
    ok({ allocations: [], allocated: Money.zero(payment.amount.currency), unallocated: available, lineIds: new Map() });
  if (spec.mode === "NONE" || !available.isPositive()) return none();

  if (spec.mode === "AUTO") {
    const { targets } = await lockOpenTargets(tx, {
      learnerId: payment.learnerId,
      payerKind: payment.payerKind,
      payerRef: payment.payerRef,
      invoiceIds: spec.invoiceIds,
      currency: payment.amount.currency,
    });
    const plan = planAutoAllocation(available, targets, spec.order ?? deps.config.allocationOrder);
    return plan.ok ? ok({ ...plan.value, lineIds: new Map() }) : plan;
  }

  const targets = await manualTargets(tx, payment, spec.items);
  if (!targets.ok) return targets;
  const plan = validateManualAllocations(spec.items, targets.value, available);
  if (!plan.ok) return plan;
  // Une imputation manuelle conserve sa ligne désignée : clé = indice dans la liste validée.
  const lineIds = new Map<string, Uuid | null>();
  spec.items.forEach((item, index) => lineIds.set(String(index), item.lineId ?? null));
  return ok({ ...plan.value, lineIds });
}

/**
 * Impute un paiement CONFIRMÉ, émet son reçu, publie `finance.payment.completed`.
 * Appelé avec le paiement déjà confirmé (insertion directe ou confirmation fournisseur).
 */
export async function finalizeConfirmedPayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  payment: PaymentRecord,
  spec: AllocationSpec,
): Promise<Result<true, AppError>> {
  const plan = await planAllocation(deps, tx, payment, spec);
  if (!plan.ok) return plan;
  const withLines = plan.value.allocations.map((a, index) => ({ ...a, lineId: plan.value.lineIds.get(String(index)) ?? null }));
  const applied = await applyAllocations(deps, ctx, tx, events, payment, withLines);
  if (!applied.ok) return applied;

  const receipt = await issueReceipt(deps, ctx, tx, events, payment.id);
  const after = await getPayment(tx, payment.id);
  events.add(
    FinanceEvents.PAYMENT_COMPLETED,
    {
      v: 1,
      paymentId: payment.id,
      learnerId: payment.learnerId,
      enrollmentId: payment.enrollmentId,
      payerKind: payment.payerKind,
      method: payment.method,
      amount: moneyPayload(payment.amount),
      receiptId: receipt.id,
      receiptNumber: receipt.number,
      allocations: applied.value.map((a) => ({ invoiceId: a.invoiceId, installmentId: a.installmentId, amount: a.amount.amount })),
      unallocated: moneyPayload(unallocatedAmount(after ?? payment)),
      provider: payment.provider,
      confirmedAt: (payment.confirmedAt ?? deps.clock.now()).toISOString(),
    },
    { type: "payment", id: payment.id },
  );
  events.audit({
    action: "finance.payment.completed",
    resourceType: "payment",
    resourceId: payment.id,
    after: {
      learnerId: payment.learnerId,
      method: payment.method,
      amount: payment.amount.amount,
      receiptNumber: receipt.number,
      simulated: payment.simulated,
    },
  });
  return ok(true as const);
}

// ---------------------------------------------------------------------------
// Encaissement manuel
// ---------------------------------------------------------------------------

export interface RecordManualPaymentInput {
  idempotencyKey: string;
  learnerId: Uuid;
  enrollmentId?: Uuid | null;
  amount: Money;
  method: string;
  /** N° de chèque, référence de virement, n° de transaction mobile money… */
  reference?: string | null;
  payerName?: string | null;
  payerKind?: PayerKind;
  /** Obligatoire pour un payeur `FUNDER` : identifiant de la bourse / prise en charge. */
  payerRef?: string | null;
  allocation?: AllocationSpec;
  receivedAt?: Date;
}

export async function recordManualPayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: RecordManualPaymentInput,
): Promise<Result<PaymentView, AppError>> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  if (!key.ok) return key;
  const method = validateManualPaymentRules({ method: input.method, reference: input.reference });
  if (!method.ok) return method;
  if (!input.amount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant du paiement doit être strictement positif.", "amount"));
  }
  const payerKind: PayerKind = input.payerKind ?? "LEARNER";
  if (!(PAYER_KINDS as readonly string[]).includes(payerKind)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Type de payeur inconnu.", "payerKind"));
  }
  if (payerKind === "FUNDER" && !input.payerRef) {
    return err(validation(FinanceCode.INVALID_INPUT, "Un paiement de financeur indique la prise en charge concernée (payerRef).", "payerRef"));
  }
  if (payerKind === "LEARNER" && input.payerRef) {
    return err(validation(FinanceCode.INVALID_INPUT, "payerRef n'a de sens que pour un financeur.", "payerRef"));
  }
  if (method.value === "CASH" && !ctx.userId) {
    return err(conflict(FinanceCode.CASH_SESSION_REQUIRED, "Un encaissement espèces exige un caissier identifié.", {}));
  }

  const learner = await deps.learners.getLearner(ctx, input.learnerId);
  if (!learner) return err(notFound(FinanceCode.LEARNER_NOT_FOUND, "Apprenant", input.learnerId));
  if (input.enrollmentId) {
    const enrollment = await deps.enrollments.getEnrollment(ctx, input.enrollmentId);
    if (!enrollment || enrollment.learnerId !== input.learnerId) {
      return err(notFound(FinanceCode.ENROLLMENT_NOT_FOUND, "Inscription", input.enrollmentId));
    }
  }

  const allocation: AllocationSpec = input.allocation ?? { mode: "AUTO" };
  const fingerprint = paymentFingerprint({
    learnerId: input.learnerId,
    amount: input.amount,
    method: method.value,
    payerKind,
    payerRef: input.payerRef ?? null,
    reference: input.reference ?? null,
    extra: {
      enrollmentId: input.enrollmentId ?? null,
      allocation:
        allocation.mode === "MANUAL"
          ? { mode: "MANUAL", items: allocation.items.map((i) => [i.installmentId, i.amount.amount, i.lineId ?? null]) }
          : allocation.mode === "AUTO"
            ? { mode: "AUTO", order: allocation.order ?? null, invoiceIds: [...(allocation.invoiceIds ?? [])].sort() }
            : { mode: "NONE" },
    },
  });

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);

    // Rejeu rapide : même clé, même demande ⇒ même résultat, sans rien écrire.
    const known = await getPaymentByIdempotencyKey(tx, key.value);
    if (known) {
      if (known.requestFingerprint !== fingerprint) return err(idempotencyConflict(key.value));
      return ok(await loadPaymentView(tx, known.id, true));
    }

    let cashSessionId: Uuid | null = null;
    if (method.value === "CASH") {
      // FOR SHARE : une clôture simultanée de cette session attend la fin de l'encaissement.
      const session = await getOpenSessionForCashier(tx, ctx.userId!, "share");
      if (!session) {
        return err(
          conflict(FinanceCode.CASH_SESSION_REQUIRED, "Ouvrez une session de caisse avant d'encaisser des espèces.", { cashierId: ctx.userId }),
        );
      }
      if (session.openingFloat.currency !== input.amount.currency) {
        return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du paiement différente de celle de la caisse.", "amount"));
      }
      cashSessionId = session.id;
    }

    const now = deps.clock.now();
    const inserted = await insertPaymentIdempotent(tx, ctx.tenantId, {
      id: deps.newId(),
      learnerId: input.learnerId,
      enrollmentId: input.enrollmentId ?? null,
      payerKind,
      payerRef: input.payerRef ?? null,
      payerName: input.payerName?.trim() || null,
      method: method.value as PaymentMethod,
      status: "CONFIRMED",
      amount: input.amount,
      idempotencyKey: key.value,
      requestFingerprint: fingerprint,
      provider: null,
      providerRef: null,
      simulated: false,
      reference: input.reference?.trim() || null,
      intendedInvoiceId: null,
      cashSessionId,
      receivedAt: input.receivedAt ?? now,
      confirmedAt: now,
      createdBy: ctx.userId,
    });
    if (!inserted) {
      // Une autre transaction a enregistré la même clé entre-temps : relecture, jamais de doublon.
      const raced = (await getPaymentByIdempotencyKey(tx, key.value))!;
      if (raced.requestFingerprint !== fingerprint) return err(idempotencyConflict(key.value));
      return ok(await loadPaymentView(tx, raced.id, true));
    }

    const done = await finalizeConfirmedPayment(deps, ctx, tx, events, inserted, allocation);
    if (!done.ok) return done;
    await events.flush(tx);
    return ok(await loadPaymentView(tx, inserted.id, false));
  });
}

// ---------------------------------------------------------------------------
// Imputation après coup d'un paiement confirmé
// ---------------------------------------------------------------------------

export async function allocatePayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { paymentId: Uuid; allocation: Exclude<AllocationSpec, { mode: "NONE" }> },
): Promise<Result<PaymentView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const payment = await getPayment(tx, input.paymentId, { forUpdate: true });
    if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", input.paymentId));
    if (payment.status !== "CONFIRMED") {
      return err(conflict(FinanceCode.PAYMENT_NOT_CONFIRMED, "Seul un paiement confirmé peut être imputé.", { status: payment.status }));
    }
    if (!unallocatedAmount(payment).isPositive()) {
      return err(conflict(FinanceCode.ALLOCATION_EXCEEDS_PAYMENT, "Ce paiement est déjà entièrement imputé ou remboursé.", {}));
    }
    const plan = await planAllocation(deps, tx, payment, input.allocation);
    if (!plan.ok) return plan;
    if (plan.value.allocations.length === 0) {
      return err(conflict(FinanceCode.ALLOCATION_INVALID_TARGET, "Aucune échéance ouverte à laquelle imputer ce paiement.", {}));
    }
    const withLines = plan.value.allocations.map((a, index) => ({ ...a, lineId: plan.value.lineIds.get(String(index)) ?? null }));
    const applied = await applyAllocations(deps, ctx, tx, events, payment, withLines);
    if (!applied.ok) return applied;
    events.audit({
      action: "finance.payment.allocated",
      resourceType: "payment",
      resourceId: payment.id,
      after: { allocations: applied.value.map((a) => ({ installmentId: a.installmentId, amount: a.amount.amount })) },
    });
    await events.flush(tx);
    return ok(await loadPaymentView(tx, payment.id, false));
  });
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------

export async function getPaymentView(deps: FinanceDeps, ctx: RequestContext, paymentId: Uuid): Promise<Result<PaymentView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const payment = await getPayment(tx, paymentId);
      if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", paymentId));
      return ok(await loadPaymentView(tx, paymentId));
    },
    { readOnly: true },
  );
}

export async function listPaymentPage(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: Partial<PaymentListFilter> = {},
): Promise<Result<{ items: PaymentRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listPayments(tx, { ...filter, limit, offset: filter.offset ?? 0 })), { readOnly: true });
}

export async function getReceiptById(deps: FinanceDeps, ctx: RequestContext, receiptId: Uuid): Promise<Result<ReceiptRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const receipt = await getReceipt(tx, receiptId);
      return receipt ? ok(receipt) : err(notFound(FinanceCode.NOT_FOUND, "Reçu", receiptId));
    },
    { readOnly: true },
  );
}

export async function getReceiptOfPayment(deps: FinanceDeps, ctx: RequestContext, paymentId: Uuid): Promise<Result<ReceiptRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const receipt = await getReceiptByPayment(tx, paymentId);
      return receipt ? ok(receipt) : err(notFound(FinanceCode.NOT_FOUND, "Reçu du paiement", paymentId));
    },
    { readOnly: true },
  );
}

export async function listReceiptPage(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { learnerId?: Uuid; limit?: number; offset?: number } = {},
): Promise<Result<{ items: ReceiptRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listReceipts(tx, { learnerId: filter.learnerId, limit, offset: filter.offset ?? 0 })), { readOnly: true });
}
