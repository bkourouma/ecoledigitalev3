/**
 * Requêtes de lecture du journal d'un tenant (la RLS borne au tenant de la transaction ;
 * `tenant_id = $1` est écrit aussi pour les index et la lisibilité).
 */
import type { Tx } from "@ecoledigitale/database";
import type { AuditSeverity, StoredAuditEntry } from "../domain/types";
import { ROW_COLUMNS_PLATFORM, ROW_COLUMNS_TENANT, mapRow } from "./chain-repository";

export interface LogFilter {
  actorId?: string;
  entity?: string;
  entityId?: string;
  /** Exact, ou préfixe avec `.*` final. */
  action?: string;
  severity?: readonly AuditSeverity[];
  from?: string;
  to?: string;
}

/** Échappe `%`, `_` et `\` pour un LIKE. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function buildWhere(tenantId: string | null, filter: LogFilter, extra: Array<{ sql: string; value: unknown }> = []) {
  // tenantId = null : journal de PLATEFORME (table globale, sans colonne tenant_id).
  const params: unknown[] = tenantId === null ? [] : [tenantId];
  const clauses: string[] = tenantId === null ? [] : ["tenant_id = $1"];
  const add = (sql: (n: string) => string, value: unknown): void => {
    params.push(value);
    clauses.push(sql(`$${params.length}`));
  };
  if (filter.actorId) add((n) => `(actor_id = ${n} OR impersonated_by = ${n})`, filter.actorId);
  if (filter.entity) add((n) => `entity = ${n}`, filter.entity);
  if (filter.entityId) add((n) => `entity_id = ${n}`, filter.entityId);
  if (filter.action) {
    if (filter.action.endsWith(".*")) add((n) => `action LIKE ${n} ESCAPE '\\'`, `${likeEscape(filter.action.slice(0, -1))}%`);
    else add((n) => `action = ${n}`, filter.action);
  }
  if (filter.severity && filter.severity.length > 0) add((n) => `severity = ANY(${n}::text[])`, [...filter.severity]);
  if (filter.from) add((n) => `occurred_at >= ${n}::timestamptz`, filter.from);
  if (filter.to) add((n) => `occurred_at <= ${n}::timestamptz`, filter.to);
  for (const e of extra) add((n) => e.sql.replace("?", n), e.value);
  return { where: clauses.length > 0 ? clauses.join(" AND ") : "TRUE", params };
}

/** Page décroissante par seq (le plus récent d'abord) ; `beforeSeq` = curseur. */
export async function listLogs(
  tx: Tx,
  tenantId: string,
  filter: LogFilter,
  beforeSeq: number | null,
  limit: number,
): Promise<StoredAuditEntry[]> {
  const extra = beforeSeq === null ? [] : [{ sql: "seq < ?::bigint", value: beforeSeq }];
  const { where, params } = buildWhere(tenantId, filter, extra);
  params.push(limit);
  const rows = await tx.many(
    `SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log WHERE ${where} ORDER BY seq DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => mapRow(r as never));
}

/**
 * Page décroissante du journal de PLATEFORME (`audit.platform_audit_log`, table globale hors RLS : à n'appeler que
 * depuis `SystemDb.run`). `seq` est sans trou et unique : le curseur `seq < beforeSeq` ne double ni n'omet aucune ligne.
 */
export async function listPlatformLogs(tx: Tx, filter: LogFilter, beforeSeq: number | null, limit: number): Promise<StoredAuditEntry[]> {
  const extra = beforeSeq === null ? [] : [{ sql: "seq < ?::bigint", value: beforeSeq }];
  const { where, params } = buildWhere(null, filter, extra);
  params.push(limit);
  const rows = await tx.many(
    `SELECT ${ROW_COLUMNS_PLATFORM} FROM audit.platform_audit_log WHERE ${where} ORDER BY seq DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => mapRow(r as never));
}

/** Export : ordre chronologique (seq croissant), borné. */
export async function exportLogs(tx: Tx, tenantId: string, filter: LogFilter, limit: number): Promise<StoredAuditEntry[]> {
  const { where, params } = buildWhere(tenantId, filter);
  params.push(limit);
  const rows = await tx.many(
    `SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log WHERE ${where} ORDER BY seq ASC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => mapRow(r as never));
}

export async function getLogById(tx: Tx, tenantId: string, id: string): Promise<StoredAuditEntry | null> {
  const rows = await tx.many(
    `SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log WHERE tenant_id = $1 AND id = $2 ORDER BY occurred_at DESC LIMIT 2`,
    [tenantId, id],
  );
  const first = rows[0];
  return first ? mapRow(first as never) : null;
}
