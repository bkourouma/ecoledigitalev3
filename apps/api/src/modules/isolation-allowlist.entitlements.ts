/**
 * Tables GLOBALES du schéma `entitlements` (sans `tenant_id`, hors RLS).
 * Chaque entrée = clé `schema.table` + justification (ADR-002 §5).
 * Les tables de tenant du module (`tenant_subscriptions`, `tenant_feature_overrides`,
 * `usage_counters`) NE figurent PAS ici : elles ont tenant_id + RLS forcée.
 */
export interface IsolationAllowlistEntry {
  key: string;
  justification: string;
}

export const ENTITLEMENTS_ISOLATION_ALLOWLIST: readonly IsolationAllowlistEntry[] = [
  {
    key: "entitlements.plans",
    justification:
      "Catalogue commercial des plans (STARTER, PROFESSIONAL, ENTERPRISE), identique pour tous les tenants, " +
      "sans donnée de tenant ni donnée personnelle. Écriture réservée à la console plateforme (SuperAdminAuthorizer).",
  },
  {
    key: "entitlements.packs",
    justification:
      "Catalogue des packs vendables (PRIMARY, SECONDARY, HIGHER, VIRTUAL), identique pour tous les tenants, " +
      "sans donnée de tenant. Écriture réservée à la console plateforme.",
  },
  {
    key: "entitlements.features",
    justification:
      "Catalogue des features dérivé des manifestes de modules (syncFeatureCatalog), identique pour tous les tenants, " +
      "sans donnée de tenant. Jamais supprimé (retired_at).",
  },
  {
    key: "entitlements.plan_features",
    justification:
      "Association plan -> features du catalogue commercial, identique pour tous les tenants, sans donnée de tenant. " +
      "Écriture réservée à la console plateforme.",
  },
];

export default ENTITLEMENTS_ISOLATION_ALLOWLIST;
