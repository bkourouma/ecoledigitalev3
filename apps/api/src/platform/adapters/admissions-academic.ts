/**
 * admissions -> academic / tenancy / people : `EnrollmentService` (inscription `PENDING`, annulation) et `InstitutionCatalog`
 * (établissements, niveaux, classes, liens de parenté).
 *
 * Écriture EXCLUSIVEMENT par l'API publique d'`academic` : `enrollStudent` (classe, financement, capacité de CLASSE, numéro
 * d'inscription, politique de confirmation `ON_REGISTRATION_FEE_PAID` — c'est `academic` qui confirme, jamais ce module) et
 * `transitionEnrollment(cancel)`. Aucune requête SQL d'un autre schéma.
 *
 * Interface attendue d'`academic` (demande 004 de la spec 007 §16) : `enrollStudent({ sourceKind: "ADMISSION", sourceRef })` et
 * `cancelEnrollment` d'une inscription `PENDING` (aujourd'hui : `transitionEnrollment(…, "cancel", motif)`).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable, type ClassroomInfo, type EnrollmentService, type InstitutionCatalog } from "../../modules/admissions";
import { enrollStudent, getAcademicYear, getClassroom, getClassroomFacts, listClassrooms, listReference, transitionEnrollment } from "../../modules/academic";
import { getInstitution, listInstitutions } from "../../modules/tenancy";
import { relationshipTypesOf } from "./admissions-people";
import { unwrapPort, type AdmissionsWriteEnv } from "./admissions-support";

export function createAdmissionsEnrollmentService(env: AdmissionsWriteEnv): EnrollmentService {
  return {
    async enrollStudent(ctx, input) {
      const e = unwrapPort(
        await enrollStudent(env.academic, ctx, {
          studentId: input.studentId,
          classroomId: input.classroomId,
          fundingType: input.fundingType as never,
          ...(input.assignmentReference ? { assignmentReference: input.assignmentReference } : {}),
          isRepeating: input.isRepeating,
          ...(input.originSchool ? { isTransferIn: true, originSchool: input.originSchool } : {}),
          sourceKind: "ADMISSION" as never,
          sourceRef: input.applicationId,
        }),
      );
      return { enrollmentId: e.id, registrationNumber: e.registrationNumber, status: e.status };
    },
    async cancelEnrollment(ctx, enrollmentId, reason) {
      unwrapPort(await transitionEnrollment(env.academic, ctx, enrollmentId, "cancel", reason));
    },
  };
}

async function classroomInfo(env: AdmissionsWriteEnv, ctx: RequestContext, id: string): Promise<ClassroomInfo | null> {
  const room = await getClassroom(env.academic, ctx, id);
  if (!room.ok) return null;
  const facts = await getClassroomFacts(env.academic, ctx, id);
  if (!facts.ok) return null;
  return {
    id: room.value.id,
    label: room.value.name,
    institutionId: room.value.institutionId,
    academicYearId: room.value.academicYearId,
    gradeLevelCode: facts.value.gradeLevelCode,
    open: room.value.status === "DRAFT" || room.value.status === "ACTIVE",
  };
}

export function createAdmissionsCatalog(env: AdmissionsWriteEnv): InstitutionCatalog {
  return {
    async listInstitutions(ctx) {
      // Les statuts sont en MAJUSCULES en base (`ACTIVE`) : « active » ne correspondait a aucune ligne et toutes les routes
      // d'admissions repondaient 404 `admissions.institution_unknown`.
      const r = unwrapPort(await listInstitutions(env.tenancy, ctx, { status: "ACTIVE" }));
      return r.map((i) => ({ id: i.id, name: i.name }));
    },
    async getInstitution(ctx, id) {
      const r = await getInstitution(env.tenancy, ctx, id);
      return r.ok ? { id: r.value.id, name: r.value.name } : null;
    },
    async gradeLevels(ctx) {
      const grades = unwrapPort(await listReference(env.academic, ctx, "grade-levels"));
      return grades.map((g) => ({ code: g.code, label: g.label }));
    },
    classroom: (ctx, id) => classroomInfo(env, ctx, id),
    async classroomsOf(ctx, q) {
      const rooms = unwrapPort(await listClassrooms(env.academic, ctx, { institutionId: q.institutionId, academicYearId: q.academicYearId, pageSize: 200 }));
      const out: ClassroomInfo[] = [];
      for (const r of rooms.items) {
        const info = await classroomInfo(env, ctx, r.id);
        if (info && info.gradeLevelCode === q.gradeLevelCode && info.open) out.push(info);
      }
      return out;
    },
    relationshipTypes: (ctx) => relationshipTypesOf(env, ctx),
  };
}

/** Réservé : lecture du code d'année (affichage des campagnes). */
export async function academicYearCodeOf(env: AdmissionsWriteEnv, ctx: RequestContext, yearId: string): Promise<string> {
  const y = await getAcademicYear(env.academic, ctx, yearId);
  if (!y.ok) throw portUnavailable("academic", "getAcademicYear");
  return y.value.code;
}
