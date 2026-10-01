"use client";

/**
 * Hooks du module `rbac` (rôles, catalogue de permissions, assignations) et lecture des membres (`iam`).
 * Tout passe par le client API typé ; les règles (anti-escalade, dernier propriétaire, rôle verrouillé, MFA) sont
 * celles de l'API : l'écran affiche ses refus, il ne les recalcule pas.
 */

import { z } from "zod";
import {
  rbacAssignmentListResponseSchema,
  rbacAssignmentSchema,
  rbacPermissionCatalogResponseSchema,
  rbacRoleDetailSchema,
  rbacRoleListResponseSchema,
  type RbacAssignment,
  type RbacCloneRoleBody,
  type RbacCreateAssignmentBody,
  type RbacCreateRoleBody,
  type RbacPermissionEntry,
  type RbacRoleDetail,
  type RbacRoleSummary,
  type RbacUpdateAssignmentBody,
  type RbacUpdateRoleBody,
} from "@ecoledigitale/contracts/v2/rbac";
import { MemberListResponseSchema, type MemberSummary } from "@ecoledigitale/contracts/v2/iam";
import { platformHooks } from "@/platform/api/default-client";

export const RBAC = "/api/v1/rbac";
const FIVE_MINUTES = 5 * 60 * 1000;

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

// --------------------------------------------------------------------------- catalogue

export function usePermissionCatalog() {
  return platformHooks.useApiQuery<RbacPermissionEntry[]>(["rbac", "permissions"], `${RBAC}/permissions`, {
    schema: rbacPermissionCatalogResponseSchema.transform((v) => v.permissions),
    staleTime: FIVE_MINUTES,
    retry: false,
  });
}

// --------------------------------------------------------------------------- rôles

export function useRoles() {
  return platformHooks.useApiQuery<RbacRoleSummary[]>(["rbac", "roles"], `${RBAC}/roles`, {
    schema: rbacRoleListResponseSchema.transform((v) => v.roles),
    retry: false,
  });
}

export function useRole(id: string) {
  return platformHooks.useApiQuery<RbacRoleDetail>(["rbac", "role", id], `${RBAC}/roles/${id}`, {
    schema: rbacRoleDetailSchema,
    retry: false,
  });
}

export function useCreateRole() {
  return platformHooks.useApiMutation<RbacRoleDetail, RbacCreateRoleBody>({
    path: `${RBAC}/roles`,
    schema: rbacRoleDetailSchema,
    invalidate: [["rbac", "roles"]],
  });
}

export type CloneRoleVars = { id: string } & RbacCloneRoleBody;

export function useCloneRole() {
  return platformHooks.useApiMutation<RbacRoleDetail, CloneRoleVars>({
    path: (v) => `${RBAC}/roles/${v.id}/clone`,
    body: (v) => without(v, "id"),
    schema: rbacRoleDetailSchema,
    invalidate: [["rbac", "roles"]],
  });
}

export type UpdateRoleVars = { id: string } & RbacUpdateRoleBody;

export function useUpdateRole() {
  return platformHooks.useApiMutation<RbacRoleDetail, UpdateRoleVars>({
    method: "PATCH",
    path: (v) => `${RBAC}/roles/${v.id}`,
    body: (v) => without(v, "id"),
    schema: rbacRoleDetailSchema,
    invalidate: [["rbac", "roles"], ["rbac", "role"], ["rbac", "me"]],
  });
}

export function useDeleteRole() {
  return platformHooks.useApiMutation<unknown, { id: string }>({
    method: "DELETE",
    path: (v) => `${RBAC}/roles/${v.id}`,
    body: () => undefined,
    invalidate: [["rbac", "roles"], ["rbac", "assignments"]],
  });
}

// --------------------------------------------------------------------------- assignations

export interface AssignmentFilter {
  userId?: string;
  roleId?: string;
}

export function useAssignments(filter: AssignmentFilter = {}) {
  return platformHooks.useApiQuery<RbacAssignment[]>(["rbac", "assignments"], `${RBAC}/assignments`, {
    query: { ...(filter.userId ? { userId: filter.userId } : {}), ...(filter.roleId ? { roleId: filter.roleId } : {}), limit: 500 },
    schema: rbacAssignmentListResponseSchema.transform((v) => v.assignments),
    retry: false,
  });
}

export function useCreateAssignment() {
  return platformHooks.useApiMutation<RbacAssignment, RbacCreateAssignmentBody>({
    path: `${RBAC}/assignments`,
    schema: rbacAssignmentSchema,
    invalidate: [["rbac", "assignments"], ["rbac", "roles"]],
  });
}

export type UpdateAssignmentVars = { id: string } & RbacUpdateAssignmentBody;

export function useUpdateAssignment() {
  return platformHooks.useApiMutation<RbacAssignment, UpdateAssignmentVars>({
    method: "PATCH",
    path: (v) => `${RBAC}/assignments/${v.id}`,
    body: (v) => without(v, "id"),
    schema: rbacAssignmentSchema,
    invalidate: [["rbac", "assignments"]],
  });
}

export function useRevokeAssignment() {
  return platformHooks.useApiMutation<{ revoked: boolean }, { id: string }>({
    method: "DELETE",
    path: (v) => `${RBAC}/assignments/${v.id}`,
    body: () => undefined,
    schema: z.object({ revoked: z.boolean() }),
    invalidate: [["rbac", "assignments"], ["rbac", "roles"]],
  });
}

// --------------------------------------------------------------------------- membres (choix de l'utilisateur)

/** Membres du tenant (permission `iam.user.read`) ; l'écran retombe sur une saisie d'identifiant si elle est refusée. */
export function useMembers(enabled = true) {
  return platformHooks.useApiQuery<MemberSummary[]>(["iam", "members"], "/api/v1/iam/admin/members", {
    query: { limit: 500 },
    schema: MemberListResponseSchema.transform((v) => v.members),
    enabled,
    staleTime: FIVE_MINUTES,
    retry: false,
  });
}
