/**
 * Briques communes aux cas d'usage (toutes s'exécutent DANS une transaction tenant déjà
 * ouverte, avec les factures concernées VERROUILLÉES par l'appelant) :
 *   - recalcul du statut d'une facture après un mouvement ;
 *   - application des imputations (paiement → échéances) et mise à jour des cumuls ;
 *   - émission du reçu ;
 *   - relecture d'une « vue » de paiement.
 *
 * Règle de verrouillage : toute écriture sur une facture ou ses échéances prend d'abord
 * `FOR UPDATE` sur la facture (`lockInvoices`, ordre d'identifiant). Les imputations
 * concurrentes d'un même apprenant se sérialisent donc, sans interblocage.
 */
import { abidjanDate, err, InternalError, ok, Money, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { PlannedAllocation } from "../domain/allocation";
import { diffDays } from "../domain/dates";
import { FinanceEvents } from "../domain/events";
import { installmentRemaining } from "../domain/installments";
import { invoiceBalance, nextInvoiceStatus } from "../domain/invoice";
import { formatDocumentNumber, numberingYear } from "../domain/numbering";
import { sumMoney } from "../domain/money-utils";
import type { AllocationRow, InvoiceRecord, PaymentRecord, ReceiptRecord, ReceiptSnapshot } from "../domain/records";
import { unallocatedAmount } from "../domain/payment";
import type { IsoDate, Uuid } from "../domain/types";
import {
  addInstallmentCumuls,
  addInvoiceCumuls,
  getInstallments,
  getInstallmentsByIds,
  getInvoice,
  updateInvoiceStatus,
} from "../infrastructure/billing-repository";
import {
  addPaymentCumuls,
  getPayment,
  getReceiptByPayment,
  insertAllocation,
  insertReceipt,
  listAllocations,
  nextSequence,
} from "../infrastructure/payments-repository";
import { moneyPayload, type EventBuffer, type FinanceDeps } from "./deps";

export const todayOf = (deps: FinanceDeps): IsoDate => abidjanDate(deps.clock.now());

/**
 * Recalcule le statut d'une facture émise d'après ses montants et ses échéances, l'enregistre
 * s'il change, et publie `finance.invoice.paid` / `finance.invoice.overdue` à la bonne transition.
 * La facture doit être verrouillée par l'appelant.
 */
export async function refreshInvoiceStatus(
  deps: FinanceDeps,
  tx: Tx,
  events: EventBuffer,
  invoiceId: Uuid,
): Promise<Result<InvoiceRecord, AppError>> {
  const invoice = await getInvoice(tx, invoiceId);
  if (!invoice) return err(new InternalError("refreshInvoiceStatus : facture introuvable.", { code: "finance.invoice_not_found" }));
  const installments = await getInstallments(tx, invoiceId);
  const today = todayOf(deps);
  const next = nextInvoiceStatus({
    current: invoice.status,
    amounts: { total: invoice.total, paid: invoice.paid, credited: invoice.credited },
    installments,
    today,
  });
  if (!next.ok) return next;
  if (next.value === invoice.status) return ok(invoice);

  await updateInvoiceStatus(tx, invoiceId, next.value);
  const updated: InvoiceRecord = { ...invoice, status: next.value };
  const balance = invoiceBalance({ total: invoice.total, paid: invoice.paid, credited: invoice.credited });

  if (next.value === "PAID" && invoice.number) {
    events.add(
      FinanceEvents.INVOICE_PAID,
      { v: 1, invoiceId, number: invoice.number, learnerId: invoice.learnerId, total: moneyPayload(invoice.total) },
      { type: "invoice", id: invoiceId },
    );
  }
  if (next.value === "OVERDUE" && invoice.number) {
    const overdue = installments.filter((i) => installmentRemaining(i).isPositive() && i.dueDate < today);
    const oldest = overdue.map((i) => i.dueDate).sort()[0] ?? today;
    events.add(
      FinanceEvents.INVOICE_OVERDUE,
      {
        v: 1,
        invoiceId,
        number: invoice.number,
        learnerId: invoice.learnerId,
        enrollmentId: invoice.enrollmentId,
        balance: moneyPayload(balance),
        overdueAmount: moneyPayload(sumMoney(overdue.map(installmentRemaining), invoice.currency)),
        oldestDueDate: oldest,
        daysOverdue: Math.max(0, diffDays(oldest, today)),
        asOf: today,
      },
      { type: "invoice", id: invoiceId },
    );
  }
  return ok(updated);
}

export interface AppliedAllocation {
  allocationId: Uuid;
  invoiceId: Uuid;
  installmentId: Uuid;
  lineId: Uuid | null;
  amount: Money;
}

/**
 * Enregistre les imputations d'un paiement CONFIRMÉ : lignes d'imputation (append-only),
 * cumuls des échéances, des factures et du paiement, puis recalcul des statuts de factures.
 * Les factures concernées sont déjà verrouillées ; la base re-vérifie tout au COMMIT.
 */
export async function applyAllocations(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  payment: PaymentRecord,
  planned: ReadonlyArray<PlannedAllocation & { lineId?: Uuid | null }>,
): Promise<Result<AppliedAllocation[], AppError>> {
  if (planned.length === 0) return ok([]);
  const applied: AppliedAllocation[] = [];
  const perInvoice = new Map<Uuid, Money>();
  for (const p of planned) {
    const id = deps.newId();
    await insertAllocation(tx, ctx.tenantId, {
      id,
      paymentId: payment.id,
      invoiceId: p.invoiceId,
      installmentId: p.installmentId,
      lineId: p.lineId ?? null,
      amount: p.amount,
      createdBy: ctx.userId,
    });
    await addInstallmentCumuls(tx, p.installmentId, { paid: p.amount });
    perInvoice.set(p.invoiceId, (perInvoice.get(p.invoiceId) ?? Money.zero(p.amount.currency)).add(p.amount));
    applied.push({ allocationId: id, invoiceId: p.invoiceId, installmentId: p.installmentId, lineId: p.lineId ?? null, amount: p.amount });
  }
  for (const [invoiceId, amount] of perInvoice) {
    await addInvoiceCumuls(tx, invoiceId, { paid: amount });
  }
  const total = sumMoney(applied.map((a) => a.amount), payment.amount.currency);
  await addPaymentCumuls(tx, payment.id, { allocated: total });

  for (const invoiceId of [...perInvoice.keys()].sort()) {
    const r = await refreshInvoiceStatus(deps, tx, events, invoiceId);
    if (!r.ok) return r;
  }
  events.add(
    FinanceEvents.PAYMENT_ALLOCATED,
    {
      v: 1,
      paymentId: payment.id,
      learnerId: payment.learnerId,
      allocations: applied.map((a) => ({ invoiceId: a.invoiceId, installmentId: a.installmentId, amount: a.amount.amount })),
    },
    { type: "payment", id: payment.id },
  );
  return ok(applied);
}

/** Émet le reçu `REC-aaaa-nnnnnn` d'un paiement confirmé (une seule fois par paiement). */
export async function issueReceipt(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  paymentId: Uuid,
): Promise<ReceiptRecord> {
  const existing = await getReceiptByPayment(tx, paymentId);
  if (existing) return existing;

  // Relecture après imputation : montants à jour pour l'instantané.
  const payment = await loadPayment(tx, paymentId);
  const allocations = await listAllocations(tx, paymentId);
  const invoiceIds = [...new Set(allocations.map((a) => a.invoiceId))].sort();
  const invoices = new Map<Uuid, InvoiceRecord>();
  for (const id of invoiceIds) {
    const inv = await getInvoice(tx, id);
    if (inv) invoices.set(id, inv);
  }
  const installments = await getInstallmentsByIds(tx, allocations.map((a) => a.installmentId));
  const labelOf = new Map(installments.map((i) => [i.id, i.label]));
  const balanceAfter =
    invoices.size > 0
      ? sumMoney(
          [...invoices.values()].map((i) => invoiceBalance({ total: i.total, paid: i.paid, credited: i.credited })),
          payment.amount.currency,
        )
      : null;

  const now = deps.clock.now();
  const year = numberingYear(deps.clock);
  const seq = await nextSequence(tx, "RECEIPT", year);
  const number = formatDocumentNumber("RECEIPT", year, seq);
  const snapshot: ReceiptSnapshot = {
    v: 1,
    number,
    issuedAt: now.toISOString(),
    learnerId: payment.learnerId,
    enrollmentId: payment.enrollmentId,
    payer: { kind: payment.payerKind, ref: payment.payerRef, name: payment.payerName },
    method: payment.method,
    reference: payment.reference,
    amount: moneyPayload(payment.amount),
    allocations: allocations
      .filter((a) => a.net.isPositive() || a.amount.isPositive())
      .map((a) => ({
        invoiceId: a.invoiceId,
        invoiceNumber: invoices.get(a.invoiceId)?.number ?? null,
        installmentId: a.installmentId,
        label: labelOf.get(a.installmentId) ?? "",
        amount: a.amount.amount,
      })),
    unallocated: moneyPayload(unallocatedAmount({ amount: payment.amount, allocated: payment.allocated, refunded: payment.refunded })),
    balanceAfter: balanceAfter ? moneyPayload(balanceAfter) : null,
  };
  const receipt = await insertReceipt(tx, ctx.tenantId, {
    id: deps.newId(),
    number,
    year,
    seq,
    paymentId,
    learnerId: payment.learnerId,
    amount: payment.amount,
    issuedAt: now,
    issuedBy: ctx.userId,
    snapshot,
  });
  events.add(
    FinanceEvents.RECEIPT_ISSUED,
    { v: 1, receiptId: receipt.id, number, paymentId, learnerId: payment.learnerId, amount: moneyPayload(payment.amount) },
    { type: "receipt", id: receipt.id },
  );
  return receipt;
}

async function loadPayment(tx: Tx, id: Uuid): Promise<PaymentRecord> {
  const p = await getPayment(tx, id);
  if (!p) throw new Error(`Paiement introuvable : ${id}`);
  return p;
}

export interface PaymentView {
  payment: PaymentRecord;
  receipt: ReceiptRecord | null;
  allocations: ReadonlyArray<AllocationRow>;
  unallocated: Money;
  replayed: boolean;
}

export async function loadPaymentView(tx: Tx, paymentId: Uuid, replayed = false): Promise<PaymentView> {
  const payment = await loadPayment(tx, paymentId);
  const [receipt, allocations] = await Promise.all([getReceiptByPayment(tx, paymentId), listAllocations(tx, paymentId)]);
  return {
    payment,
    receipt,
    allocations,
    unallocated: payment.status === "CONFIRMED" ? unallocatedAmount(payment) : Money.zero(payment.amount.currency),
    replayed,
  };
}
