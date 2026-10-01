/**
 * Tables GLOBALES du module `assess` (hors RLS « tenant »), à joindre à la liste blanche du test d'isolation avec la
 * justification de chaque entrée (ADR-002 §5).
 *
 * AUCUNE : les 8 tables du schéma `assess` portent `tenant_id uuid NOT NULL` et la policy `tenant_isolation` — types
 * d'évaluation et réglages (configuration PAR tenant), évaluations, notes, révisions, verrous de période, reçus de lots
 * idempotents, historique des transitions. Même les types « système » (modèles de pack) sont des lignes du tenant : un
 * établissement modifie les siens sans toucher à ceux des autres.
 *
 * `fixtures` fournit les valeurs imposées par les CHECK de format pour que le test comportemental (A/B) puisse insérer
 * une ligne minimale. Les tables à clé étrangère composite (évaluations, notes, révisions, transitions, reçus) restent
 * contrôlées « en structure » par le générateur ; leur comportement A/B est prouvé par `test/integration/isolation`.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([]);

/** Tables du schéma `assess` attendues (le test d'isolation vérifie qu'aucune n'est oubliée ni ajoutée sans RLS). */
export const assessTenantTables: readonly string[] = Object.freeze([
  "assess.assessment_types",
  "assess.settings",
  "assess.assessments",
  "assess.assessment_transitions",
  "assess.grades",
  "assess.grade_revisions",
  "assess.period_locks",
  "assess.batch_receipts",
]);

export const assessIsolationAllowlistTables: readonly string[] = Object.freeze(entries.map((e) => e.table));

/** Valeurs imposées pour fabriquer une ligne de test dans les tables à CHECK de format (codes, empreintes). */
export const assessIsolationFixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "assess.assessment_types": { code: (n: number) => `ISO_${n}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`, label: "Isolation", aggregation_group: "CONTINUOUS" },
  "assess.period_locks": { locked_sessions: "{1,2}" },
});

export default entries;
