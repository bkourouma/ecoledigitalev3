/**
 * primary_school -> results : `CompetencyCountersPort` — compteurs de compétences (évaluées / attendues) par inscription,
 * entrée de la règle `decision_fin_annee` du contrat `competency-period@1` (spec 005).
 *
 * `primary_school` COMPTE les lignes validées (jamais de niveau ni de note) ; `results` n'en tire qu'une PROPOSITION
 * (`PENDING` / `COUNCIL_REVIEW`) : le conseil décide. Un échec de lecture est propagé (échec fermé : jamais de décision sans compteur).
 */
import type { CompetencyCounters, CompetencyCountersPort, FamilyReleasePort } from "../../modules/results";
import { getCompetencyCounters, isPeriodReleasedToFamilies, type PrimarySchoolDeps } from "../../modules/primary_school";

/**
 * primary_school -> results : `FamilyReleasePort` (décision Q-P18). Une classe × période est « libérée » aux familles quand l'enseignant
 * l'a marquée prête. Un échec de lecture est propagé à l'appelant, qui le traite comme « non libérée » (échec fermé).
 */
export function createResultsFamilyRelease(primary: PrimarySchoolDeps): FamilyReleasePort {
  return {
    async isReleased(ctx, input): Promise<boolean> {
      const r = await isPeriodReleasedToFamilies(primary, ctx, { classroomId: input.classroomId, periodId: input.academicPeriodId });
      if (!r.ok) throw r.error;
      return r.value;
    },
  };
}

export function createResultsCompetencyCounters(primary: PrimarySchoolDeps): CompetencyCountersPort {
  return {
    async getCompetencyCounters(ctx, input): Promise<ReadonlyMap<string, CompetencyCounters>> {
      const r = await getCompetencyCounters(primary, ctx, { classroomId: input.classroomId, enrollmentIds: input.enrollmentIds });
      if (!r.ok) throw r.error;
      return r.value;
    },
  };
}
