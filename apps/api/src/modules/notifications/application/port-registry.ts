/**
 * Registre des ports de `notifications` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`). Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port absent
 * fait échouer FERMÉ (`notifications.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.notificationsPorts`, posé par `setup`) ; abonnés et jobs du worker :
 * `setNotificationsWorkerPorts` (par processus).
 */
import type { NotificationsPorts } from "./ports";

export interface NotificationsPortRegistry {
  register(ports: Partial<NotificationsPorts>): void;
  readonly current: Partial<NotificationsPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createNotificationsPortRegistry(initial: Partial<NotificationsPorts> = {}): NotificationsPortRegistry {
  let current: Partial<NotificationsPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<NotificationsPorts> = {};

/** Ports du processus du worker (abonnés, relances, alertes, envoi). */
export function setNotificationsWorkerPorts(ports: Partial<NotificationsPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function notificationsWorkerPorts(): Partial<NotificationsPorts> {
  return workerPorts;
}

export function resetNotificationsWorkerPorts(): void {
  workerPorts = {};
}
