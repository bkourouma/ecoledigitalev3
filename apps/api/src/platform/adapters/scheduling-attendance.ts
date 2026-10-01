/**
 * scheduling -> attendance : `OccurrencePort` (la séance qui porte un appel, séances attendues à contrôler).
 * attendance -> scheduling : `AttendanceQuery` (l'appel d'une séance a-t-il été soumis ?).
 *
 * Une séance sans classe (réunion, réservation de salle) ne porte pas d'appel : elle est inconnue du port d'`attendance`.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getOccurrence, listOccurrences, type SchedulingDeps } from "../../modules/scheduling";
import { listAttendanceSessions, type AttendanceDeps, type OccurrenceInfo, type OccurrencePort } from "../../modules/attendance";
import type { AttendanceQuery } from "../../modules/scheduling";

type DetailLike = Parameters<typeof toOccurrenceInfo>[0];

export function toOccurrenceInfo(o: {
  id: string;
  classroomId: string | null;
  institutionId: string;
  academicYearId: string;
  curriculumNodeId: string | null;
  offeringId: string | null;
  occursOn: string;
  startsAt: Date;
  endsAt: Date;
  status: "PLANNED" | "HELD" | "CANCELLED";
  staff: ReadonlyArray<{ staffId: string; role: string }>;
}): OccurrenceInfo | null {
  if (!o.classroomId) return null;
  return {
    occurrenceId: o.id,
    classroomId: o.classroomId,
    institutionId: o.institutionId,
    academicYearId: o.academicYearId,
    curriculumNodeId: o.curriculumNodeId,
    offeringId: o.offeringId,
    date: o.occursOn,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    durationMinutes: Math.max(0, Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60_000)),
    status: o.status,
    staff: o.staff.map((s) => ({ staffId: s.staffId, role: s.role })),
  };
}

export function createAttendanceOccurrencePort(scheduling: SchedulingDeps): OccurrencePort {
  return {
    async getOccurrence(ctx: RequestContext, occurrenceId) {
      const r = await getOccurrence(scheduling, ctx, { occurrenceId });
      return r.ok ? toOccurrenceInfo(r.value as DetailLike) : null;
    },
    async listExpectedOccurrences(ctx, query) {
      const out: OccurrenceInfo[] = [];
      for (let offset = 0; offset < 20_000; offset += 200) {
        const r = await listOccurrences(scheduling, ctx, {
          from: query.from,
          to: query.to,
          statuses: ["PLANNED", "HELD"],
          ...(query.institutionId ? { institutionId: query.institutionId } : {}),
          ...(query.staffId ? { staffId: query.staffId } : {}),
          limit: 200,
          offset,
        });
        if (!r.ok) break;
        for (const o of r.value.items) {
          const info = toOccurrenceInfo(o as DetailLike);
          if (info) out.push(info);
        }
        if (!r.value.hasMore) break;
      }
      return out;
    },
  };
}

export function createSchedulingAttendanceQuery(attendance: AttendanceDeps): AttendanceQuery {
  return {
    async hasSubmittedAttendance(ctx, occurrenceId) {
      const r = await listAttendanceSessions(attendance, ctx, { occurrenceId, limit: 20 });
      return r.ok && r.value.items.some((s) => s.status === "SUBMITTED" || s.status === "VALIDATED");
    },
  };
}
