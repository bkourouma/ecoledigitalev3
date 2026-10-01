/**
 * Tables GLOBALES du module `rules` (hors RLS « tenant »), à joindre à la liste blanche du test d'isolation
 * (`assertTenantIsolation({ allowlist })`) avec la justification de chaque entrée (ADR-002 §5).
 *
 * Catalogue NATIONAL : identique pour tous les tenants, sans donnée de tenant ni donnée personnelle (règles de calcul,
 * seuils, libellés ; l'historique ne porte que l'identité figée d'un opérateur de la plateforme). Lecture ouverte
 * (policy `SELECT USING (true)`), écriture RÉSERVÉE à l'acteur `system` par des policies RLS dédiées (même patron que
 * `rbac.permissions`) : un tenant ne peut ni insérer ni modifier ces tables (vérifié par test d'intégration). Jamais de
 * DELETE sur les jeux et les versions (triggers de garde).
 *
 * Toutes les autres tables du schéma `rules` (rule_sets, rule_versions, rule_definitions, version_events, rule_bindings,
 * simulations, simulation_differences, evaluation_failures) portent `tenant_id` et la policy `tenant_isolation` : elles NE
 * doivent PAS figurer ici. `fixtures` fournit les valeurs imposées par les CHECK de format pour que le test comportemental
 * (A/B) puisse insérer une ligne minimale.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly justification: string;
}

const NATIONAL =
  "Catalogue réglementaire GLOBAL identique pour tous les tenants, sans donnée de tenant ni donnée personnelle ; " +
  "lisible par tous, écriture réservée à l'acteur `system` (SystemDb : console du super-administrateur) par des policies RLS dédiées.";

export const rulesIsolationAllowlist: readonly IsolationAllowlistEntry[] = Object.freeze([
  Object.freeze({ table: "rules.platform_settings", justification: `Réglages de plateforme (seuil de confirmation d'impact, séparation des tâches, part de rejeu) : ${NATIONAL}` }),
  Object.freeze({ table: "rules.national_rule_sets", justification: `Jeux de règles nationaux (ex. CI-HIGHER-LMD) : ${NATIONAL}` }),
  Object.freeze({ table: "rules.national_rule_versions", justification: `Versions des jeux nationaux (machine d'états, immuables hors brouillon) : ${NATIONAL}` }),
  Object.freeze({ table: "rules.national_rule_definitions", justification: `Règles (expressions, paramètres bornés, libellés) des versions nationales : ${NATIONAL}` }),
  Object.freeze({ table: "rules.national_version_events", justification: `Historique append-only de gouvernance du catalogue national : ${NATIONAL}` }),
]);

/** Noms qualifiés (`schema.table`), au format attendu par `assertTenantIsolation`. */
export const rulesIsolationAllowlistTables: readonly string[] = Object.freeze(rulesIsolationAllowlist.map((e) => e.table));

/** Tables de tenant attendues du schéma `rules` (le test d'isolation vérifie qu'aucune n'est oubliée). */
export const rulesTenantTables: readonly string[] = Object.freeze([
  "rules.rule_sets",
  "rules.rule_versions",
  "rules.rule_definitions",
  "rules.version_events",
  "rules.rule_bindings",
  "rules.simulations",
  "rules.simulation_differences",
  "rules.evaluation_failures",
]);

/**
 * Valeurs imposées pour fabriquer une ligne de test dans les tables à CHECK de format (sans elles la table serait seulement
 * contrôlée en structure). Les tables à clé étrangère composite (versions, règles, historique, différences) restent
 * « structure seule » : le générateur ne sait pas fabriquer leur parent.
 */
export const rulesIsolationFixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "rules.rule_sets": Object.freeze({
    code: (n: number) => `ISO-SET-${n}`,
    country_code: "CI",
  }),
  "rules.rule_bindings": Object.freeze({
    contract_id: "credit-semester@1",
    rule_set_code: "ISO-SET",
    effective_from: "2026-01-01",
  }),
  "rules.simulations": Object.freeze({
    target_version_kind: "TENANT",
    base_version_kind: "TENANT",
    target_definition_hash: "0".repeat(64),
    contract_id: "credit-semester@1",
  }),
  "rules.evaluation_failures": Object.freeze({
    rule_version_kind: "TENANT",
  }),
});

export default rulesIsolationAllowlist;
