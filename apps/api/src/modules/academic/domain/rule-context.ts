/**
 * Faits fournis au moteur de règles (`getRuleContext`, D-29) : cycle, niveau et rang, `isFinal`, type et rang de
 * période, famille de programme, nœuds avec coefficients et crédits en chaînes décimales exactes.
 *
 * AUCUN traitement de nom n'est nécessaire (fin des `/licence\s*[12]\b/i`, « SEMESTRE 2 », « BTS 2 ») : tout est
 * une colonne typée. Les RuleSets (spec 012) consomment ces faits ; academic n'en tire aucune décision.
 */
import type { AcademicPack, AcademicRuleContext } from "@ecoledigitale/contracts/src/v2/academic";
import { periodRankInYear } from "./calendar";
import type { FollowedNode } from "./curriculum";
import type { AcademicPeriod, Enrollment, EducationLevel, GradeLevel, PeriodType, Program } from "./records";

export interface RuleContextInput {
  enrollment: Pick<Enrollment, "id" | "studentId" | "institutionId" | "academicYearId" | "classroomId" | "fundingType" | "isRepeating">;
  pack: AcademicPack | null;
  educationLevel: Pick<EducationLevel, "code" | "ordinal">;
  gradeLevel: Pick<GradeLevel, "code" | "ordinal" | "isFinal"> & { nextGradeLevelCode: string | null };
  program: Pick<Program, "code" | "kindCode" | "domainCode"> & { parentProgramCode: string | null };
  period: {
    period: AcademicPeriod;
    allPeriodsOfYear: readonly AcademicPeriod[];
    periodTypes: readonly Pick<PeriodType, "code" | "kind">[];
    parentTypeCode: string | null;
    effectiveState: AcademicPeriod["status"];
  } | null;
  nodes: readonly FollowedNode[];
}

export function buildRuleContext(input: RuleContextInput): AcademicRuleContext {
  const period = input.period;
  let periodFacts: AcademicRuleContext["period"] = null;
  if (period) {
    const { rank, count, isLast } = periodRankInYear(period.period, period.allPeriodsOfYear);
    periodFacts = {
      id: period.period.id,
      typeCode: period.period.periodTypeCode,
      kind: period.periodTypes.find((t) => t.code === period.period.periodTypeCode)?.kind ?? null,
      ordinal: period.period.ordinal,
      rankInYear: rank,
      siblingsOfType: count,
      parentTypeCode: period.parentTypeCode,
      isLastOfType: isLast,
      startsOn: period.period.startsOn,
      endsOn: period.period.endsOn,
      state: period.effectiveState,
    };
  }
  return {
    enrollmentId: input.enrollment.id,
    studentId: input.enrollment.studentId,
    institutionId: input.enrollment.institutionId,
    academicYearId: input.enrollment.academicYearId,
    classroomId: input.enrollment.classroomId,
    pack: input.pack,
    educationLevel: { code: input.educationLevel.code, ordinal: input.educationLevel.ordinal },
    gradeLevel: { code: input.gradeLevel.code, ordinal: input.gradeLevel.ordinal, isFinal: input.gradeLevel.isFinal, nextGradeLevelCode: input.gradeLevel.nextGradeLevelCode },
    program: { code: input.program.code, kindCode: input.program.kindCode, domainCode: input.program.domainCode, parentProgramCode: input.program.parentProgramCode },
    period: periodFacts,
    fundingType: input.enrollment.fundingType,
    isRepeating: input.enrollment.isRepeating,
    nodes: input.nodes.map((f) => ({
      nodeId: f.node.id,
      lineageId: f.node.lineageId,
      nodeTypeCode: f.node.nodeTypeCode,
      parentId: f.node.parentId,
      code: f.node.code,
      subjectId: f.node.subjectId,
      coefficient: f.node.coefficient,
      credits: f.node.credits,
      isMandatory: f.node.isMandatory,
      isTransversal: f.node.isTransversal,
      categoryCode: f.node.categoryCode,
      periodTypeCode: f.node.periodTypeCode,
      periodOrdinal: f.node.periodOrdinal,
    })),
  };
}
