import type { Tx } from "@ecoledigitale/database";
import type { SubscriptionStatus } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { SubscriptionRecord } from "../domain/entities";

interface Row {
  id: string;
  tenant_id: string;
  plan_key: string;
  packs: string[];
  status: SubscriptionStatus;
  starts_at: Date;
  ends_at: Date | null;
  learner_tier_max: number | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, tenant_id, plan_key, packs, status, starts_at, ends_at, learner_tier_max, created_at, updated_at";

const toRecord = (r: Row): SubscriptionRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  planKey: r.plan_key,
  packs: [...r.packs].sort(),
  status: r.status,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  learnerTierMax: r.learner_tier_max === null ? null : Number(r.learner_tier_max),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Abonnement « vivant » (TRIALING / ACTIVE / PAST_DUE) du tenant, s'il y en a un. */
export async function getLiveSubscription(tx: Tx, tenantId: string): Promise<SubscriptionRecord | null> {
  const row = await tx.queryOne<Row>(
    `SELECT ${COLUMNS} FROM entitlements.tenant_subscriptions
      WHERE tenant_id = $1 AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
    [tenantId],
  );
  return row ? toRecord(row) : null;
}

/** Abonnement courant : le vivant, à défaut le plus récent (CANCELED / EXPIRED), à défaut `null`. */
export async function getCurrentSubscription(tx: Tx, tenantId: string): Promise<SubscriptionRecord | null> {
  const live = await getLiveSubscription(tx, tenantId);
  if (live) return live;
  const row = await tx.queryOne<Row>(
    `SELECT ${COLUMNS} FROM entitlements.tenant_subscriptions
      WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [tenantId],
  );
  return row ? toRecord(row) : null;
}

export interface SubscriptionFields {
  planKey: string;
  packs: readonly string[];
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
  learnerTierMax: number | null;
}

export async function insertSubscription(
  tx: Tx,
  s: SubscriptionFields & { id: string; tenantId: string },
  now: Date,
): Promise<SubscriptionRecord> {
  const row = await tx.queryOne<Row>(
    `INSERT INTO entitlements.tenant_subscriptions
       (id, tenant_id, plan_key, packs, status, starts_at, ends_at, learner_tier_max, created_at, updated_at)
     VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $9)
     RETURNING ${COLUMNS}`,
    [s.id, s.tenantId, s.planKey, [...s.packs].sort(), s.status, s.startsAt, s.endsAt, s.learnerTierMax, now],
  );
  return toRecord(row as Row);
}

export async function updateSubscription(
  tx: Tx,
  id: string,
  s: SubscriptionFields,
  now: Date,
): Promise<SubscriptionRecord> {
  const row = await tx.queryOne<Row>(
    `UPDATE entitlements.tenant_subscriptions
        SET plan_key = $2, packs = $3::text[], status = $4, starts_at = $5, ends_at = $6,
            learner_tier_max = $7, updated_at = $8
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, s.planKey, [...s.packs].sort(), s.status, s.startsAt, s.endsAt, s.learnerTierMax, now],
  );
  return toRecord(row as Row);
}
