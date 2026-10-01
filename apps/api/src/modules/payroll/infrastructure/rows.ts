/**
 * Colonnes lues et conversions ligne SQL -> enregistrement du domaine.
 *
 * Conversions volontaires (pg livre `bigint` en chaîne et `date` en objet Date du fuseau local) :
 *   - montants : `::text` en SQL, `Money.fromString` ici — aucun passage par un flottant ;
 *   - dates calendaires : `to_char(col, 'YYYY-MM-DD')` en SQL — jamais un `Date` JS ;
 *   - heures murales : `to_char(col, 'HH24:MI')`.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type {
  AdjustmentRecord,
  CalculationRunItemRecord,
  CalculationRunRecord,
  HourlyRateRecord,
  PayConfigRecord,
  PayPeriodRecord,
  PayslipEventRecord,
  PayslipLineRecord,
  PayslipRecord,
  PayrollSettings,
} from "../domain/records";

export type Row = Record<string, any>;

export const money = (value: string | number | bigint | null | undefined, currency: CurrencyCode): Money | null =>
  value === null || value === undefined ? null : Money.fromString(String(value), currency);

export const moneyOr0 = (value: string | number | bigint | null | undefined, currency: CurrencyCode): Money => money(value, currency) ?? Money.zero(currency);

export const SETTINGS_COLUMNS = `tenant_id, currency, default_overtime_threshold_minutes, default_overtime_multiplier_permille,
  require_separate_approver, owner_approval_threshold::text AS owner_approval_threshold, updated_at`;

export function toSettings(r: Row): PayrollSettings {
  const currency = r.currency as CurrencyCode;
  return {
    currency,
    defaultOvertimeThresholdMinutes: Number(r.default_overtime_threshold_minutes),
    defaultOvertimeMultiplierPermille: Number(r.default_overtime_multiplier_permille),
    requireSeparateApprover: Boolean(r.require_separate_approver),
    ownerApprovalThreshold: money(r.owner_approval_threshold, currency),
    updatedAt: r.updated_at ?? null,
  };
}

export const PERIOD_COLUMNS = `p.id, p.name, p.description, to_char(p.start_date, 'YYYY-MM-DD') AS start_date, to_char(p.end_date, 'YYYY-MM-DD') AS end_date,
  p.status, p.academic_year_id, p.awaiting_calculation, p.created_by, p.created_at, p.updated_at`;

export function toPeriod(r: Row, targets: readonly string[] = []): PayPeriodRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    academicYearId: r.academic_year_id,
    awaitingCalculation: Boolean(r.awaiting_calculation),
    targetStaffIds: targets,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const CONFIG_COLUMNS = `c.id, c.staff_id, c.config_type, c.monthly_salary::text AS monthly_salary, c.annual_salary::text AS annual_salary,
  c.default_hourly_rate::text AS default_hourly_rate, c.overtime_threshold_minutes, c.overtime_multiplier_permille,
  to_char(c.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(c.effective_to, 'YYYY-MM-DD') AS effective_to, c.created_at, c.updated_at`;

export function toConfig(r: Row, currency: CurrencyCode): PayConfigRecord {
  return {
    id: r.id,
    staffId: r.staff_id,
    type: r.config_type,
    monthlySalary: money(r.monthly_salary, currency),
    annualSalary: money(r.annual_salary, currency),
    defaultHourlyRate: money(r.default_hourly_rate, currency),
    overtimeThresholdMinutes: Number(r.overtime_threshold_minutes),
    overtimeMultiplierPermille: Number(r.overtime_multiplier_permille),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const RATE_COLUMNS = `r.id, r.curriculum_node_id, r.staff_id, r.rate::text AS rate, to_char(r.valid_from, 'YYYY-MM-DD') AS valid_from,
  to_char(r.valid_to, 'YYYY-MM-DD') AS valid_to, r.notes, r.created_at, r.updated_at`;

export function toRate(r: Row, currency: CurrencyCode): HourlyRateRecord {
  return {
    id: r.id,
    curriculumNodeId: r.curriculum_node_id,
    staffId: r.staff_id ?? null,
    rate: Money.fromString(String(r.rate), currency),
    validFrom: r.valid_from,
    validTo: r.valid_to ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const PAYSLIP_COLUMNS = `p.id, p.period_id, p.staff_id, p.config_id, p.payslip_kind, p.salary_amount::text AS salary_amount, p.base_amount::text AS base_amount,
  p.overtime_amount::text AS overtime_amount, p.bonus_amount::text AS bonus_amount, p.deduction_amount::text AS deduction_amount, p.total_amount::text AS total_amount,
  p.currency, p.regular_minutes, p.overtime_minutes, p.calc_details, p.config_snapshot, p.status, p.calculated_at, p.calculated_by, p.calculated_by_name,
  p.approved_at, p.approved_by, p.approved_by_name, p.paid_at, p.paid_by, p.paid_by_name, p.payment_method, p.payment_reference,
  p.disputed_at, p.dispute_reason, p.cancelled_at, p.cancelled_by, p.cancelled_by_name, p.cancel_reason,
  (p.snapshot IS NOT NULL) AS has_snapshot, p.snapshot_hash, p.replaces_payslip_id, p.row_version, p.created_at, p.updated_at`;

export function toPayslip(r: Row): PayslipRecord {
  const currency = r.currency as CurrencyCode;
  return {
    id: r.id,
    periodId: r.period_id,
    staffId: r.staff_id,
    configId: r.config_id,
    kind: r.payslip_kind,
    salaryAmount: moneyOr0(r.salary_amount, currency),
    baseAmount: moneyOr0(r.base_amount, currency),
    overtimeAmount: moneyOr0(r.overtime_amount, currency),
    bonusAmount: moneyOr0(r.bonus_amount, currency),
    deductionAmount: moneyOr0(r.deduction_amount, currency),
    totalAmount: moneyOr0(r.total_amount, currency),
    currency,
    regularMinutes: Number(r.regular_minutes),
    overtimeMinutes: Number(r.overtime_minutes),
    calcDetails: r.calc_details ?? {},
    configSnapshot: r.config_snapshot ?? {},
    status: r.status,
    calculatedAt: r.calculated_at,
    calculatedBy: r.calculated_by,
    calculatedByName: r.calculated_by_name,
    approvedAt: r.approved_at ?? null,
    approvedBy: r.approved_by ?? null,
    approvedByName: r.approved_by_name ?? null,
    paidAt: r.paid_at ?? null,
    paidBy: r.paid_by ?? null,
    paidByName: r.paid_by_name ?? null,
    paymentMethod: r.payment_method ?? null,
    paymentReference: r.payment_reference ?? null,
    disputedAt: r.disputed_at ?? null,
    disputeReason: r.dispute_reason ?? null,
    cancelledAt: r.cancelled_at ?? null,
    cancelledBy: r.cancelled_by ?? null,
    cancelledByName: r.cancelled_by_name ?? null,
    cancelReason: r.cancel_reason ?? null,
    hasSnapshot: Boolean(r.has_snapshot),
    snapshotHash: r.snapshot_hash ?? null,
    replacesPayslipId: r.replaces_payslip_id ?? null,
    rowVersion: Number(r.row_version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const LINE_COLUMNS = `l.id, l.payslip_id, l.source_kind, l.source_ref_id, l.staff_id, to_char(l.session_date, 'YYYY-MM-DD') AS session_date,
  to_char(l.start_time, 'HH24:MI') AS start_time, l.minutes, l.rate::text AS rate, l.multiplier_permille, l.amount::text AS amount, l.is_overtime,
  l.rate_origin, l.curriculum_node_id, l.classroom_id, l.label, l.code, l.classroom_label, l.position`;

export function toLine(r: Row, currency: CurrencyCode): PayslipLineRecord {
  return {
    id: r.id,
    payslipId: r.payslip_id,
    sourceKind: r.source_kind,
    sourceRefId: r.source_ref_id,
    staffId: r.staff_id,
    sessionDate: r.session_date,
    startTime: r.start_time ?? null,
    minutes: Number(r.minutes),
    rate: Money.fromString(String(r.rate), currency),
    multiplierPermille: Number(r.multiplier_permille),
    amount: Money.fromString(String(r.amount), currency),
    isOvertime: Boolean(r.is_overtime),
    rateOrigin: r.rate_origin,
    curriculumNodeId: r.curriculum_node_id ?? null,
    classroomId: r.classroom_id ?? null,
    label: r.label ?? null,
    code: r.code ?? null,
    classroomLabel: r.classroom_label ?? null,
    position: Number(r.position),
  };
}

export const ADJUSTMENT_COLUMNS = `a.id, a.payslip_id, a.kind, a.amount::text AS amount, a.label, a.reason, a.created_by, a.created_by_name, a.created_at`;

export function toAdjustment(r: Row, currency: CurrencyCode): AdjustmentRecord {
  return {
    id: r.id,
    payslipId: r.payslip_id,
    kind: r.kind,
    amount: Money.fromString(String(r.amount), currency),
    label: r.label,
    reason: r.reason ?? null,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

export function toEvent(r: Row): PayslipEventRecord {
  return {
    id: r.id,
    payslipId: r.payslip_id,
    action: r.action,
    oldValues: r.old_values ?? null,
    newValues: r.new_values ?? null,
    reason: r.reason ?? null,
    actorId: r.actor_id ?? null,
    actorName: r.actor_name,
    occurredAt: r.occurred_at,
  };
}

export const RUN_COLUMNS = `r.id, r.period_id, r.scope, r.recalculate, r.dry_run, r.staff_filter, r.status, r.calculated, r.skipped, r.locked, r.failed,
  r.duration_ms, r.error, r.requested_by, r.requested_at, r.finished_at`;

export function toRun(r: Row): CalculationRunRecord {
  return {
    id: r.id,
    periodId: r.period_id,
    scope: r.scope,
    recalculate: Boolean(r.recalculate),
    dryRun: Boolean(r.dry_run),
    staffFilter: r.staff_filter ?? null,
    status: r.status,
    calculated: Number(r.calculated),
    skipped: Number(r.skipped),
    locked: Number(r.locked),
    failed: Number(r.failed),
    durationMs: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
    error: r.error ?? null,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    finishedAt: r.finished_at ?? null,
  };
}

export const RUN_ITEM_COLUMNS = `i.id, i.run_id, i.staff_id, i.staff_name, i.outcome, i.skip_reason, i.message, i.payslip_id, i.minutes_by_source, i.total_amount::text AS total_amount`;

export function toRunItem(r: Row, currency: CurrencyCode): CalculationRunItemRecord {
  return {
    id: r.id,
    runId: r.run_id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    outcome: r.outcome,
    skipReason: r.skip_reason ?? null,
    message: r.message ?? null,
    payslipId: r.payslip_id ?? null,
    minutesBySource: r.minutes_by_source ?? null,
    totalAmount: money(r.total_amount, currency),
  };
}

/**
 * Insertion en lot paramétrée (`INSERT … VALUES (…),(…)`), par tranches : jamais de concaténation de valeurs.
 * `casts` ajoute un cast explicite à une colonne (`jsonb`, `date`, `time`, `uuid[]`…).
 */
export async function bulkInsert(
  tx: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> },
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  casts: Readonly<Record<string, string>> = {},
): Promise<void> {
  if (rows.length === 0) return;
  const perChunk = Math.max(1, Math.floor(30_000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const marks = columns.map((c, i) => {
        params.push(row[i]);
        const cast = casts[c];
        return `$${params.length}${cast ? `::${cast}` : ""}`;
      });
      return `(${marks.join(", ")})`;
    });
    await tx.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, params);
  }
}
