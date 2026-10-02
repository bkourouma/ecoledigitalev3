/**
 * Lecteurs des événements CONSOMMÉS : charge utile du producteur -> faits normalisés (qui est visé, quelles valeurs de gabarit,
 * quels filtres de règle). Fonctions pures, tolérantes (champ illisible = événement ignoré, jamais une exception).
 *
 * Les formes de payload sont celles des PRODUCTEURS ; elles sont éprouvées par
 * `apps/api/test/events-contracts/notifications.contracts.ts` (un contrat par événement consommé).
 * Aucun de ces événements ne porte de contenu : les noms (élève, classe, enseignant) sont résolus par les ports d'annuaire.
 */
import { isUuid } from "@ecoledigitale/kernel";
import { ConsumedEvents } from "./events";
import type { MoneyValue, RuleDef } from "./types";

export interface EventRefs {
  readonly studentId?: string;
  readonly staffId?: string;
  readonly classroomId?: string;
  readonly announcementId?: string;
  /** Compte visé directement (bulletin de paie). */
  readonly userId?: string;
  /** Dossier de candidature (admissions) : les contacts viennent du port `applicants`. */
  readonly applicationId?: string;
}

export interface EventFilters {
  readonly metric?: string;
  readonly value?: number;
  readonly priority?: string;
  readonly daysOverdue?: number;
  readonly daysLeft?: number;
}

export interface EventFacts {
  readonly eventType: string;
  readonly refs: EventRefs;
  /** Valeurs de gabarit connues par le payload (typées). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Instant d'un cours (annulation) : converti en date/heure LOCALES par l'application (fuseau de l'établissement). */
  readonly startsAt?: string;
  readonly filters: EventFilters;
  /** Clé d'idempotence additionnelle propre à l'événement (ex. enregistrement d'appel). */
  readonly dedupeId: string | null;
  /** Identifiants utiles au journal (jamais de nom ni de contenu). */
  readonly context: Readonly<Record<string, string>>;
  /** Chemin interne vers lequel pointent les notifications in-app et push (alertes internes). */
  readonly linkPath?: string;
}

export type ReadOutcome = { readonly kind: "facts"; readonly facts: EventFacts } | { readonly kind: "skip"; readonly reason: string } | { readonly kind: "unreadable" };

const obj = (p: unknown): Record<string, unknown> | null => (p && typeof p === "object" ? (p as Record<string, unknown>) : null);
const uuid = (v: unknown): string | null => (typeof v === "string" && isUuid(v) ? v : null);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const money = (v: unknown): MoneyValue | null => {
  const m = obj(v);
  return m && typeof m.amount === "number" && Number.isSafeInteger(m.amount) && typeof m.currency === "string" ? { amount: m.amount, currency: m.currency } : null;
};

const facts = (f: Omit<EventFacts, "filters" | "dedupeId" | "context"> & Partial<Pick<EventFacts, "filters" | "dedupeId" | "context">>): ReadOutcome => ({
  kind: "facts",
  facts: { filters: {}, dedupeId: null, context: {}, ...f },
});

export function readEvent(eventType: string, payload: unknown): ReadOutcome {
  const p = obj(payload);
  if (!p) return { kind: "unreadable" };
  switch (eventType) {
    case ConsumedEvents.INVOICE_ISSUED: {
      const studentId = uuid(p.learnerId);
      const number = str(p.number);
      const total = money(p.total);
      const dueDate = day(p.dueDate);
      if (!studentId || !number || !total || !dueDate) return { kind: "unreadable" };
      if (p.payerKind === "FUNDER") return { kind: "skip", reason: "funder_invoice" };
      return facts({ eventType, refs: { studentId }, values: { invoiceNumber: number, amount: total, dueDate }, context: { invoiceId: String(p.invoiceId ?? ""), studentId } });
    }
    case ConsumedEvents.PAYMENT_COMPLETED: {
      const studentId = uuid(p.learnerId);
      const amount = money(p.amount);
      if (!studentId || !amount) return { kind: "unreadable" };
      if (p.payerKind === "FUNDER") return { kind: "skip", reason: "funder_payment" };
      const receipt = str(p.receiptNumber, 60);
      return facts({ eventType, refs: { studentId }, values: { amount, ...(receipt ? { receiptNumber: receipt } : {}) }, context: { paymentId: String(p.paymentId ?? ""), studentId } });
    }
    case ConsumedEvents.INVOICE_OVERDUE: {
      const studentId = uuid(p.learnerId);
      const number = str(p.number);
      const amount = money(p.overdueAmount);
      const dueDate = day(p.oldestDueDate);
      const daysOverdue = int(p.daysOverdue);
      if (!studentId || !number || !amount || !dueDate || daysOverdue === null) return { kind: "unreadable" };
      return facts({
        eventType,
        refs: { studentId },
        values: { invoiceNumber: number, amount, dueDate, daysOverdue },
        filters: { daysOverdue },
        context: { invoiceId: String(p.invoiceId ?? ""), studentId },
      });
    }
    case ConsumedEvents.ABSENCE_RECORDED:
    case ConsumedEvents.LATE_RECORDED: {
      const studentId = uuid(p.studentId);
      const date = day(p.date);
      if (!studentId || !date) return { kind: "unreadable" };
      if (p.correction === true) return { kind: "skip", reason: "correction" };
      if (p.excused === true) return { kind: "skip", reason: "excused" };
      const minutes = eventType === ConsumedEvents.LATE_RECORDED ? int(p.minutesLate) : null;
      return facts({
        eventType,
        refs: { studentId, ...(uuid(p.classroomId) ? { classroomId: uuid(p.classroomId)! } : {}) },
        values: { date, ...(minutes !== null && minutes > 0 ? { minutesLate: minutes } : {}) },
        dedupeId: uuid(p.recordId),
        context: { studentId },
      });
    }
    case ConsumedEvents.ATTENDANCE_ALERT: {
      const studentId = uuid(p.studentId);
      const metric = str(p.metric, 40);
      const value = int(p.value);
      if (!studentId || !metric || value === null) return { kind: "unreadable" };
      return facts({ eventType, refs: { studentId }, values: { count: value }, filters: { metric, value }, context: { studentId, ruleCode: str(p.ruleCode, 60) ?? "" } });
    }
    case ConsumedEvents.REPORT_CARD_PUBLISHED: {
      const studentId = uuid(p.studentId);
      if (!studentId) return { kind: "unreadable" };
      const version = int(p.version);
      return facts({ eventType, refs: { studentId }, values: {}, dedupeId: `${String(p.reportCardId ?? "")}:${version ?? 0}`, context: { studentId, reportCardId: String(p.reportCardId ?? "") } });
    }
    case ConsumedEvents.OCCURRENCE_CANCELLED: {
      const startsAt = typeof p.startsAt === "string" && !Number.isNaN(Date.parse(p.startsAt)) ? p.startsAt : null;
      if (!startsAt) return { kind: "skip", reason: "starts_at_unreadable" };
      // Une séance sans classe (réunion de personnel, séance comptable) ne concerne aucune famille.
      const classroomId = uuid(p.classroomId);
      if (!classroomId) return { kind: "skip", reason: "no_classroom" };
      return facts({ eventType, refs: { classroomId }, values: {}, startsAt, context: { classroomId, occurrenceId: String(p.occurrenceId ?? "") } });
    }
    case ConsumedEvents.ANNOUNCEMENT_PUBLISHED: {
      const announcementId = uuid(p.announcementId);
      const priority = str(p.priority, 10);
      if (!announcementId || !priority) return { kind: "unreadable" };
      return facts({ eventType, refs: { announcementId }, values: {}, filters: { priority }, context: { announcementId } });
    }
    case ConsumedEvents.QUALIFICATION_EXPIRING: {
      const staffId = uuid(p.staffId);
      const expiresOn = day(p.expiresOn);
      const daysLeft = int(p.daysLeft);
      if (!staffId || !expiresOn || daysLeft === null) return { kind: "unreadable" };
      return facts({
        eventType,
        refs: { staffId },
        values: { expiresOn, daysLeft },
        filters: { daysLeft },
        dedupeId: `${String(p.qualificationId ?? "")}:${expiresOn}:${daysLeft}`,
        context: { staffId },
      });
    }
    case ConsumedEvents.PAYSLIP_NOTIFICATION: {
      const userId = uuid(p.recipientUserId);
      if (!userId) return { kind: "skip", reason: "no_account" };
      const amount = typeof p.amount === "number" && Number.isSafeInteger(p.amount) && typeof p.currency === "string" ? { amount: p.amount, currency: p.currency } : null;
      return facts({ eventType, refs: { userId }, values: amount ? { amount } : {}, dedupeId: String(p.payslipId ?? ""), context: { payslipId: String(p.payslipId ?? "") } });
    }
    case ConsumedEvents.PAYMENT_RECONCILIATION_NEEDED:
    case ConsumedEvents.REFUND_RECONCILIATION_NEEDED: {
      // Alerte interne : montant, fournisseur et code de motif seulement. Ni nom d'élève, ni dernier message du fournisseur.
      const paymentId = uuid(p.paymentId);
      const amount = money(p.amount);
      if (!paymentId || !amount) return { kind: "unreadable" };
      const refund = eventType === ConsumedEvents.REFUND_RECONCILIATION_NEEDED;
      const refundId = uuid(p.refundId);
      const provider = str(p.provider, 60);
      const reasonCode = str(p.reason, 60);
      const reason = reasonCode ? RECONCILIATION_REASONS[reasonCode] : undefined;
      return facts({
        eventType,
        refs: {},
        values: { subject: refund ? "remboursement" : "paiement", amount, ...(provider ? { provider } : {}), ...(reason ? { reason } : {}) },
        // Une alerte par élément et par motif : le rapprochement qui boucle ne bombarde pas l'économat.
        dedupeId: `${refund ? (refundId ?? paymentId) : paymentId}:${reasonCode ?? "unknown"}`,
        context: { paymentId, ...(refundId ? { refundId } : {}) },
        linkPath: "/v2/finance/payments/pending",
      });
    }
    case ConsumedEvents.STATE_RECONCILIATION_DISCREPANCY: {
      const assignmentId = uuid(p.assignmentId);
      if (!assignmentId) return { kind: "unreadable" };
      if (p.status === "BALANCED") return { kind: "skip", reason: "balanced" };
      const version = int(p.version);
      return facts({
        eventType,
        refs: {},
        values: { alertLabel: STATE_ALERT_LABELS[eventType]! },
        dedupeId: `${assignmentId}:${version ?? 0}`,
        context: { assignmentId },
        linkPath: "/v2/stateassign/reconciliation",
      });
    }
    case ConsumedEvents.STATE_RECEIVABLE_OVERDUE: {
      const receivableId = uuid(p.receivableId);
      const dueOn = day(p.dueOn);
      const daysOverdue = int(p.daysOverdue);
      if (!receivableId || !dueOn || daysOverdue === null) return { kind: "unreadable" };
      const expected = money(p.expected);
      const received = money(p.received);
      const remaining = expected && received && expected.currency === received.currency && expected.amount > received.amount ? { amount: expected.amount - received.amount, currency: expected.currency } : null;
      return facts({
        eventType,
        refs: {},
        values: { alertLabel: STATE_ALERT_LABELS[eventType]!, dueDate: dueOn, ...(daysOverdue > 0 ? { daysOverdue } : {}), ...(remaining ? { amount: remaining } : {}) },
        filters: { daysOverdue },
        // « signalé une seule fois » par le producteur : une alerte par créance.
        dedupeId: receivableId,
        context: { receivableId },
        linkPath: "/v2/stateassign",
      });
    }
    case ConsumedEvents.STATE_CONTROL_DUE:
    case ConsumedEvents.STATE_CONTROL_ANOMALY: {
      const controlId = uuid(p.controlId);
      const dueOn = day(p.dueOn);
      if (!controlId || !dueOn) return { kind: "unreadable" };
      return facts({
        eventType,
        refs: {},
        values: { alertLabel: STATE_ALERT_LABELS[eventType]!, dueDate: dueOn },
        dedupeId: `${controlId}:${dueOn}`,
        context: { controlId },
        linkPath: "/v2/stateassign",
      });
    }
    case ConsumedEvents.MEASURE_NOTIFIED: {
      // Texte NEUTRE : seuls l'élève et l'existence d'une décision comptent (ni nature, ni gravité, ni dates, ni motif).
      const studentId = uuid(p.studentId);
      const measureId = uuid(p.measureId);
      if (!studentId || !measureId) return { kind: "unreadable" };
      if (p.visibleToGuardians === false || p.confidentiality === "CONFIDENTIAL") return { kind: "skip", reason: "not_shareable" };
      return facts({ eventType, refs: { studentId }, values: {}, dedupeId: measureId, context: { studentId, measureId } });
    }
    case ConsumedEvents.CONVOCATION_SENT:
    case ConsumedEvents.CONVOCATION_CANCELLED: {
      // Aucun motif de convocation (`reasonKind`) n'est lu : le message ne dit que quand et pour qui.
      const studentId = uuid(p.studentId);
      const convocationId = uuid(p.convocationId);
      const startsAt = typeof p.scheduledAt === "string" && !Number.isNaN(Date.parse(p.scheduledAt)) ? p.scheduledAt : null;
      if (!studentId || !convocationId || !startsAt) return { kind: "unreadable" };
      const cancelled = eventType === ConsumedEvents.CONVOCATION_CANCELLED;
      return facts({
        eventType,
        refs: { studentId },
        values: cancelled ? { statusLabel: "annulée" } : {},
        startsAt,
        dedupeId: `${convocationId}:${cancelled ? "cancelled" : "sent"}`,
        context: { studentId, convocationId },
      });
    }
    case ConsumedEvents.APPLICATION_SUBMITTED: {
      const applicationId = uuid(p.applicationId);
      if (!applicationId) return { kind: "unreadable" };
      // Un import en masse ou une conversion de prospect ne déclenche pas d'accusé de réception.
      if (p.via !== "PUBLIC_FORM" && p.via !== "STAFF") return { kind: "skip", reason: "via_not_applicant_facing" };
      return facts({ eventType, refs: { applicationId }, values: {}, dedupeId: applicationId, context: { applicationId } });
    }
    case ConsumedEvents.OFFER_ISSUED: {
      const applicationId = uuid(p.applicationId);
      const offerId = uuid(p.offerId);
      if (!applicationId || !offerId) return { kind: "unreadable" };
      return facts({ eventType, refs: { applicationId }, values: {}, dedupeId: offerId, context: { applicationId, offerId } });
    }
    default:
      return { kind: "unreadable" };
  }
}

/** Libellés (français, neutres) des codes de motif d'une alerte de rapprochement publiés par `finance` ; un code inconnu n'affiche pas de motif. */
const RECONCILIATION_REASONS: Readonly<Record<string, string>> = Object.freeze({
  unverifiable_no_provider_ref: "référence du fournisseur absente",
  attempts_exhausted: "vérifications automatiques épuisées",
  provider_mismatch: "écart avec le fournisseur",
  late_success: "succès signalé tardivement par le fournisseur",
  provider_not_configured: "fournisseur non configuré",
});

const STATE_ALERT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  [ConsumedEvents.STATE_RECONCILIATION_DISCREPANCY]: "Écart de rapprochement avec la part de l'État",
  [ConsumedEvents.STATE_RECEIVABLE_OVERDUE]: "Créance de l'État en retard",
  [ConsumedEvents.STATE_CONTROL_DUE]: "Contrôle d'un élève affecté par l'État à effectuer",
  [ConsumedEvents.STATE_CONTROL_ANOMALY]: "Anomalie détectée lors d'un contrôle d'un élève affecté par l'État",
});

/** `finance.invoice.paid` : seul `invoiceId` compte (arrêt des relances). */
export function readInvoicePaid(payload: unknown): { invoiceId: string } | null {
  const p = obj(payload);
  const invoiceId = p ? uuid(p.invoiceId) : null;
  return invoiceId ? { invoiceId } : null;
}

/** Une règle d'événement s'applique-t-elle à ces faits ? (seuils et filtres de `conditions`). */
export function conditionsMatch(rule: Pick<RuleDef, "conditions">, filters: EventFilters): boolean {
  const c = rule.conditions;
  if (c.metrics && c.metrics.length > 0 && (filters.metric === undefined || !c.metrics.includes(filters.metric))) return false;
  if (c.minValue !== undefined && filters.value !== undefined && filters.value < c.minValue) return false;
  if (c.priorities && c.priorities.length > 0 && (filters.priority === undefined || !(c.priorities as readonly string[]).includes(filters.priority))) return false;
  if (c.minDaysOverdue !== undefined && filters.daysOverdue !== undefined && filters.daysOverdue < c.minDaysOverdue) return false;
  if (c.daysBefore !== undefined && filters.daysLeft !== undefined && filters.daysLeft > c.daysBefore) return false;
  return true;
}
