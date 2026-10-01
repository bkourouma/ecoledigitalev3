/**
 * Remboursements : demande → approbation (quatre yeux) → exécution, partiel ou total.
 *
 * Exécution = ÉCRITURES INVERSES, jamais de modification du passé :
 *   - la part du remboursement prélevée sur le NON IMPUTÉ du paiement n'a aucun effet sur
 *     les factures ; le reste REPREND des imputations (lignes `allocation_reversals`),
 *     ce qui diminue l'encaissé des échéances et des factures concernées ;
 *   - un paiement espèces est remboursé sur la session de caisse OUVERTE de l'exécutant
 *     (la sortie d'espèces compte dans l'attendu de la clôture) ;
 *   - le paiement passe REFUNDED si le cumul remboursé atteint son montant, sinon reste CONFIRMED.
 */
import { err, ok, Money, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { planReversals, splitRefund } from "../domain/allocation";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import { FinanceEvents } from "../domain/events";
import { idempotencyConflict, unallocatedAmount, validateIdempotencyKey } from "../domain/payment";
import { createHash } from "node:crypto";
import { validateReason, validateRefundApproval, validateRefundRequest } from "../domain/refund";
import type { PaymentRecord, RefundRecord } from "../domain/records";
import type { Uuid } from "../domain/types";
import { addInstallmentCumuls, addInvoiceCumuls, lockInvoices } from "../infrastructure/billing-repository";
import { getOpenSessionForCashier } from "../infrastructure/cash-repository";
import {
  addPaymentCumuls,
  approveRefundRow,
  completeRefundRow,
  getPayment,
  getRefund,
  getRefundByIdempotencyKey,
  insertRefundIdempotent,
  insertReversal,
  listAllocationRecords,
  listRefunds,
  rejectRefundRow,
  sumOpenRefunds,
} from "../infrastructure/payments-repository";
import { refreshInvoiceStatus } from "./billing-core";
import { EventBuffer, inTx, moneyPayload, type FinanceDeps } from "./deps";

export interface RequestRefundInput {
  paymentId: Uuid;
  amount: Money;
  reason: string;
  idempotencyKey?: string;
}

export async function requestRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: RequestRefundInput,
): Promise<Result<RefundRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Une demande de remboursement exige un utilisateur identifié.", "actor"));
  if (input.idempotencyKey !== undefined) {
    const k = validateIdempotencyKey(input.idempotencyKey);
    if (!k.ok) return k;
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([input.paymentId, input.amount.amount, input.amount.currency, input.reason.trim()]))
    .digest("hex");

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    if (input.idempotencyKey) {
      const known = await getRefundByIdempotencyKey(tx, input.idempotencyKey);
      if (known) {
        if (known.requestFingerprint !== fingerprint) return err(idempotencyConflict(input.idempotencyKey));
        return ok(known);
      }
    }
    // Verrou du paiement : deux demandes concurrentes ne peuvent pas dépasser ensemble le remboursable.
    const payment = await getPayment(tx, input.paymentId, { forUpdate: true });
    if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", input.paymentId));
    const open = await sumOpenRefunds(tx, payment.id, payment.amount.currency);
    const check = validateRefundRequest({
      payment: { status: payment.status, amount: payment.amount, allocated: payment.allocated, refunded: payment.refunded },
      openRefunds: open,
      amount: input.amount,
      reason: input.reason,
    });
    if (!check.ok) return check;

    const refund = await insertRefundIdempotent(tx, ctx.tenantId, {
      id: deps.newId(),
      paymentId: payment.id,
      amount: input.amount,
      reason: check.value.reason,
      requestedBy: ctx.userId!,
      requestedAt: deps.clock.now(),
      idempotencyKey: input.idempotencyKey ?? null,
      requestFingerprint: input.idempotencyKey ? fingerprint : null,
    });
    if (!refund) {
      const raced = (await getRefundByIdempotencyKey(tx, input.idempotencyKey!))!;
      if (raced.requestFingerprint !== fingerprint) return err(idempotencyConflict(input.idempotencyKey!));
      return ok(raced);
    }
    events.add(
      FinanceEvents.REFUND_REQUESTED,
      {
        v: 1,
        refundId: refund.id,
        paymentId: payment.id,
        learnerId: payment.learnerId,
        amount: moneyPayload(refund.amount),
        reason: refund.reason,
        status: "REQUESTED",
      },
      { type: "refund", id: refund.id },
    );
    events.audit({
      action: "finance.refund.requested",
      resourceType: "refund",
      resourceId: refund.id,
      after: { paymentId: payment.id, amount: refund.amount.amount, reason: refund.reason },
      sensitive: true,
    });
    await events.flush(tx);
    return ok(refund);
  });
}

export interface ApproveRefundInput {
  refundId: Uuid;
  /** Exécuter aussitôt le remboursement après approbation (défaut `true`). */
  complete?: boolean;
}

/** Approuve (quatre yeux) puis, par défaut, exécute le remboursement. */
export async function approveRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: ApproveRefundInput,
): Promise<Result<RefundRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const refund = await getRefund(tx, input.refundId, { forUpdate: true });
    if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
    if (refund.status === "COMPLETED" || refund.status === "REJECTED") {
      return err(conflict(FinanceCode.INVALID_TRANSITION, `Le remboursement est déjà ${refund.status}.`, { status: refund.status }));
    }
    if (refund.status === "REQUESTED") {
      const approval = validateRefundApproval({
        requestedBy: refund.requestedBy,
        approvedBy: ctx.userId,
        allowSelfApproval: deps.config.refundSelfApproval,
      });
      if (!approval.ok) return approval;
      await approveRefundRow(tx, refund.id, ctx.userId!, deps.clock.now());
      events.audit({
        action: "finance.refund.approved",
        resourceType: "refund",
        resourceId: refund.id,
        after: { approvedBy: ctx.userId },
        sensitive: true,
      });
    }
    if (input.complete ?? true) {
      const done = await completeRefundInTx(deps, ctx, tx, events, input.refundId);
      if (!done.ok) return done;
    }
    await events.flush(tx);
    return ok((await getRefund(tx, input.refundId))!);
  });
}

/** Exécute un remboursement déjà APPROUVÉ (approuvé sans exécution immédiate). */
export async function completeRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { refundId: Uuid },
): Promise<Result<RefundRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const done = await completeRefundInTx(deps, ctx, tx, events, input.refundId);
    if (!done.ok) return done;
    await events.flush(tx);
    return ok((await getRefund(tx, input.refundId))!);
  });
}

export async function rejectRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { refundId: Uuid; reason: string },
): Promise<Result<RefundRecord, AppError>> {
  const reason = validateReason(input.reason, "reason");
  if (!reason.ok) return reason;
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Un refus exige un utilisateur identifié.", "actor"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const refund = await getRefund(tx, input.refundId, { forUpdate: true });
    if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
    if (refund.status !== "REQUESTED" && refund.status !== "APPROVED") {
      return err(conflict(FinanceCode.INVALID_TRANSITION, `Le remboursement est déjà ${refund.status}.`, { status: refund.status }));
    }
    const payment = (await getPayment(tx, refund.paymentId))!;
    await rejectRefundRow(tx, refund.id, ctx.userId!, deps.clock.now(), reason.value);
    events.add(
      FinanceEvents.REFUND_REJECTED,
      {
        v: 1,
        refundId: refund.id,
        paymentId: refund.paymentId,
        learnerId: payment.learnerId,
        amount: moneyPayload(refund.amount),
        reason: reason.value,
        status: "REJECTED",
      },
      { type: "refund", id: refund.id },
    );
    events.audit({
      action: "finance.refund.rejected",
      resourceType: "refund",
      resourceId: refund.id,
      after: { reason: reason.value },
      sensitive: true,
    });
    await events.flush(tx);
    return ok((await getRefund(tx, refund.id))!);
  });
}

async function completeRefundInTx(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  refundId: Uuid,
): Promise<Result<true, AppError>> {
  const refund = await getRefund(tx, refundId, { forUpdate: true });
  if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", refundId));
  if (refund.status !== "APPROVED") {
    return err(conflict(FinanceCode.INVALID_TRANSITION, "Seul un remboursement approuvé s'exécute.", { status: refund.status }));
  }
  // Paiement verrouillé : relecture des cumuls à jour.
  const payment: PaymentRecord | null = await getPayment(tx, refund.paymentId, { forUpdate: true });
  if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", refund.paymentId));
  if (payment.status !== "CONFIRMED") {
    return err(conflict(FinanceCode.PAYMENT_NOT_CONFIRMED, "Le paiement n'est plus remboursable.", { status: payment.status }));
  }
  const remainingRefundable = payment.amount.subtract(payment.refunded);
  if (refund.amount.gt(remainingRefundable)) {
    return err(
      conflict(FinanceCode.REFUND_EXCEEDS_REFUNDABLE, "Le remboursement dépasse le montant remboursable.", {
        refundable: remainingRefundable.amount,
        requested: refund.amount.amount,
      }),
    );
  }

  // Espèces : la sortie d'argent est portée par la session de caisse ouverte de l'exécutant.
  let cashSessionId: Uuid | null = null;
  if (payment.method === "CASH") {
    if (!ctx.userId) return err(conflict(FinanceCode.CASH_SESSION_REQUIRED, "Un remboursement espèces exige un caissier identifié.", {}));
    const session = await getOpenSessionForCashier(tx, ctx.userId, "share");
    if (!session) {
      return err(conflict(FinanceCode.CASH_SESSION_REQUIRED, "Ouvrez une session de caisse pour rembourser des espèces.", { cashierId: ctx.userId }));
    }
    cashSessionId = session.id;
  }

  const { fromAllocations } = splitRefund(refund.amount, unallocatedAmount(payment));
  if (fromAllocations.isPositive()) {
    const records = await listAllocationRecords(tx, payment.id);
    const reversals = planReversals(records, fromAllocations, "LATEST_DUE_FIRST");
    if (!reversals.ok) return reversals;
    // Factures verrouillées d'abord (ordre d'identifiant), puis écritures inverses.
    await lockInvoices(tx, reversals.value.map((r) => r.invoiceId));
    const perInvoice = new Map<Uuid, Money>();
    for (const r of reversals.value) {
      await insertReversal(tx, ctx.tenantId, { id: deps.newId(), allocationId: r.allocationId, paymentId: payment.id, refundId: refund.id, amount: r.amount });
      await addInstallmentCumuls(tx, r.installmentId, { paid: r.amount.negate() });
      perInvoice.set(r.invoiceId, (perInvoice.get(r.invoiceId) ?? Money.zero(r.amount.currency)).add(r.amount));
    }
    for (const [invoiceId, amount] of perInvoice) await addInvoiceCumuls(tx, invoiceId, { paid: amount.negate() });
    await addPaymentCumuls(tx, payment.id, { allocated: fromAllocations.negate(), refunded: refund.amount });
    await completeRefundRow(tx, refund.id, deps.clock.now(), cashSessionId);
    for (const invoiceId of [...perInvoice.keys()].sort()) {
      const r = await refreshInvoiceStatus(deps, tx, events, invoiceId);
      if (!r.ok) return r;
    }
  } else {
    await addPaymentCumuls(tx, payment.id, { refunded: refund.amount });
    await completeRefundRow(tx, refund.id, deps.clock.now(), cashSessionId);
  }

  events.add(
    FinanceEvents.REFUND_COMPLETED,
    {
      v: 1,
      refundId: refund.id,
      paymentId: payment.id,
      learnerId: payment.learnerId,
      amount: moneyPayload(refund.amount),
      reason: refund.reason,
      status: "COMPLETED",
    },
    { type: "refund", id: refund.id },
  );
  events.audit({
    action: "finance.refund.completed",
    resourceType: "refund",
    resourceId: refund.id,
    after: { paymentId: payment.id, amount: refund.amount.amount, cashSessionId },
    sensitive: true,
  });
  return ok(true as const);
}

export async function getRefundById(deps: FinanceDeps, ctx: RequestContext, refundId: Uuid): Promise<Result<RefundRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const refund = await getRefund(tx, refundId);
      return refund ? ok(refund) : err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", refundId));
    },
    { readOnly: true },
  );
}

export async function listRefundPage(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { paymentId?: Uuid; status?: RefundRecord["status"]; limit?: number; offset?: number } = {},
): Promise<Result<RefundRecord[], AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listRefunds(tx, { ...filter, limit, offset: filter.offset ?? 0 })), { readOnly: true });
}
