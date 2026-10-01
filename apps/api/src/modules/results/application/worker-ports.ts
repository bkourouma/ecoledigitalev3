/**
 * Dépendances de `results` DANS LE WORKER (jobs et abonnés) : pas de Fastify, donc pas de registre `app.resultsPorts`.
 *
 *  - `assess` et `rules` sont des modules à données propres : leurs ports se construisent à partir de leur API publique et de la base
 *    (aucun accès hors de ces modules) ;
 *  - `curriculum` et `roster` viennent d'`academic` (structure de la classe, inscriptions) : le processus du worker les branche par
 *    `setResultsWorkerPorts` (appelé par l'amorçage du worker / d'`academic`). Tant qu'ils ne le sont pas, le recalcul échoue FERMÉ
 *    (`results.port_unavailable`, demande reprise puis marquée en échec) : jamais de calcul sur une structure devinée.
 */
import type { Logger } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import { createAssessDeps } from "../../assess";
import { createRulesApi, createRulesDeps } from "../../rules";
import { assessPortFrom } from "../infrastructure/assess-adapter";
import { rulesPortFrom } from "../infrastructure/rules-adapter";
import { createResultsDeps, type ResultsDeps } from "./deps";
import type { AuditPort, ResultsPorts } from "./ports";

let injected: Partial<ResultsPorts> = {};

/** Branche les ports fournis par d'autres modules dans le processus du worker (curriculum, roster, guardianship, names). */
export function setResultsWorkerPorts(ports: Partial<ResultsPorts>): void {
  injected = { ...injected, ...ports };
}

let memo: { db: TenantDb; deps: ResultsDeps } | null = null;

/** Dépendances du worker, construites UNE fois par accès base de données (le cache des règles compilées est conservé d'une exécution à l'autre). */
export function createWorkerResultsDeps(input: { db: TenantDb; systemDb: SystemDb; logger: Logger; audit?: AuditPort | undefined }): ResultsDeps {
  if (memo && memo.db === input.db) return memo.deps;
  const assess = assessPortFrom(createAssessDeps({ db: input.db, logger: input.logger, portsProvider: () => ({}) }));
  const rules = rulesPortFrom(createRulesApi(createRulesDeps({ db: input.db, systemDb: input.systemDb, logger: input.logger })));
  const deps = createResultsDeps({ db: input.db, logger: input.logger, ...(input.audit ? { audit: input.audit } : {}), portsProvider: () => ({ assess, rules, ...injected }) });
  memo = { db: input.db, deps };
  return deps;
}
