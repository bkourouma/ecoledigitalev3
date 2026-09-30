import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";

export const DEFAULT_REFERENCE_TENANT_SLUG = "ecoledigitale";
export const DEFAULT_REFERENCE_TENANT_NAME = "ecoledigitale";
export const DEFAULT_TECHNICAL_PASSWORD = "Password@2025";
const REFERENCE_TABLES = ["cycles", "filieres", "programmes", "courses", "time_slots"] as const;

type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
};

type RoleSummary = {
  id: string;
  key: string;
  name: string;
  is_active: boolean;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function isRowActive(row: Record<string, unknown>): boolean {
  if ("is_active" in row && row.is_active !== null) {
    return Boolean(row.is_active);
  }
  if ("active" in row && row.active !== null) {
    return Boolean(row.active);
  }
  if ("actif" in row && row.actif !== null) {
    return Boolean(row.actif);
  }
  if ("status" in row && typeof row.status === "string") {
    return ["active", "published", "enabled"].includes(row.status.toLowerCase());
  }
  if ("statut" in row && typeof row.statut === "string") {
    return ["active", "activee", "publiée", "publiee", "published"].includes(row.statut.toLowerCase());
  }
  return true;
}

function buildInsertStatement(
  tableName: string,
  row: Record<string, unknown>
): { sql: string; values: unknown[] } {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) => quoteIdentifier(key));
  const placeholders = entries.map((_, index) => `$${index + 1}`);
  const values = entries.map(([, value]) => value);

  return {
    sql: `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    values,
  };
}

async function getTableColumns(client: PoolClient, tableName: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName]
  );

  return result.rows.map((row) => row.column_name);
}

/**
 * Colonnes de `tableName` qui pointent vers un compte utilisateur (`approved_by`,
 * `created_by`…), avec leur nullabilité.
 *
 * Un compte appartient à UN établissement. Recopier tel quel l'identifiant d'un
 * utilisateur de l'établissement de référence dans une ligne du nouvel
 * établissement crée un lien entre deux établissements.
 */
async function getUserReferenceColumns(
  client: PoolClient,
  tableName: string
): Promise<Array<{ column: string; nullable: boolean }>> {
  const result = await client.query<{ column_name: string; nullable: boolean }>(
    `
      SELECT a.attname AS column_name, NOT a.attnotnull AS nullable
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = to_regclass($1)
        AND c.confrelid = to_regclass('users')
    `,
    [`public.${tableName}`]
  );
  return result.rows.map((row) => ({ column: row.column_name, nullable: row.nullable }));
}

async function getExistingIdForClone(
  client: PoolClient,
  tableName: typeof REFERENCE_TABLES[number],
  targetTenantId: string,
  row: Record<string, unknown>
): Promise<string | null> {
  if (tableName === "cycles" && row.code) {
    const result = await client.query("SELECT id FROM cycles WHERE tenant_id = $1 AND code = $2 LIMIT 1", [
      targetTenantId,
      row.code,
    ]);
    return result.rows[0]?.id ?? null;
  }

  if (tableName === "filieres" && row.name) {
    const result = await client.query("SELECT id FROM filieres WHERE tenant_id = $1 AND name = $2 LIMIT 1", [
      targetTenantId,
      row.name,
    ]);
    return result.rows[0]?.id ?? null;
  }

  if (tableName === "programmes" && row.code) {
    const result = await client.query(
      "SELECT id FROM programmes WHERE tenant_id = $1 AND code = $2 AND COALESCE(version, '1.0') = COALESCE($3, '1.0') LIMIT 1",
      [targetTenantId, row.code, row.version ?? null]
    );
    return result.rows[0]?.id ?? null;
  }

  if (tableName === "courses" && row.code && row.programme_id) {
    const result = await client.query(
      "SELECT id FROM courses WHERE tenant_id = $1 AND programme_id = $2 AND code = $3 LIMIT 1",
      [targetTenantId, row.programme_id, row.code]
    );
    return result.rows[0]?.id ?? null;
  }

  if (tableName === "time_slots" && row.day_of_week && row.start_time && row.end_time) {
    const result = await client.query(
      `
        SELECT id
        FROM time_slots
        WHERE tenant_id = $1
          AND day_of_week = $2
          AND start_time = $3
          AND end_time = $4
        LIMIT 1
      `,
      [targetTenantId, row.day_of_week, row.start_time, row.end_time]
    );
    return result.rows[0]?.id ?? null;
  }

  return null;
}

export function getTechnicalAccountEmail(roleKey: string, tenantSlug: string): string {
  return `${roleKey}@${tenantSlug}.local`;
}

export async function ensureReferenceTenant(client: PoolClient): Promise<TenantSummary> {
  const result = await client.query<TenantSummary>(
    `
      INSERT INTO tenants (slug, name, is_active, is_reference, settings_json, created_at, updated_at)
      VALUES ($1, $2, true, true, '{}'::jsonb, NOW(), NOW())
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        is_active = true,
        is_reference = true,
        updated_at = NOW()
      RETURNING id, slug, name, COALESCE(is_active, true) AS is_active
    `,
    [DEFAULT_REFERENCE_TENANT_SLUG, DEFAULT_REFERENCE_TENANT_NAME]
  );

  return result.rows[0];
}

export async function listGlobalRoles(client: PoolClient): Promise<RoleSummary[]> {
  const result = await client.query<RoleSummary>(
    `
      SELECT id, key, name, COALESCE(is_active, true) AS is_active
      FROM roles
      ORDER BY key ASC
    `
  );

  return result.rows;
}

export async function ensureTechnicalAccountsForTenant(
  client: PoolClient,
  tenantId: string,
  tenantSlug: string
): Promise<void> {
  const roles = await listGlobalRoles(client);
  const passwordHash = await bcrypt.hash(DEFAULT_TECHNICAL_PASSWORD, 10);

  for (const role of roles) {
    const existingUserResult = await client.query<{ id: string; email: string }>(
      `
        SELECT u.id, u.email
        FROM users u
        INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1
          AND ur.role_id = $2
          AND COALESCE(u.is_technical_account, false) = true
        LIMIT 1
      `,
      [tenantId, role.id]
    );

    let userId = existingUserResult.rows[0]?.id;

    if (!userId) {
      const email = getTechnicalAccountEmail(role.key, tenantSlug);
      const insertedUser = await client.query<{ id: string }>(
        `
          INSERT INTO users (
            tenant_id,
            email,
            name,
            first_name,
            last_name,
            password_hash,
            initial_password,
            is_active,
            is_technical_account,
            active_role_key,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, NOW(), NOW())
          ON CONFLICT (email)
          DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            name = EXCLUDED.name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            is_technical_account = true,
            is_active = EXCLUDED.is_active,
            active_role_key = EXCLUDED.active_role_key,
            updated_at = NOW()
          RETURNING id
        `,
        [
          tenantId,
          email,
          `${role.name} Technique`,
          role.name,
          "Technique",
          passwordHash,
          DEFAULT_TECHNICAL_PASSWORD,
          role.is_active,
          role.key,
        ]
      );

      userId = insertedUser.rows[0].id;
    } else {
      await client.query(
        `
          UPDATE users
          SET is_active = $2,
              is_technical_account = true,
              active_role_key = COALESCE(active_role_key, $3),
              updated_at = NOW()
          WHERE id = $1
        `,
        [userId, role.is_active, role.key]
      );
    }

    await client.query(
      `
        INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
      `,
      [tenantId, userId, role.id]
    );
  }
}

export async function resolveTenantTechnicalUser(
  client: PoolClient,
  tenantId: string,
  roleKey: string
): Promise<{ userId: string; email: string } | null> {
  const result = await client.query<{ id: string; email: string }>(
    `
      SELECT u.id, u.email
      FROM users u
      INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND r.key = $2
        AND COALESCE(u.is_technical_account, false) = true
      LIMIT 1
    `,
    [tenantId, roleKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    userId: result.rows[0].id,
    email: result.rows[0].email,
  };
}

async function cloneReferenceTable(
  client: PoolClient,
  tableName: typeof REFERENCE_TABLES[number],
  sourceTenantId: string,
  targetTenantId: string,
  idMapping: Map<string, string>,
  filiereMapping: Map<string, string> = new Map()
): Promise<Map<string, string>> {
  const columns = await getTableColumns(client, tableName);
  const userColumns = await getUserReferenceColumns(client, tableName);
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${tableName} WHERE tenant_id = $1`,
    [sourceTenantId]
  );

  const localMapping = new Map<string, string>();

  for (const row of result.rows) {
    if (!isRowActive(row)) {
      continue;
    }

    const lookupRow = { ...row };
    if (tableName === "courses" && row.programme_id) {
      lookupRow.programme_id = idMapping.get(String(row.programme_id));
    }

    const existingId = await getExistingIdForClone(client, tableName, targetTenantId, lookupRow);
    if (existingId) {
      localMapping.set(String(row.id), existingId);
      continue;
    }

    const newRow: Record<string, unknown> = {};

    for (const column of columns) {
      if (column === "id") continue;
      if (column === "tenant_id") {
        newRow[column] = targetTenantId;
        continue;
      }
      if ((column === "created_at" || column === "updated_at") && !row[column]) {
        continue;
      }
      newRow[column] = row[column];
    }

    // Les comptes ne se copient pas : ils appartiennent à l'établissement de référence.
    for (const { column, nullable } of userColumns) {
      if (nullable && column in newRow) newRow[column] = null;
    }

    if (tableName === "programmes" && row.cycle_id) {
      newRow.cycle_id = idMapping.get(String(row.cycle_id));
      if (!newRow.cycle_id) continue;
    }

    if (tableName === "programmes" && columns.includes("filiere_id")) {
      // Jamais l'identifiant d'une filière d'un autre établissement : la copie
      // correspondante, ou rien.
      newRow.filiere_id = row.filiere_id ? filiereMapping.get(String(row.filiere_id)) ?? null : null;
    }

    if (tableName === "courses" && row.programme_id) {
      newRow.programme_id = idMapping.get(String(row.programme_id));
      if (!newRow.programme_id) continue;
    }

    const insert = buildInsertStatement(tableName, newRow);
    const inserted = await client.query<{ id: string }>(insert.sql, insert.values);
    localMapping.set(String(row.id), inserted.rows[0].id);
  }

  return localMapping;
}

export async function cloneReferenceDataFromReferenceTenant(
  client: PoolClient,
  targetTenantId: string
): Promise<void> {
  const referenceTenant = await client.query<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = $1 LIMIT 1",
    [DEFAULT_REFERENCE_TENANT_SLUG]
  );

  if (referenceTenant.rows.length === 0) {
    return;
  }

  const sourceTenantId = referenceTenant.rows[0].id;
  if (sourceTenantId === targetTenantId) {
    return;
  }

  const cycleMap = await cloneReferenceTable(client, "cycles", sourceTenantId, targetTenantId, new Map());
  // Les classes appartiennent à une filière : sans copier les filières, chaque
  // classe copiée garderait un lien vers celle de l'établissement de référence.
  const filiereMap = await cloneReferenceTable(client, "filieres", sourceTenantId, targetTenantId, new Map());
  const programmeMap = await cloneReferenceTable(
    client,
    "programmes",
    sourceTenantId,
    targetTenantId,
    cycleMap,
    filiereMap
  );
  await cloneReferenceTable(client, "courses", sourceTenantId, targetTenantId, programmeMap);
  await cloneReferenceTable(client, "time_slots", sourceTenantId, targetTenantId, new Map());
}

export async function listTenants(client: PoolClient): Promise<TenantSummary[]> {
  const result = await client.query<TenantSummary>(
    `
      SELECT id, slug, name, COALESCE(is_active, true) AS is_active
      FROM tenants
      ORDER BY created_at ASC
    `
  );

  return result.rows;
}

export async function createTenant(
  client: PoolClient,
  input: { name: string; slug: string; createdBySuperAdminId?: string | null }
): Promise<TenantSummary> {
  const tenantResult = await client.query<TenantSummary>(
    `
      INSERT INTO tenants (slug, name, is_active, is_reference, created_by_super_admin_id, settings_json, created_at, updated_at)
      VALUES ($1, $2, true, false, $3, '{}'::jsonb, NOW(), NOW())
      RETURNING id, slug, name, COALESCE(is_active, true) AS is_active
    `,
    [input.slug, input.name, input.createdBySuperAdminId ?? null]
  );

  const tenant = tenantResult.rows[0];
  await ensureTechnicalAccountsForTenant(client, tenant.id, tenant.slug);
  await cloneReferenceDataFromReferenceTenant(client, tenant.id);

  return tenant;
}

export async function syncTechnicalAccountsForAllTenants(client: PoolClient): Promise<void> {
  const tenants = await listTenants(client);
  for (const tenant of tenants) {
    await ensureTechnicalAccountsForTenant(client, tenant.id, tenant.slug);
  }
}

export async function setTenantActiveState(
  client: PoolClient,
  tenantId: string,
  isActive: boolean
): Promise<void> {
  await client.query("UPDATE tenants SET is_active = $2, updated_at = NOW() WHERE id = $1", [tenantId, isActive]);

  if (!isActive) {
    await client.query("UPDATE users SET is_active = false, updated_at = NOW() WHERE tenant_id = $1", [tenantId]);
  }
}
