/**
 * Contenu du PDF d'un bulletin de paie (fonction PURE) : instantané figé (`content`, JSON canonique : chaînes, ENTIERS,
 * booléens, null) et contexte d'impression (`context`, chaînes déjà mises en forme) que le module `reportcards` scelle puis rend.
 *
 * Source : le snapshot IMMUABLE posé à l'arrêt du montant (`snapshot.ts`) + le versement. Seul un bulletin VERSÉ (`PAID`)
 * produit un PDF officiel : il porte alors un code de vérification et un QR, sans filigrane « NON VERSÉ ».
 *
 * Le titre est PUBLIÉ par la page de vérification : il ne porte que la période, jamais le nom de l'enseignant.
 */
import { Money } from "@ecoledigitale/kernel";
import type { PayslipSnapshot } from "./snapshot";

export interface PayslipDocument {
  readonly sourceId: string;
  readonly title: string;
  readonly issuedAt: Date;
  readonly content: Record<string, unknown>;
  readonly context: Record<string, unknown>;
}

export interface PayslipPaymentFacts {
  readonly paidAt: string;
  readonly method: string;
  readonly reference: string | null;
}

const money = (amount: number, currency: string): string => Money.of(amount, currency as never).format("fr-FR");

/** `150` -> « 2 h 30 », `120` -> « 2 h », `45` -> « 45 min ». */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

const ADJUSTMENT_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({ BONUS: "Prime", DEDUCTION: "Retenue" });

export function buildPayslipDocument(snapshot: PayslipSnapshot, snapshotHash: string, payment: PayslipPaymentFacts): PayslipDocument {
  const cur = snapshot.currency;
  const a = snapshot.amounts;
  const content: Record<string, unknown> = {
    payslipId: snapshot.payslipId,
    // empreinte du snapshot de paie : relie le document scellé à son instantané source
    payrollSnapshotHash: snapshotHash,
    staff: { id: snapshot.staff.id, displayName: snapshot.staff.displayName, matricule: snapshot.staff.matricule },
    period: { name: snapshot.period.name, startDate: snapshot.period.startDate, endDate: snapshot.period.endDate },
    currency: cur,
    amounts: { salary: a.salary, regularHours: a.regularHours, overtime: a.overtime, bonus: a.bonus, deduction: a.deduction, total: a.total },
    minutes: { regular: snapshot.minutes.regular, overtime: snapshot.minutes.overtime },
    lines: snapshot.lines.map((l) => ({
      date: l.date, startTime: l.startTime, minutes: l.minutes, rate: l.rate, multiplierPermille: l.multiplierPermille, amount: l.amount, isOvertime: l.isOvertime, label: l.label, classroomLabel: l.classroomLabel,
    })),
    adjustments: snapshot.adjustments.map((x) => ({ kind: x.kind, amount: x.amount, label: x.label, reason: x.reason })),
    approvedAt: snapshot.approvedAt,
    payment: { paidAt: payment.paidAt, method: payment.method, reference: payment.reference },
  };
  const context: Record<string, unknown> = {
    payslip: {
      staffName: snapshot.staff.displayName,
      matricule: snapshot.staff.matricule ?? "",
      periodName: snapshot.period.name,
      startDate: snapshot.period.startDate,
      endDate: snapshot.period.endDate,
      paidOn: payment.paidAt,
      lines: snapshot.lines.map((l) => ({
        date: l.date,
        label: [l.label ?? l.code ?? "Heures", l.classroomLabel ? `— ${l.classroomLabel}` : "", l.isOvertime ? "(heures supplémentaires)" : ""].filter(Boolean).join(" "),
        durationText: durationText(l.minutes),
        rateText: money(l.rate, cur),
        amountText: money(l.amount, cur),
      })),
      adjustments: snapshot.adjustments.map((x) => ({ kindLabel: ADJUSTMENT_KIND_LABELS[x.kind] ?? x.kind, label: x.label, reason: x.reason ?? "", amountText: money(x.amount, cur) })),
      salaryText: a.salary > 0 ? money(a.salary, cur) : "",
      regularHoursText: money(a.regularHours, cur),
      regularDurationText: durationText(snapshot.minutes.regular),
      overtimeText: money(a.overtime, cur),
      overtimeDurationText: durationText(snapshot.minutes.overtime),
      bonusText: money(a.bonus, cur),
      deductionText: money(a.deduction, cur),
      totalText: money(a.total, cur),
    },
  };
  return { sourceId: snapshot.payslipId, title: `Bulletin de paie — ${snapshot.period.name}`, issuedAt: new Date(payment.paidAt), content, context };
}
