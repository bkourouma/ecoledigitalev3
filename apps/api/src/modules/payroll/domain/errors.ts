/**
 * Erreurs métier du module payroll : types du kernel + codes STABLES `payroll.*` (contrat d'API : un code
 * publié ne change jamais). Messages en français, `details` structurés.
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";
import type { PayslipStatus } from "./types";

export const PayrollCodes = {
  notFound: "payroll.not_found",
  invalidInput: "payroll.invalid_input",
  invalidTransition: "payroll.invalid_transition",
  payslipLocked: "payroll.payslip_locked",
  reasonRequired: "payroll.reason_required",
  forbidden: "payroll.forbidden",
  portUnavailable: "payroll.port_unavailable",
  separationOfDuties: "payroll.separation_of_duties",
  ownerApprovalRequired: "payroll.owner_approval_required",
  periodClosed: "payroll.period_closed",
  periodHasPayslips: "payroll.period_has_payslips",
  periodPending: "payroll.period_pending",
  runInProgress: "payroll.run_in_progress",
  configOverlap: "payroll.config_overlap",
  configInUse: "payroll.config_in_use",
  rateOverlap: "payroll.rate_overlap",
  negativeTotal: "payroll.negative_total",
  hourAlreadyClaimed: "payroll.hour_already_claimed",
  currencyLocked: "payroll.currency_locked",
  emptySelection: "payroll.empty_selection",
  concurrentUpdate: "payroll.concurrent_update",
  integrity: "payroll.integrity_violation",
} as const;

export type PayrollCode = (typeof PayrollCodes)[keyof typeof PayrollCodes];

export const notFound = (resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code: PayrollCodes.notFound });

export function invalid(path: string | ReadonlyArray<string | number>, message: string, code: PayrollCode = PayrollCodes.invalidInput): ValidationError {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code });
}

export const conflict = (code: PayrollCode, message: string, details?: Record<string, unknown>): ConflictError => new ConflictError(message, { code, ...(details ? { details } : {}) });

export const invalidTransition = (from: PayslipStatus, to: PayslipStatus): ConflictError =>
  conflict(PayrollCodes.invalidTransition, `Transition interdite : un bulletin ${from} ne peut pas passer à ${to}.`, { from, to });

export const payslipLocked = (status: PayslipStatus): ConflictError =>
  conflict(PayrollCodes.payslipLocked, "Ce bulletin n'est plus modifiable : seul un bulletin « calculé » peut être recalculé ou ajusté.", { status });

export const reasonRequired = (action: string): ValidationError => invalid("reason", `Un motif d'au moins 3 caractères est requis pour ${action}.`, PayrollCodes.reasonRequired);

export const forbidden = (message = "Action non autorisée."): ForbiddenError => new ForbiddenError(message, { code: PayrollCodes.forbidden });

export const portUnavailable = (port: string): ConflictError =>
  conflict(PayrollCodes.portUnavailable, `La source de données « ${port} » n'est pas disponible : le calcul est refusé plutôt que de produire un résultat partiel.`, { port });

export const internalIntegrity = (message: string): InternalError => new InternalError(message, { code: PayrollCodes.integrity });
