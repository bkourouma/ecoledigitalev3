/**
 * Abonnés du module `attendance` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `attendance.cancel-session-on-occurrence-cancelled`  `scheduling.occurrence.cancelled` -> l'appel non validé est
 *    annulé ; un appel déjà VALIDÉ est annulé par réouverture automatique et motivée (`occurrence_cancelled`), auditée.
 *  - `attendance.refresh-summaries-on-enrollment-change`  `academic.enrollment.withdrawn|cancelled|transferred` ->
 *    récapitulatifs de l'inscription recalculés (les pointages passés restent rattachés à l'inscription).
 *  - `attendance.refresh-summaries-on-period-change`      `academic.period.closed|reopened` -> récapitulatifs de la
 *    période rejoués (pas de verrou : une excuse acceptée après coup s'applique, voir spec §13).
 *  - `attendance.seed-reference-data`                     `tenancy.tenant.provisioned` -> référentiels du pack (statuts,
 *    motifs, types de congé, paramètres), idempotent et non destructif.
 *
 * Les noms d'événements et formes de payload des AUTRES modules (`scheduling`, `academic`) sont des hypothèses de travail
 * marquées dans la spec ; les identifiants sont lus avec tolérance (`occurrenceId`, `enrollmentId`, `periodId`).
 * Tous les abonnés sont idempotents (`idempotent()` : marque « traité » dans la transaction de l'effet).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { isUuid, type AppError } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { audit, configureAuditFromEnv } from "../audit";
import { createAttendanceDeps, type AttendanceDeps } from "./application/deps";
import { isBenignConsumerError, onEnrollmentChanged, onOccurrenceCancelled, onPeriodChanged, onTenantProvisioned } from "./application/consumers";
import { ConsumedEvents } from "./domain/events";
import { attendanceAuditAdapter } from "./infrastructure/audit-adapter";

let auditConfigured = false;

/**
 * Dépendances d'un abonné : pas de port d'un autre module dans le worker (seules les données du module servent), mais
 * l'AUDIT est branché — la réouverture automatique d'un appel validé ou l'annulation d'un appel soumis est tracée (R14),
 * avec la même clé HMAC que l'API (`AUDIT_HMAC_KEY`).
 */
function defaultDepsOf(ctx: EventHandlerContext): AttendanceDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  return createAttendanceDeps({
    db: ctx.tenantDb,
    logger: ctx.logger,
    audit: attendanceAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

function pick(payload: unknown, ...keys: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  for (const k of keys) {
    const v = (payload as Record<string, unknown>)[k];
    if (typeof v === "string" && isUuid(v)) return v;
  }
  return undefined;
}

function settle(result: { ok: true } | { ok: false; error: AppError }, ctx: EventHandlerContext): void {
  if (result.ok) return;
  if (isBenignConsumerError(result.error)) {
    ctx.logger.warn({ code: result.error.code }, "attendance : événement ignoré");
    return;
  }
  throw result.error; // transitoire ou inattendu : le worker rejoue (reprises puis dead-letter)
}

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => AttendanceDeps): SubscriberDefinition[] {
  return [
    defineSubscriber({
      name: "attendance.cancel-session-on-occurrence-cancelled",
      pattern: ConsumedEvents.OCCURRENCE_CANCELLED,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent("attendance.cancel-session-on-occurrence-cancelled", async (event, ctx, _tx: Tx) => {
        const occurrenceId = pick(event.payload, "occurrenceId", "sessionId", "id");
        if (!occurrenceId) return ctx.logger.warn({ eventId: event.id }, "attendance : occurrenceId absent du payload");
        settle(await onOccurrenceCancelled(depsOf(ctx), ctx.db.ctx, { occurrenceId }), ctx);
      }),
    }),
    ...[ConsumedEvents.ENROLLMENT_WITHDRAWN, ConsumedEvents.ENROLLMENT_CANCELLED, ConsumedEvents.ENROLLMENT_TRANSFERRED].map((type) =>
      defineSubscriber({
        name: `attendance.refresh-summaries-on-enrollment-change.${type.split(".").pop()}`,
        pattern: type,
        retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
        handler: idempotent(`attendance.refresh-summaries-on-enrollment-change.${type.split(".").pop()}`, async (event, ctx) => {
          const enrollmentId = pick(event.payload, "enrollmentId", "id");
          if (!enrollmentId) return ctx.logger.warn({ eventId: event.id }, "attendance : enrollmentId absent du payload");
          settle(await onEnrollmentChanged(depsOf(ctx), ctx.db.ctx, { enrollmentId }), ctx);
        }),
      }),
    ),
    ...[ConsumedEvents.PERIOD_CLOSED, ConsumedEvents.PERIOD_REOPENED].map((type) =>
      defineSubscriber({
        name: `attendance.refresh-summaries-on-period-change.${type.split(".").pop()}`,
        pattern: type,
        retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
        handler: idempotent(`attendance.refresh-summaries-on-period-change.${type.split(".").pop()}`, async (event, ctx) => {
          const periodId = pick(event.payload, "periodId", "academicPeriodId", "id");
          if (!periodId) return ctx.logger.warn({ eventId: event.id }, "attendance : periodId absent du payload");
          settle(await onPeriodChanged(depsOf(ctx), ctx.db.ctx, { periodId }), ctx);
        }),
      }),
    ),
    defineSubscriber({
      name: "attendance.seed-reference-data",
      pattern: ConsumedEvents.TENANT_PROVISIONED,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent("attendance.seed-reference-data", async (event, ctx) => {
        const p = event.payload as { institutionId?: unknown; institutionIds?: unknown } | null;
        const ids = [
          ...(typeof p?.institutionId === "string" && isUuid(p.institutionId) ? [p.institutionId] : []),
          ...(Array.isArray(p?.institutionIds) ? p.institutionIds.filter((x): x is string => typeof x === "string" && isUuid(x)) : []),
        ];
        const r = await onTenantProvisioned(depsOf(ctx), ctx.db.ctx, { institutionIds: ids });
        settle(r, ctx);
        ctx.logger.info({ institutions: ids.length }, "attendance : référentiels du pack instanciés");
      }),
    }),
  ];
}

export default buildSubscribers(defaultDepsOf);
