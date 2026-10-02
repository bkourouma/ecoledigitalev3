/**
 * academic (+ people, tenancy) -> councils : `AcademicPort` (classe, période, effectif nommé et daté, inscription, nom de l'établissement) et
 * `OutcomePort` (issue d'inscription de fin d'année, redirection vers une autre série, changement de classe en cours d'année).
 *
 * L'effectif est celui d'academic (`getRoster`, inscriptions qui ouvrent la scolarité) ; les noms viennent de `people` (jamais d'academic) ;
 * le financement et le drapeau « redoublant » sont des données de l'inscription, recopiées sans interprétation. Une classe est « active »
 * quand son statut est `ACTIVE`. Les écritures passent par les cas d'usage PUBLICS d'academic (historique et événements compris) dans la
 * transaction du module appelant : un refus d'academic est renvoyé tel quel et annule l'opération.
 * L'issue de redirection est celle des DONNÉES d'academic (`enrollment-outcomes`, nature `REDIRECT`) : aucun code n'est supposé ici.
 */
import type { Clock, RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import {
  getAcademicPeriod,
  getClassroom,
  getClassroomFacts,
  getEnrollment,
  getRoster,
  listEnrollmentsByStudent,
  listReference,
  recordEnrollmentOutcome,
  transferEnrollment,
  type AcademicDeps,
} from "../../modules/academic";
import { getStudentsByIds, type PeopleDeps } from "../../modules/people";
import { listInstitutions } from "../../modules/tenancy";
import { councilsPortUnavailable, type CouncilsAcademicPort, type CouncilsOutcomePort, type CouncilsEnrollmentInfo } from "../../modules/councils";

function must<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

export function createCouncilsAcademicPort(input: { academic: AcademicDeps; people: PeopleDeps; tenantDb: TenantDb; clock: Clock }): CouncilsAcademicPort {
  const { academic, people, tenantDb, clock } = input;

  async function enrollmentInfo(ctx: RequestContext, e: { id: string; studentId: string; classroomId: string; institutionId: string; academicYearId: string; status: string }): Promise<CouncilsEnrollmentInfo> {
    const classroom = await getClassroom(academic, ctx, e.classroomId);
    return {
      enrollmentId: e.id,
      studentId: e.studentId,
      classroomId: e.classroomId,
      institutionId: e.institutionId,
      academicYearId: e.academicYearId,
      programId: classroom.ok ? classroom.value.programId : null,
      gradeLevelId: classroom.ok ? classroom.value.gradeLevelId : null,
      active: e.status === "ACTIVE",
    };
  }

  return {
    async getClassroom(ctx, classroomId) {
      const c = await getClassroom(academic, ctx, classroomId);
      if (!c.ok) return null;
      const facts = await getClassroomFacts(academic, ctx, classroomId);
      return {
        classroomId: c.value.id,
        name: c.value.name,
        institutionId: c.value.institutionId,
        academicYearId: c.value.academicYearId,
        gradeLevelId: c.value.gradeLevelId,
        gradeLevelCode: facts.ok ? facts.value.gradeLevelCode || null : null,
        programId: c.value.programId,
        active: c.value.status === "ACTIVE",
      };
    },
    async getPeriod(ctx, periodId) {
      const p = await getAcademicPeriod(academic, ctx, periodId);
      return p.ok ? { periodId: p.value.id, academicYearId: p.value.academicYearId, label: p.value.label, startsOn: p.value.startsOn, endsOn: p.value.endsOn } : null;
    },
    async getRoster(ctx, classroomId, onDate) {
      const roster = await getRoster(academic, ctx, classroomId, { onDate });
      if (!roster.ok) return [];
      const names = new Map<string, string>();
      const ids = roster.value.items.map((i) => i.studentId);
      // `getStudentsByIds` de people plafonne les lots (500) ; appels SÉQUENTIELS (connexion partagée de la transaction appelante).
      for (let i = 0; i < ids.length; i += 500) {
        const r = await getStudentsByIds(people, ctx, ids.slice(i, i + 500));
        if (r.ok) for (const s of r.value) names.set(s.id, s.displayName);
      }
      return roster.value.items.map((i) => ({ enrollmentId: i.enrollmentId, studentId: i.studentId, displayName: names.get(i.studentId) ?? null, isRepeating: i.isRepeating, fundingType: i.fundingType ?? null, stateAssigned: i.fundingType === "STATE_ASSIGNED" }));
    },
    async getEnrollment(ctx, enrollmentId) {
      const r = await getEnrollment(academic, ctx, enrollmentId);
      return r.ok ? enrollmentInfo(ctx, r.value) : null;
    },
    async getCurrentEnrollmentOfStudent(ctx, studentId) {
      const r = await listEnrollmentsByStudent(academic, ctx, studentId);
      if (!r.ok) return null;
      const live = r.value.filter((e) => e.status === "ACTIVE").sort((a, b) => b.enrolledOn.localeCompare(a.enrolledOn))[0];
      return live ? enrollmentInfo(ctx, live) : null;
    },
    async getInstitutionName(ctx, institutionId) {
      const r = await listInstitutions({ db: tenantDb, clock }, ctx);
      return r.ok ? (r.value.find((i) => i.id === institutionId)?.name ?? null) : null;
    },
  };
}

export function createCouncilsOutcomePort(academic: AcademicDeps): CouncilsOutcomePort {
  return {
    async recordOutcome(ctx, { enrollmentId, outcomeCode, targetProgramId, targetGradeLevelId, decisionRef }) {
      must(await recordEnrollmentOutcome(academic, ctx, enrollmentId, { outcomeCode, decisionRef, ...(targetProgramId ? { targetProgramId } : {}), ...(targetGradeLevelId ? { targetGradeLevelId } : {}) }));
    },
    async recordRedirect(ctx, { enrollmentId, targetProgramId, targetGradeLevelId, decisionRef }) {
      const outcomes = must(await listReference(academic, ctx, "enrollment-outcomes"));
      const redirect = outcomes.find((o) => o.kind === "REDIRECT" && o.active);
      if (!redirect) {
        throw councilsPortUnavailable("academic (issue d'inscription de nature redirection)");
      }
      must(await recordEnrollmentOutcome(academic, ctx, enrollmentId, { outcomeCode: redirect.code, decisionRef, targetProgramId, targetGradeLevelId }));
    },
    async transferEnrollment(ctx, { enrollmentId, toClassroomId, effectiveOn, reason }) {
      const r = must(await transferEnrollment(academic, ctx, enrollmentId, { toClassroomId, ...(effectiveOn ? { effectiveOn } : {}), reason }));
      return { enrollmentId: r.id };
    },
  };
}
