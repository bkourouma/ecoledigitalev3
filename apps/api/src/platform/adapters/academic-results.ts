/**
 * academic -> results : `CurriculumPort` (structure de calcul d'une classe × période) et `RosterPort` (inscriptions d'une classe).
 *
 * Traduction PURE des faits publiés par `academic` (`getResultsStructure`, `listClassroomEnrollments`) vers les formes du
 * port de `results`. Rien n'est deviné : sans contrat de calcul (programme ni cycle d'enseignement), la structure est
 * absente (`null`) et `results` échoue fermé ; le « second semestre » et l'examen terminal viennent des DONNÉES
 * (rang de période, attribut du niveau), jamais d'un libellé.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getResultsStructure, listClassroomEnrollments, type AcademicDeps, type ResultsStructure } from "../../modules/academic";
import type { ClassStructure, CurriculumPort, ResultsRosterPort, ResultsRosterEntry } from "../../modules/results";

/** Traduit les faits d'academic en structure de calcul ; `null` si le contrat de calcul n'est pas défini. */
export function toClassStructure(f: ResultsStructure): ClassStructure | null {
  if (!f.calculationContract) return null;
  const toPeriod = (p: ResultsStructure["period"]): ClassStructure["period"] => ({
    id: p.id,
    rankInYear: p.rankInYear,
    countInYear: p.countInYear,
    isSecondSemester: p.isLast,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
  });
  return {
    classroomId: f.classroomId,
    academicYearId: f.academicYearId,
    institutionId: f.institutionId,
    // Niveau de la classe : clé des liaisons de règles « par niveau » (le niveau le plus fin).
    levelCode: f.gradeLevelCode,
    contractId: f.calculationContract,
    period: toPeriod(f.period),
    firstPeriodId: f.firstPeriodId,
    terminalExamRequired: f.terminalExamRequired,
    nodes: f.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      kind: n.kind,
      code: n.code,
      label: n.label,
      ordinal: n.position,
      credits: n.credits,
      coefficient: n.coefficient,
      gradingMode: n.gradingMode,
      resitAllowed: n.resitAllowed,
      countsInAverage: n.countsInAverage,
      sectionKey: n.sectionKey,
      category: n.categoryCode,
    })),
    yearPeriods: f.yearPeriods.map(toPeriod),
  };
}

export function createResultsCurriculumPort(academic: AcademicDeps): CurriculumPort {
  return {
    async getStructure(ctx: RequestContext, input) {
      const r = await getResultsStructure(academic, ctx, { classroomId: input.classroomId, periodId: input.academicPeriodId });
      // Classe ou période hors périmètre / inconnue : pas de structure (results répond « curriculum indisponible »).
      return r.ok ? toClassStructure(r.value) : null;
    },
  };
}

export function createResultsRosterPort(academic: AcademicDeps): ResultsRosterPort {
  return {
    async listEnrollments(ctx: RequestContext, classroomId: string): Promise<readonly ResultsRosterEntry[]> {
      const r = await listClassroomEnrollments(academic, ctx, classroomId);
      if (!r.ok) return [];
      return r.value.map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, classroomId: e.classroomId, active: e.active }));
    },
  };
}
