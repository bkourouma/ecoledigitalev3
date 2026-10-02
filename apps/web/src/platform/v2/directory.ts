"use client";

/**
 * Annuaires d'AFFICHAGE : résolvent un identifiant (classe, membre du personnel, salle) en libellé lorsque
 * l'utilisateur a le droit de lire la liste correspondante ; sinon l'identifiant abrégé est affiché. Lecture seule.
 */

import { usePermission } from "@/platform/access";
import { useClassrooms } from "./academic";
import { useStaffList, useStudents } from "./people";
import { useRooms } from "./scheduling";

export const shortId = (id: string): string => `…${id.slice(-4)}`;

export interface Directory {
  /** Libellé, ou identifiant abrégé quand l'utilisateur ne peut pas lire la liste. */
  name(id: string | null | undefined): string;
  /** Libellé seulement s'il est connu (sinon `null` : l'écran peut masquer la mention plutôt qu'afficher un identifiant). */
  find(id: string | null | undefined): string | null;
  isLoading: boolean;
}

function directoryOf(map: ReadonlyMap<string, string>, isLoading: boolean): Directory {
  return {
    name: (id) => (id ? (map.get(id) ?? shortId(id)) : "—"),
    find: (id) => (id ? (map.get(id) ?? null) : null),
    isLoading,
  };
}

export function useClassroomDirectory(): Directory {
  const canRead = usePermission("academic.classroom.read").allowed;
  const q = useClassrooms({ pageSize: 200 }, { enabled: canRead });
  const map = new Map((q.data?.items ?? []).map((c) => [c.id, c.name]));
  return directoryOf(map, q.isFetching);
}

export function useStaffDirectory(): Directory {
  const canRead = usePermission("staff.read").allowed;
  const q = useStaffList({ limit: 200 }, { enabled: canRead });
  const map = new Map((q.data?.items ?? []).map((s) => [s.id, s.displayName]));
  return directoryOf(map, q.isFetching);
}

export function useRoomDirectory(): Directory {
  const canRead = usePermission("schedule.read").allowed;
  const q = useRooms({}, canRead);
  const map = new Map((q.data ?? []).map((r) => [r.id, r.name]));
  return directoryOf(map, q.isFetching);
}

/** Noms des élèves d'une classe (l'API des présences ne renvoie que des identifiants dans ses rapports). */
export function useStudentDirectory(classroomId: string | null | undefined): Directory {
  const byList = usePermission("student.list").allowed;
  const byClass = usePermission("student.class.read").allowed;
  const q = useStudents({ classroomId: classroomId ?? undefined, limit: 200 }, { enabled: Boolean(classroomId) && (byList || byClass) });
  const map = new Map((q.data?.items ?? []).map((s) => [s.id, s.displayName]));
  return directoryOf(map, q.isFetching);
}
