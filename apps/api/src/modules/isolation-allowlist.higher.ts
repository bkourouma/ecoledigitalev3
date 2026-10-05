/**
 * Tables GLOBALES du module `higher` (hors RLS « tenant »), à joindre à la liste blanche du test d'isolation avec la
 * justification de chaque entrée (ADR-002 §5).
 *
 * AUCUNE : les 17 tables du schéma `higher` (dont `numbering_settings` — Q-24 —, `annual_ues`, `annual_ue_members`, `annual_ue_parts` — O-11 — et `ue_exemptions` — O-14) portent `tenant_id uuid NOT NULL` et la policy `tenant_isolation` — réglages,
 * compteurs et motifs de numérotation, définitions et exigences de diplômes, registre de crédits, dettes, prérequis, fenêtres et
 * inscriptions de rattrapage, octrois, documents officiels, emplacements de signature. Même les compteurs de références sont
 * PAR TENANT (`DIP-AAAA-NNNNNN` est continu pour chaque établissement, sans trou).
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([]);

/** Tables du schéma `higher` attendues (le test d'isolation vérifie qu'aucune n'est oubliée ni ajoutée sans RLS). */
export const higherTenantTables: readonly string[] = Object.freeze([
  "higher.settings",
  "higher.diploma_definitions",
  "higher.diploma_requirements",
  "higher.credit_ledger",
  "higher.ue_debts",
  "higher.ue_prerequisites",
  "higher.resit_windows",
  "higher.resit_registrations",
  "higher.number_counters",
  "higher.numbering_settings",
  "higher.diploma_awards",
  "higher.official_documents",
  "higher.official_document_slots",
  "higher.annual_ues",
  "higher.annual_ue_members",
  "higher.annual_ue_parts",
  "higher.ue_exemptions",
]);

export const higherIsolationAllowlistTables: readonly string[] = Object.freeze(entries.map((e) => e.table));

const rnd = (): string => Math.random().toString(36).slice(2, 10).toUpperCase();
const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const uuid = (): string => `${hex(8)}-${hex(4)}-7${hex(3)}-8${hex(3)}-${hex(12)}`;
const now = (): string => new Date().toISOString();

/**
 * Valeurs valides pour fabriquer une ligne de test dans les tables à CHECK de format (codes, références, empreintes).
 * Les tables à clé étrangère COMPOSITE intra-schéma (exigences, inscriptions de rattrapage, octrois, documents) restent
 * contrôlées en structure par le test générique ; leur isolation comportementale est prouvée par le test d'intégration du
 * module (RLS A/B sur chacune des douze tables).
 */
export const higherIsolationFixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "higher.diploma_definitions": { code: () => `ISO-${rnd()}`, label: "Isolation", grade_code: "LICENCE", curriculum_node_id: uuid, uv_required: 180 },
  "higher.credit_ledger": {
    student_id: uuid,
    enrollment_id: uuid,
    ue_node_id: uuid,
    academic_year_id: uuid,
    academic_period_id: uuid,
    credits: 6,
    acquired_via: "DIRECT",
    session_obtained: 1,
    source_result_id: uuid,
    source_results_version: 1,
    acquired_at: now,
  },
  "higher.ue_debts": { student_id: uuid, enrollment_id: uuid, ue_node_id: uuid, academic_year_id: uuid, academic_period_id: uuid, detected_at: now },
  "higher.ue_prerequisites": { ue_node_id: uuid, prerequisite_node_id: uuid },
  "higher.resit_windows": { classroom_id: uuid, academic_period_id: uuid, opens_on: "2026-01-01", closes_on: "2026-01-31", opened_by: uuid, opened_at: now },
  "higher.number_counters": { counter_key: "DIPLOMA", year: 2026 },
  "higher.numbering_settings": { counter_key: "DIPLOMA", pattern: "ISO-{SEQ:4}" },
  "higher.official_document_slots": { slot_key: "DIPLOMA_LEFT", signatory_id: uuid, valid_from: "2026-01-01", created_by: uuid, created_at: now },
});

export default entries;
