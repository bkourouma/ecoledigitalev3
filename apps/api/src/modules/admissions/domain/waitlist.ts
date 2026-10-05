/**
 * Ordre de la liste d'attente : MIROIR de `admissions.waitlist_order` (SQL). Réponse métier Q-A03 : l'ordre est une DÉCISION
 * MANUELLE de la direction, plus un calcul d'ancienneté.
 *
 *   1. les dossiers CLASSÉS (`manualRank` défini) dans l'ordre de leur rang ;
 *   2. puis les dossiers « à classer » (`manualRank` nul), par date d'entrée — pour l'AFFICHAGE seulement : ils ne sont jamais
 *      proposés d'office (voir `promoteHead`) ;
 *   3. à égalité, l'identifiant (ordre total, stable).
 *
 * La classe de priorité (`priorityRank`) et l'ancienneté (`enteredAt`) restent des informations affichées.
 */
export const NO_PRIORITY_RANK = 2_147_483_647;

export interface WaitlistCandidate {
  readonly applicationId: string;
  readonly priorityRank: number | null;
  readonly enteredAt: string;
  /** Rang décidé par la direction ; `null`/absent = à classer. */
  readonly manualRank?: number | null;
}

export function orderWaitlist<T extends WaitlistCandidate>(entries: readonly T[]): Array<T & { queuePosition: number }> {
  return [...entries]
    .sort((a, b) => {
      const ma = a.manualRank ?? null;
      const mb = b.manualRank ?? null;
      if (ma !== mb) {
        if (ma === null) return 1;
        if (mb === null) return -1;
        return ma - mb;
      }
      const ta = Date.parse(a.enteredAt);
      const tb = Date.parse(b.enteredAt);
      if (ta !== tb) return ta - tb;
      return a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0;
    })
    .map((e, i) => ({ ...e, queuePosition: i + 1 }));
}
