/**
 * attendance (+ academic) -> primary_school : `AttendancePort` — récapitulatif d'assiduité d'une inscription pour l'année et registre
 * d'appel mensuel d'une classe (appel journalier, `DAILY`).
 *
 * Le récapitulatif est DÉRIVÉ par `attendance` (surcharge tracée comprise : la valeur EFFECTIVE fait foi) ; ce module n'en
 * recalcule rien. L'année est la somme, période par période, des compteurs de séances (jours d'appel), d'absences, d'absences
 * justifiées et de retards : un comptage, jamais un seuil. Une période dont le récapitulatif est illisible rend `null` pour tout
 * le récapitulatif (rien n'est inventé).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { listAcademicPeriods, type AcademicDeps } from "../../modules/academic";
import { getAttendanceSession, getAttendanceSummary, listAttendanceSessions, type AttendanceDeps } from "../../modules/attendance";
import type { AttendancePort } from "../../modules/primary_school";

export function createPrimaryAttendancePort(input: { attendance: AttendanceDeps; academic: AcademicDeps }): AttendancePort {
  const { attendance, academic } = input;
  return {
    async summarize(ctx, { enrollmentId, academicYearId }) {
      const periods = await listAcademicPeriods(academic, ctx, academicYearId);
      const none = { openDays: null, absentDays: null, justifiedAbsentDays: null, lateCount: null } as const;
      if (!periods.ok) return none;
      let openDays = 0;
      let absentDays = 0;
      let justifiedAbsentDays = 0;
      let lateCount = 0;
      // Périodes de premier niveau seulement (les sous-périodes et sessions ne sont pas additionnées deux fois).
      for (const p of periods.value.filter((x) => x.parentPeriodId === null)) {
        const s = await getAttendanceSummary(attendance, ctx, { enrollmentId, periodId: p.id });
        if (!s.ok) return none;
        const e = s.value.effective;
        openDays += e.sessionsTotal;
        absentDays += e.absentCount;
        justifiedAbsentDays += e.excusedCount;
        lateCount += e.lateCount;
      }
      return { openDays, absentDays, justifiedAbsentDays, lateCount };
    },

    async monthlyRegister(ctx: RequestContext, { classroomId, month }) {
      const from = `${month}-01`;
      const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
      const to = `${month}-${String(last).padStart(2, "0")}`;
      const listed = await listAttendanceSessions(attendance, ctx, { classroomId, from, to, limit: 200 });
      if (!listed.ok) return { days: [], rows: [] };
      const days = new Set<string>();
      const byEnrollment = new Map<string, { enrollmentId: string; studentId: string; displayName: string | null; days: Record<string, string> }>();
      for (const s of listed.value.items.filter((x) => x.scope === "DAILY" && (x.status === "SUBMITTED" || x.status === "VALIDATED"))) {
        const detail = await getAttendanceSession(attendance, ctx, { sessionId: s.id });
        if (!detail.ok) continue;
        days.add(s.sessionDate);
        for (const st of detail.value.students) {
          const row = byEnrollment.get(st.enrollmentId) ?? { enrollmentId: st.enrollmentId, studentId: st.studentId, displayName: st.displayName, days: {} };
          if (st.record) row.days[s.sessionDate] = st.record.statusCode;
          byEnrollment.set(st.enrollmentId, row);
        }
      }
      return { days: [...days].sort(), rows: [...byEnrollment.values()].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "")) };
    },
  };
}
