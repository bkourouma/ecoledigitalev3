/**
 * Vues FAMILLE de la finance : un parent lit la situation financière de SES enfants, un élève la sienne
 * (`/api/v1/finance/me/*`), et le parent peut initier un paiement en ligne pour son enfant.
 *
 * Modèle d'autorisation (deux couches, aucune ne remplace l'autre) :
 *  1. RBAC : `finance.child.read|pay` (parent) ou `finance.self.read|pay` (élève) — porté par le rôle de l'utilisateur ;
 *  2. PROPRIÉTÉ, côté serveur, relue à chaque requête par le port `GuardianshipPort` (module people) : l'élève est-il
 *     bien l'apprenant lié au compte (`persons.identity_id`, jamais l'e-mail) ou l'enfant d'un tuteur vivant ?
 *
 * Un échec de propriété, de permission précise ou d'identifiant de sous-ressource répond TOUJOURS la même 404
 * (`finance.not_found`, même message) : on ne révèle ni l'existence d'un apprenant, ni celle d'une facture, ni un lien.
 *
 * Périmètre exposé (minimisation) : factures ÉMISES (numérotées) et paiements à la charge de la FAMILLE (`payerKind =
 * LEARNER`) ; jamais un brouillon ni une facture/un paiement de financeur (État, entreprise…) ; les champs internes
 * (référence fournisseur, session de caisse, motif d'annulation, simulation) ne sont pas dans les DTO famille.
 */
import { createHash } from "node:crypto";
import { err, NotFoundError, ok, Money, type AppError, type CurrencyCode, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, validation } from "../domain/errors";
import { invoiceBalance, PAYABLE_INVOICE_STATUSES } from "../domain/invoice";
import { sumMoney } from "../domain/money-utils";
import type { InvoiceDetail, InvoiceRecord, PaymentRecord, ReceiptRecord } from "../domain/records";
import { summarizeReceivables } from "../domain/reporting";
import type { Uuid } from "../domain/types";
import { getInvoiceDetail, listInstallmentsOfLearner, listInvoices, type LearnerInstallmentRow } from "../infrastructure/billing-repository";
import { getPayment, getReceipt, listPayments, listReceipts } from "../infrastructure/payments-repository";
import { loadPaymentView, type PaymentView } from "./billing-core";
import { inTx, type FinanceDeps } from "./deps";
import { initiateOnlinePayment, verifyPendingPayment, type OnlinePaymentResult } from "./online-payments";

export type FamilyRelation = "SELF" | "GUARDIAN";
export type FamilyAction = "read" | "pay";

/** Vrai si l'appelant détient la permission (jamais d'exception pour un simple refus). */
export type PermissionProbe = (permission: string) => Promise<boolean>;

export const FAMILY_PERMISSIONS: Readonly<Record<FamilyRelation, Readonly<Record<FamilyAction, string>>>> = Object.freeze({
  SELF: Object.freeze({ read: "finance.self.read", pay: "finance.self.pay" }),
  GUARDIAN: Object.freeze({ read: "finance.child.read", pay: "finance.child.pay" }),
});

/** Plafond de lignes des listes famille (statement, échéances) : une famille n'a pas des milliers de factures. */
export const FAMILY_LIST_MAX = 500;

export interface FamilyAccess {
  readonly learnerId: Uuid;
  readonly relation: FamilyRelation;
}

/** LA 404 uniforme : même code, même message, aucun identifiant. */
export const familyNotFound = (): AppError => new NotFoundError("Ressource introuvable.", { code: FinanceCode.NOT_FOUND });

/**
 * Autorise l'accès de l'appelant à CET apprenant pour cette action. `Err` = 404 uniforme dans tous les cas de refus
 * (non lié, lien clos, apprenant inconnu, permission du bon type absente, compte sans identité, port non branché).
 */
export async function authorizeFamilyAccess(
  deps: FinanceDeps,
  ctx: RequestContext,
  learnerId: Uuid,
  action: FamilyAction,
  can: PermissionProbe,
): Promise<Result<FamilyAccess, AppError>> {
  const userId = ctx.userId;
  if (!userId) return err(familyNotFound());
  const own = await deps.guardianship.studentIdForUser(ctx, userId);
  let relation: FamilyRelation | null = null;
  if (own !== null && own === learnerId) relation = "SELF";
  else if (await deps.guardianship.isGuardianOf(ctx, userId, learnerId)) relation = "GUARDIAN";
  if (!relation) return err(familyNotFound());
  if (!(await can(FAMILY_PERMISSIONS[relation][action]))) return err(familyNotFound());
  return ok({ learnerId, relation });
}

/** Apprenants que l'appelant a le droit de voir : lui-même (`finance.self.read`) et ses enfants (`finance.child.read`). */
export async function listMyLearners(deps: FinanceDeps, ctx: RequestContext, can: PermissionProbe): Promise<Result<FamilyAccess[], AppError>> {
  const userId = ctx.userId;
  if (!userId) return ok([]);
  const out: FamilyAccess[] = [];
  const seen = new Set<string>();
  if (await can(FAMILY_PERMISSIONS.SELF.read)) {
    const own = await deps.guardianship.studentIdForUser(ctx, userId);
    if (own) {
      out.push({ learnerId: own, relation: "SELF" });
      seen.add(own);
    }
  }
  if (await can(FAMILY_PERMISSIONS.GUARDIAN.read)) {
    for (const child of await deps.guardianship.childrenOf(ctx, userId)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push({ learnerId: child, relation: "GUARDIAN" });
    }
  }
  return ok(out);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------------------------------

export interface FamilyStatement {
  learnerId: Uuid;
  currency: CurrencyCode;
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  totals: { billed: Money; credited: Money; collected: Money; outstanding: Money; unallocatedPayments: Money };
}

/** Situation financière : factures émises à la charge de la famille, paiements, soldes. */
export async function getFamilyStatement(
  deps: FinanceDeps,
  ctx: RequestContext,
  access: FamilyAccess,
  input: { academicYear?: string; currency?: CurrencyCode } = {},
): Promise<Result<FamilyStatement, AppError>> {
  const currency = input.currency ?? deps.config.defaultCurrency;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const invoices = (
        await listInvoices(tx, { learnerId: access.learnerId, payerKind: "LEARNER", issuedOnly: true, ...(input.academicYear ? { academicYear: input.academicYear } : {}), limit: FAMILY_LIST_MAX, offset: 0 })
      ).items.filter((i) => i.currency === currency);
      const payments = (await listPayments(tx, { learnerId: access.learnerId, payerKind: "LEARNER", limit: FAMILY_LIST_MAX, offset: 0 })).items.filter((p) => p.amount.currency === currency);
      const s = summarizeReceivables(
        invoices.map((i) => ({ status: i.status, total: i.total, paid: i.paid, credited: i.credited })),
        currency,
      );
      const unallocated = sumMoney(
        payments.filter((p) => p.status === "CONFIRMED").map((p) => p.amount.subtract(p.allocated).subtract(p.refunded)),
        currency,
      );
      return ok({
        learnerId: access.learnerId,
        currency,
        invoices,
        payments,
        totals: { billed: s.billed, credited: s.credited, collected: s.collected, outstanding: s.outstanding, unallocatedPayments: unallocated },
      });
    },
    { readOnly: true },
  );
}

export async function listFamilyInvoices(
  deps: FinanceDeps,
  ctx: RequestContext,
  access: FamilyAccess,
  filter: { academicYear?: string; status?: InvoiceRecord["status"]; limit: number; offset: number },
): Promise<Result<{ items: InvoiceRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit, 1), 200);
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await listInvoices(tx, {
          learnerId: access.learnerId,
          payerKind: "LEARNER",
          issuedOnly: true,
          ...(filter.academicYear ? { academicYear: filter.academicYear } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          limit,
          offset: Math.max(filter.offset, 0),
        }),
      ),
    { readOnly: true },
  );
}

/** Une facture appartient à la famille si elle est de CET apprenant, émise et à la charge de la famille. */
const isFamilyInvoice = (inv: InvoiceRecord, learnerId: Uuid): boolean => inv.learnerId === learnerId && inv.payerKind === "LEARNER" && inv.number !== null;

export async function getFamilyInvoice(deps: FinanceDeps, ctx: RequestContext, access: FamilyAccess, invoiceId: Uuid): Promise<Result<InvoiceDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const detail = await getInvoiceDetail(tx, invoiceId);
      return detail && isFamilyInvoice(detail.invoice, access.learnerId) ? ok(detail) : err(familyNotFound());
    },
    { readOnly: true },
  );
}

/** Échéances à venir ou en retard (`openOnly`) ou toutes, avec le numéro de leur facture. */
export async function listFamilyInstallments(
  deps: FinanceDeps,
  ctx: RequestContext,
  access: FamilyAccess,
  input: { openOnly?: boolean } = {},
): Promise<Result<LearnerInstallmentRow[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listInstallmentsOfLearner(tx, access.learnerId, { openOnly: input.openOnly === true, limit: FAMILY_LIST_MAX })), { readOnly: true });
}

export async function listFamilyPayments(
  deps: FinanceDeps,
  ctx: RequestContext,
  access: FamilyAccess,
  filter: { status?: PaymentRecord["status"]; limit: number; offset: number },
): Promise<Result<{ items: PaymentRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit, 1), 200);
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await listPayments(tx, { learnerId: access.learnerId, payerKind: "LEARNER", ...(filter.status ? { status: filter.status } : {}), limit, offset: Math.max(filter.offset, 0) })),
    { readOnly: true },
  );
}

const isFamilyPayment = (p: PaymentRecord, learnerId: Uuid): boolean => p.learnerId === learnerId && p.payerKind === "LEARNER";

export async function getFamilyPayment(deps: FinanceDeps, ctx: RequestContext, access: FamilyAccess, paymentId: Uuid): Promise<Result<PaymentView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const payment = await getPayment(tx, paymentId);
      if (!payment || !isFamilyPayment(payment, access.learnerId)) return err(familyNotFound());
      return ok(await loadPaymentView(tx, paymentId));
    },
    { readOnly: true },
  );
}

export async function listFamilyReceipts(
  deps: FinanceDeps,
  ctx: RequestContext,
  access: FamilyAccess,
  filter: { limit: number; offset: number },
): Promise<Result<{ items: ReceiptRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listReceipts(tx, { learnerId: access.learnerId, payerKind: "LEARNER", limit, offset: Math.max(filter.offset, 0) })), { readOnly: true });
}

/** Reçu d'un paiement de la famille (reçu d'un autre apprenant ou d'un financeur : 404 uniforme). */
export async function getFamilyReceipt(deps: FinanceDeps, ctx: RequestContext, access: FamilyAccess, receiptId: Uuid): Promise<Result<ReceiptRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const receipt = await getReceipt(tx, receiptId);
      if (!receipt || receipt.learnerId !== access.learnerId) return err(familyNotFound());
      const payment = await getPayment(tx, receipt.paymentId);
      if (!payment || !isFamilyPayment(payment, access.learnerId)) return err(familyNotFound());
      return ok(receipt);
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Paiement en ligne initié par la famille
// ---------------------------------------------------------------------------------------------------------------------

export interface FamilyOnlinePaymentInput {
  /** Clé fournie par le client ; ESPACE DE NOMS par utilisateur (voir `familyIdempotencyKey`). */
  idempotencyKey: string;
  invoiceId: Uuid;
  amount: Money;
  provider: string;
  payer?: { phoneNumber?: string; name?: string; email?: string };
  returnUrl?: string;
  description?: string;
}

/**
 * Clé d'idempotence PROPRE à l'utilisateur : la clé fournie par un parent ne peut ni rejouer ni heurter (409) le
 * paiement d'un autre compte du tenant (la contrainte d'unicité est par tenant). Forme `fam:<sha256 tronqué>`.
 */
export function familyIdempotencyKey(userId: string, key: string): string {
  return `fam:${createHash("sha256").update(`${userId}\u0000${key.trim()}`).digest("hex").slice(0, 48)}`;
}

/**
 * Initie un paiement en ligne pour un apprenant lié. Contrôles côté serveur, AVANT tout appel au fournisseur : la facture
 * est celle de l'apprenant, émise, à la charge de la famille et encaissable ; la devise est la sienne ; le montant ne
 * dépasse pas son reste dû. L'accès (`access`) a déjà été autorisé avec l'action `pay`.
 */
export async function initiateFamilyOnlinePayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  access: FamilyAccess,
  input: FamilyOnlinePaymentInput,
): Promise<Result<OnlinePaymentResult, AppError>> {
  if (!ctx.userId) return err(familyNotFound());
  if (!input.amount.isPositive()) return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant du paiement doit être strictement positif.", "amount"));

  const checked = await inTx(
    deps,
    ctx,
    async (tx) => {
      const detail = await getInvoiceDetail(tx, input.invoiceId);
      if (!detail || !isFamilyInvoice(detail.invoice, access.learnerId)) return err(familyNotFound());
      const inv = detail.invoice;
      if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status)) {
        return err(conflict(FinanceCode.INVOICE_NOT_PAYABLE, "Cette facture n'est pas encaissable.", { status: inv.status }));
      }
      if (inv.currency !== input.amount.currency) {
        return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du paiement différente de celle de la facture.", "amount"));
      }
      const balance = invoiceBalance({ total: inv.total, paid: inv.paid, credited: inv.credited });
      if (input.amount.amount > balance.amount) {
        return err(
          validation(FinanceCode.ALLOCATION_EXCEEDS_REMAINING, "Le montant dépasse le reste dû de la facture.", "amount", { remaining: balance.amount }),
        );
      }
      return ok({ enrollmentId: inv.enrollmentId });
    },
    { readOnly: true },
  );
  if (!checked.ok) return checked;

  const started = await initiateOnlinePayment(deps, ctx, {
    idempotencyKey: familyIdempotencyKey(ctx.userId, input.idempotencyKey),
    learnerId: access.learnerId,
    ...(checked.value.enrollmentId ? { enrollmentId: checked.value.enrollmentId } : {}),
    amount: input.amount,
    provider: input.provider,
    invoiceId: input.invoiceId,
    ...(input.payer ? { payer: input.payer } : {}),
    ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
    ...(input.description ? { description: input.description } : {}),
    metadata: { channel: "family" },
  });
  if (!started.ok) return started;

  if (!started.value.replayed) {
    // Trace de QUI a initié (tuteur ou élève) et POUR QUEL apprenant : dans une transaction dédiée, après l'appel réseau.
    await deps.db.run(ctx, (tx) =>
      deps.audit.record(tx, ctx, {
        action: "finance.payment.family_initiated",
        resourceType: "payment",
        resourceId: started.value.payment.id,
        after: { learnerId: access.learnerId, relation: access.relation, invoiceId: input.invoiceId, amount: input.amount.amount, currency: input.amount.currency, provider: input.provider },
      }),
    );
  }
  return started;
}

/** Interroge le fournisseur sur un paiement EN ATTENTE de l'apprenant lié (suivi côté écran famille). */
export async function verifyFamilyPayment(deps: FinanceDeps, ctx: RequestContext, access: FamilyAccess, paymentId: Uuid): Promise<Result<PaymentView, AppError>> {
  const owned = await inTx(
    deps,
    ctx,
    async (tx) => {
      const payment = await getPayment(tx, paymentId);
      return payment && isFamilyPayment(payment, access.learnerId) ? ok(true) : err(familyNotFound());
    },
    { readOnly: true },
  );
  if (!owned.ok) return owned;
  return verifyPendingPayment(deps, ctx, { paymentId });
}
