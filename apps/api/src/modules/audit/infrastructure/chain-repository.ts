/**
 * SQL du journal : verrou de chaîne, tête, insertion, lecture par lots.
 * Seul fichier (avec log-repository.ts) à connaître les noms de tables.
 */
import type { Tx } from "@ecoledigitale/database";
import type { HashAlg, JsonValue, StoredAuditEntry } from "../domain/types";

export type ChainTarget = { kind: "tenant"; tenantId: string } | { kind: "platform" };

export interface InsertRow {
  id: string;
  seq: number;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  impersonatedBy: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  diff: JsonValue | null;
  metadata: JsonValue | null;
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  requestId: string | null;
  reason: string | null;
  severity: string;
  hashAlg: HashAlg;
  keyId: string | null;
  prevHash: string;
  hash: string;
}

const COLUMNS =
  "id, seq, occurred_at, actor_type, actor_id, impersonated_by, action, entity, entity_id, " +
  "before, after, diff, metadata, ip, user_agent, device, request_id, reason, severity, " +
  "hash_alg, key_id, prev_hash, hash";

const json = (v: JsonValue | null): string | null => (v === null ? null : JSON.stringify(v));

/**
 * Prend le verrou advisory transactionnel de la chaîne. DOIT être un énoncé SÉPARÉ de la
 * lecture de la tête : en READ COMMITTED, la lecture faite dans la même requête que
 * l'attente du verrou utiliserait un instantané antérieur et verrait une tête périmée.
 */
export async function lockChain(tx: Tx, t: ChainTarget): Promise<void> {
  if (t.kind === "tenant") {
    await tx.query("SELECT pg_advisory_xact_lock(audit.chain_lock_key($1::uuid))", [t.tenantId]);
  } else {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ed:audit:chain:platform', 0))");
  }
}

export async function readHead(tx: Tx, t: ChainTarget): Promise<{ seq: number; hash: string } | null> {
  const row =
    t.kind === "tenant"
      ? await tx.queryOne<{ last_seq: string; last_hash: string }>(
          "SELECT last_seq, last_hash FROM audit.chain_heads WHERE tenant_id = $1",
          [t.tenantId],
        )
      : await tx.queryOne<{ last_seq: string; last_hash: string }>(
          "SELECT last_seq, last_hash FROM audit.platform_chain_head",
        );
  return row ? { seq: Number(row.last_seq), hash: row.last_hash } : null;
}

/** Garantit la partition du mois de `occurredAt` (DDL idempotente côté SQL, no-op si elle existe). */
export async function ensurePartitionFor(tx: Tx, occurredAt: string): Promise<void> {
  await tx.query("SELECT audit.ensure_partition_for($1::timestamptz)", [occurredAt]);
}

/** @returns `true` si la ligne a été écrite, `false` si ignorée (doublon en mode idempotent). */
export async function insertEntry(tx: Tx, t: ChainTarget, r: InsertRow, idempotent: boolean): Promise<boolean> {
  const values: unknown[] = [
    r.id, r.seq, r.occurredAt, r.actorType, r.actorId, r.impersonatedBy, r.action, r.entity, r.entityId,
    json(r.before), json(r.after), json(r.diff), json(r.metadata),
    r.ip, r.userAgent, r.device, r.requestId, r.reason, r.severity, r.hashAlg, r.keyId, r.prevHash, r.hash,
  ];
  const placeholders = (offset: number): string =>
    values
      .map((_, i) => {
        const n = i + 1 + offset;
        // before, after, diff, metadata = positions 10..13 (1-based) dans `values`.
        return i >= 9 && i <= 12 ? `$${n}::jsonb` : `$${n}`;
      })
      .join(", ");

  const onConflict = idempotent ? " ON CONFLICT DO NOTHING" : "";
  if (t.kind === "tenant") {
    const res = await tx.query(
      `INSERT INTO audit.audit_log (tenant_id, ${COLUMNS}) VALUES ($1, ${placeholders(1)})${onConflict}`,
      [t.tenantId, ...values],
    );
    return res.rowCount === 1;
  }
  const res = await tx.query(
    `INSERT INTO audit.platform_audit_log (${COLUMNS}) VALUES (${placeholders(0)})${onConflict}`,
    values,
  );
  return res.rowCount === 1;
}

interface RawRow {
  id: string;
  tenant_id?: string;
  seq: string;
  occurred_at: Date;
  recorded_at: Date;
  actor_type: StoredAuditEntry["actorType"];
  actor_id: string | null;
  impersonated_by: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  diff: JsonValue | null;
  metadata: JsonValue | null;
  ip: string | null;
  user_agent: string | null;
  device: string | null;
  request_id: string | null;
  reason: string | null;
  severity: StoredAuditEntry["severity"];
  hash_alg: HashAlg;
  key_id: string | null;
  prev_hash: string;
  hash: string;
}

export function mapRow(r: RawRow): StoredAuditEntry {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? null,
    seq: Number(r.seq),
    occurredAt: r.occurred_at.toISOString(),
    recordedAt: r.recorded_at.toISOString(),
    actorType: r.actor_type,
    actorId: r.actor_id,
    impersonatedBy: r.impersonated_by,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    before: r.before,
    after: r.after,
    diff: r.diff,
    metadata: r.metadata,
    ip: r.ip,
    userAgent: r.user_agent,
    device: r.device,
    requestId: r.request_id,
    reason: r.reason,
    severity: r.severity,
    hashAlg: r.hash_alg,
    keyId: r.key_id,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

export const ROW_COLUMNS_TENANT =
  "id, tenant_id, seq, occurred_at, recorded_at, actor_type, actor_id, impersonated_by, action, entity, entity_id, " +
  "before, after, diff, metadata, ip, user_agent, device, request_id, reason, severity, hash_alg, key_id, prev_hash, hash";
export const ROW_COLUMNS_PLATFORM = ROW_COLUMNS_TENANT.replace("tenant_id, ", "");

/** Lot de lignes de la chaîne, par seq croissant, `afterSeq < seq <= uptoSeq`. */
export async function readChainBatch(
  tx: Tx,
  t: ChainTarget,
  afterSeq: number,
  uptoSeq: number,
  limit: number,
): Promise<StoredAuditEntry[]> {
  const rows =
    t.kind === "tenant"
      ? await tx.many<RawRow>(
          `SELECT ${ROW_COLUMNS_TENANT} FROM audit.audit_log
            WHERE tenant_id = $1 AND seq > $2 AND seq <= $3
            ORDER BY seq ASC LIMIT $4`,
          [t.tenantId, afterSeq, uptoSeq, limit],
        )
      : await tx.many<RawRow>(
          `SELECT ${ROW_COLUMNS_PLATFORM} FROM audit.platform_audit_log
            WHERE seq > $1 AND seq <= $2 ORDER BY seq ASC LIMIT $3`,
          [afterSeq, uptoSeq, limit],
        );
  return rows.map(mapRow);
}

/** Plage de seq correspondant à une période (occurred_at), ou `null` si aucune ligne. */
export async function seqRangeForPeriod(
  tx: Tx,
  t: ChainTarget,
  from: string | undefined,
  to: string | undefined,
): Promise<{ min: number; max: number } | null> {
  const table = t.kind === "tenant" ? "audit.audit_log" : "audit.platform_audit_log";
  const scope = t.kind === "tenant" ? "tenant_id = $1 AND " : "";
  const offset = t.kind === "tenant" ? 1 : 0;
  const params: unknown[] = t.kind === "tenant" ? [t.tenantId] : [];
  params.push(from ?? null, to ?? null);
  const row = await tx.queryOne<{ min: string | null; max: string | null }>(
    `SELECT min(seq) AS min, max(seq) AS max FROM ${table}
      WHERE ${scope}($${offset + 1}::timestamptz IS NULL OR occurred_at >= $${offset + 1})
        AND ($${offset + 2}::timestamptz IS NULL OR occurred_at <= $${offset + 2})`,
    params,
  );
  if (!row || row.min === null || row.max === null) return null;
  return { min: Number(row.min), max: Number(row.max) };
}
