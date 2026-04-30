import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { LoginResponseSchema } from "@ecoledigitale/contracts";
import { generateToken, getExpirationDate } from "./jwt.service";

const ROLE_PRIORITY = ["admin", "owner", "teacher", "parent", "student", "formateur"];

export interface UserAuthContext {
  userId: string;
  email: string;
  passwordHash: string;
  tenantId: string;
  tenantSlug: string;
  tenantIsActive: boolean;
  userIsActive: boolean;
  availableRoles: string[];
  activeRole: string;
}

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function sortRoles(values: string[]): string[] {
  return uniqStrings(values).sort((left, right) => {
    const leftPriority = ROLE_PRIORITY.indexOf(left);
    const rightPriority = ROLE_PRIORITY.indexOf(right);

    if (leftPriority === -1 && rightPriority === -1) {
      return left.localeCompare(right);
    }
    if (leftPriority === -1) return 1;
    if (rightPriority === -1) return -1;
    return leftPriority - rightPriority;
  });
}

function chooseActiveRole(availableRoles: string[], requestedRole?: string | null, storedRole?: string | null): string {
  const roles = sortRoles(availableRoles);
  if (roles.length === 0) {
    throw new Error("User has no active role");
  }

  if (requestedRole && roles.includes(requestedRole)) {
    return requestedRole;
  }

  if (storedRole && roles.includes(storedRole)) {
    return storedRole;
  }

  return roles[0];
}

async function inferAdditionalRoles(client: PoolClient, tenantId: string, userId: string): Promise<string[]> {
  const inferred = new Set<string>();

  const checks = [
    {
      role: "teacher",
      sql: "SELECT 1 FROM teachers WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
      params: [userId, tenantId],
    },
    {
      role: "student",
      sql: "SELECT 1 FROM student_profiles WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
      params: [userId, tenantId],
    },
    {
      role: "parent",
      sql: "SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND EXISTS (SELECT 1 FROM student_parents sp WHERE sp.parent_id = $1 AND sp.tenant_id = $2) LIMIT 1",
      params: [userId, tenantId],
    },
  ];

  for (const check of checks) {
    try {
      const result = await client.query(check.sql, check.params);
      if ((result.rowCount || 0) > 0) {
        inferred.add(check.role);
      }
    } catch {
      // Keep authentication resilient if a domain table is absent in a partial environment.
    }
  }

  try {
    const result = await client.query(
      "SELECT 1 FROM formateurs WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
      [userId, tenantId]
    );
    if ((result.rowCount || 0) > 0) {
      inferred.add("formateur");
    }
  } catch {
    // The simplified catalogue can legitimately run without formateurs.
  }

  return Array.from(inferred);
}

export async function loadUserAuthContextById(
  client: PoolClient,
  userId: string,
  requestedRole?: string | null
): Promise<UserAuthContext | null> {
  const userResult = await client.query<{
    id: string;
    email: string;
    password_hash: string;
    tenant_id: string;
    tenant_slug: string;
    user_is_active: boolean;
    tenant_is_active: boolean;
    active_role_key: string | null;
  }>(
    `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.tenant_id,
        t.slug AS tenant_slug,
        COALESCE(u.is_active, true) AS user_is_active,
        COALESCE(t.is_active, true) AS tenant_is_active,
        u.active_role_key
      FROM users u
      INNER JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const user = userResult.rows[0];

  const rolesResult = await client.query<{ role_key: string }>(
    `
      SELECT DISTINCT r.key AS role_key
      FROM user_roles ur
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
        AND ur.tenant_id = $2
        AND COALESCE(r.is_active, true) = true
    `,
    [user.id, user.tenant_id]
  );

  const inferredRoles = await inferAdditionalRoles(client, user.tenant_id, user.id);
  const activeRolesResult = await client.query<{ role_key: string }>(
    "SELECT key AS role_key FROM roles WHERE COALESCE(is_active, true) = true"
  );
  const activeRoleKeys = new Set(activeRolesResult.rows.map((row) => row.role_key));
  const availableRoles = sortRoles([
    ...rolesResult.rows.map((row) => row.role_key),
    ...inferredRoles,
  ].filter((roleKey) => activeRoleKeys.has(roleKey)));

  return {
    userId: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    tenantId: user.tenant_id,
    tenantSlug: user.tenant_slug,
    tenantIsActive: user.tenant_is_active,
    userIsActive: user.user_is_active,
    availableRoles,
    activeRole: chooseActiveRole(availableRoles, requestedRole, user.active_role_key),
  };
}

export async function loadUserAuthContextByEmail(
  client: PoolClient,
  email: string,
  requestedRole?: string | null
): Promise<UserAuthContext | null> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [email]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return loadUserAuthContextById(client, result.rows[0].id, requestedRole);
}

export async function verifyUserPassword(context: UserAuthContext, password: string): Promise<boolean> {
  if (!context.passwordHash) {
    return false;
  }
  return bcrypt.compare(password, context.passwordHash);
}

export async function persistActiveRolePreference(
  client: PoolClient,
  userId: string,
  activeRole: string
): Promise<void> {
  try {
    await client.query("UPDATE users SET active_role_key = $2, updated_at = NOW() WHERE id = $1", [
      userId,
      activeRole,
    ]);
  } catch {
    // Compatible with databases where the migration has not yet been applied.
  }
}

export function buildUserLoginResponse(context: UserAuthContext) {
  const token = generateToken({
    iss: "ecoledigitale",
    aud: context.tenantSlug,
    sub: context.userId,
    userId: context.userId,
    scope: "tenant_user",
    tenantId: context.tenantId,
    tenantSlug: context.tenantSlug,
    roles: context.availableRoles,
    activeRole: context.activeRole,
  });

  return LoginResponseSchema.parse({
    user: {
      id: context.userId,
      email: context.email,
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
      activeRole: context.activeRole,
      roles: [context.activeRole],
      availableRoles: context.availableRoles,
      requiresRoleSelection: context.availableRoles.length > 1,
    },
    token,
    expiresAt: getExpirationDate(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
  });
}
