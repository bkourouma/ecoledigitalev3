/**
 * Tables GLOBALES du schéma "examinations" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : toutes les tables du module — types d'examens, séries, épreuves, sessions, candidats, notes, résultats, lots d'import,
 * formats d'export et d'import, documents émis, compteurs de numérotation — portent `tenant_id NOT NULL REFERENCES kernel.tenants(id)`
 * et la RLS forcée (kernel.enable_tenant_rls). Les types d'examens de chaque établissement sont instanciés depuis un MODÈLE de pack
 * (données), jamais partagés entre tenants (décision T-E13).
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;
