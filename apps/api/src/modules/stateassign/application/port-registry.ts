/**
 * Registre des ports de `stateassign` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : inscriptions, financement, facturation, présence, documents, noms, tutelle, passerelle.
 * Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port absent fait échouer FERMÉ
 * (`stateassign.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.stateassignPorts`, posé par `setup`) ; jobs et abonnés du worker :
 * `setStateassignWorkerPorts` (par processus).
 */
import type { StateassignPorts } from "./ports";

export interface StateassignPortRegistry {
  register(ports: Partial<StateassignPorts>): void;
  readonly current: Partial<StateassignPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createStateassignPortRegistry(initial: Partial<StateassignPorts> = {}): StateassignPortRegistry {
  let current: Partial<StateassignPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<StateassignPorts> = {};

/** Ports du processus du worker (rapprochement, planification, alertes). */
export function setStateassignWorkerPorts(ports: Partial<StateassignPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function stateassignWorkerPorts(): Partial<StateassignPorts> {
  return workerPorts;
}

export function resetStateassignWorkerPorts(): void {
  workerPorts = {};
}
