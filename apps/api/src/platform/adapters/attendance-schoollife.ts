/**
 * attendance -> schoollife : `AttendanceViewPort` — la VUE des retards et absences d'un élève affichée dans sa fiche de vie
 * scolaire. Lecture seule : `schoollife` ne copie ni ne stocke jamais un pointage (la source de vérité reste `attendance`).
 */
import { listAbsences, type AttendanceDeps } from "../../modules/attendance";
import type { AttendanceViewPort } from "../../modules/schoollife";

export function createSchoollifeAttendanceView(attendance: AttendanceDeps): AttendanceViewPort {
  return {
    async listAbsences(ctx, query) {
      const r = await listAbsences(attendance, ctx, { studentId: query.studentId, from: query.from, to: query.to, limit: Math.min(200, query.limit), onlyAbsences: true });
      if (!r.ok) throw r.error;
      return r.value.items.map((a) => ({ recordId: a.recordId, sessionDate: a.sessionDate, statusCode: a.statusCode, excused: a.excused, countedMinutes: a.countedMinutes, minutesLate: a.minutesLate }));
    },
  };
}
