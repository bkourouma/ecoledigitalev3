/**
 * Abonnés du module `scheduling` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `scheduling.hold-on-attendance`           `attendance.session.submitted` → séance constatée (HELD, source ATTENDANCE).
 *  - `scheduling.flag-on-staff-leave`          `attendance.staff_leave.approved` → séances futures à remplacer.
 *  - `scheduling.flag-on-staff-status`         `people.staff.status_changed` (LEFT / SUSPENDED) → idem.
 *  - `scheduling.flag-on-assignment-ended`     `people.teaching_assignment.ended` → idem.
 *  - `scheduling.cancel-on-offering-cancelled` `academic.offering.cancelled` → séances futures non validées annulées.
 *  - `scheduling.cancel-on-classroom-cancelled` `academic.classroom.cancelled` → idem pour la classe.
 *  - `scheduling.archive-on-year-closed`       `academic.year.closed` → emplois du temps de l'année archivés.
 *  - `scheduling.seed-reference-data`          `tenancy.tenant.provisioned` → types de salle et d'événement du pack.
 *
 * Idempotence par CONSTRUCTION (voir `application/consumers.ts`) : un rejeu ne change rien (constat déjà posé,
 * séance déjà signalée ou annulée), donc l'enveloppe `idempotent()` du SDK — qui ne couvrirait pas les
 * transactions propres aux cas d'usage — n'apporte rien. Un échec est relancé par le worker (reprises puis
 * dead-letter). ⚠ Les noms et charges des événements des autres modules sont des hypothèses de travail.
 */
import { defineSubscriber } from "@ecoledigitale/worker/sdk";
import type { AppError, Result } from "@ecoledigitale/kernel";
import { createSchedulingDeps } from "./application/deps";
import {
  onAttendanceSessionSubmitted,
  onClassroomCancelled,
  onOfferingCancelled,
  onStaffLeaveApproved,
  onStaffStatusChanged,
  onTeachingAssignmentEnded,
  onTenantProvisioned,
  onYearClosed,
  type ConsumeReport,
} from "./application/consumers";
import { ConsumedEvents } from "./domain/events";
import { registryPorts } from "./ports-registry";

type Handler = (deps: ReturnType<typeof createSchedulingDeps>, tenantId: string, payload: unknown) => Promise<Result<ConsumeReport, AppError>>;

function subscriber(name: string, pattern: string, handle: Handler) {
  return defineSubscriber({
    name,
    pattern,
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    concurrency: 4,
    handler: async (event, ctx) => {
      const deps = createSchedulingDeps({ db: ctx.tenantDb, ports: registryPorts, logger: ctx.logger });
      const result = await handle(deps, ctx.tenantId, event.payload);
      if (!result.ok) throw result.error;
      if (result.value.ignored) ctx.logger.info({ eventType: event.type, reason: result.value.ignored }, "scheduling : événement ignoré");
      else ctx.logger.info({ eventType: event.type, affected: result.value.affected }, "scheduling : événement traité");
    },
  });
}

export default [
  subscriber("scheduling.hold-on-attendance", ConsumedEvents.attendanceSessionSubmitted, onAttendanceSessionSubmitted),
  subscriber("scheduling.flag-on-staff-leave", ConsumedEvents.staffLeaveApproved, onStaffLeaveApproved),
  subscriber("scheduling.flag-on-staff-status", ConsumedEvents.staffStatusChanged, onStaffStatusChanged),
  subscriber("scheduling.flag-on-assignment-ended", ConsumedEvents.teachingAssignmentEnded, onTeachingAssignmentEnded),
  subscriber("scheduling.cancel-on-offering-cancelled", ConsumedEvents.offeringCancelled, onOfferingCancelled),
  subscriber("scheduling.cancel-on-classroom-cancelled", ConsumedEvents.classroomCancelled, onClassroomCancelled),
  subscriber("scheduling.archive-on-year-closed", ConsumedEvents.yearClosed, onYearClosed),
  subscriber("scheduling.seed-reference-data", ConsumedEvents.tenantProvisioned, (deps, tenantId) => onTenantProvisioned(deps, tenantId)),
];
