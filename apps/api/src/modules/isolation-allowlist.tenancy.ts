/**
 * Tables GLOBALES du schéma `tenancy` (sans `tenant_id`, hors RLS).
 * Chaque entrée = clé `schema.table` + justification (ADR-002 §5 : une table
 * absente de cette liste doit être une table de tenant avec RLS forcée).
 * `table` répète `key` : même forme que les allowlists des autres modules (rbac, audit).
 */
export interface IsolationAllowlistEntry {
  key: string;
  /** Identique à `key` (compatibilité avec les allowlists `{ table, … }` des autres modules). */
  table: string;
  justification: string;
}

const entry = (key: string, justification: string): IsolationAllowlistEntry =>
  Object.freeze({ key, table: key, justification });

export const TENANCY_ISOLATION_ALLOWLIST: readonly IsolationAllowlistEntry[] = Object.freeze([
  entry(
    "tenancy.country_profiles",
    "Référentiel mondial (pays, devise, locale, fuseau, indicatif, système éducatif) identique pour tous les tenants, " +
      "sans donnée de tenant ni donnée personnelle. Lecture seule pour app_user (aucun droit d'écriture) : " +
      "un pays s'ajoute par migration (ADR-007).",
  ),
]);

/** Format `schema.table` attendu par `assertTenantIsolation({ allowlist })`. */
export const tenancyIsolationAllowlist: readonly string[] = TENANCY_ISOLATION_ALLOWLIST.map((e) => e.key);

/**
 * Valeurs imposées pour que le test d'isolation fabrique une ligne dans chaque table de tenant
 * (colonnes sous CHECK / clé étrangère vers le référentiel global). `tenant_id` est géré par le test.
 */
export const tenancyIsolationFixtures: Record<string, Record<string, unknown>> = {
  "tenancy.tenant_profiles": { country_code: "CI" },
  "tenancy.institutions": { code: (n: number) => `iso-${n}`, pack: "PRIMARY", country_code: "CI" },
  "tenancy.campuses": { code: (n: number) => `iso-${n}` },
  "tenancy.onboarding_steps": { step_key: "ACCOUNT" },
};

export default TENANCY_ISOLATION_ALLOWLIST;
