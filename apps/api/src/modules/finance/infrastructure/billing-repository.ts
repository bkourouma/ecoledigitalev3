/**
 * Accès SQL à la facturation : factures, lignes, remises appliquées, échéances.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AllocationTarget } from "../domain/allocation";
import type { Installment, GeneratedInstallment } from "../domain/installments";
import { invoiceBalance, type InvoiceLine } from "../domain/invoice";
import type { InvoiceDetail, InvoiceRecord } from "../domain/records";
import type { FundingType, InvoiceStatus, IsoDate, PayerKind, Uuid } from "../domain/types";
import { money } from "./rows";

export const INVOICE_COLS = `id, number, status, learner_id, enrollment_id, academic_year, group_key, group_label,
  institution_id, campus_id, funding_type, payer_kind, payer_ref, related_group_id, currency,
  subtotal_amount::text AS subtotal_amount, discount_amount::text AS discount_amount,
  scholarship_amount::text AS scholarship_amount, total_amount::text AS total_amount,
  paid_amount::text AS paid_amount, credited_amount::text AS credited_amount,
  due_date::text AS due_date, issued_at, cancelled_at, cancel_reason, idempotency_key, request_fingerprint, created_at`;

export const invoiceOf = (r: any): InvoiceRecord => ({
  id: r.id,
  number: r.number,
  status: r.status as InvoiceStatus,
  learnerId: r.learner_id,
  enrollmentId: r.enrollment_id,
  academicYear: r.academic_year,
  groupKey: r.group_key,
  groupLabel: r.group_label,
  institutionId: r.institution_id,
  campusId: r.campus_id,
  fundingType: r.funding_type as FundingType | null,
  payerKind: r.payer_kind as PayerKind,
  payerRef: r.payer_ref,
  relatedGroupId: r.related_group_id,
  currency: r.currency as CurrencyCode,
  subtotal: money(r.subtotal_amount, r.currency),
  discount: money(r.discount_amount, r.currency),
  scholarship: money(r.scholarship_amount, r.currency),
  total: money(r.total_amount, r.currency),
  paid: money(r.paid_amount, r.currency),
  credited: money(r.credited_amount, r.currency),
  dueDate: r.due_date,
  issuedAt: r.issued_at,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason,
  idempotencyKey: r.idempotency_key,
  requestFingerprint: r.request_fingerprint,
  createdAt: r.created_at,
});

export interface NewInvoice {
  id: Uuid;
  learnerId: Uuid;
  enrollmentId: Uuid | null;
  academicYear: string;
  groupKey: string | null;
  groupLabel: string | null;
  institutionId: Uuid | null;
  campusId: Uuid | null;
  fundingType: FundingType | null;
  payerKind: PayerKind;
  payerRef: string | null;
  relatedGroupId: Uuid | null;
  currency: CurrencyCode;
  subtotal: Money;
  discount: Money;
  scholarship: Money;
  total: Money;
  dueDate: IsoDate;
  idempotencyKey: string | null;
  requestFingerprint: string | null;
  createdBy: Uuid | null;
}

export async function insertInvoiceDraft(tx: Tx, tenantId: string, inv: NewInvoice): Promise<InvoiceRecord> {
  const row = await tx.queryOne(
    `INSERT INTO finance.invoices
       (id, tenant_id, status, learner_id, enrollment_id, academic_year, group_key, group_label, institution_id, campus_id,
        funding_type, payer_kind, payer_ref, related_group_id, currency, subtotal_amount, discount_amount,
        scholarship_amount, total_amount, due_date, idempotency_key, request_fingerprint, created_by)
     VALUES ($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING ${INVOICE_COLS}`,
    [
      inv.id,
      tenantId,
      inv.learnerId,
      inv.enrollmentId,
      inv.academicYear,
      inv.groupKey,
      inv.groupLabel,
      inv.institutionId,
      inv.campusId,
      inv.fundingType,
      inv.payerKind,
      inv.payerRef,
      inv.relatedGroupId,
      inv.currency,
      inv.subtotal.amount,
      inv.discount.amount,
      inv.scholarship.amount,
      inv.total.amount,
      inv.dueDate,
      inv.idempotencyKey,
      inv.requestFingerprint,
      inv.createdBy,
    ],
  );
  return invoiceOf(row);
}

export async function insertInvoiceLines(tx: Tx, tenantId: string, invoiceId: Uuid, lines: ReadonlyArray<InvoiceLine>): Promise<void> {
  for (const l of lines) {
    await tx.query(
      `INSERT INTO finance.invoice_lines
         (id, tenant_id, invoice_id, position, fee_id, category, description, quantity, unit_amount, gross_amount,
          discount_amount, scholarship_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        l.id,
        tenantId,
        invoiceId,
        l.position,
        l.feeId,
        l.category,
        l.description,
        l.quantity,
        l.unitAmount.amount,
        l.gross.amount,
        l.discount.amount,
        l.scholarship.amount,
        l.total.amount,
      ],
    );
  }
}

export async function insertInvoiceDiscounts(
  tx: Tx,
  tenantId: string,
  invoiceId: Uuid,
  rows: ReadonlyArray<{ id: Uuid; discountId: Uuid; amount: Money }>,
): Promise<void> {
  for (const r of rows) {
    await tx.query(
      "INSERT INTO finance.invoice_discounts (id, tenant_id, invoice_id, discount_id, amount) VALUES ($1,$2,$3,$4,$5)",
      [r.id, tenantId, invoiceId, r.discountId, r.amount.amount],
    );
  }
}

export async function insertInstallments(
  tx: Tx,
  tenantId: string,
  invoiceId: Uuid,
  rows: ReadonlyArray<GeneratedInstallment & { id: Uuid }>,
): Promise<void> {
  for (const r of rows) {
    await tx.query(
      `INSERT INTO finance.installments (id, tenant_id, invoice_id, seq, label, due_date, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.id, tenantId, invoiceId, r.seq, r.label, r.dueDate, r.amount.amount],
    );
  }
}

export async function deleteInstallments(tx: Tx, invoiceId: Uuid): Promise<void> {
  await tx.query("DELETE FROM finance.installments WHERE invoice_id = $1", [invoiceId]);
}

export async function getInvoice(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<InvoiceRecord | null> {
  const row = await tx.queryOne(`SELECT ${INVOICE_COLS} FROM finance.invoices WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? invoiceOf(row) : null;
}

export async function getInvoiceByIdempotencyKey(tx: Tx, key: string): Promise<InvoiceRecord | null> {
  const row = await tx.queryOne(`SELECT ${INVOICE_COLS} FROM finance.invoices WHERE idempotency_key = $1`, [key]);
  return row ? invoiceOf(row) : null;
}

export async function listInvoicesByGroup(tx: Tx, relatedGroupId: Uuid): Promise<InvoiceRecord[]> {
  const rows = await tx.many(
    `SELECT ${INVOICE_COLS} FROM finance.invoices WHERE related_group_id = $1 ORDER BY payer_kind, created_at, id`,
    [relatedGroupId],
  );
  return rows.map(invoiceOf);
}

/** Verrouille les factures (ordre d'identifiant : pas d'interblocage entre transactions concurrentes). */
export async function lockInvoices(tx: Tx, ids: readonly Uuid[]): Promise<InvoiceRecord[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(
    `SELECT ${INVOICE_COLS} FROM finance.invoices WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [[...new Set(ids)]],
  );
  return rows.map(invoiceOf);
}

export async function getInvoiceLines(tx: Tx, invoiceId: Uuid): Promise<InvoiceLine[]> {
  const rows = await tx.many(
    `SELECT l.id, l.position, l.fee_id, l.category, l.description, l.quantity, inv.currency,
            l.unit_amount::text AS unit_amount, l.gross_amount::text AS gross_amount,
            l.discount_amount::text AS discount_amount, l.scholarship_amount::text AS scholarship_amount,
            l.total_amount::text AS total_amount
       FROM finance.invoice_lines l JOIN finance.invoices inv ON inv.id = l.invoice_id
      WHERE l.invoice_id = $1 ORDER BY l.position`,
    [invoiceId],
  );
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    feeId: r.fee_id,
    category: r.category,
    description: r.description,
    quantity: r.quantity,
    unitAmount: money(r.unit_amount, r.currency),
    gross: money(r.gross_amount, r.currency),
    discount: money(r.discount_amount, r.currency),
    scholarship: money(r.scholarship_amount, r.currency),
    total: money(r.total_amount, r.currency),
  }));
}

const INSTALLMENT_COLS = `i.id, i.invoice_id, i.seq, i.label, i.due_date::text AS due_date, i.amount::text AS amount,
  i.paid_amount::text AS paid_amount, i.credited_amount::text AS credited_amount, inv.currency`;

export const installmentOf = (r: any): Installment => ({
  id: r.id,
  invoiceId: r.invoice_id,
  seq: r.seq,
  label: r.label,
  dueDate: r.due_date,
  amount: money(r.amount, r.currency),
  paid: money(r.paid_amount, r.currency),
  credited: money(r.credited_amount, r.currency),
});

export async function getInstallments(tx: Tx, invoiceId: Uuid, options: { forUpdate?: boolean } = {}): Promise<Installment[]> {
  const rows = await tx.many(
    `SELECT ${INSTALLMENT_COLS} FROM finance.installments i JOIN finance.invoices inv ON inv.id = i.invoice_id
      WHERE i.invoice_id = $1 ORDER BY i.seq${options.forUpdate ? " FOR UPDATE OF i" : ""}`,
    [invoiceId],
  );
  return rows.map(installmentOf);
}

export async function getInstallmentsByIds(tx: Tx, ids: readonly Uuid[]): Promise<Installment[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(
    `SELECT ${INSTALLMENT_COLS} FROM finance.installments i JOIN finance.invoices inv ON inv.id = i.invoice_id
      WHERE i.id = ANY($1::uuid[]) ORDER BY i.invoice_id, i.seq`,
    [[...new Set(ids)]],
  );
  return rows.map(installmentOf);
}

export async function getInvoiceDiscounts(tx: Tx, invoiceId: Uuid): Promise<Array<{ discountId: Uuid; amount: Money }>> {
  const rows = await tx.many(
    `SELECT d.discount_id, d.amount::text AS amount, i.currency
       FROM finance.invoice_discounts d JOIN finance.invoices i ON i.id = d.invoice_id
      WHERE d.invoice_id = $1 ORDER BY d.created_at, d.id`,
    [invoiceId],
  );
  return rows.map((r) => ({ discountId: r.discount_id, amount: money(r.amount, r.currency) }));
}

export async function getInvoiceDetail(tx: Tx, id: Uuid): Promise<InvoiceDetail | null> {
  const invoice = await getInvoice(tx, id);
  if (!invoice) return null;
  const [lines, installments, discounts] = await Promise.all([
    getInvoiceLines(tx, id),
    getInstallments(tx, id),
    getInvoiceDiscounts(tx, id),
  ]);
  return {
    invoice,
    lines,
    installments,
    discounts,
    balance: invoiceBalance({ total: invoice.total, paid: invoice.paid, credited: invoice.credited }),
  };
}

export async function markInvoiceIssued(
  tx: Tx,
  id: Uuid,
  issue: { number: string; year: number; seq: number; issuedAt: Date; dueDate: IsoDate },
): Promise<InvoiceRecord> {
  const row = await tx.queryOne(
    `UPDATE finance.invoices
        SET status = 'ISSUED', number = $2, number_year = $3, number_seq = $4, issued_at = $5, due_date = $6, updated_at = now()
      WHERE id = $1 AND status = 'DRAFT' RETURNING ${INVOICE_COLS}`,
    [id, issue.number, issue.year, issue.seq, issue.issuedAt, issue.dueDate],
  );
  if (!row) throw new Error("markInvoiceIssued : la facture n'est pas un brouillon.");
  return invoiceOf(row);
}

export async function updateInvoiceStatus(tx: Tx, id: Uuid, status: InvoiceStatus): Promise<void> {
  await tx.query("UPDATE finance.invoices SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
}

export async function updateInvoiceDueDate(tx: Tx, id: Uuid, dueDate: IsoDate): Promise<void> {
  await tx.query("UPDATE finance.invoices SET due_date = $2, updated_at = now() WHERE id = $1", [id, dueDate]);
}

/** Variation (signée) des cumuls d'une facture ; les CHECK de la base bornent le résultat. */
export async function addInvoiceCumuls(tx: Tx, id: Uuid, delta: { paid?: Money; credited?: Money }): Promise<void> {
  await tx.query(
    `UPDATE finance.invoices
        SET paid_amount = paid_amount + $2::bigint, credited_amount = credited_amount + $3::bigint, updated_at = now()
      WHERE id = $1`,
    [id, delta.paid?.amount ?? 0, delta.credited?.amount ?? 0],
  );
}

export async function addInstallmentCumuls(tx: Tx, id: Uuid, delta: { paid?: Money; credited?: Money }): Promise<void> {
  await tx.query(
    `UPDATE finance.installments
        SET paid_amount = paid_amount + $2::bigint, credited_amount = credited_amount + $3::bigint, updated_at = now()
      WHERE id = $1`,
    [id, delta.paid?.amount ?? 0, delta.credited?.amount ?? 0],
  );
}

export async function cancelInvoiceRow(tx: Tx, id: Uuid, reason: string, at: Date): Promise<void> {
  await tx.query(
    "UPDATE finance.invoices SET status = 'CANCELLED', cancelled_at = $2, cancel_reason = $3, updated_at = now() WHERE id = $1",
    [id, at, reason],
  );
}

/**
 * Échéances ouvertes (reste dû > 0) des factures encaissables d'un payeur, verrouillées
 * (factures d'abord, par identifiant, puis échéances) pour sérialiser les imputations
 * concurrentes. Renvoie les cibles d'imputation.
 */
export async function lockOpenTargets(
  tx: Tx,
  filter: { learnerId: Uuid; payerKind: PayerKind; payerRef: string | null; invoiceIds?: readonly Uuid[]; currency: CurrencyCode },
): Promise<{ invoices: InvoiceRecord[]; targets: AllocationTarget[] }> {
  const invRows = await tx.many(
    `SELECT ${INVOICE_COLS} FROM finance.invoices
      WHERE learner_id = $1 AND payer_kind = $2 AND payer_ref IS NOT DISTINCT FROM $3 AND currency = $4
        AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
        AND ($5::uuid[] IS NULL OR id = ANY($5::uuid[]))
      ORDER BY id FOR UPDATE`,
    [filter.learnerId, filter.payerKind, filter.payerRef, filter.currency, filter.invoiceIds ? [...filter.invoiceIds] : null],
  );
  const invoices = invRows.map(invoiceOf);
  if (invoices.length === 0) return { invoices, targets: [] };
  const rows = await tx.many(
    `SELECT ${INSTALLMENT_COLS}, inv.issued_at
       FROM finance.installments i JOIN finance.invoices inv ON inv.id = i.invoice_id
      WHERE i.invoice_id = ANY($1::uuid[]) AND i.paid_amount + i.credited_amount < i.amount
      ORDER BY i.due_date, inv.issued_at, i.seq, i.id
        FOR UPDATE OF i`,
    [invoices.map((i) => i.id)],
  );
  const targets: AllocationTarget[] = rows.map((r) => {
    const inst = installmentOf(r);
    return {
      invoiceId: inst.invoiceId,
      installmentId: inst.id,
      dueDate: inst.dueDate,
      seq: inst.seq,
      invoiceIssuedAt: (r.issued_at as Date).toISOString(),
      remaining: inst.amount.subtract(inst.paid).subtract(inst.credited),
    };
  });
  return { invoices, targets };
}

export interface InvoiceListFilter {
  learnerId?: Uuid;
  academicYear?: string;
  status?: InvoiceStatus;
  groupKey?: string;
  payerKind?: PayerKind;
  limit: number;
  offset: number;
}

export async function listInvoices(tx: Tx, f: InvoiceListFilter): Promise<{ items: InvoiceRecord[]; total: number }> {
  const params = [f.learnerId ?? null, f.academicYear ?? null, f.status ?? null, f.groupKey ?? null, f.payerKind ?? null];
  const where = `($1::uuid IS NULL OR learner_id = $1) AND ($2::text IS NULL OR academic_year = $2)
                 AND ($3::text IS NULL OR status = $3) AND ($4::text IS NULL OR group_key = $4)
                 AND ($5::text IS NULL OR payer_kind = $5)`;
  const rows = await tx.many(
    `SELECT ${INVOICE_COLS} FROM finance.invoices WHERE ${where}
      ORDER BY created_at DESC, id DESC LIMIT $6 OFFSET $7`,
    [...params, f.limit, f.offset],
  );
  const count = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM finance.invoices WHERE ${where}`, params);
  return { items: rows.map(invoiceOf), total: Number(count?.n ?? 0) };
}

/** Factures actives dont une échéance est échue à `asOf` avec un reste dû (candidates à OVERDUE). */
export async function findOverdueCandidates(tx: Tx, asOf: IsoDate, limit = 500): Promise<InvoiceRecord[]> {
  const rows = await tx.many(
    `SELECT ${INVOICE_COLS} FROM finance.invoices inv
      WHERE inv.status IN ('ISSUED','PARTIALLY_PAID')
        AND EXISTS (SELECT 1 FROM finance.installments i
                     WHERE i.invoice_id = inv.id AND i.due_date < $1::date AND i.paid_amount + i.credited_amount < i.amount)
      ORDER BY inv.id LIMIT $2 FOR UPDATE OF inv SKIP LOCKED`,
    [asOf, limit],
  );
  return rows.map(invoiceOf);
}
