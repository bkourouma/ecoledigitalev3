/**
 * Tables GLOBALES du module `academic` (hors RLS « tenant »), à joindre à la liste blanche du test
 * d'isolation (`assertTenantIsolation({ allowlist })`) avec la justification de chaque entrée (ADR-002 §5).
 *
 * AUCUNE : toutes les tables du schéma `academic` portent `tenant_id uuid NOT NULL` et la policy
 * `tenant_isolation`. Même les référentiels (niveaux, types de périodes, grammaire du curriculum,
 * types de financement, issues d'année, plans de périodes) sont instanciés PAR TENANT depuis les
 * modèles de pack : aucun n'est partagé entre tenants.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly justification: string;
}

export const academicIsolationAllowlist: readonly IsolationAllowlistEntry[] = Object.freeze([]);

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
  "academic.registration_numbers",
]);

export default academicIsolationAllowlist;
