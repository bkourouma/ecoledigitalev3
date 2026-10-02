/**
 * Dépendances des abonnés et jobs du worker : ports du processus (`setNotificationsWorkerPorts`, branchés par
 * `installWorkerAdapters`), audit branché (même clé HMAC que l'API), configuration depuis l'environnement, registre de canaux
 * UNIQUE par processus (connexions SMTP réutilisées). Les abonnés n'ont pas besoin du registre : il est construit à la demande.
 */
import type { Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { audit, configureAuditFromEnv } from "../audit";
import { closeChannelRegistry, createChannelRegistry } from "./infrastructure/channels/registry";
import { configFromEnv, createNotificationsDeps, type NotificationsDeps } from "./application/deps";
import { notificationsWorkerPorts } from "./application/port-registry";
import type { ChannelRegistry } from "./application/ports";

let auditConfigured = false;
let registry: ChannelRegistry | null = null;

export function workerDeps(input: { db: TenantDb; logger: Logger; env?: Readonly<Record<string, string | undefined>> }): NotificationsDeps {
  const env = input.env ?? process.env;
  if (!auditConfigured) {
    configureAuditFromEnv(audit, env, { logger: input.logger });
    auditConfigured = true;
  }
  return createNotificationsDeps({
    db: input.db,
    logger: input.logger,
    portsProvider: notificationsWorkerPorts,
    config: configFromEnv(env),
    audit: { record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) },
    channels: (deps) => (registry ??= createChannelRegistry(deps, { env })),
  });
}

/** Ferme les connexions des canaux (arrêt du processus, tests). */
export async function disposeWorkerChannels(): Promise<void> {
  if (registry) await closeChannelRegistry(registry);
  registry = null;
}
