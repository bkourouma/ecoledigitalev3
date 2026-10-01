/**
 * people -> attendance : `PeoplePort` (tutelle, élève et personnel d'un compte, enfants d'un tuteur, affectation à une
 * classe, fiches par lots). L'identité vient du contexte authentifié, jamais d'un paramètre client.
 */
import {
  getStaffByIds,
  getStudentsByIds,
  isStaffAssignedToClassroom,
  type PeopleDeps,
} from "../../modules/people";
import type { PeoplePort } from "../../modules/attendance";
import type { PeopleLookups } from "./people-lookups";

export function createAttendancePeoplePort(people: PeopleDeps, lookups: PeopleLookups): PeoplePort {
  return {
    isGuardianOfStudent: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    getStudentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    listChildrenOfGuardian: (ctx, userId) => lookups.childrenOf(ctx, userId),
    getStaffIdForUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
    isStaffAssignedToClassroom: (ctx, staffId, classroomId) => isStaffAssignedToClassroom(people, ctx, { staffId, classroomId }),
    async getStaffById(ctx, staffId) {
      const r = await getStaffByIds(people, ctx, [staffId]);
      const s = r.ok ? r.value[0] : undefined;
      return s ? { staffId: s.staffId, displayName: s.displayName, active: s.status === "ACTIVE" || s.status === "ON_LEAVE" } : null;
    },
    async getStudentsByIds(ctx, studentIds) {
      const out: Array<{ studentId: string; displayName: string }> = [];
      // getStudentsByIds de people plafonne les lots (500) : découpage.
      for (let i = 0; i < studentIds.length; i += 500) {
        const r = await getStudentsByIds(people, ctx, studentIds.slice(i, i + 500));
        if (r.ok) out.push(...r.value.map((s) => ({ studentId: s.id, displayName: s.displayName })));
      }
      return out;
    },
  };
}
