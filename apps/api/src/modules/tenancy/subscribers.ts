/**
 * Abonnés du module `tenancy` pour `apps/worker` (découverts automatiquement : `modules/<key>/subscribers.ts`).
 *
 *  - `tenancy.onboarding-on-import-completed` (`imports.run.completed`) : un import d'élèves ou d'enseignants terminé complète
 *    l'étape d'onboarding correspondante (`STUDENT_IMPORT`, `TEACHERS`) — voir `application/onboarding-events.ts`.
 *    Idempotent : marque « traité » dans la transaction du handler ; une étape déjà résolue n'est pas une erreur.
 *
 * En production le worker EMBARQUE les modules dans son bundle : après modification, reconstruisez-le
 * (pnpm --filter @ecoledigitale/worker build).
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import { audit } from "../audit";
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { completeOnboardingOnImport, IMPORT_RUN_COMPLETED, type ImportCompletedPayload } from "./application/onboarding-events";

export default [
  defineSubscriber<ImportCompletedPayload>({
    name: "tenancy.onboarding-on-import-completed",
    pattern: IMPORT_RUN_COMPLETED,
    retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
    handler: idempotent("tenancy.onboarding-on-import-completed", async (event, ctx) => {
      // Le cas d'usage ouvre sa transaction sous le contexte système du tenant de l'événement (SAVEPOINT dans celle du handler).
      const outcome = await completeOnboardingOnImport({ db: ctx.tenantDb, audit: { record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) } }, ctx.tenantId, event.payload, createSystemContext(ctx.tenantId));
      ctx.logger.info({ eventId: event.id, outcome }, "tenancy : onboarding mis à jour par un import");
    }),
  }),
];
