/**
 * Discount : remise en POURCENTAGE (points de base) ou en MONTANT, avec plafonds.
 *
 * Règles (testées) :
 *  - PERCENT : `base × bps / 10 000`, arrondi HALF_UP (arrondi commercial) ;
 *  - AMOUNT  : `min(montant, base)` ;
 *  - plafond propre à la remise (`capAmount`) puis plafond global de la facture
 *    (`maxTotalBps` du brut, arrondi vers le bas) ;
 *  - une remise ne s'applique qu'aux catégories visées (`categories`, null = toutes) ;
 *  - remises NON cumulables : seule la plus avantageuse s'applique (égalité → code le
 *    plus petit) ; remises cumulables : appliquées l'une après l'autre sur le RESTE ;
 *  - le montant d'une remise est ventilé sur les lignes éligibles au prorata de leur
 *    reste, SANS PERTE (`Money.allocate`) ; une ligne n'est jamais négative.
 */
import { err, ok, Money, type AppError, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, validation } from "./errors";
import { sumMoney, minMoney } from "./money-utils";
import type { FeeCategory, Uuid } from "./types";

export type DiscountKind = "PERCENT" | "AMOUNT";

export interface Discount {
  readonly id: Uuid;
  readonly code: string;
  readonly name: string;
  readonly kind: DiscountKind;
  /** Points de base (1 % = 100) quand `kind = PERCENT`. */
  readonly bps: number | null;
  /** Montant fixe quand `kind = AMOUNT`. */
  readonly amount: Money | null;
  readonly capAmount: Money | null;
  readonly categories: ReadonlyArray<FeeCategory> | null;
  readonly stackable: boolean;
  readonly active: boolean;
}

export interface DiscountPolicy {
  /** Plafond du cumul des remises, en points de base du brut (défaut 10 000 = 100 %). */
  maxTotalBps: number;
}

export const DEFAULT_DISCOUNT_POLICY: DiscountPolicy = Object.freeze({ maxTotalBps: 10_000 });

export interface DiscountableLine {
  readonly id: string;
  readonly category: FeeCategory;
  readonly gross: Money;
}

export interface DiscountApplication {
  readonly discountId: Uuid;
  readonly amount: Money;
}

export interface DiscountResult {
  readonly perLine: ReadonlyArray<{ lineId: string; amount: Money }>;
  readonly applied: ReadonlyArray<DiscountApplication>;
  readonly total: Money;
}

export function computeDiscountAmount(base: Money, discount: Discount): Money {
  let amount: Money;
  if (discount.kind === "PERCENT") {
    amount = base.applyBasisPoints(discount.bps ?? 0, "HALF_UP");
  } else {
    amount = discount.amount ? minMoney(discount.amount, base) : Money.zero(base.currency);
  }
  if (discount.capAmount) amount = minMoney(amount, discount.capAmount);
  return minMoney(amount, base);
}

const appliesTo = (d: Discount, category: FeeCategory): boolean =>
  d.categories === null || d.categories.length === 0 || d.categories.includes(category);

export function applyDiscounts(
  lines: ReadonlyArray<DiscountableLine>,
  discounts: ReadonlyArray<Discount>,
  policy: DiscountPolicy = DEFAULT_DISCOUNT_POLICY,
): Result<DiscountResult, AppError> {
  if (!Number.isInteger(policy.maxTotalBps) || policy.maxTotalBps < 0 || policy.maxTotalBps > 10_000) {
    return err(validation(FinanceCode.INVALID_INPUT, "Plafond global de remise invalide (0 à 10 000 points de base).", "maxTotalBps"));
  }
  const currency = lines[0]?.gross.currency;
  if (!currency) return ok({ perLine: [], applied: [], total: Money.zero() });
  if (lines.some((l) => l.gross.currency !== currency)) {
    return err(validation(FinanceCode.CURRENCY_MISMATCH, "Toutes les lignes doivent avoir la même devise.", "lines"));
  }

  const active = discounts.filter((d) => d.active);
  const remaining = lines.map((l) => l.gross);
  const grossTotal = sumMoney(remaining, currency);
  const maxTotal = grossTotal.applyBasisPoints(policy.maxTotalBps, "DOWN");
  const discountOfLine = lines.map(() => Money.zero(currency));
  const applied: DiscountApplication[] = [];
  let totalApplied = Money.zero(currency);

  const eligibleIndexes = (d: Discount): number[] =>
    lines.flatMap((l, i) => (appliesTo(d, l.category) && remaining[i]!.isPositive() ? [i] : []));

  // 1. Remises non cumulables : la plus avantageuse (sur le brut) gagne.
  const exclusive = active.filter((d) => !d.stackable);
  let bestExclusive: Discount | undefined;
  let bestAmount = Money.zero(currency);
  for (const d of [...exclusive].sort((a, b) => a.code.localeCompare(b.code))) {
    const base = sumMoney(eligibleIndexes(d).map((i) => remaining[i]!), currency);
    const amount = computeDiscountAmount(base, d);
    if (!bestExclusive || amount.gt(bestAmount)) {
      bestExclusive = d;
      bestAmount = amount;
    }
  }

  const ordered: Discount[] = [
    ...(bestExclusive ? [bestExclusive] : []),
    ...active.filter((d) => d.stackable).sort((a, b) => a.code.localeCompare(b.code)),
  ];

  for (const d of ordered) {
    const idx = eligibleIndexes(d);
    const base = sumMoney(idx.map((i) => remaining[i]!), currency);
    if (base.isZero()) continue;
    let amount = computeDiscountAmount(base, d);
    amount = minMoney(amount, maxTotal.subtract(totalApplied));
    if (!amount.isPositive()) continue;
    // Ventilation sans perte au prorata du reste de chaque ligne éligible.
    const parts = amount.allocate(idx.map((i) => remaining[i]!.amount));
    idx.forEach((lineIndex, k) => {
      const part = parts[k]!;
      remaining[lineIndex] = remaining[lineIndex]!.subtract(part);
      discountOfLine[lineIndex] = discountOfLine[lineIndex]!.add(part);
    });
    totalApplied = totalApplied.add(amount);
    applied.push({ discountId: d.id, amount });
  }

  return ok({
    perLine: lines.map((l, i) => ({ lineId: l.id, amount: discountOfLine[i]! })),
    applied,
    total: totalApplied,
  });
}

export interface DiscountDraft {
  code: string;
  name: string;
  kind: string;
  bps?: number | null;
  amount?: Money | null;
  capAmount?: Money | null;
  categories?: FeeCategory[] | null;
  stackable?: boolean;
}

export function validateDiscountDraft(draft: DiscountDraft): Result<Omit<Discount, "id" | "active">, AppError> {
  const code = (draft.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Code de remise invalide.", "code"));
  }
  const name = (draft.name ?? "").trim();
  if (!name) return err(validation(FinanceCode.INVALID_INPUT, "Libellé de remise requis.", "name"));
  if (draft.kind !== "PERCENT" && draft.kind !== "AMOUNT") {
    return err(validation(FinanceCode.INVALID_INPUT, "Type de remise inconnu (PERCENT ou AMOUNT).", "kind"));
  }
  if (draft.kind === "PERCENT") {
    const bps = draft.bps;
    if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 1 || bps > 10_000) {
      return err(validation(FinanceCode.INVALID_INPUT, "Un pourcentage est exprimé en points de base entiers (1 à 10 000).", "bps"));
    }
    if (draft.amount) return err(validation(FinanceCode.INVALID_INPUT, "Une remise en pourcentage n'a pas de montant fixe.", "amount"));
  } else {
    if (!draft.amount || !draft.amount.isPositive()) {
      return err(validation(FinanceCode.INVALID_AMOUNT, "Une remise en montant exige un montant strictement positif.", "amount"));
    }
    if (draft.bps) return err(validation(FinanceCode.INVALID_INPUT, "Une remise en montant n'a pas de pourcentage.", "bps"));
  }
  if (draft.capAmount && !draft.capAmount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le plafond d'une remise doit être strictement positif.", "capAmount"));
  }
  return ok({
    code,
    name,
    kind: draft.kind,
    bps: draft.kind === "PERCENT" ? (draft.bps as number) : null,
    amount: draft.kind === "AMOUNT" ? (draft.amount as Money) : null,
    capAmount: draft.capAmount ?? null,
    categories: draft.categories && draft.categories.length > 0 ? [...draft.categories] : null,
    stackable: draft.stackable ?? false,
  });
}
