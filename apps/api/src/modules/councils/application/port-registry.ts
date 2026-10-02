/**
 * Registre des ports de `councils` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters/*-councils.ts`). Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port
 * absent fait échouer FERMÉ (`councils.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.councilsPorts`, posé par `setup`) ; abonnés et jobs du worker :
 * `setCouncilsWorkerPorts` (par processus).
 */
import type { CouncilsPorts } from "./ports";

export interface CouncilsPortRegistry {
  register(ports: Partial<CouncilsPorts>): void;
  readonly current: Partial<CouncilsPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createCouncilsPortRegistry(initial: Partial<CouncilsPorts> = {}): CouncilsPortRegistry {
  let current: Partial<CouncilsPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<CouncilsPorts> = {};

/** Ports du processus du worker (effets, rendu des PV, alertes). */
export function setCouncilsWorkerPorts(ports: Partial<CouncilsPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function councilsWorkerPorts(): Partial<CouncilsPorts> {
  return workerPorts;
}

export function resetCouncilsWorkerPorts(): void {
  workerPorts = {};
}
