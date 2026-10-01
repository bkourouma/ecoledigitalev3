import type { Tx } from "@ecoledigitale/database";
import type { OverrideEffect } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { OverrideRecord } from "../domain/entities";

interface Row {
  id: string;
  tenant_id: string;
  feature_key: string;
  effect: OverrideEffect;
  reason: string;
  expires_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, tenant_id, feature_key, effect, reason, expires_at, created_by, created_at, updated_at";

const toRecord = (r: Row): OverrideRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  featureKey: r.feature_key,
  effect: r.effect,
  reason: r.reason,
  expiresAt: r.expires_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listOverrides(tx: Tx, tenantId: string): Promise<OverrideRecord[]> {
  return (
    await tx.many<Row>(
      `SELECT ${COLUMNS} FROM entitlements.tenant_feature_overrides WHERE tenant_id = $1 ORDER BY feature_key`,
      [tenantId],
    )
  ).map(toRecord);
}

export async function getOverride(tx: Tx, featureKey: string): Promise<OverrideRecord | null> {
  const row = await tx.queryOne<Row>(
    `SELECT ${COLUMNS} FROM entitlements.tenant_feature_overrides WHERE feature_key = $1`,
    [featureKey],
  );
  return row ? toRecord(row) : null;
}

/** Crée ou remplace la surcharge de (tenant courant, feature). */
export async function upsertOverride(
  tx: Tx,
  o: {
    id: string;
    tenantId: string;
    featureKey: string;
    effect: OverrideEffect;
    reason: string;
    expiresAt: Date | null;
    createdBy: string | null;
  },
  now: Date,
): Promise<OverrideRecord> {
  const row = await tx.queryOne<Row>(
    `INSERT INTO entitlements.tenant_feature_overrides
       (id, tenant_id, feature_key, effect, reason, expires_at, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (tenant_id, feature_key) DO UPDATE
        SET effect = EXCLUDED.effect, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at,
            created_by = EXCLUDED.created_by, updated_at = EXCLUDED.updated_at
     RETURNING ${COLUMNS}`,
    [o.id, o.tenantId, o.featureKey, o.effect, o.reason, o.expiresAt, o.createdBy, now],
  );
  return toRecord(row as Row);
}

export async function deleteOverride(tx: Tx, featureKey: string): Promise<OverrideRecord | null> {
  const row = await tx.queryOne<Row>(
    `DELETE FROM entitlements.tenant_feature_overrides WHERE feature_key = $1 RETURNING ${COLUMNS}`,
    [featureKey],
  );
  return row ? toRecord(row) : null;
}
