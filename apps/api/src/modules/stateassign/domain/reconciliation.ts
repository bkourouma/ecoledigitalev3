/**
 * Rapprochement et créances — règles PURES, en `Money` (entiers, aucun flottant).
 *
 *  - Écart = FACTURÉ − DÉCLARÉ, par part (État, famille). Le STATUT (`BALANCED` si les deux écarts sont ≤ la tolérance de
 *    l'établissement en valeur absolue, sinon `DISCREPANCY`) est celui que CALCULE la base (`assignments_guard`) ; la fonction
 *    ci-dessous en est le miroir (test de parité) et sert à l'aperçu et aux événements, jamais à ce qu'on enregistre.
 *  - Versements de l'État : le total REÇU (paiements imputés sur les factures du financeur dans `finance`) est affecté aux
 *    échéances dans l'ORDRE (échéance la plus ancienne d'abord), sans dépasser l'attendu de chacune ; le reste est « non affecté ».
 *  - Retard : une échéance non soldée est en retard quand la date du jour dépasse échéance + jours de grâce (réglage de
 *    l'établissement, 0 par défaut) ; les tranches d'ancienneté sont de la présentation.
 *
 * Aucune règle officielle : la tolérance et le délai de grâce sont des réglages.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { ReceivableAgingBucket } from "@ecoledigitale/contracts/src/v2/stateassign";
import type { IsoDate, ReceivableRecord, ReconciliationStatus } from "./types";

export interface Billed {
  readonly state: Money;
  readonly parent: Money;
}

export interface ReconciliationOutcome {
  readonly stateDelta: Money;
  readonly parentDelta: Money;
  readonly status: Exclude<ReconciliationStatus, "NEVER">;
}

/** Écart facturé − déclaré (un montant déclaré absent compte pour 0 : tout ce qui est facturé est alors un écart). */
export function deltaOf(declared: Money | null, billed: Money): Money {
  return billed.subtract(declared ?? Money.zero(billed.currency));
}

export function reconcile(
  declared: { readonly state: Money | null; readonly parent: Money | null },
  billed: Billed,
  toleranceAmount: number,
): ReconciliationOutcome {
  const stateDelta = deltaOf(declared.state, billed.state);
  const parentDelta = deltaOf(declared.parent, billed.parent);
  const within = (d: Money): boolean => Math.abs(d.amount) <= toleranceAmount;
  return { stateDelta, parentDelta, status: within(stateDelta) && within(parentDelta) ? "BALANCED" : "DISCREPANCY" };
}

// ---------------------------------------------------------------------------
// Affectation des versements aux échéances
// ---------------------------------------------------------------------------

export interface ScheduleItem {
  readonly id: string;
  readonly dueOn: IsoDate;
  readonly seq: number;
  readonly expected: Money;
  readonly cancelled: boolean;
}

export interface Allocation {
  readonly id: string;
  readonly received: Money;
}

export interface AllocationResult {
  readonly allocations: readonly Allocation[];
  /** Reçu au-delà des échéances planifiées (jamais perdu : affiché au dossier). */
  readonly unallocated: Money;
}

/** Ordre de règlement : échéance, puis numéro d'ordre (déterministe). */
export const scheduleOrder = (a: Pick<ScheduleItem, "dueOn" | "seq">, b: Pick<ScheduleItem, "dueOn" | "seq">): number =>
  a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.seq - b.seq;

export function allocateReceived(schedule: readonly ScheduleItem[], receivedTotal: Money): AllocationResult {
  let remaining = receivedTotal.amount < 0 ? Money.zero(receivedTotal.currency) : receivedTotal;
  const ordered = [...schedule].sort(scheduleOrder);
  const out = new Map<string, Money>();
  for (const item of ordered) {
    if (item.cancelled) {
      out.set(item.id, Money.zero(item.expected.currency));
      continue;
    }
    const take = remaining.amount >= item.expected.amount ? item.expected : remaining;
    out.set(item.id, take);
    remaining = remaining.subtract(take);
  }
  return { allocations: schedule.map((s) => ({ id: s.id, received: out.get(s.id) ?? Money.zero(s.expected.currency) })), unallocated: remaining };
}

// ---------------------------------------------------------------------------
// Retard
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const parseIso = (d: IsoDate): number => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, day ?? 1);
};

/** Jours entiers entre deux dates civiles (`to − from`). */
export const daysBetween = (from: IsoDate, to: IsoDate): number => Math.round((parseIso(to) - parseIso(from)) / DAY_MS);

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(parseIso(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Jours de retard (≥ 0) : 0 tant que la date du jour ne dépasse pas échéance + grâce. */
export function daysOverdue(dueOn: IsoDate, asOf: IsoDate, graceDays: number): number {
  return Math.max(0, daysBetween(dueOn, asOf) - Math.max(0, graceDays));
}

export function agingBucketOf(days: number): ReceivableAgingBucket {
  if (days <= 0) return "NOT_DUE";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  return "D91_PLUS";
}

export interface ReceivableView {
  readonly outstanding: Money;
  readonly daysOverdue: number;
  readonly overdue: boolean;
  readonly agingBucket: ReceivableAgingBucket;
}

/** Vue dérivée d'une échéance à une date : reste à recevoir, retard, tranche. Une échéance soldée ou annulée n'est jamais en retard. */
export function viewReceivable(r: Pick<ReceivableRecord, "dueOn" | "expected" | "received" | "status">, asOf: IsoDate, graceDays: number): ReceivableView {
  if (r.status === "CANCELLED") return { outstanding: Money.zero(r.expected.currency), daysOverdue: 0, overdue: false, agingBucket: "NOT_DUE" };
  const outstanding = r.expected.subtract(r.received);
  const days = outstanding.amount > 0 ? daysOverdue(r.dueOn, asOf, graceDays) : 0;
  return { outstanding, daysOverdue: days, overdue: days > 0, agingBucket: agingBucketOf(days) };
}

/** Statut calculé d'une échéance depuis les montants (miroir du déclencheur SQL). */
export function receivableStatusOf(expected: Money, received: Money): "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" {
  if (received.amount === 0) return "OPEN";
  return received.amount < expected.amount ? "PARTIALLY_RECEIVED" : "RECEIVED";
}

export const zeroOf = (currency: string): Money => Money.zero(currency as CurrencyCode);

export function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce((acc, v) => acc.add(v), zeroOf(currency));
}
