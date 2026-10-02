/**
 * Abonnés du module `examinations` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `examinations.withdraw-on-enrollment-withdrawn`  `academic.enrollment.withdrawn` → l'élève qui quitte l'établissement est retiré
 *    de ses candidatures (motif tracé, numéro conservé et jamais réattribué ; impossible une fois les résultats saisis).
 *
 * Idempotence par CONSTRUCTION : un rejeu ne retrouve plus de candidature vivante pour l'inscription (voir `application/consumers.ts`).
 * La charge lue est celle du PRODUCTEUR (test de contrat : apps/api/test/events-contracts/examinations.test.ts). Après modification,
 * reconstruire le worker : `pnpm --filter @ecoledigitale/worker build`.
 */
import { defineSubscriber } from "@ecoledigitale/worker/sdk";
import { createExaminationsDeps } from "./application/deps";
import { onEnrollmentWithdrawn } from "./application/consumers";
import { ConsumedEvents } from "./domain/events";

export default [
  defineSubscriber({
    name: "examinations.withdraw-on-enrollment-withdrawn",
    pattern: ConsumedEvents.ENROLLMENT_WITHDRAWN,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    concurrency: 4,
    handler: async (event, ctx) => {
      const deps = createExaminationsDeps({ db: ctx.tenantDb, logger: ctx.logger });
      const result = await onEnrollmentWithdrawn(deps, ctx.tenantId, event.payload);
      if (!result.ok) throw result.error;
      if (result.value.ignored) ctx.logger.info({ eventType: event.type, reason: result.value.ignored }, "examinations : événement ignoré");
      else ctx.logger.info({ eventType: event.type, affected: result.value.affected }, "examinations : candidatures retirées");
    },
  }),
];
