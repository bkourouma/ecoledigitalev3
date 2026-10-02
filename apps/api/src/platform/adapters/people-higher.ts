/**
 * people -> higher : `StudentDirectory` (identité d'impression : nom, matricule, naissance ; compte ↔ étudiant ; tutelle)
 * et `ActorDirectory` (nom d'affichage imprimé dans l'octroi et le document).
 */
import { getStudent, type PeopleDeps } from "../../modules/people";
import type { ActorDirectory as HigherActorDirectory, StudentDirectory as HigherStudentDirectory } from "../../modules/higher";
import type { PeopleLookups } from "./people-lookups";

export function createHigherStudentDirectory(people: PeopleDeps, lookups: PeopleLookups): HigherStudentDirectory {
  return {
    async getIdentity(ctx, studentId) {
      const r = await getStudent(people, ctx, studentId, "FULL");
      if (!r.ok) return null;
      const s = r.value;
      return { studentId: s.id, fullName: s.displayName, matricule: s.studentNumber || null, birthDate: s.birthDate, birthPlace: s.birthPlace };
    },
    getStudentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    isGuardianOf: (ctx, input) => lookups.isGuardianOf(ctx, input.userId, input.studentId),
  };
}

export function createHigherActorDirectory(lookups: PeopleLookups): HigherActorDirectory {
  return { displayName: (ctx, userId) => lookups.displayNameOfUser(ctx, userId) };
}
