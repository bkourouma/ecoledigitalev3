/**
 * Catalogue GLOBAL : synchronisation des features depuis les manifestes de
 * modules, lecture du catalogue, administration des plans.
 *
 * `syncFeatureCatalog` reçoit les manifestes EN PARAMÈTRE : il ne dépend pas du
 * registre de modules (qui n'existe pas encore pour ce module). L'appelant — le
 * démarrage de l'API — lui passe `registry.manifests`.
 */
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  err,
  ok,
  type AppError,
  type ModuleManifest,
  type Result,
} from "@ecoledigitale/kernel";
import {
  FeatureKeySchema,
  FeaturePackSchema,
  SetPlanFeaturesSchema,
  UpsertPlanSchema,
} from "@ecoledigitale/contracts/src/v2/entitlements";
import type { FeatureRecord, PackRecord, PlanRecord } from "../domain/entities";
import {
  getPlan,
  listFeatures,
  listPacks,
  listPlans,
  setPlanFeatures as setPlanFeatureRows,
  syncFeatures,
  upsertPlan as upsertPlanRow,
  type FeatureUpsert,
  type SyncCounts,
} from "../infrastructure/catalog-repository";
import { parseWith, resolveDeps, runSystemResult, type EntitlementsDeps } from "./support";

export type ManifestFeatures = Pick<ModuleManifest, "key" | "features">;

export interface SyncOptions {
  /**
   * Synchronisation COMPLÈTE : retire aussi les features des modules qui ne figurent plus du tout
   * parmi les manifestes. Par défaut seules les features absentes des modules fournis sont retirées
   * (un appel partiel ne détruit donc pas le catalogue des autres modules).
   */
  fullSync?: boolean;
}

export type SyncResult = SyncCounts & { total: number };

/** Extrait et valide les features des manifestes (clés valides et uniques, packs connus). */
export function collectFeatures(manifests: readonly ManifestFeatures[]): Result<FeatureUpsert[], ValidationError> {
  const out: FeatureUpsert[] = [];
  const seen = new Map<string, string>();
  for (const m of manifests) {
    for (const f of m.features) {
      const key = FeatureKeySchema.safeParse(f.key);
      if (!key.success) {
        return err(ValidationError.field("features", `Clé de feature invalide « ${f.key} » (module ${m.key}).`, "entitlements.feature_key_invalid"));
      }
      const owner = seen.get(f.key);
      if (owner) {
        return err(
          ValidationError.field("features", `Feature « ${f.key} » déclarée par « ${owner} » et « ${m.key} ».`, "entitlements.feature_duplicate"),
        );
      }
      seen.set(f.key, m.key);
      for (const p of f.packs) {
        if (!FeaturePackSchema.safeParse(p).success) {
          return err(ValidationError.field("features", `Pack inconnu « ${p} » pour la feature « ${f.key} ».`, "entitlements.feature_pack_invalid"));
        }
      }
      out.push({ key: f.key, label: f.label, moduleKey: m.key, packs: f.packs });
    }
  }
  return ok(out);
}

export async function syncFeatureCatalog(
  deps: EntitlementsDeps,
  manifests: readonly ManifestFeatures[],
  options: SyncOptions = {},
): Promise<Result<SyncResult, AppError>> {
  const d = resolveDeps(deps);
  if (manifests.length === 0) {
    return err(
      ValidationError.field("manifests", "Aucun manifeste fourni : synchronisation refusée (elle retirerait tout le catalogue).", "entitlements.manifests_empty"),
    );
  }
  const collected = collectFeatures(manifests);
  if (!collected.ok) return collected;

  const scope = options.fullSync ? "all" : new Set(manifests.map((m) => m.key));
  const res = await runSystemResult(d.systemDb, "entitlements.sync-feature-catalog", async (tx) => {
    const counts = await syncFeatures(tx, collected.value, d.clock.now(), scope);
    return { ...counts, total: collected.value.length };
  });
  if (res.ok) d.cache?.invalidateAll();
  return res;
}

export interface Catalog {
  plans: PlanRecord[];
  packs: PackRecord[];
  features: FeatureRecord[];
}

export async function getCatalog(deps: EntitlementsDeps): Promise<Result<Catalog, AppError>> {
  const d = resolveDeps(deps);
  return runSystemResult(
    d.systemDb,
    "entitlements.read-catalog",
    async (tx) => ({ plans: await listPlans(tx), packs: await listPacks(tx), features: await listFeatures(tx) }),
    { readOnly: true },
  );
}

const PLAN_KEY = /^[A-Z][A-Z0-9_]{1,39}$/;

/** Crée ou met à jour un plan (administration plateforme). */
export async function upsertPlan(
  deps: EntitlementsDeps,
  planKey: string,
  rawInput: unknown,
): Promise<Result<PlanRecord, AppError>> {
  const d = resolveDeps(deps);
  if (!PLAN_KEY.test(planKey)) {
    return err(ValidationError.field("key", "Clé de plan invalide (majuscules, chiffres, _).", "entitlements.plan_key_invalid"));
  }
  const parsed = parseWith(UpsertPlanSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  const res = await runSystemResult(d.systemDb, "entitlements.upsert-plan", async (tx) => {
    await upsertPlanRow(tx, planKey, input, d.clock.now());
    return (await getPlan(tx, planKey)) as PlanRecord;
  });
  if (res.ok) d.cache?.invalidateAll();
  return res;
}

/** Remplace les features d'un plan. Toute clé inconnue ou retirée est refusée (aucune écriture). */
export async function setPlanFeatures(
  deps: EntitlementsDeps,
  planKey: string,
  rawInput: unknown,
): Promise<Result<PlanRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(SetPlanFeaturesSchema, rawInput);
  if (!parsed.ok) return parsed;
  const featureKeys = [...new Set(parsed.value.featureKeys)];

  const res = await runSystemResult(d.systemDb, "entitlements.set-plan-features", async (tx) => {
    if (!(await getPlan(tx, planKey))) {
      throw NotFoundError.of("Plan", planKey, { code: "entitlements.plan_not_found" });
    }
    const catalog = new Map((await listFeatures(tx)).map((f) => [f.key, f]));
    const unknown = featureKeys.filter((k) => !catalog.has(k));
    if (unknown.length > 0) {
      throw ValidationError.field("featureKeys", `Features inconnues : ${unknown.join(", ")}.`, "entitlements.feature_not_found");
    }
    const retired = featureKeys.filter((k) => catalog.get(k)?.retired);
    if (retired.length > 0) {
      throw new ConflictError(`Features retirées du catalogue : ${retired.join(", ")}.`, { code: "entitlements.feature_retired" });
    }
    await setPlanFeatureRows(tx, planKey, featureKeys);
    return (await getPlan(tx, planKey)) as PlanRecord;
  });
  if (res.ok) d.cache?.invalidateAll();
  return res;
}
