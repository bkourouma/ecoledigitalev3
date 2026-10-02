/**
 * Abonnés et jobs du worker (la logique ; `subscribers.ts` et `jobs.ts` ne font que les brancher).
 *
 *  - `handleValidationRequested` / `handleRunRequested` : exécutent `processValidation` / `processRun` pour le tenant de
 *    l'événement. Idempotents : un import terminé ou tenu par un exécutant vivant n'est pas rejoué.
 *  - `resumeStalledImports` (filet) : republie l'événement d'un import dont l'exécutant est mort ou dont la demande n'a
 *    jamais été prise en charge (événement perdu, Redis indisponible...).
 *  - `purgeExpiredImports` : annule les brouillons abandonnés (quota), purge les lignes brutes (données personnelles) des
 *    imports anciens et supprime leur fichier ; les résultats par ligne (numéros, codes, identifiants) restent.
 */
import { createDomainEvent, createSystemContext, newId } from "@ecoledigitale/kernel";
import { PgOutboxWriter, type ForEachTenantReport, type SystemDb } from "@ecoledigitale/database";
import { IMPORT_EVENTS } from "@ecoledigitale/contracts/src/v2/imports";
import { cancelAbandonedDrafts, getSettings, listJobsToPurge, listStalledJobs, touchRepublished, updateJob } from "../infrastructure/jobs-repository";
import { purgeRaw } from "../infrastructure/rows-repository";
import type { ImportsDeps } from "./deps";
import { processRun, type RunOutcome } from "./run";
import { processValidation, type ProcessOutcome } from "./validate";

export const workerIdOf = (suffix: string): string => `${process.pid}:${suffix}`;

export async function handleValidationRequested(deps: ImportsDeps, tenantId: string, jobId: string, workerId: string): Promise<ProcessOutcome> {
  return processValidation(deps, tenantId, jobId, { workerId });
}

export async function handleRunRequested(deps: ImportsDeps, tenantId: string, jobId: string, workerId: string): Promise<RunOutcome> {
  return processRun(deps, tenantId, jobId, { workerId });
}

export interface StalledReport {
  republished: number;
}

/** Republie les imports sans exécutant vivant : une exécution reprend là où la précédente s'est arrêtée. */
export async function resumeStalledImports(deps: ImportsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<StalledReport>> {
  return systemDb.forEachTenant("imports-resume-stalled", async (tx, tenant) => {
    const stalled = await listStalledJobs(tx, deps.config.staleAfterSeconds);
    const ctx = createSystemContext(tenant.id);
    let republished = 0;
    for (const job of stalled) {
      if (!(await touchRepublished(tx, job.id))) continue;
      const type = job.status === "VALIDATING" ? IMPORT_EVENTS.validationRequested : IMPORT_EVENTS.runRequested;
      await new PgOutboxWriter(tx).append([
        createDomainEvent({ type, payload: { v: 1, jobId: job.id, resumed: true }, ctx, version: 1, aggregateType: "import_job", aggregateId: job.id, clock: deps.clock, id: newId() }),
      ]);
      republished += 1;
    }
    return { republished };
  });
}

export interface PurgeReport {
  cancelledDrafts: number;
  purged: number;
}

export async function purgeExpiredImports(deps: ImportsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<PurgeReport>> {
  const storageKeys: string[] = [];
  const report = await systemDb.forEachTenant("imports-purge", async (tx) => {
    const settings = await getSettings(tx);
    const cancelled = await cancelAbandonedDrafts(tx, deps.config.abandonedDraftHours);
    const old = await listJobsToPurge(tx, settings.retentionDays);
    for (const job of old) {
      await purgeRaw(tx, job.id);
      await updateJob(tx, job.id, { rawPurgedAt: deps.clock.now(), storageKey: null }, deps.clock.now());
      if (job.storageKey) storageKeys.push(job.storageKey);
    }
    return { cancelledDrafts: cancelled.length, purged: old.length };
  });
  // Les objets sont supprimés APRÈS validation des transactions (un échec de stockage ne bloque pas la purge en base).
  for (const key of storageKeys) await deps.ports.storage.delete(key).catch((e: unknown) => deps.logger.warn({ key, err: e instanceof Error ? e.message : String(e) }, "imports : suppression d'un fichier impossible"));
  return report;
}
