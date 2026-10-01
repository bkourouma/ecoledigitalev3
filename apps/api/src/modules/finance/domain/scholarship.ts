/**
 * Scholarship : prise en charge d'une partie de la facture d'un apprenant par un
 * financeur (bourse, État pour un élève `STATE_ASSIGNED`, entreprise…).
 *
 * Le financeur paie SA part ; la famille (le « parent ») paie le reste. La part de
 * chaque financeur est ventilée sur les lignes éligibles au prorata de leur reste,
 * SANS PERTE : somme des parts financeurs + part parent = total net, au franc près.
 *
 * Ordre d'application : `priority` croissante puis `id` (déterministe). Chaque
 * bourse se calcule sur le RESTE après remises et après les bourses précédentes.
 */
import { err, ok, Money, type AppError, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, validation } from "./errors";
import { minMoney, sumMoney } from "./money-utils";
import type { FeeCategory, FunderKind, ScholarshipStatus, Uuid } from "./types";
import { FUNDER_KINDS } from "./types";

export type Coverage =
  | { readonly kind: "PERCENT"; readonly bps: number }
  | { readonly kind: "FIXED"; readonly amount: Money };

export interface Scholarship {
  readonly id: Uuid;
  readonly learnerId: Uuid;
  readonly academicYear: string;
  readonly funderKind: FunderKind;
  /** Nom ou identifiant du financeur (ex. « État de Côte d'Ivoire », « MTN Foundation »). */
  readonly funderName: string;
  /** Référence d'affectation / de convention (PRD §20 : « référence d'affectation »). */
  readonly reference: string | null;
  readonly coverage: Coverage;
  readonly capAmount: Money | null;
  readonly categories: ReadonlyArray<FeeCategory> | null;
  readonly status: ScholarshipStatus;
  readonly priority: number;
}

export interface FundableLine {
  readonly id: string;
  readonly category: FeeCategory;
  /** Montant de la ligne après remises, avant bourses. */
  readonly amount: Money;
}

export interface FunderShare {
  readonly scholarshipId: Uuid;
  readonly funderKind: FunderKind;
  readonly funderName: string;
  readonly total: Money;
  readonly perLine: ReadonlyArray<{ lineId: string; amount: Money }>;
}

export interface FundingSplit {
  readonly shares: ReadonlyArray<FunderShare>;
  /** Part financée, toutes bourses confondues, par ligne. */
  readonly fundedPerLine: ReadonlyArray<{ lineId: string; amount: Money }>;
  readonly fundedTotal: Money;
  /** Part restant à la charge de la famille. */
  readonly parentTotal: Money;
  readonly parentPerLine: ReadonlyArray<{ lineId: string; amount: Money }>;
}

const covers = (s: Scholarship, category: FeeCategory): boolean =>
  s.categories === null || s.categories.length === 0 || s.categories.includes(category);

export function computeScholarshipAmount(base: Money, s: Scholarship): Money {
  let amount: Money =
    s.coverage.kind === "PERCENT" ? base.applyBasisPoints(s.coverage.bps, "HALF_UP") : minMoney(s.coverage.amount, base);
  if (s.capAmount) amount = minMoney(amount, s.capAmount);
  return minMoney(amount, base);
}

export function splitFunding(
  lines: ReadonlyArray<FundableLine>,
  scholarships: ReadonlyArray<Scholarship>,
): Result<FundingSplit, AppError> {
  const currency = lines[0]?.amount.currency;
  if (!currency) {
    return ok({ shares: [], fundedPerLine: [], fundedTotal: Money.zero(), parentTotal: Money.zero(), parentPerLine: [] });
  }
  if (lines.some((l) => l.amount.currency !== currency)) {
    return err(validation(FinanceCode.CURRENCY_MISMATCH, "Toutes les lignes doivent avoir la même devise.", "lines"));
  }
  const remaining = lines.map((l) => l.amount);
  const funded = lines.map(() => Money.zero(currency));
  const shares: FunderShare[] = [];

  const ordered = scholarships
    .filter((s) => s.status === "ACTIVE")
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const s of ordered) {
    const idx = lines.flatMap((l, i) => (covers(s, l.category) && remaining[i]!.isPositive() ? [i] : []));
    const base = sumMoney(idx.map((i) => remaining[i]!), currency);
    if (base.isZero()) continue;
    const amount = computeScholarshipAmount(base, s);
    if (!amount.isPositive()) continue;
    const parts = amount.allocate(idx.map((i) => remaining[i]!.amount));
    const perLine: Array<{ lineId: string; amount: Money }> = [];
    idx.forEach((lineIndex, k) => {
      const part = parts[k]!;
      remaining[lineIndex] = remaining[lineIndex]!.subtract(part);
      funded[lineIndex] = funded[lineIndex]!.add(part);
      if (part.isPositive()) perLine.push({ lineId: lines[lineIndex]!.id, amount: part });
    });
    shares.push({ scholarshipId: s.id, funderKind: s.funderKind, funderName: s.funderName, total: amount, perLine });
  }

  const fundedTotal = sumMoney(funded, currency);
  return ok({
    shares,
    fundedPerLine: lines.map((l, i) => ({ lineId: l.id, amount: funded[i]! })),
    fundedTotal,
    parentTotal: sumMoney(remaining, currency),
    parentPerLine: lines.map((l, i) => ({ lineId: l.id, amount: remaining[i]! })),
  });
}

/** Résumé État / parent d'un partage (vue « élève affecté », PRD §20). */
export function summarizeStateSplit(split: FundingSplit): { state: Money; otherFunders: Money; parent: Money } {
  const currency = split.parentTotal.currency;
  const state = sumMoney(
    split.shares.filter((s) => s.funderKind === "STATE").map((s) => s.total),
    currency,
  );
  return { state, otherFunders: split.fundedTotal.subtract(state), parent: split.parentTotal };
}

export interface ScholarshipDraft {
  learnerId: Uuid;
  academicYear: string;
  funderKind: string;
  funderName: string;
  reference?: string | null;
  coverage: { kind: string; bps?: number; amount?: Money };
  capAmount?: Money | null;
  categories?: FeeCategory[] | null;
  priority?: number;
}

export function validateScholarshipDraft(draft: ScholarshipDraft): Result<Omit<Scholarship, "id" | "status">, AppError> {
  if (!(FUNDER_KINDS as readonly string[]).includes(draft.funderKind)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Type de financeur inconnu.", "funderKind"));
  }
  const funderName = (draft.funderName ?? "").trim();
  if (!funderName) return err(validation(FinanceCode.INVALID_INPUT, "Nom du financeur requis.", "funderName"));
  const academicYear = (draft.academicYear ?? "").trim();
  if (!academicYear) return err(validation(FinanceCode.INVALID_INPUT, "Année scolaire requise.", "academicYear"));
  let coverage: Coverage;
  if (draft.coverage.kind === "PERCENT") {
    const bps = draft.coverage.bps;
    if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 1 || bps > 10_000) {
      return err(validation(FinanceCode.INVALID_INPUT, "Couverture en points de base entiers (1 à 10 000).", "coverage.bps"));
    }
    coverage = { kind: "PERCENT", bps };
  } else if (draft.coverage.kind === "FIXED") {
    if (!draft.coverage.amount || !draft.coverage.amount.isPositive()) {
      return err(validation(FinanceCode.INVALID_AMOUNT, "Couverture fixe : montant strictement positif requis.", "coverage.amount"));
    }
    coverage = { kind: "FIXED", amount: draft.coverage.amount };
  } else {
    return err(validation(FinanceCode.INVALID_INPUT, "Couverture inconnue (PERCENT ou FIXED).", "coverage.kind"));
  }
  if (draft.capAmount && !draft.capAmount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Plafond de bourse invalide.", "capAmount"));
  }
  return ok({
    learnerId: draft.learnerId,
    academicYear,
    funderKind: draft.funderKind as FunderKind,
    funderName,
    reference: draft.reference?.trim() || null,
    coverage,
    capAmount: draft.capAmount ?? null,
    categories: draft.categories && draft.categories.length > 0 ? [...draft.categories] : null,
    priority: draft.priority ?? 100,
  });
}

/**
 * Un élève `STATE_ASSIGNED` doit avoir au moins une prise en charge ACTIVE de
 * l'État pour l'année : sans elle on refuse de facturer le tout à la famille par
 * erreur silencieuse.
 */
export function hasActiveStateAssignment(scholarships: ReadonlyArray<Scholarship>, academicYear: string): boolean {
  return scholarships.some((s) => s.status === "ACTIVE" && s.funderKind === "STATE" && s.academicYear === academicYear);
}
