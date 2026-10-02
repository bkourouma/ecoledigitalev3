/**
 * Registres de ports sources d'`analytics` (même mécanisme que `academic`, `finance`…) :
 *
 *  - API : un registre par application Fastify (`app.analyticsPorts`, posé par `setup`) ;
 *  - worker : un registre PAR PROCESSUS (`setAnalyticsWorkerPorts`), lu par les abonnés et les jobs.
 *
 * Résolution PARESSEUSE (à l'appel) : l'ordre de chargement des modules n'est pas porteur de sens.
 */
import type { AnalyticsSourcePorts } from "./ports";

export interface AnalyticsPortRegistry {
  register(ports: Partial<AnalyticsSourcePorts>): void;
  readonly current: Partial<AnalyticsSourcePorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createAnalyticsPortRegistry(initial: Partial<AnalyticsSourcePorts> = {}): AnalyticsPortRegistry {
  let current: Partial<AnalyticsSourcePorts> = { ...initial };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<AnalyticsSourcePorts> = {};

/** Branche des ports dans le processus du worker (jobs `analytics.*`, abonnés de rafraîchissement). */
export function setAnalyticsWorkerPorts(ports: Partial<AnalyticsSourcePorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function analyticsWorkerPorts(): Partial<AnalyticsSourcePorts> {
  return workerPorts;
}

/** Tests : retire les ports du worker. */
export function resetAnalyticsWorkerPorts(): void {
  workerPorts = {};
}
