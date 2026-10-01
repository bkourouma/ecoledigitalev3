/**
 * Catalogues GLOBAUX (plans, packs, features, plan_features) : sans `tenant_id`,
 * donc hors RLS. Les écritures passent par `SystemDb` (console plateforme).
 */
import type { Tx } from "@ecoledigitale/database";
import type { FeaturePack } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { FeatureRecord, PackRecord, PlanRecord } from "../domain/entities";

interface PlanRow {
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  feature_keys: string[];
}

const toPlan = (r: PlanRow): PlanRecord => ({
  key: r.key,
  label: r.label,
  description: r.description,
  sortOrder: Number(r.sort_order),
  active: r.active,
  featureKeys: [...r.feature_keys].sort(),
});

const PLAN_SELECT = `SELECT p.key, p.label, p.description, p.sort_order, p.active,
       COALESCE(array_agg(pf.feature_key ORDER BY pf.feature_key) FILTER (WHERE pf.feature_key IS NOT NULL), '{}') AS feature_keys
  FROM entitlements.plans p
  LEFT JOIN entitlements.plan_features pf ON pf.plan_key = p.key`;

export async function listPlans(tx: Tx): Promise<PlanRecord[]> {
  return (await tx.many<PlanRow>(`${PLAN_SELECT} GROUP BY p.id ORDER BY p.sort_order, p.key`)).map(toPlan);
}

export async function getPlan(tx: Tx, key: string): Promise<PlanRecord | null> {
  const row = await tx.queryOne<PlanRow>(`${PLAN_SELECT} WHERE p.key = $1 GROUP BY p.id`, [key]);
  return row ? toPlan(row) : null;
}

export interface PlanFields {
  label: string;
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
}

/** Crée le plan, ou met à jour les champs fournis (les autres sont conservés). */
export async function upsertPlan(tx: Tx, key: string, f: PlanFields, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO entitlements.plans (key, label, description, sort_order, active, created_at, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, true), $6, $6)
     ON CONFLICT (key) DO UPDATE
        SET label = EXCLUDED.label,
            description = CASE WHEN $7::boolean THEN EXCLUDED.description ELSE entitlements.plans.description END,
            sort_order = CASE WHEN $4::integer IS NULL THEN entitlements.plans.sort_order ELSE EXCLUDED.sort_order END,
            active = CASE WHEN $5::boolean IS NULL THEN entitlements.plans.active ELSE EXCLUDED.active END,
            updated_at = EXCLUDED.updated_at`,
    [key, f.label, f.description ?? null, f.sortOrder ?? null, f.active ?? null, now, f.description !== undefined],
  );
}

/** Remplace l'ensemble des features d'un plan. Les clés doivent exister (FK). */
export async function setPlanFeatures(tx: Tx, planKey: string, featureKeys: readonly string[]): Promise<void> {
  await tx.query("DELETE FROM entitlements.plan_features WHERE plan_key = $1 AND feature_key <> ALL($2::text[])", [
    planKey,
    featureKeys,
  ]);
  if (featureKeys.length > 0) {
    await tx.query(
      `INSERT INTO entitlements.plan_features (plan_key, feature_key)
       SELECT $1, k FROM unnest($2::text[]) AS k
       ON CONFLICT DO NOTHING`,
      [planKey, featureKeys],
    );
  }
}

export async function listPlanFeatureKeys(tx: Tx, planKey: string): Promise<string[]> {
  const rows = await tx.many<{ feature_key: string }>(
    "SELECT feature_key FROM entitlements.plan_features WHERE plan_key = $1 ORDER BY feature_key",
    [planKey],
  );
  return rows.map((r) => r.feature_key);
}

interface PackRow {
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
}

export async function listPacks(tx: Tx): Promise<PackRecord[]> {
  const rows = await tx.many<PackRow>(
    "SELECT key, label, description, sort_order, active FROM entitlements.packs ORDER BY sort_order, key",
  );
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    sortOrder: Number(r.sort_order),
    active: r.active,
  }));
}

interface FeatureRow {
  key: string;
  label: string;
  module_key: string;
  packs: FeaturePack[];
  retired_at: Date | null;
}

const toFeature = (r: FeatureRow): FeatureRecord => ({
  key: r.key,
  label: r.label,
  moduleKey: r.module_key,
  packs: [...r.packs].sort() as FeaturePack[],
  retired: r.retired_at !== null,
});

export async function listFeatures(tx: Tx): Promise<FeatureRecord[]> {
  return (
    await tx.many<FeatureRow>("SELECT key, label, module_key, packs, retired_at FROM entitlements.features ORDER BY key")
  ).map(toFeature);
}

export interface FeatureUpsert {
  key: string;
  label: string;
  moduleKey: string;
  packs: readonly string[];
}

export interface SyncCounts {
  created: number;
  updated: number;
  retired: number;
  restored: number;
  unchanged: number;
}

/**
 * Aligne la table `features` sur `wanted` : crée, met à jour, réactive les
 * features présentes ; RETIRE (retired_at) celles du périmètre `retireScope` qui n'y
 * figurent plus — on ne supprime jamais (des surcharges et des plans les référencent).
 */
export async function syncFeatures(
  tx: Tx,
  wanted: readonly FeatureUpsert[],
  now: Date,
  /** Modules dont les features absentes sont retirées ; `all` = tout le catalogue (synchronisation complète). */
  retireScope: ReadonlySet<string> | "all",
): Promise<SyncCounts> {
  const existing = new Map((await listFeatures(tx)).map((f) => [f.key, f]));
  const counts: SyncCounts = { created: 0, updated: 0, retired: 0, restored: 0, unchanged: 0 };

  for (const f of wanted) {
    const before = existing.get(f.key);
    const packs = [...new Set(f.packs)].sort();
    if (!before) {
      await tx.query(
        `INSERT INTO entitlements.features (key, label, module_key, packs, created_at, updated_at)
         VALUES ($1, $2, $3, $4::text[], $5, $5)`,
        [f.key, f.label, f.moduleKey, packs, now],
      );
      counts.created += 1;
      continue;
    }
    const changed =
      before.label !== f.label ||
      before.moduleKey !== f.moduleKey ||
      before.packs.length !== packs.length ||
      before.packs.some((p, i) => p !== packs[i]);
    if (changed || before.retired) {
      await tx.query(
        `UPDATE entitlements.features
            SET label = $2, module_key = $3, packs = $4::text[], retired_at = NULL, updated_at = $5
          WHERE key = $1`,
        [f.key, f.label, f.moduleKey, packs, now],
      );
      if (before.retired) counts.restored += 1;
      else counts.updated += 1;
    } else {
      counts.unchanged += 1;
    }
  }

  const wantedKeys = new Set(wanted.map((f) => f.key));
  const toRetire = [...existing.values()]
    .filter((f) => !f.retired && !wantedKeys.has(f.key) && (retireScope === "all" || retireScope.has(f.moduleKey)))
    .map((f) => f.key);
  if (toRetire.length > 0) {
    await tx.query(
      "UPDATE entitlements.features SET retired_at = $2, updated_at = $2 WHERE key = ANY($1::text[])",
      [toRetire, now],
    );
    counts.retired = toRetire.length;
  }
  return counts;
}
