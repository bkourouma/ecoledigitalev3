/**
 * Payment : machine d'états, montants dérivés, règles par mode de paiement,
 * empreinte d'idempotence.
 *
 * États : PENDING → CONFIRMED | FAILED ; CONFIRMED → REFUNDED (remboursement TOTAL).
 * Un remboursement partiel laisse le paiement CONFIRMED avec `refunded > 0`.
 * Un paiement confirmé est IMMUABLE (montant, mode, payeur…) : on corrige par
 * écritures inverses (remboursement, reprise d'imputation), jamais par UPDATE.
 */
import { createHash } from "node:crypto";
import { err, ok, Money, type AppError, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, invalidTransition, validation } from "./errors";
import type { PayerKind, PaymentMethod, PaymentStatus, Uuid } from "./types";
import { PAYMENT_METHODS } from "./types";

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, ReadonlyArray<PaymentStatus>>> = Object.freeze({
  PENDING: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["REFUNDED"],
  FAILED: [],
  REFUNDED: [],
});

export const canTransitionPayment = (from: PaymentStatus, to: PaymentStatus): boolean => PAYMENT_TRANSITIONS[from].includes(to);

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): Result<PaymentStatus, AppError> {
  return canTransitionPayment(from, to) ? ok(to) : err(invalidTransition("le paiement", from, to));
}

export interface PaymentAmounts {
  readonly amount: Money;
  /** Imputé NET des reprises. */
  readonly allocated: Money;
  readonly refunded: Money;
}

export function validatePaymentAmounts(p: PaymentAmounts): Result<PaymentAmounts, AppError> {
  if (!p.amount.isPositive()) return err(validation(FinanceCode.INVALID_AMOUNT, "Un paiement est strictement positif.", "amount"));
  if (p.allocated.isNegative() || p.refunded.isNegative()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Imputé et remboursé ne peuvent pas être négatifs.", "amount"));
  }
  if (p.allocated.add(p.refunded).gt(p.amount)) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Imputé + remboursé dépasse le montant du paiement.", "amount"));
  }
  return ok(p);
}

/** Part du paiement encore disponible pour une imputation. */
export const unallocatedAmount = (p: PaymentAmounts): Money => p.amount.subtract(p.allocated).subtract(p.refunded);

/** Part encore remboursable (hors demandes de remboursement en cours). */
export const refundableAmount = (p: PaymentAmounts, openRefunds: Money): Money => {
  const left = p.amount.subtract(p.refunded).subtract(openRefunds);
  return left.isNegative() ? Money.zero(p.amount.currency) : left;
};

/** Statut du paiement après un remboursement cumulé `refunded`. */
export const statusAfterRefund = (amount: Money, refunded: Money): PaymentStatus => (refunded.equals(amount) ? "REFUNDED" : "CONFIRMED");

export interface ManualPaymentRules {
  method: string;
  reference?: string | null;
}

/** Modes saisissables à la main (le paiement en ligne passe par un fournisseur). */
export const MANUAL_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = PAYMENT_METHODS.filter((m) => m !== "ONLINE");

export function validateManualPaymentRules(input: ManualPaymentRules): Result<PaymentMethod, AppError> {
  if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    return err(
      validation(
        FinanceCode.INVALID_INPUT,
        input.method === "ONLINE" ? "Un paiement en ligne passe par un fournisseur, pas par une saisie manuelle." : "Mode de paiement inconnu.",
        "method",
      ),
    );
  }
  const ref = input.reference?.trim() ?? "";
  if ((input.method === "CHEQUE" || input.method === "TRANSFER") && ref.length === 0) {
    return err(
      validation(
        FinanceCode.INVALID_INPUT,
        input.method === "CHEQUE" ? "Le numéro de chèque est requis." : "La référence du virement est requise.",
        "reference",
      ),
    );
  }
  if (ref.length > 120) return err(validation(FinanceCode.INVALID_INPUT, "Référence trop longue (120 caractères max).", "reference"));
  return ok(input.method as PaymentMethod);
}

export interface IdempotencyFields {
  learnerId: Uuid;
  amount: Money;
  method: PaymentMethod;
  payerKind: PayerKind;
  payerRef?: string | null;
  reference?: string | null;
  provider?: string | null;
  invoiceId?: Uuid | null;
  /** Éléments supplémentaires qui font partie de la demande (ex. mode d'imputation). */
  extra?: unknown;
}

/**
 * Empreinte canonique d'une demande de paiement : une même clé d'idempotence rejouée
 * avec une demande DIFFÉRENTE est une erreur (`finance.idempotency_key_reused`),
 * jamais un faux rejeu.
 */
export function paymentFingerprint(f: IdempotencyFields): string {
  const canonical = JSON.stringify([
    f.learnerId,
    f.amount.amount,
    f.amount.currency,
    f.method,
    f.payerKind,
    f.payerRef ?? null,
    (f.reference ?? "").trim() || null,
    f.provider ?? null,
    f.invoiceId ?? null,
    f.extra ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateIdempotencyKey(key: unknown): Result<string, AppError> {
  if (typeof key !== "string") return err(validation(FinanceCode.INVALID_INPUT, "Clé d'idempotence requise.", "idempotencyKey"));
  const k = key.trim();
  if (k.length < 8 || k.length > 120 || !/^[A-Za-z0-9._:\-]+$/.test(k)) {
    return err(
      validation(FinanceCode.INVALID_INPUT, "Clé d'idempotence : 8 à 120 caractères (lettres, chiffres, . _ : -).", "idempotencyKey"),
    );
  }
  return ok(k);
}

export function idempotencyConflict(key: string): AppError {
  return conflict(FinanceCode.IDEMPOTENCY_KEY_REUSED, "Cette clé d'idempotence a déjà servi pour une demande différente.", {
    idempotencyKey: key,
  });
}
