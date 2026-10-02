/**
 * academic (+ people, tenancy) -> primary_school : `ClassroomPort` (classe, effectif nommé, inscription, périodes d'enseignement,
 * année, établissements), `PeriodStatePort` (état EFFECTIF d'une classe × période) et `OutcomePort` (issue d'inscription).
 *
 * Effectif : celui d'academic (`getRoster`), daté du jour borné par la fin de l'année (une année terminée se relit au dernier jour
 * de l'année) ; les noms viennent de `people` (jamais d'academic). Périodes : seules les périodes d'ENSEIGNEMENT de premier niveau
 * (type de période `TEACHING_PERIOD`, sans parent), par date puis rang — pas les sessions d'examen. Verrou : `gradingIsClosed`
 * d'academic (notation arrêtée ou période close) ; un état illisible = verrouillé (échec fermé).
 */
import { abidjanDate, type RequestContext } from "@ecoledigitale/kernel";
import {
  getAcademicYear,
  getClassroomFacts,
  getEffectivePeriodState,
  getEnrollment,
  getRoster,
  gradingIsClosed,
  listAcademicPeriods,
  listClassrooms,
  listReference,
  recordEnrollmentOutcome,
  type AcademicDeps,
} from "../../modules/academic";
import { getStudentsByIds, type PeopleDeps } from "../../modules/people";
import { listInstitutions } from "../../modules/tenancy";
import type { PrimaryClassroomInfo as ClassroomInfo, PrimaryClassroomPort as ClassroomPort, OutcomePort, PrimaryPeriodInfo as PeriodInfo, PeriodStatePort } from "../../modules/primary_school";
import type { TenantDb } from "@ecoledigitale/database";
import type { Clock } from "@ecoledigitale/kernel";

function must<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

/** Périodes d'ENSEIGNEMENT de premier niveau d'une année, triées par date de début puis rang. */
async function teachingPeriods(academic: AcademicDeps, ctx: RequestContext, yearId: string): Promise<Array<PeriodInfo & { startsOn: string }>> {
  const r = await listAcademicPeriods(academic, ctx, yearId);
  if (!r.ok) return [];
  const types = await listReference(academic, ctx, "period-types");
  const teaching = new Set((types.ok ? types.value : []).filter((t) => t.kind === "TEACHING_PERIOD").map((t) => t.code));
  return r.value
    .filter((p) => p.parentPeriodId === null && (teaching.size === 0 || teaching.has(p.periodTypeCode)))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.ordinal - b.ordinal || a.id.localeCompare(b.id))
    .map((p, i) => ({ id: p.id, label: p.label, ordinal: i + 1, startsOn: p.startsOn }));
}

export function createPrimaryClassroomPort(input: { academic: AcademicDeps; people: PeopleDeps; tenantDb: TenantDb; clock: Clock }): ClassroomPort {
  const { academic, people, tenantDb, clock } = input;
  const infoOf = (f: { classroomId: string; name: string; institutionId: string; academicYearId: string; gradeLevelCode: string; educationLevelCode: string; status: string }): ClassroomInfo => ({
    id: f.classroomId,
    name: f.name,
    institutionId: f.institutionId,
    academicYearId: f.academicYearId,
    gradeLevelCode: f.gradeLevelCode || null,
    educationLevelCode: f.educationLevelCode || null,
    status: f.status,
  });
  return {
    async getClassroom(ctx, classroomId) {
      const r = await getClassroomFacts(academic, ctx, classroomId);
      return r.ok ? infoOf(r.value) : null;
    },
    async listRoster(ctx, classroomId) {
      const facts = await getClassroomFacts(academic, ctx, classroomId);
      if (!facts.ok) return [];
      const today = abidjanDate(clock.now());
      const onDate = today > facts.value.academicYearEndsOn ? facts.value.academicYearEndsOn : today;
      const roster = await getRoster(academic, ctx, classroomId, { onDate });
      if (!roster.ok) return [];
      const names = new Map<string, string>();
      const studentIds = roster.value.items.map((i) => i.studentId);
      for (let i = 0; i < studentIds.length; i += 500) {
        const r = await getStudentsByIds(people, ctx, studentIds.slice(i, i + 500));
        if (r.ok) for (const s of r.value) names.set(s.id, s.displayName);
      }
      return roster.value.items.map((i) => ({ enrollmentId: i.enrollmentId, studentId: i.studentId, displayName: names.get(i.studentId) ?? null, isRepeating: i.isRepeating }));
    },
    async getEnrollment(ctx, enrollmentId) {
      const e = await getEnrollment(academic, ctx, enrollmentId);
      if (!e.ok) return null;
      const facts = await getClassroomFacts(academic, ctx, e.value.classroomId);
      return {
        id: e.value.id,
        classroomId: e.value.classroomId,
        studentId: e.value.studentId,
        academicYearId: e.value.academicYearId,
        gradeLevelCode: facts.ok ? facts.value.gradeLevelCode || null : null,
        status: e.value.status,
        isRepeating: e.value.isRepeating,
      };
    },
    async listPeriods(ctx, academicYearId) {
      return (await teachingPeriods(academic, ctx, academicYearId)).map(({ id, label, ordinal }) => ({ id, label, ordinal }));
    },
    async getYear(ctx, academicYearId) {
      const r = await getAcademicYear(academic, ctx, academicYearId);
      if (!r.ok) return null;
      return { id: r.value.id, institutionId: r.value.institutionId, label: r.value.label ?? null, status: r.value.status, closed: r.value.status === "CLOSED" || r.value.status === "ARCHIVED" };
    },
    async listClassrooms(ctx, filter) {
      const out: ClassroomInfo[] = [];
      // Sans année demandée : les classes des années EN COURS (ouvertes) ; l'historique se demande par année explicite.
      const openYears = new Map<string, boolean>();
      const yearIsOpen = async (yearId: string): Promise<boolean> => {
        if (!openYears.has(yearId)) {
          const y = await getAcademicYear(academic, ctx, yearId);
          openYears.set(yearId, y.ok && y.value.status === "OPEN");
        }
        return openYears.get(yearId) === true;
      };
      for (let page = 1; page <= 50; page += 1) {
        const r = await listClassrooms(academic, ctx, { ...(filter.academicYearId ? { academicYearId: filter.academicYearId } : {}), ...(filter.institutionId ? { institutionId: filter.institutionId } : {}), page, pageSize: 200 });
        if (!r.ok) break;
        for (const c of r.value.items) {
          if (!filter.academicYearId && !(await yearIsOpen(c.academicYearId))) continue;
          const facts = await getClassroomFacts(academic, ctx, c.id);
          // Seules les classes du pack Primary (maternelle, primaire) relèvent de ce module.
          if (facts.ok && (facts.value.pack === "PRIMARY" || facts.value.educationLevelCode === "PRIMARY" || facts.value.educationLevelCode === "PRESCHOOL")) out.push(infoOf(facts.value));
        }
        if (page * 200 >= r.value.total) break;
      }
      return out;
    },
    async listInstitutions(ctx) {
      const r = await listInstitutions({ db: tenantDb, clock }, ctx);
      if (!r.ok) return [];
      return r.value.filter((i) => i.pack === "PRIMARY").map((i) => ({ id: i.id, name: i.name ?? null }));
    },
  };
}

export function createPrimaryPeriodStatePort(academic: AcademicDeps): PeriodStatePort {
  return {
    async getState(ctx, { classroomId, periodId }) {
      const r = await getEffectivePeriodState(academic, ctx, { classroomId, periodId });
      // Échec fermé : un état illisible verrouille la saisie.
      if (!r.ok) return { locked: true, state: "UNKNOWN" };
      return { locked: gradingIsClosed(r.value.state), state: r.value.state };
    },
    async allPeriodsClosed(ctx, { classroomId, academicYearId }) {
      const periods = await teachingPeriods(academic, ctx, academicYearId);
      if (periods.length === 0) return false;
      for (const p of periods) {
        const r = await getEffectivePeriodState(academic, ctx, { classroomId, periodId: p.id });
        if (!r.ok || r.value.state !== "CLOSED") return false;
      }
      return true;
    },
  };
}

export function createPrimaryOutcomePort(academic: AcademicDeps): OutcomePort {
  return {
    async recordOutcome(ctx, { enrollmentId, outcomeCode, decisionRef }) {
      must(await recordEnrollmentOutcome(academic, ctx, enrollmentId, { outcomeCode, ...(decisionRef ? { decisionRef } : {}) } as never));
    },
  };
}
