/**
 * Tables GLOBALES du module `reportcards` (hors RLS « tenant » classique), jointes à la liste blanche du test d'isolation avec
 * la justification de chaque entrée (ADR-002 §5).
 *
 *  - platform_templates : gabarits fournis par la PLATEFORME, identiques pour tous les tenants, sans donnée de tenant ni
 *    donnée personnelle ; lecture ouverte, écriture réservée à l'acteur `system` (RLS dédiée), versions publiées immuables ;
 *  - signing_keys : clés PUBLIQUES de signature (la clé privée n'est jamais en base), publiées pour la vérification hors ligne ;
 *    lecture ouverte, écriture `system` ;
 *  - verification_index : correspondance code de vérification -> (tenant, document) SANS donnée personnelle, nécessaire à une
 *    vérification non authentifiée dont le tenant n'est pas connu (le QR ne porte que le code). Elle PORTE un `tenant_id` et une
 *    RLS forcée : lecture par l'acteur `system` (SystemDb, raison « public-verification ») ou par le tenant propriétaire,
 *    insertion uniquement pour le tenant courant, ni UPDATE ni DELETE ;
 *  - file_hash_index : SHA-256 d'un PDF émis -> code de vérification (comparaison d'un fichier téléversé), mêmes règles.
 *
 * Toutes les autres tables du schéma `reportcards` portent `tenant_id` et la policy `tenant_isolation` : elles NE doivent PAS
 * figurer ici. `fixtures` fournit les valeurs imposées par les CHECK de format pour que le test comportemental (A/B) puisse
 * insérer une ligne minimale ; les tables à clé étrangère composite restent « structure seule ».
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([
  Object.freeze({
    table: "reportcards.platform_templates",
    reason:
      "Catalogue de gabarits de documents fournis par la plateforme, identique pour tous les tenants, sans donnée de tenant ni donnée personnelle ; " +
      "lecture ouverte, écriture réservée à l'acteur `system` (SystemDb) par des policies RLS dédiées, versions publiées immuables (déclencheur).",
  }),
  Object.freeze({
    table: "reportcards.signing_keys",
    reason:
      "Clés PUBLIQUES de signature Ed25519 de la plateforme (la clé privée n'est jamais en base), publiées pour la vérification hors ligne ; " +
      "lecture ouverte, écriture réservée à l'acteur `system`, jamais de DELETE.",
  }),
  Object.freeze({
    table: "reportcards.verification_index",
    reason:
      "Correspondance code de vérification -> (tenant, document) sans aucune donnée personnelle, nécessaire à une vérification publique non authentifiée " +
      "dont le tenant n'est pas connu (le QR ne porte que le code) ; RLS forcée : lecture système ou tenant propriétaire, insertion limitée au tenant courant, immuable.",
  }),
  Object.freeze({
    table: "reportcards.file_hash_index",
    reason:
      "Empreinte SHA-256 d'un PDF émis -> code de vérification, pour reconnaître un fichier téléversé sans connaître son tenant ; aucune donnée personnelle ; " +
      "RLS forcée : lecture système ou tenant propriétaire, insertion limitée au tenant courant, immuable.",
  }),
]);

/** Tables de tenant attendues du schéma `reportcards` (le test d'isolation vérifie qu'aucune n'est oubliée). */
export const reportcardsTenantTables: readonly string[] = Object.freeze([
  "reportcards.branding_versions",
  "reportcards.signatories",
  "reportcards.template_configs",
  "reportcards.settings",
  "reportcards.report_cards",
  "reportcards.renders",
  "reportcards.batches",
  "reportcards.batch_items",
  "reportcards.verification_events",
  "reportcards.access_log",
  "reportcards.official_documents",
  "reportcards.official_document_supersessions",
]);

export const reportcardsIsolationAllowlistTables: readonly string[] = Object.freeze(entries.map((e) => e.table));

/**
 * Valeurs imposées pour fabriquer une ligne de test dans les tables à CHECK de format : sans elles la table serait seulement
 * contrôlée en structure. Les tables à clé étrangère composite (renders, batch_items, access_log, template_configs) restent
 * « structure seule ».
 */
export const fixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "reportcards.verification_events": { document_kind: "REPORT_CARD", result: "AUTHENTIC" },
  "reportcards.batches": { document_kind: "REPORT_CARD", idempotency_key: (n: number) => `iso-${n}-${Math.random().toString(36).slice(2, 10)}` },
  "reportcards.branding_versions": { legal_name: "Établissement d'isolation", version: 1 },
  "reportcards.signatories": { full_name: "Signataire d'isolation" },
});

export default entries;
