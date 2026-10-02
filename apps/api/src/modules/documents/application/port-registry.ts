/**
 * Registre des ports de `documents` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : stockage, annuaire des propriétaires, antivirus, conversion, usage, quota du plan.
 * Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port absent fait échouer FERMÉ
 * (`documents.port_unavailable`) pour le stockage et l'annuaire.
 *
 * API : un registre par application Fastify (`app.documentsPorts`, posé par `setup`) ; jobs du worker :
 * `setDocumentsWorkerPorts` (par processus).
 */
import type { DocumentsPorts } from "./ports";

export interface DocumentsPortRegistry {
  register(ports: Partial<DocumentsPorts>): void;
  readonly current: Partial<DocumentsPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createDocumentsPortRegistry(initial: Partial<DocumentsPorts> = {}): DocumentsPortRegistry {
  let current: Partial<DocumentsPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<DocumentsPorts> = {};

/** Ports du processus du worker (purge des objets, alertes). */
export function setDocumentsWorkerPorts(ports: Partial<DocumentsPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function documentsWorkerPorts(): Partial<DocumentsPorts> {
  return workerPorts;
}

export function resetDocumentsWorkerPorts(): void {
  workerPorts = {};
}
