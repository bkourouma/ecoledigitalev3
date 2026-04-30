/**
 * Table name helper for the unified multi-tenant model.
 *
 * The application no longer routes some tenants to *_aspci tables. Every tenant
 * uses the same physical tables and isolation is enforced by tenant_id + RLS.
 */

const BASE_TABLES = {
  formations_professionnelles: "formations_professionnelles",
  sessions_professionnelles: "sessions_professionnelles",
  formateurs: "formateurs",
  session_formateurs: "session_formateurs",
  entreprises_clientes: "entreprises_clientes",
  inscriptions_professionnelles: "inscriptions_professionnelles",
  paiements_professionnels: "paiements_professionnels",
  codes_promo: "codes_promo",
  supports_cours: "supports_cours",
  reservations_temporaires: "reservations_temporaires",
  session_attendance: "session_attendance",
  support_session_associations: "support_session_associations",
  support_telechargements: "support_telechargements",
  formateur_indisponibilites: "formateur_indisponibilites",
  notifications_formateurs: "notifications_formateurs",
  documents: "documents",
  export_jobs: "export_jobs",
} as const;

export type ProfessionalTrainingTable = keyof typeof BASE_TABLES;

export function getTableName(_tenantId: string, baseTableName: ProfessionalTrainingTable): string {
  return BASE_TABLES[baseTableName];
}

export function getTableNames(_tenantId: string): typeof BASE_TABLES {
  return BASE_TABLES;
}

export function usesDedicatedTables(_tenantId: string): boolean {
  return false;
}

export function usesSessionBasedProfessionalTraining(_tenantId: string): boolean {
  return false;
}
