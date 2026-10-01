/**
 * Machine d'états d'un bulletin (spec 032 AC6.4) — jamais un statut libre.
 *
 *   CALCULATED → APPROVED | CANCELLED
 *   APPROVED   → PAID | DISPUTED | CANCELLED
 *   DISPUTED   → APPROVED | CANCELLED
 *   PAID, CANCELLED : terminaux (un bulletin annulé ne ressuscite jamais, un bulletin payé ne s'annule pas).
 *
 * Trois actes, trois traces : calculer, arrêter (approuver), verser (payer). Arrêter n'est PAS verser.
 * La même table est imposée par un déclencheur SQL (`payroll.payslips_guard`) : le domaine l'applique pour
 * répondre proprement, la base pour ne jamais accepter autre chose, quel que soit l'écrivain.
 */
import type { PayslipStatus } from "./types";

export const LEGAL_TRANSITIONS: Readonly<Record<PayslipStatus, readonly PayslipStatus[]>> = Object.freeze({
  CALCULATED: Object.freeze(["APPROVED", "CANCELLED"] as const),
  APPROVED: Object.freeze(["PAID", "DISPUTED", "CANCELLED"] as const),
  DISPUTED: Object.freeze(["APPROVED", "CANCELLED"] as const),
  PAID: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
});

export function canTransition(from: PayslipStatus, to: PayslipStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export const isTerminal = (status: PayslipStatus): boolean => LEGAL_TRANSITIONS[status].length === 0;

/** Un bulletin dont les montants et lignes ne bougent plus. */
export const isFrozen = (status: PayslipStatus): boolean => status !== "CALCULATED";

/** Bulletins qui PORTENT des heures (réclamations actives) : tout sauf l'annulé. */
export const holdsClaims = (status: PayslipStatus): boolean => status !== "CANCELLED";

/** Libellé affiché : « Impayé » = arrêté mais pas encore versé (P-PAY-59). */
export const STATUS_LABELS: Readonly<Record<PayslipStatus, string>> = Object.freeze({
  CALCULATED: "Calculé",
  APPROVED: "Impayé",
  PAID: "Payé",
  DISPUTED: "Contesté",
  CANCELLED: "Annulé",
});

/**
 * Séparation des tâches (Q-30, AC6.8) : si l'option est active, celui qui a calculé ne peut pas arrêter.
 * Renvoie `true` si l'arrêt est permis.
 */
export function separationOfDutiesAllows(input: { requireSeparateApprover: boolean; calculatedBy: string | null; approver: string | null }): boolean {
  if (!input.requireSeparateApprover) return true;
  if (input.approver === null) return false;
  return input.calculatedBy !== input.approver;
}

/**
 * Seuil propriétaire (AC6.8) : au-delà du seuil, seul un acteur investi de la permission d'arrêt « propriétaire »
 * arrête le bulletin.
 */
export function requiresOwnerApproval(input: { thresholdXof: number | null; totalXof: number }): boolean {
  return input.thresholdXof !== null && input.totalXof >= input.thresholdXof;
}
