/**
 * academic -> higher : `CurriculumPort` (cycle, programme, UE) et `EnrollmentDirectory` (inscriptions d'un cycle, dernière
 * inscription, suivi d'une UE).
 *
 * IDENTIFIANTS (décision d'assemblage, documentée dans la spec 004 §7.5) :
 *  - le « nœud de cycle / programme » de higher est l'identifiant du PROGRAMME d'academic (`programs.id`, `is_cycle`) ;
 *  - le « nœud d'UE » de higher est la LIGNÉE de l'UE (`lineage_id`) : les nœuds de curriculum sont recréés à chaque
 *    année par le clonage, la lignée est ce qui reste identique d'une année à l'autre (capitalisation, prérequis).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import {
  getCycleFacts,
  getEnrollment,
  getLastEnrollmentInProgram,
  getUeFacts,
  hasAttendedUe,
  listCycleEnrollments,
  listProgramUe,
  listUeRegistrants,
  type AcademicDeps,
  type UeFacts,
} from "../../modules/academic";
import type { CurriculumPort as HigherCurriculumPort, EnrollmentDirectory as HigherEnrollmentDirectory, UeInfo as HigherUeInfo } from "../../modules/higher";

const toUe = (u: UeFacts): HigherUeInfo => ({ nodeId: u.lineageId, code: u.code, label: u.label, credits: Number(u.credits), programNodeId: u.programId, category: u.categoryCode });

export function createHigherCurriculumPort(academic: AcademicDeps): HigherCurriculumPort {
  return {
    async getNode(ctx: RequestContext, nodeId) {
      const r = await getCycleFacts(academic, ctx, nodeId);
      return r.ok ? { nodeId: r.value.programId, code: r.value.code, label: r.value.label, isCycle: r.value.isCycle, isProgram: true } : null;
    },
    async getUe(ctx, ueNodeId) {
      const r = await getUeFacts(academic, ctx, ueNodeId);
      return r.ok && r.value ? toUe(r.value) : null;
    },
    async listCycleUe(ctx, cycleNodeId) {
      const r = await listProgramUe(academic, ctx, cycleNodeId);
      return r.ok ? r.value.map(toUe) : [];
    },
    async listProgramUe(ctx, programNodeId) {
      const r = await listProgramUe(academic, ctx, programNodeId);
      return r.ok ? r.value.map(toUe) : [];
    },
  };
}

export function createHigherEnrollmentDirectory(academic: AcademicDeps): HigherEnrollmentDirectory {
  return {
    async listCycleEnrollments(ctx, cycleNodeId) {
      const r = await listCycleEnrollments(academic, ctx, cycleNodeId);
      return r.ok ? r.value.map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, classroomId: e.classroomId, academicYearId: e.academicYearId })) : [];
    },
    async getLastEnrollment(ctx, input) {
      const r = await getLastEnrollmentInProgram(academic, ctx, { studentId: input.studentId, programId: input.nodeId });
      return r.ok && r.value ? { enrollmentId: r.value.enrollmentId, academicYearId: r.value.academicYearId, academicYearLabel: r.value.academicYearLabel || r.value.academicYearCode } : null;
    },
    async getEnrollment(ctx, enrollmentId) {
      const r = await getEnrollment(academic, ctx, enrollmentId);
      return r.ok ? { enrollmentId: r.value.id, studentId: r.value.studentId, classroomId: r.value.classroomId, academicYearId: r.value.academicYearId, active: r.value.status === "ACTIVE" } : null;
    },
    async listUeRegistrants(ctx, ueNodeId) {
      const r = await listUeRegistrants(academic, ctx, ueNodeId);
      return r.ok ? r.value : [];
    },
    async hasAttendedUe(ctx, input) {
      const r = await hasAttendedUe(academic, ctx, { studentId: input.studentId, lineageId: input.ueNodeId });
      return r.ok && r.value;
    },
  };
}
