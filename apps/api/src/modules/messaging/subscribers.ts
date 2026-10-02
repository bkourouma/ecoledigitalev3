/**
 * Abonnés du module `messaging` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `messaging.system-message-on-absence`  `attendance.absence.recorded` -> message système dans le fil d'alertes de TOUS les
 *    tuteurs joignables de l'élève (gabarit `attendance.absence` du tenant). Rien pour une absence déjà excusée ni une correction.
 *  - `messaging.system-message-on-late`     `attendance.late.recorded` -> idem avec le gabarit `attendance.late`
 *    (DÉSACTIVÉ par défaut : le tenant l'active).
 *
 * Les formes de payload sont celles du producteur (`attendance`) ; lecteurs : `application/consumers.ts`, éprouvés par
 * `apps/api/test/events-contracts/messaging.contracts.ts`. Les abonnés lisent les tuteurs par le port d'annuaire
 * (`setMessagingWorkerPorts`, branché par `installWorkerAdapters`) ; sans lui l'abonné échoue FERMÉ et le worker rejoue.
 * Idempotents : `idempotent()` + clé de déduplication du message (`evt:<id de l'événement>`).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import type { AppError } from "@ecoledigitale/kernel";
import { audit, configureAuditFromEnv } from "../audit";
import { createMessagingDeps, type MessagingDeps } from "./application/deps";
import { isBenignConsumerError, onAttendanceRecorded } from "./application/consumers";
import { messagingWorkerPorts } from "./application/port-registry";
import { ConsumedEvents } from "./domain/events";
import { messagingAuditAdapter } from "./infrastructure/audit-adapter";

let auditConfigured = false;

/** Dépendances d'un abonné : ports du worker (annuaire, stockage) et audit branché (même clé HMAC que l'API). */
function defaultDepsOf(ctx: EventHandlerContext): MessagingDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  return createMessagingDeps({
    db: ctx.tenantDb,
    logger: ctx.logger,
    portsProvider: messagingWorkerPorts,
    audit: messagingAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

function settle(result: { ok: true } | { ok: false; error: AppError }, ctx: EventHandlerContext): void {
  if (result.ok) return;
  if (isBenignConsumerError(result.error)) {
    ctx.logger.warn({ code: result.error.code }, "messaging : événement ignoré");
    return;
  }
  throw result.error; // transitoire ou inattendu : le worker rejoue (reprises puis dead-letter)
}

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => MessagingDeps): SubscriberDefinition[] {
  const make = (name: string, pattern: string, kind: "ABSENCE" | "LATE") =>
    defineSubscriber({
      name,
      pattern,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent(name, async (event, ctx) => {
        const r = await onAttendanceRecorded(depsOf(ctx), ctx.db.ctx, { eventId: event.id, kind, payload: event.payload });
        settle(r, ctx);
        if (r.ok && r.value.skipped) ctx.logger.info({ skipped: r.value.skipped }, "messaging : aucun message système");
      }),
    });
  return [
    make("messaging.system-message-on-absence", ConsumedEvents.ABSENCE_RECORDED, "ABSENCE"),
    make("messaging.system-message-on-late", ConsumedEvents.LATE_RECORDED, "LATE"),
  ];
}

export default buildSubscribers(defaultDepsOf);
