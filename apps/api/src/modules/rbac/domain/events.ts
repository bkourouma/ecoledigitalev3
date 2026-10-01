/**
 * Événements publiés par le module (outbox, ADR-004). Payloads versionnés `{ v: 1, … }`.
 * Le module `audit` s'y abonne ; le cache de permissions les consomme pour s'invalider.
 */
export const RBAC_ROLE_CHANGED = "rbac.role.changed" as const;
export const RBAC_ASSIGNMENT_CHANGED = "rbac.assignment.changed" as const;

export type RoleChange = "created" | "cloned" | "updated" | "deleted" | "resynced";
export type AssignmentChange = "granted" | "updated" | "revoked";

export interface RoleChangedPayload {
  readonly v: 1;
  readonly change: RoleChange;
  readonly roleId: string;
  readonly roleKey: string;
  readonly isSystem: boolean;
  readonly label?: string;
  /** Permissions ajoutées / retirées (changement de contenu). */
  readonly addedPermissions?: readonly string[];
  readonly removedPermissions?: readonly string[];
  readonly clonedFromRoleId?: string;
}

export interface AssignmentChangedPayload {
  readonly v: 1;
  readonly change: AssignmentChange;
  readonly assignmentId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly roleKey: string;
  readonly scope: { readonly type: "tenant" | "institution" | "campus"; readonly id: string | null };
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

export interface RbacEventMap {
  [RBAC_ROLE_CHANGED]: RoleChangedPayload;
  [RBAC_ASSIGNMENT_CHANGED]: AssignmentChangedPayload;
  [type: string]: unknown;
}
