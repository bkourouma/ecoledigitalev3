/**
 * Invoice / InvoiceLine : calcul des totaux et machine d'états.
 *
 * Invariants (testés, dont par propriétés) :
 *   - ligne : `brut = quantité × prix unitaire` ; `total = brut − remise − bourse ≥ 0` ;
 *   - facture : `total = Σ totaux de lignes` ; `payé + crédité ≤ total` ;
 *   - le reste dû `total − payé − crédité` n'est jamais négatif.
 *
 * États : DRAFT → ISSUED → PARTIALLY_PAID → PAID, avec OVERDUE (retard), CANCELLED
 * (annulée avant tout encaissement) et CREDITED (soldée par avoirs). Le statut des
 * factures émises est DÉRIVÉ des montants et des échéances (`deriveInvoiceStatus`) ;
 * toute transition passe par `assertInvoiceTransition`.
 */
import { err, ok, Money, type AppError, type CurrencyCode, type Result } from "@ecoledigitale/kernel";
import { compareDates } from "./dates";
import { FinanceCode, conflict, invalidTransition, validation } from "./errors";
import { sumMoney } from "./money-utils";
import { isFeeCategory, type FeeCategory, type InvoiceStatus, type IsoDate, type Uuid } from "./types";

export interface InvoiceLineInput {
  feeId?: Uuid | null;
  category: FeeCategory;
  description: string;
  quantity?: number;
  unitAmount: Money;
}

export interface InvoiceLine {
  readonly id: Uuid;
  readonly position: number;
  readonly feeId: Uuid | null;
  readonly category: FeeCategory;
  readonly description: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  /** quantité × prix unitaire */
  readonly gross: Money;
  readonly discount: Money;
  readonly scholarship: Money;
  /** brut − remise − bourse */
  readonly total: Money;
}

export interface InvoiceTotals {
  readonly subtotal: Money;
  readonly discount: Money;
  readonly scholarship: Money;
  readonly total: Money;
}

const MAX_LINES = 200;
const MAX_QUANTITY = 10_000;

export function buildInvoiceLines(
  inputs: ReadonlyArray<InvoiceLineInput>,
  idFactory: () => Uuid,
  currency: CurrencyCode,
): Result<InvoiceLine[], AppError> {
  if (inputs.length === 0) return err(validation(FinanceCode.INVALID_INPUT, "Une facture contient au moins une ligne.", "lines"));
  if (inputs.length > MAX_LINES) return err(validation(FinanceCode.INVALID_INPUT, `Une facture ne dépasse pas ${MAX_LINES} lignes.`, "lines"));
  const lines: InvoiceLine[] = [];
  for (const [i, input] of inputs.entries()) {
    const path = ["lines", i] as const;
    if (!isFeeCategory(input.category)) {
      return err(validation(FinanceCode.INVALID_INPUT, "Catégorie de frais inconnue.", [...path, "category"]));
    }
    const description = (input.description ?? "").trim();
    if (!description || description.length > 300) {
      return err(validation(FinanceCode.INVALID_INPUT, "Description de ligne requise (300 caractères max).", [...path, "description"]));
    }
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return err(validation(FinanceCode.INVALID_INPUT, `Quantité invalide (entier de 1 à ${MAX_QUANTITY}).`, [...path, "quantity"]));
    }
    if (input.unitAmount.currency !== currency) {
      return err(validation(FinanceCode.CURRENCY_MISMATCH, "Toutes les lignes doivent être dans la devise de la facture.", [...path, "unitAmount"]));
    }
    if (input.unitAmount.isNegative()) {
      return err(validation(FinanceCode.INVALID_AMOUNT, "Un prix unitaire ne peut pas être négatif.", [...path, "unitAmount"]));
    }
    const gross = input.unitAmount.multiply(quantity);
    lines.push({
      id: idFactory(),
      position: i + 1,
      feeId: input.feeId ?? null,
      category: input.category,
      description,
      quantity,
      unitAmount: input.unitAmount,
      gross,
      discount: Money.zero(currency),
      scholarship: Money.zero(currency),
      total: gross,
    });
  }
  return ok(lines);
}

/** Applique remises et bourses (par ligne) ; refuse un total de ligne négatif. */
export function applyAdjustments(
  lines: ReadonlyArray<InvoiceLine>,
  discountByLine: ReadonlyMap<Uuid, Money>,
  scholarshipByLine: ReadonlyMap<Uuid, Money>,
): Result<InvoiceLine[], AppError> {
  const out: InvoiceLine[] = [];
  for (const line of lines) {
    const currency = line.gross.currency;
    const discount = discountByLine.get(line.id) ?? Money.zero(currency);
    const scholarship = scholarshipByLine.get(line.id) ?? Money.zero(currency);
    const total = line.gross.subtract(discount).subtract(scholarship);
    if (total.isNegative() || discount.isNegative() || scholarship.isNegative()) {
      return err(
        validation(FinanceCode.INVALID_AMOUNT, "Les remises et bourses dépassent le montant de la ligne.", ["lines", line.position - 1]),
      );
    }
    out.push({ ...line, discount, scholarship, total });
  }
  return ok(out);
}

export function computeInvoiceTotals(lines: ReadonlyArray<InvoiceLine>, currency: CurrencyCode): InvoiceTotals {
  const subtotal = sumMoney(lines.map((l) => l.gross), currency);
  const discount = sumMoney(lines.map((l) => l.discount), currency);
  const scholarship = sumMoney(lines.map((l) => l.scholarship), currency);
  const total = sumMoney(lines.map((l) => l.total), currency);
  return { subtotal, discount, scholarship, total };
}

// ---------------------------------------------------------------------------
// Machine d'états
// ---------------------------------------------------------------------------

export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, ReadonlyArray<InvoiceStatus>>> = Object.freeze({
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "CREDITED"],
  PARTIALLY_PAID: ["ISSUED", "PAID", "OVERDUE"],
  OVERDUE: ["ISSUED", "PARTIALLY_PAID", "PAID", "CREDITED", "CANCELLED"],
  PAID: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"],
  CANCELLED: [],
  CREDITED: [],
});

export const TERMINAL_INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> = ["CANCELLED", "CREDITED"];

/** Factures sur lesquelles on peut encaisser. */
export const PAYABLE_INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

export const canTransitionInvoice = (from: InvoiceStatus, to: InvoiceStatus): boolean =>
  INVOICE_TRANSITIONS[from].includes(to);

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): Result<InvoiceStatus, AppError> {
  return canTransitionInvoice(from, to) ? ok(to) : err(invalidTransition("la facture", from, to));
}

export interface InvoiceAmounts {
  readonly total: Money;
  /** Encaissé NET des remboursements (imputations moins reprises). */
  readonly paid: Money;
  readonly credited: Money;
}

export const invoiceBalance = (a: InvoiceAmounts): Money => a.total.subtract(a.paid).subtract(a.credited);

export function validateInvoiceAmounts(a: InvoiceAmounts): Result<InvoiceAmounts, AppError> {
  if (a.total.isNegative() || a.paid.isNegative() || a.credited.isNegative()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Aucun montant de facture ne peut être négatif.", "amounts"));
  }
  if (a.paid.add(a.credited).gt(a.total)) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Encaissé + crédité dépasse le total de la facture.", "amounts"));
  }
  return ok(a);
}

export interface DerivationInput {
  current: InvoiceStatus;
  amounts: InvoiceAmounts;
  installments: ReadonlyArray<{ dueDate: IsoDate; amount: Money; paid: Money; credited: Money }>;
  today: IsoDate;
}

/**
 * Statut attendu d'une facture émise d'après ses montants et ses échéances.
 * DRAFT et CANCELLED ne sont jamais dérivés (décisions explicites).
 */
export function deriveInvoiceStatus(input: DerivationInput): InvoiceStatus {
  const { current, amounts, installments, today } = input;
  if (current === "DRAFT" || current === "CANCELLED") return current;
  const balance = invoiceBalance(amounts);
  if (balance.isZero()) {
    if (amounts.paid.isZero() && amounts.credited.isPositive()) return "CREDITED";
    return "PAID";
  }
  const overdue = installments.some(
    (i) => i.amount.subtract(i.paid).subtract(i.credited).isPositive() && compareDates(i.dueDate, today) < 0,
  );
  if (overdue) return "OVERDUE";
  return amounts.paid.isPositive() ? "PARTIALLY_PAID" : "ISSUED";
}

/** Statut à enregistrer ; `Err` si la transition dérivée est illégale (incohérence détectée). */
export function nextInvoiceStatus(input: DerivationInput): Result<InvoiceStatus, AppError> {
  const target = deriveInvoiceStatus(input);
  if (target === input.current) return ok(target);
  return assertInvoiceTransition(input.current, target);
}

export function canCancelInvoice(invoice: { status: InvoiceStatus; amounts: InvoiceAmounts }): Result<true, AppError> {
  // Motif le plus parlant d'abord : une facture encaissée se corrige par remboursement + avoir.
  if (invoice.amounts.paid.isPositive()) {
    return err(
      conflict(FinanceCode.INVOICE_HAS_PAYMENTS, "Une facture encaissée ne s'annule pas : remboursez puis émettez un avoir.", {
        paid: invoice.amounts.paid.amount,
      }),
    );
  }
  if (!canTransitionInvoice(invoice.status, "CANCELLED")) {
    return err(invalidTransition("la facture", invoice.status, "CANCELLED"));
  }
  if (invoice.amounts.credited.isPositive()) {
    return err(conflict(FinanceCode.INVOICE_HAS_PAYMENTS, "Une facture ayant des avoirs ne s'annule pas.", {}));
  }
  return ok(true);
}

export function canIssueInvoice(invoice: { status: InvoiceStatus; total: Money; lineCount: number }): Result<true, AppError> {
  if (invoice.status !== "DRAFT") {
    return err(conflict(FinanceCode.INVOICE_NOT_DRAFT, "Seul un brouillon peut être émis.", { status: invoice.status }));
  }
  if (invoice.lineCount === 0 || !invoice.total.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Une facture émise a au moins une ligne et un total strictement positif.", "total"));
  }
  return ok(true);
}
