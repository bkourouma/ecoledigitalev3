/**
 * Contrats des événements consommés par `notifications` (abonnés : `modules/notifications/subscribers.ts`).
 *
 * Le lecteur est `readEvent` (`domain/event-readers.ts`) : il doit produire des FAITS (ou ignorer explicitement : absence
 * excusée, facture de financeur) pour l'échantillon du producteur, variantes complète et minimale. Les événements dont le
 * producteur ne publie pas encore de schéma Zod (finance : facture émise, en retard, paiement, alertes de rapprochement ; paie)
 * sont exemptés avec motif ;
 * leurs lecteurs sont éprouvés par les tests unitaires (`test/unit/domain.test.ts`) sur les formes TypeScript des producteurs.
 */
import { CONSUMED_EVENT_TYPES } from "../../src/modules/notifications/domain/events";
import { readEvent, readInvoicePaid } from "../../src/modules/notifications/domain/event-readers";
import { producerSchemas, type EventContract, type FieldRead } from "./support";

const understood = (result: unknown): boolean => {
  const r = result as { kind?: string };
  return r.kind === "facts" || r.kind === "skip";
};

const contract = (event: string, reads: FieldRead[]): EventContract => ({
  consumer: "notifications",
  event,
  reads,
  reader: (payload) => readEvent(event, payload),
  readerOk: (result) => understood(result),
});

const uuid = (field: string): FieldRead => ({ field, kind: "uuid" });
const optional = (field: string, kind: FieldRead["kind"]): FieldRead => ({ field, kind, required: false, absentOk: true });

const READS: Record<string, FieldRead[]> = {
  "attendance.absence.recorded": [uuid("studentId"), { field: "date", kind: "string" }, { field: "excused", kind: "boolean" }, { field: "correction", kind: "boolean" }, optional("recordId", "uuid")],
  "attendance.late.recorded": [uuid("studentId"), { field: "date", kind: "string" }, { field: "excused", kind: "boolean" }, { field: "correction", kind: "boolean" }, optional("minutesLate", "number")],
  "attendance.alert.triggered": [uuid("studentId"), { field: "metric", kind: "string" }, { field: "value", kind: "number" }, optional("ruleCode", "string")],
  "reportcards.report_card.published": [uuid("studentId"), uuid("reportCardId"), { field: "version", kind: "number" }],
  "scheduling.occurrence.cancelled": [{ field: "classroomId", kind: "uuid", nullable: true }, { field: "startsAt", kind: "string" }, optional("occurrenceId", "uuid")],
  "messaging.announcement.published": [uuid("announcementId"), { field: "priority", kind: "string" }],
  "people.staff_qualification.expiring": [uuid("staffId"), { field: "expiresOn", kind: "string" }, { field: "daysLeft", kind: "number" }, optional("qualificationId", "uuid")],
  // stateassign : alertes internes, aucun nom ; seuls identifiants, dates, statuts et montants entiers sont lus.
  "stateassign.reconciliation.discrepancy": [uuid("assignmentId"), optional("status", "string"), optional("version", "number")],
  "stateassign.receivable.overdue": [uuid("receivableId"), { field: "dueOn", kind: "string" }, { field: "daysOverdue", kind: "number" }, optional("expected", "object"), optional("received", "object")],
  "stateassign.control.due": [uuid("controlId"), { field: "dueOn", kind: "string" }],
  "stateassign.control.anomaly_detected": [uuid("controlId"), { field: "dueOn", kind: "string" }],
  // schoollife : jamais de motif ; `reasonKind`, `kind`, `severityCode`, dates de mesure ne sont PAS lus.
  "schoollife.measure.notified": [uuid("studentId"), uuid("measureId"), optional("visibleToGuardians", "boolean"), optional("confidentiality", "string")],
  "schoollife.convocation.sent": [uuid("studentId"), uuid("convocationId"), { field: "scheduledAt", kind: "string" }],
  "schoollife.convocation.cancelled": [uuid("studentId"), uuid("convocationId"), { field: "scheduledAt", kind: "string" }],
  // analytics : alerte de direction interne ; libellé neutre, valeurs entières, rôles destinataires, clé de dédoublonnage.
  "analytics.alert.raised": [uuid("alertId"), { field: "metricLabel", kind: "string" }, { field: "severity", kind: "string" }, { field: "unit", kind: "string" }, { field: "comparator", kind: "string" }, { field: "value", kind: "number" }, { field: "threshold", kind: "number" }, { field: "dedupeKey", kind: "string" }, { field: "recipientRoles", kind: "array" }, optional("currency", "string")],
  // admissions : identifiants seulement (les coordonnées viennent du port `applicants`).
  "admissions.application.submitted": [uuid("applicationId"), { field: "via", kind: "string" }],
  "admissions.offer.issued": [uuid("applicationId"), uuid("offerId")],
};

const published = producerSchemas();

export const contracts: EventContract[] = [
  ...CONSUMED_EVENT_TYPES.filter((e) => published.has(e) && READS[e]).map((e) => contract(e, READS[e]!)),
  {
    consumer: "notifications",
    event: "finance.invoice.paid",
    reads: [uuid("invoiceId")],
    reader: (payload) => readInvoicePaid(payload),
  },
];

export const exemptions: Array<{ event: string; reason: string }> = CONSUMED_EVENT_TYPES.filter((e) => !contracts.some((c) => c.event === e)).map((event) => ({
  event,
  reason: "le producteur (finance, payroll) type ses charges en interfaces TypeScript sans schéma Zod publié : le contrat de forme ne peut pas être vérifié par échantillon ; le lecteur `readEvent` est couvert par les tests unitaires sur les formes TypeScript du producteur",
}));
