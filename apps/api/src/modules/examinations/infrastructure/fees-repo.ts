/**
 * Dépôt SQL des frais d'examen : barème (`exam_fee_items`) et obligation par candidat (`candidate_fees`). SQL paramétré uniquement.
 */
import type { Tx } from "@ecoledigitale/database";
import type { CandidateKind } from "../domain/types";
import type { CandidateFeeRow, FeeAppliesTo, FeeItemRow, FeeLine, FeeStatus } from "../domain/fees";

interface ItemSql { id: string; exam_type_id: string; fee_id: string; applies_to: FeeAppliesTo; active: boolean; created_at: Date }
const toItem = (r: ItemSql): FeeItemRow => ({ id: r.id, examTypeId: r.exam_type_id, feeId: r.fee_id, appliesTo: r.applies_to, active: r.active, createdAt: r.created_at });
const ITEM_COLS = "id, exam_type_id, fee_id, applies_to, active, created_at";

export async function listFeeItems(tx: Tx, examTypeId: string, options: { activeOnly?: boolean } = {}): Promise<FeeItemRow[]> {
  return (await tx.many<ItemSql>(`SELECT ${ITEM_COLS} FROM examinations.exam_fee_items WHERE exam_type_id = $1${options.activeOnly ? " AND active" : ""} ORDER BY created_at, id`, [examTypeId])).map(toItem);
}

export async function upsertFeeItem(tx: Tx, tenantId: string, i: { id: string; examTypeId: string; feeId: string; appliesTo: FeeAppliesTo; active: boolean; createdBy: string | null }): Promise<FeeItemRow> {
  const r = await tx.queryOne<ItemSql>(
    `INSERT INTO examinations.exam_fee_items (id, tenant_id, exam_type_id, fee_id, applies_to, active, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, exam_type_id, fee_id) DO UPDATE SET applies_to = EXCLUDED.applies_to, active = EXCLUDED.active, updated_at = now()
     RETURNING ${ITEM_COLS}`,
    [i.id, tenantId, i.examTypeId, i.feeId, i.appliesTo, i.active, i.createdBy],
  );
  return toItem(r as ItemSql);
}

interface FeeSql {
  id: string; session_id: string; candidate_id: string; status: FeeStatus; payer_kind: CandidateKind; currency: string | null; total_minor: string | null; lines: FeeLine[]; invoice_id: string | null;
  idempotency_key: string; last_error_code: string | null; note: string | null; refund_confirmed_by: string | null; refund_confirmed_at: Date | null; created_at: Date; updated_at: Date;
}
const FEE_COLS = `id, session_id, candidate_id, status, payer_kind, currency, total_minor::text AS total_minor, lines, invoice_id, idempotency_key, last_error_code, note,
  refund_confirmed_by, refund_confirmed_at, created_at, updated_at`;
const toFee = (r: FeeSql): CandidateFeeRow => ({
  id: r.id, sessionId: r.session_id, candidateId: r.candidate_id, status: r.status, payerKind: r.payer_kind, currency: r.currency, totalMinor: r.total_minor === null ? null : Number(r.total_minor),
  lines: r.lines, invoiceId: r.invoice_id, idempotencyKey: r.idempotency_key, lastErrorCode: r.last_error_code, note: r.note, refundConfirmedBy: r.refund_confirmed_by,
  refundConfirmedAt: r.refund_confirmed_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function getFeeOfCandidate(tx: Tx, candidateId: string, options: { forUpdate?: boolean } = {}): Promise<CandidateFeeRow | null> {
  const r = await tx.queryOne<FeeSql>(`SELECT ${FEE_COLS} FROM examinations.candidate_fees WHERE candidate_id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [candidateId]);
  return r ? toFee(r) : null;
}

/** Crée l'obligation d'un candidat (idempotent : une seule ligne par candidat). Rend la ligne existante si elle existe déjà. */
export async function insertFee(tx: Tx, tenantId: string, f: { id: string; sessionId: string; candidateId: string; status: "NOT_APPLICABLE" | "PENDING_INVOICE"; payerKind: CandidateKind; lines: FeeLine[]; idempotencyKey: string }): Promise<CandidateFeeRow> {
  await tx.query(
    `INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, lines, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (tenant_id, candidate_id) DO NOTHING`,
    [f.id, tenantId, f.sessionId, f.candidateId, f.status, f.payerKind, JSON.stringify(f.lines), f.idempotencyKey],
  );
  return (await getFeeOfCandidate(tx, f.candidateId)) as CandidateFeeRow;
}

export interface FeePatch {
  status?: FeeStatus;
  currency?: string | null;
  totalMinor?: number | null;
  lines?: FeeLine[];
  invoiceId?: string | null;
  lastErrorCode?: string | null;
  note?: string | null;
  refundConfirmedBy?: string | null;
  refundConfirmedAt?: Date | null;
}

export async function patchFee(tx: Tx, candidateId: string, p: FeePatch): Promise<CandidateFeeRow> {
  const sets: string[] = [];
  const params: unknown[] = [candidateId];
  const add = (col: string, value: unknown, cast = ""): void => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (p.status !== undefined) add("status", p.status);
  if (p.currency !== undefined) add("currency", p.currency);
  if (p.totalMinor !== undefined) add("total_minor", p.totalMinor);
  if (p.lines !== undefined) add("lines", JSON.stringify(p.lines), "::jsonb");
  if (p.invoiceId !== undefined) add("invoice_id", p.invoiceId);
  if (p.lastErrorCode !== undefined) add("last_error_code", p.lastErrorCode);
  if (p.note !== undefined) add("note", p.note);
  if (p.refundConfirmedBy !== undefined) add("refund_confirmed_by", p.refundConfirmedBy);
  if (p.refundConfirmedAt !== undefined) add("refund_confirmed_at", p.refundConfirmedAt);
  if (sets.length === 0) return (await getFeeOfCandidate(tx, candidateId)) as CandidateFeeRow;
  await tx.query(`UPDATE examinations.candidate_fees SET ${sets.join(", ")} WHERE candidate_id = $1`, params);
  return (await getFeeOfCandidate(tx, candidateId)) as CandidateFeeRow;
}

/** Obligations d'une session à rejouer (facturation en attente) ou à solder (candidats retirés encore facturés). */
export async function listFeesToSettle(tx: Tx, sessionId: string, limit: number): Promise<Array<{ candidateId: string; status: FeeStatus; registrationStatus: string }>> {
  const rows = await tx.many<{ candidate_id: string; status: FeeStatus; registration_status: string }>(
    `SELECT f.candidate_id, f.status, c.registration_status FROM examinations.candidate_fees f
       JOIN examinations.candidates c ON c.tenant_id = f.tenant_id AND c.id = f.candidate_id
      WHERE f.session_id = $1 AND ((f.status = 'PENDING_INVOICE' AND c.registration_status <> 'WITHDRAWN')
         OR (c.registration_status = 'WITHDRAWN' AND f.status IN ('PENDING_INVOICE', 'INVOICED', 'AWAITING_MANUAL_INVOICE')))
      ORDER BY f.created_at, f.id LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map((r) => ({ candidateId: r.candidate_id, status: r.status, registrationStatus: r.registration_status }));
}

export async function countFeesByStatus(tx: Tx, sessionId: string): Promise<Record<string, number>> {
  const rows = await tx.many<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM examinations.candidate_fees WHERE session_id = $1 GROUP BY status`, [sessionId]);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
