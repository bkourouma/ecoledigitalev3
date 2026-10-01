/** Bulletins, lignes, réclamations (heures et jours de salaire), ajustements, journal, comptes rendus de calcul. */
import type { Tx } from "@ecoledigitale/database";
import type { CurrencyCode } from "@ecoledigitale/kernel";
import type { CalcDetails } from "../domain/calculation";
import type {
  AdjustmentRecord,
  CalculationRunItemRecord,
  CalculationRunRecord,
  PayslipEventRecord,
  PayslipLineRecord,
  PayslipRecord,
  RunOutcome,
  RunScope,
} from "../domain/records";
import type { AdjustmentKind, HourSourceKind, IsoDate, PaymentMethod, PayslipLineDraft, PayslipStatus, SkipReason, Uuid } from "../domain/types";
import {
  ADJUSTMENT_COLUMNS,
  LINE_COLUMNS,
  PAYSLIP_COLUMNS,
  RUN_COLUMNS,
  RUN_ITEM_COLUMNS,
  bulkInsert,
  toAdjustment,
  toEvent,
  toLine,
  toPayslip,
  toRun,
  toRunItem,
  type Row,
} from "./rows";

// ---------------------------------------------------------------------------
// Bulletins
// ---------------------------------------------------------------------------

export async function getPayslip(tx: Tx, id: Uuid, opts: { forUpdate?: boolean } = {}): Promise<PayslipRecord | null> {
  const r = await tx.queryOne<Row>(`SELECT ${PAYSLIP_COLUMNS} FROM payroll.payslips p WHERE p.id = $1${opts.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? toPayslip(r) : null;
}

export async function getPayslipsByIds(tx: Tx, ids: readonly Uuid[], opts: { forUpdate?: boolean } = {}): Promise<PayslipRecord[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many<Row>(`SELECT ${PAYSLIP_COLUMNS} FROM payroll.payslips p WHERE p.id = ANY($1::uuid[]) ORDER BY p.id${opts.forUpdate ? " FOR UPDATE" : ""}`, [[...ids]]);
  return rows.map(toPayslip);
}

/** Bulletins non annulés d'une période (clé : enseignant). */
export async function liveByPeriod(tx: Tx, periodId: Uuid, staffIds: readonly Uuid[] | null): Promise<Map<Uuid, PayslipRecord>> {
  const rows = await tx.many<Row>(
    `SELECT ${PAYSLIP_COLUMNS} FROM payroll.payslips p WHERE p.period_id = $1 AND p.status <> 'CANCELLED' AND ($2::uuid[] IS NULL OR p.staff_id = ANY($2::uuid[]))`,
    [periodId, staffIds === null ? null : [...staffIds]],
  );
  return new Map(rows.map((r) => [r.staff_id as string, toPayslip(r)]));
}

export async function liveForStaffPeriod(tx: Tx, periodId: Uuid, staffId: Uuid, opts: { forUpdate?: boolean } = {}): Promise<PayslipRecord | null> {
  const r = await tx.queryOne<Row>(
    `SELECT ${PAYSLIP_COLUMNS} FROM payroll.payslips p WHERE p.period_id = $1 AND p.staff_id = $2 AND p.status <> 'CANCELLED'${opts.forUpdate ? " FOR UPDATE" : ""}`,
    [periodId, staffId],
  );
  return r ? toPayslip(r) : null;
}

export async function latestCancelledId(tx: Tx, periodId: Uuid, staffId: Uuid): Promise<Uuid | null> {
  const r = await tx.queryOne<Row>("SELECT id FROM payroll.payslips WHERE period_id = $1 AND staff_id = $2 AND status = 'CANCELLED' ORDER BY cancelled_at DESC, id DESC LIMIT 1", [periodId, staffId]);
  return r ? (r.id as string) : null;
}

export interface PayslipAmounts {
  kind: PayslipRecord["kind"];
  salary: number;
  base: number;
  overtime: number;
  bonus: number;
  deduction: number;
  total: number;
  currency: CurrencyCode;
  regularMinutes: number;
  overtimeMinutes: number;
  calcDetails: CalcDetails;
  configSnapshot: Record<string, unknown>;
  configId: Uuid;
  calculatedBy: Uuid;
  calculatedByName: string;
  calculatedAt: Date;
}

export async function insertPayslip(tx: Tx, id: Uuid, tenantId: Uuid, periodId: Uuid, staffId: Uuid, a: PayslipAmounts, replacesPayslipId: Uuid | null): Promise<void> {
  await tx.query(
    `INSERT INTO payroll.payslips (id, tenant_id, period_id, staff_id, config_id, payslip_kind, salary_amount, base_amount, overtime_amount, bonus_amount, deduction_amount,
                                   total_amount, currency, regular_minutes, overtime_minutes, calc_details, config_snapshot, calculated_at, calculated_by, calculated_by_name,
                                   replaces_payslip_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9::bigint, $10::bigint, $11::bigint, $12::bigint, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20, $21)`,
    [
      id, tenantId, periodId, staffId, a.configId, a.kind, a.salary, a.base, a.overtime, a.bonus, a.deduction, a.total, a.currency, a.regularMinutes, a.overtimeMinutes,
      JSON.stringify(a.calcDetails), JSON.stringify(a.configSnapshot), a.calculatedAt, a.calculatedBy, a.calculatedByName, replacesPayslipId,
    ].map((v) => (typeof v === "number" && !Number.isSafeInteger(v) ? String(v) : v)),
  );
}

/** Recalcul d'un bulletin CALCULATED : réécrit montants et détail ; primes/retenues (bonus/deduction) sont REPRISES, jamais effacées. */
export async function updatePayslipCalculation(tx: Tx, id: Uuid, a: PayslipAmounts): Promise<void> {
  await tx.query(
    `UPDATE payroll.payslips SET config_id = $2, payslip_kind = $3, salary_amount = $4::bigint, base_amount = $5::bigint, overtime_amount = $6::bigint,
            bonus_amount = $7::bigint, deduction_amount = $8::bigint, total_amount = $9::bigint, currency = $10, regular_minutes = $11, overtime_minutes = $12,
            calc_details = $13::jsonb, config_snapshot = $14::jsonb, calculated_at = $15, calculated_by = $16, calculated_by_name = $17,
            row_version = row_version + 1, updated_at = $15
      WHERE id = $1`,
    [id, a.configId, a.kind, a.salary, a.base, a.overtime, a.bonus, a.deduction, a.total, a.currency, a.regularMinutes, a.overtimeMinutes, JSON.stringify(a.calcDetails), JSON.stringify(a.configSnapshot), a.calculatedAt, a.calculatedBy, a.calculatedByName],
  );
}

export async function setAdjustmentTotals(tx: Tx, id: Uuid, t: { bonus: number; deduction: number; total: number }, now: Date): Promise<void> {
  await tx.query("UPDATE payroll.payslips SET bonus_amount = $2::bigint, deduction_amount = $3::bigint, total_amount = $4::bigint, row_version = row_version + 1, updated_at = $5 WHERE id = $1", [id, t.bonus, t.deduction, t.total, now]);
}

export interface PayslipFilter {
  periodId?: Uuid | undefined;
  staffId?: Uuid | undefined;
  staffIds?: readonly Uuid[] | undefined;
  statuses?: readonly PayslipStatus[] | undefined;
  academicYearId?: Uuid | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  limit: number;
  offset: number;
  /** Arrêtés seulement (historique) : APPROVED, DISPUTED, PAID. */
  stopped?: boolean | undefined;
  order?: "period" | "approved";
}

function payslipWhere(f: PayslipFilter): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.periodId) where.push(`p.period_id = ${push(f.periodId)}`);
  if (f.staffId) where.push(`p.staff_id = ${push(f.staffId)}`);
  if (f.staffIds) where.push(`p.staff_id = ANY(${push([...f.staffIds])}::uuid[])`);
  if (f.statuses && f.statuses.length > 0) where.push(`p.status = ANY(${push([...f.statuses])}::text[])`);
  if (f.stopped) where.push("p.status IN ('APPROVED', 'DISPUTED', 'PAID')");
  if (f.academicYearId) where.push(`per.academic_year_id = ${push(f.academicYearId)}`);
  if (f.from) where.push(`per.end_date >= ${push(f.from)}::date`);
  if (f.to) where.push(`per.start_date <= ${push(f.to)}::date`);
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listPayslips(tx: Tx, f: PayslipFilter): Promise<{ items: PayslipRecord[]; total: number }> {
  const { clause, params } = payslipWhere(f);
  const from = "FROM payroll.payslips p JOIN payroll.pay_periods per ON per.id = p.period_id AND per.tenant_id = p.tenant_id";
  const total = Number((await tx.queryOne<Row>(`SELECT count(*)::int AS n ${from} ${clause}`, params))?.n ?? 0);
  const order = f.order === "approved" ? "p.approved_at DESC NULLS LAST, p.id" : "per.start_date DESC, p.staff_id, p.id";
  const rows = await tx.many<Row>(`SELECT ${PAYSLIP_COLUMNS} ${from} ${clause} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, f.limit, f.offset]);
  return { items: rows.map(toPayslip), total };
}

/** « Tout approuver / tout payer » : identifiants calculés CÔTÉ SERVEUR sur la période (jamais énumérés par l'écran). */
export async function idsByPeriodStatus(tx: Tx, periodId: Uuid, status: PayslipStatus): Promise<Uuid[]> {
  const rows = await tx.many<Row>("SELECT id FROM payroll.payslips WHERE period_id = $1 AND status = $2 ORDER BY id", [periodId, status]);
  return rows.map((r) => r.id as string);
}

// ---------------------------------------------------------------------------
// Transitions d'état (la base impose en plus la machine d'états)
// ---------------------------------------------------------------------------

export interface Actor {
  id: Uuid | null;
  name: string;
}

export async function markApproved(tx: Tx, id: Uuid, from: PayslipStatus, actor: Actor, now: Date, snapshot: unknown, snapshotHash: string | null): Promise<boolean> {
  const r = await tx.query(
    from === "CALCULATED"
      ? `UPDATE payroll.payslips SET status = 'APPROVED', approved_at = $3, approved_by = $4, approved_by_name = $5, snapshot = $6::jsonb, snapshot_hash = $7, row_version = row_version + 1, updated_at = $3
          WHERE id = $1 AND status = $2`
      : `UPDATE payroll.payslips SET status = 'APPROVED', approved_at = $3, approved_by = $4, approved_by_name = $5, row_version = row_version + 1, updated_at = $3
          WHERE id = $1 AND status = $2 AND $6::jsonb IS NULL AND $7::text IS NULL`,
    [id, from, now, actor.id, actor.name, snapshot === null ? null : JSON.stringify(snapshot), snapshotHash],
  );
  return r.rowCount > 0;
}

export async function markPaid(tx: Tx, id: Uuid, actor: Actor, now: Date, method: PaymentMethod, reference: string | null): Promise<boolean> {
  const r = await tx.query(
    `UPDATE payroll.payslips SET status = 'PAID', paid_at = $2, paid_by = $3, paid_by_name = $4, payment_method = $5, payment_reference = $6, row_version = row_version + 1, updated_at = $2
      WHERE id = $1 AND status = 'APPROVED'`,
    [id, now, actor.id, actor.name, method, reference],
  );
  return r.rowCount > 0;
}

export async function markDisputed(tx: Tx, id: Uuid, now: Date, reason: string): Promise<boolean> {
  const r = await tx.query("UPDATE payroll.payslips SET status = 'DISPUTED', disputed_at = $2, dispute_reason = $3, row_version = row_version + 1, updated_at = $2 WHERE id = $1 AND status = 'APPROVED'", [id, now, reason]);
  return r.rowCount > 0;
}

export async function markCancelled(tx: Tx, id: Uuid, from: PayslipStatus, actor: Actor, now: Date, reason: string): Promise<boolean> {
  const r = await tx.query(
    `UPDATE payroll.payslips SET status = 'CANCELLED', cancelled_at = $3, cancelled_by = $4, cancelled_by_name = $5, cancel_reason = $6, row_version = row_version + 1, updated_at = $3
      WHERE id = $1 AND status = $2`,
    [id, from, now, actor.id, actor.name, reason],
  );
  return r.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Lignes et réclamations
// ---------------------------------------------------------------------------

export async function insertLines(tx: Tx, tenantId: Uuid, payslipId: Uuid, lines: readonly PayslipLineDraft[], newId: () => string): Promise<void> {
  await bulkInsert(
    tx,
    "payroll.payslip_lines",
    ["id", "tenant_id", "payslip_id", "source_kind", "source_ref_id", "staff_id", "session_date", "start_time", "minutes", "rate", "multiplier_permille", "amount", "is_overtime", "rate_origin", "curriculum_node_id", "classroom_id", "label", "code", "classroom_label", "position"],
    lines.map((l) => [newId(), tenantId, payslipId, l.sourceKind, l.sourceRefId, l.staffId, l.sessionDate, l.startTime, l.minutes, String(l.rate.amount), l.multiplierPermille, String(l.amount.amount), l.isOvertime, l.rateOrigin, l.nodeId, l.classroomId, l.label, l.code, l.classroomLabel, l.position]),
    { session_date: "date", start_time: "time", rate: "bigint", amount: "bigint" },
  );
}

export async function deleteLines(tx: Tx, payslipId: Uuid): Promise<void> {
  await tx.query("DELETE FROM payroll.payslip_lines WHERE payslip_id = $1", [payslipId]);
}

export async function listLines(tx: Tx, payslipId: Uuid, currency: CurrencyCode): Promise<PayslipLineRecord[]> {
  const rows = await tx.many<Row>(`SELECT ${LINE_COLUMNS} FROM payroll.payslip_lines l WHERE l.payslip_id = $1 ORDER BY l.position, l.id`, [payslipId]);
  return rows.map((r) => toLine(r, currency));
}

export interface ClaimInsert {
  kind: HourSourceKind;
  refId: Uuid;
  staffId: Uuid;
  minutes: number;
}

export async function insertHourClaims(tx: Tx, tenantId: Uuid, payslipId: Uuid, claims: readonly ClaimInsert[]): Promise<void> {
  await bulkInsert(tx, "payroll.hour_claims", ["tenant_id", "source_kind", "source_ref_id", "staff_id", "payslip_id", "minutes"], claims.map((c) => [tenantId, c.kind, c.refId, c.staffId, payslipId, c.minutes]));
}

export async function deleteHourClaims(tx: Tx, payslipId: Uuid): Promise<void> {
  await tx.query("DELETE FROM payroll.hour_claims WHERE payslip_id = $1", [payslipId]);
}

/** Clés `origine|source|enseignant` DÉJÀ réclamées par un AUTRE bulletin (celui qu'on recalcule est exclu). */
export async function claimedElsewhere(tx: Tx, staffId: Uuid, hours: readonly { kind: HourSourceKind; refId: Uuid }[], exceptPayslipId: Uuid | null): Promise<Set<string>> {
  if (hours.length === 0) return new Set();
  const rows = await tx.many<Row>(
    `SELECT source_kind, source_ref_id FROM payroll.hour_claims
      WHERE staff_id = $1 AND source_ref_id = ANY($2::uuid[]) AND ($3::uuid IS NULL OR payslip_id <> $3::uuid)`,
    [staffId, hours.map((h) => h.refId), exceptPayslipId],
  );
  return new Set(rows.map((r) => `${r.source_kind}|${r.source_ref_id}|${staffId}`));
}

export async function insertSalaryDays(tx: Tx, tenantId: Uuid, payslipId: Uuid, staffId: Uuid, days: readonly IsoDate[]): Promise<void> {
  await bulkInsert(tx, "payroll.salary_day_claims", ["tenant_id", "staff_id", "work_date", "payslip_id"], days.map((d) => [tenantId, staffId, d, payslipId]), { work_date: "date" });
}

export async function deleteSalaryDays(tx: Tx, payslipId: Uuid): Promise<void> {
  await tx.query("DELETE FROM payroll.salary_day_claims WHERE payslip_id = $1", [payslipId]);
}

export async function salaryDaysClaimedElsewhere(tx: Tx, staffId: Uuid, from: IsoDate, to: IsoDate, exceptPayslipId: Uuid | null): Promise<Set<IsoDate>> {
  const rows = await tx.many<Row>(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS d FROM payroll.salary_day_claims
      WHERE staff_id = $1 AND work_date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR payslip_id <> $4::uuid)`,
    [staffId, from, to, exceptPayslipId],
  );
  return new Set(rows.map((r) => r.d as string));
}

// ---------------------------------------------------------------------------
// Ajustements (primes / retenues)
// ---------------------------------------------------------------------------

export async function listAdjustments(tx: Tx, payslipId: Uuid, currency: CurrencyCode): Promise<AdjustmentRecord[]> {
  const rows = await tx.many<Row>(`SELECT ${ADJUSTMENT_COLUMNS} FROM payroll.payslip_adjustments a WHERE a.payslip_id = $1 ORDER BY a.created_at, a.id`, [payslipId]);
  return rows.map((r) => toAdjustment(r, currency));
}

export async function sumAdjustments(tx: Tx, payslipId: Uuid): Promise<{ bonus: bigint; deduction: bigint }> {
  const r = await tx.queryOne<Row>(
    `SELECT coalesce(sum(amount) FILTER (WHERE kind = 'BONUS'), 0)::text AS bonus, coalesce(sum(amount) FILTER (WHERE kind = 'DEDUCTION'), 0)::text AS deduction
       FROM payroll.payslip_adjustments WHERE payslip_id = $1`,
    [payslipId],
  );
  return { bonus: BigInt(r?.bonus ?? "0"), deduction: BigInt(r?.deduction ?? "0") };
}

export async function insertAdjustment(tx: Tx, id: Uuid, tenantId: Uuid, payslipId: Uuid, a: { kind: AdjustmentKind; amount: number; label: string; reason: string | null }, actor: Actor & { id: Uuid }, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO payroll.payslip_adjustments (id, tenant_id, payslip_id, kind, amount, label, reason, created_by, created_by_name, created_at)
     VALUES ($1, $2, $3, $4, $5::bigint, $6, $7, $8, $9, $10)`,
    [id, tenantId, payslipId, a.kind, String(a.amount), a.label, a.reason, actor.id, actor.name, now],
  );
}

export async function deleteAdjustment(tx: Tx, payslipId: Uuid, adjustmentId: Uuid): Promise<boolean> {
  const r = await tx.query("DELETE FROM payroll.payslip_adjustments WHERE payslip_id = $1 AND id = $2", [payslipId, adjustmentId]);
  return r.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export async function insertEvent(
  tx: Tx,
  e: { id: Uuid; tenantId: Uuid; payslipId: Uuid; action: string; oldValues?: unknown; newValues?: unknown; reason?: string | null; actor: Actor; at: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO payroll.payslip_events (id, tenant_id, payslip_id, action, old_values, new_values, reason, actor_id, actor_name, occurred_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
    [e.id, e.tenantId, e.payslipId, e.action, e.oldValues === undefined ? null : JSON.stringify(e.oldValues), e.newValues === undefined ? null : JSON.stringify(e.newValues), e.reason ?? null, e.actor.id, e.actor.name, e.at],
  );
}

export async function listEvents(tx: Tx, payslipId: Uuid): Promise<PayslipEventRecord[]> {
  const rows = await tx.many<Row>("SELECT id, payslip_id, action, old_values, new_values, reason, actor_id, actor_name, occurred_at FROM payroll.payslip_events WHERE payslip_id = $1 ORDER BY occurred_at, id", [payslipId]);
  return rows.map(toEvent);
}

export async function getSnapshot(tx: Tx, payslipId: Uuid): Promise<{ snapshot: unknown; hash: string | null } | null> {
  const r = await tx.queryOne<Row>("SELECT snapshot, snapshot_hash FROM payroll.payslips WHERE id = $1 AND snapshot IS NOT NULL", [payslipId]);
  return r ? { snapshot: r.snapshot, hash: r.snapshot_hash ?? null } : null;
}

// ---------------------------------------------------------------------------
// Comptes rendus de calcul
// ---------------------------------------------------------------------------

export async function insertRun(tx: Tx, r: { id: Uuid; tenantId: Uuid; periodId: Uuid; scope: RunScope; recalculate: boolean; dryRun: boolean; staffFilter: readonly Uuid[] | null; requestedBy: Uuid; now: Date }): Promise<void> {
  await tx.query(
    `INSERT INTO payroll.calculation_runs (id, tenant_id, period_id, scope, recalculate, dry_run, staff_filter, requested_by, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9)`,
    [r.id, r.tenantId, r.periodId, r.scope, r.recalculate, r.dryRun, r.staffFilter === null ? null : [...r.staffFilter], r.requestedBy, r.now],
  );
}

/** Calcul « mort » (processus interrompu) : plus ancien que `olderThan` -> FAILED, ce qui libère le verrou fonctionnel. */
export async function failStaleRuns(tx: Tx, periodId: Uuid, olderThan: Date, now: Date): Promise<number> {
  const r = await tx.query(
    "UPDATE payroll.calculation_runs SET status = 'FAILED', error = 'Calcul interrompu (abandonné après délai)', finished_at = $3 WHERE period_id = $1 AND status = 'RUNNING' AND NOT dry_run AND requested_at < $2",
    [periodId, olderThan, now],
  );
  return r.rowCount;
}

export async function finishRun(tx: Tx, id: Uuid, f: { status: "COMPLETED" | "FAILED"; calculated: number; skipped: number; locked: number; failed: number; durationMs: number; error: string | null; now: Date }): Promise<void> {
  await tx.query(
    "UPDATE payroll.calculation_runs SET status = $2, calculated = $3, skipped = $4, locked = $5, failed = $6, duration_ms = $7, error = $8, finished_at = $9 WHERE id = $1",
    [id, f.status, f.calculated, f.skipped, f.locked, f.failed, f.durationMs, f.error, f.now],
  );
}

export interface RunItemInsert {
  id: Uuid;
  staffId: Uuid;
  staffName: string;
  outcome: RunOutcome;
  skipReason: SkipReason | null;
  message: string | null;
  payslipId: Uuid | null;
  minutesBySource: Partial<Record<HourSourceKind, number>> | null;
  totalAmount: number | null;
}

export async function insertRunItems(tx: Tx, tenantId: Uuid, runId: Uuid, items: readonly RunItemInsert[]): Promise<void> {
  await bulkInsert(
    tx,
    "payroll.calculation_run_items",
    ["id", "tenant_id", "run_id", "staff_id", "staff_name", "outcome", "skip_reason", "message", "payslip_id", "minutes_by_source", "total_amount"],
    items.map((i) => [i.id, tenantId, runId, i.staffId, i.staffName, i.outcome, i.skipReason, i.message, i.payslipId, i.minutesBySource === null ? null : JSON.stringify(i.minutesBySource), i.totalAmount === null ? null : String(i.totalAmount)]),
    { minutes_by_source: "jsonb", total_amount: "bigint" },
  );
}

export async function getRun(tx: Tx, id: Uuid): Promise<CalculationRunRecord | null> {
  const r = await tx.queryOne<Row>(`SELECT ${RUN_COLUMNS} FROM payroll.calculation_runs r WHERE r.id = $1`, [id]);
  return r ? toRun(r) : null;
}

export async function listRuns(tx: Tx, periodId: Uuid, limit: number): Promise<CalculationRunRecord[]> {
  const rows = await tx.many<Row>(`SELECT ${RUN_COLUMNS} FROM payroll.calculation_runs r WHERE r.period_id = $1 ORDER BY r.requested_at DESC, r.id LIMIT $2`, [periodId, limit]);
  return rows.map(toRun);
}

export async function listRunItems(tx: Tx, runId: Uuid, currency: CurrencyCode): Promise<CalculationRunItemRecord[]> {
  const rows = await tx.many<Row>(`SELECT ${RUN_ITEM_COLUMNS} FROM payroll.calculation_run_items i WHERE i.run_id = $1 ORDER BY i.staff_name, i.staff_id`, [runId]);
  return rows.map((r) => toRunItem(r, currency));
}
