/** Présentation JSON (DTO de `packages/contracts/src/v2/scheduling.ts`) des enregistrements du domaine. */
import { formatTimeOfDay } from "../domain/time";
import type {
  CalendarEvent,
  EquipmentItem,
  OccurrenceDetail,
  OccurrenceStaff,
  PayableHourLine,
  Room,
  SchedulingSettings,
  TimeSlot,
  Timetable,
  TimetableEntry,
} from "../domain/types";
import type { ChangeRow } from "../infrastructure/occurrence-repo";
import type { ValidatedOverlap } from "../infrastructure/read-queries";
import type { IcsTokenRow } from "../infrastructure/ics-repo";
import type { GenerationRunRow } from "../infrastructure/timetable-repo";
import type { AutogenRunRow } from "../infrastructure/autogen-repo";

export function autogenRunDto(r: AutogenRunRow) {
  return {
    id: r.id,
    institutionId: r.institutionId,
    campusId: r.campusId,
    academicYearId: r.academicYearId,
    periodId: r.periodId,
    name: r.name,
    status: r.status,
    seed: r.seed,
    summary: r.summary,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    fixedTimetableId: r.fixedTimetableId,
    appliedTimetableId: r.appliedTimetableId,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
    discardedAt: r.discardedAt ? r.discardedAt.toISOString() : null,
    params: r.params,
  };
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function staffDto(s: OccurrenceStaff) {
  return {
    id: s.id,
    staffId: s.staffId,
    role: s.role,
    replacesStaffId: s.replacesStaffId,
    isPaidRole: s.isPaidRole,
    paidMinutes: s.paidMinutes,
    locked: s.lockedAt !== null,
    lockRef: s.lockRef,
  };
}

export function occurrenceDto(o: OccurrenceDetail, extra: { attendanceSubmitted?: boolean | null } = {}) {
  return {
    id: o.id,
    institutionId: o.institutionId,
    campusId: o.campusId,
    academicYearId: o.academicYearId,
    timetableEntryId: o.timetableEntryId,
    generatedFor: o.generatedFor,
    kind: o.kind,
    title: o.title,
    classroomId: o.classroomId,
    curriculumNodeId: o.curriculumNodeId,
    offeringId: o.offeringId,
    claimsClassroom: o.claimsClassroom,
    roomId: o.roomId,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    occursOn: o.occursOn,
    durationMinutes: Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60_000),
    deliveryMode: o.deliveryMode,
    virtualSessionRef: o.virtualSessionRef,
    status: o.status,
    heldAt: iso(o.heldAt),
    heldSource: o.heldSource,
    cancelledAt: iso(o.cancelledAt),
    cancelReason: o.cancelReason,
    validatedAt: iso(o.validatedAt),
    validatedBy: o.validatedBy,
    origin: o.origin,
    conflictOverride: o.conflictOverride,
    needsReplacement: o.needsReplacement,
    replacementReason: o.replacementReason,
    notes: o.notes,
    locationLabel: o.locationLabel,
    staff: o.staff.map(staffDto),
    equipment: o.equipment.map((e) => ({ equipmentId: e.equipmentId, quantity: e.quantity })),
    ...(extra.attendanceSubmitted !== undefined ? { attendanceSubmitted: extra.attendanceSubmitted } : {}),
  };
}

export const roomDto = (r: Room) => ({ ...r });
export const equipmentDto = (e: EquipmentItem) => ({ ...e });
export const timeSlotDto = (s: TimeSlot) => ({ ...s });
export const calendarEventDto = (e: CalendarEvent) => ({ ...e, audience: [...e.audience] });
export const settingsDto = (s: SchedulingSettings) => ({ ...s, openingWeekdays: s.openingWeekdays ? [...s.openingWeekdays] : null });

export function timetableDto(t: Timetable) {
  return { ...t, publishedAt: iso(t.publishedAt) };
}

export function entryDto(e: TimetableEntry) {
  return {
    id: e.id,
    timetableId: e.timetableId,
    kind: e.kind,
    classroomId: e.classroomId,
    curriculumNodeId: e.curriculumNodeId,
    offeringId: e.offeringId,
    claimsClassroom: e.claimsClassroom,
    weekday: e.weekday,
    startTime: formatTimeOfDay(e.startMinute),
    endTime: formatTimeOfDay(e.endMinute),
    timeSlotId: e.timeSlotId,
    roomId: e.roomId,
    weekPattern: e.weekPattern,
    validFrom: e.validFrom,
    validTo: e.validTo,
    deliveryMode: e.deliveryMode,
    title: e.title,
    staff: e.staff.map((s) => ({ staffId: s.staffId, role: s.role })),
    equipment: e.equipment.map((q) => ({ equipmentId: q.equipmentId, quantity: q.quantity })),
  };
}

export const payableLineDto = (l: PayableHourLine) => ({ ...l });

export function changeDto(c: ChangeRow) {
  return { id: c.id, kind: c.kind, from: c.fromValue, to: c.toValue, reason: c.reason, actorId: c.actorId, changedAt: c.changedAt.toISOString() };
}

export function overlapDto(o: ValidatedOverlap) {
  return { staffId: o.staffId, occurrenceA: o.occurrenceA, occurrenceB: o.occurrenceB, overlapStart: o.overlapStart.toISOString(), overlapEnd: o.overlapEnd.toISOString() };
}

export function generationRunDto(r: GenerationRunRow) {
  return { ...r, requestedAt: r.requestedAt.toISOString() };
}

export function icsTokenDto(t: IcsTokenRow) {
  return {
    id: t.id,
    scope: t.scope,
    subjectId: t.subjectId,
    label: t.label,
    createdAt: t.createdAt.toISOString(),
    expiresAt: iso(t.expiresAt),
    revokedAt: iso(t.revokedAt),
    lastUsedAt: iso(t.lastUsedAt),
  };
}
