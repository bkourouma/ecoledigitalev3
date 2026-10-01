"use client";

/**
 * Annuaires d'AFFICHAGE : résolvent un identifiant (classe, membre du personnel, salle) en libellé lorsque
 * l'utilisateur a le droit de lire la liste correspondante ; sinon l'identifiant abrégé est affiché. Lecture seule.
 */

import { usePermission } from "@/platform/access";
import { useClassrooms } from "./academic";
import { useStaffList } from "./people";
import { useRooms } from "./scheduling";

export const shortId = (id: string): string => `…${id.slice(-4)}`;

export interface Directory {
  name(id: string | null | undefined): string;
  isLoading: boolean;
}

export function useClassroomDirectory(): Directory {
  const canRead = usePermission("academic.classroom.read").allowed;
  const q = useClassrooms({ pageSize: 200 }, { enabled: canRead });
  const map = new Map((q.data?.items ?? []).map((c) => [c.id, c.name]));
  return { name: (id) => (id ? (map.get(id) ?? shortId(id)) : "—"), isLoading: q.isFetching };
}

export function useStaffDirectory(): Directory {
  const canRead = usePermission("staff.read").allowed;
  const q = useStaffList({ limit: 200 }, { enabled: canRead });
  const map = new Map((q.data?.items ?? []).map((s) => [s.id, s.displayName]));
  return { name: (id) => (id ? (map.get(id) ?? shortId(id)) : "—"), isLoading: q.isFetching };
}

export function useRoomDirectory(): Directory {
  const canRead = usePermission("schedule.read").allowed;
  const q = useRooms({}, canRead);
  const map = new Map((q.data ?? []).map((r) => [r.id, r.name]));
  return { name: (id) => (id ? (map.get(id) ?? shortId(id)) : "—"), isLoading: q.isFetching };
}
