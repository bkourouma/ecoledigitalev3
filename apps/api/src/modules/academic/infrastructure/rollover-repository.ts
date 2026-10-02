/** Exécutions de la reconduction annuelle (`academic.rollover_runs`) et calendrier de l'établissement (jours fériés). */
import type { Tx } from "@ecoledigitale/database";
import type { AcademicRolloverRunReport, AcademicRolloverRunStatus, AcademicRolloverStep } from "@ecoledigitale/contracts/src/v2/academic";
import type { IsoDate } from "../domain/dates";
import type { HolidayFacts } from "../domain/structure-rollover";

export interface RolloverStepProgress {
  key: AcademicRolloverStep;
  status: "PENDING" | "RUNNING" | "DONE" | "SKIPPED" | "FAILED";
  done: number;
  total: number;
  message: string | null;
}

export interface RolloverProgress {
  stage: AcademicRolloverStep | null;
  steps: RolloverStepProgress[];
}

export interface RolloverRunOptions {
  steps: AcademicRolloverStep[];
  classroomIds: string[] | null;
  createMissingClassrooms: boolean;
}

export interface RolloverRun {
  id: string;
  institutionId: string;
  fromAcademicYearId: string;
  toAcademicYearId: string;
  status: AcademicRolloverRunStatus;
  options: RolloverRunOptions;
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  progress: RolloverProgress;
  report: AcademicRolloverRunReport | null;
  errorMessage: string | null;
  updatedAt: string;
}

const RUN_COLS = `id, institution_id, from_academic_year_id, to_academic_year_id, status, options, requested_by, requested_at, started_at, finished_at,
  attempts, progress, report, error_message, updated_at`;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

function mapRun(r: Record<string, unknown>): RolloverRun {
  const options = (r.options ?? {}) as Partial<RolloverRunOptions>;
  const progress = (r.progress ?? {}) as Partial<RolloverProgress>;
  return {
    id: r.id as string,
    institutionId: r.institution_id as string,
    fromAcademicYearId: r.from_academic_year_id as string,
    toAcademicYearId: r.to_academic_year_id as string,
    status: r.status as AcademicRolloverRunStatus,
    options: { steps: options.steps ?? [], classroomIds: options.classroomIds ?? null, createMissingClassrooms: options.createMissingClassrooms ?? true },
    requestedBy: (r.requested_by as string | null) ?? null,
    requestedAt: iso(r.requested_at) as string,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    attempts: Number(r.attempts),
    progress: { stage: progress.stage ?? null, steps: progress.steps ?? [] },
    report: (r.report as AcademicRolloverRunReport | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    updatedAt: iso(r.updated_at) as string,
  };
}

export async function insertRun(
  tx: Tx,
  v: { id: string; institutionId: string; fromYearId: string; toYearId: string; options: RolloverRunOptions; requestedBy: string | null; progress: RolloverProgress },
): Promise<RolloverRun> {
  const r = await tx.queryOne(
    `INSERT INTO academic.rollover_runs (id, tenant_id, institution_id, from_academic_year_id, to_academic_year_id, options, requested_by, progress)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5::jsonb, $6, $7::jsonb) RETURNING ${RUN_COLS}`,
    [v.id, v.institutionId, v.fromYearId, v.toYearId, JSON.stringify(v.options), v.requestedBy, JSON.stringify(v.progress)],
  );
  return mapRun(r as Record<string, unknown>);
}

export async function getRun(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<RolloverRun | null> {
  const r = await tx.queryOne(`SELECT ${RUN_COLS} FROM academic.rollover_runs WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? mapRun(r) : null;
}

export async function findLiveRun(tx: Tx, fromYearId: string, toYearId: string): Promise<RolloverRun | null> {
  const r = await tx.queryOne(
    `SELECT ${RUN_COLS} FROM academic.rollover_runs WHERE from_academic_year_id = $1 AND to_academic_year_id = $2 AND status IN ('PENDING', 'RUNNING') LIMIT 1`,
    [fromYearId, toYearId],
  );
  return r ? mapRun(r) : null;
}

export async function listRuns(tx: Tx, fromYearId: string, limit: number): Promise<RolloverRun[]> {
  const rows = await tx.many(`SELECT ${RUN_COLS} FROM academic.rollover_runs WHERE from_academic_year_id = $1 ORDER BY requested_at DESC, id DESC LIMIT $2`, [fromYearId, limit]);
  return rows.map(mapRun);
}

export async function markRunStarted(tx: Tx, id: string): Promise<RolloverRun> {
  const r = await tx.queryOne(
    `UPDATE academic.rollover_runs SET status = 'RUNNING', attempts = attempts + 1, started_at = COALESCE(started_at, now()), finished_at = NULL, error_message = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${RUN_COLS}`,
    [id],
  );
  return mapRun(r as Record<string, unknown>);
}

export async function requeueRun(tx: Tx, id: string): Promise<RolloverRun> {
  const r = await tx.queryOne(
    `UPDATE academic.rollover_runs SET status = 'PENDING', finished_at = NULL, error_message = NULL, updated_at = now() WHERE id = $1 AND status = 'FAILED' RETURNING ${RUN_COLS}`,
    [id],
  );
  return mapRun(r as Record<string, unknown>);
}

export async function saveRunProgress(tx: Tx, id: string, progress: RolloverProgress): Promise<void> {
  await tx.query("UPDATE academic.rollover_runs SET progress = $2::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify(progress)]);
}

export async function finishRun(tx: Tx, id: string, v: { status: "COMPLETED" | "FAILED"; progress: RolloverProgress; report: AcademicRolloverRunReport | null; errorMessage: string | null }): Promise<RolloverRun> {
  const r = await tx.queryOne(
    `UPDATE academic.rollover_runs SET status = $2, progress = $3::jsonb, report = $4::jsonb, error_message = $5, finished_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${RUN_COLS}`,
    [id, v.status, JSON.stringify(v.progress), v.report ? JSON.stringify(v.report) : null, v.errorMessage],
  );
  return mapRun(r as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Jours fériés
// ---------------------------------------------------------------------------

export interface Holiday extends HolidayFacts {
  id: string;
  institutionId: string;
}

const HOLIDAY_COLS = "id, institution_id, label, kind, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, recurs_yearly, blocks_teaching";

function mapHoliday(r: Record<string, unknown>): Holiday {
  return {
    id: r.id as string,
    institutionId: r.institution_id as string,
    label: r.label as string,
    kind: r.kind as Holiday["kind"],
    startsOn: r.starts_on as IsoDate,
    endsOn: r.ends_on as IsoDate,
    recursYearly: Boolean(r.recurs_yearly),
    blocksTeaching: Boolean(r.blocks_teaching),
  };
}

export async function listHolidays(tx: Tx, f: { institutionId?: string | null; from?: string | null; to?: string | null }): Promise<Holiday[]> {
  const rows = await tx.many(
    `SELECT ${HOLIDAY_COLS} FROM academic.institution_holidays
      WHERE ($1::uuid IS NULL OR institution_id = $1) AND ($2::date IS NULL OR ends_on >= $2::date) AND ($3::date IS NULL OR starts_on <= $3::date)
      ORDER BY starts_on, ends_on, label`,
    [f.institutionId ?? null, f.from ?? null, f.to ?? null],
  );
  return rows.map(mapHoliday);
}

export async function getHoliday(tx: Tx, id: string): Promise<Holiday | null> {
  const r = await tx.queryOne(`SELECT ${HOLIDAY_COLS} FROM academic.institution_holidays WHERE id = $1`, [id]);
  return r ? mapHoliday(r) : null;
}

export async function insertHoliday(tx: Tx, v: Omit<Holiday, "kind"> & { kind: Holiday["kind"] }): Promise<Holiday> {
  const r = await tx.queryOne(
    `INSERT INTO academic.institution_holidays (id, tenant_id, institution_id, label, kind, starts_on, ends_on, recurs_yearly, blocks_teaching)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5::date, $6::date, $7, $8) RETURNING ${HOLIDAY_COLS}`,
    [v.id, v.institutionId, v.label, v.kind, v.startsOn, v.endsOn, v.recursYearly, v.blocksTeaching],
  );
  return mapHoliday(r as Record<string, unknown>);
}

export async function updateHoliday(tx: Tx, id: string, v: { label?: string; kind?: string; startsOn?: string; endsOn?: string; recursYearly?: boolean; blocksTeaching?: boolean }): Promise<Holiday> {
  const r = await tx.queryOne(
    `UPDATE academic.institution_holidays SET label = COALESCE($2, label), kind = COALESCE($3, kind), starts_on = COALESCE($4::date, starts_on), ends_on = COALESCE($5::date, ends_on),
        recurs_yearly = COALESCE($6::boolean, recurs_yearly), blocks_teaching = COALESCE($7::boolean, blocks_teaching), updated_at = now()
      WHERE id = $1 RETURNING ${HOLIDAY_COLS}`,
    [id, v.label ?? null, v.kind ?? null, v.startsOn ?? null, v.endsOn ?? null, v.recursYearly ?? null, v.blocksTeaching ?? null],
  );
  return mapHoliday(r as Record<string, unknown>);
}

export async function deleteHoliday(tx: Tx, id: string): Promise<void> {
  await tx.query("DELETE FROM academic.institution_holidays WHERE id = $1", [id]);
}
