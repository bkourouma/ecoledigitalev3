/**
 * Use cases « rôles » : lecture, création (de zéro ou par clonage), modification,
 * suppression. Les rôles SYSTÈME sont verrouillés (on les clone pour les adapter).
 *
 * Chaque mutation, dans la transaction de l'appelant :
 *   1. vérifie le droit de l'acteur (`rbac.role.manage`, tenant entier) et l'anti-escalade
 *      (on n'accorde que ce que l'on détient) ;
 *   2. écrit ;
 *   3. publie `rbac.role.changed` (outbox) et appelle le port d'audit.
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
import { RBAC_ROLE_CHANGED, type RoleChangedPayload } from "../domain/events";
import type { PermissionCatalog } from "../domain/permission-catalog";
import { diffPermissions, missingPermissions, slugifyRoleKey, uniqueRoleKey } from "../domain/role-rules";
import { TENANT_SCOPE } from "../domain/scope";
import { ROLE_KEY_RE } from "../domain/system-roles";
import {
  deleteRoleRow,
  findRoleById,
  findRoleByKey,
  insertRole,
  listRoleKeys,
  listRoles,
  countRoleAssignments,
  replaceRolePermissions,
  selectPending,
  selectRolePermissions,
  touchRole,
  updateRoleFields,
  type RoleRow,
  type RoleSummaryRow,
} from "../infrastructure/repository";
import { isReservedRoleKey } from "../templates/system-roles";
import { loadPermissionCatalog } from "./catalog";
import type { UseCaseDeps } from "./ports";
import { audit, authorizeActor, err, invalid, ok, publish } from "./support";

export interface RoleDetail {
  readonly role: RoleRow;
  /** Permissions concrètes (clés du catalogue actif). */
  readonly permissions: readonly string[];
  /** Motifs de modèle sans correspondance (rôles système seulement). */
  readonly pending: readonly string[];
  readonly assignmentCount: number;
}

type R<T> = Promise<Result<T, AppError>>;

const LABEL_MAX = 120;

function validateLabel(label: unknown): ValidationError | null {
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > LABEL_MAX) {
    return invalid("label", `Le libellé est obligatoire (1 à ${LABEL_MAX} caractères).`, "rbac.invalid_label");
  }
  return null;
}

function checkPermissionKeys(keys: readonly string[], catalog: PermissionCatalog): ValidationError | null {
  const unknown = [...new Set(keys)].filter((k) => !catalog.byKey.has(k));
  if (unknown.length === 0) return null;
  return new ValidationError(
    `Permissions inconnues : ${unknown.join(", ")}.`,
    [{ path: ["permissions"], message: `Permissions inconnues : ${unknown.join(", ")}.`, code: "rbac.unknown_permission" }],
    { code: "rbac.unknown_permission", details: { unknown } },
  );
}

function escalationError(missing: readonly string[]): ForbiddenError {
  return new ForbiddenError("Vous ne pouvez accorder que des permissions que vous détenez vous-même.", {
    code: "rbac.escalation_denied",
    details: { permissions: [...missing] },
  });
}

async function detail(deps: UseCaseDeps, role: RoleRow): Promise<RoleDetail> {
  const [permissions, pending, assignmentCount] = await Promise.all([
    selectRolePermissions(deps.tx, role.tenantId, role.id),
    role.isSystem ? selectPending(deps.tx, role.tenantId, role.id) : Promise.resolve([] as string[]),
    countRoleAssignments(deps.tx, role.tenantId, role.id),
  ]);
  return { role, permissions, pending, assignmentCount };
}

/** Libellé + clé : choisit/valide la clé (explicite → doit être libre ; dérivée → rendue unique). */
async function chooseKey(
  deps: UseCaseDeps,
  tenantId: string,
  explicitKey: string | undefined,
  label: string,
): Promise<Result<string, AppError>> {
  if (explicitKey !== undefined) {
    if (!ROLE_KEY_RE.test(explicitKey)) {
      return err(
        invalid("key", "La clé doit être en minuscules, chiffres et « _ » (2 à 63 caractères).", "rbac.invalid_key"),
      );
    }
    if (isReservedRoleKey(explicitKey)) {
      return err(invalid("key", `La clé "${explicitKey}" est réservée à un modèle système.`, "rbac.role_key_reserved"));
    }
    if (await findRoleByKey(deps.tx, tenantId, explicitKey)) {
      return err(new ConflictError(`Un rôle "${explicitKey}" existe déjà.`, { code: "rbac.role_key_taken", details: { key: explicitKey } }));
    }
    return ok(explicitKey);
  }
  const taken = new Set([...(await listRoleKeys(deps.tx, tenantId)), ...(isReservedRoleKey(slugifyRoleKey(label)) ? [slugifyRoleKey(label)] : [])]);
  return ok(uniqueRoleKey(slugifyRoleKey(label), taken));
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listRolesUseCase(deps: UseCaseDeps, ctx: RequestContext): R<RoleSummaryRow[]> {
  return ok(await listRoles(deps.tx, ctx.tenantId));
}

export async function getRoleUseCase(deps: UseCaseDeps, ctx: RequestContext, roleId: string): R<RoleDetail> {
  const role = await findRoleById(deps.tx, ctx.tenantId, roleId);
  if (!role) return err(NotFoundError.of("Rôle", roleId));
  return ok(await detail(deps, role));
}

// ---------------------------------------------------------------------------
// Création (de zéro) et clonage
// ---------------------------------------------------------------------------

export interface CreateRoleInput {
  readonly key?: string;
  readonly label: string;
  readonly description?: string | null;
  readonly permissions: readonly string[];
}

export async function createRoleUseCase(deps: UseCaseDeps, ctx: RequestContext, input: CreateRoleInput): R<RoleDetail> {
  const denied = authorizeActor(deps, ctx, "rbac.role.manage", TENANT_SCOPE);
  if (denied) return err(denied);
  const badLabel = validateLabel(input.label);
  if (badLabel) return err(badLabel);

  const catalog = await loadPermissionCatalog(deps.tx);
  const badKeys = checkPermissionKeys(input.permissions, catalog);
  if (badKeys) return err(badKeys);

  const permissions = [...new Set(input.permissions)].sort();
  if (ctx.actor !== "system" && deps.actor) {
    const missing = missingPermissions(deps.actor, permissions, TENANT_SCOPE);
    if (missing.length > 0) return err(escalationError(missing));
  }

  const key = await chooseKey(deps, ctx.tenantId, input.key, input.label);
  if (!key.ok) return key;

  const now = deps.clock.now();
  const role = await insertRole(deps.tx, {
    id: newId(now.getTime()),
    tenantId: ctx.tenantId,
    key: key.value,
    label: input.label.trim(),
    description: input.description?.trim() || null,
    isSystem: false,
    templateKey: null,
    clonedFromRoleId: null,
    createdBy: ctx.userId,
    now,
  });
  await replaceRolePermissions(deps.tx, ctx.tenantId, role.id, permissions);

  const payload: RoleChangedPayload = {
    v: 1,
    change: "created",
    roleId: role.id,
    roleKey: role.key,
    isSystem: false,
    label: role.label,
    addedPermissions: permissions,
  };
  await publish(deps, ctx, RBAC_ROLE_CHANGED, "role", role.id, payload);
  await audit(deps, ctx, {
    action: "rbac.role.created",
    entityType: "role",
    entityId: role.id,
    after: { key: role.key, label: role.label, permissions },
  });
  return ok(await detail(deps, role));
}

export interface CloneRoleInput {
  readonly key?: string;
  readonly label: string;
  readonly description?: string | null;
}

export async function cloneRoleUseCase(
  deps: UseCaseDeps,
  ctx: RequestContext,
  sourceRoleId: string,
  input: CloneRoleInput,
): R<RoleDetail> {
  const denied = authorizeActor(deps, ctx, "rbac.role.manage", TENANT_SCOPE);
  if (denied) return err(denied);
  const badLabel = validateLabel(input.label);
  if (badLabel) return err(badLabel);

  const source = await findRoleById(deps.tx, ctx.tenantId, sourceRoleId);
  if (!source) return err(NotFoundError.of("Rôle", sourceRoleId));

  // Seules les permissions du catalogue actif sont copiées (les retirées et les motifs en attente ne le sont pas).
  const catalog = await loadPermissionCatalog(deps.tx);
  const permissions = (await selectRolePermissions(deps.tx, ctx.tenantId, source.id)).filter((k) => catalog.byKey.has(k));

  if (ctx.actor !== "system" && deps.actor) {
    const missing = missingPermissions(deps.actor, permissions, TENANT_SCOPE);
    if (missing.length > 0) return err(escalationError(missing));
  }

  const key = await chooseKey(deps, ctx.tenantId, input.key, input.label);
  if (!key.ok) return key;

  const now = deps.clock.now();
  const role = await insertRole(deps.tx, {
    id: newId(now.getTime()),
    tenantId: ctx.tenantId,
    key: key.value,
    label: input.label.trim(),
    description: input.description === undefined ? source.description : input.description?.trim() || null,
    isSystem: false,
    templateKey: null,
    clonedFromRoleId: source.id,
    createdBy: ctx.userId,
    now,
  });
  await replaceRolePermissions(deps.tx, ctx.tenantId, role.id, permissions);

  await publish(deps, ctx, RBAC_ROLE_CHANGED, "role", role.id, {
    v: 1,
    change: "cloned",
    roleId: role.id,
    roleKey: role.key,
    isSystem: false,
    label: role.label,
    addedPermissions: permissions,
    clonedFromRoleId: source.id,
  } satisfies RoleChangedPayload);
  await audit(deps, ctx, {
    action: "rbac.role.cloned",
    entityType: "role",
    entityId: role.id,
    after: { key: role.key, label: role.label, permissions },
    metadata: { clonedFromRoleId: source.id, clonedFromKey: source.key },
  });
  return ok(await detail(deps, role));
}

// ---------------------------------------------------------------------------
// Modification
// ---------------------------------------------------------------------------

export interface UpdateRoleInput {
  readonly label?: string;
  readonly description?: string | null;
  /** Remplace l'ensemble des permissions du rôle. */
  readonly permissions?: readonly string[];
}

export async function updateRoleUseCase(
  deps: UseCaseDeps,
  ctx: RequestContext,
  roleId: string,
  input: UpdateRoleInput,
): R<RoleDetail> {
  const denied = authorizeActor(deps, ctx, "rbac.role.manage", TENANT_SCOPE);
  if (denied) return err(denied);

  const role = await findRoleById(deps.tx, ctx.tenantId, roleId, { forUpdate: true });
  if (!role) return err(NotFoundError.of("Rôle", roleId));
  if (role.isSystem) {
    return err(
      new ForbiddenError("Un rôle système est verrouillé : clonez-le pour l'adapter.", {
        code: "rbac.role_locked",
        details: { roleId, key: role.key },
      }),
    );
  }
  if (input.label !== undefined) {
    const bad = validateLabel(input.label);
    if (bad) return err(bad);
  }

  const before = await selectRolePermissions(deps.tx, ctx.tenantId, role.id);
  let added: string[] = [];
  let removed: string[] = [];
  let after = before;

  if (input.permissions !== undefined) {
    const catalog = await loadPermissionCatalog(deps.tx);
    const bad = checkPermissionKeys(input.permissions, catalog);
    if (bad) return err(bad);
    after = [...new Set(input.permissions)].sort();
    ({ added, removed } = diffPermissions(before, after));
    if (ctx.actor !== "system" && deps.actor && added.length > 0) {
      const missing = missingPermissions(deps.actor, added, TENANT_SCOPE);
      if (missing.length > 0) return err(escalationError(missing));
    }
  }

  const now = deps.clock.now();
  const fields: { label?: string; description?: string | null } = {};
  if (input.label !== undefined) fields.label = input.label.trim();
  if (input.description !== undefined) fields.description = input.description?.trim() || null;
  const fieldsChanged =
    (fields.label !== undefined && fields.label !== role.label) ||
    (fields.description !== undefined && fields.description !== role.description);

  if (fieldsChanged) await updateRoleFields(deps.tx, ctx.tenantId, role.id, fields, now);
  if (added.length > 0 || removed.length > 0) {
    await replaceRolePermissions(deps.tx, ctx.tenantId, role.id, after);
    if (!fieldsChanged) await touchRole(deps.tx, ctx.tenantId, role.id, now);
  }

  if (fieldsChanged || added.length > 0 || removed.length > 0) {
    await publish(deps, ctx, RBAC_ROLE_CHANGED, "role", role.id, {
      v: 1,
      change: "updated",
      roleId: role.id,
      roleKey: role.key,
      isSystem: false,
      label: fields.label ?? role.label,
      addedPermissions: added,
      removedPermissions: removed,
    } satisfies RoleChangedPayload);
    await audit(deps, ctx, {
      action: "rbac.role.updated",
      entityType: "role",
      entityId: role.id,
      before: { label: role.label, description: role.description, permissions: before },
      after: { label: fields.label ?? role.label, description: fields.description ?? role.description, permissions: after },
    });
  }

  const fresh = (await findRoleById(deps.tx, ctx.tenantId, role.id)) as RoleRow;
  return ok(await detail(deps, fresh));
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

export async function deleteRoleUseCase(deps: UseCaseDeps, ctx: RequestContext, roleId: string): R<{ deleted: true }> {
  const denied = authorizeActor(deps, ctx, "rbac.role.manage", TENANT_SCOPE);
  if (denied) return err(denied);

  const role = await findRoleById(deps.tx, ctx.tenantId, roleId, { forUpdate: true });
  if (!role) return err(NotFoundError.of("Rôle", roleId));
  if (role.isSystem) {
    return err(
      new ForbiddenError("Un rôle système ne peut pas être supprimé.", {
        code: "rbac.role_locked",
        details: { roleId, key: role.key },
      }),
    );
  }
  const assigned = await countRoleAssignments(deps.tx, ctx.tenantId, role.id);
  if (assigned > 0) {
    return err(
      new ConflictError(`Ce rôle est assigné (${assigned}) : retirez ses assignations avant de le supprimer.`, {
        code: "rbac.role_in_use",
        details: { roleId, assignments: assigned },
      }),
    );
  }

  const permissions = await selectRolePermissions(deps.tx, ctx.tenantId, role.id);
  await deleteRoleRow(deps.tx, ctx.tenantId, role.id);

  await publish(deps, ctx, RBAC_ROLE_CHANGED, "role", role.id, {
    v: 1,
    change: "deleted",
    roleId: role.id,
    roleKey: role.key,
    isSystem: false,
    label: role.label,
    removedPermissions: permissions,
  } satisfies RoleChangedPayload);
  await audit(deps, ctx, {
    action: "rbac.role.deleted",
    entityType: "role",
    entityId: role.id,
    before: { key: role.key, label: role.label, permissions },
  });
  return ok({ deleted: true });
}
