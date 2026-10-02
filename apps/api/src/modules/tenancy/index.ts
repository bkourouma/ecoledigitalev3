/**
 * API PUBLIQUE du module `tenancy` — seul point d'import autorisé pour les
 * autres modules (ADR-001). Rien d'autre (domain/, application/, infrastructure/)
 * ne doit être importé de l'extérieur.
 */
export { default as manifest } from "./manifest";

// --- Plugin HTTP (/api/v1/tenancy/*) ---------------------------------------
export { tenancyPlugin, TENANCY_ROUTE_PREFIX, type TenancyPluginOptions } from "./http/plugin";
export type { PermissionGuardFactory, ContextResolver } from "./http/common";
export { toTenantProfileDto, toInstitutionDto, toCampusDto } from "./http/serializers";

// --- Use cases --------------------------------------------------------------
export { provisionTenant, type ProvisionOptions } from "./application/provision-tenant";
export { getTenantProfile, updateTenantProfile, listCountries } from "./application/profile";
export { listInstitutions, getInstitution, createInstitution, updateInstitution } from "./application/institutions";
export { listCampuses, createCampus, updateCampus, deleteCampus } from "./application/campuses";
export { getOnboarding, completeOnboardingStep, skipOnboardingStep } from "./application/onboarding";
export { getTenantStatus, setTenantStatus, type SetTenantStatusInput } from "./application/tenant-status";
export {
  ensureTenantFoundation,
  type EnsureFoundationInput,
  type EnsureFoundationReport,
} from "./application/ensure-foundation";
export { listTenants, getTenantSummary, type TenantListFilter, type TenantListPage, type TenantSummary } from "./application/tenants";
export {
  createTenancyScopeTreeProvider,
  buildScopeTree,
  type TenancyScopeRef,
  type TenancyScopeTree,
  type TenancyScopeTreeProvider,
} from "./application/scope-tree";
export type { TenancyDeps, AuditRecorder, AuditEntry } from "./application/support";

// --- Domaine pur (machine d'onboarding, plan de provisioning, événements) ---
export {
  ONBOARDING_STEP_DEFS,
  PROVISIONING_STEPS,
  computeOnboardingState,
  initialSteps,
  isLive,
  transition as transitionOnboarding,
  type StepRecord,
  type OnboardingAction,
} from "./domain/onboarding";
export { planProvisioning, validateSlug, deriveCode, uniqueCode, RESERVED_SLUGS } from "./domain/provisioning";
export { TENANCY_EVENTS } from "./domain/events";
export type {
  CampusRecord,
  CountryProfileRecord,
  InstitutionRecord,
  TenantProfileRecord,
  TenantRecord,
} from "./domain/entities";

// --- Modèles de pack ---------------------------------------------------------
export {
  defaultPackTemplates,
  buildPackTemplates,
  getPackTemplateSection,
  PackTemplateSchema,
  PackTemplateSectionKeySchema,
  type PackTemplate,
  type PackTemplates,
} from "./templates";
