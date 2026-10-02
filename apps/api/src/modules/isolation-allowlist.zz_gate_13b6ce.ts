/**
 * Tables GLOBALES du schéma "zz_gate_13b6ce" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : la table d'exemple zz_gate_13b6ce.items porte tenant_id NOT NULL REFERENCES kernel.tenants(id) et la RLS forcée
 * (kernel.enable_tenant_rls). Une table n'a sa place ici QUE si elle est volontairement commune à tous les tenants
 * (référentiel). Chaque entrée porte alors une justification d'au moins 20 caractères, et le schéma de la table est
 * celui du module (aucune table d'un autre module). Une entrée qui ne correspond à aucune table est une erreur.
 *
 * Exemple :
 *   { table: "zz_gate_13b6ce.currencies", reason: "Référentiel ISO 4217 identique pour tous les tenants, sans donnée de tenant." },
 *
 * Valeurs imposées pour fabriquer une ligne de test dans une table à CHECK exotique (sinon contrôle de structure seul) :
 *   export const fixtures = { "zz_gate_13b6ce.items": { label: "isolation" } };
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;
