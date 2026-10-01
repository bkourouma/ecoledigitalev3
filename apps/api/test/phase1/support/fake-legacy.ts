/**
 * Base LEGACY simulée pour le test de sortie de phase 1.
 *
 * Le test fait tourner les VRAIS plugins legacy (`tenant-context`, `auth-middleware`) et le VRAI JWT legacy ;
 * seule la base legacy (`public.*`) est remplacée par ce pool factice qui répond aux quelques requêtes SQL
 * que ces plugins émettent. Il sert aussi de `legacyPool` à la plateforme v2 (synchronisation des tenants,
 * liste noire des jetons super-admin, comptes opérateur).
 */

export interface LegacyTenantFixture {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
}

export interface LegacyUserFixture {
  id: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  roles: string[];
  isActive?: boolean;
}

export class FakeLegacyDb {
  readonly tenants: LegacyTenantFixture[] = [];
  readonly users: LegacyUserFixture[] = [];
  readonly superAdmins = new Map<string, { active: boolean }>();
  readonly blacklisted = new Set<string>();
  /** Journal des requêtes (aucun secret n'y transite). */
  readonly queries: string[] = [];

  private respond(sql: string, params: unknown[] = []): { rows: any[]; rowCount: number } {
    const text = sql.replace(/\s+/g, " ").trim();
    this.queries.push(text.slice(0, 120));
    const rows = (rs: any[]) => ({ rows: rs, rowCount: rs.length });

    if (/FROM public\.tenants WHERE id = \$1/.test(text)) return rows(this.tenants.filter((t) => t.id === params[0]));
    if (/FROM public\.tenants ORDER BY/.test(text)) return rows([...this.tenants]);
    if (/FROM users u INNER JOIN tenants t/.test(text)) {
      const u = this.users.find((x) => x.id === params[0]);
      if (!u) return rows([]);
      return rows([
        {
          id: u.id,
          email: u.email,
          password_hash: "x",
          tenant_id: u.tenantId,
          tenant_slug: u.tenantSlug,
          user_is_active: u.isActive ?? true,
          tenant_is_active: this.tenants.find((t) => t.id === u.tenantId)?.is_active ?? true,
          active_role_key: null,
        },
      ]);
    }
    if (/FROM user_roles ur/.test(text)) {
      const u = this.users.find((x) => x.id === params[0]);
      return rows((u?.roles ?? []).map((role_key) => ({ role_key })));
    }
    if (/SELECT key AS role_key FROM roles/.test(text)) {
      return rows(["admin", "owner", "teacher", "parent", "student"].map((role_key) => ({ role_key })));
    }
    if (/SELECT role_updated_at FROM users/.test(text)) return rows([{ role_updated_at: null }]);
    if (/FROM token_blacklist/.test(text)) return rows([{ is_blacklisted: this.blacklisted.has(String(params[1])) }]);
    if (/FROM super_admin_users WHERE id = \$1/.test(text)) {
      const sa = this.superAdmins.get(String(params[0]));
      return rows(sa ? [{ is_active: sa.active }] : []);
    }
    // inferAdditionalRoles (teachers, student_profiles, formateurs…), UPDATE users…
    return rows([]);
  }

  pool = {
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => this.respond(sql, params),
      release: () => undefined,
    }),
    query: async (sql: string, params?: unknown[]) => this.respond(sql, params),
  };
}
