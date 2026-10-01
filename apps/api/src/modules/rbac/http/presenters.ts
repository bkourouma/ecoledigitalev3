/**
 * Conversion lignes SQL / objets de domaine -> réponses JSON conformes à
 * `packages/contracts/src/v2/rbac.ts`.
 */
import type {
  RbacAssignment,
  RbacMyPermissionsResponse,
  RbacNavigationResponse,
  RbacPermissionEntry,
  RbacRoleDetail,
  RbacRoleSummary,
} from "@ecoledigitale/contracts/src/v2/rbac";
import type { RoleDetail } from "../application/roles";
import type { Navigation } from "../domain/navigation";
import type { CatalogEntry } from "../domain/permission-catalog";
import {
  decide,
  grantedScopes,
  type AuthorizationContext,
} from "../domain/permission-set";
import { ANY_SCOPE, scopeFromParts, type ScopeRef } from "../domain/scope";
import type { AssignmentRow, RoleSummaryRow } from "../infrastructure/repository";

export function scopeToJson(scope: ScopeRef): RbacAssignment["scope"] {
  return scope.type === "tenant" ? { type: "tenant" } : { type: scope.type, id: scope.id };
}

export function presentPermission(entry: CatalogEntry, moduleTitles: ReadonlyMap<string, string>): RbacPermissionEntry {
  return {
    key: entry.key,
    label: entry.label,
    description: entry.description,
    sensitive: entry.sensitive,
    moduleKey: entry.moduleKey,
    moduleTitle: moduleTitles.get(entry.moduleKey) ?? null,
  };
}

export function presentRoleSummary(r: RoleSummaryRow): RbacRoleSummary {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    isSystem: r.isSystem,
    locked: r.isSystem,
    templateKey: r.templateKey,
    clonedFromRoleId: r.clonedFromRoleId,
    permissionCount: r.permissionCount,
    pendingCount: r.pendingCount,
    assignmentCount: r.assignmentCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function presentRoleDetail(d: RoleDetail): RbacRoleDetail {
  const r = d.role;
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    isSystem: r.isSystem,
    locked: r.isSystem,
    templateKey: r.templateKey,
    clonedFromRoleId: r.clonedFromRoleId,
    assignmentCount: d.assignmentCount,
    permissions: [...d.permissions],
    pendingPermissions: [...d.pending],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function presentAssignment(a: AssignmentRow): RbacAssignment {
  return {
    id: a.id,
    userId: a.userId,
    identityId: a.identityId,
    roleId: a.roleId,
    roleKey: a.roleKey,
    scope: scopeToJson(scopeFromParts(a.scopeType, a.scopeId)),
    validFrom: a.validFrom ? a.validFrom.toISOString() : null,
    validUntil: a.validUntil ? a.validUntil.toISOString() : null,
    grantedBy: a.grantedBy,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function presentMyPermissions(auth: AuthorizationContext): RbacMyPermissionsResponse {
  const permissions: RbacMyPermissionsResponse["permissions"] = [];
  const requiresMfa: string[] = [];
  for (const key of [...auth.permissionSet.byPermission.keys()].sort()) {
    const decision = decide(auth, key, ANY_SCOPE);
    if (decision.allowed) {
      permissions.push({
        key,
        sensitive: auth.permissionSet.sensitive.has(key),
        scopes: grantedScopes(auth, key).map(scopeToJson),
      });
    } else if (decision.reason === "mfa_required") {
      requiresMfa.push(key);
    }
  }
  return { tenantId: auth.tenantId, userId: auth.userId, mfa: auth.mfa, permissions, requiresMfa };
}

export function presentNavigation(nav: Navigation): RbacNavigationResponse {
  const portals = {} as Record<string, RbacNavigationResponse["portals"]["admin"]>;
  for (const [portal, items] of Object.entries(nav.portals)) portals[portal] = items.map((i) => ({ ...i }));
  return {
    portals: portals as RbacNavigationResponse["portals"],
    availablePortals: [...nav.availablePortals],
  };
}
