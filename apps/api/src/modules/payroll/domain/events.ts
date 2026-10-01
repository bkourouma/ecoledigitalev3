/**
 * Événements publiés / consommés par le module `payroll` (outbox, `<module>.<entité>.<verbe-passé>`,
 * payload `{ v: 1, … }` — conventions n° 6). Les montants sont des ENTIERS (XOF) ; AUCUN nom ni coordonnée :
 * seulement des identifiants (les consommateurs — notifications 016, comptabilité 014/015 — résolvent le reste).
 */
export const PayrollEvents = {
  periodCreated: "payroll.period.created",
  periodClosed: "payroll.period.closed",
  periodArchived: "payroll.period.archived",
  runCompleted: "payroll.run.completed",
  payslipCalculated: "payroll.payslip.calculated",
  payslipApproved: "payroll.payslip.approved",
  payslipPaid: "payroll.payslip.paid",
  payslipDisputed: "payroll.payslip.disputed",
  payslipCancelled: "payroll.payslip.cancelled",
  payslipAdjusted: "payroll.payslip.adjusted",
  payslipNotificationRequested: "payroll.payslip.notification_requested",
  claimSourceChanged: "payroll.claim.source_changed",
} as const;

export const ALL_PAYROLL_EVENT_TYPES: readonly string[] = Object.freeze(Object.values(PayrollEvents));

/** Événements des autres modules que la paie consomme (noms de travail des specs 017 / 010 / 009 / 004). */
export const ConsumedEvents = {
  occurrenceCancelled: "scheduling.occurrence.cancelled",
  occurrenceUnvalidated: "scheduling.occurrence.unvalidated",
  occurrenceRescheduled: "scheduling.occurrence.rescheduled",
  occurrencePaidMinutesChanged: "scheduling.occurrence.paid_minutes_changed",
  tenantProvisioned: "tenancy.tenant.provisioned",
  yearClosed: "academic.year.closed",
} as const;

export const CONSUMED_EVENT_TYPES: readonly string[] = Object.freeze(Object.values(ConsumedEvents));

export interface PayslipEventPayload {
  readonly v: 1;
  readonly payslipId: string;
  readonly periodId: string;
  readonly staffId: string;
  /** Titulaire du bulletin côté compte utilisateur (pour la notification), `null` si inconnu. */
  readonly recipientUserId: string | null;
  readonly amount: number;
  readonly currency: string;
}
