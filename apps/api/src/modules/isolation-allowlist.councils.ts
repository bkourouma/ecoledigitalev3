/**
 * Tables GLOBALES du schéma "councils" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : les 18 tables du module (rôles de participants, types de conseil, types de décision, réglages, séances, participants,
 * ordre du jour, propositions, décisions, effets, procès-verbaux, signatures, demandes de déverrouillage, journal, parcours
 * d'orientation, dossiers, vœux, transferts de série) portent `tenant_id NOT NULL REFERENCES kernel.tenants(id)` et la RLS forcée
 * (`kernel.enable_tenant_rls`). Types de conseil, rôles et types de décision sont des DONNÉES d'établissement, jamais un référentiel
 * commun : aucune table partagée entre tenants (spec 006 : « les trois allowlists d'isolation sont vides »).
 *
 * Les déclencheurs d'acteur humain refusent l'insertion hors utilisateur identifié : ces tables sont alors contrôlées en structure par
 * le test générique et en COMPORTEMENT A/B par `modules/councils/test/integration/isolation.integration.test.ts`.
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;
