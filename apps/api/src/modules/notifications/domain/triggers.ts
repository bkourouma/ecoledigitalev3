/**
 * Déclencheurs pris en charge par les règles : événements consommés, relances, alertes. Pour chacun : les audiences
 * possibles et les variables de gabarit que le déclencheur sait FOURNIR. Une règle n'est valide que si le gabarit choisi
 * n'exige pas une variable que son déclencheur ne fournit pas (jamais de message à trous).
 */
import type { NotifAudience, NotifRuleKind } from "@ecoledigitale/contracts/src/v2/notifications";
import { allVariables, catalogEntry } from "./catalog";
import { ConsumedEvents } from "./events";
import type { RuleDef } from "./types";

export interface TriggerDef {
  readonly trigger: string;
  readonly kind: NotifRuleKind;
  readonly label: string;
  readonly audiences: readonly NotifAudience["kind"][];
  /** Variables de gabarit fournies (noms). */
  readonly provides: readonly string[];
}

export const DUNNING_TRIGGER = "dunning";

const FAMILY: readonly NotifAudience["kind"][] = ["STUDENT_GUARDIANS", "STUDENT", "ROLES"];

export const SUPPORTED_TRIGGERS: readonly TriggerDef[] = Object.freeze<TriggerDef[]>([
  { trigger: ConsumedEvents.INVOICE_ISSUED, kind: "EVENT", label: "Facture émise", audiences: FAMILY, provides: ["studentName", "invoiceNumber", "amount", "dueDate"] },
  { trigger: ConsumedEvents.PAYMENT_COMPLETED, kind: "EVENT", label: "Paiement reçu", audiences: FAMILY, provides: ["studentName", "amount", "receiptNumber"] },
  { trigger: ConsumedEvents.INVOICE_OVERDUE, kind: "EVENT", label: "Facture en retard", audiences: FAMILY, provides: ["studentName", "invoiceNumber", "amount", "dueDate", "daysOverdue"] },
  { trigger: ConsumedEvents.ABSENCE_RECORDED, kind: "EVENT", label: "Absence enregistrée", audiences: FAMILY, provides: ["studentName", "date"] },
  { trigger: ConsumedEvents.LATE_RECORDED, kind: "EVENT", label: "Retard enregistré", audiences: FAMILY, provides: ["studentName", "date", "minutesLate"] },
  { trigger: ConsumedEvents.ATTENDANCE_ALERT, kind: "EVENT", label: "Seuil d'assiduité franchi", audiences: FAMILY, provides: ["studentName", "count"] },
  { trigger: ConsumedEvents.REPORT_CARD_PUBLISHED, kind: "EVENT", label: "Bulletin publié", audiences: FAMILY, provides: ["studentName"] },
  { trigger: ConsumedEvents.OCCURRENCE_CANCELLED, kind: "EVENT", label: "Cours annulé", audiences: ["CLASSROOM", "ROLES"], provides: ["date", "time", "className"] },
  { trigger: ConsumedEvents.ANNOUNCEMENT_PUBLISHED, kind: "EVENT", label: "Annonce publiée", audiences: ["ANNOUNCEMENT_RECIPIENTS", "ROLES"], provides: ["title", "summary"] },
  { trigger: ConsumedEvents.QUALIFICATION_EXPIRING, kind: "EVENT", label: "Document ou qualification arrivant à échéance", audiences: ["STAFF_SUBJECT", "ROLES"], provides: ["staffName", "expiresOn", "daysLeft"] },
  { trigger: ConsumedEvents.PAYSLIP_NOTIFICATION, kind: "EVENT", label: "Bulletin de paie disponible", audiences: ["PAYSLIP_HOLDER", "ROLES"], provides: ["amount"] },
  { trigger: ConsumedEvents.PAYMENT_RECONCILIATION_NEEDED, kind: "EVENT", label: "Paiement à rapprocher à la main", audiences: ["ROLES"], provides: ["subject", "amount", "provider", "reason"] },
  { trigger: ConsumedEvents.REFUND_RECONCILIATION_NEEDED, kind: "EVENT", label: "Remboursement à rapprocher à la main", audiences: ["ROLES"], provides: ["subject", "amount", "provider", "reason"] },
  { trigger: ConsumedEvents.STATE_RECONCILIATION_DISCREPANCY, kind: "EVENT", label: "Écart de rapprochement avec la part de l'État", audiences: ["ROLES"], provides: ["alertLabel"] },
  { trigger: ConsumedEvents.STATE_RECEIVABLE_OVERDUE, kind: "EVENT", label: "Créance de l'État en retard", audiences: ["ROLES"], provides: ["alertLabel", "dueDate", "daysOverdue", "amount"] },
  { trigger: ConsumedEvents.STATE_CONTROL_DUE, kind: "EVENT", label: "Contrôle d'un élève affecté par l'État à effectuer", audiences: ["ROLES"], provides: ["alertLabel", "dueDate"] },
  { trigger: ConsumedEvents.STATE_CONTROL_ANOMALY, kind: "EVENT", label: "Anomalie de contrôle d'un élève affecté par l'État", audiences: ["ROLES"], provides: ["alertLabel", "dueDate"] },
  { trigger: ConsumedEvents.MEASURE_NOTIFIED, kind: "EVENT", label: "Décision de vie scolaire notifiée", audiences: ["STUDENT_GUARDIANS"], provides: ["studentName"] },
  { trigger: ConsumedEvents.CONVOCATION_SENT, kind: "EVENT", label: "Convocation de vie scolaire envoyée", audiences: ["STUDENT_GUARDIANS"], provides: ["studentName", "date", "time", "statusLabel"] },
  { trigger: ConsumedEvents.CONVOCATION_CANCELLED, kind: "EVENT", label: "Convocation de vie scolaire annulée", audiences: ["STUDENT_GUARDIANS"], provides: ["studentName", "date", "time", "statusLabel"] },
  { trigger: ConsumedEvents.APPLICATION_SUBMITTED, kind: "EVENT", label: "Candidature reçue", audiences: ["APPLICANT_GUARDIANS", "ROLES"], provides: [] },
  { trigger: ConsumedEvents.OFFER_ISSUED, kind: "EVENT", label: "Offre d'admission émise", audiences: ["APPLICANT_GUARDIANS", "ROLES"], provides: [] },
  { trigger: DUNNING_TRIGGER, kind: "DUNNING", label: "Relance d'impayé (paliers en jours de retard)", audiences: FAMILY, provides: ["studentName", "invoiceNumber", "amount", "dueDate", "daysOverdue"] },
  { trigger: "OVERDUE_DAYS", kind: "ALERT", label: "Retard de paiement de X jours", audiences: FAMILY, provides: ["studentName", "invoiceNumber", "amount", "dueDate", "daysOverdue"] },
  { trigger: "GRADE_DROP", kind: "ALERT", label: "Baisse de résultats", audiences: ["CLASSROOM", "ROLES"], provides: ["studentName", "className", "previous", "current", "drop"] },
  { trigger: "TEACHING_LOAD", kind: "ALERT", label: "Charge d'enseignement élevée", audiences: ["ROLES"], provides: ["staffName", "hours", "threshold"] },
]);

const BY_TRIGGER: ReadonlyMap<string, TriggerDef> = new Map(SUPPORTED_TRIGGERS.map((t) => [t.trigger, t]));

export const triggerDef = (trigger: string): TriggerDef | undefined => BY_TRIGGER.get(trigger);

/** Événements d'entrée traités par les abonnés (hors `finance.invoice.paid`, qui arrête les relances). */
export const EVENT_TRIGGERS: readonly string[] = SUPPORTED_TRIGGERS.filter((t) => t.kind === "EVENT").map((t) => t.trigger);

/** Anomalies d'une règle (liste vide = valide). */
export function validateRuleDef(rule: Pick<RuleDef, "kind" | "trigger" | "templateCode" | "audience" | "channels" | "conditions">): string[] {
  const issues: string[] = [];
  const t = triggerDef(rule.trigger);
  if (!t) return [`Déclencheur inconnu : « ${rule.trigger} ».`];
  if (t.kind !== rule.kind) issues.push(`Le déclencheur « ${rule.trigger} » est de type ${t.kind}, pas ${rule.kind}.`);
  if (!t.audiences.includes(rule.audience.kind)) issues.push(`L'audience « ${rule.audience.kind} » n'est pas disponible pour ce déclencheur.`);
  const entry = catalogEntry(rule.templateCode);
  if (!entry) issues.push(`Gabarit inconnu : « ${rule.templateCode} ».`);
  else {
    const provided = new Set([...t.provides, ...allVariables(entry).filter((d) => !d.required).map((d) => d.name)]);
    const missing = entry.variables.filter((d) => d.required && !provided.has(d.name) && !["schoolName", "appUrl"].includes(d.name)).map((d) => d.name);
    if (missing.length > 0) issues.push(`Le gabarit « ${rule.templateCode} » exige ${missing.map((m) => `« ${m} »`).join(", ")}, que ce déclencheur ne fournit pas.`);
    if (entry.staffFacing && (rule.audience.kind === "STUDENT_GUARDIANS" || rule.audience.kind === "STUDENT")) {
      // Un gabarit d'alerte interne n'est pas adressé à une famille (les relances de retard ont leur propre gabarit).
      issues.push(`Le gabarit « ${rule.templateCode} » est interne : il ne peut pas être adressé aux familles.`);
    }
  }
  if (new Set(rule.channels).size !== rule.channels.length) issues.push("Un canal est répété.");
  const stages = rule.conditions.stages;
  if (rule.kind === "DUNNING") {
    if (!stages || stages.length === 0) issues.push("Une relance exige au moins un palier (jours de retard).");
    else if (stages.some((s, i) => i > 0 && s <= stages[i - 1]!)) issues.push("Les paliers doivent être strictement croissants.");
  }
  if (rule.kind === "ALERT") {
    if (rule.trigger === "OVERDUE_DAYS" && rule.conditions.minDaysOverdue === undefined) issues.push("L'alerte de retard exige `minDaysOverdue`.");
    if (rule.trigger === "GRADE_DROP" && rule.conditions.minDrop === undefined) issues.push("L'alerte de baisse de résultats exige `minDrop`.");
    if (rule.trigger === "TEACHING_LOAD" && rule.conditions.maxHours === undefined) issues.push("L'alerte de charge exige `maxHours`.");
  }
  return issues;
}
