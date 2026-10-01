/** Réglages, périodes, configurations de paie et tarifs : requêtes SQL (via le `Tx` de TenantDb, SQL paramétré). */
import type { Tx } from "@ecoledigitale/database";
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { HourlyRateRecord, PayConfigRecord, PayPeriodRecord, PayrollSettings } from "../domain/records";
import type { ConfigType, IsoDate, PeriodStatus, Uuid } from "../domain/types";
import { CONFIG_COLUMNS, PERIOD_COLUMNS, RATE_COLUMNS, SETTINGS_COLUMNS, toConfig, toPeriod, toRate, toSettings, type Row } from "./rows";

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function getSettings(tx: Tx): Promise<PayrollSettings | null> {
  const r = await tx.queryOne<Row>(`SELECT ${SETTINGS_COLUMNS} FROM payroll.settings`);
  return r ? toSettings(r) : null;
}

/** Crée la ligne de réglages (valeurs par défaut de la migration) si elle manque, puis la lit. */
export async function ensureSettings(tx: Tx, tenantId: string): Promise<PayrollSettings> {
  await tx.query("INSERT INTO payroll.settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);
  return (await getSettings(tx)) as PayrollSettings;
}

export interface SettingsPatch {
  currency?: CurrencyCode;
  defaultOvertimeThresholdMinutes?: number;
  defaultOvertimeMultiplierPermille?: number;
  requireSeparateApprover?: boolean;
  ownerApprovalThreshold?: number | null;
}

export async function updateSettings(tx: Tx, tenantId: string, patch: SettingsPatch, userId: string | null, now: Date): Promise<PayrollSettings> {
  const sets: string[] = ["updated_by = $2", "updated_at = $3"];
  const params: unknown[] = [tenantId, userId, now];
  const add = (column: string, value: unknown, cast = ""): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  if (patch.currency !== undefined) add("currency", patch.currency);
  if (patch.defaultOvertimeThresholdMinutes !== undefined) add("default_overtime_threshold_minutes", patch.defaultOvertimeThresholdMinutes);
  if (patch.defaultOvertimeMultiplierPermille !== undefined) add("default_overtime_multiplier_permille", patch.defaultOvertimeMultiplierPermille);
  if (patch.requireSeparateApprover !== undefined) add("require_separate_approver", patch.requireSeparateApprover);
  if (patch.ownerApprovalThreshold !== undefined) add("owner_approval_threshold", patch.ownerApprovalThreshold === null ? null : String(patch.ownerApprovalThreshold), "::bigint");
  await tx.query(`UPDATE payroll.settings SET ${sets.join(", ")} WHERE tenant_id = $1`, params);
  return (await getSettings(tx)) as PayrollSettings;
}

export async function hasAnyPayslip(tx: Tx): Promise<boolean> {
  return (await tx.queryOne<Row>("SELECT 1 AS x FROM payroll.payslips LIMIT 1")) !== null;
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

async function targetsOf(tx: Tx, periodIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (periodIds.length === 0) return out;
  const rows = await tx.many<Row>("SELECT period_id, staff_id FROM payroll.pay_period_targets WHERE period_id = ANY($1::uuid[]) ORDER BY staff_id", [periodIds]);
  for (const r of rows) {
    const list = out.get(r.period_id);
    if (list) list.push(r.staff_id);
    else out.set(r.period_id, [r.staff_id]);
  }
  return out;
}

export interface PeriodInsert {
  id: Uuid;
  tenantId: Uuid;
  name: string;
  description: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  academicYearId: Uuid;
  createdBy: Uuid;
  now: Date;
}

export async function insertPeriod(tx: Tx, p: PeriodInsert, targets: readonly Uuid[]): Promise<PayPeriodRecord> {
  await tx.query(
    `INSERT INTO payroll.pay_periods (id, tenant_id, name, description, start_date, end_date, academic_year_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $9)`,
    [p.id, p.tenantId, p.name, p.description, p.startDate, p.endDate, p.academicYearId, p.createdBy, p.now],
  );
  for (const staffId of targets) {
    await tx.query("INSERT INTO payroll.pay_period_targets (tenant_id, period_id, staff_id) VALUES ($1, $2, $3)", [p.tenantId, p.id, staffId]);
  }
  return (await getPeriod(tx, p.id)) as PayPeriodRecord;
}

export async function getPeriod(tx: Tx, id: Uuid, opts: { forUpdate?: boolean } = {}): Promise<PayPeriodRecord | null> {
  const r = await tx.queryOne<Row>(`SELECT ${PERIOD_COLUMNS} FROM payroll.pay_periods p WHERE p.id = $1${opts.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  if (!r) return null;
  return toPeriod(r, (await targetsOf(tx, [id])).get(id) ?? []);
}

export interface PeriodFilter {
  status?: PeriodStatus | undefined;
  academicYearId?: Uuid | undefined;
  awaitingCalculation?: boolean | undefined;
  limit: number;
  offset: number;
}

export async function listPeriods(tx: Tx, f: PeriodFilter): Promise<{ items: PayPeriodRecord[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) {
    params.push(f.status);
    where.push(`p.status = $${params.length}`);
  }
  if (f.academicYearId) {
    params.push(f.academicYearId);
    where.push(`p.academic_year_id = $${params.length}`);
  }
  if (f.awaitingCalculation !== undefined) {
    params.push(f.awaitingCalculation);
    where.push(`p.awaiting_calculation = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await tx.queryOne<Row>(`SELECT count(*)::int AS n FROM payroll.pay_periods p ${clause}`, params))?.n ?? 0);
  params.push(f.limit, f.offset);
  const rows = await tx.many<Row>(`SELECT ${PERIOD_COLUMNS} FROM payroll.pay_periods p ${clause} ORDER BY p.start_date DESC, p.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const targets = await targetsOf(tx, rows.map((r) => r.id));
  return { items: rows.map((r) => toPeriod(r, targets.get(r.id) ?? [])), total };
}

export interface PeriodPatch {
  name?: string;
  description?: string | null;
  startDate?: IsoDate;
  endDate?: IsoDate;
  academicYearId?: Uuid;
  status?: PeriodStatus;
  awaitingCalculation?: boolean;
}

export async function updatePeriod(tx: Tx, id: Uuid, patch: PeriodPatch, now: Date): Promise<void> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, now];
  const add = (column: string, value: unknown, cast = ""): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.startDate !== undefined) add("start_date", patch.startDate, "::date");
  if (patch.endDate !== undefined) add("end_date", patch.endDate, "::date");
  if (patch.academicYearId !== undefined) add("academic_year_id", patch.academicYearId);
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.awaitingCalculation !== undefined) add("awaiting_calculation", patch.awaitingCalculation);
  await tx.query(`UPDATE payroll.pay_periods SET ${sets.join(", ")} WHERE id = $1`, params);
}

export async function findAwaitingPeriod(tx: Tx): Promise<PayPeriodRecord | null> {
  const r = await tx.queryOne<Row>(`SELECT ${PERIOD_COLUMNS} FROM payroll.pay_periods p WHERE p.awaiting_calculation`);
  return r ? toPeriod(r, (await targetsOf(tx, [r.id])).get(r.id) ?? []) : null;
}

export async function addTargets(tx: Tx, tenantId: Uuid, periodId: Uuid, staffIds: readonly Uuid[]): Promise<void> {
  for (const staffId of staffIds) {
    await tx.query("INSERT INTO payroll.pay_period_targets (tenant_id, period_id, staff_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [tenantId, periodId, staffId]);
  }
}

export async function removeTargets(tx: Tx, periodId: Uuid, staffIds: readonly Uuid[]): Promise<void> {
  if (staffIds.length === 0) return;
  await tx.query("DELETE FROM payroll.pay_period_targets WHERE period_id = $1 AND staff_id = ANY($2::uuid[])", [periodId, staffIds]);
}

// ---------------------------------------------------------------------------
// Configurations de paie
// ---------------------------------------------------------------------------

export interface ConfigWrite {
  staffId: Uuid;
  type: ConfigType;
  monthlySalary: number | null;
  annualSalary: number | null;
  defaultHourlyRate: number | null;
  overtimeThresholdMinutes: number;
  overtimeMultiplierPermille: number;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

const text = (n: number | null): string | null => (n === null ? null : String(n));

export async function insertConfig(tx: Tx, id: Uuid, tenantId: Uuid, w: ConfigWrite, createdBy: Uuid, now: Date, currency: CurrencyCode): Promise<PayConfigRecord> {
  await tx.query(
    `INSERT INTO payroll.pay_configs (id, tenant_id, staff_id, config_type, monthly_salary, annual_salary, default_hourly_rate, overtime_threshold_minutes,
                                      overtime_multiplier_permille, effective_from, effective_to, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, $7::bigint, $8, $9, $10::date, $11::date, $12, $13, $13)`,
    [id, tenantId, w.staffId, w.type, text(w.monthlySalary), text(w.annualSalary), text(w.defaultHourlyRate), w.overtimeThresholdMinutes, w.overtimeMultiplierPermille, w.effectiveFrom, w.effectiveTo, createdBy, now],
  );
  return (await getConfig(tx, id, currency)) as PayConfigRecord;
}

export async function updateConfig(tx: Tx, id: Uuid, w: Omit<ConfigWrite, "staffId">, now: Date, currency: CurrencyCode): Promise<PayConfigRecord> {
  await tx.query(
    `UPDATE payroll.pay_configs SET config_type = $2, monthly_salary = $3::bigint, annual_salary = $4::bigint, default_hourly_rate = $5::bigint,
            overtime_threshold_minutes = $6, overtime_multiplier_permille = $7, effective_from = $8::date, effective_to = $9::date, updated_at = $10
      WHERE id = $1`,
    [id, w.type, text(w.monthlySalary), text(w.annualSalary), text(w.defaultHourlyRate), w.overtimeThresholdMinutes, w.overtimeMultiplierPermille, w.effectiveFrom, w.effectiveTo, now],
  );
  return (await getConfig(tx, id, currency)) as PayConfigRecord;
}

export async function getConfig(tx: Tx, id: Uuid, currency: CurrencyCode): Promise<PayConfigRecord | null> {
  const r = await tx.queryOne<Row>(`SELECT ${CONFIG_COLUMNS} FROM payroll.pay_configs c WHERE c.id = $1`, [id]);
  return r ? toConfig(r, currency) : null;
}

export async function listConfigs(tx: Tx, f: { staffId?: Uuid | undefined; activeOn?: IsoDate | undefined; limit: number; offset: number }, currency: CurrencyCode): Promise<{ items: PayConfigRecord[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.staffId) {
    params.push(f.staffId);
    where.push(`c.staff_id = $${params.length}`);
  }
  if (f.activeOn) {
    params.push(f.activeOn);
    where.push(`c.effective_from <= $${params.length}::date AND (c.effective_to IS NULL OR c.effective_to >= $${params.length}::date)`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await tx.queryOne<Row>(`SELECT count(*)::int AS n FROM payroll.pay_configs c ${clause}`, params))?.n ?? 0);
  params.push(f.limit, f.offset);
  const rows = await tx.many<Row>(`SELECT ${CONFIG_COLUMNS} FROM payroll.pay_configs c ${clause} ORDER BY c.staff_id, c.effective_from DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows.map((r) => toConfig(r, currency)), total };
}

/** Toutes les configurations qui couvrent une partie de `[from, to]` (le calcul retient la plus récente par enseignant). */
export async function listConfigsOverlapping(tx: Tx, from: IsoDate, to: IsoDate, staffIds: readonly Uuid[] | null, currency: CurrencyCode): Promise<PayConfigRecord[]> {
  const rows = await tx.many<Row>(
    `SELECT ${CONFIG_COLUMNS} FROM payroll.pay_configs c
      WHERE c.effective_from <= $2::date AND (c.effective_to IS NULL OR c.effective_to >= $1::date)
        AND ($3::uuid[] IS NULL OR c.staff_id = ANY($3::uuid[]))
      ORDER BY c.staff_id, c.effective_from DESC`,
    [from, to, staffIds === null ? null : [...staffIds]],
  );
  return rows.map((r) => toConfig(r, currency));
}

// ---------------------------------------------------------------------------
// Tarifs horaires
// ---------------------------------------------------------------------------

export interface RateWrite {
  curriculumNodeId: Uuid;
  staffId: Uuid | null;
  rate: number;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  notes: string | null;
}

export async function insertRate(tx: Tx, id: Uuid, tenantId: Uuid, w: RateWrite, createdBy: Uuid, now: Date, currency: CurrencyCode): Promise<HourlyRateRecord> {
  await tx.query(
    `INSERT INTO payroll.hourly_rates (id, tenant_id, curriculum_node_id, staff_id, rate, valid_from, valid_to, notes, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::bigint, $6::date, $7::date, $8, $9, $10, $10)`,
    [id, tenantId, w.curriculumNodeId, w.staffId, String(w.rate), w.validFrom, w.validTo, w.notes, createdBy, now],
  );
  return (await getRate(tx, id, currency)) as HourlyRateRecord;
}

export async function updateRate(tx: Tx, id: Uuid, w: Pick<RateWrite, "rate" | "validFrom" | "validTo" | "notes">, now: Date, currency: CurrencyCode): Promise<HourlyRateRecord> {
  await tx.query("UPDATE payroll.hourly_rates SET rate = $2::bigint, valid_from = $3::date, valid_to = $4::date, notes = $5, updated_at = $6 WHERE id = $1", [id, String(w.rate), w.validFrom, w.validTo, w.notes, now]);
  return (await getRate(tx, id, currency)) as HourlyRateRecord;
}

export async function deleteRate(tx: Tx, id: Uuid): Promise<boolean> {
  const r = await tx.query("DELETE FROM payroll.hourly_rates WHERE id = $1", [id]);
  return r.rowCount > 0;
}

export async function getRate(tx: Tx, id: Uuid, currency: CurrencyCode): Promise<HourlyRateRecord | null> {
  const r = await tx.queryOne<Row>(`SELECT ${RATE_COLUMNS} FROM payroll.hourly_rates r WHERE r.id = $1`, [id]);
  return r ? toRate(r, currency) : null;
}

export async function listRates(
  tx: Tx,
  f: { nodeId?: Uuid | undefined; staffId?: Uuid | undefined; generic?: boolean | undefined; activeOn?: IsoDate | undefined; limit: number; offset: number },
  currency: CurrencyCode,
): Promise<{ items: HourlyRateRecord[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.nodeId) {
    params.push(f.nodeId);
    where.push(`r.curriculum_node_id = $${params.length}`);
  }
  if (f.staffId) {
    params.push(f.staffId);
    where.push(`r.staff_id = $${params.length}`);
  }
  if (f.generic) where.push("r.staff_id IS NULL");
  if (f.activeOn) {
    params.push(f.activeOn);
    where.push(`r.valid_from <= $${params.length}::date AND (r.valid_to IS NULL OR r.valid_to >= $${params.length}::date)`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await tx.queryOne<Row>(`SELECT count(*)::int AS n FROM payroll.hourly_rates r ${clause}`, params))?.n ?? 0);
  params.push(f.limit, f.offset);
  const rows = await tx.many<Row>(`SELECT ${RATE_COLUMNS} FROM payroll.hourly_rates r ${clause} ORDER BY r.curriculum_node_id, r.staff_id NULLS FIRST, r.valid_from DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows.map((r) => toRate(r, currency)), total };
}

/** Tarifs qui couvrent une partie de `[from, to]` : préchargés UNE fois pour tout le calcul (AC2.10). */
export async function listRatesOverlapping(tx: Tx, from: IsoDate, to: IsoDate, currency: CurrencyCode): Promise<HourlyRateRecord[]> {
  const rows = await tx.many<Row>(`SELECT ${RATE_COLUMNS} FROM payroll.hourly_rates r WHERE r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $1::date)`, [from, to]);
  return rows.map((r) => toRate(r, currency));
}

export const zeroOf = (currency: CurrencyCode): Money => Money.zero(currency);
