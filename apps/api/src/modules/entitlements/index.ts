/**
 * API PUBLIQUE du module `entitlements` — seul point d'import autorisé pour les
 * autres modules (ADR-001). Rien d'autre (domain/, application/, infrastructure/)
 * ne doit être importé de l'extérieur.
 */
export { default as manifest } from "./manifest";

// --- Plugin HTTP (/api/v1/entitlements/*) + garde de feature -----------------
export { entitlementsPlugin, ENTITLEMENTS_ROUTE_PREFIX, type EntitlementsPluginOptions } from "./http/plugin";
export {
  requireFeature,
  createRequireFeature,
  type FeatureGuard,
  type RequireFeature,
  type EntitlementsService,
} from "./http/require-feature";
export {
  denyAllSuperAdmin,
  type SuperAdminAuthorizer,
  type SuperAdminIdentity,
  type PermissionGuardFactory,
  type ContextResolver,
} from "./http/common";

// --- Droits effectifs ---------------------------------------------------------
export { resolveEntitlements, hasFeature } from "./application/resolve-entitlements";
export {
  PgEntitlementsReader,
  CachedEntitlementsReader,
  type EntitlementsReader,
  type CachedReaderOptions,
} from "./application/reader";
export {
  computeEntitlements,
  isSubscriptionActive,
  hasFeature as hasEffectiveFeature,
  type EffectiveEntitlements,
  type EntitlementsInput,
  type CatalogFeature,
  type SubscriptionSnapshot,
  type OverrideSnapshot,
} from "./domain/resolve";

// --- Catalogue, abonnements, surcharges, usage --------------------------------
export {
  syncFeatureCatalog,
  collectFeatures,
  getCatalog,
  upsertPlan,
  setPlanFeatures,
  type SyncOptions,
  type SyncResult,
  type ManifestFeatures,
} from "./application/catalog";
export { getSubscription, setSubscription } from "./application/subscriptions";
export { listFeatureOverrides, setFeatureOverride, removeFeatureOverride } from "./application/overrides";
export { recordUsage, getUsage, periodOf, DEFAULT_USAGE_MODE } from "./application/usage";

// --- Consommateurs d'événements ----------------------------------------------
export { onTenantProvisioned, type TrialPolicy } from "./application/on-tenant-provisioned";

export { ENTITLEMENTS_EVENTS } from "./domain/events";
export type {
  EntitlementsDeps,
  AuditRecorder,
  AuditEntry,
  CacheInvalidator,
} from "./application/support";
export type {
  FeatureRecord,
  OverrideRecord,
  PackRecord,
  PlanRecord,
  SubscriptionRecord,
  UsageCounterRecord,
} from "./domain/entities";
