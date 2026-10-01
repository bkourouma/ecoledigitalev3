/**
 * MOTEUR DE CALCUL PUR de la paie (spec 032 US2-US4). Aucune E/S, aucune horloge, aucune constante de
 * seuil : le seuil d'heures supplémentaires et la majoration viennent de la CONFIGURATION de l'enseignant
 * (donnée, défauts du tenant dans `payroll.settings`).
 *
 * Arithmétique : montants = `Money` (entiers XOF), durées = minutes entières. Aucun flottant.
 *
 *   ligne      = round_half_up(minutes × taux × multiplicateur_permille / 60 000)          (AC2.8)
 *   salaire    = Σ mois  round_half_up(salaire_mensuel × jours_ouvrés_dus / jours_ouvrés_du_mois)  (AC4.1)
 *   total      = salaire + Σ lignes     (+ primes − retenues, ajoutées par le cas d'usage : jamais ici)
 *
 * Garanties démontrées par les tests (exemples ET propriétés) :
 *   - somme des lignes = montant des heures, par construction (le total n'est JAMAIS recalculé à part) ;
 *   - une heure n'apparaît que sur une paire de lignes (normale + majorée) et ses minutes se retrouvent
 *     exactement : Σ minutes des lignes d'une heure = sa durée ;
 *   - le résultat ne dépend pas de l'ordre dans lequel les heures sont fournies (ordre total déterministe) ;
 *   - une séance à cheval sur le seuil est COUPÉE en deux lignes (le legacy échouait et ne produisait aucun bulletin).
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import { addDays, calendarDaysBetween, monthBounds, monthsBetween, workingDaysBetween, workingDaysInMonth, intersect, weekStart, timeToMinutes } from "./calendar";
import { hourKey } from "./payability";
import type { ConfigType, HourSourceKind, IsoDate, Period, PayConfig, PayslipLineDraft, PricedHour } from "./types";

/** Dénominateur de la formule d'une ligne : minutes par heure × millièmes du multiplicateur. */
export const LINE_DENOMINATOR = 60_000;

/** Montant d'une ligne — LA définition, répliquée telle quelle par le `CHECK` SQL de `payslip_lines`. */
export function lineAmount(minutes: number, rate: Money, multiplierPermille: number): Money {
  return rate.multiplyRatio(BigInt(minutes) * BigInt(multiplierPermille), LINE_DENOMINATOR, "HALF_UP");
}

const SOURCE_ORDER: Readonly<Record<HourSourceKind, number>> = { ATTENDANCE: 0, SESSION: 1 };

/**
 * Ordre TOTAL des heures : (date, origine, heure de début [nulle en dernier], identifiant).
 * À égalité de date, l'origine ATTENDANCE précède SESSION : c'est l'ordre de fait du legacy (académique
 * collecté avant professionnel), conservé pour que les montants du legacy soient reproduits. Le legacy ne
 * triait que par date : à date égale l'ordre était arbitraire et la coupure au seuil non déterministe.
 */
export function compareHours(a: PricedHour, b: PricedHour): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const so = SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind];
  if (so !== 0) return so;
  const sa = timeToMinutes(a.startTime);
  const sb = timeToMinutes(b.startTime);
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  }
  if (a.refId !== b.refId) return a.refId < b.refId ? -1 : 1;
  return a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0;
}

export interface SalaryMonthDetail {
  /** `AAAA-MM`. */
  readonly month: string;
  readonly workingDaysInMonth: number;
  /** Jours ouvrés de la période dans ce mois. */
  readonly workingDaysInPeriod: number;
  /** Jours ouvrés déjà payés par un AUTRE bulletin non annulé (périodes chevauchantes). */
  readonly alreadyPaidDays: number;
  /** Jours ouvrés dus par ce bulletin. */
  readonly daysDue: number;
  /** Entier XOF (sérialisable telle quelle dans `calc_details`). */
  readonly amount: number;
}

export interface BreakdownLine {
  readonly label: string;
  readonly amount: number;
  readonly minutes?: number;
  readonly rate?: number;
}

export interface CalcDetails {
  readonly v: 1;
  readonly kind: ConfigType;
  readonly currency: CurrencyCode;
  readonly periodDays: number;
  readonly workingDays: number;
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly overtimeThresholdMinutes: number;
  readonly overtimeMultiplierPermille: number;
  readonly minutesBySource: Readonly<Record<HourSourceKind, number>>;
  /** Heures d'un salarié : listées à titre informatif, sans effet sur le montant (AC2.3). */
  readonly informationalMinutes: number;
  readonly salaryMonths: readonly SalaryMonthDetail[];
  readonly breakdown: readonly BreakdownLine[];
}

export interface PayslipComputation {
  readonly kind: ConfigType;
  readonly currency: CurrencyCode;
  /** Salaire (prorata, mois par mois) — 0 pour un horaire pur. */
  readonly salaryAmount: Money;
  /** Jours ouvrés de salaire que ce bulletin RÉCLAME (clé d'unicité de `salary_day_claims`). */
  readonly salaryDays: readonly IsoDate[];
  readonly lines: readonly PayslipLineDraft[];
  /** Σ lignes normales. */
  readonly regularHoursAmount: Money;
  /** Σ lignes majorées. */
  readonly overtimeAmount: Money;
  /** `base_amount` du bulletin = salaire + heures normales. */
  readonly baseAmount: Money;
  /** base + heures supplémentaires (sans primes ni retenues). */
  readonly grossAmount: Money;
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly minutesBySource: Readonly<Record<HourSourceKind, number>>;
  readonly details: CalcDetails;
}

export interface ComputeInput {
  readonly period: Period;
  readonly config: PayConfig;
  readonly hours: readonly PricedHour[];
  /** Jours ouvrés de salaire déjà réclamés par d'AUTRES bulletins non annulés du même enseignant. */
  readonly claimedSalaryDays?: ReadonlySet<IsoDate>;
  readonly currency: CurrencyCode;
}

export class PayrollCalculationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PayrollCalculationError";
  }
}

function assertConsistent(input: ComputeInput): void {
  const { config, hours } = input;
  if (!Number.isInteger(config.overtimeThresholdMinutes) || config.overtimeThresholdMinutes <= 0) {
    throw new PayrollCalculationError("payroll.config_invalid", "Le seuil d'heures supplémentaires est un nombre entier de minutes strictement positif.");
  }
  if (!Number.isInteger(config.overtimeMultiplierPermille) || config.overtimeMultiplierPermille < 1000) {
    throw new PayrollCalculationError("payroll.config_invalid", "La majoration des heures supplémentaires est d'au moins ×1,0 (1 000 ‰).");
  }
  const seen = new Set<string>();
  for (const h of hours) {
    if (!Number.isInteger(h.minutes) || h.minutes <= 0) throw new PayrollCalculationError("payroll.hour_invalid", `Durée invalide pour l'heure ${h.refId}.`);
    if (h.rate.currency !== input.currency) throw new PayrollCalculationError("payroll.currency_mismatch", "Un bulletin ne mélange jamais deux devises (R-PAY-12).");
    if (h.staffId !== config.staffId) throw new PayrollCalculationError("payroll.hour_foreign", `L'heure ${h.refId} n'appartient pas à l'enseignant du bulletin.`);
    const key = hourKey(h);
    if (seen.has(key)) throw new PayrollCalculationError("payroll.hour_duplicated", `L'heure ${key} est fournie deux fois : une heure ne se paie qu'une fois.`);
    seen.add(key);
  }
  if ((config.type === "SALARY" || config.type === "MIXED") && config.monthlySalary === null && config.annualSalary === null) {
    throw new PayrollCalculationError("payroll.config_invalid", "Configuration salariale sans salaire.");
  }
}

/** Salaire dû pour la période, mois par mois, en excluant les jours déjà payés (AC4.1). */
export function computeSalary(config: PayConfig, period: Period, claimed: ReadonlySet<IsoDate>, currency: CurrencyCode): { amount: Money; months: SalaryMonthDetail[]; days: IsoDate[] } {
  const months: SalaryMonthDetail[] = [];
  const days: IsoDate[] = [];
  let total = Money.zero(currency);
  const annual = config.monthlySalary === null ? config.annualSalary : null;
  for (const month of monthsBetween(period.startDate, period.endDate)) {
    const bounds = monthBounds(month);
    const span = intersect({ from: period.startDate, to: period.endDate }, { from: bounds.first, to: bounds.last });
    if (!span) continue;
    const inPeriod = workingDaysBetween(span.from, span.to);
    const due = inPeriod.filter((d) => !claimed.has(d));
    const monthWorking = workingDaysInMonth(month);
    let amount = Money.zero(currency);
    if (due.length > 0) {
      // Salaire mensuel déclaré, sinon annuel / 12 : le quotient reste EXACT jusqu'à l'unique arrondi du mois.
      amount =
        config.monthlySalary !== null
          ? config.monthlySalary.multiplyRatio(due.length, monthWorking, "HALF_UP")
          : (annual as Money).multiplyRatio(due.length, 12 * monthWorking, "HALF_UP");
    }
    months.push({ month, workingDaysInMonth: monthWorking, workingDaysInPeriod: inPeriod.length, alreadyPaidDays: inPeriod.length - due.length, daysDue: due.length, amount: amount.amount });
    days.push(...due);
    total = total.add(amount);
  }
  return { amount: total, months, days };
}

/** Lignes d'heures : semaines lundi-dimanche, cumul TOUTES origines, fraction au-delà du seuil majorée. */
function computeHourLines(hours: readonly PricedHour[], config: PayConfig, currency: CurrencyCode): PayslipLineDraft[] {
  const ordered = [...hours].sort(compareHours);
  const lines: PayslipLineDraft[] = [];
  const cumulByWeek = new Map<IsoDate, number>();
  for (const h of ordered) {
    const wk = weekStart(h.date);
    const before = cumulByWeek.get(wk) ?? 0;
    const after = before + h.minutes;
    cumulByWeek.set(wk, after);
    // Seule la fraction qui dépasse le seuil bascule en heures supplémentaires.
    const overtimeMinutes = Math.max(0, Math.min(h.minutes, after - config.overtimeThresholdMinutes));
    const regularMinutes = h.minutes - overtimeMinutes;
    const base = {
      sourceKind: h.kind,
      sourceRefId: h.refId,
      staffId: h.staffId,
      sessionDate: h.date,
      startTime: h.startTime,
      rate: h.rate,
      rateOrigin: h.rateOrigin,
      nodeId: h.nodeId,
      classroomId: h.classroomId,
      label: h.label,
      code: h.code,
      classroomLabel: h.classroomLabel,
    } as const;
    if (regularMinutes > 0) {
      lines.push({ ...base, position: lines.length, minutes: regularMinutes, multiplierPermille: 1000, amount: lineAmount(regularMinutes, h.rate, 1000), isOvertime: false });
    }
    if (overtimeMinutes > 0) {
      const m = config.overtimeMultiplierPermille;
      lines.push({ ...base, position: lines.length, minutes: overtimeMinutes, multiplierPermille: m, amount: lineAmount(overtimeMinutes, h.rate, m), isOvertime: true });
    }
  }
  return lines;
}

const sumMinutesBySource = (hours: readonly { kind: HourSourceKind; minutes: number }[]): Record<HourSourceKind, number> => {
  const acc: Record<HourSourceKind, number> = { SESSION: 0, ATTENDANCE: 0 };
  for (const h of hours) acc[h.kind] += h.minutes;
  return acc;
};

/** Calcul pur d'un bulletin (hors primes et retenues). */
export function computePayslip(input: ComputeInput): PayslipComputation {
  assertConsistent(input);
  const { config, period, currency } = input;
  const zero = Money.zero(currency);
  const claimed = input.claimedSalaryDays ?? new Set<IsoDate>();

  const paysHours = config.type === "HOURLY" || config.type === "MIXED";
  const paysSalary = config.type === "SALARY" || config.type === "MIXED";

  const salary = paysSalary ? computeSalary(config, period, claimed, currency) : { amount: zero, months: [] as SalaryMonthDetail[], days: [] as IsoDate[] };
  const lines = paysHours ? computeHourLines(input.hours, config, currency) : [];

  const regularHoursAmount = Money.sum(lines.filter((l) => !l.isOvertime).map((l) => l.amount), currency);
  const overtimeAmount = Money.sum(lines.filter((l) => l.isOvertime).map((l) => l.amount), currency);
  const regularMinutes = lines.filter((l) => !l.isOvertime).reduce((n, l) => n + l.minutes, 0);
  const overtimeMinutes = lines.filter((l) => l.isOvertime).reduce((n, l) => n + l.minutes, 0);
  const baseAmount = salary.amount.add(regularHoursAmount);
  const grossAmount = baseAmount.add(overtimeAmount);

  const minutesBySource = sumMinutesBySource(input.hours);
  const informationalMinutes = paysHours ? 0 : input.hours.reduce((n, h) => n + h.minutes, 0);

  const breakdown: BreakdownLine[] = [];
  if (paysSalary) breakdown.push({ label: "Salaire (prorata)", amount: salary.amount.amount });
  if (regularMinutes > 0) {
    breakdown.push({ label: "Heures normales", amount: regularHoursAmount.amount, minutes: regularMinutes });
  }
  if (overtimeMinutes > 0) {
    breakdown.push({ label: "Heures supplémentaires", amount: overtimeAmount.amount, minutes: overtimeMinutes });
  }
  if (paysHours) {
    if (minutesBySource.ATTENDANCE > 0) breakdown.push({ label: "dont Présences", amount: 0, minutes: minutesBySource.ATTENDANCE });
    if (minutesBySource.SESSION > 0) breakdown.push({ label: "dont Séances", amount: 0, minutes: minutesBySource.SESSION });
  } else if (informationalMinutes > 0) {
    breakdown.push({ label: "Heures constatées (non valorisées)", amount: 0, minutes: informationalMinutes });
  }

  const details: CalcDetails = {
    v: 1,
    kind: config.type,
    currency,
    periodDays: calendarDaysBetween(period.startDate, period.endDate),
    workingDays: workingDaysBetween(period.startDate, period.endDate).length,
    regularMinutes,
    overtimeMinutes,
    overtimeThresholdMinutes: config.overtimeThresholdMinutes,
    overtimeMultiplierPermille: config.overtimeMultiplierPermille,
    minutesBySource,
    informationalMinutes,
    salaryMonths: salary.months,
    breakdown,
  };

  return {
    kind: config.type,
    currency,
    salaryAmount: salary.amount,
    salaryDays: salary.days,
    lines,
    regularHoursAmount,
    overtimeAmount,
    baseAmount,
    grossAmount,
    regularMinutes,
    overtimeMinutes,
    minutesBySource,
    details,
  };
}

/** Rien à payer : ni salaire dû, ni ligne (les enseignants `MIXED`/`SALARY` entièrement payés ailleurs). */
export function isEmptyComputation(c: PayslipComputation): boolean {
  return c.lines.length === 0 && c.salaryAmount.isZero() && c.salaryDays.length === 0;
}

/** Date de fin de la semaine (dimanche) d'une clé de semaine — utile aux rapports. */
export const weekEnd = (weekMonday: IsoDate): IsoDate => addDays(weekMonday, 6);
