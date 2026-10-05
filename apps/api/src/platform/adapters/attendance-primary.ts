/**
 * attendance (+ academic) -> primary_school : `AttendancePort` — récapitulatif d'assiduité d'une inscription pour l'année et registre
 * d'appel mensuel d'une classe (appel journalier, `DAILY`, en un appel par jour ou en deux — matin et après-midi, décision Q-P17).
 *
 * Le récapitulatif est DÉRIVÉ par `attendance` (`getAttendanceDays`) ; ce module n'en recalcule rien. Les compteurs sont des JOURNÉES
 * sur la fenêtre de l'année (de la première période à la dernière) : une demi-journée d'appel vaut 0,5 (entiers avec l'appel journalier
 * unique) : un comptage, jamais un seuil. Une année dont les compteurs sont illisibles rend `null` pour tout le récapitulatif (rien n'est
 * inventé).
 *
 * Registre mensuel : une colonne par jour d'appel ; avec deux appels par jour, une colonne par demi-journée (`AAAA-MM-JJ:MORNING`,
 * `AAAA-MM-JJ:AFTERNOON`). Un appel de la journée entière garde la colonne `AAAA-MM-JJ`.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { listAcademicPeriods, type AcademicDeps } from "../../modules/academic";
import { getAttendanceDays, getAttendanceSession, listAttendanceSessions, type AttendanceDeps } from "../../modules/attendance";
import { getStudentsByIds, type PeopleDeps } from "../../modules/people";
import type { AttendancePort } from "../../modules/primary_school";

export function createPrimaryAttendancePort(input: { attendance: AttendanceDeps; academic: AcademicDeps; people?: PeopleDeps }): AttendancePort {
  const { attendance, academic, people } = input;
  return {
    async summarize(ctx, { enrollmentId, academicYearId }) {
      const periods = await listAcademicPeriods(academic, ctx, academicYearId);
      const none = { openDays: null, absentDays: null, justifiedAbsentDays: null, lateCount: null } as const;
      if (!periods.ok) return none;
      // Fenêtre de l'année : de la première à la dernière période de premier niveau (une demi-journée n'est jamais comptée deux fois).
      const roots = periods.value.filter((x) => x.parentPeriodId === null);
      if (roots.length === 0) return none;
      const from = roots.reduce((m, p) => (p.startsOn < m ? p.startsOn : m), roots[0]!.startsOn);
      const to = roots.reduce((m, p) => (p.endsOn > m ? p.endsOn : m), roots[0]!.endsOn);
      const days = await getAttendanceDays(attendance, ctx, { enrollmentId, from, to });
      if (!days.ok) return none;
      const d = days.value;
      return { openDays: d.openDays, absentDays: d.absentDays, justifiedAbsentDays: d.excusedAbsentDays, lateCount: d.lateDays };
    },

    async monthlyRegister(ctx: RequestContext, { classroomId, month }) {
      const from = `${month}-01`;
      const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
      const to = `${month}-${String(last).padStart(2, "0")}`;
      const listed = await listAttendanceSessions(attendance, ctx, { classroomId, from, to, limit: 200 });
      if (!listed.ok) return { days: [], rows: [] };
      const slots = new Set<string>();
      const byEnrollment = new Map<string, { enrollmentId: string; studentId: string; displayName: string | null; days: Record<string, string> }>();
      for (const s of listed.value.items.filter((x) => x.scope === "DAILY" && (x.status === "SUBMITTED" || x.status === "VALIDATED"))) {
        const detail = await getAttendanceSession(attendance, ctx, { sessionId: s.id });
        if (!detail.ok) continue;
        // Un appel de la journée entière garde la colonne de la date ; une demi-journée a sa propre colonne (`date:MORNING`, `date:AFTERNOON`).
        const slot = s.dayPart === "FULL" ? s.sessionDate : `${s.sessionDate}:${s.dayPart}`;
        slots.add(slot);
        for (const st of detail.value.students) {
          const row = byEnrollment.get(st.enrollmentId) ?? { enrollmentId: st.enrollmentId, studentId: st.studentId, displayName: st.displayName, days: {} };
          if (st.record) row.days[slot] = st.record.statusCode;
          byEnrollment.set(st.enrollmentId, row);
        }
      }
      // Les noms ne viennent pas d'academic (liste d'appel sans identité) : ils sont lus dans `people` (lots de 500, appels séquentiels).
      if (people) {
        const missing = [...new Set([...byEnrollment.values()].filter((r) => r.displayName === null).map((r) => r.studentId))];
        const names = new Map<string, string>();
        for (let i = 0; i < missing.length; i += 500) {
          const r = await getStudentsByIds(people, ctx, missing.slice(i, i + 500));
          if (r.ok) for (const s of r.value) names.set(s.id, s.displayName);
        }
        for (const row of byEnrollment.values()) if (row.displayName === null) row.displayName = names.get(row.studentId) ?? null;
      }
      // Ordre chronologique, matin avant après-midi (`MORNING` < `AFTERNOON` à rebours : on trie explicitement).
      const order = (slot: string): string => slot.replace(":MORNING", ":1").replace(":AFTERNOON", ":2");
      return { days: [...slots].sort((a, b) => order(a).localeCompare(order(b))), rows: [...byEnrollment.values()].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "")) };
    },
  };
}
