/**
 * academic + people + tenancy + iam -> examinations :
 *  - `StudentDirectory` : inscription d'un élève (établissement, niveau de la classe, en cours ?), élèves d'une classe, état civil
 *    (copié et FIGÉ par `examinations` à l'inscription à l'examen) ;
 *  - `EligibilityFactsPort` : faits d'éligibilité fournis par `academic.getEligibilityFacts` (interface ATTENDUE, livrée par le
 *    propriétaire d'`academic`) et âge calculé depuis la date de naissance de `people` à la date de référence de la session ;
 *  - `InstitutionDirectory` : existence et nom de l'établissement (`tenancy.getInstitution`) ;
 *  - `FamilyLinks` : liens de tutelle relus à CHAQUE requête (`people`/`iam`), jamais mis en cache.
 *
 * ÉCHEC FERMÉ : si `academic.getEligibilityFacts` n'est pas (encore) exposé, ou répond autre chose que ce qui est attendu, l'adaptateur
 * rend `examinations.port_unavailable` en citant l'interface attendue ; il n'invente aucun fait et ne modifie pas `academic`.
 * Appels SÉQUENTIELS (connexion partagée dans une transaction).
 *
 * Interface attendue d'`academic` (README d'`examinations`) :
 *   getEligibilityFacts(deps: AcademicDeps, ctx: RequestContext, enrollmentId: string)
 *     -> Result<{ gradeLevelCode: string | null; repeatedYears?: number }, AppError>
 */
import { err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import * as academicApi from "../../modules/academic";
import { getClassroomFacts, getEnrollment, listClassroomEnrollments, opensSchooling } from "../../modules/academic";
import { getStudent } from "../../modules/people";
import { getInstitution } from "../../modules/tenancy";
import { ExamCode } from "../../modules/examinations";
import type { EligibilityFacts, EligibilityFactsPort, FamilyLinks, InstitutionDirectory, StudentDirectory } from "../../modules/examinations";
import type { AdapterKit } from "./kit";
import type { PeopleLookups } from "./people-lookups";

const EXPECTED_ELIGIBILITY_FACTS = "academic.getEligibilityFacts(deps, ctx, enrollmentId) -> Result<{ gradeLevelCode, repeatsInCycle, ... }>";

const unavailable = (detail?: string): AppError =>
  new InternalError("Le service « faits d'éligibilité » n'est pas disponible : opération refusée.", {
    code: ExamCode.PORT_UNAVAILABLE,
    details: { port: "eligibility", expected: EXPECTED_ELIGIBILITY_FACTS, ...(detail ? { detail } : {}) },
  });

export function createExaminationsStudentDirectory(kit: Pick<AdapterKit, "academic" | "people">): StudentDirectory {
  return {
    async getEnrollment(ctx, enrollmentId) {
      const e = await getEnrollment(kit.academic, ctx, enrollmentId);
      if (!e.ok) return null;
      const c = await getClassroomFacts(kit.academic, ctx, e.value.classroomId);
      return {
        enrollmentId: e.value.id,
        studentId: e.value.studentId,
        institutionId: e.value.institutionId,
        classroomId: e.value.classroomId,
        gradeLevelCode: c.ok ? c.value.gradeLevelCode : null,
        academicYearId: e.value.academicYearId,
        active: opensSchooling(e.value.status) && e.value.endedOn === null,
      };
    },

    async getClassroomRoster(ctx, classroomId) {
      const c = await getClassroomFacts(kit.academic, ctx, classroomId);
      if (!c.ok) return null;
      const list = await listClassroomEnrollments(kit.academic, ctx, classroomId);
      if (!list.ok) return null;
      return {
        classroomId,
        institutionId: c.value.institutionId,
        gradeLevelCode: c.value.gradeLevelCode,
        items: list.value.filter((e) => e.active).map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId })),
      };
    },

    async getIdentity(ctx, studentId) {
      const s = await getStudent(kit.people, ctx, studentId, "FULL");
      if (!s.ok) return null;
      return { studentId, lastName: s.value.lastName, firstName: s.value.firstName, birthDate: s.value.birthDate, birthPlace: s.value.birthPlace, sex: s.value.sex };
    },
  };
}

/** Âge en années entières à une date de référence (`AAAA-MM-JJ`) ; `null` si l'une des dates manque ou est invalide. */
export function ageAt(birthDate: string | null, referenceDate: string | null): number | null {
  if (!birthDate || !referenceDate) return null;
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(referenceDate);
  if (!b || !r) return null;
  let age = Number(r[1]) - Number(b[1]);
  if (Number(r[2]) < Number(b[2]) || (Number(r[2]) === Number(b[2]) && Number(r[3]) < Number(b[3]))) age -= 1;
  return age >= 0 ? age : null;
}

type FactsFn = (deps: unknown, ctx: RequestContext, input: { enrollmentId: string }) => Promise<Result<{ gradeLevelCode?: string | null }, AppError>>;

export function createExaminationsEligibilityFacts(kit: Pick<AdapterKit, "academic" | "people">, options: { academicApi?: Record<string, unknown> } = {}): EligibilityFactsPort {
  return {
    async getEligibilityFacts(ctx, input): Promise<Result<EligibilityFacts, AppError>> {
      // Par défaut : l'API PUBLIQUE réelle d'academic (`getEligibilityFacts(deps, ctx, enrollmentId)`). `options.academicApi` ne sert
      // qu'aux tests (un module simulé qui reçoit `{ enrollmentId }`).
      let r: Result<{ gradeLevelCode?: string | null }, AppError>;
      if (options.academicApi) {
        const fn = options.academicApi.getEligibilityFacts;
        if (typeof fn !== "function") return err(unavailable("interface absente du module academic"));
        r = await (fn as FactsFn)(kit.academic, ctx, { enrollmentId: input.enrollmentId });
      } else {
        r = await academicApi.getEligibilityFacts(kit.academic, ctx, input.enrollmentId);
      }
      if (!r.ok) return err(unavailable(r.error.code));
      const level = r.value.gradeLevelCode;
      if (level === undefined) return err(unavailable("réponse sans gradeLevelCode"));
      let ageYears: number | null = null;
      if (input.referenceDate) {
        const s = await getStudent(kit.people, ctx, input.studentId, "FULL");
        ageYears = s.ok ? ageAt(s.value.birthDate, input.referenceDate) : null;
      }
      return ok({ inExamGrade: input.examGradeLevelCode !== null && level !== null && level === input.examGradeLevelCode, ageYears });
    },
  };
}

export function createExaminationsInstitutions(kit: Pick<AdapterKit, "tenantDb" | "clock">): InstitutionDirectory {
  const read = async (ctx: RequestContext, id: string) => {
    const r = await getInstitution({ db: kit.tenantDb, clock: kit.clock }, ctx, id);
    return r.ok ? r.value : null;
  };
  return {
    async exists(ctx, id) {
      return (await read(ctx, id)) !== null;
    },
    async nameOf(ctx, id) {
      return (await read(ctx, id))?.name ?? null;
    },
  };
}

export function createExaminationsFamilyLinks(lookups: PeopleLookups): FamilyLinks {
  return {
    studentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    childrenOf: (ctx, userId) => lookups.childrenOf(ctx, userId),
    isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
  };
}
