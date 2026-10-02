/**
 * Abonnés du module `analytics` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 * Un événement ne calcule JAMAIS et n'écrit aucun chiffre : il met en file (`analytics.refresh_requests`) UNE demande
 * coalescée par (genre, périmètre) — voir `domain/refresh-plan.ts` pour la table événement -> demandes — que le job
 * `analytics.process-refreshes` exécute en relisant la source par ses ports. Un abonné par SOURCE (6) :
 *
 *   analytics.refresh-on-academic    academic.(year|period|classroom|classroom_period|enrollment).*
 *   analytics.refresh-on-people      people.student.(status_changed|updated|anonymized), people.teaching_assignment.*
 *   analytics.refresh-on-results     results.period.(closed|reopened), results.decision.confirmed
 *   analytics.refresh-on-attendance  attendance.session.*, absence/late recorded, staff_absence.recorded, staff_leave.*
 *   analytics.refresh-on-finance     finance.invoice.*, credit_note.issued, payment.*, refund.*, cash_session.*
 *   analytics.refresh-on-payroll     payroll.period.*, run.completed, payslip.*
 *
 * Idempotents (`idempotent()` : la marque « traité » et la demande sont atomiques) ; la coalescence rend un rejeu inoffensif.
 */
import { defineSubscriber, idempotent, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { createSystemContext } from "@ecoledigitale/kernel";
import { analyticsWorkerPorts } from "./application/port-registry";
import { createAnalyticsDeps } from "./application/deps";
import { enqueueFromEvent } from "./application/requests";
import { SUBSCRIPTION_GROUPS } from "./domain/refresh-plan";

export function buildSubscribers(): SubscriberDefinition[] {
  return SUBSCRIPTION_GROUPS.map((group) =>
    defineSubscriber({
      name: group.name,
      pattern: group.pattern,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent(group.name, async (event, ctx, tx) => {
        const deps = createAnalyticsDeps({ db: ctx.tenantDb, logger: ctx.logger, portsProvider: analyticsWorkerPorts });
        await enqueueFromEvent(deps, createSystemContext(ctx.tenantId), { id: event.id, type: event.type, payload: event.payload, occurredAt: event.occurredAt }, tx);
      }),
    }),
  );
}

export default buildSubscribers();
