/**
 * academic -> scheduling : port `AcademicQuery` (classes, offres, nœuds, périodes, placements d'un apprenant).
 *
 *  - une offre « à la carte » est celle d'une classe de type COHORTE (la classe n'est pas réunie) ;
 *  - le statut d'offre terminé d'academic (`COMPLETED`) est `CLOSED` pour scheduling ;
 *  - le volume horaire d'un nœud (heures décimales) est converti en MINUTES ENTIÈRES (arrondi au plus proche).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import {
  getAcademicPeriod,
  getClassroom,
  getCurriculumNode,
  getEnrollment,
  getOffering,
  listAcademicYears,
  listStudentPlacements,
  resolvePeriodForDate,
  type AcademicDeps,
} from "../../modules/academic";
import type { AcademicQuery, OfferingStatus } from "../../modules/scheduling";

const OFFERING_STATUS: Readonly<Record<string, OfferingStatus>> = Object.freeze({
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  FULL: "FULL",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "CLOSED",
  CANCELLED: "CANCELLED",
});

/** Heures décimales (chaîne canonique) -> minutes entières ; `null` si absent ou illisible. */
export function hoursToMinutes(hours: string | null): number | null {
  if (hours === null) return null;
  const n = Number(hours);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

export function createSchedulingAcademicQuery(academic: AcademicDeps): AcademicQuery {
  return {
    async getClassroom(ctx: RequestContext, id) {
      const r = await getClassroom(academic, ctx, id);
      if (!r.ok) return null;
      const c = r.value;
      return { id: c.id, institutionId: c.institutionId, campusId: c.campusId, academicYearId: c.academicYearId, name: c.name, headcount: c.enrolledCount };
    },
    async getOffering(ctx, id) {
      const o = await getOffering(academic, ctx, id);
      if (!o.ok) return null;
      const c = await getClassroom(academic, ctx, o.value.classroomId);
      return {
        id: o.value.id,
        classroomId: o.value.classroomId,
        curriculumNodeId: o.value.curriculumNodeId,
        status: OFFERING_STATUS[o.value.status] ?? "DRAFT",
        startsOn: o.value.startsOn,
        endsOn: o.value.endsOn,
        label: o.value.label,
        aLaCarte: c.ok && c.value.kind === "COHORT",
        headcount: o.value.heldPlaces,
      };
    },
    async getCurriculumNode(ctx, id) {
      const r = await getCurriculumNode(academic, ctx, id);
      return r.ok ? { id: r.value.id, label: r.value.label, hoursTotalMinutes: hoursToMinutes(r.value.hoursTotal), subjectId: r.value.subjectId } : null;
    },
    async getPeriod(ctx, id) {
      const r = await getAcademicPeriod(academic, ctx, id);
      return r.ok ? { id: r.value.id, academicYearId: r.value.academicYearId, startsOn: r.value.startsOn, endsOn: r.value.endsOn } : null;
    },
    async resolvePeriodForDate(ctx, institutionId, date) {
      const years = await listAcademicYears(academic, ctx, { institutionId });
      const year = years.ok ? years.value.find((y) => y.startsOn <= date && date <= y.endsOn) : undefined;
      if (!year) return null;
      const period = await resolvePeriodForDate(academic, ctx, { institutionId, date });
      return { academicYearId: year.id, periodId: period.ok && period.value ? period.value.id : null };
    },
    async listStudentPlacements(ctx, studentId) {
      const r = await listStudentPlacements(academic, ctx, studentId);
      return r.ok ? r.value : { classroomIds: [], offeringIds: [] };
    },
    async getEnrollmentStudentId(ctx, enrollmentId) {
      const r = await getEnrollment(academic, ctx, enrollmentId);
      return r.ok ? r.value.studentId : null;
    },
  };
}
