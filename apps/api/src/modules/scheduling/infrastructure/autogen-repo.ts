/**
 * Accès SQL aux générations automatiques (`scheduling.autogen_runs`). Le tenant vient toujours de la
 * transaction (`kernel.current_tenant_id()`), jamais d'un paramètre.
 */
import type { Tx } from "@ecoledigitale/database";

export const AUTOGEN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "APPLIED", "DISCARDED"] as const;
export type AutogenStatus = (typeof AUTOGEN_STATUSES)[number];

export interface AutogenRunRow {
  id: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string;
  periodId: string | null;
  name: string;
  status: AutogenStatus;
  seed: string;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  fixedTimetableId: string | null;
  appliedTimetableId: string | null;
  requestedBy: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  appliedAt: Date | null;
  appliedBy: string | null;
  discardedAt: Date | null;
}

const COLUMNS = `id, institution_id, campus_id, academic_year_id, period_id, name, status, seed, params, summary, error_code, error_message,
  fixed_timetable_id, applied_timetable_id, requested_by, requested_at, started_at, completed_at, applied_at, applied_by, discarded_at`;
const COLUMNS_WITH_RESULT = `${COLUMNS}, result`;

function map(r: Record<string, any>): AutogenRunRow {
  return {
    id: r.id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    academicYearId: r.academic_year_id,
    periodId: r.period_id,
    name: r.name,
    status: r.status,
    seed: r.seed,
    params: r.params,
    result: r.result ?? null,
    summary: r.summary,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    fixedTimetableId: r.fixed_timetable_id,
    appliedTimetableId: r.applied_timetable_id,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    appliedAt: r.applied_at,
    appliedBy: r.applied_by,
    discardedAt: r.discarded_at,
  };
}

export interface NewAutogenRun {
  id: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string;
  periodId: string | null;
  name: string;
  seed: string;
  params: Record<string, unknown>;
  summary: Record<string, unknown>;
  fixedTimetableId: string | null;
}

export async function insertRun(tx: Tx, tenantId: string, r: NewAutogenRun, by: string | null, at: Date): Promise<AutogenRunRow> {
  const row = await tx.queryOne(
    `INSERT INTO scheduling.autogen_runs (id, tenant_id, institution_id, campus_id, academic_year_id, period_id, name, seed, params, summary, fixed_timetable_id, requested_by, requested_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $13) RETURNING ${COLUMNS}`,
    [r.id, tenantId, r.institutionId, r.campusId, r.academicYearId, r.periodId, r.name, r.seed, JSON.stringify(r.params), JSON.stringify(r.summary), r.fixedTimetableId, by, at],
  );
  return map(row as Record<string, any>);
}

/** Lecture d'un run, proposition comprise (les listes, elles, ne chargent pas la proposition). `withResult` est conservé pour la lisibilité des appels. */
export async function getRun(tx: Tx, id: string, options: { forUpdate?: boolean; withResult?: boolean } = {}): Promise<AutogenRunRow | null> {
  const row = await tx.queryOne(
    `SELECT ${COLUMNS_WITH_RESULT} FROM scheduling.autogen_runs WHERE tenant_id = kernel.current_tenant_id() AND id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return row ? map(row as Record<string, any>) : null;
}

export async function listRuns(tx: Tx, f: { institutionId?: string; status?: AutogenStatus; limit: number }): Promise<AutogenRunRow[]> {
  const params: unknown[] = [];
  const clauses = ["tenant_id = kernel.current_tenant_id()"];
  if (f.institutionId) {
    params.push(f.institutionId);
    clauses.push(`institution_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    clauses.push(`status = $${params.length}`);
  }
  params.push(f.limit);
  const rows = await tx.many(`SELECT ${COLUMNS} FROM scheduling.autogen_runs WHERE ${clauses.join(" AND ")} ORDER BY requested_at DESC, id DESC LIMIT $${params.length}`, params);
  return rows.map((r) => map(r as Record<string, any>));
}

/** Identifiants des runs en attente, du plus ancien au plus récent, sans verrouiller (le verrou est pris par `claim`). */
export async function listQueuedIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM scheduling.autogen_runs WHERE tenant_id = kernel.current_tenant_id() AND status = 'QUEUED' ORDER BY requested_at, id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

/** QUEUED -> RUNNING si (et seulement si) personne d'autre ne l'a pris. Retourne le run, ou `null`. */
export async function claim(tx: Tx, id: string, at: Date): Promise<AutogenRunRow | null> {
  const row = await tx.queryOne(
    `UPDATE scheduling.autogen_runs SET status = 'RUNNING', started_at = $2, updated_at = $2
      WHERE tenant_id = kernel.current_tenant_id()
        AND id = (SELECT id FROM scheduling.autogen_runs WHERE tenant_id = kernel.current_tenant_id() AND id = $1 AND status = 'QUEUED' FOR UPDATE SKIP LOCKED)
      RETURNING ${COLUMNS}`,
    [id, at],
  );
  return row ? map(row as Record<string, any>) : null;
}

export async function markCompleted(tx: Tx, id: string, result: Record<string, unknown>, summary: Record<string, unknown>, at: Date): Promise<AutogenRunRow> {
  const row = await tx.queryOne(
    `UPDATE scheduling.autogen_runs SET status = 'COMPLETED', result = $2::jsonb, summary = $3::jsonb, completed_at = $4, updated_at = $4
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${COLUMNS}`,
    [id, JSON.stringify(result), JSON.stringify(summary), at],
  );
  return map(row as Record<string, any>);
}

export async function markFailed(tx: Tx, id: string, code: string, message: string, at: Date): Promise<AutogenRunRow> {
  const row = await tx.queryOne(
    `UPDATE scheduling.autogen_runs SET status = 'FAILED', error_code = $2, error_message = $3, completed_at = $4, updated_at = $4
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${COLUMNS}`,
    [id, code, message.slice(0, 1000), at],
  );
  return map(row as Record<string, any>);
}

export async function markApplied(tx: Tx, id: string, timetableId: string, by: string | null, at: Date): Promise<AutogenRunRow> {
  const row = await tx.queryOne(
    `UPDATE scheduling.autogen_runs SET status = 'APPLIED', applied_timetable_id = $2, applied_by = $3, applied_at = $4, updated_at = $4
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${COLUMNS}`,
    [id, timetableId, by, at],
  );
  return map(row as Record<string, any>);
}

export async function markDiscarded(tx: Tx, id: string, by: string | null, at: Date): Promise<AutogenRunRow> {
  const row = await tx.queryOne(
    `UPDATE scheduling.autogen_runs SET status = 'DISCARDED', discarded_by = $2, discarded_at = $3, updated_at = $3
      WHERE tenant_id = kernel.current_tenant_id() AND id = $1 RETURNING ${COLUMNS}`,
    [id, by, at],
  );
  return map(row as Record<string, any>);
}

/** Runs « RUNNING » depuis trop longtemps (tâche interrompue) : à marquer en échec. */
export async function listStaleRunning(tx: Tx, olderThan: Date): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM scheduling.autogen_runs WHERE tenant_id = kernel.current_tenant_id() AND status = 'RUNNING' AND started_at < $1 ORDER BY started_at, id`,
    [olderThan],
  );
  return rows.map((r) => r.id);
}
