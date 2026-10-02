/**
 * Tables GLOBALES du schéma "schoollife" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : les 15 tables du module (réglages, niveaux de gravité, types d'événements, barèmes et leurs valeurs, incidents,
 * implications, mesures, recours, effets d'exclusion, notes, convocations, registre de points, historique, journal des lectures
 * confidentielles) portent `tenant_id NOT NULL REFERENCES kernel.tenants(id)` et la RLS forcée (`kernel.enable_tenant_rls`).
 * Types d'événements, gravités et barèmes sont des DONNÉES d'établissement, jamais un référentiel commun : aucune table
 * partagée entre tenants (spec 006 : « les trois allowlists d'isolation sont vides »).
 *
 * Valeurs imposées pour fabriquer une ligne de test dans une table à CHECK exotique (sinon contrôle de structure seul) :
 * les déclencheurs d'acteur humain refusent l'insertion hors utilisateur identifié ; ces tables sont alors contrôlées en
 * structure par le test générique et en COMPORTEMENT A/B par `modules/schoollife/test/integration/isolation.integration.test.ts`.
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;
