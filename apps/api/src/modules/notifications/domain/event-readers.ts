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
    default:
      return { kind: "unreadable" };
  }
}

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
