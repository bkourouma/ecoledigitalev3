/**
 * people -> schoollife : `PeoplePort` (tutelle, élève et enfants d'un compte, périmètre d'enseignant, tuteurs d'un élève, noms) et
 * `StudentStatusPort` (suspension / exclusion / retour au statut actif, UNIQUEMENT sur un acte d'utilisateur habilité).
 *
 * L'identité d'un compte est son identifiant d'identité IAM (`ctx.userId`) : la tutelle est RELUE à chaque appel (jamais déduite
 * d'un en-tête client). Le périmètre d'un enseignant est celui de `student.class.read` : classes où il est affecté aujourd'hui.
 * Appels SÉQUENTIELS : une connexion partagée par la transaction du module appelant.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import {
  changeStudentStatus,
  getStudentsByIds,
  isStaffAssignedToClassroom,
  listNotificationContactsOfStudents,
  classroomsOfCurrentStaff,
  type PeopleDeps,
} from "../../modules/people";
import { listEnrollmentsByStudent, type AcademicDeps } from "../../modules/academic";
import type { PeoplePort, StudentStatusPort } from "../../modules/schoollife";
import type { PeopleLookups } from "./people-lookups";

export function createSchoollifePeoplePort(people: PeopleDeps, academic: AcademicDeps, lookups: PeopleLookups): PeoplePort {
  return {
    isGuardianOfStudent: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    getStudentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    listChildrenOfGuardian: (ctx, userId) => lookups.childrenOf(ctx, userId),
    async staffCanReadStudent(ctx, studentId) {
      // Classes où le compte est affecté aujourd'hui (people) ∩ inscriptions vivantes de l'élève (academic, source de vérité :
      // aucune dépendance à la projection d'inscriptions de people, qui n'existe qu'une fois le worker passé).
      const classrooms = await classroomsOfCurrentStaff(people, ctx);
      if (classrooms.length === 0) return false;
      const r = await listEnrollmentsByStudent(academic, ctx, studentId);
      return r.ok && r.value.some((e) => e.status === "ACTIVE" && classrooms.includes(e.classroomId));
    },
    async isStaffAssignedToClassroom(ctx, userId, classroomId) {
      const staffId = await lookups.staffIdForUser(ctx, userId);
      return staffId ? isStaffAssignedToClassroom(people, ctx, { staffId, classroomId }) : false;
    },
    async listGuardiansOfStudent(ctx, studentId) {
      const r = await listNotificationContactsOfStudents(people, ctx, [studentId]);
      if (!r.ok) throw r.error;
      const set = r.value.find((s) => s.studentId === studentId);
      return (set?.guardians ?? []).map((g) => ({ guardianId: g.guardianId, userId: g.identityId, displayName: g.displayName }));
    },
    async getStudentNames(ctx, studentIds) {
      const out = new Map<string, string>();
      // `getStudentsByIds` de people plafonne les lots (500).
      for (let i = 0; i < studentIds.length; i += 500) {
        const r = await getStudentsByIds(people, ctx, studentIds.slice(i, i + 500));
        if (r.ok) for (const s of r.value) out.set(s.id, s.displayName);
      }
      return out;
    },
    async displayNameOfUser(ctx, userId) {
      return (await lookups.displayNameOfUser(ctx, userId)) ?? "Utilisateur";
    },
  };
}

/** Un échec de `people` est relancé tel quel (code `people.*`) : l'appelant annule toute sa transaction. */
export function createSchoollifeStudentStatusPort(people: PeopleDeps): StudentStatusPort {
  return {
    async changeStudentStatus(ctx: RequestContext, input) {
      const r = await changeStudentStatus(people, ctx, input.studentId, { status: input.status, reasonCode: "SCHOOLLIFE", reasonText: input.reasonText });
      if (!r.ok) throw r.error;
    },
  };
}
