/**
 * Accès SQL du module rbac (schéma `rbac`). Toutes les fonctions reçoivent le
 * `Tx` d'un `TenantDb.run` : la RLS isole les tenants ; les `tenant_id = $n`
 * explicites servent les index et la lisibilité.
 */
import type { Tx } from "@ecoledigitale/database";
import type { CatalogEntry } from "../domain/permission-catalog";

// ---------------------------------------------------------------------------
// Types de lignes
// ---------------------------------------------------------------------------

export interface RoleRow {
  id: string;
  tenantId: string;
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  templateKey: string | null;
  clonedFromRoleId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleSummaryRow extends RoleRow {
  permissionCount: number;
  pendingCount: number;
  assignmentCount: number;
}

export interface AssignmentRow {
  id: string;
  tenantId: string;
  userId: string;
  identityId: string | null;
  roleId: string;
  roleKey: string;
  scopeType: "tenant" | "institution" | "campus";
  scopeId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  grantedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ROLE_COLS = `
  r.id, r.tenant_id AS "tenantId", r.key, r.label, r.description,
  r.is_system AS "isSystem", r.template_key AS "templateKey",
  r.cloned_from_role_id AS "clonedFromRoleId", r.created_by AS "createdBy",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;

const ASSIGNMENT_COLS = `
  a.id, a.tenant_id AS "tenantId", a.user_id AS "userId", a.identity_id AS "identityId",
  a.role_id AS "roleId", r.key AS "roleKey", a.scope_type AS "scopeType", a.scope_id AS "scopeId",
  a.valid_from AS "validFrom", a.valid_until AS "validUntil", a.granted_by AS "grantedBy",
  a.created_at AS "createdAt", a.updated_at AS "updatedAt"`;

// ---------------------------------------------------------------------------
// Catalogue (global)
// ---------------------------------------------------------------------------

export interface CatalogRow extends CatalogEntry {
  readonly retiredAt: Date | null;
}

export async function selectCatalog(tx: Tx, options: { includeRetired?: boolean } = {}): Promise<CatalogRow[]> {
  return tx.many<CatalogRow>(
    `SELECT key, label, description, sensitive, module_key AS "moduleKey", retired_at AS "retiredAt"
       FROM rbac.permissions
      ${options.includeRetired ? "" : "WHERE retired_at IS NULL"}
      ORDER BY key`,
  );
}

export interface CatalogUpsertResult {
  inserted: string[];
  updated: string[];
  retired: string[];
}

export async function upsertCatalog(tx: Tx, entries: readonly CatalogEntry[]): Promise<CatalogUpsertResult> {
  const rows = await tx.many<{ key: string; inserted: boolean }>(
    `INSERT INTO rbac.permissions AS p (key, module_key, label, description, sensitive)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::boolean[])
     ON CONFLICT (key) DO UPDATE
        SET module_key = EXCLUDED.module_key,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            sensitive = EXCLUDED.sensitive,
            retired_at = NULL,
            updated_at = now()
      WHERE (p.module_key, p.label, p.description, p.sensitive, p.retired_at)
            IS DISTINCT FROM (EXCLUDED.module_key, EXCLUDED.label, EXCLUDED.description, EXCLUDED.sensitive, NULL::timestamptz)
     RETURNING key, (xmax = 0) AS inserted`,
    [
      entries.map((e) => e.key),
      entries.map((e) => e.moduleKey),
      entries.map((e) => e.label),
      entries.map((e) => e.description),
      entries.map((e) => e.sensitive),
    ],
  );
  const retired = await tx.many<{ key: string }>(
    `UPDATE rbac.permissions
        SET retired_at = now(), updated_at = now()
      WHERE retired_at IS NULL AND key <> ALL($1::text[])
      RETURNING key`,
    [entries.map((e) => e.key)],
  );
  return {
    inserted: rows.filter((r) => r.inserted).map((r) => r.key).sort(),
    updated: rows.filter((r) => !r.inserted).map((r) => r.key).sort(),
    retired: retired.map((r) => r.key).sort(),
  };
}

// ---------------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------------

export async function findRoleById(tx: Tx, tenantId: string, id: string, options: { forUpdate?: boolean } = {}): Promise<RoleRow | null> {
  return tx.queryOne<RoleRow>(
    `SELECT ${ROLE_COLS} FROM rbac.roles r WHERE r.tenant_id = $1 AND r.id = $2 ${options.forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, id],
  );
}

export async function findRoleByKey(tx: Tx, tenantId: string, key: string): Promise<RoleRow | null> {
  return tx.queryOne<RoleRow>(`SELECT ${ROLE_COLS} FROM rbac.roles r WHERE r.tenant_id = $1 AND r.key = $2`, [tenantId, key]);
}

export async function findRoleByTemplate(tx: Tx, tenantId: string, templateKey: string): Promise<RoleRow | null> {
  return tx.queryOne<RoleRow>(
    `SELECT ${ROLE_COLS} FROM rbac.roles r WHERE r.tenant_id = $1 AND r.template_key = $2`,
    [tenantId, templateKey],
  );
}

export async function listRoleKeys(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx.many<{ key: string }>("SELECT key FROM rbac.roles WHERE tenant_id = $1", [tenantId]);
  return rows.map((r) => r.key);
}

export async function listRoles(tx: Tx, tenantId: string): Promise<RoleSummaryRow[]> {
  return tx.many<RoleSummaryRow>(
    `SELECT ${ROLE_COLS},
            (SELECT count(*)::int FROM rbac.role_permissions rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id) AS "permissionCount",
            (SELECT count(*)::int FROM rbac.role_pending_permissions pp WHERE pp.tenant_id = r.tenant_id AND pp.role_id = r.id) AS "pendingCount",
            (SELECT count(*)::int FROM rbac.user_role_assignments a WHERE a.tenant_id = r.tenant_id AND a.role_id = r.id) AS "assignmentCount"
       FROM rbac.roles r
      WHERE r.tenant_id = $1
      ORDER BY r.is_system DESC, r.label, r.key`,
    [tenantId],
  );
}

export async function insertRole(
  tx: Tx,
  row: {
    id: string;
    tenantId: string;
    key: string;
    label: string;
    description: string | null;
    isSystem: boolean;
    templateKey: string | null;
    clonedFromRoleId: string | null;
    createdBy: string | null;
    now: Date;
  },
): Promise<RoleRow> {
  await tx.query(
    `INSERT INTO rbac.roles (id, tenant_id, key, label, description, is_system, template_key, cloned_from_role_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      row.id,
      row.tenantId,
      row.key,
      row.label,
      row.description,
      row.isSystem,
      row.templateKey,
      row.clonedFromRoleId,
      row.createdBy,
      row.now,
    ],
  );
  return (await findRoleById(tx, row.tenantId, row.id)) as RoleRow;
}

export async function updateRoleFields(
  tx: Tx,
  tenantId: string,
  id: string,
  fields: { label?: string; description?: string | null },
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE rbac.roles
        SET label = COALESCE($3, label),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            updated_at = $6
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, fields.label ?? null, fields.description !== undefined, fields.description ?? null, now],
  );
}

export async function deleteRoleRow(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.query("DELETE FROM rbac.roles WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
}

export async function touchRole(tx: Tx, tenantId: string, id: string, now: Date): Promise<void> {
  await tx.query("UPDATE rbac.roles SET updated_at = $3 WHERE tenant_id = $1 AND id = $2", [tenantId, id, now]);
}

/**
 * Libère une clé réservée par un modèle système : un rôle PERSONNALISÉ (créé avant
 * que ce modèle n'existe) la portait. Réservé à `instantiateSystemRoles` ; le
 * trigger n'autorise le changement de clé que pour les rôles non-système.
 */
export async function relocateCustomRoleKey(tx: Tx, tenantId: string, roleId: string, newKey: string, now: Date): Promise<void> {
  await tx.query(
    'UPDATE rbac.roles SET key = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2 AND NOT is_system',
    [tenantId, roleId, newKey, now],
  );
}

export async function findCustomRoleWithKey(tx: Tx, tenantId: string, key: string): Promise<RoleRow | null> {
  return tx.queryOne<RoleRow>(
    `SELECT ${ROLE_COLS} FROM rbac.roles r WHERE r.tenant_id = $1 AND r.key = $2 AND NOT r.is_system`,
    [tenantId, key],
  );
}

// ---------------------------------------------------------------------------
// Permissions d'un rôle
// ---------------------------------------------------------------------------

export async function selectRolePermissions(tx: Tx, tenantId: string, roleId: string): Promise<string[]> {
  const rows = await tx.many<{ key: string }>(
    `SELECT permission_key AS key FROM rbac.role_permissions WHERE tenant_id = $1 AND role_id = $2 ORDER BY permission_key`,
    [tenantId, roleId],
  );
  return rows.map((r) => r.key);
}

/** Aligne les permissions du rôle sur `keys` (insère le manquant, supprime le surplus). */
export async function replaceRolePermissions(
  tx: Tx,
  tenantId: string,
  roleId: string,
  keys: readonly string[],
): Promise<{ added: string[]; removed: string[] }> {
  const unique = [...new Set(keys)];
  const removed = await tx.many<{ key: string }>(
    `DELETE FROM rbac.role_permissions
      WHERE tenant_id = $1 AND role_id = $2 AND permission_key <> ALL($3::text[])
      RETURNING permission_key AS key`,
    [tenantId, roleId, unique],
  );
  const added = await tx.many<{ key: string }>(
    `INSERT INTO rbac.role_permissions (tenant_id, role_id, permission_key)
     SELECT $1, $2, k FROM unnest($3::text[]) AS k
     ON CONFLICT DO NOTHING
     RETURNING permission_key AS key`,
    [tenantId, roleId, unique],
  );
  return { added: added.map((r) => r.key).sort(), removed: removed.map((r) => r.key).sort() };
}

export async function selectPending(tx: Tx, tenantId: string, roleId: string): Promise<string[]> {
  const rows = await tx.many<{ pattern: string }>(
    "SELECT pattern FROM rbac.role_pending_permissions WHERE tenant_id = $1 AND role_id = $2 ORDER BY pattern",
    [tenantId, roleId],
  );
  return rows.map((r) => r.pattern);
}

export async function replacePending(tx: Tx, tenantId: string, roleId: string, patterns: readonly string[]): Promise<void> {
  const unique = [...new Set(patterns)];
  await tx.query(
    "DELETE FROM rbac.role_pending_permissions WHERE tenant_id = $1 AND role_id = $2 AND pattern <> ALL($3::text[])",
    [tenantId, roleId, unique],
  );
  if (unique.length > 0) {
    await tx.query(
      `INSERT INTO rbac.role_pending_permissions (tenant_id, role_id, pattern)
       SELECT $1, $2, p FROM unnest($3::text[]) AS p
       ON CONFLICT DO NOTHING`,
      [tenantId, roleId, unique],
    );
  }
}

// ---------------------------------------------------------------------------
// Assignations
// ---------------------------------------------------------------------------

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export async function findAssignmentById(tx: Tx, tenantId: string, id: string): Promise<AssignmentRow | null> {
  return tx.queryOne<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLS}
       FROM rbac.user_role_assignments a
       JOIN rbac.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
      WHERE a.tenant_id = $1 AND a.id = $2`,
    [tenantId, id],
  );
}

export async function listAssignments(
  tx: Tx,
  tenantId: string,
  filter: { userId?: string; roleId?: string; limit?: number; offset?: number } = {},
): Promise<AssignmentRow[]> {
  return tx.many<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLS}
       FROM rbac.user_role_assignments a
       JOIN rbac.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
      WHERE a.tenant_id = $1
        AND ($2::uuid IS NULL OR a.user_id = $2)
        AND ($3::uuid IS NULL OR a.role_id = $3)
      ORDER BY a.created_at, a.id
      LIMIT $4 OFFSET $5`,
    [tenantId, filter.userId ?? null, filter.roleId ?? null, Math.min(filter.limit ?? 200, 500), filter.offset ?? 0],
  );
}

export async function countRoleAssignments(tx: Tx, tenantId: string, roleId: string): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM rbac.user_role_assignments WHERE tenant_id = $1 AND role_id = $2",
    [tenantId, roleId],
  );
  return row?.n ?? 0;
}

export interface UpsertAssignmentInput {
  id: string;
  tenantId: string;
  userId: string;
  identityId: string | null;
  roleId: string;
  scopeType: "tenant" | "institution" | "campus";
  scopeId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  grantedBy: string | null;
  now: Date;
}

/** Crée l'assignation ou met à jour sa validité si (utilisateur, rôle, périmètre) existe déjà. */
export async function upsertAssignment(tx: Tx, input: UpsertAssignmentInput): Promise<{ id: string; created: boolean }> {
  const row = await tx.queryOne<{ id: string; created: boolean }>(
    `INSERT INTO rbac.user_role_assignments AS a
        (id, tenant_id, user_id, identity_id, role_id, scope_type, scope_id, valid_from, valid_until, granted_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (tenant_id, user_id, role_id, scope_type, COALESCE(scope_id, '${ZERO_UUID}'::uuid))
     DO UPDATE SET valid_from = EXCLUDED.valid_from,
                   valid_until = EXCLUDED.valid_until,
                   identity_id = COALESCE(EXCLUDED.identity_id, a.identity_id),
                   granted_by = EXCLUDED.granted_by,
                   updated_at = EXCLUDED.updated_at
     RETURNING id, (xmax = 0) AS created`,
    [
      input.id,
      input.tenantId,
      input.userId,
      input.identityId,
      input.roleId,
      input.scopeType,
      input.scopeId,
      input.validFrom,
      input.validUntil,
      input.grantedBy,
      input.now,
    ],
  );
  return row as { id: string; created: boolean };
}

export async function updateAssignmentValidity(
  tx: Tx,
  tenantId: string,
  id: string,
  validity: { validFrom: Date | null; validUntil: Date | null },
  now: Date,
): Promise<void> {
  await tx.query(
    "UPDATE rbac.user_role_assignments SET valid_from = $3, valid_until = $4, updated_at = $5 WHERE tenant_id = $1 AND id = $2",
    [tenantId, id, validity.validFrom, validity.validUntil, now],
  );
}

export async function deleteAssignmentRow(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.query("DELETE FROM rbac.user_role_assignments WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
}

/**
 * Autres titulaires ACTIFS du rôle `owner` (tenant entier) hors l'assignation donnée :
 * sert à ne jamais retirer le dernier propriétaire.
 */
export async function countOtherActiveOwners(tx: Tx, tenantId: string, excludeAssignmentId: string, now: Date): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    `SELECT count(DISTINCT a.user_id)::int AS n
       FROM rbac.user_role_assignments a
       JOIN rbac.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
      WHERE a.tenant_id = $1 AND r.template_key = 'owner' AND a.scope_type = 'tenant'
        AND a.id <> $2
        AND (a.valid_from IS NULL OR a.valid_from <= $3)
        AND (a.valid_until IS NULL OR a.valid_until > $3)`,
    [tenantId, excludeAssignmentId, now],
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Chargement du PermissionSet
// ---------------------------------------------------------------------------

export interface GrantRow {
  assignmentId: string;
  roleId: string;
  scopeType: "tenant" | "institution" | "campus";
  scopeId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  permissionKey: string;
  sensitive: boolean;
}

/** Octrois de l'utilisateur : assignations non expirées × permissions ACTIVES de leur rôle. */
export async function selectGrants(tx: Tx, tenantId: string, userId: string, now: Date): Promise<GrantRow[]> {
  return tx.many<GrantRow>(
    `SELECT a.id AS "assignmentId", a.role_id AS "roleId", a.scope_type AS "scopeType", a.scope_id AS "scopeId",
            a.valid_from AS "validFrom", a.valid_until AS "validUntil",
            rp.permission_key AS "permissionKey", p.sensitive
       FROM rbac.user_role_assignments a
       JOIN rbac.role_permissions rp ON rp.tenant_id = a.tenant_id AND rp.role_id = a.role_id
       JOIN rbac.permissions p ON p.key = rp.permission_key AND p.retired_at IS NULL
      WHERE a.tenant_id = $1 AND a.user_id = $2
        AND (a.valid_until IS NULL OR a.valid_until > $3)`,
    [tenantId, userId, now],
  );
}

/** Assignations (même sans permission) — pour les rôles vides, utile au diagnostic. */
export async function selectUserAssignments(tx: Tx, tenantId: string, userId: string): Promise<AssignmentRow[]> {
  return tx.many<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLS}
       FROM rbac.user_role_assignments a
       JOIN rbac.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
      WHERE a.tenant_id = $1 AND a.user_id = $2
      ORDER BY a.created_at, a.id`,
    [tenantId, userId],
  );
}
