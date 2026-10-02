/**
 * people -> councils : `StaffPort` (affectations d'enseignement d'une classe, noms figés, fiche du personnel d'un COMPTE, périmètre d'un
 * enseignant), `FamilyPort` (tutelle RELUE à chaque appel, dossier élève d'un compte, noms) et `StudentStatusPort` (suspension, exclusion ou
 * retour au statut actif — UNIQUEMENT sur un acte d'utilisateur habilité).
 *
 * L'identité d'un compte est son identifiant d'identité IAM (`ctx.userId`) : `people` lie `persons.identity_id` à cette identité par une liaison
 * EXPLICITE (jamais par e-mail). Un compte sans fiche liée n'a aucun droit « personnel », « tuteur » ni « élève » (échec fermé).
 * Appels SÉQUENTIELS : une connexion partagée par la transaction du module appelant.
 */
import {
  changeStudentStatus,
  getStaffByIds,
  getStudentsByIds,
  isStaffAssignedToClassroom,
  listAssignmentsForClassroom,
  type PeopleDeps,
} from "../../modules/people";
import type { CouncilsFamilyPort, CouncilsStaffPort, CouncilsStudentStatusPort } from "../../modules/councils";
import type { PeopleLookups } from "./people-lookups";

export function createCouncilsStaffPort(people: PeopleDeps, lookups: PeopleLookups): CouncilsStaffPort {
  return {
    async listAssignmentsForClassroom(ctx, classroomId, onDate) {
      const r = await listAssignmentsForClassroom(people, ctx, classroomId, { onDate });
      if (!r.ok) throw r.error;
      return r.value.filter((a) => a.status === "ACTIVE").map((a) => ({ staffId: a.staffId, displayName: a.staffDisplayName ?? "Personnel", assignmentRole: a.roleCode, coversAllSubjects: a.coversAllSubjects }));
    },
    async getStaffNames(ctx, staffIds) {
      const out = new Map<string, string>();
      const ids = [...new Set(staffIds)];
      for (let i = 0; i < ids.length; i += 500) {
        const r = await getStaffByIds(people, ctx, ids.slice(i, i + 500));
        if (r.ok) for (const s of r.value) out.set(s.staffId, s.displayName);
      }
      return out;
    },
    staffIdOfUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
    async isStaffAssignedToClassroom(ctx, userId, classroomId) {
      const staffId = await lookups.staffIdForUser(ctx, userId);
      return staffId ? isStaffAssignedToClassroom(people, ctx, { staffId, classroomId }) : false;
    },
    async displayNameOfUser(ctx, userId) {
      return (await lookups.displayNameOfUser(ctx, userId)) ?? "Utilisateur";
    },
  };
}

export function createCouncilsFamilyPort(people: PeopleDeps, lookups: PeopleLookups): CouncilsFamilyPort {
  return {
    isGuardianOfStudent: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    getStudentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    async getStudentNames(ctx, studentIds) {
      const out = new Map<string, string>();
      const ids = [...new Set(studentIds)];
      for (let i = 0; i < ids.length; i += 500) {
        const r = await getStudentsByIds(people, ctx, ids.slice(i, i + 500));
        if (r.ok) for (const s of r.value) out.set(s.id, s.displayName);
      }
      return out;
    },
  };
}

/** Un échec de `people` est relancé tel quel (code `people.*`) : l'appelant annule toute sa transaction. */
export function createCouncilsStudentStatusPort(people: PeopleDeps): CouncilsStudentStatusPort {
  return {
    async changeStudentStatus(ctx, input) {
      const r = await changeStudentStatus(people, ctx, input.studentId, { status: input.status, reasonCode: "COUNCIL", reasonText: input.reasonText });
      if (!r.ok) throw r.error;
    },
  };
}
