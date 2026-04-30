import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerUserListItem, OwnerUserRolesPatchResponse } from "@ecoledigitale/contracts";

/** Rôles que le propriétaire peut attribuer / retirer (hors `owner`, réservé à l’administration système). */
export const OWNER_ASSIGNABLE_ROLE_KEYS = [
  "admin",
  "teacher",
  "student",
  "parent",
  "formateur",
] as const;

export type OwnerAssignableRoleKey = (typeof OWNER_ASSIGNABLE_ROLE_KEYS)[number];

function isAssignable(key: string): key is OwnerAssignableRoleKey {
  return (OWNER_ASSIGNABLE_ROLE_KEYS as readonly string[]).includes(key);
}

export async function listOwnerTenantUsers(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerUserListItem[]> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const res = await client.query<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      role_keys: string[] | null;
    }>(
      `SELECT u.id, u.email, u.first_name, u.last_name,
              COALESCE(array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL), ARRAY[]::varchar[]) AS role_keys
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = $1::uuid
       GROUP BY u.id, u.email, u.first_name, u.last_name
       ORDER BY u.email`,
      [tenantId]
    );
    return res.rows.map((row) => ({
      userId: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      roleKeys: row.role_keys ?? [],
    }));
  } catch (e) {
    log.warn({ err: e }, "owner list users failed");
    return [];
  } finally {
    client.release();
  }
}

export async function patchUserRolesAsOwner(
  pool: Pool,
  tenantId: string,
  targetUserId: string,
  requestedRoleKeys: string[],
  log: FastifyBaseLogger
): Promise<
  | { ok: true; body: OwnerUserRolesPatchResponse }
  | { ok: false; status: 400 | 404 | 409; message: string }
> {
  for (const k of requestedRoleKeys) {
    if (!isAssignable(k)) {
      return {
        ok: false,
        status: 400,
        message: `Rôle non autorisé pour cette opération : « ${k} ». Rôles gérables : ${OWNER_ASSIGNABLE_ROLE_KEYS.join(", ")}.`,
      };
    }
  }

  const uniqueRequested = [...new Set(requestedRoleKeys)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const ures = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      [targetUserId, tenantId]
    );
    if (ures.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Utilisateur introuvable pour ce tenant." };
    }

    const current = await client.query<{ key: string }>(
      `SELECT r.key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1::uuid
         AND ur.tenant_id = $2::uuid`,
      [targetUserId, tenantId]
    );
    const currentKeys = new Set(current.rows.map((r) => r.key));
    const targetHadAdmin = currentKeys.has("admin");

    if (targetHadAdmin && !uniqueRequested.includes("admin")) {
      const adminUsers = await client.query<{ n: string }>(
        `SELECT COUNT(DISTINCT ur.user_id)::text AS n
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.tenant_id = $1::uuid
           AND r.key = 'admin'`,
        [tenantId]
      );
      const nAdmins = Math.round(Number(adminUsers.rows[0]?.n) || 0);
      if (nAdmins <= 1) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Impossible de retirer le dernier administrateur du tenant.",
        };
      }
    }

    await client.query(
      `DELETE FROM user_roles ur
       USING roles r
       WHERE ur.user_id = $1::uuid
         AND ur.role_id = r.id
         AND ur.tenant_id = $2::uuid
         AND r.key = ANY($3::varchar[])`,
      [targetUserId, tenantId, [...OWNER_ASSIGNABLE_ROLE_KEYS]]
    );

    for (const key of uniqueRequested) {
      const rres = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE key = $1::varchar(50) AND COALESCE(is_active, true) = true`,
        [key]
      );
      const roleId = rres.rows[0]?.id;
      if (!roleId) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: `Le rôle « ${key} » n’existe pas pour ce tenant (exécutez les migrations / seed rôles).`,
        };
      }
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid)
         ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
        [tenantId, targetUserId, roleId]
      );
    }

    const again = await client.query<{ key: string }>(
      `SELECT r.key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1::uuid
         AND ur.tenant_id = $2::uuid
       ORDER BY r.key`,
      [targetUserId, tenantId]
    );
    const roleKeys = again.rows.map((r) => r.key);

    await client.query("COMMIT");

    const profile = await client.query<{
      email: string;
      first_name: string;
      last_name: string;
    }>(`SELECT email, first_name, last_name FROM users WHERE id = $1::uuid`, [targetUserId]);
    const p = profile.rows[0];

    return {
      ok: true,
      body: {
        userId: targetUserId,
        email: p?.email ?? "",
        firstName: p?.first_name ?? "",
        lastName: p?.last_name ?? "",
        roleKeys,
      },
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    log.error({ err: e, targetUserId }, "owner patch user roles failed");
    return {
      ok: false,
      status: 400,
      message: e instanceof Error ? e.message : "Mise à jour des rôles impossible.",
    };
  } finally {
    client.release();
  }
}
