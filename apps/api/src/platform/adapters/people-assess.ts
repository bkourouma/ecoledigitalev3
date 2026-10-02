/**
 * people -> assess : `TeachingAssignmentPort` (qui enseigne quel nœud dans quelle classe), `GuardianshipPort` et
 * `ActorNamePort`. Un compte sans fiche de personnel n'enseigne rien (échec fermé).
 */
import {
  isStaffAssignedToClassroom,
  type PeopleDeps,
} from "../../modules/people";
import type { ActorNamePort as AssessActorNamePort, GuardianshipPort as AssessGuardianshipPort, TeachingAssignmentPort as AssessTeachingAssignmentPort } from "../../modules/assess";
import type { PeopleLookups } from "./people-lookups";

export function createAssessTeachingPort(people: PeopleDeps, lookups: PeopleLookups): AssessTeachingAssignmentPort {
  return {
    staffIdForUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
    teaches: (ctx, staffId, nodeId, classroomId) => isStaffAssignedToClassroom(people, ctx, { staffId, classroomId, nodeId }),
  };
}

export function createAssessGuardianshipPort(lookups: PeopleLookups): AssessGuardianshipPort {
  return { studentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId), isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId) };
}

export function createAssessActorNamePort(lookups: PeopleLookups): AssessActorNamePort {
  return {
    async nameOf(ctx, userId) {
      return (await lookups.displayNameOfUser(ctx, userId)) ?? "Utilisateur";
    },
  };
}
