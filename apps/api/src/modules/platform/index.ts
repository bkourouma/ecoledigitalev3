/**
 * API PUBLIQUE du module `platform` (console des opérateurs) — seul point d'import autorisé pour les autres
 * modules et pour la couche d'assemblage (`apps/api/src/platform`).
 */
export { default as manifest } from "./manifest";

export { default as platformConsolePlugin, buildPlatformDeps } from "./http/plugin";

export {
  changeTenantStatus,
  ensureTenantServices,
  getTenantOverview,
  listPlatformCatalog,
  listPlatformTenants,
  provisionPlatformTenant,
  reconcileTenant,
  removeTenantOverride,
  setPlatformPlanFeatures,
  setTenantOverride,
  setTenantSubscription,
  upsertPlatformPlan,
  type EnsureServicesOptions,
  type ProvisionedTenant,
  type TenantServicesReport,
} from "./application/console";
export {
  DEFAULT_TRIAL,
  type MemberProvisioner,
  type Operator,
  type OperatorRequestMeta,
  type PlatformAuditEntry,
  type PlatformAuditPort,
  type PlatformDeps,
  type TrialPolicy,
} from "./application/deps";
