/**
 * Aides autour de `Money` (kernel). Toute l'arithmétique passe par `Money` :
 * entiers, jamais de flottant, devise vérifiée.
 */
import { Money, MoneyError, err, ok, type AppError, type CurrencyCode, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, validation } from "./errors";

export function sumMoney(values: ReadonlyArray<Money>, currency: CurrencyCode): Money {
  return values.reduce((acc, m) => acc.add(m), Money.zero(currency));
}

export function minMoney(a: Money, b: Money): Money {
  return a.lte(b) ? a : b;
}

export function maxMoney(a: Money, b: Money): Money {
  return a.gte(b) ? a : b;
}

/** `a − b` borné à zéro (jamais négatif). */
export function subtractFloor(a: Money, b: Money): Money {
  const diff = a.subtract(b);
  return diff.isNegative() ? Money.zero(a.currency) : diff;
}

/** Construit un `Money` depuis une saisie non fiable ; `Err` plutôt qu'exception. */
export function parseMoney(
  amount: unknown,
  currency: CurrencyCode,
  field: string,
  options: { allowZero?: boolean } = {},
): Result<Money, AppError> {
  let m: Money;
  try {
    if (typeof amount === "bigint") m = Money.of(amount, currency);
    else if (typeof amount === "number") m = Money.of(amount, currency);
    else if (typeof amount === "string") m = Money.fromString(amount, currency);
    else return err(validation(FinanceCode.INVALID_AMOUNT, `${field} : montant requis.`, field));
  } catch (e) {
    if (e instanceof MoneyError) return err(validation(FinanceCode.INVALID_AMOUNT, `${field} : ${e.message}`, field));
    throw e;
  }
  if (m.isNegative()) return err(validation(FinanceCode.INVALID_AMOUNT, `${field} : un montant ne peut pas être négatif.`, field));
  if (!options.allowZero && m.isZero()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, `${field} : le montant doit être strictement positif.`, field));
  }
  return ok(m);
}

/** Lève si les devises diffèrent (programmation défensive : l'appelant a déjà validé). */
export function assertSameCurrency(currency: CurrencyCode, ...values: Money[]): void {
  for (const v of values) {
    if (v.currency !== currency) {
      throw new MoneyError("MONEY_CURRENCY_MISMATCH", `Devises différentes : ${currency} et ${v.currency}.`);
    }
  }
}
