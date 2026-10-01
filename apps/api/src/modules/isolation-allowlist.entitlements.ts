/**
 * Tables GLOBALES du schéma `entitlements` (sans `tenant_id`, hors RLS).
 * Chaque entrée = clé `schema.table` + justification (ADR-002 §5).
 * Les tables de tenant du module (`tenant_subscriptions`, `tenant_feature_overrides`,
 * `usage_counters`) NE figurent PAS ici : elles ont tenant_id + RLS forcée.
 * `table` répète `key` : même forme que les allowlists des autres modules (rbac, audit).
 */
export interface IsolationAllowlistEntry {
  key: string;
  /** Identique à `key` (compatibilité avec les allowlists `{ table, … }` des autres modules). */
  table: string;
  justification: string;
}

const entry = (key: string, justification: string): IsolationAllowlistEntry =>
  Object.freeze({ key, table: key, justification });

export const ENTITLEMENTS_ISOLATION_ALLOWLIST: readonly IsolationAllowlistEntry[] = Object.freeze([
  entry(
    "entitlements.plans",
    "Catalogue commercial des plans (STARTER, PROFESSIONAL, ENTERPRISE), identique pour tous les tenants, " +
      "sans donnée de tenant ni donnée personnelle. Écriture réservée à la console plateforme (SuperAdminAuthorizer).",
  ),
  entry(
    "entitlements.packs",
    "Catalogue des packs vendables (PRIMARY, SECONDARY, HIGHER, VIRTUAL), identique pour tous les tenants, " +
      "sans donnée de tenant. Écriture réservée à la console plateforme.",
  ),
  entry(
    "entitlements.features",
    "Catalogue des features dérivé des manifestes de modules (syncFeatureCatalog), identique pour tous les tenants, " +
      "sans donnée de tenant. Jamais supprimé (retired_at).",
  ),
  entry(
    "entitlements.plan_features",
    "Association plan -> features du catalogue commercial, identique pour tous les tenants, sans donnée de tenant. " +
      "Écriture réservée à la console plateforme.",
  ),
]);

/** Format `schema.table` attendu par `assertTenantIsolation({ allowlist })`. */
export const entitlementsIsolationAllowlist: readonly string[] = ENTITLEMENTS_ISOLATION_ALLOWLIST.map((e) => e.key);

/**
 * Valeurs imposées pour que le test d'isolation fabrique une ligne dans chaque table de tenant.
 * Aucune précondition sur le contenu du catalogue : `plan_key: 'STARTER'` vient du seed de la migration et
 * `feature_key` n'a pas de clé étrangère (une surcharge sur une clé inconnue est refusée par l'application).
 */
export const entitlementsIsolationFixtures: Record<string, Record<string, unknown>> = {
  "entitlements.tenant_subscriptions": { plan_key: "STARTER", status: "ACTIVE" },
  "entitlements.tenant_feature_overrides": { feature_key: "isolation.check", effect: "GRANT", reason: "Motif de test" },
  "entitlements.usage_counters": { metric: "SMS_SENT", period: "2026-10-01" },
};

export default ENTITLEMENTS_ISOLATION_ALLOWLIST;
