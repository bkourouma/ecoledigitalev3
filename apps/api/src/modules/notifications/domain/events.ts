/**
 * Événements du module notifications : noms `<module>.<entité>.<verbe-passé>`, payload JSON versionné `{ v: 1, … }`.
 * JAMAIS de contenu de message ni d'adresse (schémas : `packages/contracts/src/v2/notifications.ts`). Domaine pur.
 */
export const NotificationsEvents = {
  DELIVERY_FAILED: "notifications.delivery.failed",
  DELIVERY_BOUNCED: "notifications.delivery.bounced",
  CONSENT_CHANGED: "notifications.consent.changed",
  TEMPLATE_PUBLISHED: "notifications.template.published",
  RULE_UPDATED: "notifications.rule.updated",
  URGENT_SENT: "notifications.urgent.sent",
} as const;

export type NotificationsEventType = (typeof NotificationsEvents)[keyof typeof NotificationsEvents];
export const ALL_NOTIFICATIONS_EVENT_TYPES: ReadonlyArray<NotificationsEventType> = Object.values(NotificationsEvents);
/** Compatibilité avec le squelette généré (`manifest.ts`). */
export const ALL_EVENT_TYPES = ALL_NOTIFICATIONS_EVENT_TYPES;

/** Événements d'AUTRES modules consommés. Les formes de payload sont celles de leurs producteurs (lecteurs : `event-readers.ts`). */
export const ConsumedEvents = {
  INVOICE_ISSUED: "finance.invoice.issued",
  INVOICE_OVERDUE: "finance.invoice.overdue",
  INVOICE_PAID: "finance.invoice.paid",
  PAYMENT_COMPLETED: "finance.payment.completed",
  ABSENCE_RECORDED: "attendance.absence.recorded",
  LATE_RECORDED: "attendance.late.recorded",
  ATTENDANCE_ALERT: "attendance.alert.triggered",
  REPORT_CARD_PUBLISHED: "reportcards.report_card.published",
  OCCURRENCE_CANCELLED: "scheduling.occurrence.cancelled",
  ANNOUNCEMENT_PUBLISHED: "messaging.announcement.published",
  QUALIFICATION_EXPIRING: "people.staff_qualification.expiring",
  PAYSLIP_NOTIFICATION: "payroll.payslip.notification_requested",
} as const;

export const CONSUMED_EVENT_TYPES: readonly string[] = Object.freeze(Object.values(ConsumedEvents));
