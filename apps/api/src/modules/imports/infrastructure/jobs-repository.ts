/**
 * Accès SQL à `imports.jobs`, `imports.settings`, `imports.mapping_templates` et `imports.entity_refs`.
 * Une fonction par requête, SQL paramétré, `Tx` reçu en paramètre (RLS : aucune requête n'a besoin de `tenant_id`).
 */
import type { Tx } from "@ecoledigitale/database";
import type { ImportFileKind, ImportJobStatus, ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";
import { DEFAULT_SETTINGS, type JobRecord, type SettingsRecord, type TemplateRecord } from "../domain/records";

const JOB_COLUMNS = `
  id, tenant_id AS "tenantId", importer_key AS "importerKey", status, file_name AS "fileName", file_kind AS "fileKind",
  file_size AS "fileSize", file_sha256 AS "fileSha256", storage_key AS "storageKey", sheet_name AS "sheetName", headers, warnings,
  total_rows AS "totalRows", duplicate_of_job_id AS "duplicateOfJobId", mapping, mapping_template_id AS "mappingTemplateId",
  options, run_mode AS "runMode", on_existing AS "onExisting", valid_rows AS "validRows", invalid_rows AS "invalidRows",
  planned_create AS "plannedCreate", planned_update AS "plannedUpdate", planned_skip AS "plannedSkip",
  validation_progress AS "validationProgress", validated_at AS "validatedAt", processed_count AS "processedCount",
  created_count AS "createdCount", updated_count AS "updatedCount", skipped_count AS "skippedCount", failed_count AS "failedCount",
  run_attempts AS "runAttempts", run_requested_at AS "runRequestedAt", run_requested_by AS "runRequestedBy",
  started_at AS "startedAt", finished_at AS "finishedAt", duration_ms AS "durationMs", cancel_requested AS "cancelRequested",
  lease_owner AS "leaseOwner", lease_until AS "leaseUntil", heartbeat_at AS "heartbeatAt", actor_user_id AS "actorUserId",
  actor_roles AS "actorRoles", actor_mfa AS "actorMfa", actor_institution_id AS "actorInstitutionId", actor_campus_id AS "actorCampusId",
  error_code AS "errorCode", error_message AS "errorMessage", raw_purged_at AS "rawPurgedAt", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface NewJob {
  id: string;
  tenantId: string;
  importerKey: ImporterKey;
  fileName: string;
  fileKind: ImportFileKind;
  fileSize: number;
  fileSha256: string;
  storageKey: string | null;
  sheetName: string | null;
  headers: string[];
  warnings: unknown[];
  duplicateOfJobId: string | null;
  createdBy: string;
}

export async function insertJob(tx: Tx, job: NewJob, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO imports.jobs (id, tenant_id, importer_key, file_name, file_kind, file_size, file_sha256, storage_key, sheet_name, headers, warnings,
                               duplicate_of_job_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $14)`,
    [job.id, job.tenantId, job.importerKey, job.fileName, job.fileKind, job.fileSize, job.fileSha256, job.storageKey, job.sheetName, JSON.stringify(job.headers), JSON.stringify(job.warnings), job.duplicateOfJobId, job.createdBy, now],
  );
}

export async function getJob(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<JobRecord | null> {
  return await tx.queryOne<JobRecord>(`SELECT ${JOB_COLUMNS} FROM imports.jobs WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
}

export interface JobFilter {
  importerKey?: ImporterKey | undefined;
  status?: ImportJobStatus | undefined;
  createdBy?: string | undefined;
  limit: number;
  offset: number;
}

export async function listJobs(tx: Tx, filter: JobFilter): Promise<{ items: JobRecord[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.importerKey) add("importer_key = ?", filter.importerKey);
  if (filter.status) add("status = ?", filter.status);
  if (filter.createdBy) add("created_by = ?", filter.createdBy);
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const total = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM imports.jobs ${clause}`, params);
  const items = await tx.many<JobRecord>(`SELECT ${JOB_COLUMNS} FROM imports.jobs ${clause} ORDER BY created_at DESC, id DESC LIMIT ${filter.limit} OFFSET ${filter.offset}`, params);
  return { items, total: Number(total?.n ?? 0) };
}

/** Colonnes modifiables par `updateJob` (nom de propriété -> colonne ; `json` : sérialisé en jsonb). */
const UPDATABLE: Readonly<Record<string, { column: string; json?: boolean }>> = {
  status: { column: "status" },
  storageKey: { column: "storage_key" },
  headers: { column: "headers", json: true },
  warnings: { column: "warnings", json: true },
  totalRows: { column: "total_rows" },
  mapping: { column: "mapping", json: true },
  mappingTemplateId: { column: "mapping_template_id" },
  options: { column: "options", json: true },
  runMode: { column: "run_mode" },
  onExisting: { column: "on_existing" },
  validRows: { column: "valid_rows" },
  invalidRows: { column: "invalid_rows" },
  plannedCreate: { column: "planned_create" },
  plannedUpdate: { column: "planned_update" },
  plannedSkip: { column: "planned_skip" },
  validationProgress: { column: "validation_progress" },
  validatedAt: { column: "validated_at" },
  processedCount: { column: "processed_count" },
  createdCount: { column: "created_count" },
  updatedCount: { column: "updated_count" },
  skippedCount: { column: "skipped_count" },
  failedCount: { column: "failed_count" },
  runRequestedAt: { column: "run_requested_at" },
  runRequestedBy: { column: "run_requested_by" },
  startedAt: { column: "started_at" },
  finishedAt: { column: "finished_at" },
  durationMs: { column: "duration_ms" },
  cancelRequested: { column: "cancel_requested" },
  leaseOwner: { column: "lease_owner" },
  leaseUntil: { column: "lease_until" },
  heartbeatAt: { column: "heartbeat_at" },
  actorUserId: { column: "actor_user_id" },
  actorRoles: { column: "actor_roles" },
  actorMfa: { column: "actor_mfa" },
  actorInstitutionId: { column: "actor_institution_id" },
  actorCampusId: { column: "actor_campus_id" },
  errorCode: { column: "error_code" },
  errorMessage: { column: "error_message" },
  rawPurgedAt: { column: "raw_purged_at" },
};

export type JobPatch = Partial<Record<keyof typeof UPDATABLE, unknown>>;

export async function updateJob(tx: Tx, id: string, patch: JobPatch, now: Date): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const def = UPDATABLE[key];
    if (!def) throw new Error(`Colonne non modifiable : ${key}`);
    params.push(def.json ? JSON.stringify(value) : value);
    sets.push(`${def.column} = $${params.length}${def.json ? "::jsonb" : ""}`);
  }
  params.push(now);
  sets.push(`updated_at = $${params.length}`);
  await tx.query(`UPDATE imports.jobs SET ${sets.join(", ")} WHERE id = $1`, params);
}

/** Imports non terminés du tenant (quota). */
export async function countActiveJobs(tx: Tx): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM imports.jobs WHERE status IN ('UPLOADED','MAPPED','VALIDATING','VALIDATED','QUEUED','RUNNING')`);
  return Number(r?.n ?? 0);
}

/** Imports créés depuis `since` (quota journalier). */
export async function countJobsSince(tx: Tx, since: Date): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM imports.jobs WHERE created_at >= $1`, [since]);
  return Number(r?.n ?? 0);
}

/** Verrou consultatif par tenant : sérialise les contrôles de quota et la création d'un import. */
export async function lockTenantQuota(tx: Tx): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('imports.quota:' || current_setting('app.tenant_id')))`);
}

export async function findPreviousImportOfFile(tx: Tx, importerKey: ImporterKey, sha256: string): Promise<{ id: string } | null> {
  return await tx.queryOne<{ id: string }>(
    `SELECT id FROM imports.jobs WHERE importer_key = $1 AND file_sha256 = $2 AND status IN ('COMPLETED','COMPLETED_WITH_ERRORS','RUNNING','QUEUED')
     ORDER BY created_at DESC LIMIT 1`,
    [importerKey, sha256],
  );
}

// ---------------------------------------------------------------------------
// Bail d'exécution (validation ou import) : un seul exécutant à la fois, reprise après expiration
// ---------------------------------------------------------------------------

/**
 * Prend le bail d'un import : réussit si l'import est dans l'un des états visés ET sans exécutant vivant (bail absent ou
 * expiré) ou déjà à nous. Le temps est celui de la BASE (une seule horloge pour tous les exécutants).
 */
export async function claimJob(tx: Tx, id: string, statuses: readonly ImportJobStatus[], owner: string, leaseSeconds: number): Promise<JobRecord | null> {
  return await tx.queryOne<JobRecord>(
    `UPDATE imports.jobs
        SET lease_owner = $3, lease_until = now() + make_interval(secs => $4), heartbeat_at = now(), updated_at = now()
      WHERE id = $1 AND status = ANY($2::text[]) AND (lease_until IS NULL OR lease_until < now() OR lease_owner = $3)
      RETURNING ${JOB_COLUMNS}`,
    [id, statuses, owner, leaseSeconds],
  );
}

export interface HeartbeatResult {
  /** `false` : le bail a été perdu (repris par un autre exécutant, ou import terminé) : s'arrêter sans écrire. */
  held: boolean;
  cancelRequested: boolean;
}

export async function heartbeatJob(tx: Tx, id: string, owner: string, leaseSeconds: number, progress: { processed?: number; validation?: number } = {}): Promise<HeartbeatResult> {
  const row = await tx.queryOne<{ cancelRequested: boolean }>(
    `UPDATE imports.jobs
        SET lease_until = now() + make_interval(secs => $3), heartbeat_at = now(),
            processed_count = GREATEST(processed_count, COALESCE($4::int, 0)), validation_progress = GREATEST(validation_progress, COALESCE($5::int, 0)), updated_at = now()
      WHERE id = $1 AND lease_owner = $2 AND status IN ('VALIDATING','RUNNING')
      RETURNING cancel_requested AS "cancelRequested"`,
    [id, owner, leaseSeconds, progress.processed ?? null, progress.validation ?? null],
  );
  return row ? { held: true, cancelRequested: row.cancelRequested } : { held: false, cancelRequested: false };
}

/** Libère le bail (reprise immédiate possible par un autre exécutant). */
export async function releaseLease(tx: Tx, id: string, owner: string): Promise<void> {
  await tx.query(`UPDATE imports.jobs SET lease_owner = NULL, lease_until = NULL, updated_at = now() WHERE id = $1 AND lease_owner = $2`, [id, owner]);
}

/** Imports à relancer par le job de filet : exécutant mort (bail expiré) ou demande jamais prise en charge. */
export async function listStalledJobs(tx: Tx, staleSeconds: number): Promise<Array<{ id: string; status: ImportJobStatus }>> {
  return await tx.many<{ id: string; status: ImportJobStatus }>(
    `SELECT id, status FROM imports.jobs
      WHERE (status IN ('RUNNING','VALIDATING') AND lease_until IS NOT NULL AND lease_until < now() - interval '5 seconds')
         OR (status IN ('QUEUED','VALIDATING','RUNNING') AND lease_until IS NULL
             AND COALESCE(run_requested_at, updated_at) < now() - make_interval(secs => $1))
      ORDER BY created_at LIMIT 200`,
    [staleSeconds],
  );
}

/** Marque la republication (évite de republier à chaque passage du job de filet). */
export async function touchRepublished(tx: Tx, id: string): Promise<boolean> {
  const r = await tx.query(`UPDATE imports.jobs SET run_requested_at = now(), updated_at = now() WHERE id = $1 AND COALESCE(run_requested_at, updated_at) < now() - interval '30 seconds'`, [id]);
  return r.rowCount > 0;
}

/** Imports terminés (ou abandonnés) dont les lignes brutes doivent être purgées. */
export async function listJobsToPurge(tx: Tx, retentionDays: number): Promise<Array<{ id: string; storageKey: string | null; status: ImportJobStatus }>> {
  return await tx.many<{ id: string; storageKey: string | null; status: ImportJobStatus }>(
    `SELECT id, storage_key AS "storageKey", status FROM imports.jobs
      WHERE raw_purged_at IS NULL AND COALESCE(finished_at, updated_at) < now() - make_interval(days => $1)
        AND status IN ('COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED','UPLOADED','MAPPED','VALIDATED')
      ORDER BY created_at LIMIT 100`,
    [retentionDays],
  );
}

/** Brouillons abandonnés (jamais lancés) : ils sont annulés pour libérer le quota d'imports actifs. */
export async function cancelAbandonedDrafts(tx: Tx, hours: number): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `UPDATE imports.jobs SET status = 'CANCELLED', finished_at = now(), error_code = 'imports.cancelled', error_message = 'Brouillon abandonné : annulé automatiquement.', updated_at = now()
      WHERE status IN ('UPLOADED','MAPPED','VALIDATED') AND updated_at < now() - make_interval(hours => $1) RETURNING id`,
    [hours],
  );
  return rows.map((r) => r.id);
}

export async function deleteJob(tx: Tx, id: string): Promise<void> {
  await tx.query(`DELETE FROM imports.jobs WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

export async function getSettings(tx: Tx): Promise<SettingsRecord> {
  const row = await tx.queryOne<SettingsRecord>(
    `SELECT max_rows AS "maxRows", max_columns AS "maxColumns", max_file_bytes AS "maxFileBytes", batch_size AS "batchSize",
            all_or_nothing_max_rows AS "allOrNothingMaxRows", max_active_jobs AS "maxActiveJobs", max_jobs_per_day AS "maxJobsPerDay",
            retention_days AS "retentionDays"
       FROM imports.settings`,
  );
  return row ?? { ...DEFAULT_SETTINGS };
}

export async function upsertSettings(tx: Tx, tenantId: string, next: SettingsRecord, userId: string | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO imports.settings (tenant_id, max_rows, max_columns, max_file_bytes, batch_size, all_or_nothing_max_rows, max_active_jobs, max_jobs_per_day, retention_days, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id) DO UPDATE SET max_rows = EXCLUDED.max_rows, max_columns = EXCLUDED.max_columns, max_file_bytes = EXCLUDED.max_file_bytes,
       batch_size = EXCLUDED.batch_size, all_or_nothing_max_rows = EXCLUDED.all_or_nothing_max_rows, max_active_jobs = EXCLUDED.max_active_jobs,
       max_jobs_per_day = EXCLUDED.max_jobs_per_day, retention_days = EXCLUDED.retention_days, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, next.maxRows, next.maxColumns, next.maxFileBytes, next.batchSize, next.allOrNothingMaxRows, next.maxActiveJobs, next.maxJobsPerDay, next.retentionDays, userId, now],
  );
}

// ---------------------------------------------------------------------------
// Modèles de mapping
// ---------------------------------------------------------------------------

const TEMPLATE_COLUMNS = `id, tenant_id AS "tenantId", importer_key AS "importerKey", name, mapping, headers, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listTemplates(tx: Tx, importerKey?: ImporterKey): Promise<TemplateRecord[]> {
  return await tx.many<TemplateRecord>(`SELECT ${TEMPLATE_COLUMNS} FROM imports.mapping_templates ${importerKey ? "WHERE importer_key = $1" : ""} ORDER BY name`, importerKey ? [importerKey] : []);
}

export async function getTemplate(tx: Tx, id: string): Promise<TemplateRecord | null> {
  return await tx.queryOne<TemplateRecord>(`SELECT ${TEMPLATE_COLUMNS} FROM imports.mapping_templates WHERE id = $1`, [id]);
}

export async function insertTemplate(tx: Tx, t: { id: string; tenantId: string; importerKey: ImporterKey; name: string; mapping: unknown; headers: unknown; createdBy: string | null }, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO imports.mapping_templates (id, tenant_id, importer_key, name, mapping, headers, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $8)`,
    [t.id, t.tenantId, t.importerKey, t.name, JSON.stringify(t.mapping), JSON.stringify(t.headers), t.createdBy, now],
  );
}

export async function updateTemplate(tx: Tx, id: string, patch: { name?: string | undefined; mapping?: unknown }, now: Date): Promise<void> {
  await tx.query(`UPDATE imports.mapping_templates SET name = COALESCE($2, name), mapping = COALESCE($3::jsonb, mapping), updated_at = $4 WHERE id = $1`, [id, patch.name ?? null, patch.mapping === undefined ? null : JSON.stringify(patch.mapping), now]);
}

export async function deleteTemplate(tx: Tx, id: string): Promise<void> {
  await tx.query(`DELETE FROM imports.mapping_templates WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Références d'idempotence
// ---------------------------------------------------------------------------

export async function getRefs(tx: Tx, importerKey: ImporterKey, keys: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const rows = await tx.many<{ key: string; id: string }>(`SELECT natural_key AS key, entity_id AS id FROM imports.entity_refs WHERE importer_key = $1 AND natural_key = ANY($2::text[])`, [importerKey, [...new Set(keys)]]);
  for (const r of rows) out.set(r.key, r.id);
  return out;
}

export interface RefWrite {
  key: string;
  entityType: string;
  entityId: string;
}

export async function upsertRefs(tx: Tx, tenantId: string, importerKey: ImporterKey, jobId: string, refs: readonly RefWrite[]): Promise<void> {
  if (refs.length === 0) return;
  const unique = new Map<string, RefWrite>();
  for (const r of refs) unique.set(r.key, r);
  const list = [...unique.values()];
  await tx.query(
    `INSERT INTO imports.entity_refs (tenant_id, importer_key, natural_key, entity_type, entity_id, first_job_id, last_job_id)
     SELECT $1, $2, u.k, u.t, u.e::uuid, $3, $3 FROM unnest($4::text[], $5::text[], $6::text[]) AS u(k, t, e)
     ON CONFLICT (tenant_id, importer_key, natural_key) DO UPDATE SET entity_id = EXCLUDED.entity_id, last_job_id = EXCLUDED.last_job_id, updated_at = now()`,
    [tenantId, importerKey, jobId, list.map((r) => r.key), list.map((r) => r.entityType), list.map((r) => r.entityId)],
  );
}
