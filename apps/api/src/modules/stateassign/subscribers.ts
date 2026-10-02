/**
 * Abonnés du module `stateassign` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 * Tous idempotents par `event.id` (`idempotent()` du SDK) ET par construction (le rapprochement ne réécrit rien s'il n'a rien à changer).
 *
 *  - `stateassign.reconcile-on-state-payment`  `finance.payment.completed` d'un FINANCEUR (payeur `FUNDER`) -> rapproche les
 *    dossiers de l'élève : le versement reçu est affecté aux échéances de la créance (ordre d'échéance), l'écart est recalculé.
 *    Les paiements de la famille n'ont aucun effet sur les montants de l'État : ignorés.
 *  - `stateassign.reconcile-on-invoice-issued` `finance.invoice.issued` -> la facturation change (part de l'État ou de la famille) :
 *    le rapprochement est recalculé pour que l'écart apparaisse sans attendre la nuit.
 *
 * Le worker n'a pas de Fastify : les ports (`finance`, `academic`…) viennent de `setStateassignWorkerPorts`, branché par
 * `installWorkerAdapters`. Un port absent fait ÉCHOUER l'abonné (reprise avec attente, puis dead-letter) : aucun rapprochement
 * n'est jamais « supposé ». Un événement dont la charge est illisible est ignoré (journal).
 */
import { z } from "zod";
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { reconcileStudent } from "./application/reconciliation";
import { createStateassignDeps } from "./application/deps";
import { stateassignWorkerPorts } from "./application/port-registry";

const learnerPayload = z.object({ learnerId: z.string().uuid(), payerKind: z.enum(["LEARNER", "FUNDER"]).optional() }).passthrough();

export default [
  defineSubscriber({
    name: "stateassign.reconcile-on-state-payment",
    pattern: "finance.payment.completed",
    retry: { attempts: 6, backoffMs: 2_000, maxBackoffMs: 120_000 },
    handler: idempotent("stateassign.reconcile-on-state-payment", async (event, ctx) => {
      const parsed = learnerPayload.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "stateassign : charge utile finance.payment.completed illisible, ignorée");
        return;
      }
      if (parsed.data.payerKind !== "FUNDER") return;
      const deps = createStateassignDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: stateassignWorkerPorts });
      const r = await reconcileStudent(deps, ctx.db.ctx, parsed.data.learnerId);
      if (!r.ok) throw r.error;
      ctx.logger.info({ studentId: parsed.data.learnerId, reconciled: r.value.reconciled }, "stateassign : rapprochement après versement");
    }),
  }),
  defineSubscriber({
    name: "stateassign.reconcile-on-invoice-issued",
    pattern: "finance.invoice.issued",
    retry: { attempts: 6, backoffMs: 2_000, maxBackoffMs: 120_000 },
    handler: idempotent("stateassign.reconcile-on-invoice-issued", async (event, ctx) => {
      const parsed = learnerPayload.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "stateassign : charge utile finance.invoice.issued illisible, ignorée");
        return;
      }
      const deps = createStateassignDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: stateassignWorkerPorts });
      const r = await reconcileStudent(deps, ctx.db.ctx, parsed.data.learnerId);
      if (!r.ok) throw r.error;
    }),
  }),
];
