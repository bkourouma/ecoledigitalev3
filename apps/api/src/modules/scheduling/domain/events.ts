/**
 * Événements publiés par le module `scheduling` (outbox, `<module>.<entité>.<verbe-passé>`, payload
 * `{ v: 1, … }` — conventions n° 6). AUCUNE donnée personnelle : seulement des identifiants.
 * Consommateurs : 010 (annule l'appel sur `occurrence.cancelled`), 016 (notifications de changement
 * d'horaire), 025 (occupation), 032 (invalidation d'une validation non réclamée), portails.
 */

export const SchedulingEvents = {
  timetablePublished: "scheduling.timetable.published",
  timetableArchived: "scheduling.timetable.archived",
  occurrenceCreated: "scheduling.occurrence.created",
  occurrenceRescheduled: "scheduling.occurrence.rescheduled",
  occurrenceRoomChanged: "scheduling.occurrence.room_changed",
  occurrenceStaffChanged: "scheduling.occurrence.staff_changed",
  occurrenceHeld: "scheduling.occurrence.held",
  occurrenceUnheld: "scheduling.occurrence.unheld",
  occurrenceCancelled: "scheduling.occurrence.cancelled",
  occurrenceRestored: "scheduling.occurrence.restored",
  occurrenceValidated: "scheduling.occurrence.validated",
  occurrenceUnvalidated: "scheduling.occurrence.unvalidated",
  occurrencePaidMinutesChanged: "scheduling.occurrence.paid_minutes_changed",
  occurrenceReplacementNeeded: "scheduling.occurrence.replacement_needed",
  conflictOverridden: "scheduling.conflict.overridden",
  hoursLocked: "scheduling.hours.locked",
  hoursReleased: "scheduling.hours.released",
  calendarEventCreated: "scheduling.calendar_event.created",
  calendarEventUpdated: "scheduling.calendar_event.updated",
  calendarEventDeleted: "scheduling.calendar_event.deleted",
  calendarBlockingOverlap: "scheduling.calendar_event.blocking_overlap",
  generationCompleted: "scheduling.generation.completed",
} as const;

export const ALL_SCHEDULING_EVENT_TYPES: readonly string[] = Object.freeze(Object.values(SchedulingEvents));

/** Événements des autres modules que scheduling consomme (alignés sur les producteurs : apps/api/test/events-catalog.test.ts). */
export const ConsumedEvents = {
  attendanceSessionSubmitted: "attendance.session.submitted",
  staffLeaveApproved: "attendance.staff_leave.approved",
  staffStatusChanged: "people.staff.status_changed",
  teachingAssignmentEnded: "people.teaching_assignment.ended",
  offeringCancelled: "academic.offering.cancelled",
  classroomCancelled: "academic.classroom.cancelled",
  yearClosed: "academic.year.closed",
  tenantProvisioned: "tenancy.tenant.provisioned",
} as const;

export const CONSUMED_EVENT_TYPES: readonly string[] = Object.freeze(Object.values(ConsumedEvents));

export interface OccurrenceEventPayload {
  readonly v: 1;
  readonly occurrenceId: string;
  readonly kind: string;
  readonly classroomId: string | null;
  readonly offeringId: string | null;
  readonly roomId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly staffIds: readonly string[];
}

export type EventPayload = { v: 1 } & Record<string, unknown>;
