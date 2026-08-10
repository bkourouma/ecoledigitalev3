/**
 * Technical accounts helper (web side).
 *
 * Mirrors the server provisioning logic so the login page can display the
 * technical accounts that exist for a given tenant without an extra endpoint.
 *
 * Keep in sync with `apps/api/src/services/tenant-provisioning.service.ts`:
 *   - getTechnicalAccountEmail(roleKey, slug) => `${roleKey}@${slug}.local`
 *   - DEFAULT_TECHNICAL_PASSWORD             => "Password@2025"
 *   - global roles seeded in migration 0055_unified_multitenancy.sql
 */

export const DEFAULT_TECHNICAL_PASSWORD = "Password@2025";

/** localStorage key written by the super-admin "Selectionner" button. */
export const SELECTED_TENANT_STORAGE_KEY = "superAdminSelectedTenant";

/**
 * localStorage key holding the list of known tenants, cached by the super-admin
 * tenants page so the login page can populate its tenant selector without a
 * dedicated endpoint.
 */
export const KNOWN_TENANTS_STORAGE_KEY = "knownTenants";

/** Global/system roles that get a technical account on every tenant. */
export const SYSTEM_ROLES: { key: string; label: string }[] = [
  { key: "admin", label: "Administrateur" },
  { key: "owner", label: "Propriétaire" },
  { key: "teacher", label: "Enseignant" },
  { key: "student", label: "Étudiant" },
  { key: "parent", label: "Parent" },
];

export type TechnicalAccount = {
  email: string;
  password: string;
  role: string;
  name: string;
};

export function technicalAccountEmail(roleKey: string, tenantSlug: string): string {
  return `${roleKey}@${tenantSlug}.local`;
}

/**
 * Surcharges de comptes réels par tenant + rôle : affichés (et utilisés au clic)
 * à la place du compte technique générique sur la page de connexion.
 */
const ACCOUNT_OVERRIDES: Record<string, Record<string, { email: string; password: string }>> = {
  ecoledigitale: {
    teacher: { email: "jean.koffi@imhotepacademy.ci", password: "h?ya@q4wEhn9" },
    student: { email: "noella.kouadio.gerna28@example.com", password: "Passw0rd!stu" },
    parent: { email: "konan.kouadio.parent28@example.com", password: "xp#UgydODQq*" },
  },
};

/**
 * Build the list of technical accounts that the server provisions for a tenant.
 * Pass the list of roles when known (e.g. fetched from the API); otherwise the
 * system roles seeded for every tenant are used.
 */
export function buildTechnicalAccounts(
  tenantSlug: string,
  roles: { key: string; label?: string }[] = SYSTEM_ROLES
): TechnicalAccount[] {
  const overrides = ACCOUNT_OVERRIDES[tenantSlug] ?? {};
  return roles.map((role) => {
    const ov = overrides[role.key];
    const email = ov?.email ?? technicalAccountEmail(role.key, tenantSlug);
    const password = ov?.password ?? DEFAULT_TECHNICAL_PASSWORD;
    return { email, password, role: role.key, name: email };
  });
}
