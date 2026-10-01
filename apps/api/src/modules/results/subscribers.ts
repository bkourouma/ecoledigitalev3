/**
 * Abonnés du module `results` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 * Un événement ne calcule JAMAIS : il met en file (`results.recompute_requests`) UNE demande coalescée par classe × période,
 * temporisée (10 s par défaut) ; le job `results.process-recomputes` exécute les demandes échues.
 *
 *  - `results.recompute-on-grade-published`   `assess.grade.published`  -> (classe, période) de l'évaluation
 *  - `results.recompute-on-grade-revised`     `assess.grade.revised`
 *  - `results.recompute-on-assessment-cancelled` `assess.assessment.cancelled`
 *  - `results.recompute-on-enrollment-*`      `academic.enrollment.created|transferred|withdrawn` -> périodes non clôturées de la classe
 *  - `results.note-binding-change`            `rules.binding.changed` -> AUCUN recalcul (publier une règle ne recalcule rien, A-13) ;
 *                                             l'alerte « retard de version de règle » se lit dans la vue de période
 *
 * Les formes de payload des événements d'`academic` sont des hypothèses de travail (lues avec tolérance). Idempotents
 * (`idempotent()` : marque « traité » dans la transaction de l'effet).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { createSystemContext, isUuid } from "@ecoledigitale/kernel";
import { audit, configureAuditFromEnv } from "../audit";
import { createResultsDeps, type ResultsDeps } from "./application/deps";
import { requestRecompute, requestRecomputeForClassroom } from "./application/recompute";
import { ConsumedEvents } from "./domain/events";

let auditConfigured = false;

function defaultDepsOf(ctx: EventHandlerContext): ResultsDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  return createResultsDeps({ db: ctx.tenantDb, logger: ctx.logger, audit: { record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) } });
}

function pick(payload: unknown, ...keys: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  for (const k of keys) {
    const v = (payload as Record<string, unknown>)[k];
    if (typeof v === "string" && isUuid(v)) return v;
  }
  return undefined;
}

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => ResultsDeps): SubscriberDefinition[] {
  const gradeEvent = (name: string, type: string, listsEnrollments: boolean): SubscriberDefinition =>
    defineSubscriber({
      name,
      pattern: type,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent(name, async (event, ctx, tx) => {
        const classroomId = pick(event.payload, "classroomId");
        const periodId = pick(event.payload, "academicPeriodId", "periodId");
        if (!classroomId || !periodId) return ctx.logger.warn({ eventId: event.id }, "results : classe ou période absente du payload");
        const ids = listsEnrollments && Array.isArray((event.payload as { enrollmentIds?: unknown }).enrollmentIds) ? ((event.payload as { enrollmentIds: unknown[] }).enrollmentIds.filter((x): x is string => typeof x === "string" && isUuid(x))) : undefined;
        const enrollmentId = pick(event.payload, "enrollmentId");
        const r = await requestRecompute(depsOf(ctx), createSystemContext(ctx.tenantId), {
          classroomId,
          academicPeriodId: periodId,
          enrollmentIds: ids ?? (enrollmentId ? [enrollmentId] : undefined),
          cause: { event: event.type, id: event.id },
          tx, // la marque « traité » et la demande de recalcul sont atomiques
        });
        if (!r.ok) throw r.error;
      }),
    });

  const enrollmentEvent = (type: string): SubscriberDefinition => {
    const name = `results.recompute-on-enrollment-${type.split(".").pop()}`;
    return defineSubscriber({
      name,
      pattern: type,
      retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
      handler: idempotent(name, async (event, ctx, tx) => {
        const classroomId = pick(event.payload, "classroomId", "toClassroomId", "fromClassroomId");
        if (!classroomId) return ctx.logger.warn({ eventId: event.id }, "results : classe absente du payload d'inscription");
        const from = pick(event.payload, "fromClassroomId");
        const enrollmentId = pick(event.payload, "enrollmentId", "id");
        const deps = depsOf(ctx);
        for (const room of new Set([classroomId, ...(from ? [from] : [])])) {
          const r = await requestRecomputeForClassroom(deps, createSystemContext(ctx.tenantId), { classroomId: room, enrollmentId, cause: { event: event.type, id: event.id }, tx });
          if (!r.ok) throw r.error;
        }
      }),
    });
  };

  return [
    gradeEvent("results.recompute-on-grade-published", ConsumedEvents.GRADE_PUBLISHED, true),
    gradeEvent("results.recompute-on-grade-revised", ConsumedEvents.GRADE_REVISED, false),
    gradeEvent("results.recompute-on-assessment-cancelled", ConsumedEvents.ASSESSMENT_CANCELLED, true),
    enrollmentEvent(ConsumedEvents.ENROLLMENT_CREATED),
    enrollmentEvent(ConsumedEvents.ENROLLMENT_TRANSFERRED),
    enrollmentEvent(ConsumedEvents.ENROLLMENT_WITHDRAWN),
    defineSubscriber({
      name: "results.note-binding-change",
      pattern: ConsumedEvents.RULES_BINDING_CHANGED,
      handler: idempotent("results.note-binding-change", async (event, ctx) => {
        ctx.logger.info({ eventId: event.id }, "results : liaison de règles modifiée — aucun recalcul (les périodes gardent leur version épinglée)");
      }),
    }),
  ];
}

export default buildSubscribers(defaultDepsOf);
