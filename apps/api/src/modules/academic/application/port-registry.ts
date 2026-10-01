/**
 * Registres de ports d'`academic` : ce que les adaptateurs de la plateforme (`apps/api/src/platform/adapters`) branchent
 * APRÈS la construction des dépendances. Résolution PARESSEUSE (à l'appel d'un cas d'usage) : l'ordre de chargement des
 * modules n'est pas porteur de sens.
 *
 *  - API : un registre par application Fastify (`app.academicPorts`, posé par `setup`) — deux applications dans le même
 *    processus (tests) ne partagent rien ;
 *  - worker : un registre PAR PROCESSUS (`setAcademicWorkerPorts`), lu par les abonnés (`subscribers.ts`), qui n'ont pas de Fastify.
 *
 * Un port absent garde son repli sûr (`ports.ts`).
 */
import type { AcademicPorts } from "./ports";

export interface AcademicPortRegistry {
  register(ports: Partial<AcademicPorts>): void;
  readonly current: Partial<AcademicPorts>;
}

export function createAcademicPortRegistry(initial: Partial<AcademicPorts> = {}): AcademicPortRegistry {
  let current: Partial<AcademicPorts> = { ...initial };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

let workerPorts: Partial<AcademicPorts> = {};

/** Branche des ports dans le processus du worker (abonnés `academic.confirm-on-invoice-paid`…). */
export function setAcademicWorkerPorts(ports: Partial<AcademicPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function academicWorkerPorts(): Partial<AcademicPorts> {
  return workerPorts;
}

/** Tests : retire les ports du worker. */
export function resetAcademicWorkerPorts(): void {
  workerPorts = {};
}
