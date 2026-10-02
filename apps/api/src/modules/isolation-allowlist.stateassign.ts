/**
 * Tables GLOBALES du schéma "stateassign" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : les huit tables du module (settings, assignments, controls, documents, assignment_events, receivables,
 * receivable_events, export_formats) portent `tenant_id NOT NULL REFERENCES kernel.tenants(id)` et la RLS forcée
 * (kernel.enable_tenant_rls). Aucune donnée n'est commune à tous les établissements : ni barème, ni règle officielle, ni
 * format d'export livrés.
 *
 * Valeurs imposées pour fabriquer une ligne de test : un dossier `IMPORT` s'écrit sans acteur humain (la base exige un
 * utilisateur identifié pour un dossier saisi à la main). Les autres tables ont une clé étrangère composite vers le dossier
 * ou une garde « acte humain » : elles sont vérifiées par structure ici, et par un test A/B réel avec les cas d'usage
 * (`modules/stateassign/test/integration/isolation.integration.test.ts`).
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;

export const fixtures = { "stateassign.assignments": { source: "IMPORT" } };
