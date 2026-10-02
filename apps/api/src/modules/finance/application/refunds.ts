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
 *
 * TROIS ROUTES d'exécution (`planRefundRoute`, décidée SANS appel réseau) :
 *   - `LEDGER`   : paiement saisi à la main (espèces, chèque, virement…) — l'argent est rendu hors module ; écriture comptable.
 *   - `PROVIDER` : paiement en ligne dont le fournisseur sait rembourser (Wave total, MTN, TresorPay, sandbox) — le
 *                  remboursement est ENVOYÉ au fournisseur ; le grand livre n'est écrit que quand il confirme.
 *   - `MANUAL`   : fournisseur sans API (Orange Money, CinetPay), refus du partiel (Wave), fournisseur indisponible ou
 *                  référence absente — repli EXPLICITE : l'exécutant atteste avoir remboursé à la main (référence de
 *                  preuve obligatoire), journalisé `finance.refund.completed_manually`. Jamais implicite.
 *
 * Remboursement chez le fournisseur — JAMAIS DE DOUBLE REMBOURSEMENT :
 *   1. Tx1 : APPROVED → REFUND_PENDING (intention durable AVANT l'appel réseau ; le montant reste réservé) ;
 *   2. appel `provider.refund({ refundId })` HORS transaction (référence d'idempotence = identifiant du remboursement) ;
 *   3. Tx2 : SUCCEEDED → écritures inverses + COMPLETED ; FAILED définitif → REFUND_FAILED (rien n'est parti) ;
 *      PENDING ou réponse ambiguë (délai, 5xx) → reste REFUND_PENDING, le job de rapprochement conclut (lecture d'état,
 *      ou renvoi de la MÊME demande seulement si le fournisseur est idempotent) ou signale `reconciliation_needed`.
 *   Un crash entre 1 et 3 laisse un REFUND_PENDING repris par le job, jamais un second envoi aveugle.
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
  failRefundRow,
  getPayment,
  getRefund,
  getRefundByIdempotencyKey,
  insertRefundIdempotent,
  insertReversal,
  listAllocationRecords,
  listRefunds,
  markRefundPending,
  rejectRefundRow,
  setRefundProviderState,
  sumOpenRefunds,
  type RefundCompletion,
} from "../infrastructure/payments-repository";
import { ensureState, resolveState } from "../infrastructure/reconciliation-repository";
import { refreshInvoiceStatus } from "./billing-core";
import { EventBuffer, inTx, moneyPayload, type FinanceDeps } from "./deps";
import { FinanceMetricNames } from "./ports/operations";
import type { PaymentProvider, ProviderRefundResult } from "./ports/payment-provider";

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

/** Preuve d'un remboursement fait À LA MAIN (repli explicite pour un fournisseur sans API). */
export interface ManualRefundEvidence {
  /** Référence de la preuve : n° de transaction du remboursement, pièce de caisse… (3 à 120 caractères). */
  reference: string;
  note?: string;
}

export interface ApproveRefundInput {
  refundId: Uuid;
  /** Exécuter aussitôt le remboursement après approbation (défaut `true`). */
  complete?: boolean;
  /** Repli manuel explicite (voir `planRefundRoute`) : refusé quand le fournisseur sait rembourser lui-même. */
  manual?: ManualRefundEvidence;
}

/** Approuve (quatre yeux) puis, par défaut, exécute le remboursement. */
export async function approveRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: ApproveRefundInput,
): Promise<Result<RefundRecord, AppError>> {
  return executeRefund(deps, ctx, { refundId: input.refundId, approve: true, execute: input.complete ?? true, ...(input.manual ? { manual: input.manual } : {}) });
}

/** Exécute un remboursement déjà APPROUVÉ (approuvé sans exécution immédiate). */
export async function completeRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { refundId: Uuid; manual?: ManualRefundEvidence },
): Promise<Result<RefundRecord, AppError>> {
  return executeRefund(deps, ctx, { refundId: input.refundId, approve: false, execute: true, ...(input.manual ? { manual: input.manual } : {}) });
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

// ---------------------------------------------------------------------------------------------------------------------
// Route d'exécution
// ---------------------------------------------------------------------------------------------------------------------

export type ManualReason = "no_refund_api" | "partial_not_supported" | "provider_unavailable" | "missing_provider_ref";

export type RefundRoute =
  | { kind: "LEDGER" }
  | { kind: "PROVIDER"; name: string; provider: PaymentProvider }
  | { kind: "MANUAL_REQUIRED"; reason: ManualReason };

/**
 * Décide comment un remboursement s'exécute, sans appel réseau. Un paiement saisi à la main ou sans fournisseur : `LEDGER`.
 * Un paiement en ligne : `PROVIDER` si le fournisseur est utilisable, sait rembourser (et le partiel si c'est un partiel) et
 * si la référence du paiement est connue ; sinon `MANUAL_REQUIRED` (le repli manuel doit être demandé explicitement).
 */
export async function planRefundRoute(deps: FinanceDeps, ctx: RequestContext, refund: RefundRecord, payment: PaymentRecord): Promise<RefundRoute> {
  if (payment.method !== "ONLINE" || !payment.provider) return { kind: "LEDGER" };
  const resolved = await deps.providers.resolve(ctx.tenantId, payment.provider);
  if (!resolved.ok) return { kind: "MANUAL_REQUIRED", reason: "provider_unavailable" };
  const provider = resolved.value;
  if (!provider.refund) return { kind: "MANUAL_REQUIRED", reason: "no_refund_api" };
  const caps = provider.refundCapabilities ?? { partial: false, idempotent: false, statusQuery: false };
  if (!caps.partial && !refund.amount.equals(payment.amount)) return { kind: "MANUAL_REQUIRED", reason: "partial_not_supported" };
  if (!payment.providerRef) return { kind: "MANUAL_REQUIRED", reason: "missing_provider_ref" };
  return { kind: "PROVIDER", name: payment.provider, provider };
}

/** Refus définitif du fournisseur avant tout envoi (validation de l'adaptateur, 4xx) ≠ réponse ambiguë (délai, 5xx, réponse illisible). */
export function isDefinitiveRefusal(error: AppError): boolean {
  if (error.code !== FinanceCode.PROVIDER_FAILED) return true;
  const d = error.details as { reason?: unknown; httpStatus?: unknown } | undefined;
  const status = typeof d?.httpStatus === "number" ? d.httpStatus : 0;
  return d?.reason === "rejected" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

const MANUAL_REFERENCE_RE = /^[\p{L}\p{N} ._:/#-]{3,120}$/u;

function validateManualEvidence(manual: ManualRefundEvidence | undefined): Result<ManualRefundEvidence | undefined, AppError> {
  if (!manual) return ok(undefined);
  const reference = typeof manual.reference === "string" ? manual.reference.trim() : "";
  if (!MANUAL_REFERENCE_RE.test(reference)) {
    return err(validation(FinanceCode.INVALID_INPUT, "La référence de preuve du remboursement manuel est obligatoire (3 à 120 caractères).", "manual.reference"));
  }
  const note = manual.note?.trim();
  if (note !== undefined && note.length > 500) return err(validation(FinanceCode.INVALID_INPUT, "La note du remboursement manuel est limitée à 500 caractères.", "manual.note"));
  return ok({ reference, ...(note ? { note } : {}) });
}

interface ExecuteInput {
  refundId: Uuid;
  /** Approuver d'abord (le remboursement doit être REQUESTED) ; sinon il doit déjà être APPROVED. */
  approve: boolean;
  /** Exécuter après l'approbation. */
  execute: boolean;
  manual?: ManualRefundEvidence;
}

async function executeRefund(deps: FinanceDeps, ctx: RequestContext, input: ExecuteInput): Promise<Result<RefundRecord, AppError>> {
  const evidence = validateManualEvidence(input.manual);
  if (!evidence.ok) return evidence;

  // Approbation seule : une transaction, aucune route à décider.
  if (!input.execute) {
    return inTx(deps, ctx, async (tx) => {
      const events = new EventBuffer(deps, ctx);
      const refund = await getRefund(tx, input.refundId, { forUpdate: true });
      if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
      const approved = await approveInTx(deps, ctx, tx, events, refund, input.approve);
      if (!approved.ok) return approved;
      await events.flush(tx);
      return ok((await getRefund(tx, input.refundId))!);
    });
  }

  const pre = await deps.db.run(
    ctx,
    async (tx) => {
      const refund = await getRefund(tx, input.refundId);
      const payment = refund ? await getPayment(tx, refund.paymentId) : null;
      return { refund, payment };
    },
    { readOnly: true },
  );
  if (!pre.refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
  if (!pre.payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", pre.refund.paymentId));

  // Les états non exécutables (terminaux, en vol) sont refusés sous verrou dans les transactions ci-dessous ;
  // la route n'a de sens que pour un remboursement encore à exécuter.
  const executable = pre.refund.status === "REQUESTED" || pre.refund.status === "APPROVED";
  const route: RefundRoute = executable ? await planRefundRoute(deps, ctx, pre.refund, pre.payment) : { kind: "LEDGER" };

  if (executable && evidence.value) {
    if (route.kind === "PROVIDER") {
      return err(
        conflict(
          FinanceCode.REFUND_MANUAL_NOT_ALLOWED,
          "Le fournisseur sait exécuter ce remboursement : un remboursement manuel risquerait un double remboursement.",
          { provider: route.name },
        ),
      );
    }
    if (route.kind === "LEDGER") {
      return err(validation(FinanceCode.INVALID_INPUT, "Un remboursement manuel n'a de sens que pour un paiement en ligne sans remboursement fournisseur.", "manual"));
    }
  }

  if (route.kind === "MANUAL_REQUIRED" && !evidence.value) {
    // Approuvé (si c'était la demande) puis laissé à APPROVED : l'exécutant devra attester le remboursement manuel.
    if (input.approve) {
      const approvedOnly = await inTx(deps, ctx, async (tx) => {
        const events = new EventBuffer(deps, ctx);
        const refund = await getRefund(tx, input.refundId, { forUpdate: true });
        if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
        const approved = await approveInTx(deps, ctx, tx, events, refund, true);
        if (!approved.ok) return approved;
        await events.flush(tx);
        return ok((await getRefund(tx, input.refundId))!);
      });
      if (!approvedOnly.ok) return approvedOnly;
      return ok(approvedOnly.value);
    }
    return err(
      conflict(
        FinanceCode.REFUND_MANUAL_REQUIRED,
        "Ce fournisseur ne rembourse pas par API : effectuez le remboursement à la main puis confirmez-le avec sa référence de preuve.",
        { reason: route.reason, provider: pre.payment.provider },
      ),
    );
  }

  if (route.kind === "PROVIDER") return executeWithProvider(deps, ctx, input, route, pre.payment);

  // LEDGER ou MANUAL (preuve fournie) : approbation + écritures dans UNE transaction, comme avant.
  const completion: RefundCompletion = evidence.value
    ? { mode: "MANUAL", manualReference: evidence.value.reference, manualNote: evidence.value.note ?? null }
    : { mode: "LEDGER" };
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const refund = await getRefund(tx, input.refundId, { forUpdate: true });
    if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
    const approved = await approveInTx(deps, ctx, tx, events, refund, input.approve);
    if (!approved.ok) return approved;
    const done = await bookRefundInTx(deps, ctx, tx, events, input.refundId, "APPROVED", completion);
    if (!done.ok) return done;
    if (evidence.value) {
      events.audit({
        action: "finance.refund.completed_manually",
        resourceType: "refund",
        resourceId: input.refundId,
        after: { reference: evidence.value.reference, note: evidence.value.note ?? null, provider: pre.payment!.provider, reason: route.kind === "MANUAL_REQUIRED" ? route.reason : null },
        sensitive: true,
      });
    }
    await events.flush(tx);
    return ok((await getRefund(tx, input.refundId))!);
  });
}

/** Contrôle d'état et approbation (quatre yeux) sous verrou ; `approve = false` : le remboursement doit déjà être APPROVED. */
async function approveInTx(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  refund: RefundRecord,
  approve: boolean,
): Promise<Result<true, AppError>> {
  if (refund.status === "REFUND_PENDING") {
    return err(conflict(FinanceCode.REFUND_IN_FLIGHT, "Le remboursement est déjà parti chez le fournisseur : le rapprochement le conclura.", { status: refund.status }));
  }
  if (refund.status === "COMPLETED" || refund.status === "REJECTED" || refund.status === "REFUND_FAILED") {
    return err(conflict(FinanceCode.INVALID_TRANSITION, `Le remboursement est déjà ${refund.status}.`, { status: refund.status }));
  }
  if (refund.status === "REQUESTED") {
    if (!approve) return err(conflict(FinanceCode.INVALID_TRANSITION, "Seul un remboursement approuvé s'exécute.", { status: refund.status }));
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
  return ok(true as const);
}

// ---------------------------------------------------------------------------------------------------------------------
// Exécution chez le fournisseur
// ---------------------------------------------------------------------------------------------------------------------

async function executeWithProvider(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: ExecuteInput,
  route: Extract<RefundRoute, { kind: "PROVIDER" }>,
  prePayment: PaymentRecord,
): Promise<Result<RefundRecord, AppError>> {
  // Tx1 : approbation éventuelle + intention d'envoi DURABLE (REFUND_PENDING) avant tout appel réseau.
  const submitted = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const refund = await getRefund(tx, input.refundId, { forUpdate: true });
    if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
    const approved = await approveInTx(deps, ctx, tx, events, refund, input.approve);
    if (!approved.ok) return approved;
    const payment = await getPayment(tx, refund.paymentId, { forUpdate: true });
    if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", refund.paymentId));
    const eligible = validateProviderEligibility(refund, payment);
    if (!eligible.ok) return eligible;
    const now = deps.clock.now();
    await markRefundPending(tx, refund.id, route.name, now);
    // Le suivi existe dès l'envoi : si l'appel ou la conclusion est perdu(e), le job reprendra ce remboursement.
    await ensureState(tx, ctx.tenantId, { refundId: refund.id }, deps.newId, new Date(now.getTime() + deps.config.reconciliation.minAgeMs));
    events.add(
      FinanceEvents.REFUND_SUBMITTED,
      {
        v: 1,
        refundId: refund.id,
        paymentId: payment.id,
        learnerId: payment.learnerId,
        amount: moneyPayload(refund.amount),
        reason: refund.reason,
        status: "REFUND_PENDING",
        provider: route.name,
        executionMode: "PROVIDER",
      },
      { type: "refund", id: refund.id },
    );
    events.audit({
      action: "finance.refund.submitted",
      resourceType: "refund",
      resourceId: refund.id,
      after: { paymentId: payment.id, amount: refund.amount.amount, provider: route.name },
      sensitive: true,
    });
    await events.flush(tx);
    return ok({ refund: (await getRefund(tx, refund.id))!, payment });
  });
  if (!submitted.ok) return submitted;
  const { refund, payment } = submitted.value;

  // Appel fournisseur : hors transaction. `refundId` = référence d'idempotence stable.
  const called = await callProviderRefund(deps, route.provider, {
    paymentId: payment.id,
    providerRef: payment.providerRef ?? prePayment.providerRef,
    amount: refund.amount,
    refundId: refund.id,
    reason: refund.reason,
  });
  let applied: Awaited<ReturnType<typeof applyRefundProviderOutcome>>;
  try {
    applied = await applyRefundProviderOutcome(deps, ctx, { refundId: refund.id, outcome: called, source: "initial", provider: route.name });
  } catch (e) {
    // Plantage de la transaction de conclusion (base, audit) APRÈS l'appel : le fournisseur a peut-être remboursé, le
    // remboursement reste REFUND_PENDING et le rapprochement conclura (renvoi idempotent ou lecture d'état).
    deps.logger.error({ refundId: refund.id, err: e instanceof Error ? e.message : "unknown" }, "remboursement fournisseur : exception à l'enregistrement de la conclusion, rapprochement requis");
    return ok((await deps.db.run(ctx, (tx) => getRefund(tx, refund.id), { readOnly: true }))!);
  }
  if (!applied.ok) {
    // Écriture de la conclusion impossible (base, incohérence) : le remboursement reste REFUND_PENDING, le job conclura.
    deps.logger.error({ refundId: refund.id, code: applied.error.code }, "remboursement fournisseur : conclusion non enregistrée, rapprochement requis");
    return ok((await deps.db.run(ctx, (tx) => getRefund(tx, refund.id), { readOnly: true }))!);
  }
  return ok(applied.value.refund);
}

function validateProviderEligibility(refund: RefundRecord, payment: PaymentRecord): Result<true, AppError> {
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
  return ok(true as const);
}

export interface RefundOutcome {
  readonly status: "PENDING" | "SUCCEEDED" | "FAILED";
  readonly providerRefundRef: string | null;
  readonly failureReason?: string;
  /** Réponse ambiguë (délai, 5xx…) : on ne conclut RIEN, on ne renvoie JAMAIS aveuglément. */
  readonly ambiguous?: { readonly code: string };
}

/** Appelle `refund` du fournisseur ; l'erreur est classée : refus définitif (FAILED) ou réponse ambiguë (PENDING + `ambiguous`). */
export async function callProviderRefund(
  deps: FinanceDeps,
  provider: PaymentProvider,
  request: { paymentId: string; providerRef: string | null; amount: Money; refundId: string; reason: string },
): Promise<RefundOutcome> {
  let result: Result<ProviderRefundResult, AppError>;
  try {
    result = await provider.refund!(request);
  } catch (e) {
    deps.logger.error({ refundId: request.refundId, err: e instanceof Error ? e.message : "unknown" }, "remboursement fournisseur : exception de l'adaptateur");
    return { status: "PENDING", providerRefundRef: null, ambiguous: { code: "adapter_exception" } };
  }
  if (!result.ok) {
    if (isDefinitiveRefusal(result.error)) {
      const reason = typeof result.error.details?.reason === "string" ? result.error.details.reason : result.error.code;
      return { status: "FAILED", providerRefundRef: null, failureReason: String(reason).slice(0, 80) };
    }
    const reason = typeof result.error.details?.reason === "string" ? result.error.details.reason : result.error.code;
    return { status: "PENDING", providerRefundRef: null, ambiguous: { code: String(reason).slice(0, 80) } };
  }
  const v = result.value;
  return { status: v.status, providerRefundRef: v.providerRefundRef, ...(v.failureReason ? { failureReason: v.failureReason } : {}) };
}

/**
 * Applique ce que le fournisseur a répondu à un remboursement REFUND_PENDING, dans UNE transaction, de façon idempotente
 * (un remboursement déjà conclu n'est pas retouché). SUCCEEDED : écritures inverses + COMPLETED. FAILED : REFUND_FAILED.
 * PENDING : mémorise la référence. `Err` (incohérence du grand livre) : rien n'est écrit, l'appelant signale.
 */
export async function applyRefundProviderOutcome(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: {
    refundId: Uuid;
    outcome: RefundOutcome;
    source: "initial" | "reconcile" | "manual";
    provider: string;
    /** Résolution manuelle approuvée : preuve et motif conservés sur le remboursement. */
    manual?: { reference: string; note?: string };
  },
): Promise<Result<{ refund: RefundRecord; applied: boolean }, AppError>> {
  const result = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const refund = await getRefund(tx, input.refundId, { forUpdate: true });
    if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId));
    const applied = await applyRefundOutcomeInTx(deps, ctx, tx, events, refund, input);
    if (!applied.ok) return applied;
    await events.flush(tx);
    return ok({ refund: (await getRefund(tx, refund.id))!, applied: applied.value });
  });
  if (result.ok && result.value.applied) {
    deps.metrics.count(FinanceMetricNames.PROVIDER_REFUND, 1, { provider: input.provider, outcome: input.outcome.status === "SUCCEEDED" ? "completed" : "failed" });
  }
  return result;
}

/** Version « dans la transaction de l'appelant » (le remboursement est verrouillé). Renvoie `applied` (faux : rien à faire / en attente). */
export async function applyRefundOutcomeInTx(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  refund: RefundRecord,
  input: {
    outcome: RefundOutcome;
    source: "initial" | "reconcile" | "manual";
    provider: string;
    manual?: { reference: string; note?: string };
  },
): Promise<Result<boolean, AppError>> {
  const { outcome } = input;
  if (refund.status !== "REFUND_PENDING") return ok(false);
  const now = deps.clock.now();
  if (outcome.status === "PENDING") {
    await setRefundProviderState(tx, refund.id, { providerRefundRef: outcome.providerRefundRef, providerStatus: "PENDING" });
    return ok(false);
  }
  if (outcome.status === "FAILED") {
    const reason = outcome.failureReason ?? "declined";
    const payment = (await getPayment(tx, refund.paymentId))!;
    await failRefundRow(tx, refund.id, now, reason, input.manual ? "MANUAL_FAILED" : "FAILED");
    await resolveState(tx, { refundId: refund.id }, now, "failed");
    events.add(
      FinanceEvents.REFUND_FAILED,
      {
        v: 1,
        refundId: refund.id,
        paymentId: refund.paymentId,
        learnerId: payment.learnerId,
        amount: moneyPayload(refund.amount),
        reason: refund.reason,
        status: "REFUND_FAILED",
        provider: input.provider,
        executionMode: "PROVIDER",
        failureReason: reason,
      },
      { type: "refund", id: refund.id },
    );
    events.audit({
      action: "finance.refund.failed",
      resourceType: "refund",
      resourceId: refund.id,
      after: { reason, provider: input.provider, source: input.source, ...(input.manual ? { manualReference: input.manual.reference } : {}) },
      sensitive: true,
    });
    return ok(true);
  }
  // SUCCEEDED : le fournisseur a rendu l'argent ; le grand livre l'enregistre.
  const booked = await bookRefundInTx(deps, ctx, tx, events, refund.id, "REFUND_PENDING", {
    mode: "PROVIDER",
    providerRefundRef: outcome.providerRefundRef,
    providerStatus: input.manual ? "MANUAL_CONFIRMED" : "SUCCEEDED",
    ...(input.manual ? { manualReference: input.manual.reference, manualNote: input.manual.note ?? null } : {}),
  });
  if (!booked.ok) return booked;
  await resolveState(tx, { refundId: refund.id }, now, "completed");
  if (input.manual) {
    events.audit({
      action: "finance.refund.completed_manually",
      resourceType: "refund",
      resourceId: refund.id,
      after: { reference: input.manual.reference, note: input.manual.note ?? null, provider: input.provider, source: "resolution" },
      sensitive: true,
    });
  }
  return ok(true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Écritures comptables d'un remboursement (inverses, immuables)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Passe les écritures inverses et termine le remboursement. `from` : `APPROVED` (comptable / manuel) ou `REFUND_PENDING`
 * (le fournisseur a confirmé). Sous verrou du remboursement puis du paiement.
 */
export async function bookRefundInTx(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  refundId: Uuid,
  from: "APPROVED" | "REFUND_PENDING",
  completion: RefundCompletion,
): Promise<Result<true, AppError>> {
  const refund = await getRefund(tx, refundId, { forUpdate: true });
  if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", refundId));
  if (refund.status !== from) {
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
    await completeRefundRow(tx, refund.id, deps.clock.now(), cashSessionId, completion);
    for (const invoiceId of [...perInvoice.keys()].sort()) {
      const r = await refreshInvoiceStatus(deps, tx, events, invoiceId);
      if (!r.ok) return r;
    }
  } else {
    await addPaymentCumuls(tx, payment.id, { refunded: refund.amount });
    await completeRefundRow(tx, refund.id, deps.clock.now(), cashSessionId, completion);
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
      executionMode: completion.mode,
      ...(payment.provider ? { provider: payment.provider } : {}),
    },
    { type: "refund", id: refund.id },
  );
  events.audit({
    action: "finance.refund.completed",
    resourceType: "refund",
    resourceId: refund.id,
    after: { paymentId: payment.id, amount: refund.amount.amount, cashSessionId, executionMode: completion.mode },
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
