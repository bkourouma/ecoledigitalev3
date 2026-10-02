/**
 * Abonnés du module `primary_school` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `primary_school.instantiate-reference-data`  `tenancy.institution.created` -> modèle de pack (échelle, référentiels de
 *    démonstration, banque de phrases, paramètres) pour un établissement du pack PRIMARY. Idempotent par (établissement, version).
 *  - `primary_school.mirror-period-lock`          `academic.classroom_period.(grading_closed|closed|reopened)` -> miroir local du
 *    verrou de saisie ; l'API contrôle en plus l'état effectif par `PeriodStatePort` (défense en profondeur).
 *  - `primary_school.on-decision-confirmed`       `results.decision.confirmed` -> dossier de conseil décidé et issue d'inscription de fin d'année.
 *  - `primary_school.request-review-document`     `primary_school.annual_review.sealed` -> PDF du bilan demandé à reportcards (échec fermé si
 *    la nature `ANNUAL_REVIEW` n'est pas livrée : l'événement est rejoué ; le scellement ne dépend jamais du rendu).
 *  - `primary_school.on-document-rendered`        `reportcards.official_document.rendered` (ANNUAL_REVIEW) -> `reportcard_id` du bilan.
 *
 * Ports : le worker n'a pas d'application Fastify ; la plateforme branche les ports par `setPrimarySchoolWorkerPorts`
 * (`installWorkerAdapters`). Sans port, les abonnés ÉCHOUENT FERMÉ (`primary_school.port_unavailable`) et l'événement est rejoué.
 * Tous les abonnés sont idempotents (`idempotent()` : marque « traité » dans la transaction de l'effet).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { audit, configureAuditFromEnv } from "../audit";
import { primarySchoolWorkerPorts } from "./application/port-registry";
import { createPrimarySchoolDeps, type PrimarySchoolDeps } from "./application/deps";
import { isBenignConsumerError, onAnnualReviewSealed, onClassroomPeriodEvent, onInstitutionCreated, onOfficialDocumentRendered, onResultsDecisionConfirmed, type IncomingEvent } from "./application/consumers";
import { ConsumedEvents, PrimaryEvents } from "./domain/events";
import { primarySchoolAuditAdapter } from "./infrastructure/audit-adapter";
import type { AppError } from "@ecoledigitale/kernel";

let auditConfigured = false;

function depsOf(ctx: EventHandlerContext): PrimarySchoolDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  return createPrimarySchoolDeps({
    db: ctx.tenantDb,
    logger: ctx.logger,
    portsProvider: primarySchoolWorkerPorts,
    audit: primarySchoolAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

function settle(result: { ok: true } | { ok: false; error: AppError }, ctx: EventHandlerContext): void {
  if (result.ok) return;
  if (isBenignConsumerError(result.error)) {
    ctx.logger.warn({ code: result.error.code }, "primary_school : événement ignoré");
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
    name: "primary_school.instantiate-reference-data",
    pattern: ConsumedEvents.INSTITUTION_CREATED,
    retry: RETRY,
    handler: idempotent("primary_school.instantiate-reference-data", async (event, ctx) => {
      settle(await onInstitutionCreated(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
  ...[ConsumedEvents.CLASSROOM_PERIOD_GRADING_CLOSED, ConsumedEvents.CLASSROOM_PERIOD_CLOSED, ConsumedEvents.CLASSROOM_PERIOD_REOPENED].map((pattern) =>
    defineSubscriber({
      name: `primary_school.mirror-period-lock.${pattern.split(".").pop()}`,
      pattern,
      retry: RETRY,
      handler: idempotent(`primary_school.mirror-period-lock.${pattern.split(".").pop()}`, async (event, ctx) => {
        settle(await onClassroomPeriodEvent(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
      }),
    }),
  ),
  defineSubscriber({
    name: "primary_school.on-decision-confirmed",
    pattern: ConsumedEvents.DECISION_CONFIRMED,
    retry: RETRY,
    handler: idempotent("primary_school.on-decision-confirmed", async (event, ctx) => {
      settle(await onResultsDecisionConfirmed(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
  defineSubscriber({
    name: "primary_school.request-review-document",
    pattern: PrimaryEvents.ANNUAL_REVIEW_SEALED,
    retry: { attempts: 8, backoffMs: 2_000, maxBackoffMs: 300_000 },
    handler: idempotent("primary_school.request-review-document", async (event, ctx) => {
      settle(await onAnnualReviewSealed(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
  defineSubscriber({
    name: "primary_school.on-document-rendered",
    pattern: ConsumedEvents.OFFICIAL_DOCUMENT_RENDERED,
    retry: RETRY,
    handler: idempotent("primary_school.on-document-rendered", async (event, ctx) => {
      settle(await onOfficialDocumentRendered(depsOf(ctx), ctx.db.ctx, incoming(event)), ctx);
    }),
  }),
] satisfies SubscriberDefinition[];
