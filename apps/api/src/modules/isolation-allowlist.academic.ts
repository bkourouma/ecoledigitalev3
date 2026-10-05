/**
 * Tables GLOBALES du module `academic` (hors RLS « tenant »), à joindre à la liste blanche du test
 * d'isolation (`assertTenantIsolation({ allowlist })`) avec la justification de chaque entrée (ADR-002 §5).
 *
 * UNE SEULE table globale : `academic.national_holidays` (décision O-10, calendrier national des jours
 * fériés ivoiriens préchargé par la plateforme). Toutes les autres tables du schéma `academic` portent
 * `tenant_id uuid NOT NULL` et la policy `tenant_isolation`. Même les référentiels (niveaux, types de
 * périodes, grammaire du curriculum, types de financement, issues d'année, plans de périodes) sont
 * instanciés PAR TENANT depuis les modèles de pack : aucun n'est partagé entre tenants. Le réglage
 * « activer / désactiver un jour férié national » d'un établissement est, lui, une table de tenant
 * (`academic.institution_national_holiday_settings`).
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly justification: string;
}

export const academicIsolationAllowlist: readonly IsolationAllowlistEntry[] = Object.freeze([
  Object.freeze({
    table: "academic.national_holidays",
    justification:
      "Calendrier national des jours fériés GLOBAL (référence de plateforme, O-10), identique pour tous les tenants, sans donnée de tenant ni donnée personnelle ; " +
      "lisible par tous, écriture réservée à l'acteur `system` par des policies RLS dédiées (même patron que `rbac.permissions`). " +
      "Les dates sont des valeurs de démonstration marquées « à confirmer » ; les jours ajoutés ou désactivés par un établissement vivent dans des tables de tenant.",
  }),
]);

/** Noms qualifiés (`schema.table`), au format attendu par `assertTenantIsolation`. */
export const academicIsolationAllowlistTables: readonly string[] = Object.freeze(academicIsolationAllowlist.map((e) => e.table));

/** Tables du schéma `academic` attendues (le test d'isolation vérifie qu'aucune n'est oubliée). */
export const academicTenantTables: readonly string[] = Object.freeze([
  "academic.education_levels",
  "academic.grade_levels",
  "academic.period_types",
  "academic.period_plans",
  "academic.funding_types",
  "academic.enrollment_outcomes",
  "academic.curriculum_node_types",
  "academic.institution_settings",
  "academic.template_applications",
  "academic.academic_years",
  "academic.academic_periods",
  "academic.programs",
  "academic.program_grade_levels",
  "academic.subjects",
  "academic.curriculum_versions",
  "academic.curriculum_nodes",
  "academic.curriculum_prerequisites",
  "academic.curriculum_amendments",
  "academic.classrooms",
  "academic.classroom_period_states",
  "academic.classroom_offerings",
  "academic.enrollments",
  "academic.enrollment_courses",
  "academic.enrollment_placements",
  "academic.enrollment_history",
  "academic.enrollment_fundings",
  "academic.registration_numbers",
  "academic.rollover_runs",
  "academic.institution_holidays",
  "academic.institution_national_holiday_settings",
]);

export default academicIsolationAllowlist;
