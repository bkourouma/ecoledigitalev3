/**
 * Événements du module reportcards : noms `<module>.<entité>.<verbe-passé>`, payload `{ v: 1, … }` écrit dans l'outbox,
 * dans la même transaction que la donnée. Les schémas de payload vivent dans `packages/contracts/src/v2/reportcards.ts`.
 */
import { reportcardsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/reportcards";

export const ReportcardsEvents = {
  /** Un snapshot vient d'être émis : le worker rend le PDF (remplace `report_card.issued` de la spec). */
  SNAPSHOT_CREATED: "reportcards.snapshot.created",
  /** Demande de (re)rendu : reprise explicite d'un bulletin ou d'un lot ; consommée par le même abonné que SNAPSHOT_CREATED. */
  RENDER_REQUESTED: "reportcards.report_card.render_requested",
  RENDERED: "reportcards.report_card.rendered",
  RENDER_FAILED: "reportcards.report_card.render_failed",
  PUBLISHED: "reportcards.report_card.published",
  WITHDRAWN: "reportcards.report_card.withdrawn",
  SUPERSEDED: "reportcards.report_card.superseded",
  REVOKED: "reportcards.report_card.revoked",
  BATCH_COMPLETED: "reportcards.batch.completed",
  INTEGRITY_MISMATCH: "reportcards.integrity.mismatch",
} as const;

export const ALL_REPORTCARDS_EVENT_TYPES = Object.freeze(Object.keys(reportcardsEventPayloadSchemas)) as readonly string[];

/** Événements d'autres modules consommés (⚠ noms de travail, à aligner avec leurs producteurs : voir spec 013 §11). */
export const ConsumedEvents = {
  TENANT_PROVISIONED: "tenancy.tenant.provisioned",
  PERIOD_REOPENED: "results.period.reopened",
  PERIOD_CLOSED: "results.period.closed",
} as const;
