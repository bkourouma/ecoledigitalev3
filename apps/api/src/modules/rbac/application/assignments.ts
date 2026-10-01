/**
 * Use cases « assignations » : attribuer un rôle à un utilisateur sur un périmètre
 * (tenant | institution | campus) avec une fenêtre de validité.
 *
 * Garde-fous :
 *  - l'acteur doit détenir `rbac.assignment.manage` SUR CE PÉRIMÈTRE ;
 *  - anti-escalade : il doit détenir lui-même, sur ce périmètre, toutes les
 *    permissions du rôle qu'il attribue ;
 *  - jamais de retrait du DERNIER propriétaire actif du tenant ;
 *  - une assignation par (utilisateur, rôle, périmètre) : ré-attribuer met à jour
 *    la validité.
 */
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  newId,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { RBAC_ASSIGNMENT_CHANGED, type AssignmentChangedPayload } from "../domain/events";
import { missingPermissions } from "../domain/role-rules";
import { scopeFromParts, scopeId, type ScopeRef } from "../domain/scope";
import {
  countOtherActiveOwners,
  deleteAssignmentRow,
  findAssignmentById,
  findRoleById,
  listAssignments,
  selectRolePermissions,
  updateAssignmentValidity,
  upsertAssignment,
  type AssignmentRow,
} from "../infrastructure/repository";
import { loadPermissionCatalog } from "./catalog";
import type { UseCaseDeps } from "./ports";
import { audit, authorizeActor, err, ok, publish } from "./support";

type R<T> = Promise<Result<T, AppError>>;

export interface AssignRoleInput {
  readonly userId: string;
  readonly identityId?: string | null;
  readonly roleId: string;
  readonly scope: ScopeRef;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
}

function checkValidity(validFrom: Date | null, validUntil: Date | null, now: Date, requireFuture: boolean): ValidationError | null {
  if (validFrom && validUntil && validUntil.getTime() <= validFrom.getTime()) {
    return ValidationError.field("validUntil", "La fin de validité doit suivre le début.", "rbac.invalid_validity");
  }
  if (requireFuture && validUntil && validUntil.getTime() <= now.getTime()) {
    return ValidationError.field("validUntil", "La fin de validité est déjà passée.", "rbac.invalid_validity");
  }
  return null;
}

function payloadOf(
  change: AssignmentChangedPayload["change"],
  a: Pick<AssignmentRow, "id" | "userId" | "roleId" | "roleKey" | "scopeType" | "scopeId" | "validFrom" | "validUntil">,
): AssignmentChangedPayload {
  return {
    v: 1,
    change,
    assignmentId: a.id,
    userId: a.userId,
    roleId: a.roleId,
    roleKey: a.roleKey,
    scope: { type: a.scopeType, id: a.scopeId },
    validFrom: a.validFrom ? a.validFrom.toISOString() : null,
    validUntil: a.validUntil ? a.validUntil.toISOString() : null,
  };
}

export function assignmentScope(a: Pick<AssignmentRow, "scopeType" | "scopeId">): ScopeRef {
  return scopeFromParts(a.scopeType, a.scopeId);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listAssignmentsUseCase(
  deps: UseCaseDeps,
  ctx: RequestContext,
  filter: { userId?: string; roleId?: string; limit?: number; offset?: number } = {},
): R<AssignmentRow[]> {
  return ok(await listAssignments(deps.tx, ctx.tenantId, filter));
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export async function assignRoleUseCase(deps: UseCaseDeps, ctx: RequestContext, input: AssignRoleInput): R<AssignmentRow> {
  const denied = authorizeActor(deps, ctx, "rbac.assignment.manage", input.scope);
  if (denied) return err(denied);

  const now = deps.clock.now();
  const validFrom = input.validFrom ?? null;
  const validUntil = input.validUntil ?? null;
  const badValidity = checkValidity(validFrom, validUntil, now, true);
  if (badValidity) return err(badValidity);

  const role = await findRoleById(deps.tx, ctx.tenantId, input.roleId);
  if (!role) return err(NotFoundError.of("Rôle", input.roleId));

  if (deps.scopeTree?.knows && !deps.scopeTree.knows(input.scope)) {
    return err(
      ValidationError.field("scope", "Ce périmètre n'existe pas dans cette organisation.", "rbac.unknown_scope"),
    );
  }

  // Anti-escalade : seules les permissions du catalogue ACTIF comptent (les retirées sont inertes).
  if (ctx.actor !== "system" && deps.actor) {
    const catalog = await loadPermissionCatalog(deps.tx);
    const rolePermissions = (await selectRolePermissions(deps.tx, ctx.tenantId, role.id)).filter((k) => catalog.byKey.has(k));
    const missing = missingPermissions(deps.actor, rolePermissions, input.scope);
    if (missing.length > 0) {
      return err(
        new ForbiddenError(
          "Vous ne pouvez attribuer qu'un rôle dont vous détenez vous-même toutes les permissions sur ce périmètre.",
          { code: "rbac.escalation_denied", details: { permissions: missing, roleId: role.id } },
        ),
      );
    }
  }

  const upserted = await upsertAssignment(deps.tx, {
    id: newId(now.getTime()),
    tenantId: ctx.tenantId,
    userId: input.userId.toLowerCase(),
    identityId: input.identityId ? input.identityId.toLowerCase() : null,
    roleId: role.id,
    scopeType: input.scope.type,
    scopeId: scopeId(input.scope),
    validFrom,
    validUntil,
    grantedBy: ctx.userId,
    now,
  });
  const row = (await findAssignmentById(deps.tx, ctx.tenantId, upserted.id)) as AssignmentRow;

  await publish(deps, ctx, RBAC_ASSIGNMENT_CHANGED, "assignment", row.id, payloadOf(upserted.created ? "granted" : "updated", row));
  await audit(deps, ctx, {
    action: upserted.created ? "rbac.assignment.granted" : "rbac.assignment.updated",
    entityType: "assignment",
    entityId: row.id,
    after: {
      userId: row.userId,
      roleKey: row.roleKey,
      scope: { type: row.scopeType, id: row.scopeId },
      validFrom: row.validFrom,
      validUntil: row.validUntil,
    },
  });
  return ok(row);
}

// ---------------------------------------------------------------------------
// Modification de la validité
// ---------------------------------------------------------------------------

export interface UpdateAssignmentInput {
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
}

async function lastOwnerGuard(deps: UseCaseDeps, ctx: RequestContext, a: AssignmentRow, now: Date): Promise<ConflictError | null> {
  const role = await findRoleById(deps.tx, ctx.tenantId, a.roleId);
  if (!role || role.templateKey !== "owner" || a.scopeType !== "tenant") return null;
  const others = await countOtherActiveOwners(deps.tx, ctx.tenantId, a.id, now);
  if (others > 0) return null;
  return new ConflictError("Impossible de retirer le dernier propriétaire de l'organisation.", {
    code: "rbac.last_owner",
    details: { assignmentId: a.id },
  });
}

export async function updateAssignmentUseCase(
  deps: UseCaseDeps,
  ctx: RequestContext,
  assignmentId: string,
  input: UpdateAssignmentInput,
): R<AssignmentRow> {
  const current = await findAssignmentById(deps.tx, ctx.tenantId, assignmentId);
  if (!current) return err(NotFoundError.of("Assignation", assignmentId));
  const denied = authorizeActor(deps, ctx, "rbac.assignment.manage", assignmentScope(current));
  if (denied) return err(denied);

  const now = deps.clock.now();
  const validFrom = input.validFrom === undefined ? current.validFrom : input.validFrom;
  const validUntil = input.validUntil === undefined ? current.validUntil : input.validUntil;
  const bad = checkValidity(validFrom, validUntil, now, false);
  if (bad) return err(bad);

  // Une expiration immédiate équivaut à un retrait : même protection du dernier propriétaire.
  if (validUntil && validUntil.getTime() <= now.getTime()) {
    const blocked = await lastOwnerGuard(deps, ctx, current, now);
    if (blocked) return err(blocked);
  }

  await updateAssignmentValidity(deps.tx, ctx.tenantId, current.id, { validFrom, validUntil }, now);
  const row = (await findAssignmentById(deps.tx, ctx.tenantId, current.id)) as AssignmentRow;
  await publish(deps, ctx, RBAC_ASSIGNMENT_CHANGED, "assignment", row.id, payloadOf("updated", row));
  await audit(deps, ctx, {
    action: "rbac.assignment.updated",
    entityType: "assignment",
    entityId: row.id,
    before: { validFrom: current.validFrom, validUntil: current.validUntil },
    after: { validFrom: row.validFrom, validUntil: row.validUntil },
  });
  return ok(row);
}

// ---------------------------------------------------------------------------
// Retrait
// ---------------------------------------------------------------------------

export async function revokeAssignmentUseCase(
  deps: UseCaseDeps,
  ctx: RequestContext,
  assignmentId: string,
): R<{ revoked: true; userId: string }> {
  const current = await findAssignmentById(deps.tx, ctx.tenantId, assignmentId);
  if (!current) return err(NotFoundError.of("Assignation", assignmentId));
  const denied = authorizeActor(deps, ctx, "rbac.assignment.manage", assignmentScope(current));
  if (denied) return err(denied);

  const now = deps.clock.now();
  const blocked = await lastOwnerGuard(deps, ctx, current, now);
  if (blocked) return err(blocked);

  await deleteAssignmentRow(deps.tx, ctx.tenantId, current.id);
  await publish(deps, ctx, RBAC_ASSIGNMENT_CHANGED, "assignment", current.id, payloadOf("revoked", current));
  await audit(deps, ctx, {
    action: "rbac.assignment.revoked",
    entityType: "assignment",
    entityId: current.id,
    before: {
      userId: current.userId,
      roleKey: current.roleKey,
      scope: { type: current.scopeType, id: current.scopeId },
      validFrom: current.validFrom,
      validUntil: current.validUntil,
    },
  });
  return ok({ revoked: true, userId: current.userId });
}
