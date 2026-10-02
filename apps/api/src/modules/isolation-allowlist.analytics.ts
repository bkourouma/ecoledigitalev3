/**
 * Tables GLOBALES du schéma "analytics" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : les 22 tables d'analytics (file de rafraîchissement, fraîcheur, réglages, dimensions, faits) portent
 * tenant_id NOT NULL REFERENCES kernel.tenants(id) et la RLS forcée (kernel.enable_tenant_rls). Ce sont des instantanés
 * dérivés propres à chaque établissement : aucun référentiel commun à tous les tenants.
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;
