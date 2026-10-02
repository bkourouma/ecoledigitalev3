/**
 * Tables GLOBALES du schéma "admissions" (hors RLS « tenant » classique) pour le test d'isolation
 * (`pnpm test:isolation`, `assertTenantIsolation`). Fichier découvert automatiquement.
 *
 *  - public_form_index : SEULE exception d'isolation du module. Résout `slug -> (tenant, établissement)` AVANT toute
 *    connaissance du tenant (route publique du formulaire de candidature). Aucune donnée personnelle ; le slug est un jeton
 *    opaque d'au moins 96 bits (16 à 40 caractères `a-z0-9`), donc non énumérable ; lecture ouverte, écriture (insertion,
 *    mise à jour, suppression) limitée par RLS au tenant propriétaire de la ligne.
 *
 * Toutes les autres tables du schéma portent `tenant_id` et la policy `tenant_isolation` : elles NE doivent PAS figurer ici
 * (le test échoue sinon, comme pour une entrée périmée).
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [
  {
    table: "admissions.public_form_index",
    reason:
      "Résolution du lien public d'un établissement (slug opaque de 96 bits au moins) avant tout contexte tenant : aucune donnée personnelle, " +
      "non énumérable, lecture ouverte ; insertion, mise à jour et suppression limitées par RLS au tenant propriétaire de la ligne.",
  },
];

export default entries;
