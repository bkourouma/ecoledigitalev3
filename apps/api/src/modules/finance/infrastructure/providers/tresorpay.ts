/**
 * TresorPay — paiement de la scolarité (seul fournisseur du legacy lié à `student-payments`).
 *
 * ATTENTION (Q-PAY-09, confiance FAIBLE) : aucune documentation publique n'a été trouvée. Le contrat est celui du
 * client legacy `tresorpay-gateway.service.ts` :
 *   - appels signés : `X-API-Key`, `X-Merchant-ID`, `X-Timestamp`, `X-Signature = HMAC-SHA256(secret_key,
 *     MÉTHODE + chemin + corps + horodatage)` ;
 *   - `POST /payments/initialize`, `GET /payments/{id}/verify`, `POST /refunds` ;
 *   - webhook : `x-signature = HMAC-SHA256(webhook_secret, corps brut)` (hexadécimal) ; le webhook porte l'identifiant
 *     TresorPay (`transaction_id`), rapproché par `provider_ref`.
 * Différences voulues avec le legacy : aucune simulation (`mock_…`), un statut inconnu est « en attente » (le legacy
 * le traitait comme un ÉCHEC), montants entiers vérifiés, secret absent ⇒ refus, configuration par tenant.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type {
  PaymentProvider,
  ProviderConnectionCheck,
  ProviderHeaders,
  ProviderInitiateRequest,
  ProviderInitiation,
  ProviderPaymentStatus,
  ProviderRefundRequest,
  ProviderRefundResult,
  ProviderVerification,
  ProviderVerifyRequest,
  ProviderWebhookEvent,
  ProviderWebhookMeta,
} from "../../application/ports/payment-provider";
import { FinanceCode, validation } from "../../domain/errors";
import { endpointFor, invalidAmount, invalidInput, malformed, modeOf, safeUpstreamCode, upstreamError, type AdapterRuntime } from "./adapter-kit";
import { constantTimeEqual, headerOf, hmacSha256Hex, isNonEmpty, maskMsisdn, normalizeMsisdn, obj, parseDate, parseJsonObject, parseProviderAmount, str } from "./common";
import { ProviderHttp, type HttpResult } from "./http";
import type { ProviderSettings } from "./registry";

export const TRESORPAY_NAME = "tresorpay";
export const TRESORPAY_DEFAULT_BASE_URL = "https://api.tresorpay.com/v1";
export const TRESORPAY_SIGNATURE_HEADER = "x-signature";
const METHODS = new Set(["ORANGE_MONEY", "MTN_MONEY", "MOOV_MONEY", "CARD", "BANK_TRANSFER"]);

export class TresorPayProvider implements PaymentProvider {
  readonly simulated = false;
  private readonly http: ProviderHttp;
  private readonly baseUrl: string;

  constructor(
    _tenantId: string,
    private readonly settings: ProviderSettings,
    private readonly runtime: AdapterRuntime,
  ) {
    // Pas d'hôte de test connu : en sandbox, un point d'accès DOIT être fourni par la plateforme (jamais l'hôte de production).
    this.baseUrl = endpointFor(runtime, TRESORPAY_NAME, modeOf(settings), { production: TRESORPAY_DEFAULT_BASE_URL, sandbox: "" });
    this.http = new ProviderHttp({
      provider: TRESORPAY_NAME,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      ...(runtime.sleep ? { sleep: runtime.sleep } : {}),
      ...(runtime.timeoutMs ? { timeoutMs: runtime.timeoutMs } : {}),
      ...(runtime.retries !== undefined ? { retries: runtime.retries } : {}),
      logger: runtime.logger,
      ...(runtime.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    });
  }

  getProviderName(): string {
    return TRESORPAY_NAME;
  }

  /** Signature d'un appel sortant (Q-PAY-09). */
  signRequest(method: string, endpoint: string, body: string, timestamp: string): string {
    return hmacSha256Hex(this.settings.secret_key ?? "", `${method}${endpoint}${body}${timestamp}`);
  }

  private signed(method: "GET" | "POST", endpoint: string, operation: string, safeToRetry: boolean, body?: string): Promise<Result<HttpResult, AppError>> {
    const timestamp = String(this.runtime.clock.now().getTime());
    return this.http.request({
      method,
      url: `${this.baseUrl}${endpoint}`,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.settings.api_key ?? "",
        "x-merchant-id": this.settings.merchant_id ?? "",
        "x-timestamp": timestamp,
        "x-signature": this.signRequest(method, endpoint, body ?? "", timestamp),
      },
      ...(body !== undefined ? { body } : {}),
      operation,
      safeToRetry,
    });
  }

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    if (request.amount.currency !== "XOF" || !request.amount.isPositive()) {
      return err(invalidAmount("TresorPay accepte uniquement un montant entier positif en XOF."));
    }
    if (!isNonEmpty(request.returnUrl)) return err(invalidInput("L'URL de retour est obligatoire pour TresorPay.", "returnUrl"));
    if (!isNonEmpty(request.notifyUrl)) return err(invalidInput("L'URL de notification est obligatoire pour TresorPay.", "notifyUrl"));
    const name = request.payer?.name?.trim();
    const email = request.payer?.email?.trim();
    if (!name || !email) return err(invalidInput("Le nom et l'adresse e-mail du payeur sont obligatoires pour TresorPay.", "payer"));
    const phone = normalizeMsisdn(request.payer?.phoneNumber);
    const method = typeof request.metadata?.tresorpayMethod === "string" && METHODS.has(request.metadata.tresorpayMethod) ? request.metadata.tresorpayMethod : "CARD";
    const body = JSON.stringify({
      amount: request.amount.toNumber(),
      currency: "XOF",
      transaction_id: request.paymentId,
      customer_name: name,
      customer_email: email,
      ...(phone ? { customer_phone: phone } : {}),
      payment_method: method,
      return_url: request.returnUrl,
      cancel_url: request.returnUrl,
      webhook_url: request.notifyUrl,
      description: (request.description ?? "Paiement scolarite").slice(0, 200),
    });
    const res = await this.signed("POST", "/payments/initialize", "initiate", false, body);
    if (!res.ok) return res;
    const { status, json } = res.value;
    if (status >= 500) return err(upstreamError(TRESORPAY_NAME, "initiate", "upstream_5xx", { httpStatus: status }));
    const o = obj(json);
    if (status === 401 || status === 403) return err(upstreamError(TRESORPAY_NAME, "initiate", "credentials_rejected", { httpStatus: status }));
    if (status >= 400 || !o || o.status !== "success") {
      return err(upstreamError(TRESORPAY_NAME, "initiate", "rejected", { httpStatus: status, ...codeOf(o) }));
    }
    const data = obj(o.data);
    const ref = str(data?.transaction_id);
    const url = str(data?.payment_url);
    if (!ref || !url) return malformed(TRESORPAY_NAME, "initiate");
    return ok({ providerRef: ref, status: "PENDING", redirectUrl: url, instructions: "Finalisez le paiement sur la page TresorPay." });
  }

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    if (!request.providerRef) return ok({ status: "PENDING", providerRef: null, amount: null, paidAt: null });
    const res = await this.signed("GET", `/payments/${encodeURIComponent(request.providerRef)}/verify`, "verify", true);
    if (!res.ok) return res;
    const { status, json } = res.value;
    if (status === 404) return ok({ status: "PENDING", providerRef: request.providerRef, amount: null, paidAt: null });
    const o = obj(json);
    const data = obj(o?.data);
    if (status >= 400 || !o || o.status !== "success" || !data) {
      return err(upstreamError(TRESORPAY_NAME, "verify", "rejected", { httpStatus: status, ...codeOf(o) }));
    }
    const echoed = str(data.transaction_id);
    if (echoed && echoed !== request.providerRef) return err(upstreamError(TRESORPAY_NAME, "verify", "reference_mismatch"));
    const mapped = mapTresorPayStatus(str(data.status) ?? "");
    if (mapped.status !== "SUCCEEDED") {
      return ok({ status: mapped.status, providerRef: request.providerRef, amount: null, paidAt: null, ...(mapped.reason ? { failureReason: mapped.reason } : {}) });
    }
    const amount = str(data.currency) === "XOF" ? parseProviderAmount(data.amount, "XOF") : null;
    if (!amount) return malformed(TRESORPAY_NAME, "verify");
    return ok({ status: "SUCCEEDED", providerRef: request.providerRef, amount, paidAt: parseDate(data.processed_at) ?? this.runtime.clock.now() });
  }

  verifySignature(rawBody: string, headers: ProviderHeaders, _meta?: ProviderWebhookMeta): boolean {
    const secret = this.settings.webhook_secret;
    const given = headerOf(headers, TRESORPAY_SIGNATURE_HEADER);
    if (!isNonEmpty(secret) || !isNonEmpty(given) || !/^[0-9a-f]{64}$/i.test(given.trim())) return false;
    return constantTimeEqual(hmacSha256Hex(secret, rawBody), given.trim().toLowerCase());
  }

  async handleWebhook(rawBody: string, _headers: ProviderHeaders, _meta?: ProviderWebhookMeta): Promise<Result<ProviderWebhookEvent, AppError>> {
    const o = parseJsonObject(rawBody);
    const ref = str(o?.transaction_id);
    const rawStatus = str(o?.status);
    if (!o || !ref || !rawStatus) return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Webhook TresorPay illisible.", "body"));
    const mapped = mapTresorPayStatus(rawStatus);
    let amount = null;
    if (mapped.status === "SUCCEEDED") {
      amount = str(o.currency) === "XOF" ? parseProviderAmount(o.amount, "XOF") : null;
      if (!amount) return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Montant du webhook TresorPay invalide.", "amount"));
    }
    return ok({
      eventId: `tp:${ref}:${rawStatus.toLowerCase()}`,
      type: `payment.${rawStatus.toLowerCase()}`,
      paymentId: null,
      providerRef: ref,
      status: mapped.status,
      amount,
      occurredAt: null,
      storedPayload: {
        transaction_id: ref,
        status: rawStatus,
        ...(typeof o.amount === "number" || typeof o.amount === "string" ? { amount: o.amount } : {}),
        ...(str(o.currency) ? { currency: str(o.currency) } : {}),
        ...(str(o.customer_phone) ? { customer_phone: maskMsisdn(o.customer_phone) } : {}),
      },
    });
  }

  webhookUrl(baseUrl: string, _tenantId: string): string {
    return baseUrl;
  }

  async refund(request: ProviderRefundRequest): Promise<Result<ProviderRefundResult, AppError>> {
    if (!request.providerRef) return err(invalidInput("Référence TresorPay du paiement manquante.", "providerRef"));
    if (request.amount.currency !== "XOF" || !request.amount.isPositive()) return err(invalidAmount("Montant de remboursement invalide."));
    const body = JSON.stringify({ transaction_id: request.providerRef, amount: request.amount.toNumber(), reason: (request.reason ?? "Remboursement").slice(0, 200) });
    // Non idempotent côté fournisseur (aucune clé documentée) : jamais rejoué après une réponse ambiguë.
    const res = await this.signed("POST", "/refunds", "refund", false, body);
    if (!res.ok) return res;
    const o = obj(res.value.json);
    const data = obj(o?.data);
    if (res.value.status >= 400 || !o || o.status !== "success" || !data) {
      return ok({ status: "FAILED", providerRefundRef: null, failureReason: `http_${res.value.status}` });
    }
    const s = str(data.status);
    return ok({ status: s === "completed" ? "SUCCEEDED" : s === "failed" ? "FAILED" : "PENDING", providerRefundRef: str(data.refund_id) ?? null });
  }

  async testConnection(): Promise<Result<ProviderConnectionCheck, AppError>> {
    const res = await this.signed("GET", "/payments/ed-connection-test/verify", "test", true);
    if (!res.ok) return ok({ ok: false, code: "unreachable" });
    const s = res.value.status;
    if (s === 401 || s === 403) return ok({ ok: false, code: "credentials_rejected" });
    return s === 404 || s < 400 ? ok({ ok: true, code: "ok" }) : ok({ ok: false, code: "unexpected_response" });
  }
}

function codeOf(o: Record<string, unknown> | undefined): Record<string, string> {
  const code = safeUpstreamCode(o?.code ?? o?.error);
  return code ? { upstreamCode: code } : {};
}

/** Statut inconnu ⇒ en attente (le legacy le traitait comme un échec : défaut corrigé). */
export function mapTresorPayStatus(raw: string): { status: ProviderPaymentStatus; reason?: string } {
  switch (raw.toLowerCase()) {
    case "completed":
    case "success":
      return { status: "SUCCEEDED" };
    case "failed":
    case "error":
      return { status: "FAILED", reason: "declined" };
    case "cancelled":
    case "canceled":
      return { status: "CANCELLED", reason: "cancelled" };
    default:
      return { status: "PENDING" };
  }
}
