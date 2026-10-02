/**
 * attendance -> stateassign : `AttendanceFactsPort` — les faits de présence d'une inscription sur une PÉRIODE, tels que les publie
 * `attendance` (valeur EFFECTIVE, surcharge tracée comprise). stateassign les consigne dans le constat d'un contrôle : il ne calcule
 * jamais une présence. Sans période, aucun fait (le récapitulatif d'attendance est par période). Aucune écriture.
 */
import { getAttendanceSummary, type AttendanceDeps } from "../../modules/attendance";
import type { AttendanceFactsPort } from "../../modules/stateassign";

export function createStateassignAttendanceFacts(attendance: AttendanceDeps): AttendanceFactsPort {
  return {
    async getFacts(ctx, query) {
      if (!query.periodId) return null;
      const r = await getAttendanceSummary(attendance, ctx, { enrollmentId: query.enrollmentId, periodId: query.periodId });
      if (!r.ok) return null;
      const e = r.value.effective;
      return { absentMinutes: e.absentMinutes, excusedMinutes: e.excusedMinutes, lateCount: e.lateCount, periodId: query.periodId };
    },
  };
}
