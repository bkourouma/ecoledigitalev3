/**
 * Événements du module `analytics` : `analytics.<entité>.<verbe-passé>`, payload JSON versionné `{ v: 1, … }`.
 * Domaine pur : aucun import d'infrastructure.
 *
 * `analytics` PUBLIE peu : un instantané rafraîchi (pour que le web invalide ses caches et que les autres modules
 * sachent qu'un chiffre a changé) et la demande de reconstruction (traçabilité). Il CONSOMME beaucoup
 * (`CONSUMED_EVENT_PATTERNS`) : voir `refresh-plan.ts`.
 */
export const AnalyticsEvents = {
  SNAPSHOT_REFRESHED: "analytics.snapshot.refreshed",
  REBUILD_REQUESTED: "analytics.rebuild.requested",
  REBUILD_COMPLETED: "analytics.rebuild.completed",
} as const;

export type AnalyticsEventType = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EVENT_TYPES: readonly string[] = Object.values(AnalyticsEvents);

export interface SnapshotRefreshedPayload {
  v: 1;
  kind: string;
  scopeKey: string;
  /** Instant de la passe (`asOf` des chiffres). */
  asOf: string;
  rows: number;
  /** `false` : la passe a retrouvé la même empreinte de contenu, rien n'a été réécrit. */
  changed: boolean;
}

export interface RebuildPayload {
  v: 1;
  requestedBy: string | null;
  reason: string | null;
  kinds: string[];
}

/** Événements d'AUTRES modules écoutés (documentation du manifeste ; les motifs réels sont dans `subscribers.ts`). */
export const CONSUMED_EVENT_PATTERNS: readonly string[] = [
  "academic.year.*",
  "academic.period.*",
  "academic.classroom.*",
  "academic.classroom_period.*",
  "academic.enrollment.*",
  "people.student.status_changed",
  "people.student.updated",
  "people.student.anonymized",
  "people.teaching_assignment.*",
  "results.period.closed",
  "results.period.reopened",
  "results.decision.confirmed",
  "attendance.session.*",
  "attendance.absence.recorded",
  "attendance.late.recorded",
  "attendance.staff_absence.recorded",
  "attendance.staff_leave.*",
  "finance.invoice.*",
  "finance.credit_note.issued",
  "finance.payment.*",
  "finance.refund.*",
  "finance.cash_session.*",
  "payroll.period.*",
  "payroll.run.completed",
  "payroll.payslip.*",
];
