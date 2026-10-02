/**
 * academic -> schoollife : `EnrollmentPort` (inscription, inscriptions vivantes d'un élève, effectif d'une classe à une date) et
 * `PeriodPort` (périodes de l'année qui contiennent une date).
 *
 * Le niveau (`gradeLevelId`) vient de la classe de l'inscription : il choisit un barème de points de conduite propre au niveau.
 * Une inscription « active » est celle du statut `ACTIVE` (une inscription terminée n'accepte plus de vie scolaire).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getClassroom, getEnrollment, getRoster, listAcademicPeriods, listEnrollmentsByStudent, type AcademicDeps } from "../../modules/academic";
import type { EnrollmentInfo, EnrollmentPort, PeriodInfo, PeriodPort } from "../../modules/schoollife";

export function createSchoollifeEnrollmentPort(academic: AcademicDeps): EnrollmentPort {
  async function info(ctx: RequestContext, e: { id: string; studentId: string; classroomId: string; institutionId: string; academicYearId: string; status: string }): Promise<EnrollmentInfo> {
    const classroom = await getClassroom(academic, ctx, e.classroomId);
    return {
      enrollmentId: e.id,
      studentId: e.studentId,
      classroomId: e.classroomId,
      institutionId: e.institutionId,
      academicYearId: e.academicYearId,
      gradeLevelId: classroom.ok ? classroom.value.gradeLevelId : null,
      active: e.status === "ACTIVE",
    };
  }
  return {
    async getEnrollment(ctx, enrollmentId) {
      const r = await getEnrollment(academic, ctx, enrollmentId);
      return r.ok ? info(ctx, r.value) : null;
    },
    async listEnrollmentsOfStudent(ctx, studentId) {
      const r = await listEnrollmentsByStudent(academic, ctx, studentId);
      if (!r.ok) return [];
      const live = r.value.filter((e) => e.status === "ACTIVE").sort((a, b) => b.enrolledOn.localeCompare(a.enrolledOn));
      const out: EnrollmentInfo[] = [];
      for (const e of live) out.push(await info(ctx, e));
      return out;
    },
    async getRoster(ctx, classroomId, onDate) {
      const r = await getRoster(academic, ctx, classroomId, { onDate });
      return r.ok ? r.value.items.map((i) => ({ enrollmentId: i.enrollmentId, studentId: i.studentId })) : [];
    },
  };
}

export function createSchoollifePeriodPort(academic: AcademicDeps): PeriodPort {
  const toInfo = (p: { id: string; academicYearId: string; startsOn: string; endsOn: string }): PeriodInfo => ({ periodId: p.id, academicYearId: p.academicYearId, startsOn: p.startsOn, endsOn: p.endsOn });
  return {
    async listPeriodsCovering(ctx, query) {
      const r = await listAcademicPeriods(academic, ctx, query.academicYearId);
      return r.ok ? r.value.filter((p) => p.startsOn <= query.date && query.date <= p.endsOn).map(toInfo) : [];
    },
  };
}

