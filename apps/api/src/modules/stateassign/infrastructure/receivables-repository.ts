/**
 * Dépôt des créances sur l'État : échéances, historique, agrégats (retard, ancienneté, totaux).
 *
 * Le retard est DÉRIVÉ à la date de lecture : échéance + jours de grâce de l'établissement (`settings`, 0 par défaut)
 * < date du jour, et reste à recevoir > 0. La base calcule le STATUT depuis les montants (2303) ; ces fonctions n'écrivent
 * jamais de statut, seulement le montant reçu (rapprochement) et le marqueur d'alerte.
 */
import type { Tx } from "@ecoledigitale/database";
import { Money } from "@ecoledigitale/kernel";
import { translating } from "./db-errors";
import { RECEIVABLE_COLS, RECEIVABLE_EVENT_COLS, receivableEventOf, receivableOf } from "./rows";
import type { IsoDate, ReceivableEventRecord, ReceivableRecord, ReceivableStatus, Uuid } from "../domain/types";

const COLS_WITH_CONTEXT = `${RECEIVABLE_COLS},
  coalesce(s.receivable_grace_days, 0) AS "graceDays",
  (SELECT b.assignment_reference FROM stateassign.assignments b WHERE b.tenant_id = r.tenant_id AND b.enrollment_id = r.enrollment_id
     AND b.status IN ('RECEIVED','VERIFIED','ACTIVE','SUSPENDED','ENDED','TRANSFERRED') ORDER BY b.version DESC LIMIT 1) AS "assignmentReference"`;

const FROM_CONTEXT = `stateassign.receivables r
  LEFT JOIN stateassign.settings s ON s.tenant_id = r.tenant_id AND s.institution_id = r.institution_id`;

export interface ReceivableRow {
  readonly receivable: ReceivableRecord;
  readonly graceDays: number;
  readonly assignmentReference: string | null;
}

const rowOf = (r: Record<string, any>): ReceivableRow => ({ receivable: receivableOf(r), graceDays: Number(r.graceDays), assignmentReference: r.assignmentReference });

export async function insertReceivable(
  tx: Tx,
  tenantId: Uuid,
  r: { id: Uuid; assignmentId: Uuid; institutionId: Uuid; academicYearId: Uuid; enrollmentId: Uuid; studentId: Uuid; label: string; dueOn: IsoDate; expected: Money; createdBy: Uuid },
): Promise<ReceivableRecord> {
  return translating(async () => {
    // `seq`, `status`, `received_amount`, `created_by` sont posés par la garde de la base (2303).
    await tx.query(
      `INSERT INTO stateassign.receivables (id, tenant_id, assignment_id, institution_id, academic_year_id, enrollment_id, student_id, seq, label, due_on, expected_amount, currency, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)`,
      [r.id, tenantId, r.assignmentId, r.institutionId, r.academicYearId, r.enrollmentId, r.studentId, r.label, r.dueOn, r.expected.amount, r.expected.currency, r.createdBy],
    );
    return (await getReceivable(tx, r.id))!.receivable;
  });
}

export async function getReceivable(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<ReceivableRow | null> {
  const row = await tx.queryOne(`SELECT ${COLS_WITH_CONTEXT} FROM ${FROM_CONTEXT} WHERE r.id = $1${options.forUpdate ? " FOR UPDATE OF r" : ""}`, [id]);
  return row ? rowOf(row) : null;
}

export async function listReceivablesOfEnrollment(tx: Tx, enrollmentId: Uuid): Promise<ReceivableRow[]> {
  const rows = await tx.many(`SELECT ${COLS_WITH_CONTEXT} FROM ${FROM_CONTEXT} WHERE r.enrollment_id = $1 ORDER BY r.due_on, r.seq`, [enrollmentId]);
  return rows.map(rowOf);
}

export interface ReceivableFilter {
  institutionId?: Uuid | undefined;
  academicYearId?: Uuid | undefined;
  studentId?: Uuid | undefined;
  assignmentId?: Uuid | undefined;
  enrollmentId?: Uuid | undefined;
  status?: ReceivableStatus | undefined;
  overdueOnly?: boolean | undefined;
  dueFrom?: IsoDate | undefined;
  dueTo?: IsoDate | undefined;
  asOf: IsoDate;
  limit: number;
  offset: number;
}

const WHERE = `($1::uuid IS NULL OR r.institution_id = $1) AND ($2::uuid IS NULL OR r.academic_year_id = $2)
  AND ($3::uuid IS NULL OR r.student_id = $3) AND ($4::uuid IS NULL OR r.assignment_id = $4) AND ($5::uuid IS NULL OR r.enrollment_id = $5)
  AND ($6::text IS NULL OR r.status = $6) AND ($7::date IS NULL OR r.due_on >= $7) AND ($8::date IS NULL OR r.due_on <= $8)
  AND (NOT $9::boolean OR (r.status IN ('OPEN','PARTIALLY_RECEIVED') AND r.due_on + coalesce(s.receivable_grace_days, 0) < $10::date))`;

const params = (f: ReceivableFilter): unknown[] => [
  f.institutionId ?? null, f.academicYearId ?? null, f.studentId ?? null, f.assignmentId ?? null, f.enrollmentId ?? null, f.status ?? null,
  f.dueFrom ?? null, f.dueTo ?? null, f.overdueOnly === true, f.asOf,
];

export async function listReceivables(tx: Tx, f: ReceivableFilter): Promise<{ items: ReceivableRow[]; total: number }> {
  const p = params(f);
  const rows = await tx.many(`SELECT ${COLS_WITH_CONTEXT} FROM ${FROM_CONTEXT} WHERE ${WHERE} ORDER BY r.due_on, r.seq, r.id LIMIT $11 OFFSET $12`, [...p, f.limit, f.offset]);
  const count = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM ${FROM_CONTEXT} WHERE ${WHERE}`, p);
  return { items: rows.map(rowOf), total: Number(count?.n ?? 0) };
}

export async function patchReceivable(
  tx: Tx,
  id: Uuid,
  patch: { label?: string; dueOn?: IsoDate; expected?: Money },
  expectedRowVersion: number | null,
): Promise<boolean> {
  const sets: string[] = [];
  const p: unknown[] = [id, expectedRowVersion];
  const add = (col: string, v: unknown): void => {
    p.push(v);
    sets.push(`${col} = $${p.length}`);
  };
  if (patch.label !== undefined) add("label", patch.label);
  if (patch.dueOn !== undefined) add("due_on", patch.dueOn);
  if (patch.expected !== undefined) add("expected_amount", patch.expected.amount);
  if (sets.length === 0) return true;
  return translating(async () => {
    const r = await tx.query(`UPDATE stateassign.receivables SET ${sets.join(", ")} WHERE id = $1 AND ($2::int IS NULL OR row_version = $2)`, p);
    return r.rowCount === 1;
  });
}

export async function cancelReceivable(tx: Tx, id: Uuid, reason: string, expectedRowVersion: number | null): Promise<boolean> {
  return translating(async () => {
    const r = await tx.query(
      `UPDATE stateassign.receivables SET status = 'CANCELLED', cancel_reason = $3 WHERE id = $1 AND ($2::int IS NULL OR row_version = $2)`,
      [id, expectedRowVersion, reason],
    );
    return r.rowCount === 1;
  });
}

/** Montant reçu rapproché (la base recalcule le statut). N'écrit rien si le montant ne change pas. */
export async function applyReceived(tx: Tx, id: Uuid, received: Money): Promise<boolean> {
  return translating(async () => {
    const r = await tx.query(
      `UPDATE stateassign.receivables SET received_amount = $2, last_reconciled_at = now()
        WHERE id = $1 AND status <> 'CANCELLED' AND (received_amount <> $2 OR last_reconciled_at IS NULL)`,
      [id, received.amount],
    );
    return r.rowCount === 1;
  });
}

export async function flagOverdue(tx: Tx, id: Uuid): Promise<boolean> {
  const r = await tx.query(`UPDATE stateassign.receivables SET overdue_flagged_at = now() WHERE id = $1 AND overdue_flagged_at IS NULL AND status IN ('OPEN','PARTIALLY_RECEIVED')`, [id]);
  return r.rowCount === 1;
}

/** Échéances en retard jamais signalées (job). */
export async function listOverdueUnflagged(tx: Tx, asOf: IsoDate, limit: number): Promise<ReceivableRow[]> {
  const rows = await tx.many(
    `SELECT ${COLS_WITH_CONTEXT} FROM ${FROM_CONTEXT}
      WHERE r.status IN ('OPEN','PARTIALLY_RECEIVED') AND r.overdue_flagged_at IS NULL AND r.due_on + coalesce(s.receivable_grace_days, 0) < $1::date
      ORDER BY r.due_on, r.id LIMIT $2`,
    [asOf, limit],
  );
  return rows.map(rowOf);
}

export async function listReceivableEvents(tx: Tx, receivableIds: readonly Uuid[], currency: string): Promise<ReceivableEventRecord[]> {
  if (receivableIds.length === 0) return [];
  const rows = await tx.many(
    `SELECT ${RECEIVABLE_EVENT_COLS} FROM stateassign.receivable_events e WHERE e.receivable_id = ANY($1::uuid[]) ORDER BY e.occurred_at, e.id`,
    [[...receivableIds]],
  );
  return rows.map((r) => receivableEventOf(r, currency));
}

// ---------------------------------------------------------------------------
// Agrégats
// ---------------------------------------------------------------------------

export interface AgingRow {
  readonly bucket: "NOT_DUE" | "D1_30" | "D31_60" | "D61_90" | "D91_PLUS";
  readonly count: number;
  readonly outstanding: number;
}

export interface ReceivableTotals {
  readonly expected: number;
  readonly received: number;
  readonly outstanding: number;
  readonly overdue: number;
  readonly receivables: number;
  readonly overdueReceivables: number;
}

/** Ancienneté du reste à recevoir (échéances non annulées avec un reste), tranches calculées en SQL à la date `asOf`. */
export async function aging(tx: Tx, f: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined; asOf: IsoDate }): Promise<{ rows: AgingRow[]; totals: ReceivableTotals; currency: string }> {
  const base = `FROM stateassign.receivables r LEFT JOIN stateassign.settings s ON s.tenant_id = r.tenant_id AND s.institution_id = r.institution_id
    WHERE r.status <> 'CANCELLED' AND ($1::uuid IS NULL OR r.institution_id = $1) AND ($2::uuid IS NULL OR r.academic_year_id = $2)`;
  const p = [f.institutionId ?? null, f.academicYearId ?? null, f.asOf];
  const rows = await tx.many<{ bucket: AgingRow["bucket"]; count: string; outstanding: string }>(
    `SELECT CASE WHEN d <= 0 THEN 'NOT_DUE' WHEN d <= 30 THEN 'D1_30' WHEN d <= 60 THEN 'D31_60' WHEN d <= 90 THEN 'D61_90' ELSE 'D91_PLUS' END AS bucket,
            count(*)::text AS count, coalesce(sum(out), 0)::text AS outstanding
       FROM (SELECT ($3::date - r.due_on - coalesce(s.receivable_grace_days, 0)) AS d, (r.expected_amount - r.received_amount) AS out ${base}
               AND r.expected_amount > r.received_amount) x GROUP BY 1`,
    p,
  );
  const t = await tx.queryOne<{ expected: string; received: string; outstanding: string; overdue: string; receivables: string; overdue_n: string; currency: string | null }>(
    `SELECT coalesce(sum(r.expected_amount), 0)::text AS expected, coalesce(sum(r.received_amount), 0)::text AS received,
            coalesce(sum(r.expected_amount - r.received_amount), 0)::text AS outstanding,
            coalesce(sum(r.expected_amount - r.received_amount) FILTER (WHERE r.expected_amount > r.received_amount AND r.due_on + coalesce(s.receivable_grace_days, 0) < $3::date), 0)::text AS overdue,
            count(*)::text AS receivables,
            (count(*) FILTER (WHERE r.expected_amount > r.received_amount AND r.due_on + coalesce(s.receivable_grace_days, 0) < $3::date))::text AS overdue_n,
            min(r.currency) AS currency ${base}`,
    p,
  );
  return {
    rows: rows.map((r) => ({ bucket: r.bucket, count: Number(r.count), outstanding: Number(r.outstanding) })),
    totals: {
      expected: Number(t?.expected ?? 0),
      received: Number(t?.received ?? 0),
      outstanding: Number(t?.outstanding ?? 0),
      overdue: Number(t?.overdue ?? 0),
      receivables: Number(t?.receivables ?? 0),
      overdueReceivables: Number(t?.overdue_n ?? 0),
    },
    currency: t?.currency ?? "XOF",
  };
}
