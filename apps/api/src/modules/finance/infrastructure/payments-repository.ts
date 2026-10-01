/**
 * Accès SQL aux encaissements : paiements, imputations, reçus, remboursements, avoirs,
 * numérotation.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AllocationRecord } from "../domain/allocation";
import type {
  AllocationRow,
  CreditNoteRecord,
  PaymentRecord,
  ReceiptRecord,
  ReceiptSnapshot,
  RefundRecord,
} from "../domain/records";
import type { DocumentKind, PayerKind, PaymentMethod, PaymentStatus, RefundStatus, Uuid } from "../domain/types";
import { money } from "./rows";

// --- Numérotation ------------------------------------------------------------

/**
 * Numéro suivant (sans trou ni doublon) : à appeler DANS la transaction qui insère le
 * document, le plus tard possible — la ligne de compteur reste verrouillée jusqu'au COMMIT.
 */
export async function nextSequence(tx: Tx, kind: DocumentKind, year: number): Promise<number> {
  const row = await tx.queryOne<{ n: string }>("SELECT finance.next_number($1, $2)::text AS n", [kind, year]);
  return Number(row!.n);
}

// --- Paiements ---------------------------------------------------------------

export const PAYMENT_COLS = `id, learner_id, enrollment_id, payer_kind, payer_ref, payer_name, method, status,
  amount::text AS amount, currency, allocated_amount::text AS allocated_amount, refunded_amount::text AS refunded_amount,
  idempotency_key, request_fingerprint, provider, provider_ref, provider_status, simulated, reference,
  intended_invoice_id, cash_session_id, received_at, confirmed_at, failed_at, failure_reason, created_by, created_at`;

export const paymentOf = (r: any): PaymentRecord => ({
  id: r.id,
  learnerId: r.learner_id,
  enrollmentId: r.enrollment_id,
  payerKind: r.payer_kind as PayerKind,
  payerRef: r.payer_ref,
  payerName: r.payer_name,
  method: r.method as PaymentMethod,
  status: r.status as PaymentStatus,
  amount: money(r.amount, r.currency),
  allocated: money(r.allocated_amount, r.currency),
  refunded: money(r.refunded_amount, r.currency),
  idempotencyKey: r.idempotency_key,
  requestFingerprint: r.request_fingerprint,
  provider: r.provider,
  providerRef: r.provider_ref,
  providerStatus: r.provider_status,
  simulated: r.simulated,
  reference: r.reference,
  intendedInvoiceId: r.intended_invoice_id,
  cashSessionId: r.cash_session_id,
  receivedAt: r.received_at,
  confirmedAt: r.confirmed_at,
  failedAt: r.failed_at,
  failureReason: r.failure_reason,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export interface NewPayment {
  id: Uuid;
  learnerId: Uuid;
  enrollmentId: Uuid | null;
  payerKind: PayerKind;
  payerRef: string | null;
  payerName: string | null;
  method: PaymentMethod;
  status: "PENDING" | "CONFIRMED";
  amount: Money;
  idempotencyKey: string;
  requestFingerprint: string;
  provider: string | null;
  providerRef: string | null;
  simulated: boolean;
  reference: string | null;
  intendedInvoiceId: Uuid | null;
  cashSessionId: Uuid | null;
  receivedAt: Date;
  confirmedAt: Date | null;
  createdBy: Uuid | null;
}

/**
 * Insère un paiement. `ON CONFLICT DO NOTHING` sur la clé d'idempotence : si une autre
 * transaction a déjà enregistré la même clé, aucune ligne n'est renvoyée (`null`) et
 * l'appelant relit le paiement existant — jamais de doublon, jamais d'erreur brute.
 */
export async function insertPaymentIdempotent(tx: Tx, tenantId: string, p: NewPayment): Promise<PaymentRecord | null> {
  const row = await tx.queryOne(
    `INSERT INTO finance.payments
       (id, tenant_id, learner_id, enrollment_id, payer_kind, payer_ref, payer_name, method, status, amount, currency,
        idempotency_key, request_fingerprint, provider, provider_ref, simulated, reference, intended_invoice_id,
        cash_session_id, received_at, confirmed_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING ${PAYMENT_COLS}`,
    [
      p.id,
      tenantId,
      p.learnerId,
      p.enrollmentId,
      p.payerKind,
      p.payerRef,
      p.payerName,
      p.method,
      p.status,
      p.amount.amount,
      p.amount.currency,
      p.idempotencyKey,
      p.requestFingerprint,
      p.provider,
      p.providerRef,
      p.simulated,
      p.reference,
      p.intendedInvoiceId,
      p.cashSessionId,
      p.receivedAt,
      p.confirmedAt,
      p.createdBy,
    ],
  );
  return row ? paymentOf(row) : null;
}

export async function getPayment(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<PaymentRecord | null> {
  const row = await tx.queryOne(`SELECT ${PAYMENT_COLS} FROM finance.payments WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? paymentOf(row) : null;
}

export async function getPaymentByIdempotencyKey(tx: Tx, key: string): Promise<PaymentRecord | null> {
  const row = await tx.queryOne(`SELECT ${PAYMENT_COLS} FROM finance.payments WHERE idempotency_key = $1`, [key]);
  return row ? paymentOf(row) : null;
}

export async function getPaymentByProviderRef(tx: Tx, provider: string, providerRef: string, forUpdate = false): Promise<PaymentRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${PAYMENT_COLS} FROM finance.payments WHERE provider = $1 AND provider_ref = $2${forUpdate ? " FOR UPDATE" : ""}`,
    [provider, providerRef],
  );
  return row ? paymentOf(row) : null;
}

export async function setPaymentProviderState(
  tx: Tx,
  id: Uuid,
  state: { providerRef: string | null; providerStatus: string },
): Promise<void> {
  await tx.query(
    `UPDATE finance.payments
        SET provider_ref = COALESCE(provider_ref, $2), provider_status = $3, updated_at = now()
      WHERE id = $1 AND status = 'PENDING'`,
    [id, state.providerRef, state.providerStatus],
  );
}

export async function confirmPaymentRow(tx: Tx, id: Uuid, at: Date, providerStatus: string | null): Promise<void> {
  await tx.query(
    `UPDATE finance.payments
        SET status = 'CONFIRMED', confirmed_at = $2, provider_status = COALESCE($3, provider_status), updated_at = now()
      WHERE id = $1 AND status = 'PENDING'`,
    [id, at, providerStatus],
  );
}

export async function failPaymentRow(tx: Tx, id: Uuid, at: Date, reason: string, providerStatus: string | null): Promise<void> {
  await tx.query(
    `UPDATE finance.payments
        SET status = 'FAILED', failed_at = $2, failure_reason = $3, provider_status = COALESCE($4, provider_status), updated_at = now()
      WHERE id = $1 AND status = 'PENDING'`,
    [id, at, reason.slice(0, 500), providerStatus],
  );
}

/** Variation (signée) des cumuls d'un paiement ; statut REFUNDED si le remboursé atteint le montant. */
export async function addPaymentCumuls(
  tx: Tx,
  id: Uuid,
  delta: { allocated?: Money; refunded?: Money },
): Promise<void> {
  await tx.query(
    `UPDATE finance.payments
        SET allocated_amount = allocated_amount + $2::bigint,
            refunded_amount = refunded_amount + $3::bigint,
            status = CASE WHEN refunded_amount + $3::bigint = amount THEN 'REFUNDED' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [id, delta.allocated?.amount ?? 0, delta.refunded?.amount ?? 0],
  );
}

export interface PaymentListFilter {
  learnerId?: Uuid;
  status?: PaymentStatus;
  method?: PaymentMethod;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export async function listPayments(tx: Tx, f: PaymentListFilter): Promise<{ items: PaymentRecord[]; total: number }> {
  const params = [f.learnerId ?? null, f.status ?? null, f.method ?? null, f.from ?? null, f.to ?? null];
  const where = `($1::uuid IS NULL OR learner_id = $1) AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR method = $3)
                 AND ($4::timestamptz IS NULL OR received_at >= $4) AND ($5::timestamptz IS NULL OR received_at < $5)`;
  const rows = await tx.many(
    `SELECT ${PAYMENT_COLS} FROM finance.payments WHERE ${where} ORDER BY received_at DESC, id DESC LIMIT $6 OFFSET $7`,
    [...params, f.limit, f.offset],
  );
  const count = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM finance.payments WHERE ${where}`, params);
  return { items: rows.map(paymentOf), total: Number(count?.n ?? 0) };
}

// --- Imputations -------------------------------------------------------------

export async function insertAllocation(
  tx: Tx,
  tenantId: string,
  a: { id: Uuid; paymentId: Uuid; invoiceId: Uuid; installmentId: Uuid; lineId: Uuid | null; amount: Money; createdBy: Uuid | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO finance.payment_allocations (id, tenant_id, payment_id, invoice_id, installment_id, line_id, amount, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.id, tenantId, a.paymentId, a.invoiceId, a.installmentId, a.lineId, a.amount.amount, a.createdBy],
  );
}

const ALLOCATION_SELECT = `SELECT a.id, a.payment_id, a.invoice_id, a.installment_id, a.line_id, a.amount::text AS amount,
       COALESCE((SELECT sum(r.amount) FROM finance.allocation_reversals r WHERE r.allocation_id = a.id), 0)::text AS reversed,
       a.created_at, p.currency, i.due_date::text AS due_date
  FROM finance.payment_allocations a
  JOIN finance.payments p ON p.id = a.payment_id
  JOIN finance.installments i ON i.id = a.installment_id`;

export async function listAllocations(tx: Tx, paymentId: Uuid): Promise<Array<AllocationRow & { dueDate: string }>> {
  const rows = await tx.many(`${ALLOCATION_SELECT} WHERE a.payment_id = $1 ORDER BY a.created_at, a.id`, [paymentId]);
  return rows.map((r) => {
    const amount = money(r.amount, r.currency);
    const reversed = money(r.reversed, r.currency);
    return {
      id: r.id,
      paymentId: r.payment_id,
      invoiceId: r.invoice_id,
      installmentId: r.installment_id,
      lineId: r.line_id,
      amount,
      reversed,
      net: amount.subtract(reversed),
      createdAt: r.created_at,
      dueDate: r.due_date,
    };
  });
}

export async function listAllocationRecords(tx: Tx, paymentId: Uuid): Promise<AllocationRecord[]> {
  const rows = await listAllocations(tx, paymentId);
  return rows.map((r) => ({
    id: r.id,
    invoiceId: r.invoiceId,
    installmentId: r.installmentId,
    net: r.net,
    dueDate: r.dueDate,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function insertReversal(
  tx: Tx,
  tenantId: string,
  r: { id: Uuid; allocationId: Uuid; paymentId: Uuid; refundId: Uuid; amount: Money },
): Promise<void> {
  await tx.query(
    `INSERT INTO finance.allocation_reversals (id, tenant_id, allocation_id, payment_id, refund_id, amount)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [r.id, tenantId, r.allocationId, r.paymentId, r.refundId, r.amount.amount],
  );
}

/** Imputé net, par ligne de facture, pour détecter un dépassement de ligne. */
export async function netAllocatedByLine(tx: Tx, invoiceId: Uuid): Promise<Map<Uuid, number>> {
  const rows = await tx.many<{ line_id: string; net: string }>(
    `WITH per_alloc AS (
       SELECT a.line_id,
              a.amount - COALESCE((SELECT sum(r.amount) FROM finance.allocation_reversals r WHERE r.allocation_id = a.id), 0) AS n
         FROM finance.payment_allocations a WHERE a.invoice_id = $1 AND a.line_id IS NOT NULL)
     SELECT line_id, sum(n)::text AS net FROM per_alloc GROUP BY line_id`,
    [invoiceId],
  );
  return new Map(rows.map((r) => [r.line_id, Number(r.net)]));
}

// --- Reçus -------------------------------------------------------------------

const receiptOf = (r: any): ReceiptRecord => ({
  id: r.id,
  number: r.number,
  paymentId: r.payment_id,
  learnerId: r.learner_id,
  amount: money(r.amount, r.currency),
  issuedAt: r.issued_at,
  issuedBy: r.issued_by,
  snapshot: r.snapshot as ReceiptSnapshot,
});

const RECEIPT_COLS = "id, number, payment_id, learner_id, amount::text AS amount, currency, issued_at, issued_by, snapshot";

export async function insertReceipt(
  tx: Tx,
  tenantId: string,
  r: {
    id: Uuid;
    number: string;
    year: number;
    seq: number;
    paymentId: Uuid;
    learnerId: Uuid;
    amount: Money;
    issuedAt: Date;
    issuedBy: Uuid | null;
    snapshot: ReceiptSnapshot;
  },
): Promise<ReceiptRecord> {
  const row = await tx.queryOne(
    `INSERT INTO finance.receipts
       (id, tenant_id, number, number_year, number_seq, payment_id, learner_id, amount, currency, issued_at, issued_by, snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING ${RECEIPT_COLS}`,
    [
      r.id,
      tenantId,
      r.number,
      r.year,
      r.seq,
      r.paymentId,
      r.learnerId,
      r.amount.amount,
      r.amount.currency,
      r.issuedAt,
      r.issuedBy,
      JSON.stringify(r.snapshot),
    ],
  );
  return receiptOf(row);
}

export async function getReceipt(tx: Tx, id: Uuid): Promise<ReceiptRecord | null> {
  const row = await tx.queryOne(`SELECT ${RECEIPT_COLS} FROM finance.receipts WHERE id = $1`, [id]);
  return row ? receiptOf(row) : null;
}

export async function getReceiptByPayment(tx: Tx, paymentId: Uuid): Promise<ReceiptRecord | null> {
  const row = await tx.queryOne(`SELECT ${RECEIPT_COLS} FROM finance.receipts WHERE payment_id = $1`, [paymentId]);
  return row ? receiptOf(row) : null;
}

export async function listReceipts(
  tx: Tx,
  f: { learnerId?: Uuid; limit: number; offset: number },
): Promise<{ items: ReceiptRecord[]; total: number }> {
  const rows = await tx.many(
    `SELECT ${RECEIPT_COLS} FROM finance.receipts WHERE ($1::uuid IS NULL OR learner_id = $1)
      ORDER BY number_year DESC, number_seq DESC LIMIT $2 OFFSET $3`,
    [f.learnerId ?? null, f.limit, f.offset],
  );
  const count = await tx.queryOne<{ n: string }>(
    "SELECT count(*)::text AS n FROM finance.receipts WHERE ($1::uuid IS NULL OR learner_id = $1)",
    [f.learnerId ?? null],
  );
  return { items: rows.map(receiptOf), total: Number(count?.n ?? 0) };
}

// --- Remboursements ----------------------------------------------------------

const REFUND_COLS = `id, payment_id, amount::text AS amount, currency, reason, status, requested_by, requested_at, approved_by,
  approved_at, completed_at, rejected_by, rejected_at, rejection_reason, cash_session_id, idempotency_key, request_fingerprint`;

export const refundOf = (r: any): RefundRecord => ({
  id: r.id,
  paymentId: r.payment_id,
  amount: money(r.amount, r.currency),
  reason: r.reason,
  status: r.status as RefundStatus,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  completedAt: r.completed_at,
  rejectedBy: r.rejected_by,
  rejectedAt: r.rejected_at,
  rejectionReason: r.rejection_reason,
  cashSessionId: r.cash_session_id,
  idempotencyKey: r.idempotency_key,
  requestFingerprint: r.request_fingerprint,
});

export async function insertRefundIdempotent(
  tx: Tx,
  tenantId: string,
  r: {
    id: Uuid;
    paymentId: Uuid;
    amount: Money;
    reason: string;
    requestedBy: Uuid;
    requestedAt: Date;
    idempotencyKey: string | null;
    requestFingerprint: string | null;
  },
): Promise<RefundRecord | null> {
  const row = await tx.queryOne(
    `INSERT INTO finance.refunds
       (id, tenant_id, payment_id, amount, currency, reason, requested_by, requested_at, idempotency_key, request_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING ${REFUND_COLS}`,
    [r.id, tenantId, r.paymentId, r.amount.amount, r.amount.currency, r.reason, r.requestedBy, r.requestedAt, r.idempotencyKey, r.requestFingerprint],
  );
  return row ? refundOf(row) : null;
}

export async function getRefund(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<RefundRecord | null> {
  const row = await tx.queryOne(`SELECT ${REFUND_COLS} FROM finance.refunds WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? refundOf(row) : null;
}

export async function getRefundByIdempotencyKey(tx: Tx, key: string): Promise<RefundRecord | null> {
  const row = await tx.queryOne(`SELECT ${REFUND_COLS} FROM finance.refunds WHERE idempotency_key = $1`, [key]);
  return row ? refundOf(row) : null;
}

export async function listRefunds(tx: Tx, f: { paymentId?: Uuid; status?: RefundStatus; limit: number; offset: number }): Promise<RefundRecord[]> {
  const rows = await tx.many(
    `SELECT ${REFUND_COLS} FROM finance.refunds WHERE ($1::uuid IS NULL OR payment_id = $1) AND ($2::text IS NULL OR status = $2)
      ORDER BY requested_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [f.paymentId ?? null, f.status ?? null, f.limit, f.offset],
  );
  return rows.map(refundOf);
}

/** Somme des remboursements ouverts (REQUESTED + APPROVED) d'un paiement. */
export async function sumOpenRefunds(tx: Tx, paymentId: Uuid, currency: CurrencyCode, excludeId?: Uuid): Promise<Money> {
  const row = await tx.queryOne<{ s: string }>(
    `SELECT COALESCE(sum(amount), 0)::text AS s FROM finance.refunds
      WHERE payment_id = $1 AND status IN ('REQUESTED','APPROVED') AND ($2::uuid IS NULL OR id <> $2)`,
    [paymentId, excludeId ?? null],
  );
  return money(row!.s, currency);
}

export async function approveRefundRow(tx: Tx, id: Uuid, by: Uuid, at: Date): Promise<void> {
  await tx.query(
    "UPDATE finance.refunds SET status = 'APPROVED', approved_by = $2, approved_at = $3, updated_at = now() WHERE id = $1 AND status = 'REQUESTED'",
    [id, by, at],
  );
}

export async function rejectRefundRow(tx: Tx, id: Uuid, by: Uuid, at: Date, reason: string): Promise<void> {
  await tx.query(
    `UPDATE finance.refunds
        SET status = 'REJECTED', rejected_by = $2, rejected_at = $3, rejection_reason = $4, updated_at = now()
      WHERE id = $1 AND status IN ('REQUESTED','APPROVED')`,
    [id, by, at, reason],
  );
}

export async function completeRefundRow(tx: Tx, id: Uuid, at: Date, cashSessionId: Uuid | null): Promise<void> {
  await tx.query(
    "UPDATE finance.refunds SET status = 'COMPLETED', completed_at = $2, cash_session_id = $3, updated_at = now() WHERE id = $1 AND status = 'APPROVED'",
    [id, at, cashSessionId],
  );
}

// --- Avoirs ------------------------------------------------------------------

const CREDIT_NOTE_COLS =
  "id, number, invoice_id, learner_id, amount::text AS amount, currency, reason, applications, issued_at, issued_by";

const creditNoteOf = (r: any): CreditNoteRecord => ({
  id: r.id,
  number: r.number,
  invoiceId: r.invoice_id,
  learnerId: r.learner_id,
  amount: money(r.amount, r.currency),
  reason: r.reason,
  applications: r.applications,
  issuedAt: r.issued_at,
  issuedBy: r.issued_by,
});

export async function insertCreditNote(
  tx: Tx,
  tenantId: string,
  c: {
    id: Uuid;
    number: string;
    year: number;
    seq: number;
    invoiceId: Uuid;
    learnerId: Uuid;
    amount: Money;
    reason: string;
    applications: Array<{ installmentId: Uuid; amount: number }>;
    issuedAt: Date;
    issuedBy: Uuid | null;
  },
): Promise<CreditNoteRecord> {
  const row = await tx.queryOne(
    `INSERT INTO finance.credit_notes
       (id, tenant_id, number, number_year, number_seq, invoice_id, learner_id, amount, currency, reason, applications, issued_at, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING ${CREDIT_NOTE_COLS}`,
    [
      c.id,
      tenantId,
      c.number,
      c.year,
      c.seq,
      c.invoiceId,
      c.learnerId,
      c.amount.amount,
      c.amount.currency,
      c.reason,
      JSON.stringify(c.applications),
      c.issuedAt,
      c.issuedBy,
    ],
  );
  return creditNoteOf(row);
}

export async function listCreditNotes(tx: Tx, invoiceId: Uuid): Promise<CreditNoteRecord[]> {
  const rows = await tx.many(`SELECT ${CREDIT_NOTE_COLS} FROM finance.credit_notes WHERE invoice_id = $1 ORDER BY number_year, number_seq`, [invoiceId]);
  return rows.map(creditNoteOf);
}
