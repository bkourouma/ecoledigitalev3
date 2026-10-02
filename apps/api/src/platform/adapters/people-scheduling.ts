/**
 * people -> scheduling : port `PeopleQuery` (statut du personnel, disponibilités, compétences, affectation à une classe,
 * tutelle, comptes liés). Sans ce branchement, la planification fonctionne sans avertissement de disponibilité ni contrôle
 * d'affectation, et les vues parent / élève échouent fermées.
 */
import {
  getStaffByIds,
  isStaffAssignedToClassroom,
  listAvailabilities,
  listCompetencies,
  listStaff,
  type PeopleDeps,
} from "../../modules/people";
import type { PeopleQuery, StaffAvailabilityInfo, StaffCompetencyInfo, StaffInfo, StaffStatus } from "../../modules/scheduling";
import type { PeopleLookups } from "./people-lookups";

const STATUSES: readonly StaffStatus[] = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "LEFT"];
const asStatus = (s: string): StaffStatus => (STATUSES.includes(s as StaffStatus) ? (s as StaffStatus) : "LEFT");

export function createSchedulingPeopleQuery(people: PeopleDeps, lookups: PeopleLookups): PeopleQuery {
  return {
    async getStaffByIds(ctx, ids): Promise<StaffInfo[]> {
      const out: StaffInfo[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const r = await getStaffByIds(people, ctx, ids.slice(i, i + 500));
        if (r.ok) out.push(...r.value.map((s) => ({ id: s.staffId, displayName: s.displayName, status: asStatus(s.status), userId: s.identityId })));
      }
      return out;
    },
    async listTeachingStaff(ctx): Promise<StaffInfo[]> {
      const out: StaffInfo[] = [];
      for (let offset = 0; offset < 5000; offset += 200) {
        const r = await listStaff(people, ctx, { canTeach: true, status: "ACTIVE", limit: 200, offset });
        if (!r.ok) break;
        out.push(...r.value.items.map((s) => ({ id: s.id, displayName: s.displayName, status: asStatus(s.status), userId: null })));
        if (out.length >= r.value.total || r.value.items.length === 0) break;
      }
      return out;
    },
    async listAvailabilities(ctx, staffIds, range): Promise<StaffAvailabilityInfo[]> {
      const r = await listAvailabilities(people, ctx, { staffIds, from: range.from, to: range.to });
      if (!r.ok) return [];
      return r.value.map((a) => {
        // Une disponibilité bornée à un seul jour est une règle POUR CETTE DATE ; sinon règle hebdomadaire.
        const oneDay = a.validFrom !== null && a.validFrom === a.validTo;
        return {
          staffId: a.staffId,
          weekday: oneDay ? null : a.weekday,
          date: oneDay ? a.validFrom : null,
          startTime: a.startTime,
          endTime: a.endTime,
          kind: a.kind === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
        };
      });
    },
    async listCompetencies(ctx, staffIds): Promise<StaffCompetencyInfo[]> {
      const out: StaffCompetencyInfo[] = [];
      for (const staffId of staffIds) {
        const r = await listCompetencies(people, ctx, staffId);
        if (r.ok) out.push(...r.value.map((c) => ({ staffId, subjectId: c.subjectId, curriculumNodeId: null })));
      }
      return out;
    },
    isStaffAssignedToClassroom: (ctx, staffId, classroomId, onDate) => isStaffAssignedToClassroom(people, ctx, { staffId, classroomId, ...(onDate ? { onDate } : {}) }),
    isGuardianOfStudent: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    resolveStaffForUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
    resolveStudentForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
  };
}
