/**
 * MTN MoMo — Collection API (Request to Pay), Côte d'Ivoire.
 *
 * Flux : jeton (`POST /collection/token/`, Basic api_user:api_key + `Ocp-Apim-Subscription-Key`) →
 * `POST /collection/v1_0/requesttopay` (202, corps vide ; `X-Reference-Id` = UUID **v4** de la transaction) →
 * le payeur valide sur son téléphone → `GET /collection/v1_0/requesttopay/{referenceId}` ; en production MTN rappelle
 * `X-Callback-Url` (méthode PUT, corps = résultat de la transaction).
 *
 * Idempotence : `X-Reference-Id` est dérivé du paiement (v7 → v4, injectif) ; un `409` signifie « déjà créée »
 * (rejeu) et l'appel est donc sûr à répéter.
 *
 * Sécurité (Q-PAY-07) : le rappel MTN n'est pas signé. L'URL de rappel porte un jeton HMAC lié au tenant
 * (`verifySignature`, faux sans secret) et le webhook est un INDICE : le statut et le montant ne sont crus
 * qu'après `GET requesttopay/{id}` (`requiresActiveVerification`). En sandbox MTN refuse `X-Callback-Url` : le
 * rapprochement passe par `verify` seulement.
 */
import { err, ok, type AppError, type CurrencyCode, type Result } from "@ecoledigitale/kernel";
import type {
  PaymentProvider,
  ProviderConnectionCheck,
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
  ProviderWebhookMeta,
} from "../../application/ports/payment-provider";
import { FinanceCode, validation } from "../../domain/errors";
import {
  endpointFor,
  invalidAmount,
  invalidInput,
  malformed,
  modeOf,
  safeUpstreamCode,
  upstreamError,
  type AdapterRuntime,
  type ProviderMode,
} from "./adapter-kit";
import {
  integerAmountString,
  isNonEmpty,
  maskMsisdn,
  normalizeMsisdn,
  obj,
  parseJsonObject,
  parseProviderAmount,
  str,
  toMtnReferenceId,
  verifyWebhookUrlToken,
  webhookUrlToken,
  withQuery,
} from "./common";
import { ProviderHttp, type HttpResult } from "./http";
import type { ProviderSettings } from "./registry";
import { TokenCache } from "./token-cache";

export const MTN_MOMO_NAME = "mtn_momo";
export const MTN_SANDBOX_URL = "https://sandbox.momodeveloper.mtn.com";
export const MTN_PRODUCTION_URL = "https://proxy.momoapi.mtn.com";
export const MTN_DEFAULT_TARGET_ENVIRONMENT = "mtnivorycoast";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MtnMomoProvider implements PaymentProvider {
  readonly simulated = false;
  private readonly mode: ProviderMode;
  private readonly http: ProviderHttp;
  private readonly tokens: TokenCache;
  private readonly baseUrl: string;

  constructor(
    private readonly tenantId: string,
    private readonly settings: ProviderSettings,
    private readonly runtime: AdapterRuntime,
  ) {
    this.mode = modeOf(settings);
    this.baseUrl = endpointFor(runtime, MTN_MOMO_NAME, this.mode, { production: MTN_PRODUCTION_URL, sandbox: MTN_SANDBOX_URL });
    this.http = new ProviderHttp({
      provider: MTN_MOMO_NAME,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      ...(runtime.sleep ? { sleep: runtime.sleep } : {}),
      ...(runtime.timeoutMs ? { timeoutMs: runtime.timeoutMs } : {}),
      ...(runtime.retries !== undefined ? { retries: runtime.retries } : {}),
      logger: runtime.logger,
      ...(runtime.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    });
    this.tokens = new TokenCache({ clock: runtime.clock, fetchToken: () => this.fetchToken() });
  }

  getProviderName(): string {
    return MTN_MOMO_NAME;
  }

  /** `sandbox` en sandbox ; en production l'environnement cible du pays (défaut `mtnivorycoast`). */
  private targetEnvironment(): string {
    return this.mode === "sandbox" ? "sandbox" : (this.settings.target_environment ?? MTN_DEFAULT_TARGET_ENVIRONMENT).trim();
  }

  /** La sandbox MoMo n'accepte que `EUR` (Q-PAY-11) : même montant, devise de test. */
  private providerCurrency(): string {
    return this.mode === "sandbox" ? "EUR" : "XOF";
  }

  private fromProviderCurrency(code: unknown): CurrencyCode | null {
    if (typeof code !== "string") return null;
    if (this.mode === "sandbox" && code === "EUR") return "XOF";
    return code === "XOF" || code === "XAF" || code === "EUR" || code === "USD" ? code : null;
  }

  private async fetchToken(): Promise<Result<{ token: string; expiresInSec?: number }, AppError>> {
    const basic = Buffer.from(`${this.settings.api_user ?? ""}:${this.settings.api_key ?? ""}`, "utf8").toString("base64");
    const res = await this.http.request({
      method: "POST",
      url: `${this.baseUrl}/collection/token/`,
      headers: { authorization: `Basic ${basic}`, "ocp-apim-subscription-key": this.settings.subscription_key ?? "" },
      body: "",
      operation: "token",
      safeToRetry: true,
    });
    if (!res.ok) return res;
    const o = obj(res.value.json);
    const token = str(o?.access_token);
    if (res.value.status !== 200 || !token) {
      return err(upstreamError(MTN_MOMO_NAME, "token", res.value.status === 401 || res.value.status === 403 ? "credentials_rejected" : "token_unavailable", { httpStatus: res.value.status }));
    }
    const exp = typeof o?.expires_in === "number" ? o.expires_in : Number(o?.expires_in);
    return ok({ token, ...(Number.isFinite(exp) && exp > 0 ? { expiresInSec: exp } : {}) });
  }

  private async authed(build: (token: string) => { method: "GET" | "POST"; path: string; body?: string; headers?: Record<string, string>; operation: string }): Promise<Result<HttpResult, AppError>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.tokens.get();
      if (!token.ok) return token;
      const r = build(token.value);
      const res = await this.http.request({
        method: r.method,
        url: `${this.baseUrl}${r.path}`,
        headers: {
          authorization: `Bearer ${token.value}`,
          "x-target-environment": this.targetEnvironment(),
          "ocp-apim-subscription-key": this.settings.subscription_key ?? "",
          "content-type": "application/json",
          ...r.headers,
        },
        ...(r.body !== undefined ? { body: r.body } : {}),
        operation: r.operation,
        // Idempotent : référence stable (409 = rejeu) ou simple lecture.
        safeToRetry: true,
      });
      if (!res.ok) return res;
      if (res.value.status !== 401) return res;
      this.tokens.invalidate();
    }
    return err(upstreamError(MTN_MOMO_NAME, "auth", "credentials_rejected"));
  }

  // ---- initiation -------------------------------------------------------------------------------------------

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    if (request.amount.currency !== "XOF" || !request.amount.isPositive()) {
      return err(invalidAmount("MTN MoMo accepte uniquement un montant entier positif en XOF."));
    }
    const msisdn = normalizeMsisdn(request.payer?.phoneNumber);
    if (!msisdn) return err(invalidInput("Un numéro de téléphone MTN valide est obligatoire.", "payer.phoneNumber"));
    const referenceId = toMtnReferenceId(request.paymentId);
    const headers: Record<string, string> = { "x-reference-id": referenceId };
    // MTN refuse `X-Callback-Url` en sandbox ; en production l'URL doit correspondre à celle enregistrée.
    if (this.mode === "production" && isNonEmpty(request.notifyUrl) && isNonEmpty(this.settings.webhook_secret)) {
      headers["x-callback-url"] = withQuery(request.notifyUrl, { t: webhookUrlToken(this.settings.webhook_secret, this.tenantId, MTN_MOMO_NAME) });
    }
    const note = sanitizeNote(request.description ?? "Paiement scolarité");
    const body = JSON.stringify({
      amount: integerAmountString(request.amount),
      currency: this.providerCurrency(),
      externalId: request.paymentId,
      payer: { partyIdType: "MSISDN", partyId: msisdn },
      payerMessage: note,
      payeeNote: note,
    });
    const res = await this.authed(() => ({ method: "POST", path: "/collection/v1_0/requesttopay", body, headers, operation: "initiate" }));
    if (!res.ok) return res;
    const { status } = res.value;
    // 202 = acceptée ; 409 = référence déjà utilisée : même transaction (rejeu idempotent).
    if (status === 202 || status === 200 || status === 409) {
      return ok({ providerRef: referenceId, status: "PENDING", instructions: "Validez le paiement sur votre téléphone (MTN MoMo)." });
    }
    return err(upstreamError(MTN_MOMO_NAME, "initiate", "rejected", { httpStatus: status, ...codeOf(obj(res.value.json)) }));
  }

  // ---- vérification ----------------------------------------------------------------------------------------

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    const referenceId = request.providerRef ?? toMtnReferenceId(request.paymentId);
    if (!UUID_RE.test(referenceId)) return err(invalidInput("Référence MTN invalide.", "providerRef"));
    const res = await this.authed(() => ({ method: "GET", path: `/collection/v1_0/requesttopay/${referenceId}`, operation: "verify" }));
    if (!res.ok) return res;
    const { status, json } = res.value;
    if (status === 404) return ok({ status: "PENDING", providerRef: referenceId, amount: null, paidAt: null });
    const o = obj(json);
    if (status >= 400 || !o) return err(upstreamError(MTN_MOMO_NAME, "verify", "rejected", { httpStatus: status, ...codeOf(o) }));
    const rawStatus = str(o.status);
    if (!rawStatus) return malformed(MTN_MOMO_NAME, "verify");
    const external = str(o.externalId);
    if (external && external !== request.paymentId) return err(upstreamError(MTN_MOMO_NAME, "verify", "reference_mismatch"));
    const mapped = mapMtnStatus(rawStatus, o.reason);
    if (mapped.status !== "SUCCEEDED") {
      return ok({ status: mapped.status, providerRef: referenceId, amount: null, paidAt: null, ...(mapped.reason ? { failureReason: mapped.reason } : {}) });
    }
    const currency = this.fromProviderCurrency(o.currency);
    const amount = currency ? parseProviderAmount(o.amount, currency) : null;
    if (!amount) return malformed(MTN_MOMO_NAME, "verify");
    return ok({ status: "SUCCEEDED", providerRef: referenceId, amount, paidAt: this.runtime.clock.now() });
  }

  // ---- webhook ---------------------------------------------------------------------------------------------

  verifySignature(_rawBody: string, _headers: ProviderHeaders, meta?: ProviderWebhookMeta): boolean {
    return verifyWebhookUrlToken(this.settings.webhook_secret, meta?.query?.t, meta?.tenantId, MTN_MOMO_NAME);
  }

  async handleWebhook(rawBody: string, _headers: ProviderHeaders, _meta?: ProviderWebhookMeta): Promise<Result<ProviderWebhookEvent, AppError>> {
    const o = parseJsonObject(rawBody);
    const external = str(o?.externalId);
    const rawStatus = str(o?.status);
    if (!o || !external || !UUID_RE.test(external) || !rawStatus) {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Rappel MTN MoMo illisible.", "body"));
    }
    const mapped = mapMtnStatus(rawStatus, o.reason);
    return ok({
      eventId: `mtn:${external}:${rawStatus.toUpperCase()}`,
      type: `requesttopay.${rawStatus.toLowerCase()}`,
      paymentId: external,
      providerRef: toMtnReferenceId(external),
      status: mapped.status,
      amount: null,
      occurredAt: null,
      requiresActiveVerification: true,
      storedPayload: {
        externalId: external,
        status: rawStatus,
        ...(str(o.financialTransactionId) ? { financialTransactionId: str(o.financialTransactionId) } : {}),
        ...(typeof o.amount === "string" || typeof o.amount === "number" ? { amount: o.amount } : {}),
        ...(str(o.currency) ? { currency: str(o.currency) } : {}),
        ...(obj(o.payer)?.partyId !== undefined ? { payer: maskMsisdn(obj(o.payer)?.partyId) } : {}),
        ...(mapped.reason ? { reason: mapped.reason } : {}),
      },
    });
  }

  /** URL à enregistrer chez MTN (porte le jeton du tenant). Sans secret : l'URL nue (le webhook sera de toute façon refusé). */
  webhookUrl(baseUrl: string, tenantId: string): string {
    const secret = this.settings.webhook_secret;
    return isNonEmpty(secret) ? withQuery(baseUrl, { t: webhookUrlToken(secret, tenantId, MTN_MOMO_NAME) }) : baseUrl;
  }

  // ---- remboursement (Q-PAY-10, confiance faible) ---------------------------------------------------------

  /** Partiel possible ; `X-Reference-Id` stable (UUID dérivé du remboursement, 409 = rejeu) ; lecture `GET refund/{id}`. */
  readonly refundCapabilities = { partial: true, idempotent: true, statusQuery: true } as const;

  async refundStatus(request: ProviderRefundStatusRequest): Promise<Result<ProviderRefundStatus, AppError>> {
    const referenceId = toMtnReferenceId(request.refundId);
    const res = await this.authed(() => ({ method: "GET", path: `/collection/v2_0/refund/${referenceId}`, operation: "refund_status" }));
    if (!res.ok) return res;
    const { status, json } = res.value;
    if (status === 404) return ok({ status: "NOT_FOUND", providerRefundRef: null });
    const o = obj(json);
    if (status >= 400 || !o) return err(upstreamError(MTN_MOMO_NAME, "refund_status", "rejected", { httpStatus: status, ...codeOf(o) }));
    const rawStatus = str(o.status);
    if (!rawStatus) return malformed(MTN_MOMO_NAME, "refund_status");
    const external = str(o.externalId);
    if (external && external !== request.refundId) return err(upstreamError(MTN_MOMO_NAME, "refund_status", "reference_mismatch"));
    const mapped = mapMtnStatus(rawStatus, o.reason);
    // Un statut inconnu reste « en attente » (jamais un échec ni un succès présumé).
    const outcome = mapped.status === "SUCCEEDED" ? "SUCCEEDED" : mapped.status === "PENDING" ? "PENDING" : "FAILED";
    return ok({ status: outcome, providerRefundRef: referenceId, ...(outcome === "FAILED" ? { failureReason: mapped.reason ?? "declined" } : {}) });
  }

  async refund(request: ProviderRefundRequest): Promise<Result<ProviderRefundResult, AppError>> {
    if (!request.providerRef) return err(invalidInput("Référence MTN du paiement manquante.", "providerRef"));
    if (request.amount.currency !== "XOF" || !request.amount.isPositive()) return err(invalidAmount("Montant de remboursement invalide."));
    const referenceId = toMtnReferenceId(request.refundId);
    const body = JSON.stringify({
      amount: integerAmountString(request.amount),
      currency: this.providerCurrency(),
      externalId: request.refundId,
      payerMessage: sanitizeNote(request.reason ?? "Remboursement"),
      payeeNote: sanitizeNote(request.reason ?? "Remboursement"),
      referenceIdToRefund: request.providerRef,
    });
    const res = await this.authed(() => ({ method: "POST", path: "/collection/v2_0/refund", body, headers: { "x-reference-id": referenceId }, operation: "refund" }));
    if (!res.ok) return res;
    const { status } = res.value;
    if (status === 202 || status === 200 || status === 409) return ok({ status: "PENDING", providerRefundRef: referenceId });
    return ok({ status: "FAILED", providerRefundRef: null, failureReason: `http_${status}` });
  }

  // ---- test de connexion -----------------------------------------------------------------------------------

  async testConnection(): Promise<Result<ProviderConnectionCheck, AppError>> {
    this.tokens.invalidate();
    const t = await this.tokens.get();
    if (t.ok) return ok({ ok: true, code: "ok" });
    return ok({ ok: false, code: t.error.details?.reason === "credentials_rejected" ? "credentials_rejected" : "unreachable" });
  }
}

function codeOf(o: Record<string, unknown> | undefined): Record<string, string> {
  const code = safeUpstreamCode(o?.code ?? o?.errorCode);
  return code ? { upstreamCode: code } : {};
}

/** Message de transaction : texte court sans caractère de contrôle (MTN limite la taille). */
function sanitizeNote(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) || "Paiement";
}

/** Statut inconnu ⇒ en attente (R-PAY-04). `reason` : code court uniquement. */
export function mapMtnStatus(raw: string, reason: unknown): { status: ProviderPaymentStatus; reason?: string } {
  switch (raw.toUpperCase()) {
    case "SUCCESSFUL":
      return { status: "SUCCEEDED" };
    case "FAILED": {
      const r = typeof reason === "string" ? reason : str(obj(reason)?.code);
      return { status: "FAILED", reason: safeUpstreamCode(r)?.toLowerCase() ?? "declined" };
    }
    default:
      return { status: "PENDING" };
  }
}

