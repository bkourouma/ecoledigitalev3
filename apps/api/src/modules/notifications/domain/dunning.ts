/**
 * Relances d'impayés : calcul pur du palier à notifier.
 *
 * Paliers = jours de retard (par défaut J+7, J+21, J+45, configurables). Pour une échéance en retard de `d` jours :
 *  - `reached` = les paliers `<= d` ;
 *  - `target`  = le plus haut atteint : c'est LUI seul qui donne lieu à un envoi (si le job n'a pas tourné pendant une
 *    semaine, la famille ne reçoit pas J+7 ET J+21 d'un coup : un seul message, le palier le plus récent) ;
 *  - tous les paliers atteints sont consignés au registre (`dunning_steps`) : plus jamais renvoyés.
 * Idempotence : une échéance + un palier ne produisent JAMAIS deux relances (clé primaire du registre + clé de remise).
 */

export interface StagePlan {
  /** Palier à notifier, `null` si aucun palier n'est atteint. */
  readonly target: number | null;
  /** Paliers atteints (croissants). */
  readonly reached: readonly number[];
}

export function planStages(stages: readonly number[], daysOverdue: number): StagePlan {
  const sorted = [...new Set(stages)].filter((s) => Number.isInteger(s) && s >= 1).sort((a, b) => a - b);
  const reached = sorted.filter((s) => s <= daysOverdue);
  return { target: reached.length > 0 ? reached[reached.length - 1]! : null, reached };
}

/** Palier à envoyer compte tenu de ceux déjà consignés : `null` si le palier atteint a déjà été traité. */
export function nextStageToSend(stages: readonly number[], daysOverdue: number, alreadyRecorded: ReadonlySet<number>): number | null {
  const plan = planStages(stages, daysOverdue);
  if (plan.target === null) return null;
  return alreadyRecorded.has(plan.target) ? null : plan.target;
}

/** Jours entiers entre deux dates calendaires `YYYY-MM-DD` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Clé de dédoublonnage d'une relance : une échéance, un palier. */
export const dunningDedupeKey = (installmentId: string, stage: number): string => `dunning:${installmentId}:${stage}`;
/** Clé de regroupement d'une facture (arrêt dès paiement). */
export const dunningGroupKey = (invoiceId: string): string => `dunning:${invoiceId}`;
