/**
 * Abonnés du module `notifications` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - un abonné par événement déclencheur (`notifications.on.<événement>`) : règles de l'établissement -> destinataires ->
 *    mise en file au journal (le worker d'ENVOI les remet ensuite, voir `jobs.ts`) ;
 *  - `notifications.stop-dunning-on-invoice-paid` (`finance.invoice.paid`) : annule les relances EN ATTENTE de la facture.
 *
 * Les formes de payload sont celles des producteurs (lecteurs : `domain/event-readers.ts`, éprouvés par
 * `apps/api/test/events-contracts/notifications.contracts.ts`). Idempotents : `idempotent()` + clés de remise dérivées de
 * l'identifiant d'événement. Un port indisponible fait ÉCHOUER (le worker rejoue : reprises puis dead-letter) ; un événement
 * illisible ou visant une entité inconnue est BÉNIN (consigné, non rejoué).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import type { NotificationsDeps } from "./application/deps";
import { onDomainEvent, onInvoicePaid } from "./application/events";
import { ConsumedEvents } from "./domain/events";
import { EVENT_TRIGGERS } from "./domain/triggers";
import { workerDeps } from "./worker-deps";

const RETRY = { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 } as const;

const defaultDepsOf = (ctx: EventHandlerContext): NotificationsDeps => workerDeps({ db: ctx.tenantDb, logger: ctx.logger });

/** Nom stable d'un abonné : `notifications.on.finance-invoice-issued`. */
export const subscriberNameOf = (eventType: string): string => `notifications.on.${eventType.replace(/[._]/g, "-")}`;

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => NotificationsDeps): SubscriberDefinition[] {
  const onEvent = EVENT_TRIGGERS.map((eventType) => {
    const name = subscriberNameOf(eventType);
    return defineSubscriber({
      name,
      pattern: eventType,
      retry: RETRY,
      handler: idempotent(name, async (event, ctx) => {
        const r = await onDomainEvent(depsOf(ctx), ctx.db.ctx, { eventId: event.id, eventType: event.type, payload: event.payload });
        if (!r.ok) throw r.error; // transitoire ou inattendu : le worker rejoue
        if (r.value.ignored) ctx.logger.info({ ignored: r.value.ignored, eventType: event.type }, "notifications : événement sans notification");
        else ctx.logger.info({ rules: r.value.rules, queued: r.value.queued, skipped: r.value.skipped, eventType: event.type }, "notifications : remises mises en file");
      }),
    });
  });
  const stopDunning = defineSubscriber({
    name: "notifications.stop-dunning-on-invoice-paid",
    pattern: ConsumedEvents.INVOICE_PAID,
    retry: RETRY,
    handler: idempotent("notifications.stop-dunning-on-invoice-paid", async (event, ctx) => {
      const r = await onInvoicePaid(depsOf(ctx), ctx.db.ctx, { payload: event.payload });
      if (!r.ok) throw r.error;
      if (r.value.cancelled > 0) ctx.logger.info({ cancelled: r.value.cancelled }, "notifications : relances annulées (facture soldée)");
    }),
  });
  return [...onEvent, stopDunning];
}

export default buildSubscribers(defaultDepsOf);
