/**
 * Tables GLOBALES du module `people` (hors RLS « tenant »), à joindre à la liste blanche du test d'isolation
 * (`assertTenantIsolation({ allowlist })`) avec la justification de chaque entrée (ADR-002 §5).
 *
 * AUCUNE : toutes les tables du schéma `people` portent `tenant_id uuid NOT NULL` et la policy `tenant_isolation`
 * (relationship_types, staff_categories, contract_types, settings, number_sequences, persons, students,
 * student_status_history, student_prior_education, guardians, student_guardians, student_emergency_contacts,
 * student_enrollment_summaries, staff, staff_affiliations, staff_contracts, staff_qualifications, staff_competencies,
 * staff_availabilities, staff_status_history, teaching_assignments, teaching_assignment_history, identity_memberships).
 * Même les compteurs de numérotation et la projection des accès IAM sont par tenant.
 *
 * Le fichier exporte aussi les fixtures du test d'isolation générique pour les tables dont les CHECK / clés étrangères
 * composites empêchent le générateur de fabriquer une ligne valide (sans elles la table serait seulement vérifiée en
 * structure) : les clés étrangères internes sont résolues automatiquement, seules les valeurs sous CHECK sont imposées.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly justification: string;
}

export const peopleIsolationAllowlist: readonly IsolationAllowlistEntry[] = Object.freeze([]);

/** Noms qualifiés (`schema.table`), au format attendu par `assertTenantIsolation`. */
export const peopleIsolationAllowlistTables: readonly string[] = Object.freeze(peopleIsolationAllowlist.map((e) => e.table));

/** Tables du schéma `people` attendues (le test d'isolation vérifie qu'aucune n'est oubliée). */
export const peopleTenantTables: readonly string[] = Object.freeze([
  "people.relationship_types",
  "people.staff_categories",
  "people.contract_types",
  "people.settings",
  "people.number_sequences",
  "people.persons",
  "people.students",
  "people.student_status_history",
  "people.student_prior_education",
  "people.guardians",
  "people.student_guardians",
  "people.student_emergency_contacts",
  "people.student_enrollment_summaries",
  "people.staff",
  "people.staff_affiliations",
  "people.staff_contracts",
  "people.staff_qualifications",
  "people.staff_competencies",
  "people.staff_availabilities",
  "people.staff_status_history",
  "people.teaching_assignments",
  "people.teaching_assignment_history",
  "people.identity_memberships",
  "people.student_documents",
]);

/**
 * Valeurs imposées au test d'isolation GÉNÉRIQUE pour les tables dont un CHECK empêche le générateur de fabriquer une ligne
 * (sans elles la table n'est vérifiée qu'en structure). Les tables à clé étrangère composite interne ne sont pas
 * fabricables par le générateur : leur isolation COMPORTEMENTALE est prouvée avec de vraies données par
 * `test/integration/isolation.integration.test.ts` du module.
 */
export const fixtures: Record<string, Record<string, unknown>> = {
  "people.relationship_types": { code: "ISO_TEST", label: "Test", kind: "OTHER" },
  "people.staff_categories": { code: "ISO_TEST", label: "Test" },
  "people.contract_types": { code: "ISO_TEST", label: "Test", kind: "OTHER" },
  "people.number_sequences": { kind: "STUDENT" },
  "people.identity_memberships": { status: "active" },
};

export default peopleIsolationAllowlist;
