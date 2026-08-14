import bcrypt from "bcryptjs";
import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import {
  ADMIN_MENU_KEYS,
  MENU_SCOPES,
  MENU_SCOPE_LABELS,
  menuItemsForScope,
  type AdminManagedUser,
  type AdminMyMenusResponse,
  type AdminRole,
  type MenuScope,
  type RoleMenuSetting,
} from "@ecoledigitale/contracts";

/**
 * Rôle socle attribué à tout utilisateur créé depuis « Administration → Utilisateurs ».
 * Les rôles administratifs personnalisés ne remplacent pas les rôles socle : ils
 * restreignent les menus visibles à l'intérieur de l'espace administrateur.
 */
const BASE_ROLE_KEY = "admin";

export type AdminRolesFailure = {
  ok: false;
  status: 400 | 404 | 409;
  message: string;
};

type Ok<T> = { ok: true; value: T };
export type AdminRolesResult<T> = Ok<T> | AdminRolesFailure;

/**
 * Le build de l'API tourne avec `strict: false` : le narrowing par discriminant
 * n'y est pas fiable. Ce prédicat explicite le rend indépendant de l'option.
 */
export function isAdminRolesFailure<T>(result: AdminRolesResult<T>): result is AdminRolesFailure {
  return result.ok === false;
}

async function withTenantClient<T>(
  pool: Pool,
  tenantId: string,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await run(client);
  } finally {
    client.release();
  }
}

/** Rejette les clés absentes du catalogue pour éviter d'stocker des permissions mortes. */
function validateMenuKeys(menuKeys: string[]): AdminRolesFailure | null {
  const unknown = [...new Set(menuKeys)].filter((key) => !ADMIN_MENU_KEYS.includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      message: `Menu(s) inconnu(s) : ${unknown.join(", ")}`,
    };
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function replaceRoleMenus(
  client: PoolClient,
  tenantId: string,
  roleId: string,
  menuKeys: string[]
): Promise<void> {
  await client.query(`DELETE FROM admin_role_menus WHERE admin_role_id = $1::uuid`, [roleId]);
  const unique = [...new Set(menuKeys)];
  if (unique.length === 0) return;
  await client.query(
    `INSERT INTO admin_role_menus (tenant_id, admin_role_id, menu_key)
     SELECT $1::uuid, $2::uuid, key
     FROM UNNEST($3::varchar[]) AS key
     ON CONFLICT (admin_role_id, menu_key) DO NOTHING`,
    [tenantId, roleId, unique]
  );
}

async function readRole(
  client: PoolClient,
  tenantId: string,
  roleId: string
): Promise<AdminRole | null> {
  const res = await client.query<{
    id: string;
    name: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    menu_keys: string[] | null;
    user_count: string;
  }>(
    `SELECT r.id, r.name, r.is_active, r.created_at, r.updated_at,
            COALESCE(
              (SELECT array_agg(m.menu_key ORDER BY m.menu_key)
               FROM admin_role_menus m WHERE m.admin_role_id = r.id),
              ARRAY[]::varchar[]
            ) AS menu_keys,
            (SELECT COUNT(*) FROM user_admin_roles ua WHERE ua.admin_role_id = r.id)::text AS user_count
     FROM admin_roles r
     WHERE r.id = $1::uuid AND r.tenant_id = $2::uuid`,
    [roleId, tenantId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    menuKeys: row.menu_keys ?? [],
    userCount: Number(row.user_count) || 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAdminRoles(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<AdminRole[]> {
  try {
    return await withTenantClient(pool, tenantId, async (client) => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM admin_roles WHERE tenant_id = $1::uuid ORDER BY LOWER(name)`,
        [tenantId]
      );
      const roles: AdminRole[] = [];
      for (const { id } of res.rows) {
        const role = await readRole(client, tenantId, id);
        if (role) roles.push(role);
      }
      return roles;
    });
  } catch (e) {
    log.error({ err: e }, "admin roles list failed");
    return [];
  }
}

export async function createAdminRole(
  pool: Pool,
  tenantId: string,
  input: { name: string; menuKeys: string[] },
  log: FastifyBaseLogger
): Promise<AdminRolesResult<AdminRole>> {
  const invalid = validateMenuKeys(input.menuKeys);
  if (invalid) return invalid;

  return withTenantClient(pool, tenantId, async (client) => {
    try {
      await client.query("BEGIN");
      const res = await client.query<{ id: string }>(
        `INSERT INTO admin_roles (tenant_id, name)
         VALUES ($1::uuid, $2)
         RETURNING id`,
        [tenantId, input.name]
      );
      const roleId = res.rows[0].id;
      await replaceRoleMenus(client, tenantId, roleId, input.menuKeys);
      const role = await readRole(client, tenantId, roleId);
      await client.query("COMMIT");
      return { ok: true as const, value: role! };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if (isUniqueViolation(e)) {
        return {
          ok: false as const,
          status: 409 as const,
          message: `Un rôle nommé « ${input.name} » existe déjà.`,
        };
      }
      log.error({ err: e }, "admin role create failed");
      return {
        ok: false as const,
        status: 400 as const,
        message: e instanceof Error ? e.message : "Création du rôle impossible.",
      };
    }
  });
}

export async function updateAdminRole(
  pool: Pool,
  tenantId: string,
  roleId: string,
  input: {
    name?: string;
    isActive?: boolean;
    menuKeys?: string[];
  },
  log: FastifyBaseLogger
): Promise<AdminRolesResult<AdminRole>> {
  if (input.menuKeys) {
    const invalid = validateMenuKeys(input.menuKeys);
    if (invalid) return invalid;
  }

  return withTenantClient(pool, tenantId, async (client) => {
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM admin_roles WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE`,
        [roleId, tenantId]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return { ok: false as const, status: 404 as const, message: "Rôle introuvable." };
      }

      await client.query(
        `UPDATE admin_roles
         SET name = COALESCE($3::varchar, name),
             is_active = COALESCE($4::boolean, is_active),
             updated_at = now()
         WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [roleId, tenantId, input.name ?? null, input.isActive ?? null]
      );

      if (input.menuKeys) {
        await replaceRoleMenus(client, tenantId, roleId, input.menuKeys);
      }

      const role = await readRole(client, tenantId, roleId);
      await client.query("COMMIT");
      return { ok: true as const, value: role! };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if (isUniqueViolation(e)) {
        return {
          ok: false as const,
          status: 409 as const,
          message: "Un rôle porte déjà ce nom.",
        };
      }
      log.error({ err: e, roleId }, "admin role update failed");
      return {
        ok: false as const,
        status: 400 as const,
        message: e instanceof Error ? e.message : "Mise à jour du rôle impossible.",
      };
    }
  });
}

export async function deleteAdminRole(
  pool: Pool,
  tenantId: string,
  roleId: string,
  log: FastifyBaseLogger
): Promise<AdminRolesResult<{ id: string }>> {
  return withTenantClient(pool, tenantId, async (client) => {
    try {
      const used = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM user_admin_roles WHERE admin_role_id = $1::uuid`,
        [roleId]
      );
      if ((Number(used.rows[0]?.n) || 0) > 0) {
        return {
          ok: false as const,
          status: 409 as const,
          message:
            "Ce rôle est encore attribué à des utilisateurs. Réaffectez-les avant de le supprimer.",
        };
      }
      const res = await client.query(
        `DELETE FROM admin_roles WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [roleId, tenantId]
      );
      if (res.rowCount === 0) {
        return { ok: false as const, status: 404 as const, message: "Rôle introuvable." };
      }
      return { ok: true as const, value: { id: roleId } };
    } catch (e) {
      log.error({ err: e, roleId }, "admin role delete failed");
      return {
        ok: false as const,
        status: 400 as const,
        message: e instanceof Error ? e.message : "Suppression impossible.",
      };
    }
  });
}

export async function listManagedUsers(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<AdminManagedUser[]> {
  try {
    return await withTenantClient(pool, tenantId, async (client) => {
      const res = await client.query<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        is_active: boolean | null;
        created_at: Date;
        admin_role_id: string | null;
        admin_role_name: string | null;
        role_keys: string[] | null;
      }>(
        `SELECT u.id, u.email, u.first_name, u.last_name, COALESCE(u.is_active, true) AS is_active,
                u.created_at,
                ar.id AS admin_role_id,
                ar.name AS admin_role_name,
                COALESCE(
                  (SELECT array_agg(DISTINCT r.key ORDER BY r.key)
                   FROM user_roles ur
                   JOIN roles r ON r.id = ur.role_id
                   WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id),
                  ARRAY[]::varchar[]
                ) AS role_keys
         FROM users u
         LEFT JOIN user_admin_roles ua ON ua.user_id = u.id AND ua.tenant_id = u.tenant_id
         LEFT JOIN admin_roles ar ON ar.id = ua.admin_role_id
         WHERE u.tenant_id = $1::uuid
         ORDER BY u.created_at DESC`,
        [tenantId]
      );
      return res.rows.map((row) => ({
        userId: row.id,
        email: row.email,
        firstName: row.first_name ?? "",
        lastName: row.last_name ?? "",
        isActive: row.is_active ?? true,
        adminRoleId: row.admin_role_id,
        adminRoleName: row.admin_role_name,
        roleKeys: row.role_keys ?? [],
        createdAt: row.created_at.toISOString(),
      }));
    });
  } catch (e) {
    log.error({ err: e }, "admin managed users list failed");
    return [];
  }
}

export async function createManagedUser(
  pool: Pool,
  tenantId: string,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    adminRoleId: string;
  },
  log: FastifyBaseLogger
): Promise<AdminRolesResult<AdminManagedUser>> {
  const email = input.email.trim().toLowerCase();

  return withTenantClient(pool, tenantId, async (client) => {
    try {
      await client.query("BEGIN");

      const role = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM admin_roles
         WHERE id = $1::uuid AND tenant_id = $2::uuid AND is_active = true`,
        [input.adminRoleId, tenantId]
      );
      if (role.rows.length === 0) {
        await client.query("ROLLBACK");
        return {
          ok: false as const,
          status: 404 as const,
          message: "Rôle introuvable ou désactivé.",
        };
      }

      const existing = await client.query(
        `SELECT id FROM users WHERE tenant_id = $1::uuid AND LOWER(email) = $2`,
        [tenantId, email]
      );
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return {
          ok: false as const,
          status: 409 as const,
          message: "Un utilisateur avec cet email existe déjà.",
        };
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      const fullName = `${input.firstName} ${input.lastName}`.trim();

      const created = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, created_at`,
        [tenantId, email, fullName, input.firstName, input.lastName, passwordHash]
      );
      const userId = created.rows[0].id;

      // Rôle socle « admin » : sans lui, l'utilisateur n'atteindrait ni l'espace
      // d'administration côté web ni les endpoints protégés par requireOwnerOrAdmin.
      const baseRole = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE key = $1::varchar(50) AND COALESCE(is_active, true) = true LIMIT 1`,
        [BASE_ROLE_KEY]
      );
      if (baseRole.rows.length === 0) {
        await client.query("ROLLBACK");
        return {
          ok: false as const,
          status: 409 as const,
          message: `Le rôle socle « ${BASE_ROLE_KEY} » est absent de la base (exécutez les migrations).`,
        };
      }
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NOW())
         ON CONFLICT DO NOTHING`,
        [tenantId, userId, baseRole.rows[0].id]
      );

      await client.query(
        `INSERT INTO user_admin_roles (user_id, tenant_id, admin_role_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid)
         ON CONFLICT (user_id) DO UPDATE
           SET admin_role_id = EXCLUDED.admin_role_id, updated_at = now()`,
        [userId, tenantId, input.adminRoleId]
      );

      await client.query("COMMIT");

      return {
        ok: true as const,
        value: {
          userId,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          isActive: true,
          adminRoleId: input.adminRoleId,
          adminRoleName: role.rows[0].name,
          roleKeys: [BASE_ROLE_KEY],
          createdAt: created.rows[0].created_at.toISOString(),
        },
      };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if (isUniqueViolation(e)) {
        return {
          ok: false as const,
          status: 409 as const,
          message: "Un utilisateur avec cet email existe déjà.",
        };
      }
      log.error({ err: e }, "admin managed user create failed");
      return {
        ok: false as const,
        status: 400 as const,
        message: e instanceof Error ? e.message : "Création de l'utilisateur impossible.",
      };
    }
  });
}

export async function setUserAdminRole(
  pool: Pool,
  tenantId: string,
  userId: string,
  adminRoleId: string | null,
  log: FastifyBaseLogger
): Promise<AdminRolesResult<{ userId: string; adminRoleId: string | null }>> {
  return withTenantClient(pool, tenantId, async (client) => {
    try {
      const user = await client.query(
        `SELECT id FROM users WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [userId, tenantId]
      );
      if (user.rows.length === 0) {
        return { ok: false as const, status: 404 as const, message: "Utilisateur introuvable." };
      }

      if (adminRoleId === null) {
        await client.query(
          `DELETE FROM user_admin_roles WHERE user_id = $1::uuid AND tenant_id = $2::uuid`,
          [userId, tenantId]
        );
        return { ok: true as const, value: { userId, adminRoleId: null } };
      }

      const role = await client.query(
        `SELECT id FROM admin_roles WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [adminRoleId, tenantId]
      );
      if (role.rows.length === 0) {
        return { ok: false as const, status: 404 as const, message: "Rôle introuvable." };
      }

      await client.query(
        `INSERT INTO user_admin_roles (user_id, tenant_id, admin_role_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid)
         ON CONFLICT (user_id) DO UPDATE
           SET admin_role_id = EXCLUDED.admin_role_id, updated_at = now()`,
        [userId, tenantId, adminRoleId]
      );
      return { ok: true as const, value: { userId, adminRoleId } };
    } catch (e) {
      log.error({ err: e, userId }, "admin set user role failed");
      return {
        ok: false as const,
        status: 400 as const,
        message: e instanceof Error ? e.message : "Affectation du rôle impossible.",
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Menus par défaut des rôles socle
// ---------------------------------------------------------------------------

function isMenuScope(value: string): value is MenuScope {
  return (MENU_SCOPES as readonly string[]).includes(value);
}

export async function listRoleMenuSettings(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<RoleMenuSetting[]> {
  let deniedByRole = new Map<string, string[]>();
  try {
    deniedByRole = await withTenantClient(pool, tenantId, async (client) => {
      const res = await client.query<{ role_key: string; menu_key: string }>(
        `SELECT role_key, menu_key FROM role_menu_denials
         WHERE tenant_id = $1::uuid
         ORDER BY role_key, menu_key`,
        [tenantId]
      );
      const map = new Map<string, string[]>();
      for (const row of res.rows) {
        const list = map.get(row.role_key) ?? [];
        list.push(row.menu_key);
        map.set(row.role_key, list);
      }
      return map;
    });
  } catch (e) {
    // Base non migrée : on renvoie les menus par défaut plutôt qu'une erreur.
    log.warn({ err: e }, "role menu denials lookup failed, falling back to defaults");
  }

  return MENU_SCOPES.map((roleKey) => ({
    roleKey,
    label: MENU_SCOPE_LABELS[roleKey],
    deniedMenuKeys: deniedByRole.get(roleKey) ?? [],
  }));
}

/**
 * Remplace les menus autorisés d'un rôle socle.
 *
 * On stocke l'inverse de ce que coche l'utilisateur : tout menu du catalogue
 * absent de `allowedMenuKeys` devient une exclusion. Une base vide signifie donc
 * « menus livrés par défaut », y compris après l'ajout d'un nouveau menu au
 * catalogue — qui reste ainsi visible tant qu'on ne l'a pas explicitement retiré.
 */
export async function setRoleMenus(
  pool: Pool,
  tenantId: string,
  roleKey: string,
  allowedMenuKeys: string[],
  log: FastifyBaseLogger
): Promise<AdminRolesResult<RoleMenuSetting>> {
  if (!isMenuScope(roleKey)) {
    return {
      ok: false,
      status: 400,
      message: `Rôle inconnu : « ${roleKey} ». Rôles gérables : ${MENU_SCOPES.join(", ")}.`,
    };
  }

  const catalogKeys = menuItemsForScope(roleKey).map((item) => item.key);
  const allowed = new Set(allowedMenuKeys);
  const unknown = [...allowed].filter((key) => !catalogKeys.includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      message: `Menu(s) hors du périmètre « ${roleKey} » : ${unknown.join(", ")}`,
    };
  }

  const denied = catalogKeys.filter((key) => !allowed.has(key));

  return withTenantClient(pool, tenantId, async (client) => {
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM role_menu_denials WHERE tenant_id = $1::uuid AND role_key = $2::varchar`,
        [tenantId, roleKey]
      );
      if (denied.length > 0) {
        await client.query(
          `INSERT INTO role_menu_denials (tenant_id, role_key, menu_key)
           SELECT $1::uuid, $2::varchar, key
           FROM UNNEST($3::varchar[]) AS key
           ON CONFLICT DO NOTHING`,
          [tenantId, roleKey, denied]
        );
      }
      await client.query("COMMIT");
      return {
        ok: true as const,
        value: {
          roleKey,
          label: MENU_SCOPE_LABELS[roleKey],
          deniedMenuKeys: denied,
        },
      };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      log.error({ err: e, roleKey }, "role menus update failed");
      return {
        ok: false as const,
        status: 400 as const,
        message: e instanceof Error ? e.message : "Enregistrement des menus impossible.",
      };
    }
  });
}

/**
 * Menus autorisés pour l'utilisateur courant.
 *
 * Deux mécanismes se cumulent :
 *   - `menuKeys` : la liste blanche de son rôle administratif personnalisé
 *     (`allowAll` quand il n'en a pas, cas de tous les comptes existants) ;
 *   - `deniedMenuKeys` : les menus retirés à ses rôles socle depuis l'onglet
 *     « Menus par rôle », qui s'appliquent même en `allowAll`.
 *
 * Le propriétaire n'est jamais restreint : c'est lui qui configure ces règles.
 */
export async function getMyAllowedMenus(
  pool: Pool,
  tenantId: string,
  userId: string,
  roleKeys: string[],
  log: FastifyBaseLogger
): Promise<AdminMyMenusResponse> {
  const normalized = roleKeys.map((role) => String(role).toLowerCase());
  if (normalized.includes("owner") || normalized.includes("super_admin")) {
    return { allowAll: true, menuKeys: [], adminRoleName: null, deniedMenuKeys: [] };
  }

  const scopes = normalized.filter(isMenuScope);

  try {
    return await withTenantClient(pool, tenantId, async (client) => {
      const deniedRes =
        scopes.length === 0
          ? { rows: [] as { menu_key: string }[] }
          : await client.query<{ menu_key: string }>(
              `SELECT DISTINCT menu_key FROM role_menu_denials
               WHERE tenant_id = $1::uuid AND role_key = ANY($2::varchar[])`,
              [tenantId, scopes]
            );
      const deniedMenuKeys = deniedRes.rows.map((row) => row.menu_key).sort();

      const res = await client.query<{ name: string; menu_key: string | null }>(
        `SELECT ar.name, m.menu_key
         FROM user_admin_roles ua
         JOIN admin_roles ar ON ar.id = ua.admin_role_id AND ar.is_active = true
         LEFT JOIN admin_role_menus m ON m.admin_role_id = ar.id
         WHERE ua.user_id = $1::uuid AND ua.tenant_id = $2::uuid`,
        [userId, tenantId]
      );
      if (res.rows.length === 0) {
        return { allowAll: true, menuKeys: [], adminRoleName: null, deniedMenuKeys };
      }
      return {
        allowAll: false,
        menuKeys: res.rows
          .map((row) => row.menu_key)
          .filter((key): key is string => Boolean(key))
          .sort(),
        adminRoleName: res.rows[0].name,
        deniedMenuKeys,
      };
    });
  } catch (e) {
    // Base non migrée : on ne casse pas la navigation des comptes existants.
    log.warn({ err: e }, "admin allowed menus lookup failed, falling back to allowAll");
    return { allowAll: true, menuKeys: [], adminRoleName: null, deniedMenuKeys: [] };
  }
}
