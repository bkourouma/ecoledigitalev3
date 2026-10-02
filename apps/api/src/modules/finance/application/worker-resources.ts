/**
 * Ressources de finance PAR PROCESSUS pour `apps/worker` (qui n'a pas de Fastify) : ports d'exploitation facultatifs
 * (alertes, compteurs d'observabilité) et, pour les tests, un registre de fournisseurs de remplacement.
 *
 * Par défaut le worker assemble LUI-MÊME le registre de fournisseurs et le coffre depuis l'environnement
 * (`createFinanceProviderRuntime`, identique à l'API) : aucune configuration n'est nécessaire en production. Le branchement
 * d'un port d'observabilité (compteurs, alertes) se fait par `setFinanceWorkerResources` depuis les adaptateurs de plateforme
 * (`installWorkerAdapters`), sans que finance importe le module d'observabilité.
 */
import type { FinanceAlertPort, FinanceMetricsPort } from "./ports/operations";
import type { ProviderRegistry } from "../infrastructure/providers/registry";

export interface FinanceWorkerResources {
  /** Compteurs (rapprochement, remboursements fournisseur). */
  metrics?: FinanceMetricsPort;
  /** Alerte humaine (`reconciliation_needed`) ; défaut : journal d'erreur structuré `alert: true`. */
  alerts?: FinanceAlertPort;
  /** Remplace le registre assemblé depuis l'environnement (tests d'intégration du worker). */
  providers?: ProviderRegistry;
}

let current: FinanceWorkerResources = {};

export function setFinanceWorkerResources(resources: FinanceWorkerResources): void {
  current = { ...current, ...Object.fromEntries(Object.entries(resources).filter(([, v]) => v !== undefined)) };
}

export function getFinanceWorkerResources(): Readonly<FinanceWorkerResources> {
  return current;
}

/** Tests : revient à l'état initial. */
export function resetFinanceWorkerResources(): void {
  current = {};
}
