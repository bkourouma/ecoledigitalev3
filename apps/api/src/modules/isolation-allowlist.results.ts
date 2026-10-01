/**
 * Tables GLOBALES du module `results` (hors RLS « tenant »), à joindre à la liste blanche du test d'isolation avec la
 * justification de chaque entrée (ADR-002 §5).
 *
 * AUCUNE : les 10 tables du schéma `results` portent `tenant_id uuid NOT NULL` et la policy `tenant_isolation` — réglages,
 * états de période, clôtures, résultats (en-têtes versionnés et lignes), surcharges, délibérations, décisions,
 * appréciations, file de recalcul. Aucun référentiel partagé : les règles de calcul vivent dans le module `rules`.
 *
 * `fixtures` fournit les valeurs imposées par les CHECK de format pour le test comportemental (A/B). Les tables à clé
 * étrangère composite (toutes sauf `settings` et `period_states`) sont contrôlées « en structure » par le générateur ; leur
 * comportement A/B est prouvé par `test/integration/isolation`.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([]);

/** Tables du schéma `results` attendues (le test d'isolation vérifie qu'aucune n'est oubliée ni ajoutée sans RLS). */
export const resultsTenantTables: readonly string[] = Object.freeze([
  "results.settings",
  "results.period_states",
  "results.closures",
  "results.period_results",
  "results.line_results",
  "results.overrides",
  "results.deliberations",
  "results.decisions",
  "results.appreciations",
  "results.recompute_requests",
]);

export const resultsIsolationAllowlistTables: readonly string[] = Object.freeze(entries.map((e) => e.table));

/** Valeurs imposées pour fabriquer une ligne de test dans les tables à CHECK de format. */
export const resultsIsolationFixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "results.period_states": { academic_period_id: () => "00000000-0000-7000-8000-0000000000aa", scope: "PERIOD", contract_id: "credit-semester@1", rule_version_kind: "TENANT", rule_set_code: "ISO", rule_version_no: 1, definition_hash: "0".repeat(64) },
  "results.recompute_requests": { not_before: () => new Date().toISOString() },
});

export default entries;
