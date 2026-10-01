/** Accès SQL aux jetons d'abonnement iCalendar (empreintes SHA-256 uniquement). */
import type { Tx } from "@ecoledigitale/database";

export type IcsScope = "CLASSROOM" | "STAFF" | "STUDENT" | "ROOM";

export interface IcsTokenRow {
  id: string;
  scope: IcsScope;
  subjectId: string;
  label: string | null;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

const COLUMNS = "id, scope, subject_id, label, created_by, created_at, expires_at, revoked_at, last_used_at";

function map(r: Record<string, any>): IcsTokenRow {
  return {
    id: r.id,
    scope: r.scope as IcsScope,
    subjectId: r.subject_id,
    label: r.label,
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  };
}

export async function insertToken(
  tx: Tx,
  tenantId: string,
  t: { id: string; scope: IcsScope; subjectId: string; label: string | null; tokenHash: string; expiresAt: Date | null },
  by: string | null,
  at: Date,
): Promise<IcsTokenRow> {
  const r = await tx.queryOne(
    `INSERT INTO scheduling.ics_tokens (id, tenant_id, scope, subject_id, label, token_hash, created_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
    [t.id, tenantId, t.scope, t.subjectId, t.label, t.tokenHash, by, at, t.expiresAt],
  );
  return map(r as Record<string, any>);
}

export async function findTokenByHash(tx: Tx, tokenHash: string): Promise<IcsTokenRow | null> {
  const r = await tx.queryOne(`SELECT ${COLUMNS} FROM scheduling.ics_tokens WHERE tenant_id = kernel.current_tenant_id() AND token_hash = $1`, [tokenHash]);
  return r ? map(r) : null;
}

export async function getToken(tx: Tx, id: string): Promise<IcsTokenRow | null> {
  const r = await tx.queryOne(`SELECT ${COLUMNS} FROM scheduling.ics_tokens WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id]);
  return r ? map(r) : null;
}

export async function listTokens(tx: Tx, scope: IcsScope, subjectId: string): Promise<IcsTokenRow[]> {
  const rows = await tx.many(
    `SELECT ${COLUMNS} FROM scheduling.ics_tokens WHERE tenant_id = kernel.current_tenant_id() AND scope = $1 AND subject_id = $2 ORDER BY created_at DESC, id`,
    [scope, subjectId],
  );
  return rows.map(map);
}

export async function revokeToken(tx: Tx, id: string, by: string, at: Date): Promise<IcsTokenRow | null> {
  const r = await tx.queryOne(
    `UPDATE scheduling.ics_tokens SET revoked_at = $2, revoked_by = $3 WHERE tenant_id = kernel.current_tenant_id() AND id = $1 AND revoked_at IS NULL RETURNING ${COLUMNS}`,
    [id, at, by],
  );
  return r ? map(r) : null;
}

export async function touchToken(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.query(`UPDATE scheduling.ics_tokens SET last_used_at = $2 WHERE tenant_id = kernel.current_tenant_id() AND id = $1`, [id, at]);
}
