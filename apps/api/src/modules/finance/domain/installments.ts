/**
 * Échéanciers : plan type → échéances, statut d'une échéance, application d'un avoir.
 *
 * Exemple du PRD §32 : scolarité 500 000 FCFA =
 *   inscription 100 000 + 15/10 : 150 000 + 15/01 : 150 000 + 15/03 : 100 000,
 * soit un plan à poids [100, 150, 150, 100] ou à montants fixes — dans les deux cas
 * la somme des échéances égale EXACTEMENT le total (répartition sans perte du kernel).
 *
 * Chaque étape de plan est soit FIXED (montant imposé), soit WEIGHT (poids entier).
 * Les étapes FIXED sont prélevées d'abord ; le reste est réparti entre les étapes
 * WEIGHT par la méthode du plus fort reste (`Money.allocate`).
 */
import { err, ok, Money, type AppError, type CurrencyCode, type Result } from "@ecoledigitale/kernel";
import { addDays, assertIsoDate, compareDates, diffDays, nextMonthDayOnOrAfter } from "./dates";
import { FinanceCode, conflict, validation } from "./errors";
import { sumMoney } from "./money-utils";
import type { IsoDate, Uuid } from "./types";

export type DueRule =
  | { readonly type: "DATE"; readonly date: IsoDate }
  | { readonly type: "OFFSET_DAYS"; readonly days: number }
  | { readonly type: "MONTH_DAY"; readonly month: number; readonly day: number };

export type PlanShare =
  | { readonly kind: "FIXED"; readonly amount: Money }
  | { readonly kind: "WEIGHT"; readonly weight: number };

export interface PlanStep {
  readonly label: string;
  readonly share: PlanShare;
  readonly due: DueRule;
}

export interface InstallmentPlan {
  readonly id: Uuid;
  readonly code: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly steps: ReadonlyArray<PlanStep>;
  readonly active: boolean;
}

export interface GeneratedInstallment {
  readonly seq: number;
  readonly label: string;
  readonly dueDate: IsoDate;
  readonly amount: Money;
}

/** Échéance d'une facture avec ses cumuls (encaissé net des remboursements, crédité). */
export interface Installment {
  readonly id: Uuid;
  readonly invoiceId: Uuid;
  readonly seq: number;
  readonly label: string;
  readonly dueDate: IsoDate;
  readonly amount: Money;
  readonly paid: Money;
  readonly credited: Money;
}

export type InstallmentStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CREDITED";

export function resolveDueDate(rule: DueRule, baseDate: IsoDate): IsoDate {
  switch (rule.type) {
    case "DATE":
      return assertIsoDate(rule.date, "due.date");
    case "OFFSET_DAYS":
      return addDays(baseDate, rule.days);
    case "MONTH_DAY":
      return nextMonthDayOnOrAfter(baseDate, rule.month, rule.day);
  }
}

export function validatePlanSteps(steps: ReadonlyArray<PlanStep>, currency: CurrencyCode): Result<PlanStep[], AppError> {
  if (steps.length === 0) return err(validation(FinanceCode.PLAN_INVALID, "Un plan d'échéancier contient au moins une étape.", "steps"));
  if (steps.length > 60) return err(validation(FinanceCode.PLAN_INVALID, "Un plan d'échéancier ne dépasse pas 60 étapes.", "steps"));
  const out: PlanStep[] = [];
  for (const [i, step] of steps.entries()) {
    const path = ["steps", i] as const;
    if (!step.label || step.label.trim().length === 0 || step.label.length > 120) {
      return err(validation(FinanceCode.PLAN_INVALID, "Libellé d'étape requis (120 caractères max).", [...path, "label"]));
    }
    if (step.share.kind === "FIXED") {
      if (step.share.amount.currency !== currency || !step.share.amount.isPositive()) {
        return err(validation(FinanceCode.PLAN_INVALID, "Montant fixe d'étape : strictement positif, dans la devise du plan.", [...path, "share"]));
      }
    } else if (step.share.kind === "WEIGHT") {
      if (!Number.isInteger(step.share.weight) || step.share.weight < 1) {
        return err(validation(FinanceCode.PLAN_INVALID, "Le poids d'une étape est un entier ≥ 1.", [...path, "share"]));
      }
    } else {
      return err(validation(FinanceCode.PLAN_INVALID, "Type de part inconnu (FIXED ou WEIGHT).", [...path, "share"]));
    }
    const due = step.due;
    if (due.type === "DATE") {
      try {
        assertIsoDate(due.date);
      } catch {
        return err(validation(FinanceCode.PLAN_INVALID, "Date d'échéance invalide.", [...path, "due"]));
      }
    } else if (due.type === "OFFSET_DAYS") {
      if (!Number.isInteger(due.days) || due.days < 0 || due.days > 3650) {
        return err(validation(FinanceCode.PLAN_INVALID, "Décalage en jours : entier de 0 à 3650.", [...path, "due"]));
      }
    } else if (due.type === "MONTH_DAY") {
      if (!Number.isInteger(due.month) || due.month < 1 || due.month > 12 || !Number.isInteger(due.day) || due.day < 1 || due.day > 31) {
        return err(validation(FinanceCode.PLAN_INVALID, "Jour/mois d'échéance invalide.", [...path, "due"]));
      }
    } else {
      return err(validation(FinanceCode.PLAN_INVALID, "Type d'échéance inconnu.", [...path, "due"]));
    }
    out.push(step);
  }
  return ok(out);
}

/**
 * Génère les échéances de `total` selon `steps`, à partir de `baseDate`.
 * Garanties : somme des échéances = `total` ; aucune échéance nulle ou négative ;
 * échéances triées par date (à date égale, ordre du plan) et numérotées 1..n.
 */
export function generateInstallments(
  total: Money,
  steps: ReadonlyArray<PlanStep>,
  baseDate: IsoDate,
): Result<GeneratedInstallment[], AppError> {
  assertIsoDate(baseDate, "baseDate");
  if (!total.isPositive()) {
    return err(validation(FinanceCode.PLAN_INVALID, "Impossible d'échelonner un montant nul.", "total"));
  }
  const valid = validatePlanSteps(steps, total.currency);
  if (!valid.ok) return valid;

  const fixedSum = sumMoney(
    steps.flatMap((s) => (s.share.kind === "FIXED" ? [s.share.amount] : [])),
    total.currency,
  );
  if (fixedSum.gt(total)) {
    return err(
      conflict(FinanceCode.PLAN_INVALID, "Les montants fixes du plan dépassent le total à échelonner.", {
        fixed: fixedSum.amount,
        total: total.amount,
      }),
    );
  }
  const remainder = total.subtract(fixedSum);
  const weightSteps = steps.filter((s) => s.share.kind === "WEIGHT");
  if (weightSteps.length === 0 && !remainder.isZero()) {
    return err(
      conflict(FinanceCode.PLAN_INVALID, "Le plan ne couvre pas le total : ajoutez une étape à poids ou ajustez les montants fixes.", {
        uncovered: remainder.amount,
      }),
    );
  }

  const weightAmounts = weightSteps.length > 0 ? remainder.allocate(weightSteps.map((s) => (s.share as { weight: number }).weight)) : [];
  let w = 0;
  const raw = steps.map((step, index) => ({
    index,
    label: step.label.trim(),
    dueDate: resolveDueDate(step.due, baseDate),
    amount: step.share.kind === "FIXED" ? step.share.amount : weightAmounts[w++]!,
  }));

  const kept = raw
    .filter((r) => r.amount.isPositive())
    .sort((a, b) => compareDates(a.dueDate, b.dueDate) || a.index - b.index);
  if (kept.length === 0) return err(validation(FinanceCode.PLAN_INVALID, "Le plan ne produit aucune échéance.", "steps"));

  const result = kept.map((r, i) => ({ seq: i + 1, label: r.label, dueDate: r.dueDate, amount: r.amount }));
  // Garde-fou : la perte est impossible par construction, on le vérifie quand même.
  if (!sumMoney(result.map((r) => r.amount), total.currency).equals(total)) {
    throw new Error("generateInstallments : la somme des échéances diffère du total (invariant violé).");
  }
  return ok(result);
}

/** Échéance unique (pas de plan) : tout le solde à une seule date. */
export function singleInstallment(total: Money, dueDate: IsoDate, label = "Solde"): GeneratedInstallment[] {
  assertIsoDate(dueDate, "dueDate");
  return [{ seq: 1, label, dueDate, amount: total }];
}

export function installmentRemaining(i: Pick<Installment, "amount" | "paid" | "credited">): Money {
  return i.amount.subtract(i.paid).subtract(i.credited);
}

export function installmentStatus(i: Installment, today: IsoDate): InstallmentStatus {
  const remaining = installmentRemaining(i);
  if (remaining.isZero()) return i.credited.equals(i.amount) ? "CREDITED" : "PAID";
  if (compareDates(i.dueDate, today) < 0) return "OVERDUE";
  return i.paid.isPositive() ? "PARTIALLY_PAID" : "PENDING";
}

/** Jours de retard (0 si non échue ou soldée). */
export function daysOverdue(i: Installment, today: IsoDate): number {
  if (installmentRemaining(i).isZero()) return 0;
  return Math.max(0, diffDays(i.dueDate, today));
}

export function validateInstallmentsSum(total: Money, installments: ReadonlyArray<{ amount: Money }>): Result<true, AppError> {
  const sum = sumMoney(installments.map((i) => i.amount), total.currency);
  if (!sum.equals(total)) {
    return err(
      conflict(FinanceCode.INSTALLMENTS_MISMATCH, "La somme des échéances doit égaler le total de la facture.", {
        total: total.amount,
        installments: sum.amount,
      }),
    );
  }
  return ok(true);
}

export interface CreditApplication {
  readonly installmentId: Uuid;
  readonly amount: Money;
}

/**
 * Répartit un avoir sur les échéances : les plus TARDIVES d'abord (on allège la fin
 * de l'échéancier, jamais ce qui est déjà exigible), dans la limite du reste de
 * chacune. Renvoie `Err` si l'avoir dépasse le reste dû total.
 */
export function distributeCredit(
  installments: ReadonlyArray<Installment>,
  amount: Money,
): Result<CreditApplication[], AppError> {
  const order = installments
    .slice()
    .sort((a, b) => compareDates(b.dueDate, a.dueDate) || b.seq - a.seq);
  let left = amount;
  const out: CreditApplication[] = [];
  for (const i of order) {
    if (left.isZero()) break;
    const room = installmentRemaining(i);
    if (!room.isPositive()) continue;
    const take = room.lt(left) ? room : left;
    out.push({ installmentId: i.id, amount: take });
    left = left.subtract(take);
  }
  if (!left.isZero()) {
    return err(
      conflict(FinanceCode.CREDIT_EXCEEDS_BALANCE, "L'avoir dépasse le reste dû de la facture.", { excess: left.amount }),
    );
  }
  return ok(out);
}
