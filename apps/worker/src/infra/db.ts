/**
 * Accès PostgreSQL du worker : un pool applicatif + garde-fou sur le rôle de connexion.
 *
 * Le piège historique : un job connecté en super-utilisateur ou en propriétaire des
 * tables contourne la RLS, donc l'isolation entre tenants. Le worker REFUSE de démarrer
 * si son rôle est SUPERUSER, BYPASSRLS, ou n'hérite pas de `app_user`.
 */
import { Pool } from "pg";

export class UnsafeDatabaseRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDatabaseRoleError";
  }
}

export interface PoolSettings {
  url: string;
  max: number;
  applicationName?: string;
}

export function createPool(settings: PoolSettings): Pool {
  const pool = new Pool({
    connectionString: settings.url,
    max: settings.max,
    application_name: settings.applicationName ?? "ecoledigitale-worker",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Une connexion inactive coupée par le serveur émet « error » : sans écouteur le process tomberait.
  pool.on("error", () => undefined);
  return pool;
}

export interface RoleReport {
  role: string;
}

export async function assertSafeRole(pool: Pool): Promise<RoleReport> {
  const res = await pool.query<{
    role: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    app_user_exists: boolean;
  }>(
    `SELECT current_user AS role, r.rolsuper, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') AS app_user_exists
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const me = res.rows[0];
  if (!me) throw new UnsafeDatabaseRoleError("Impossible de déterminer le rôle de connexion.");
  if (me.rolsuper) {
    throw new UnsafeDatabaseRoleError(
      `Le rôle "${me.role}" est SUPERUSER : il contourne la RLS. WORKER_DATABASE_URL doit désigner un rôle de connexion membre de app_user.`,
    );
  }
  if (me.rolbypassrls) {
    throw new UnsafeDatabaseRoleError(
      `Le rôle "${me.role}" a BYPASSRLS : il contourne la RLS. WORKER_DATABASE_URL doit désigner un rôle membre de app_user.`,
    );
  }
  if (!me.app_user_exists) {
    throw new UnsafeDatabaseRoleError("Le rôle app_user n'existe pas : migrations de base (packages/database/migrations) non appliquées.");
  }
  // USAGE = membre ET héritant des privilèges (les droits des tables sont accordés à app_user).
  const member = await pool.query<{ ok: boolean }>(`SELECT pg_has_role(current_user, 'app_user', 'USAGE') AS ok`);
  if (member.rows[0]?.ok !== true) {
    throw new UnsafeDatabaseRoleError(`Le rôle "${me.role}" n'hérite pas de app_user (CREATE ROLE ... LOGIN IN ROLE app_user).`);
  }
  return { role: me.role };
}

/** Tables dont le worker dépend. Un manque = migrations non appliquées : on échoue au démarrage. */
export async function assertRequiredTables(pool: Pool): Promise<void> {
  const res = await pool.query<{ name: string; ok: boolean }>(
    `SELECT t AS name, to_regclass(t) IS NOT NULL AS ok
       FROM unnest(ARRAY['kernel.tenants', 'kernel.domain_events', 'kernel.processed_events']) AS t`,
  );
  const missing = res.rows.filter((r) => !r.ok).map((r) => r.name);
  if (missing.length > 0) {
    throw new Error(
      `Tables absentes : ${missing.join(", ")}. Appliquez packages/database/migrations puis apps/worker/migrations (pnpm --filter @ecoledigitale/worker migrate).`,
    );
  }
}

export async function pingPg(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
