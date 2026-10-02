/**
 * Registre des ports de `imports` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`). Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port absent
 * fait échouer FERMÉ (`imports.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.importsPorts`, posé par `setup`) ; abonnés et jobs du worker :
 * `setImportsWorkerPorts` (par processus).
 */
import type { ImportPorts } from "./ports";

export interface ImportsPortRegistry {
  register(ports: Partial<ImportPorts>): void;
  readonly current: Partial<ImportPorts>;
}

function merge(current: Partial<ImportPorts>, next: Partial<ImportPorts>): Partial<ImportPorts> {
  return {
    ...current,
    ...(next.storage ? { storage: next.storage } : {}),
    ...(next.audit ? { audit: next.audit } : {}),
    ...(next.names ? { names: next.names } : {}),
    ...(next.targets ? { targets: { ...current.targets, ...next.targets } } : {}),
  };
}

export function createImportsPortRegistry(initial: Partial<ImportPorts> = {}): ImportsPortRegistry {
  let current: Partial<ImportPorts> = merge({}, initial);
  return {
    register(ports) {
      current = merge(current, ports);
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<ImportPorts> = {};

/** Ports du processus du worker (validation et exécution des imports). */
export function setImportsWorkerPorts(ports: Partial<ImportPorts>): void {
  workerPorts = merge(workerPorts, ports);
}

export function importsWorkerPorts(): Partial<ImportPorts> {
  return workerPorts;
}

export function resetImportsWorkerPorts(): void {
  workerPorts = {};
}
