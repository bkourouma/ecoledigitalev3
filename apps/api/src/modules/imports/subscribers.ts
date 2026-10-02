/**
 * Abonnés du module `imports` pour `apps/worker` (découverts automatiquement : `modules/<key>/subscribers.ts`).
 *
 *  - `imports.validate`  (`imports.job.validation_requested`) : validation d'un import (étape 3).
 *  - `imports.run`       (`imports.run.requested`)             : exécution d'un import (étape 6), par lots transactionnels.
 *
 * Ces abonnés N'utilisent PAS `idempotent(...)` : leur idempotence vient du bail de l'import (un seul exécutant vivant) et
 * de l'état de l'import (terminé = rien à faire), et ils ne doivent pas tenir une transaction ouverte pendant toute
 * l'exécution. Le délai d'une tentative est long (30 min) ; en cas d'arrêt brutal du worker, le bail expire et l'exécution
 * reprend (nouvelle livraison BullMQ ou job de filet `imports.resume-stalled`) au dernier lot validé.
 *
 * En production le worker EMBARQUE les modules dans son bundle : après modification, reconstruisez-le
 * (pnpm --filter @ecoledigitale/worker build).
 */
import { newId } from "@ecoledigitale/kernel";
import { defineSubscriber } from "@ecoledigitale/worker/sdk";
import { handleRunRequested, handleValidationRequested } from "./application/consumers";
import { createImportsDeps } from "./application/deps";
import { importsWorkerPorts } from "./application/port-registry";
import { IMPORT_EVENTS } from "@ecoledigitale/contracts/src/v2/imports";

const depsFor = (ctx: Parameters<Parameters<typeof defineSubscriber>[0]["handler"]>[1]) =>
  createImportsDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: importsWorkerPorts });

/** Identité d'un exécutant : UNE par livraison (jamais partagée : un zombie ne doit pas pouvoir reprendre le bail d'un autre). */
const workerIdFor = (ctx: { attempt: number }): string => `${process.pid}:${ctx.attempt}:${newId()}`;

export default [
  defineSubscriber<{ v: 1; jobId: string }>({
    name: "imports.validate",
    pattern: IMPORT_EVENTS.validationRequested,
    retry: { attempts: 3, backoffMs: 2_000, maxBackoffMs: 60_000 },
    concurrency: 2,
    timeoutMs: 30 * 60_000,
    handler: async (event, ctx) => {
      const jobId = event.payload.jobId;
      const outcome = await handleValidationRequested(depsFor(ctx), ctx.tenantId, jobId, workerIdFor(ctx));
      if (!outcome.claimed) ctx.logger.info({ jobId }, "imports : validation déjà prise en charge ou terminée");
    },
  }),
  defineSubscriber<{ v: 1; jobId: string }>({
    name: "imports.run",
    pattern: IMPORT_EVENTS.runRequested,
    retry: { attempts: 5, backoffMs: 5_000, maxBackoffMs: 120_000 },
    concurrency: 2,
    timeoutMs: 30 * 60_000,
    handler: async (event, ctx) => {
      const jobId = event.payload.jobId;
      const outcome = await handleRunRequested(depsFor(ctx), ctx.tenantId, jobId, workerIdFor(ctx));
      if (!outcome.claimed) ctx.logger.info({ jobId }, "imports : exécution déjà prise en charge ou terminée");
    },
  }),
];
