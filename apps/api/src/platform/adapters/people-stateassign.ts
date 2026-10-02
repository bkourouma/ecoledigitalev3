/**
 * people -> stateassign : `StudentNamesPort` (« NOM Prénom » par élève, une lecture pour N élèves) et `GuardianshipPort` (lien de
 * tutelle relu à CHAQUE requête de la vue famille ; le titulaire d'un compte est résolu par `persons.identity_id`, jamais par e-mail ;
 * un compte sans fiche liée n'a aucun droit « élève » ni « tuteur » : échec fermé).
 */
import { getDisplayNamesOfStudents, type PeopleDeps } from "../../modules/people";
import type { GuardianshipPort, StudentNamesPort } from "../../modules/stateassign";
import type { PeopleLookups } from "./people-lookups";

export function createStateassignStudentNames(people: PeopleDeps): StudentNamesPort {
  return { names: (ctx, studentIds) => getDisplayNamesOfStudents(people, ctx, studentIds) };
}

export function createStateassignGuardianshipPort(lookups: PeopleLookups): GuardianshipPort {
  return {
    studentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    childrenOf: (ctx, userId) => lookups.childrenOf(ctx, userId),
  };
}
