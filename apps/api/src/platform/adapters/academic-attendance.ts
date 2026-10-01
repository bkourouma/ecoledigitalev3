/**
 * academic -> attendance : `EnrollmentRosterPort` (classe, effectif à une date, inscription, inscriptions d'un élève) et
 * `PeriodPort` (périodes, y compris parentes, qui contiennent une date).
 *
 * Les inscriptions « actives » sont celles du statut `ACTIVE` (une inscription terminée ne prend plus d'appel) ; l'effectif
 * à une date est celui d'academic (`getRoster` : placement de la classe couvrant la date, statut qui ouvre la scolarité,
 * sélection confirmée pour une séance à la carte).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import {
  getAcademicPeriod,
  getAcademicYear,
  getClassroomFacts,
  getEnrollment,
  getOffering,
  getRoster,
  listAcademicPeriods,
  listEnrollmentsByStudent,
  type AcademicDeps,
} from "../../modules/academic";
import type { EnrollmentInfo, EnrollmentRosterPort, PeriodInfo, PeriodPort, RosterEntry } from "../../modules/attendance";

export function createAttendanceRosterPort(academic: AcademicDeps): EnrollmentRosterPort {
  async function enrollmentInfo(ctx: RequestContext, e: { id: string; studentId: string; classroomId: string; institutionId: string; academicYearId: string; status: string }): Promise<EnrollmentInfo> {
    const year = await getAcademicYear(academic, ctx, e.academicYearId);
    return {
      enrollmentId: e.id,
      studentId: e.studentId,
      classroomId: e.classroomId,
      institutionId: e.institutionId,
      academicYearId: e.academicYearId,
      active: e.status === "ACTIVE",
      academicYearStart: year.ok ? year.value.startsOn : null,
      academicYearEnd: year.ok ? year.value.endsOn : null,
    };
  }
  return {
    async getClassroom(ctx, classroomId) {
      const r = await getClassroomFacts(academic, ctx, classroomId);
      if (!r.ok) return null;
      return {
        classroomId: r.value.classroomId,
        institutionId: r.value.institutionId,
        academicYearId: r.value.academicYearId,
        educationLevelCode: r.value.educationLevelCode || null,
        active: r.value.status === "ACTIVE",
      };
    },
    async getRoster(ctx, query): Promise<readonly RosterEntry[]> {
      let nodeId = query.curriculumNodeId ?? null;
      if (!nodeId && query.offeringId) {
        const offering = await getOffering(academic, ctx, query.offeringId);
        if (offering.ok) nodeId = offering.value.curriculumNodeId;
      }
      const r = await getRoster(academic, ctx, query.classroomId, { onDate: query.onDate, nodeId });
      return r.ok ? r.value.items.map((i) => ({ enrollmentId: i.enrollmentId, studentId: i.studentId })) : [];
    },
    async getEnrollment(ctx, enrollmentId) {
      const r = await getEnrollment(academic, ctx, enrollmentId);
      return r.ok ? enrollmentInfo(ctx, r.value) : null;
    },
    async findEnrollmentsOfStudent(ctx, studentId, window): Promise<readonly EnrollmentInfo[]> {
      const r = await listEnrollmentsByStudent(academic, ctx, studentId);
      if (!r.ok) return [];
      const overlapping = r.value.filter((e) => ["ACTIVE", "COMPLETED"].includes(e.status) && e.enrolledOn <= window.to && (e.endedOn === null || e.endedOn >= window.from));
      const out: EnrollmentInfo[] = [];
      for (const e of overlapping) out.push(await enrollmentInfo(ctx, e));
      return out;
    },
  };
}

export function createAttendancePeriodPort(academic: AcademicDeps): PeriodPort {
  const toInfo = (p: { id: string; academicYearId: string; startsOn: string; endsOn: string; parentPeriodId: string | null }): PeriodInfo => ({
    periodId: p.id,
    academicYearId: p.academicYearId,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    parentPeriodId: p.parentPeriodId,
  });
  return {
    async getPeriod(ctx, periodId) {
      const r = await getAcademicPeriod(academic, ctx, periodId);
      return r.ok ? toInfo(r.value) : null;
    },
    async listPeriodsCovering(ctx, query): Promise<readonly PeriodInfo[]> {
      const r = await listAcademicPeriods(academic, ctx, query.academicYearId);
      return r.ok ? r.value.filter((p) => p.startsOn <= query.date && query.date <= p.endsOn).map(toInfo) : [];
    },
  };
}
