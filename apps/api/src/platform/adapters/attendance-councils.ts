/**
 * attendance (+ academic) -> councils : `AttendancePort` — valeurs EFFECTIVES d'assiduité d'une inscription (surcharge tracée comprise) pour
 * la période du conseil, ou pour toute l'année d'un bilan de fin d'année.
 *
 * `attendance` DÉRIVE ces valeurs ; ce module n'en recalcule rien (compteurs de la source recopiés ; pour un bilan d'année, somme des
 * périodes de premier niveau). Une période dont le récapitulatif est illisible rend `null` pour tout le récapitulatif : rien n'est inventé,
 * l'instantané du conseil porte alors `attendance: null` avec un avertissement.
 */
import { listAcademicPeriods, type AcademicDeps } from "../../modules/academic";
import { getAttendanceSummary, type AttendanceDeps } from "../../modules/attendance";
import type { CouncilsAttendancePort } from "../../modules/councils";

export function createCouncilsAttendancePort(input: { attendance: AttendanceDeps; academic: AcademicDeps }): CouncilsAttendancePort {
  const { attendance, academic } = input;
  return {
    async summarize(ctx, { enrollmentId, academicYearId, academicPeriodId }) {
      let periodIds: string[];
      if (academicPeriodId !== null) {
        periodIds = [academicPeriodId];
      } else {
        const periods = await listAcademicPeriods(academic, ctx, academicYearId);
        if (!periods.ok) return null;
        // Périodes de premier niveau seulement : les sous-périodes ne sont pas additionnées deux fois.
        periodIds = periods.value.filter((p) => p.parentPeriodId === null).map((p) => p.id);
      }
      if (periodIds.length === 0) return null;
      let absentMinutes = 0;
      let excusedMinutes = 0;
      let absentCount = 0;
      let excusedCount = 0;
      let lateCount = 0;
      for (const periodId of periodIds) {
        const s = await getAttendanceSummary(attendance, ctx, { enrollmentId, periodId });
        if (!s.ok) return null;
        const e = s.value.effective;
        absentMinutes += e.absentMinutes;
        excusedMinutes += e.excusedMinutes;
        absentCount += e.absentCount;
        excusedCount += e.excusedCount;
        lateCount += e.lateCount;
      }
      return { available: true, absentMinutes, excusedMinutes, absentCount, excusedCount, lateCount };
    },
  };
}
