/**
 * academic -> people : port `AcademicQuery` de people (affectations d'enseignement : classe, nœud, période, offre ;
 * reconstruction de la projection des inscriptions).
 *
 * Fournit aussi à `people` la garde d'ouverture d'offre : tant qu'il ne trouve pas `academic`, toute création d'affectation
 * est refusée (échec fermé) — ce branchement la rend possible.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import {
  getAcademicPeriod,
  getClassroom,
  getCurriculumNode,
  getOffering,
  listClassrooms,
  listEnrollmentsByStudent,
  listNodesForClassroom,
  type AcademicDeps,
} from "../../modules/academic";
import type { AcademicQuery } from "../../modules/people";

export function createPeopleAcademicQuery(academic: AcademicDeps): AcademicQuery {
  return {
    async getClassroom(ctx: RequestContext, classroomId) {
      const r = await getClassroom(academic, ctx, classroomId);
      return r.ok ? { id: r.value.id, academicYearId: r.value.academicYearId, status: r.value.status } : null;
    },
    async getCurriculumNode(ctx, nodeId) {
      const r = await getCurriculumNode(academic, ctx, nodeId);
      return r.ok ? { id: r.value.id, isTransversal: r.value.isTransversal, isMandatory: r.value.isMandatory, subjectId: r.value.subjectId, label: r.value.label } : null;
    },
    async getAcademicPeriod(ctx, periodId) {
      const r = await getAcademicPeriod(academic, ctx, periodId);
      return r.ok ? { id: r.value.id, academicYearId: r.value.academicYearId } : null;
    },
    async listNodesForClassroom(ctx, classroomId, options) {
      const r = await listNodesForClassroom(academic, ctx, classroomId, options?.periodId ? { periodId: options.periodId } : {});
      return r.ok ? r.value.map((n) => ({ id: n.nodeId, isTransversal: n.isTransversal, isMandatory: n.isMandatory, subjectId: n.subjectId, label: n.label })) : [];
    },
    async listClassrooms(ctx, filter) {
      // Pagination d'academic (200 au plus par page) : on lit toutes les pages.
      const out: Array<{ id: string; academicYearId: string; status: string }> = [];
      for (let page = 1; page <= 100; page += 1) {
        const r = await listClassrooms(academic, ctx, { academicYearId: filter.academicYearId, ...(filter.programId ? { programId: filter.programId } : {}), page, pageSize: 200 });
        if (!r.ok) break;
        out.push(...r.value.items.map((c) => ({ id: c.id, academicYearId: c.academicYearId, status: c.status })));
        if (out.length >= r.value.total || r.value.items.length === 0) break;
      }
      return out;
    },
    async getOffering(ctx, offeringId) {
      const r = await getOffering(academic, ctx, offeringId);
      return r.ok ? { id: r.value.id, classroomId: r.value.classroomId, periodId: null, nodeIds: [r.value.curriculumNodeId] } : null;
    },
    async listEnrollmentsByStudent(ctx, studentId) {
      const r = await listEnrollmentsByStudent(academic, ctx, studentId);
      return r.ok
        ? r.value.map((e) => ({
            enrollmentId: e.id,
            studentId: e.studentId,
            academicYearId: e.academicYearId,
            institutionId: e.institutionId,
            classroomId: e.classroomId,
            status: e.status,
            mode: e.mode,
            fundingType: e.fundingType,
            registrationNumber: e.registrationNumber,
            enrolledOn: e.enrolledOn,
          }))
        : [];
    },
  };
}
