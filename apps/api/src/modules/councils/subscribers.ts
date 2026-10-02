/**
 * Abonnés du module `councils` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `councils.instantiate-reference-data`   `tenancy.institution.created` -> modèle de pack (rôles, types de conseil, types de décision,
 *    réglages) pour un établissement du pack SECONDARY. Idempotent : ne crée rien deux fois, n'écrase jamais une ligne personnalisée.
 *  - `councils.render-minutes`               `councils.minutes.generated` -> PDF demandé à reportcards (nature COUNCIL_MINUTES) DEPUIS LE
 *    SNAPSHOT SEUL ; reprises avec attente, jamais un faux PDF (échec fermé si la nature n'est pas livrée).
 *  - `councils.on-minutes-rendered`          `reportcards.official_document.rendered` (COUNCIL_MINUTES) -> objet rendu et empreinte.
 *  - `councils.revert-on-results-reopened`   `results.period.reopened` -> effets de `results` annulés (la réouverture redevient possible) et
 *    séances closes / signées signalées « conseil à revoir ». `councils` ne rouvre JAMAIS un conseil de lui-même.
 *
 * Ports : le worker n'a pas d'application Fastify ; la plateforme branche les ports par `setCouncilsWorkerPorts` (`installWorkerAdapters`).
 * Sans port, les abonnés ÉCHOUENT FERMÉ (`councils.port_unavailable`) et l'événement est rejoué. Tous les abonnés sont idempotents
 * (`idempotent()` : marque « traité » dans la transaction de l'effet). Contexte SYSTÈME : aucun acte réglementaire n'est fait ici.
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import type { AppError } from "@ecoledigitale/kernel";
import { audit, configureAuditFromEnv } from "../audit";
import { councilsWorkerPorts } from "./application/port-registry";
import { createCouncilsDeps, type CouncilsDeps } from "./application/deps";
import { isBenignConsumerError, onInstitutionCreated, onMinutesGenerated, onOfficialDocumentRendered, onPeriodReopened, type IncomingEvent } from "./application/consumers";
import { ConsumedEvents, CouncilsEvents } from "./domain/events";
import { councilsAuditAdapter } from "./infrastructure/audit-adapter";
import { bundledTemplatePort } from "./templates";

let auditConfigured = false;

function depsOf(ctx: EventHandlerContext): CouncilsDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  return createCouncilsDeps({
    db: ctx.tenantDb,
    logger: ctx.logger,
    portsProvider: () => ({ templates: bundledTemplatePort, ...councilsWorkerPorts() }),
    audit: councilsAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

function settle(result: { ok: true } | { ok: false; error: AppError }, ctx: EventHandlerContext): void {
  if (result.ok) return;
  if (isBenignConsumerError(result.error)) {
    ctx.logger.warn({ code: result.error.code }, "councils : événement ignoré");
    return;
  }
  throw result.error; // transitoire ou inattendu : le worker rejoue (reprises puis dead-letter)
}

const incoming = (event: { id: string; type: string; aggregateId?: string; payload: unknown; occurredAt?: Date | string }): IncomingEvent => ({
  id: event.id,
  type: event.type,
  aggregateId: event.aggregateId,
  payload: event.payload,
  occurredAt: event.occurredAt,
});

const RETRY = { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 } as const;

export default [
  defineSubscriber({
    name: "councils.instantiate-reference-data",
    pattern: ConsumedEvents.INSTITUTION_CREATED,
    retry: RETRY,
    handler: idempotent("councils.instantiate-reference-data", async (event, ctx) => {
      settle(await onInstitutionCreated(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
  defineSubscriber({
    name: "councils.render-minutes",
    pattern: CouncilsEvents.MINUTES_GENERATED,
    retry: { attempts: 8, backoffMs: 2_000, maxBackoffMs: 300_000 },
    handler: idempotent("councils.render-minutes", async (event, ctx) => {
      settle(await onMinutesGenerated(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
  defineSubscriber({
    name: "councils.on-minutes-rendered",
    pattern: ConsumedEvents.DOCUMENT_RENDERED,
    retry: RETRY,
    handler: idempotent("councils.on-minutes-rendered", async (event, ctx) => {
      settle(await onOfficialDocumentRendered(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
  defineSubscriber({
    name: "councils.revert-on-results-reopened",
    pattern: ConsumedEvents.RESULTS_PERIOD_REOPENED,
    retry: RETRY,
    handler: idempotent("councils.revert-on-results-reopened", async (event, ctx) => {
      settle(await onPeriodReopened(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
] satisfies SubscriberDefinition[];
