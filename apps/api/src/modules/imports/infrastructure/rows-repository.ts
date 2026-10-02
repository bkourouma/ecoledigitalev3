/**
 * Accès SQL à `imports.rows` : lignes brutes, validées, résultats d'exécution. Toutes les écritures groupées passent par
 * `unnest` (une requête par lot), jamais une requête par ligne.
 */
import type { Tx } from "@ecoledigitale/database";
import type { ImportIssue, ImportOutcome, ImportPlannedAction, ImportRowValidation } from "@ecoledigitale/contracts/src/v2/imports";
import type { RowRecord, RowStats } from "../domain/records";

const ROW_COLUMNS = `row_no AS "rowNo", job_id AS "jobId", raw, normalized, natural_key AS "naturalKey", validation, planned_action AS "plannedAction",
  planned_entity_id AS "plannedEntityId", issues, outcome, entity_id AS "entityId", outcome_issues AS "outcomeIssues", processed_at AS "processedAt"`;

const CHUNK = 500;

export async function insertRawRows(tx: Tx, tenantId: string, jobId: string, rows: ReadonlyArray<{ rowNo: number; cells: readonly string[] }>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await tx.query(
      `INSERT INTO imports.rows (tenant_id, job_id, row_no, raw)
       SELECT $1, $2, u.n, u.r::jsonb FROM unnest($3::int[], $4::text[]) AS u(n, r)`,
      [tenantId, jobId, part.map((r) => r.rowNo), part.map((r) => JSON.stringify(r.cells))],
    );
  }
}

/** Revient à l'état « à valider » (changement de mapping ou d'options). */
export async function resetValidation(tx: Tx, jobId: string): Promise<void> {
  await tx.query(
    `UPDATE imports.rows SET normalized = NULL, natural_key = NULL, validation = 'PENDING', planned_action = NULL, planned_entity_id = NULL, issues = '[]'::jsonb,
            outcome = NULL, entity_id = NULL, outcome_issues = NULL, processed_at = NULL
      WHERE job_id = $1`,
    [jobId],
  );
}

export async function fetchPending(tx: Tx, jobId: string, limit: number): Promise<Array<{ rowNo: number; raw: string[] | null }>> {
  return await tx.many<{ rowNo: number; raw: string[] | null }>(`SELECT row_no AS "rowNo", raw FROM imports.rows WHERE job_id = $1 AND validation = 'PENDING' ORDER BY row_no LIMIT $2`, [jobId, limit]);
}

export interface ValidationWrite {
  rowNo: number;
  normalized: Record<string, unknown> | null;
  naturalKey: string | null;
  validation: ImportRowValidation;
  issues: readonly ImportIssue[];
}

export async function saveValidation(tx: Tx, jobId: string, results: readonly ValidationWrite[]): Promise<void> {
  if (results.length === 0) return;
  await tx.query(
    `UPDATE imports.rows r SET normalized = u.normalized::jsonb, natural_key = u.nk, validation = u.v, issues = u.issues::jsonb
       FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(n, normalized, nk, v, issues)
      WHERE r.job_id = $1 AND r.row_no = u.n`,
    [jobId, results.map((r) => r.rowNo), results.map((r) => (r.normalized === null ? null : JSON.stringify(r.normalized))), results.map((r) => r.naturalKey), results.map((r) => r.validation), results.map((r) => JSON.stringify(r.issues))],
  );
}

/** Marque INVALIDES les lignes dont la clé a déjà été vue plus haut dans le fichier ; renvoie leur nombre. */
export async function markDuplicates(tx: Tx, jobId: string): Promise<number> {
  const r = await tx.query(
    `WITH ranked AS (
       SELECT row_no, natural_key, min(row_no) OVER (PARTITION BY natural_key) AS first_no
         FROM imports.rows WHERE job_id = $1 AND natural_key IS NOT NULL AND validation = 'VALID'
     )
     UPDATE imports.rows r
        SET validation = 'INVALID',
            issues = r.issues || jsonb_build_array(jsonb_build_object('column', NULL, 'code', 'imports.duplicate_in_file', 'severity', 'ERROR',
              'message', 'Cette ligne répète la ligne ' || ranked.first_no || ' du fichier (même identifiant) : elle est ignorée.'))
       FROM ranked
      WHERE r.job_id = $1 AND r.row_no = ranked.row_no AND ranked.row_no <> ranked.first_no`,
    [jobId],
  );
  return r.rowCount;
}

/** Clés naturelles des lignes valides (dépendances « plus haut dans le fichier »). */
export async function validKeys(tx: Tx, jobId: string): Promise<Map<string, number>> {
  const rows = await tx.many<{ k: string; n: number }>(`SELECT natural_key AS k, row_no AS n FROM imports.rows WHERE job_id = $1 AND validation = 'VALID' AND natural_key IS NOT NULL`, [jobId]);
  return new Map(rows.map((r) => [r.k, r.n]));
}

export async function fetchValidAfter(tx: Tx, jobId: string, afterRowNo: number, limit: number): Promise<Array<{ rowNo: number; normalized: Record<string, unknown>; naturalKey: string | null; issues: ImportIssue[] }>> {
  return await tx.many(
    `SELECT row_no AS "rowNo", normalized, natural_key AS "naturalKey", issues FROM imports.rows WHERE job_id = $1 AND validation = 'VALID' AND row_no > $2 ORDER BY row_no LIMIT $3`,
    [jobId, afterRowNo, limit],
  );
}

export interface PlanWrite {
  rowNo: number;
  action: ImportPlannedAction;
  entityId: string | null;
  validation: ImportRowValidation;
  issues: readonly ImportIssue[];
}

export async function savePlan(tx: Tx, jobId: string, results: readonly PlanWrite[]): Promise<void> {
  if (results.length === 0) return;
  await tx.query(
    `UPDATE imports.rows r SET planned_action = u.a, planned_entity_id = u.e::uuid, validation = u.v, issues = u.issues::jsonb
       FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(n, a, e, v, issues)
      WHERE r.job_id = $1 AND r.row_no = u.n`,
    [jobId, results.map((r) => r.rowNo), results.map((r) => r.action), results.map((r) => r.entityId), results.map((r) => r.validation), results.map((r) => JSON.stringify(r.issues))],
  );
}

/** Lignes à exécuter : valides et sans résultat, dans l'ordre du fichier. */
export async function fetchRunnable(tx: Tx, jobId: string, afterRowNo: number, limit: number): Promise<Array<{ rowNo: number; normalized: Record<string, unknown>; naturalKey: string | null; plannedAction: ImportPlannedAction; plannedEntityId: string | null; issues: ImportIssue[] }>> {
  return await tx.many(
    `SELECT row_no AS "rowNo", normalized, natural_key AS "naturalKey", planned_action AS "plannedAction", planned_entity_id AS "plannedEntityId", issues
       FROM imports.rows WHERE job_id = $1 AND validation = 'VALID' AND outcome IS NULL AND row_no > $2 ORDER BY row_no LIMIT $3`,
    [jobId, afterRowNo, limit],
  );
}

export interface OutcomeWrite {
  rowNo: number;
  outcome: ImportOutcome;
  entityId: string | null;
  issues: readonly ImportIssue[];
}

export async function saveOutcomes(tx: Tx, jobId: string, results: readonly OutcomeWrite[], now: Date): Promise<void> {
  for (let i = 0; i < results.length; i += CHUNK) {
    const part = results.slice(i, i + CHUNK);
    await tx.query(
      `UPDATE imports.rows r SET outcome = u.o, entity_id = u.e::uuid, outcome_issues = u.issues::jsonb, processed_at = $2
         FROM unnest($3::int[], $4::text[], $5::text[], $6::text[]) AS u(n, o, e, issues)
        WHERE r.job_id = $1 AND r.row_no = u.n`,
      [jobId, now, part.map((r) => r.rowNo), part.map((r) => r.outcome), part.map((r) => r.entityId), part.map((r) => JSON.stringify(r.issues))],
    );
  }
}

export async function stats(tx: Tx, jobId: string): Promise<RowStats> {
  const r = await tx.queryOne<Record<keyof RowStats, string>>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE validation = 'VALID')::text AS valid,
            count(*) FILTER (WHERE validation = 'INVALID')::text AS invalid,
            count(*) FILTER (WHERE validation = 'PENDING')::text AS pending,
            count(*) FILTER (WHERE validation = 'VALID' AND planned_action = 'CREATE')::text AS "plannedCreate",
            count(*) FILTER (WHERE validation = 'VALID' AND planned_action = 'UPDATE')::text AS "plannedUpdate",
            count(*) FILTER (WHERE validation = 'VALID' AND planned_action = 'SKIP')::text AS "plannedSkip",
            count(*) FILTER (WHERE outcome = 'CREATED')::text AS created,
            count(*) FILTER (WHERE outcome = 'UPDATED')::text AS updated,
            count(*) FILTER (WHERE outcome = 'SKIPPED')::text AS skipped,
            count(*) FILTER (WHERE validation = 'INVALID' OR outcome = 'FAILED')::text AS failed,
            count(*) FILTER (WHERE outcome IS NOT NULL)::text AS processed,
            count(*) FILTER (WHERE issues @> '[{"severity":"WARNING"}]'::jsonb)::text AS "withWarnings"
       FROM imports.rows WHERE job_id = $1`,
    [jobId],
  );
  const n = (v: string | undefined): number => Number(v ?? 0);
  return {
    total: n(r?.total),
    valid: n(r?.valid),
    invalid: n(r?.invalid),
    pending: n(r?.pending),
    plannedCreate: n(r?.plannedCreate),
    plannedUpdate: n(r?.plannedUpdate),
    plannedSkip: n(r?.plannedSkip),
    created: n(r?.created),
    updated: n(r?.updated),
    skipped: n(r?.skipped),
    failed: n(r?.failed),
    processed: n(r?.processed),
    withWarnings: n(r?.withWarnings),
  };
}

export interface RowFilter {
  validation?: ImportRowValidation | undefined;
  action?: ImportPlannedAction | undefined;
  outcome?: ImportOutcome | undefined;
  onlyProblems?: boolean | undefined;
  column?: string | undefined;
  code?: string | undefined;
  rowNo?: number | undefined;
  limit: number;
  offset: number;
}

export async function listRows(tx: Tx, jobId: string, filter: RowFilter): Promise<{ items: RowRecord[]; total: number }> {
  const params: unknown[] = [jobId];
  const where: string[] = ["job_id = $1"];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.validation) add("validation = ?", filter.validation);
  if (filter.action) add("planned_action = ?", filter.action);
  if (filter.outcome) add("outcome = ?", filter.outcome);
  if (filter.rowNo) add("row_no = ?", filter.rowNo);
  if (filter.onlyProblems) where.push(`(validation = 'INVALID' OR outcome = 'FAILED' OR issues @> '[{"severity":"WARNING"}]'::jsonb)`);
  if (filter.column) {
    params.push(JSON.stringify([{ column: filter.column }]));
    const p = `$${params.length}::jsonb`;
    where.push(`(issues @> ${p} OR outcome_issues @> ${p})`);
  }
  if (filter.code) {
    params.push(JSON.stringify([{ code: filter.code }]));
    const p = `$${params.length}::jsonb`;
    where.push(`(issues @> ${p} OR outcome_issues @> ${p})`);
  }
  const clause = where.join(" AND ");
  const total = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM imports.rows WHERE ${clause}`, params);
  const items = await tx.many<RowRecord>(`SELECT ${ROW_COLUMNS} FROM imports.rows WHERE ${clause} ORDER BY row_no LIMIT ${filter.limit} OFFSET ${filter.offset}`, params);
  return { items, total: Number(total?.n ?? 0) };
}

/** Erreurs les plus fréquentes (validation ou exécution) avec un exemple. */
export async function topIssues(tx: Tx, jobId: string, source: "issues" | "outcome_issues", limit = 8): Promise<Array<{ code: string; column: string | null; count: number; example: string }>> {
  const rows = await tx.many<{ code: string; column: string | null; count: string; example: string }>(
    `SELECT i->>'code' AS code, i->>'column' AS column, count(*)::text AS count, (array_agg(i->>'message' ORDER BY r.row_no))[1] AS example
       FROM imports.rows r, jsonb_array_elements(r.${source}) AS i
      WHERE r.job_id = $1 AND r.${source} IS NOT NULL AND i->>'severity' = 'ERROR'
      GROUP BY 1, 2 ORDER BY count(*) DESC, 1 LIMIT ${limit}`,
    [jobId],
  );
  return rows.map((r) => ({ code: r.code, column: r.column, count: Number(r.count), example: r.example }));
}

export async function samples(tx: Tx, jobId: string, where: "CREATE" | "UPDATE" | "SKIP" | "ERROR", limit = 10): Promise<RowRecord[]> {
  const cond = where === "ERROR" ? `validation = 'INVALID'` : `validation = 'VALID' AND planned_action = '${where}'`;
  return await tx.many<RowRecord>(`SELECT ${ROW_COLUMNS} FROM imports.rows WHERE job_id = $1 AND ${cond} ORDER BY row_no LIMIT ${limit}`, [jobId]);
}

/** Lecture paginée pour le rapport téléchargeable (curseur = dernier numéro de ligne). */
export async function reportPage(tx: Tx, jobId: string, afterRowNo: number, limit: number, onlyProblems: boolean): Promise<RowRecord[]> {
  return await tx.many<RowRecord>(
    `SELECT ${ROW_COLUMNS} FROM imports.rows WHERE job_id = $1 AND row_no > $2 ${onlyProblems ? `AND (validation = 'INVALID' OR outcome = 'FAILED')` : ""} ORDER BY row_no LIMIT $3`,
    [jobId, afterRowNo, limit],
  );
}

/** Purge des données personnelles brutes (le rapport par ligne reste). */
export async function purgeRaw(tx: Tx, jobId: string): Promise<void> {
  await tx.query(`UPDATE imports.rows SET raw = NULL, normalized = NULL WHERE job_id = $1`, [jobId]);
}
