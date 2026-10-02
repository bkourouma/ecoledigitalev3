/**
 * API publique du module `rbac` — SEUL point d'import autorisé pour les autres modules.
 *
 * Usage typique par un autre module :
 *
 *   import { requirePermission, can, campusScope } from "../rbac";
 *   app.post("/grades", { preHandler: requirePermission("grade.enter") }, handler);
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage).
export { default as rbacManifest } from "./manifest";

// Plugin Fastify + garde
export {
  rbacPlugin,
  createRbacRuntime,
  auditAdapter as rbacAuditAdapter,
  DEFAULT_PREFIX as RBAC_ROUTES_PREFIX,
  type RbacPluginOptions,
} from "./http/plugin";
export {
  requirePermission,
  loadAuthorization,
  getRequestCtx,
  type RbacRuntime,
  type RequirePermissionOptions,
  type ScopeSelector,
} from "./http/guard";

// Évaluation (pure)
export {
  can,
  canAll,
  decide,
  grantedScopes,
  effectivePermissions,
  buildPermissionSet,
  emptyPermissionSet,
  createAuthorizationContext,
  activeScopeOf,
  type AuthorizationContext,
  type Decision,
  type DenyReason,
  type PermissionSet,
  type AssignmentRecord,
} from "./domain/permission-set";

// Périmètres
export {
  TENANT_SCOPE,
  ANY_SCOPE,
  EMPTY_SCOPE_TREE,
  campusScope,
  institutionScope,
  scopeCovers,
  scopeFromParts,
  scopeTreeFromPairs,
  emptyScopeTreeProvider,
  type ScopeRef,
  type ScopeTarget,
  type ScopeTree,
  type ScopeTreeProvider,
  type ScopeType,
} from "./domain/scope";

// Catalogue et modèles
export {
  buildPermissionCatalog,
  matchesPermissionPattern,
  resolvePatterns,
  type PermissionCatalog,
  type CatalogEntry,
} from "./domain/permission-catalog";
export { SYSTEM_ROLE_TEMPLATES, type SystemRoleTemplate } from "./templates/system-roles";
export {
  RESERVED_FOR_UPCOMING_MODULES,
  RESERVED_PERMISSION_KEYS,
  isReservedPermission,
  type ReservedPermission,
} from "./templates/reserved-permissions";
export { resolveSystemRoles } from "./domain/system-roles";
export { syncPermissionCatalog, loadPermissionCatalog, type SyncCatalogReport } from "./application/catalog";
export {
  instantiateSystemRoles,
  syncRbac,
  type InstantiateOptions,
  type InstantiateReport,
  type SyncRbacOptions,
  type SyncRbacReport,
} from "./application/instantiate-system-roles";

// Chargement + cache
export {
  loadPermissionSet,
  PermissionSetService,
  type LoadPermissionSetOptions,
} from "./application/load-permission-set";
export { PermissionSetCache, subscribeCacheInvalidation } from "./application/permission-cache";

// Navigation
export {
  buildNavigation,
  coreOnlyEntitlements,
  entitlementsFromKeys,
  PORTALS,
  type Entitlements,
  type NavItem,
  type Navigation,
} from "./domain/navigation";

// Compatibilité legacy
export {
  legacyRoleToTemplate,
  permissionsForLegacyRoles,
  resolveLegacyRoles,
  LEGACY_ROLE_TO_TEMPLATES,
  type LegacyPermissionResult,
} from "./domain/legacy";

// Use cases (provisioning : attribuer `owner` au fondateur ; scripts d'administration)
export {
  assignRoleUseCase,
  assignSystemRoleUseCase,
  revokeAssignmentUseCase,
  updateAssignmentUseCase,
  listAssignmentsUseCase,
  type AssignRoleInput,
} from "./application/assignments";
export {
  createRoleUseCase,
  cloneRoleUseCase,
  updateRoleUseCase,
  deleteRoleUseCase,
  getRoleUseCase,
  listRolesUseCase,
  type RoleDetail,
} from "./application/roles";

// Ports
export { noopAudit, type AuditPort, type AuditEntry, type EntitlementsPort, type UseCaseDeps } from "./application/ports";

// Événements
export {
  RBAC_ROLE_CHANGED,
  RBAC_ASSIGNMENT_CHANGED,
  type RoleChangedPayload,
  type AssignmentChangedPayload,
} from "./domain/events";
