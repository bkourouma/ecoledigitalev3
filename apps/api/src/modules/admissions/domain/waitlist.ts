/**
 * Ordre de la liste d'attente : MIROIR de `admissions.waitlist_order` (SQL). Rang de la classe de priorité (donnée de
 * l'établissement), puis date d'entrée, puis identifiant. Une priorité absente passe après toutes les classes déclarées.
 */
export const NO_PRIORITY_RANK = 2_147_483_647;

export interface WaitlistCandidate {
  readonly applicationId: string;
  readonly priorityRank: number | null;
  readonly enteredAt: string;
}

export function orderWaitlist<T extends WaitlistCandidate>(entries: readonly T[]): Array<T & { queuePosition: number }> {
  return [...entries]
    .sort((a, b) => {
      const ra = a.priorityRank ?? NO_PRIORITY_RANK;
      const rb = b.priorityRank ?? NO_PRIORITY_RANK;
      if (ra !== rb) return ra - rb;
      const ta = Date.parse(a.enteredAt);
      const tb = Date.parse(b.enteredAt);
      if (ta !== tb) return ta - tb;
      return a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0;
    })
    .map((e, i) => ({ ...e, queuePosition: i + 1 }));
}
