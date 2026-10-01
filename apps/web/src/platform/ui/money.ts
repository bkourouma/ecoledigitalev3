"use client";

import { useFormatter } from "next-intl";

/**
 * Montants : l'API renvoie des ENTIERS en unités mineures (XOF : le franc, sans décimales). Ce module ne fait AUCUN calcul
 * financier : il met en forme ce que l'API a calculé (`{ amount, currency }`) et lit la saisie d'un montant entier.
 * Formatage : `Intl` `fr-CI` via `useFormatter()` (« 1 234 567 F CFA »), jamais de formatage manuel.
 */

export interface MoneyLike {
  amount: number;
  currency: string;
}

/** Nombre de décimales de l'unité majeure (XOF / XAF : 0 ; EUR / USD : 2). Sert uniquement à l'AFFICHAGE. */
const EXPONENTS: Readonly<Record<string, number>> = { XOF: 0, XAF: 0, EUR: 2, USD: 2 };

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency] ?? 0;
}

export function useMoney() {
  const format = useFormatter();
  const fmt = (amount: number | null | undefined, currency = "XOF"): string => {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
    const exponent = currencyExponent(currency);
    try {
      return format.number(amount / 10 ** exponent, { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent });
    } catch {
      return `${format.number(amount)} ${currency}`;
    }
  };
  return {
    /** `fmt(150000)` -> « 150 000 F CFA ». */
    fmt,
    /** Montant de l'API (`{ amount, currency }`) ; `null` -> « — ». */
    of: (money: MoneyLike | null | undefined): string => (money ? fmt(money.amount, money.currency) : "—"),
    /** Points de base (8750) -> « 87,50 % » (affichage seulement). */
    bps: (value: number | null | undefined): string =>
      value === null || value === undefined ? "—" : format.number(value / 10_000, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    /** Millièmes (1500) -> « ×1,5 » (majoration d'heures supplémentaires). */
    permille: (value: number | null | undefined): string => (value === null || value === undefined ? "—" : `×${format.number(value / 1000, { maximumFractionDigits: 3 })}`),
    /** Minutes entières -> « 2 h 30 » (durée). */
    minutes: (value: number | null | undefined): string => {
      if (value === null || value === undefined) return "—";
      const h = Math.trunc(value / 60);
      const m = value % 60;
      return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
    },
  };
}

export type AmountParse =
  | { ok: true; amount: number }
  | { ok: false; reason: "empty" | "decimal" | "negative" | "invalid" | "tooLarge" };

/**
 * Lit un montant ENTIER saisi par l'utilisateur (« 150 000 », « 150000 ») : espaces (y compris insécables) ignorés ;
 * toute décimale ou tout séparateur de milliers ambigu (« 1.500 », « 1,5 ») est REFUSÉ plutôt que deviné, car un franc
 * CFA n'a pas de sous-unité et une virgule mal lue changerait le montant d'un facteur 1 000.
 */
export function parseAmountInput(text: string, { allowZero = false }: { allowZero?: boolean } = {}): AmountParse {
  const cleaned = text.replace(/[\s   ]/g, "");
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (/^-/.test(cleaned)) return { ok: false, reason: "negative" };
  if (/[.,]/.test(cleaned)) return { ok: false, reason: "decimal" };
  if (!/^\d+$/.test(cleaned)) return { ok: false, reason: "invalid" };
  if (cleaned.length > 15) return { ok: false, reason: "tooLarge" };
  const amount = Number(cleaned);
  if (!Number.isSafeInteger(amount)) return { ok: false, reason: "tooLarge" };
  if (amount === 0 && !allowZero) return { ok: false, reason: "invalid" };
  return { ok: true, amount };
}

export type PercentParse = { ok: true; bps: number } | { ok: false; reason: "empty" | "invalid" | "range" };

/**
 * Lit un POURCENTAGE saisi (« 10 », « 12,5 », « 12.25 ») et le convertit en points de base entiers (1 % = 100) par
 * lecture de chaîne — sans flottant — pour la valeur transmise à l'API (`bps`). 2 décimales au plus ; de 0,01 % à 100 %.
 */
export function parsePercentToBps(text: string): PercentParse {
  const cleaned = text.replace(/[\s  %]/g, "").replace(",", ".");
  if (cleaned === "") return { ok: false, reason: "empty" };
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false, reason: "invalid" };
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (bps < 1 || bps > 10_000) return { ok: false, reason: "range" };
  return { ok: true, bps };
}
