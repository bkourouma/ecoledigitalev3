/**
 * Imputation d'un paiement sur des échéances, et reprise des imputations lors d'un
 * remboursement.
 *
 * Invariants (testés par propriétés) :
 *   - la somme des imputations ≤ montant du paiement ;
 *   - chaque imputation ≤ reste de son échéance ;
 *   - aucune imputation négative ou nulle ;
 *   - imputé + non imputé = montant du paiement (aucune perte).
 *
 * Imputation AUTOMATIQUE : ordre configurable (par défaut la plus ancienne
 * échéance d'abord) avec un départage DÉTERMINISTE (date d'émission de la facture,
 * rang, identifiant). Imputation MANUELLE : le demandeur désigne les échéances et
 * les montants ; tout dépassement est refusé.
 */
import { err, ok, Money, type AppError, type Result } from "@ecoledigitale/kernel";
import { compareDates } from "./dates";
import { FinanceCode, conflict, validation } from "./errors";
import { sumMoney } from "./money-utils";
import type { AllocationOrder, IsoDate, Uuid } from "./types";

export interface AllocationTarget {
  readonly invoiceId: Uuid;
  readonly installmentId: Uuid;
  readonly dueDate: IsoDate;
  readonly seq: number;
  /** Instant d'émission de la facture (ISO) — départage les échéances de même date. */
  readonly invoiceIssuedAt: string;
  readonly remaining: Money;
}

export interface PlannedAllocation {
  readonly invoiceId: Uuid;
  readonly installmentId: Uuid;
  readonly amount: Money;
}

export interface AllocationPlan {
  readonly allocations: ReadonlyArray<PlannedAllocation>;
  readonly allocated: Money;
  readonly unallocated: Money;
}

const tieBreak = (a: AllocationTarget, b: AllocationTarget): number =>
  a.invoiceIssuedAt.localeCompare(b.invoiceIssuedAt) || a.seq - b.seq || a.installmentId.localeCompare(b.installmentId);

function comparatorFor(order: AllocationOrder): (a: AllocationTarget, b: AllocationTarget) => number {
  switch (order) {
    case "OLDEST_DUE_FIRST":
    case "PROPORTIONAL":
      return (a, b) => compareDates(a.dueDate, b.dueDate) || tieBreak(a, b);
    case "NEWEST_DUE_FIRST":
      return (a, b) => compareDates(b.dueDate, a.dueDate) || tieBreak(a, b);
    case "SMALLEST_REMAINING_FIRST":
      return (a, b) => a.remaining.compare(b.remaining) || compareDates(a.dueDate, b.dueDate) || tieBreak(a, b);
    case "LARGEST_REMAINING_FIRST":
      return (a, b) => b.remaining.compare(a.remaining) || compareDates(a.dueDate, b.dueDate) || tieBreak(a, b);
  }
}

export function planAutoAllocation(
  amount: Money,
  targets: ReadonlyArray<AllocationTarget>,
  order: AllocationOrder,
): Result<AllocationPlan, AppError> {
  if (!amount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant à imputer doit être strictement positif.", "amount"));
  }
  if (targets.some((t) => t.remaining.currency !== amount.currency)) {
    return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du paiement différente de celle des échéances.", "amount"));
  }
  const open = targets.filter((t) => t.remaining.isPositive()).slice().sort(comparatorFor(order));
  const totalRemaining = sumMoney(open.map((t) => t.remaining), amount.currency);
  const allocations: PlannedAllocation[] = [];

  if (order === "PROPORTIONAL") {
    if (open.length > 0) {
      const spend = amount.lt(totalRemaining) ? amount : totalRemaining;
      const parts = spend.allocate(open.map((t) => t.remaining.amount));
      open.forEach((t, i) => {
        const part = parts[i]!;
        if (part.isPositive()) allocations.push({ invoiceId: t.invoiceId, installmentId: t.installmentId, amount: part });
      });
    }
  } else {
    let left = amount;
    for (const t of open) {
      if (left.isZero()) break;
      const take = t.remaining.lt(left) ? t.remaining : left;
      allocations.push({ invoiceId: t.invoiceId, installmentId: t.installmentId, amount: take });
      left = left.subtract(take);
    }
  }

  const allocated = sumMoney(allocations.map((a) => a.amount), amount.currency);
  return ok({ allocations, allocated, unallocated: amount.subtract(allocated) });
}

export interface ManualAllocationRequest {
  readonly installmentId: Uuid;
  readonly amount: Money;
  /** Ligne de facture que cette somme « solde » (suivi par ligne, facultatif). */
  readonly lineId?: Uuid | null;
}

export function validateManualAllocations(
  requests: ReadonlyArray<ManualAllocationRequest>,
  targetsByInstallment: ReadonlyMap<Uuid, AllocationTarget>,
  available: Money,
): Result<AllocationPlan, AppError> {
  if (requests.length === 0) {
    return err(validation(FinanceCode.INVALID_INPUT, "Aucune imputation demandée.", "allocations"));
  }
  const spentByInstallment = new Map<Uuid, Money>();
  const allocations: PlannedAllocation[] = [];
  let total = Money.zero(available.currency);
  for (const [i, r] of requests.entries()) {
    if (!r.amount.isPositive()) {
      return err(validation(FinanceCode.INVALID_AMOUNT, "Chaque imputation doit être strictement positive.", ["allocations", i, "amount"]));
    }
    if (r.amount.currency !== available.currency) {
      return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise d'imputation différente de celle du paiement.", ["allocations", i, "amount"]));
    }
    const target = targetsByInstallment.get(r.installmentId);
    if (!target) {
      return err(
        conflict(FinanceCode.ALLOCATION_INVALID_TARGET, "Échéance introuvable, soldée ou non encaissable.", {
          installmentId: r.installmentId,
        }),
      );
    }
    const spent = (spentByInstallment.get(r.installmentId) ?? Money.zero(available.currency)).add(r.amount);
    if (spent.gt(target.remaining)) {
      return err(
        conflict(FinanceCode.ALLOCATION_EXCEEDS_REMAINING, "L'imputation dépasse le reste dû de l'échéance.", {
          installmentId: r.installmentId,
          remaining: target.remaining.amount,
          requested: spent.amount,
        }),
      );
    }
    spentByInstallment.set(r.installmentId, spent);
    total = total.add(r.amount);
    allocations.push({ invoiceId: target.invoiceId, installmentId: r.installmentId, amount: r.amount });
  }
  if (total.gt(available)) {
    return err(
      conflict(FinanceCode.ALLOCATION_EXCEEDS_PAYMENT, "Les imputations dépassent la part non imputée du paiement.", {
        available: available.amount,
        requested: total.amount,
      }),
    );
  }
  return ok({ allocations, allocated: total, unallocated: available.subtract(total) });
}

// ---------------------------------------------------------------------------
// Remboursement : reprise des imputations
// ---------------------------------------------------------------------------

export interface AllocationRecord {
  readonly id: Uuid;
  readonly invoiceId: Uuid;
  readonly installmentId: Uuid;
  /** Imputé NET des reprises déjà faites. */
  readonly net: Money;
  readonly dueDate: IsoDate;
  readonly createdAt: string;
}

export type ReversalStrategy = "LATEST_DUE_FIRST" | "EARLIEST_DUE_FIRST" | "MOST_RECENT_FIRST";

export interface PlannedReversal {
  readonly allocationId: Uuid;
  readonly invoiceId: Uuid;
  readonly installmentId: Uuid;
  readonly amount: Money;
}

/**
 * Part d'un remboursement prélevée d'abord sur le NON IMPUTÉ du paiement (qui n'a
 * aucun effet sur les factures), puis sur les imputations.
 */
export function splitRefund(amount: Money, unallocated: Money): { fromUnallocated: Money; fromAllocations: Money } {
  const fromUnallocated = amount.lt(unallocated) ? amount : unallocated;
  return { fromUnallocated, fromAllocations: amount.subtract(fromUnallocated) };
}

export function planReversals(
  records: ReadonlyArray<AllocationRecord>,
  amount: Money,
  strategy: ReversalStrategy = "LATEST_DUE_FIRST",
): Result<PlannedReversal[], AppError> {
  if (amount.isNegative()) return err(validation(FinanceCode.INVALID_AMOUNT, "Montant à reprendre négatif.", "amount"));
  const order = records.filter((r) => r.net.isPositive()).slice();
  const cmp: Record<ReversalStrategy, (a: AllocationRecord, b: AllocationRecord) => number> = {
    LATEST_DUE_FIRST: (a, b) => compareDates(b.dueDate, a.dueDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    EARLIEST_DUE_FIRST: (a, b) => compareDates(a.dueDate, b.dueDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    MOST_RECENT_FIRST: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  };
  order.sort(cmp[strategy]);
  let left = amount;
  const out: PlannedReversal[] = [];
  for (const r of order) {
    if (left.isZero()) break;
    const take = r.net.lt(left) ? r.net : left;
    out.push({ allocationId: r.id, invoiceId: r.invoiceId, installmentId: r.installmentId, amount: take });
    left = left.subtract(take);
  }
  if (!left.isZero()) {
    return err(conflict(FinanceCode.REFUND_EXCEEDS_REFUNDABLE, "Les imputations ne couvrent pas le montant à reprendre.", { missing: left.amount }));
  }
  return ok(out);
}
