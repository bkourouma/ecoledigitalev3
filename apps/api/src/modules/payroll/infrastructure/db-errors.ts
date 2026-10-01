/**
 * Traduction des erreurs Postgres du module payroll en erreurs métier (`AppError`).
 *
 * Les déclencheurs de 1504 lèvent des exceptions dont le message commence par un code stable
 * `payroll.<code>:` ; les contraintes (unicité, exclusion, CHECK) sont reconnues par leur NOM. Rien d'autre
 * que ces messages « métier » n'est renvoyé tel quel au client (un message SQL inconnu devient une erreur interne).
 */
import { ConflictError, type AppError } from "@ecoledigitale/kernel";
import { pgErrorCode } from "@ecoledigitale/database";
import { PayrollCodes, conflict, internalIntegrity } from "../domain/errors";

interface PgErrorLike {
  code?: string;
  message?: string;
  constraint?: string;
  detail?: string;
}

const CODE_IN_MESSAGE = /^payroll\.([a-z_]+):\s*(.*)$/s;

/** `true` si l'erreur est une violation d'unicité d'une RÉCLAMATION (heure ou jour de salaire). */
export function isClaimCollision(e: unknown): boolean {
  const err = e as PgErrorLike;
  return pgErrorCode(e) === "23505" && (err.constraint === "hour_claims_pkey" || err.constraint === "salary_day_claims_pkey");
}

/** Retourne l'erreur métier correspondante, ou `null` si l'erreur n'est pas du ressort du module. */
export function mapDbError(e: unknown): AppError | null {
  const code = pgErrorCode(e);
  if (!code) return null;
  const err = e as PgErrorLike;
  const message = typeof err.message === "string" ? err.message : "";

  const tagged = CODE_IN_MESSAGE.exec(message);
  if (tagged) {
    const key = tagged[1] as string;
    const text = (tagged[2] as string).trim();
    switch (key) {
      case "invalid_transition":
        return conflict(PayrollCodes.invalidTransition, `Transition de statut interdite : ${text}.`);
      case "payslip_locked":
        return conflict(PayrollCodes.payslipLocked, "Ce bulletin n'est plus modifiable.", { text });
      case "separation_of_duties":
        return conflict(PayrollCodes.separationOfDuties, "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter.");
      case "owner_approval_required":
        return conflict(PayrollCodes.ownerApprovalRequired, "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.");
      case "period_closed":
        return conflict(PayrollCodes.periodClosed, "La période est clôturée ou archivée.");
      case "period_has_payslips":
        return conflict(PayrollCodes.periodHasPayslips, "Des bulletins existent sur cette période : l'opération est interdite.");
      case "immutable":
        return conflict(PayrollCodes.integrity, "Cette donnée est immuable.");
      case "integrity_violation":
        return internalIntegrity("Incohérence détectée par la base de données : l'opération est annulée.");
      case "not_found":
        return conflict(PayrollCodes.notFound, "Élément introuvable.");
      default:
        return null;
    }
  }

  if (code === "23505") {
    switch (err.constraint) {
      case "hour_claims_pkey":
      case "salary_day_claims_pkey":
        return conflict(PayrollCodes.hourAlreadyClaimed, "Une heure ne se paie qu'une fois : elle est déjà portée par un autre bulletin.");
      case "payslips_live_uq":
        return conflict(PayrollCodes.concurrentUpdate, "Un bulletin existe déjà pour cet enseignant sur cette période.");
      case "pay_periods_one_awaiting_uq":
        return conflict(PayrollCodes.periodPending, "Une période est déjà en attente de calcul : lancez son calcul ou clôturez-la avant d'en créer une autre.");
      case "calculation_runs_running_uq":
        return conflict(PayrollCodes.runInProgress, "Un calcul est déjà en cours pour cette période.");
      default:
        return null;
    }
  }
  if (code === "23P01") {
    if (err.constraint === "pay_configs_no_overlap") return conflict(PayrollCodes.configOverlap, "Une autre configuration de paie couvre déjà ces dates pour cet enseignant.");
    if (err.constraint === "hourly_rates_no_overlap") return conflict(PayrollCodes.rateOverlap, "Un tarif chevauchant existe déjà pour ce cours et cet enseignant (TARIF_CHEVAUCHANT).");
    return null;
  }
  if (code === "23514" && err.constraint === "payslips_total_formula") return conflict(PayrollCodes.negativeTotal, "Le total du bulletin serait incohérent ou négatif.");
  if (code === "23503" && err.constraint?.endsWith("_fkey")) return conflict(PayrollCodes.notFound, "Référence introuvable.");
  return null;
}

export { ConflictError };
