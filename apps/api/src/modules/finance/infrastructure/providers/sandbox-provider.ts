/**
 * SandboxProvider : fournisseur de paiement SIMULÉ, DÉTERMINISTE, EXPLICITE.
 *
 * Ce n'est pas un repli : on le choisit en nommant le fournisseur « sandbox ». Le
 * `ProviderRegistry` le refuse hors développement/test (sauf autorisation explicite
 * par tenant), et tout paiement qu'il traite est marqué `simulated`.
 *
 * Issue d'un paiement (règle unique, sans aléa) :
 *   1. drapeau `metadata.sandbox` = `success | failure | pending` s'il est fourni ;
 *   2. sinon d'après le montant : se terminant par 013 → échec ; se terminant par 001
 *      → en attente ; tout autre montant → succès.
 *
 * Un paiement « en attente » se règle plus tard par `settle(providerRef, issue)`, puis
 * par `verify` ou par un webhook (`buildWebhook`) signé HMAC-SHA256 (en-tête
 * `x-sandbox-signature`, hexadécimal) — le même chemin que les vrais fournisseurs.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, Money, type AppError, type Clock, type CurrencyCode, type Result, systemClock } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, notFound, validation } from "../../domain/errors";
import type {
  PaymentProvider,
  ProviderHeaders,
  ProviderInitiateRequest,
  ProviderInitiation,
  ProviderPaymentStatus,
  ProviderRefundRequest,
  ProviderRefundResult,
  ProviderRefundStatus,
  ProviderRefundStatusRequest,
  ProviderVerification,
  ProviderVerifyRequest,
  ProviderWebhookEvent,
} from "../../application/ports/payment-provider";

export const SANDBOX_PROVIDER_NAME = "sandbox";
export const SANDBOX_SIGNATURE_HEADER = "x-sandbox-signature";
export const DEFAULT_SANDBOX_SECRET = "sandbox-webhook-secret";

export type SandboxOutcome = "success" | "failure" | "pending";

export function resolveSandboxOutcome(amount: Money, flag?: unknown): SandboxOutcome {
  if (flag === "success" || flag === "failure" || flag === "pending") return flag;
  const tail = Math.abs(amount.amount) % 1000;
  if (tail === 13) return "failure";
  if (tail === 1) return "pending";
  return "success";
}

interface SandboxTransaction {
  paymentId: string;
  amount: Money;
  status: ProviderPaymentStatus;
  failureReason?: string;
  settledAt: Date | null;
}

export interface SandboxProviderOptions {
  secret?: string;
  clock?: Clock;
}

export interface SandboxWebhook {
  rawBody: string;
  headers: Record<string, string>;
  eventId: string;
}

const STATUS_BY_EVENT: Readonly<Record<string, ProviderPaymentStatus>> = {
  "payment.succeeded": "SUCCEEDED",
  "payment.failed": "FAILED",
  "payment.cancelled": "CANCELLED",
  "payment.pending": "PENDING",
};
const EVENT_BY_STATUS: Readonly<Record<ProviderPaymentStatus, string>> = {
  SUCCEEDED: "payment.succeeded",
  FAILED: "payment.failed",
  CANCELLED: "payment.cancelled",
  PENDING: "payment.pending",
};

export class SandboxProvider implements PaymentProvider {
  readonly simulated = true;
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly transactions = new Map<string, SandboxTransaction>();

  constructor(options: SandboxProviderOptions = {}) {
    this.secret = options.secret ?? DEFAULT_SANDBOX_SECRET;
    this.clock = options.clock ?? systemClock;
  }

  getProviderName(): string {
    return SANDBOX_PROVIDER_NAME;
  }

  private refFor(paymentId: string): string {
    return `sbx_${paymentId}`;
  }

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    if (!request.amount.isPositive()) {
      return err(validation(FinanceCode.INVALID_AMOUNT, "Montant de paiement invalide.", "amount"));
    }
    const providerRef = this.refFor(request.paymentId);
    const existing = this.transactions.get(providerRef);
    if (existing) {
      // Rejeu : même transaction, même réponse (l'initiation est idempotente).
      return ok(this.initiationFor(providerRef, existing));
    }
    const outcome = resolveSandboxOutcome(request.amount, request.metadata?.sandbox);
    const tx: SandboxTransaction =
      outcome === "success"
        ? { paymentId: request.paymentId, amount: request.amount, status: "SUCCEEDED", settledAt: this.clock.now() }
        : outcome === "failure"
          ? {
              paymentId: request.paymentId,
              amount: request.amount,
              status: "FAILED",
              failureReason: "sandbox_declined",
              settledAt: this.clock.now(),
            }
          : { paymentId: request.paymentId, amount: request.amount, status: "PENDING", settledAt: null };
    this.transactions.set(providerRef, tx);
    return ok(this.initiationFor(providerRef, tx));
  }

  private initiationFor(providerRef: string, tx: SandboxTransaction): ProviderInitiation {
    if (tx.status === "SUCCEEDED") return { providerRef, status: "SUCCEEDED", instructions: "Paiement simulé accepté." };
    if (tx.status === "FAILED") {
      return { providerRef, status: "FAILED", failureReason: tx.failureReason ?? "sandbox_declined" };
    }
    return {
      providerRef,
      status: "PENDING",
      redirectUrl: `https://sandbox.invalid/pay/${providerRef}`,
      instructions: "Paiement simulé en attente de règlement.",
    };
  }

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    const ref = request.providerRef ?? this.refFor(request.paymentId);
    const tx = this.transactions.get(ref);
    if (!tx) return err(notFound(FinanceCode.NOT_FOUND, "Transaction sandbox", ref));
    return ok({
      status: tx.status,
      providerRef: ref,
      amount: tx.amount,
      paidAt: tx.status === "SUCCEEDED" ? tx.settledAt : null,
      ...(tx.failureReason ? { failureReason: tx.failureReason } : {}),
    });
  }

  /** Remboursement simulé : partiel possible, idempotent par `refundId` (même demande = même résultat, jamais deux fois). */
  readonly refundCapabilities = { partial: true, idempotent: true, statusQuery: true } as const;
  private readonly refunds = new Map<string, ProviderRefundResult>();

  async refund(request: ProviderRefundRequest): Promise<Result<ProviderRefundResult, AppError>> {
    const known = this.refunds.get(request.refundId);
    if (known) return ok(known);
    if (!request.amount.isPositive()) return err(validation(FinanceCode.INVALID_AMOUNT, "Montant de remboursement invalide.", "amount"));
    // Accepté aussitôt (la simulation d'un refus n'a pas de sens : le remboursement comptable est testé avec un faux fournisseur).
    const result: ProviderRefundResult = { status: "SUCCEEDED", providerRefundRef: `sbx_refund_${request.refundId}` };
    this.refunds.set(request.refundId, result);
    return ok(result);
  }

  async refundStatus(request: ProviderRefundStatusRequest): Promise<Result<ProviderRefundStatus, AppError>> {
    const known = this.refunds.get(request.refundId);
    return ok(known ? { status: known.status, providerRefundRef: known.providerRefundRef, ...(known.failureReason ? { failureReason: known.failureReason } : {}) } : { status: "NOT_FOUND", providerRefundRef: null });
  }

  /** Règle une transaction « en attente » (action de test / de démonstration). */
  settle(providerRef: string, outcome: "success" | "failure" | "cancelled"): Result<ProviderVerification, AppError> {
    const tx = this.transactions.get(providerRef);
    if (!tx) return err(notFound(FinanceCode.NOT_FOUND, "Transaction sandbox", providerRef));
    if (tx.status !== "PENDING") {
      return err(conflict(FinanceCode.PROVIDER_FAILED, "La transaction sandbox est déjà réglée.", { providerRef }));
    }
    tx.status = outcome === "success" ? "SUCCEEDED" : outcome === "failure" ? "FAILED" : "CANCELLED";
    if (outcome !== "success") tx.failureReason = outcome === "failure" ? "sandbox_declined" : "sandbox_cancelled";
    tx.settledAt = this.clock.now();
    return ok({
      status: tx.status,
      providerRef,
      amount: tx.amount,
      paidAt: tx.status === "SUCCEEDED" ? tx.settledAt : null,
    });
  }

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody, "utf8").digest("hex");
  }

  /**
   * Fabrique un webhook signé pour une transaction connue. `eventId` explicite pour
   * simuler un REJEU (même identifiant) ; par défaut il est dérivé de la référence et du statut.
   */
  buildWebhook(
    providerRef: string,
    options: { eventId?: string; status?: ProviderPaymentStatus; amount?: Money; omitAmount?: boolean } = {},
  ): SandboxWebhook {
    const tx = this.transactions.get(providerRef);
    if (!tx) throw new Error(`Transaction sandbox inconnue : ${providerRef}`);
    const status = options.status ?? tx.status;
    const eventId = options.eventId ?? `evt_${providerRef}_${status.toLowerCase()}`;
    const amount = options.amount ?? tx.amount;
    const body = {
      id: eventId,
      type: EVENT_BY_STATUS[status],
      reference: tx.paymentId,
      transaction: providerRef,
      ...(options.omitAmount ? {} : { amount: amount.amount, currency: amount.currency }),
      occurred_at: (tx.settledAt ?? this.clock.now()).toISOString(),
    };
    const rawBody = JSON.stringify(body);
    return { rawBody, headers: { [SANDBOX_SIGNATURE_HEADER]: this.sign(rawBody), "content-type": "application/json" }, eventId };
  }

  verifySignature(rawBody: string, headers: ProviderHeaders): boolean {
    if (!this.secret) return false;
    const header = headers[SANDBOX_SIGNATURE_HEADER];
    const given = Array.isArray(header) ? header[0] : header;
    if (typeof given !== "string" || !/^[0-9a-f]{64}$/i.test(given)) return false;
    const expected = Buffer.from(this.sign(rawBody), "hex");
    const provided = Buffer.from(given, "hex");
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  async handleWebhook(rawBody: string, _headers: ProviderHeaders): Promise<Result<ProviderWebhookEvent, AppError>> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Corps de webhook illisible (JSON attendu).", "body"));
    }
    if (typeof json !== "object" || json === null) {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Corps de webhook invalide.", "body"));
    }
    const o = json as Record<string, unknown>;
    const id = o.id;
    const type = o.type;
    if (typeof id !== "string" || id.length === 0 || typeof type !== "string" || !(type in STATUS_BY_EVENT)) {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Webhook sans identifiant ou de type inconnu.", "body"));
    }
    let amount: Money | null = null;
    if (o.amount !== undefined) {
      try {
        amount = Money.of(Number(o.amount), (typeof o.currency === "string" ? o.currency : "XOF") as CurrencyCode);
      } catch {
        return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Montant de webhook invalide.", "amount"));
      }
    }
    return ok({
      eventId: id,
      type,
      paymentId: typeof o.reference === "string" ? o.reference : null,
      providerRef: typeof o.transaction === "string" ? o.transaction : null,
      status: STATUS_BY_EVENT[type]!,
      amount,
      occurredAt: typeof o.occurred_at === "string" ? new Date(o.occurred_at) : null,
    });
  }
}
