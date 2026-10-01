/**
 * Liste blanche CENTRALE du test d'isolation (`pnpm test:isolation`, bloquant en CI).
 *
 * Une table figure ici UNIQUEMENT si elle n'est volontairement pas une table de tenant
 * (pas de `tenant_id`, pas de RLS). Chaque entrée DOIT porter une justification textuelle.
 *
 * ── Ajouter une table globale d'un module ───────────────────────────────────────────
 * N'ÉDITEZ PAS ce fichier (source de conflits de fusion). Créez à côté
 *
 *     apps/api/src/modules/isolation-allowlist.<module>.ts
 *
 * qui exporte par défaut un tableau d'entrées, découvert automatiquement :
 *
 *     import type { AllowlistEntry } from "./isolation-allowlist";
 *     const entries: AllowlistEntry[] = [
 *       { table: "finance.currencies", reason: "Référentiel ISO 4217 identique pour tous les tenants, sans donnée de tenant." },
 *     ];
 *     export default entries;
 *
 * Règles (vérifiées par le chargeur) : le schéma de la table est celui du module (`<module>`) ;
 * la justification fait au moins 20 caractères ; une table n'apparaît qu'une fois ; une entrée
 * qui ne correspond à aucune table est une erreur (liste périmée).
 *
 * Un fichier peut aussi exporter `fixtures` (valeurs imposées pour fabriquer une ligne de test
 * dans les tables à CHECK exotiques) : `export const fixtures = { "schema.table": { col: valeur } }`.
 */
export interface AllowlistEntry {
  /** `schema.table`. */
  table: string;
  /** Pourquoi cette table n'est pas isolée par tenant (français, >= 20 caractères). */
  reason: string;
}

export const CORE_ALLOWLIST: readonly AllowlistEntry[] = Object.freeze([
  {
    table: "kernel.tenants",
    reason:
      "Registre des tenants : lisible avant tout contexte de tenant (résolution du slug) et pour itérer les tenants " +
      "dans les jobs ; ne porte aucune donnée de tenant (colonnes non sensibles uniquement).",
  },
]);

/**
 * Valeurs imposées pour fabriquer une ligne de test dans les tables du kernel dont un CHECK
 * empêche la génération automatique (sans elles la table serait seulement contrôlée en structure).
 */
export const CORE_FIXTURES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "kernel.domain_events": Object.freeze({ type: "isolation.check", occurred_at: () => new Date().toISOString() }),
});
