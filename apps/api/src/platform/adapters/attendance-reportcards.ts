/**
 * attendance -> reportcards : `AttendanceSummaryPort` — absences justifiées / non justifiées (minutes) et nombre de retards
 * d'une inscription sur une période, copiés dans le snapshot du bulletin À L'ÉMISSION.
 *
 * Le récapitulatif d'attendance compte `absent*` = TOTAL (justifiées comprises) et `excused*` = sous-ensemble : justifié =
 * `excusedMinutes`, non justifié = `absentMinutes − excusedMinutes`. La valeur EFFECTIVE (surcharge tracée comprise) fait foi.
 */
import { getAttendanceSummary, type AttendanceDeps } from "../../modules/attendance";
import type { AttendanceSummaryPort } from "../../modules/reportcards";

export function createReportcardsAttendanceSummary(attendance: AttendanceDeps): AttendanceSummaryPort {
  return {
    async getSummary(ctx, query) {
      const r = await getAttendanceSummary(attendance, ctx, { enrollmentId: query.enrollmentId, periodId: query.academicPeriodId });
      if (!r.ok) return null;
      const e = r.value.effective;
      return { justifiedMinutes: e.excusedMinutes, unjustifiedMinutes: Math.max(0, e.absentMinutes - e.excusedMinutes), lateCount: e.lateCount };
    },
  };
}
