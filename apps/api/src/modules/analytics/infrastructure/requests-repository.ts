/**
 * File de rafraîchissement (`analytics.refresh_requests`) et état de fraîcheur (`analytics.refresh_state`).
 *
 * Coalescence : une seule demande PENDING par (genre, périmètre) — l'index unique partiel l'impose ; une rafale
 * d'événements ajoute des causes à la demande existante sans en créer d'autre ni repousser son échéance (la lecture de
 * la source voit l'état le plus récent quand elle s'exécute).
 */
import type { Tx } from "@ecoledigitale/database";
import type { RefreshKind } from "../domain/types";

export type RequestStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "UNAVAILABLE";

export interface RefreshRequestRow {
  id: string;
  tenantId: string;
  kind: RefreshKind;
  scopeKey: string;
  causes: Array<{ event: string; id: string | null; at: string }>;
  requestedAt: Date;
  notBefore: Date;
  status: RequestStatus;
  attempts: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface RequestSqlRow {
  id: string;
  tenant_id: string;
  kind: RefreshKind;
  scope_key: string;
  causes: RefreshRequestRow["causes"];
  requested_at: Date;
  not_before: Date;
  status: RequestStatus;
  attempts: number;
  last_error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

const toRow = (r: RequestSqlRow): RefreshRequestRow => ({
  id: r.id,
  tenantId: r.tenant_id,
  kind: r.kind,
  scopeKey: r.scope_key,
  causes: r.causes,
  requestedAt: r.requested_at,
  notBefore: r.not_before,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const MAX_CAUSES = 20;

/** Crée la demande ou l'enrichit (coalescence). Renvoie `true` si une NOUVELLE demande a été créée. */
export async function enqueueRequest(
  tx: Tx,
  input: { id: string; tenantId: string; kind: RefreshKind; scopeKey: string; cause: { event: string; id: string | null; at: string }; now: Date; notBefore: Date },
): Promise<boolean> {
  const r = await tx.queryOne<{ created: boolean }>(
    `INSERT INTO analytics.refresh_requests (id, tenant_id, kind, scope_key, causes, requested_at, not_before, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'PENDING')
     ON CONFLICT (tenant_id, kind, scope_key) WHERE status = 'PENDING'
     DO UPDATE SET causes = CASE WHEN jsonb_array_length(analytics.refresh_requests.causes) < ${MAX_CAUSES}
                                 THEN analytics.refresh_requests.causes || EXCLUDED.causes
                                 ELSE analytics.refresh_requests.causes END,
                   not_before = LEAST(analytics.refresh_requests.not_before, EXCLUDED.not_before)
     RETURNING (xmax = 0) AS created`,
    [input.id, input.tenantId, input.kind, input.scopeKey, JSON.stringify([input.cause]), input.now, input.notBefore],
  );
  return r?.created ?? false;
}

/** Remet en file les demandes RUNNING abandonnées (processus mort) ; supprime celles qu'une demande PENDING remplace déjà. */
export async function reclaimStuck(tx: Tx, olderThan: Date): Promise<number> {
  await tx.query(
    `DELETE FROM analytics.refresh_requests s
      WHERE s.status = 'RUNNING' AND s.started_at < $1
        AND EXISTS (SELECT 1 FROM analytics.refresh_requests p
                     WHERE p.status = 'PENDING' AND p.tenant_id = s.tenant_id AND p.kind = s.kind AND p.scope_key = s.scope_key)`,
    [olderThan],
  );
  const r = await tx.query(`UPDATE analytics.refresh_requests SET status = 'PENDING', started_at = NULL WHERE status = 'RUNNING' AND started_at < $1`, [olderThan]);
  return r.rowCount;
}

/** Réserve (SKIP LOCKED) les demandes échues, dans l'ordre des genres puis de l'échéance. */
export async function leaseDue(tx: Tx, now: Date, limit: number): Promise<RefreshRequestRow[]> {
  const rows = await tx.many<RequestSqlRow>(
    `UPDATE analytics.refresh_requests r
        SET status = 'RUNNING', started_at = $1, attempts = r.attempts + 1
      WHERE r.id IN (SELECT id FROM analytics.refresh_requests
                      WHERE status = 'PENDING' AND not_before <= $1
                      ORDER BY not_before, requested_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING r.*`,
    [now, limit],
  );
  return rows.map(toRow);
}

export async function finishRequest(tx: Tx, input: { id: string; status: Exclude<RequestStatus, "PENDING" | "RUNNING">; error: string | null; now: Date }): Promise<void> {
  await tx.query(`UPDATE analytics.refresh_requests SET status = $2, last_error = $3, finished_at = $4 WHERE id = $1`, [input.id, input.status, input.error, input.now]);
}

/** Échec transitoire : la demande redevient PENDING avec une nouvelle échéance (reprise), jusqu'à épuisement des tentatives. */
export async function retryRequest(tx: Tx, input: { id: string; error: string; notBefore: Date }): Promise<boolean> {
  const r = await tx.query(
    `UPDATE analytics.refresh_requests SET status = 'PENDING', last_error = $2, not_before = $3, started_at = NULL
      WHERE id = $1
        AND NOT EXISTS (SELECT 1 FROM analytics.refresh_requests p, analytics.refresh_requests me
                         WHERE me.id = $1 AND p.status = 'PENDING' AND p.tenant_id = me.tenant_id AND p.kind = me.kind AND p.scope_key = me.scope_key)`,
    [input.id, input.error, input.notBefore],
  );
  return r.rowCount > 0;
}

export async function listRequests(tx: Tx, input: { status?: RequestStatus | undefined; limit: number }): Promise<RefreshRequestRow[]> {
  const rows = await tx.many<RequestSqlRow>(
    `SELECT * FROM analytics.refresh_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY requested_at DESC, id LIMIT $2`,
    [input.status ?? null, input.limit],
  );
  return rows.map(toRow);
}

export async function countByStatus(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx.many<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM analytics.refresh_requests GROUP BY status`);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function purgeFinished(tx: Tx, olderThan: Date): Promise<number> {
  const r = await tx.query(`DELETE FROM analytics.refresh_requests WHERE status IN ('DONE','UNAVAILABLE','FAILED') AND finished_at < $1`, [olderThan]);
  return r.rowCount;
}

// ------------------------------------------------------------------------------------------------------------------
// État de fraîcheur
// ------------------------------------------------------------------------------------------------------------------

export interface RefreshStateRow {
  kind: RefreshKind;
  scopeKey: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastStatus: "OK" | "FAILED" | "UNAVAILABLE";
  rowsWritten: number;
  durationMs: number;
  lastError: string | null;
  contentHash: string | null;
}

interface StateSqlRow {
  kind: RefreshKind;
  scope_key: string;
  last_success_at: Date | null;
  last_attempt_at: Date | null;
  last_status: "OK" | "FAILED" | "UNAVAILABLE";
  rows_written: number;
  duration_ms: number;
  last_error: string | null;
  content_hash: string | null;
}

const toState = (r: StateSqlRow): RefreshStateRow => ({
  kind: r.kind,
  scopeKey: r.scope_key,
  lastSuccessAt: r.last_success_at,
  lastAttemptAt: r.last_attempt_at,
  lastStatus: r.last_status,
  rowsWritten: r.rows_written,
  durationMs: r.duration_ms,
  lastError: r.last_error,
  contentHash: r.content_hash,
});

export async function getState(tx: Tx, kind: RefreshKind, scopeKey: string): Promise<RefreshStateRow | null> {
  const r = await tx.queryOne<StateSqlRow>(`SELECT * FROM analytics.refresh_state WHERE kind = $1 AND scope_key = $2`, [kind, scopeKey]);
  return r ? toState(r) : null;
}

export async function listStates(tx: Tx): Promise<RefreshStateRow[]> {
  return (await tx.many<StateSqlRow>(`SELECT * FROM analytics.refresh_state ORDER BY kind, scope_key`)).map(toState);
}

/** Succès : `last_success_at` avance (même sans réécriture : la donnée a été vérifiée à cet instant). */
export async function recordSuccess(tx: Tx, input: { tenantId: string; kind: RefreshKind; scopeKey: string; now: Date; rows: number; durationMs: number; contentHash: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO analytics.refresh_state (tenant_id, kind, scope_key, last_success_at, last_attempt_at, last_status, rows_written, duration_ms, last_error, content_hash)
     VALUES ($1, $2, $3, $4, $4, 'OK', $5, $6, NULL, $7)
     ON CONFLICT (tenant_id, kind, scope_key)
     DO UPDATE SET last_success_at = EXCLUDED.last_success_at, last_attempt_at = EXCLUDED.last_attempt_at, last_status = 'OK',
                   rows_written = EXCLUDED.rows_written, duration_ms = EXCLUDED.duration_ms, last_error = NULL, content_hash = EXCLUDED.content_hash`,
    [input.tenantId, input.kind, input.scopeKey, input.now, input.rows, input.durationMs, input.contentHash],
  );
}

/** Échec ou source absente : la dernière réussite est CONSERVÉE (les chiffres restent ceux de leur `asOf`). */
export async function recordFailure(tx: Tx, input: { tenantId: string; kind: RefreshKind; scopeKey: string; now: Date; status: "FAILED" | "UNAVAILABLE"; error: string }): Promise<void> {
  await tx.query(
    `INSERT INTO analytics.refresh_state (tenant_id, kind, scope_key, last_success_at, last_attempt_at, last_status, rows_written, duration_ms, last_error)
     VALUES ($1, $2, $3, NULL, $4, $5, 0, 0, $6)
     ON CONFLICT (tenant_id, kind, scope_key)
     DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_status = EXCLUDED.last_status, last_error = EXCLUDED.last_error`,
    [input.tenantId, input.kind, input.scopeKey, input.now, input.status, input.error.slice(0, 500)],
  );
}
