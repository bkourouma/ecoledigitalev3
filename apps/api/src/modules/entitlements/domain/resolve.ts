/**
 * Calcul des droits effectifs d'un tenant — PUR (aucune I/O, aucune horloge
 * implicite : `now` est un paramètre).
 *
 * Règles :
 *  1. Les features CORE (packs contient « CORE ») sont toujours accordées.
 *  2. Un tenant suspendu ou archivé, un tenant SANS abonnement, ou dont
 *     l'abonnement n'est pas actif (statut hors ACTIVE/TRIALING, pas encore
 *     commencé, échu) n'a QUE les features CORE : les surcharges ne s'appliquent pas.
 *  3. Abonnement actif : CORE ∪ features du plan ∪ features des packs souscrits,
 *     puis surcharges NON EXPIRÉES : GRANT ajoute, DENY retire — sauf une feature
 *     CORE, qu'aucune surcharge ne retire (on ne coupe pas l'accès aux fonctions
 *     de base d'un établissement client).
 *  4. Une feature retirée du catalogue (« retired ») n'est jamais accordée ; une
 *     surcharge sur une feature inconnue est ignorée.
 *  5. `validUntil` : prochain instant où le résultat peut changer SANS événement
 *     (fin d'abonnement, début d'abonnement, expiration d'une surcharge). Sert à
 *     borner la durée de vie des caches.
 */
import type {
  EntitlementReason,
  FeatureSource,
  OverrideEffect,
  SubscriptionStatus,
} from "@ecoledigitale/contracts/src/v2/entitlements";

export interface CatalogFeature {
  key: string;
  /** Packs qui incluent la feature par défaut (`CORE` = toujours). */
  packs: readonly string[];
  retired: boolean;
}

export interface SubscriptionSnapshot {
  planKey: string;
  /** Packs souscrits (hors CORE). */
  packs: readonly string[];
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
  learnerTierMax: number | null;
}

export interface OverrideSnapshot {
  featureKey: string;
  effect: OverrideEffect;
  expiresAt: Date | null;
}

export type TenantLifecycleStatus = "active" | "suspended" | "archived";

export interface EntitlementsInput {
  tenantId: string;
  tenantStatus: TenantLifecycleStatus;
  /** Catalogue complet des features (retirées comprises). */
  catalog: readonly CatalogFeature[];
  subscription: SubscriptionSnapshot | null;
  /** Clés de features accordées par le plan de l'abonnement (`plan_features`). */
  planFeatureKeys: readonly string[];
  overrides: readonly OverrideSnapshot[];
}

export interface EffectiveEntitlements {
  tenantId: string;
  reason: EntitlementReason;
  planKey: string | null;
  packs: string[];
  subscriptionStatus: SubscriptionStatus | null;
  /** Clés accordées, triées. */
  features: string[];
  sources: Record<string, FeatureSource>;
  limits: { learnerTierMax: number | null };
  validUntil: Date | null;
  computedAt: Date;
}

const ACTIVE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING"]);

/** Abonnement qui accorde réellement les droits à l'instant `now`. */
export function isSubscriptionActive(sub: SubscriptionSnapshot | null, now: Date): boolean {
  if (!sub) return false;
  if (!ACTIVE_STATUSES.has(sub.status)) return false;
  if (sub.startsAt.getTime() > now.getTime()) return false;
  if (sub.endsAt && sub.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

const isExpired = (o: OverrideSnapshot, now: Date): boolean => o.expiresAt !== null && o.expiresAt.getTime() <= now.getTime();

function minDate(dates: readonly (Date | null)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d.getTime() < best.getTime())) best = d;
  }
  return best;
}

export function computeEntitlements(input: EntitlementsInput, now: Date): EffectiveEntitlements {
  const live = input.catalog.filter((f) => !f.retired);
  const liveKeys = new Set(live.map((f) => f.key));

  const sources: Record<string, FeatureSource> = {};
  for (const f of live) {
    if (f.packs.includes("CORE")) sources[f.key] = "CORE";
  }

  const sub = input.subscription;
  const base = {
    tenantId: input.tenantId,
    planKey: sub?.planKey ?? null,
    packs: sub ? [...sub.packs].sort() : [],
    subscriptionStatus: sub?.status ?? null,
    computedAt: now,
  };
  const coreOnly = (reason: EntitlementReason, validUntil: Date | null): EffectiveEntitlements => ({
    ...base,
    reason,
    features: Object.keys(sources).sort(),
    sources,
    limits: { learnerTierMax: null },
    validUntil,
  });

  if (input.tenantStatus === "suspended") return coreOnly("TENANT_SUSPENDED", null);
  if (input.tenantStatus === "archived") return coreOnly("TENANT_ARCHIVED", null);
  if (!sub) return coreOnly("NO_SUBSCRIPTION", null);
  if (!isSubscriptionActive(sub, now)) {
    // Abonnement valide mais pas encore commencé : le résultat change à son début.
    const startsLater = ACTIVE_STATUSES.has(sub.status) && sub.startsAt.getTime() > now.getTime();
    return coreOnly("SUBSCRIPTION_INACTIVE", startsLater ? sub.startsAt : null);
  }

  // Plan, puis packs ; la première source rencontrée est conservée (CORE > PLAN > PACK > OVERRIDE).
  for (const key of input.planFeatureKeys) {
    if (liveKeys.has(key) && !(key in sources)) sources[key] = "PLAN";
  }
  const subscribed = new Set(sub.packs);
  for (const f of live) {
    if (!(f.key in sources) && f.packs.some((p) => subscribed.has(p))) sources[f.key] = "PACK";
  }

  // Surcharges non expirées. Une surcharge expirée est sans effet (et ne borne plus le cache).
  const activeOverrides = input.overrides.filter((o) => !isExpired(o, now) && liveKeys.has(o.featureKey));
  for (const o of activeOverrides) {
    if (o.effect === "GRANT") {
      if (!(o.featureKey in sources)) sources[o.featureKey] = "OVERRIDE";
    } else if (sources[o.featureKey] !== "CORE") {
      delete sources[o.featureKey];
    }
  }

  return {
    ...base,
    reason: "OK",
    features: Object.keys(sources).sort(),
    sources,
    limits: { learnerTierMax: sub.learnerTierMax },
    validUntil: minDate([sub.endsAt, ...activeOverrides.map((o) => o.expiresAt)]),
    computedAt: now,
  };
}

export function hasFeature(entitlements: Pick<EffectiveEntitlements, "features">, featureKey: string): boolean {
  return entitlements.features.includes(featureKey);
}
