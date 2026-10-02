/**
 * Registre des ports de `messaging` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : annuaire des personnes, annuaire des audiences, stockage. Résolution PARESSEUSE
 * (ordre de chargement des modules indifférent) ; un port absent fait échouer FERMÉ (`messaging.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.messagingPorts`, posé par `setup`) ; abonnés et jobs du worker :
 * `setMessagingWorkerPorts` (par processus).
 */
import type { MessagingPorts } from "./ports";

export interface MessagingPortRegistry {
  register(ports: Partial<MessagingPorts>): void;
  readonly current: Partial<MessagingPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createMessagingPortRegistry(initial: Partial<MessagingPorts> = {}): MessagingPortRegistry {
  let current: Partial<MessagingPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<MessagingPorts> = {};

/** Ports du processus du worker (messages système, purge des pièces). */
export function setMessagingWorkerPorts(ports: Partial<MessagingPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function messagingWorkerPorts(): Partial<MessagingPorts> {
  return workerPorts;
}

export function resetMessagingWorkerPorts(): void {
  workerPorts = {};
}
