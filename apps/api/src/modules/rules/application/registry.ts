/**
 * Registres de ports du processus : les modules consommateurs (`results`, `higher`) y branchent leurs sources de
 * données au démarrage, SANS que `rules` les importe (pas de dépendance circulaire). Chaque registre est indexé par
 * identifiant de contrat.
 */
import { getContract } from "../contracts";
import type { ReplaySource, SimulationCaseSource } from "./ports";

export const defaultSimulationSources = new Map<string, SimulationCaseSource>();
export const defaultReplaySources = new Map<string, ReplaySource>();

/** Branche la source de cas de simulation d'un contrat (données réelles du tenant, construites par le consommateur). */
export function registerSimulationCaseSource(contractId: string, source: SimulationCaseSource): void {
  if (!getContract(contractId)) throw new Error(`registerSimulationCaseSource : contrat inconnu « ${contractId} ».`);
  defaultSimulationSources.set(contractId, source);
}

/** Branche la source d'échantillon de rejeu d'un contrat (résultats FINAL et bulletins contestés). */
export function registerReplaySource(contractId: string, source: ReplaySource): void {
  if (!getContract(contractId)) throw new Error(`registerReplaySource : contrat inconnu « ${contractId} ».`);
  defaultReplaySources.set(contractId, source);
}
