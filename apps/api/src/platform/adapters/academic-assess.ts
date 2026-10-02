/**
 * academic -> assess : `RosterPort`, `PeriodPort`, `CurriculumPort` (rattrapage autorisé, nœud suivi par la classe).
 *
 * `resitAllowed` est une DONNÉE du curriculum (migration 0706) : plus aucune session 2 déduite d'un libellé.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getAcademicPeriod, getClassroom, getCurriculumNode, listClassroomEnrollments, type AcademicDeps } from "../../modules/academic";
import type {
  CurriculumPort as AssessCurriculumPort,
  PeriodPort as AssessPeriodPort,
  RosterEntry as AssessRosterEntry,
  RosterPort as AssessRosterPort,
} from "../../modules/assess";

export function createAssessRosterPort(academic: AcademicDeps): AssessRosterPort {
  return {
    async getClassroom(ctx: RequestContext, classroomId) {
      const r = await getClassroom(academic, ctx, classroomId);
      return r.ok ? { id: r.value.id, academicYearId: r.value.academicYearId, institutionId: r.value.institutionId } : null;
    },
    async listEnrollments(ctx: RequestContext, classroomId): Promise<readonly AssessRosterEntry[]> {
      const r = await listClassroomEnrollments(academic, ctx, classroomId);
      return r.ok ? r.value.map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, classroomId: e.classroomId, active: e.active })) : [];
    },
  };
}

export function createAssessPeriodPort(academic: AcademicDeps): AssessPeriodPort {
  return {
    async getPeriod(ctx: RequestContext, periodId) {
      const r = await getAcademicPeriod(academic, ctx, periodId);
      return r.ok ? { id: r.value.id, academicYearId: r.value.academicYearId } : null;
    },
  };
}

export function createAssessCurriculumPort(academic: AcademicDeps): AssessCurriculumPort {
  return {
    async getNode(ctx: RequestContext, nodeId) {
      const r = await getCurriculumNode(academic, ctx, nodeId);
      return r.ok ? { id: r.value.id, resitAllowed: r.value.resitAllowed } : null;
    },
    /** Le nœud fait partie de la version de curriculum de la classe (donc du programme suivi). */
    async nodeInClassroom(ctx: RequestContext, nodeId, classroomId) {
      const node = await getCurriculumNode(academic, ctx, nodeId);
      const classroom = await getClassroom(academic, ctx, classroomId);
      return node.ok && classroom.ok && classroom.value.curriculumVersionId !== null && node.value.versionId === classroom.value.curriculumVersionId;
    },
  };
}
