/**
 * Refund : remboursement partiel ou total d'un paiement CONFIRMÉ, avec motif et
 * approbation (quatre yeux : l'approbateur n'est pas le demandeur, sauf
 * configuration explicite).
 *
 * États : REQUESTED → APPROVED → COMPLETED ; REQUESTED | APPROVED → REJECTED.
 * Le montant remboursable = payé − déjà remboursé − demandes en cours.
 */
import { err, ok, type AppError, type Money, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, invalidTransition, validation } from "./errors";
import { refundableAmount, type PaymentAmounts } from "./payment";
import type { PaymentStatus, RefundStatus } from "./types";

export const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, ReadonlyArray<RefundStatus>>> = Object.freeze({
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
});

export const canTransitionRefund = (from: RefundStatus, to: RefundStatus): boolean => REFUND_TRANSITIONS[from].includes(to);

export function assertRefundTransition(from: RefundStatus, to: RefundStatus): Result<RefundStatus, AppError> {
  return canTransitionRefund(from, to) ? ok(to) : err(invalidTransition("le remboursement", from, to));
}

export const MIN_REASON_LENGTH = 5;

export function validateReason(reason: unknown, field = "reason"): Result<string, AppError> {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < MIN_REASON_LENGTH || r.length > 500) {
    return err(validation(FinanceCode.INVALID_INPUT, `Le motif est obligatoire (${MIN_REASON_LENGTH} à 500 caractères).`, field));
  }
  return ok(r);
}

export interface RefundRequestCheck {
  payment: PaymentAmounts & { status: PaymentStatus };
  /** Somme des remboursements REQUESTED + APPROVED encore ouverts. */
  openRefunds: Money;
  amount: Money;
  reason: unknown;
}

export function validateRefundRequest(check: RefundRequestCheck): Result<{ reason: string; refundableAfter: Money }, AppError> {
  if (check.payment.status !== "CONFIRMED") {
    return err(conflict(FinanceCode.PAYMENT_NOT_CONFIRMED, "Seul un paiement confirmé peut être remboursé.", { status: check.payment.status }));
  }
  if (!check.amount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant remboursé doit être strictement positif.", "amount"));
  }
  if (check.amount.currency !== check.payment.amount.currency) {
    return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du remboursement différente de celle du paiement.", "amount"));
  }
  const reason = validateReason(check.reason);
  if (!reason.ok) return reason;
  const refundable = refundableAmount(check.payment, check.openRefunds);
  if (check.amount.gt(refundable)) {
    return err(
      conflict(FinanceCode.REFUND_EXCEEDS_REFUNDABLE, "Le remboursement dépasse le montant remboursable.", {
        refundable: refundable.amount,
        requested: check.amount.amount,
      }),
    );
  }
  return ok({ reason: reason.value, refundableAfter: refundable.subtract(check.amount) });
}

export function validateRefundApproval(input: {
  requestedBy: string | null;
  approvedBy: string | null;
  allowSelfApproval: boolean;
}): Result<true, AppError> {
  if (!input.approvedBy) {
    return err(validation(FinanceCode.INVALID_INPUT, "L'approbateur doit être identifié.", "approvedBy"));
  }
  if (!input.allowSelfApproval && input.requestedBy === input.approvedBy) {
    return err(
      conflict(FinanceCode.REFUND_SELF_APPROVAL, "Le demandeur ne peut pas approuver son propre remboursement.", {}),
    );
  }
  return ok(true);
}
