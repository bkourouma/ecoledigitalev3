/** Explication (libellés lisibles) des conflits entre patrons d'un emploi du temps. */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { defaultLabels, describeEntryConflict, type ConflictLabels, type ConflictView, type EntryConflict } from "../domain/conflicts";
import type { ConflictPolicies } from "../domain/types";
import { getRoomsByIds } from "../infrastructure/reference-repo";
import type { SchedulingDeps } from "./deps";

export async function classifyEntryConflictsFor(
  deps: SchedulingDeps,
  ctx: RequestContext,
  tx: Tx,
  conflicts: readonly EntryConflict[],
  policies: ConflictPolicies,
): Promise<ConflictView[]> {
  if (conflicts.length === 0) return [];
  const staffIds = [...new Set(conflicts.filter((c) => c.resourceKind === "STAFF").map((c) => c.resourceId))];
  const roomIds = [...new Set(conflicts.filter((c) => c.resourceKind === "ROOM").map((c) => c.resourceId))];
  const classIds = [...new Set(conflicts.filter((c) => c.resourceKind === "CLASSROOM").map((c) => c.resourceId))];
  const staff = new Map((deps.ports.people ? await deps.ports.people.getStaffByIds(ctx, staffIds) : []).map((s) => [s.id, s.displayName]));
  const rooms = new Map((await getRoomsByIds(tx, roomIds)).map((r) => [r.id, r.name]));
  const classrooms = new Map<string, string>();
  if (deps.ports.academic) {
    for (const id of classIds) {
      const c = await deps.ports.academic.getClassroom(ctx, id);
      if (c) classrooms.set(id, c.name);
    }
  }
  const labels: ConflictLabels = {
    staff: (id) => staff.get(id) ?? defaultLabels.staff(id),
    classroom: (id) => (classrooms.has(id) ? `la classe ${classrooms.get(id)}` : defaultLabels.classroom(id)),
    offering: defaultLabels.offering,
    room: (id) => (rooms.has(id) ? `la salle ${rooms.get(id)}` : defaultLabels.room(id)),
    equipment: defaultLabels.equipment,
  };
  return conflicts.map((c) => describeEntryConflict(c, labels, policies));
}
