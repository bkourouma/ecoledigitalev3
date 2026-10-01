/**
 * Tables GLOBALES du schéma `tenancy` (sans `tenant_id`, hors RLS).
 * Chaque entrée = clé `schema.table` + justification (ADR-002 §5 : une table
 * absente de cette liste doit être une table de tenant avec RLS forcée).
 */
export interface IsolationAllowlistEntry {
  key: string;
  justification: string;
}

export const TENANCY_ISOLATION_ALLOWLIST: readonly IsolationAllowlistEntry[] = [
  {
    key: "tenancy.country_profiles",
    justification:
      "Référentiel mondial (pays, devise, locale, fuseau, indicatif, système éducatif) identique pour tous les tenants, " +
      "sans donnée de tenant ni donnée personnelle. Lecture seule pour app_user (aucun droit d'écriture) : " +
      "un pays s'ajoute par migration (ADR-007).",
  },
];

export default TENANCY_ISOLATION_ALLOWLIST;
