/**
 * Dépendances des abonnés et des jobs du worker : ports branchés par `installWorkerAdapters` (`setAdmissionsWorkerPorts`) et
 * audit réel (même clé HMAC que l'API). Un port non branché fait échouer FERMÉ le traitement concerné (l'événement est rejoué).
 */
import type { Logger } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import { audit, configureAuditFromEnv } from "../audit";
import { createAdmissionsDeps, type AdmissionsDeps } from "./application/deps";
import { admissionsWorkerPorts } from "./application/port-registry";
import { admissionsAuditAdapter } from "./infrastructure/audit-adapter";

let auditConfigured = false;

export function workerDeps(input: { tenantDb: TenantDb; systemDb?: SystemDb; logger: Logger }): AdmissionsDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: input.logger });
    auditConfigured = true;
  }
  return createAdmissionsDeps({
    db: input.tenantDb,
    systemDb: input.systemDb ?? null,
    logger: input.logger,
    portsProvider: admissionsWorkerPorts,
    audit: admissionsAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}
