/**
 * CashRegister : caisse physique ; CashSession : une journée (ou un poste) d'un
 * caissier, de l'ouverture (fonds de caisse) à la clôture (comptage).
 *
 *   attendu  = fonds de caisse + espèces encaissées − espèces remboursées
 *   écart    = compté − attendu   (négatif = manquant, positif = excédent)
 *
 * États : OPEN → CLOSED (définitif). Une caisse n'a qu'UNE session ouverte, un
 * caissier non plus. Les paiements espèces sont rattachés à la session ouverte du
 * caissier qui les saisit.
 */
import { err, ok, type AppError, type Money, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, invalidTransition, validation } from "./errors";
import type { CashSessionStatus } from "./types";

export const CASH_SESSION_TRANSITIONS: Readonly<Record<CashSessionStatus, ReadonlyArray<CashSessionStatus>>> = Object.freeze({
  OPEN: ["CLOSED"],
  CLOSED: [],
});

export function assertCashSessionTransition(from: CashSessionStatus, to: CashSessionStatus): Result<CashSessionStatus, AppError> {
  return CASH_SESSION_TRANSITIONS[from].includes(to) ? ok(to) : err(invalidTransition("la session de caisse", from, to));
}

export interface CashMovements {
  openingFloat: Money;
  cashReceived: Money;
  cashRefunded: Money;
}

export function expectedCash(m: CashMovements): Money {
  return m.openingFloat.add(m.cashReceived).subtract(m.cashRefunded);
}

export interface SessionSettlement {
  expected: Money;
  counted: Money;
  /** compté − attendu */
  variance: Money;
}

export function settleSession(movements: CashMovements, counted: Money): Result<SessionSettlement, AppError> {
  if (counted.isNegative()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant compté ne peut pas être négatif.", "countedAmount"));
  }
  if (counted.currency !== movements.openingFloat.currency) {
    return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du comptage différente de celle de la caisse.", "countedAmount"));
  }
  // `expected` peut être négatif (remboursement espèces d'un encaissement d'une session
  // antérieure) : ce n'est pas une erreur, c'est un écart que le comptage constate.
  const expected = expectedCash(movements);
  return ok({ expected, counted, variance: counted.subtract(expected) });
}

export function validateOpeningFloat(openingFloat: Money): Result<Money, AppError> {
  return openingFloat.isNegative()
    ? err(validation(FinanceCode.INVALID_AMOUNT, "Le fonds de caisse ne peut pas être négatif.", "openingFloat"))
    : ok(openingFloat);
}

/** Écart notable (au-delà du seuil toléré) : exige une justification à la clôture. */
export function requiresJustification(variance: Money, toleranceAmount: Money): boolean {
  return variance.abs().gt(toleranceAmount);
}
