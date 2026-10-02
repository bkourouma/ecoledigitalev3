/**
 * people -> primary_school : `TeachingPort` (affectations d'enseignement : instituteur d'un compte, classe affectée, titulaire
 * `HOMEROOM`, équipe d'une classe, noms) et `GuardianshipPort` (élève d'un compte, tutelle, enfants — relus à CHAQUE requête).
 *
 * Un compte sans fiche de personnel n'enseigne rien (échec fermé) ; un compte sans fiche élève ou tuteur n'a aucun droit
 * « famille ». Le titulaire se lit dans les affectations (`roleCode`), jamais dans un libellé ou un nom de rôle.
 */
import { abidjanDate, type Clock } from "@ecoledigitale/kernel";
import { getStaffByIds, isStaffAssignedToClassroom, listAssignmentsForClassroom, listClassroomIdsOfStaff, type PeopleDeps } from "../../modules/people";
import type { PrimaryGuardianshipPort as GuardianshipPort, PrimaryTeachingPort as TeachingPort } from "../../modules/primary_school";
import type { PeopleLookups } from "./people-lookups";

export function createPrimaryTeachingPort(input: { people: PeopleDeps; lookups: PeopleLookups; clock: Clock }): TeachingPort {
  const { people, lookups, clock } = input;
  const today = (): string => abidjanDate(clock.now());
  async function activeAssignments(ctx: Parameters<TeachingPort["hasHomeroom"]>[0], classroomId: string) {
    const r = await listAssignmentsForClassroom(people, ctx, classroomId, { onDate: today() });
    // Échec fermé : une lecture impossible = aucune affectation connue.
    return r.ok ? r.value.filter((a) => a.status === "ACTIVE") : [];
  }
  return {
    staffIdForUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
    isAssigned: (ctx, staffId, classroomId) => isStaffAssignedToClassroom(people, ctx, { staffId, classroomId }),
    async isHomeroom(ctx, staffId, classroomId) {
      return (await activeAssignments(ctx, classroomId)).some((a) => a.staffId === staffId && a.roleCode === "HOMEROOM");
    },
    async classroomIdsOfStaff(ctx, staffId) {
      return listClassroomIdsOfStaff(people, ctx, staffId);
    },
    async hasHomeroom(ctx, classroomId) {
      return (await activeAssignments(ctx, classroomId)).some((a) => a.roleCode === "HOMEROOM");
    },
    async listClassroomStaff(ctx, classroomId) {
      const seen = new Map<string, { staffId: string; name: string | null; roleCode: string }>();
      for (const a of await activeAssignments(ctx, classroomId)) {
        const known = seen.get(a.staffId);
        // Un maître cumulant plusieurs affectations garde la plus « titulaire » : HOMEROOM d'abord.
        if (!known || a.roleCode === "HOMEROOM") seen.set(a.staffId, { staffId: a.staffId, name: a.staffDisplayName, roleCode: a.roleCode });
      }
      return [...seen.values()];
    },
    async staffNames(ctx, staffIds) {
      const out = new Map<string, string>();
      const ids = [...new Set(staffIds)];
      for (let i = 0; i < ids.length; i += 200) {
        const r = await getStaffByIds(people, ctx, ids.slice(i, i + 200));
        if (r.ok) for (const s of r.value) if (s.displayName) out.set(s.staffId, s.displayName);
      }
      return out;
    },
  };
}

export function createPrimaryGuardianshipPort(lookups: PeopleLookups): GuardianshipPort {
  return {
    studentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    childrenOf: (ctx, userId) => lookups.childrenOf(ctx, userId),
  };
}
