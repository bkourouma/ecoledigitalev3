import { childSectionHref } from "@/platform/portal/menus";
import type { SnapshotLinks } from "../../_family/FamilySnapshot";

/** Liens des cartes du tableau de bord d'un enfant vers ses sections. */
export function childLinks(childId: string): SnapshotLinks {
  return {
    results: childSectionHref(childId, "results"),
    attendance: childSectionHref(childId, "attendance"),
    finance: childSectionHref(childId, "finance"),
    schedule: childSectionHref(childId, "schedule"),
  };
}
