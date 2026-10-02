/**
 * Dépendances des jobs du worker : ports branchés par `installWorkerAdapters` (`setSchoolLifeWorkerPorts`). Les jobs ne décident
 * rien (aucune écriture dans les tables réservées à l'acteur humain) : ils lisent, mettent en file des notifications neutres et
 * tiennent le registre `job_notifications`.
 */
import type { Logger } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import { createSchoolLifeDeps, type SchoolLifeDeps } from "./application/deps";
import { schoolLifeWorkerPorts } from "./application/worker-ports";

export function workerDeps(input: { tenantDb: TenantDb; systemDb?: SystemDb; logger: Logger }): SchoolLifeDeps {
  return createSchoolLifeDeps({ db: input.tenantDb, logger: input.logger, portsProvider: schoolLifeWorkerPorts });
}
