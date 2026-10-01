/**
 * Calculs purs du reporting financier : taux de recouvrement, balance âgée,
 * agrégats. Les requêtes SQL (infrastructure) font l'agrégation sur de gros
 * volumes ; ces fonctions portent les RÈGLES (seuils, arrondis) et servent de
 * référence aux tests de cohérence SQL ↔ domaine.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import { diffDays } from "./dates";
import { installmentRemaining, type Installment } from "./installments";
import { sumMoney } from "./money-utils";
import type { InvoiceStatus, IsoDate } from "./types";

/** Taux de recouvrement en points de base (8 750 = 87,50 %) ; `null` si rien n'est à recouvrer. */
export function collectionRateBps(collected: Money, netBilled: Money): number | null {
  if (!netBilled.isPositive()) return null;
  const bps = collected.multiplyRatio(10_000, netBilled.amount, "HALF_UP").amount;
  return Math.min(10_000, Math.max(0, bps));
}

export const AGING_BUCKETS = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_PLUS"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS_FR: Readonly<Record<AgingBucket, string>> = Object.freeze({
  NOT_DUE: "Non échu",
  D1_30: "1 à 30 jours",
  D31_60: "31 à 60 jours",
  D61_90: "61 à 90 jours",
  D91_PLUS: "Plus de 90 jours",
});

/** Tranche d'ancienneté d'une créance échue depuis `daysPastDue` jours (≤ 0 : non échue). */
export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "NOT_DUE";
  if (daysPastDue <= 30) return "D1_30";
  if (daysPastDue <= 60) return "D31_60";
  if (daysPastDue <= 90) return "D61_90";
  return "D91_PLUS";
}

export interface ReceivableInstallment {
  invoiceId: string;
  status: InvoiceStatus;
  installment: Installment;
}

/** Statuts comptés dans le facturé. */
export const BILLED_STATUSES: ReadonlyArray<InvoiceStatus> = ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDITED"];
/** Statuts portant une créance recouvrable. */
export const RECEIVABLE_STATUSES: ReadonlyArray<InvoiceStatus> = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

export type AgedBalance = Record<AgingBucket, Money>;

export function emptyAgedBalance(currency: CurrencyCode): AgedBalance {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, Money.zero(currency)])) as AgedBalance;
}

/** Balance âgée de référence : reste dû de chaque échéance, par ancienneté à `asOf`. */
export function computeAgedBalance(rows: ReadonlyArray<ReceivableInstallment>, asOf: IsoDate, currency: CurrencyCode): AgedBalance {
  const out = emptyAgedBalance(currency);
  for (const r of rows) {
    if (!RECEIVABLE_STATUSES.includes(r.status)) continue;
    const remaining = installmentRemaining(r.installment);
    if (!remaining.isPositive()) continue;
    const bucket = agingBucket(diffDays(r.installment.dueDate, asOf));
    out[bucket] = out[bucket].add(remaining);
  }
  return out;
}

export interface ReceivablesInput {
  status: InvoiceStatus;
  total: Money;
  paid: Money;
  credited: Money;
}

export interface ReceivablesSummary {
  billed: Money;
  credited: Money;
  netBilled: Money;
  collected: Money;
  outstanding: Money;
  collectionRateBps: number | null;
}

/** Synthèse de référence : facturé, encaissé, restant dû, taux de recouvrement. */
export function summarizeReceivables(invoices: ReadonlyArray<ReceivablesInput>, currency: CurrencyCode): ReceivablesSummary {
  const counted = invoices.filter((i) => BILLED_STATUSES.includes(i.status));
  const billed = sumMoney(counted.map((i) => i.total), currency);
  const credited = sumMoney(counted.map((i) => i.credited), currency);
  const collected = sumMoney(counted.map((i) => i.paid), currency);
  const netBilled = billed.subtract(credited);
  return {
    billed,
    credited,
    netBilled,
    collected,
    outstanding: netBilled.subtract(collected),
    collectionRateBps: collectionRateBps(collected, netBilled),
  };
}
