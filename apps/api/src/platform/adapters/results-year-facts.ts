/**
 * attendance + academic -> results : `YearFactsPort` — faits de fin d'année d'une classe pour les règles `cas_absences` et
 * `cas_deja_redoublant` du contrat `coef-period@1` (spec 005).
 *
 *  - absences en JOURNÉES et jours ouverts : `attendance.getAttendanceDaysForEnrollments` sur la fenêtre de l'année scolaire
 *    (appels DAILY soumis ou validés ; jours ouverts = jours d'appel tenus tant que le calendrier ne les fournit pas) ;
 *  - redoublements du cycle : `academic.getEligibilityFacts` (`repeatsInCycle`, année courante comprise).
 *
 * Aucune formule ni aucun seuil : ce fichier transporte des NOMBRES vers les règles. Une inscription dont un fait est introuvable
 * est OMISE de la table (`results` signale alors `yearFacts: "UNAVAILABLE"` et ne devine rien).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getAcademicYear, getEligibilityFacts, type AcademicDeps } from "../../modules/academic";
import { ATTENDANCE_DAYS_MAX_ENROLLMENTS, getAttendanceDaysForEnrollments, type AttendanceDeps } from "../../modules/attendance";
import type { EnrollmentYearFacts, YearFactsPort } from "../../modules/results";

export interface ResultsYearFactsDeps {
  readonly attendance: AttendanceDeps;
  readonly academic: AcademicDeps;
}

export function createResultsYearFactsPort(deps: ResultsYearFactsDeps): YearFactsPort {
  return {
    async getYearFacts(ctx: RequestContext, input): Promise<ReadonlyMap<string, EnrollmentYearFacts>> {
      const out = new Map<string, EnrollmentYearFacts>();
      const year = await getAcademicYear(deps.academic, ctx, input.academicYearId);
      if (!year.ok) return out;
      const days = new Map<string, { absencesDays: number; openDays: number }>();
      const ids = [...new Set(input.enrollmentIds)];
      for (let i = 0; i < ids.length; i += ATTENDANCE_DAYS_MAX_ENROLLMENTS) {
        const chunk = ids.slice(i, i + ATTENDANCE_DAYS_MAX_ENROLLMENTS);
        const r = await getAttendanceDaysForEnrollments(deps.attendance, ctx, { enrollmentIds: chunk, from: year.value.startsOn, to: year.value.endsOn });
        if (!r.ok) continue;
        for (const d of r.value) days.set(d.enrollmentId, { absencesDays: d.ruleInputs.absences_journees, openDays: d.ruleInputs.jours_ouverts });
      }
      for (const enrollmentId of ids) {
        const d = days.get(enrollmentId);
        const facts = await getEligibilityFacts(deps.academic, ctx, enrollmentId);
        if (!d || !facts.ok) continue;
        out.set(enrollmentId, { absencesDays: d.absencesDays, openDays: d.openDays, cycleRepeats: facts.value.repeatsInCycle });
      }
      return out;
    },
  };
}
