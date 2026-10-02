/**
 * Orange Money — Web Payment (Côte d'Ivoire).
 *
 * Flux : jeton OAuth (`/oauth/v3/token`, Basic client_id:client_secret) → `POST …/webpayment` (renvoie `pay_token`,
 * `payment_url`, `notif_token`) → le payeur confirme sur la page Orange → notification `{status, notif_token, txnid}`
 * sur `notif_url` → vérification `POST …/transactionstatus` (`order_id`, `amount`, `pay_token`).
 *
 * Sécurité (zone d'incertitude Q-PAY-01) : la notification Orange n'est PAS signée et ne porte NI montant NI
 * référence de commande. Nous :
 *   1. envoyons une `notif_url` qui porte `ref=<paiement>` et un jeton HMAC lié (tenant, fournisseur, paiement) ;
 *   2. n'acceptons une notification que si ce jeton est exact (`verifySignature`, faux sans secret) ;
 *   3. marquons l'événement `requiresActiveVerification` : le statut ne sera cru qu'après `transactionstatus`.
 * L'API de statut ne renvoie pas le montant : la requête porte le montant ATTENDU et Orange l'utilise comme clé de
 * recherche ; le montant « confirmé » est donc l'écho du nôtre, la réponse devant porter notre `order_id`
 * (question Q-PAY-23).
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type {
  PaymentProvider,
  ProviderConnectionCheck,
  ProviderHeaders,
  ProviderInitiateRequest,
  ProviderInitiation,
  ProviderPaymentStatus,
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
  encodePaymentReference,
  isNonEmpty,
  obj,
  parseJsonObject,
  str,
  verifyWebhookUrlToken,
  webhookUrlToken,
  withQuery,
} from "./common";
import { ProviderHttp, type HttpResult } from "./http";
import type { ProviderSettings } from "./registry";
import { TokenCache } from "./token-cache";

export const ORANGE_MONEY_NAME = "orange_money";
export const ORANGE_DEFAULT_BASE_URL = "https://api.orange.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrangeMoneyProvider implements PaymentProvider {
  readonly simulated = false;
  /** Sans `pay_token` (réponse d'initiation perdue) aucune vérification n'est possible (Q-PAY-05) : rapprochement manuel. */
  readonly cannotVerifyWithoutProviderRef = true;
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
    this.baseUrl = endpointFor(runtime, ORANGE_MONEY_NAME, this.mode, { production: ORANGE_DEFAULT_BASE_URL, sandbox: ORANGE_DEFAULT_BASE_URL });
    this.http = new ProviderHttp({
      provider: ORANGE_MONEY_NAME,
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
    return ORANGE_MONEY_NAME;
  }

  // ---- paramètres propres à Orange (zone d'incertitude Q-PAY-02) ------------------------------------------

  /** Segment `{cm}` des chemins : `dev` en sandbox, code pays en production. */
  private pathSegment(): string {
    return this.mode === "sandbox" ? "dev" : (this.settings.country ?? "ci").trim().toLowerCase();
  }

  /** Devise de la requête : `OUV` (unité de test) en sandbox, `XOF` en production. */
  private providerCurrency(): string {
    return this.mode === "sandbox" ? "OUV" : "XOF";
  }

  private url(path: string): string {
    return `${this.baseUrl}/orange-money-webpay/${this.pathSegment()}/v1/${path}`;
  }

  /** Requête de jeton (zone d'incertitude Q-PAY-03). */
  private tokenRequest(): { url: string; headers: Record<string, string>; body: string } {
    const basic = Buffer.from(`${this.settings.client_id ?? ""}:${this.settings.client_secret ?? ""}`, "utf8").toString("base64");
    return {
      url: `${this.baseUrl}/oauth/v3/token`,
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    };
  }

  private async fetchToken(): Promise<Result<{ token: string; expiresInSec?: number }, AppError>> {
    const t = this.tokenRequest();
    const res = await this.http.request({ method: "POST", url: t.url, headers: t.headers, body: t.body, operation: "token", safeToRetry: true });
    if (!res.ok) return res;
    const json = obj(res.value.json);
    const token = str(json?.access_token);
    if (res.value.status !== 200 || !token) {
      return err(upstreamError(ORANGE_MONEY_NAME, "token", res.value.status === 401 || res.value.status === 400 ? "credentials_rejected" : "token_unavailable", { httpStatus: res.value.status }));
    }
    const expires = typeof json?.expires_in === "number" ? json.expires_in : Number(json?.expires_in);
    return ok({ token, ...(Number.isFinite(expires) && expires > 0 ? { expiresInSec: expires } : {}) });
  }

  /** Appel authentifié ; un 401 invalide le jeton et rejoue UNE fois (la requête n'a pas été traitée). */
  private async authed(
    build: (token: string) => { method: "GET" | "POST"; url: string; body?: string; operation: string; safeToRetry: boolean },
  ): Promise<Result<HttpResult, AppError>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.tokens.get();
      if (!token.ok) return token;
      const r = build(token.value);
      const res = await this.http.request({
        method: r.method,
        url: r.url,
        headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        ...(r.body !== undefined ? { body: r.body } : {}),
        operation: r.operation,
        safeToRetry: r.safeToRetry,
      });
      if (!res.ok) return res;
      if (res.value.status !== 401) return res;
      this.tokens.invalidate();
    }
    return err(upstreamError(ORANGE_MONEY_NAME, "auth", "credentials_rejected"));
  }

  // ---- initiation -------------------------------------------------------------------------------------------

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    if (request.amount.currency !== "XOF" || !request.amount.isPositive()) {
      return err(invalidAmount("Orange Money accepte uniquement un montant entier positif en XOF."));
    }
    if (!isNonEmpty(request.returnUrl)) return err(invalidInput("L'URL de retour est obligatoire pour Orange Money.", "returnUrl"));
    if (!isNonEmpty(request.notifyUrl)) return err(invalidInput("L'URL de notification est obligatoire pour Orange Money.", "notifyUrl"));
    const secret = this.settings.webhook_secret;
    if (!isNonEmpty(secret)) return err(validation(FinanceCode.PROVIDER_CONFIG_INVALID, "Secret de notification absent.", "webhook_secret"));

    const orderId = encodePaymentReference(request.paymentId);
    const notifUrl = withQuery(request.notifyUrl, {
      ref: request.paymentId,
      t: webhookUrlToken(secret, this.tenantId, ORANGE_MONEY_NAME, request.paymentId),
    });
    const body = JSON.stringify({
      merchant_key: this.settings.merchant_key,
      currency: this.providerCurrency(),
      order_id: orderId,
      amount: request.amount.toNumber(),
      return_url: request.returnUrl,
      cancel_url: request.returnUrl,
      notif_url: notifUrl,
      lang: "fr",
      reference: orderId,
    });
    // POST non idempotent : jamais rejoué après une réponse ambiguë (Q-PAY-05). Un 401 est rejoué (non traité).
    const res = await this.authed((_t) => ({ method: "POST", url: this.url("webpayment"), body, operation: "initiate", safeToRetry: false }));
    if (!res.ok) return res;
    const { status, json } = res.value;
    const o = obj(json);
    const payToken = str(o?.pay_token);
    const paymentUrl = str(o?.payment_url);
    if (status >= 500) return err(upstreamError(ORANGE_MONEY_NAME, "initiate", "upstream_5xx", { httpStatus: status }));
    if (status >= 400 || !o) {
      return err(upstreamError(ORANGE_MONEY_NAME, "initiate", "rejected", { httpStatus: status, ...codeOf(o) }));
    }
    if (!payToken || !paymentUrl) return malformed(ORANGE_MONEY_NAME, "initiate");
    return ok({
      providerRef: payToken,
      status: "PENDING",
      redirectUrl: paymentUrl,
      instructions: "Validez le paiement dans la page Orange Money.",
    });
  }

  // ---- vérification ----------------------------------------------------------------------------------------

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    if (!request.providerRef) {
      // Sans `pay_token` (réponse d'initiation perdue), Orange ne permet aucune vérification (Q-PAY-05).
      return ok({ status: "PENDING", providerRef: null, amount: null, paidAt: null });
    }
    if (!request.amount) return err(invalidInput("Le montant attendu est requis pour vérifier un paiement Orange Money.", "amount"));
    const orderId = encodePaymentReference(request.paymentId);
    const body = JSON.stringify({ order_id: orderId, amount: request.amount.toNumber(), pay_token: request.providerRef });
    const res = await this.authed((_t) => ({ method: "POST", url: this.url("transactionstatus"), body, operation: "verify", safeToRetry: true }));
    if (!res.ok) return res;
    const { status, json } = res.value;
    const o = obj(json);
    if (status >= 400 || !o) return err(upstreamError(ORANGE_MONEY_NAME, "verify", "rejected", { httpStatus: status, ...codeOf(o) }));
    const rawStatus = str(o.status);
    if (!rawStatus) return malformed(ORANGE_MONEY_NAME, "verify");
    const mapped = mapOrangeStatus(rawStatus);
    const echoedOrder = str(o.order_id);
    if (echoedOrder && echoedOrder !== orderId) {
      // La réponse concerne une autre commande : jamais de confirmation.
      return err(upstreamError(ORANGE_MONEY_NAME, "verify", "reference_mismatch"));
    }
    if (mapped.status === "SUCCEEDED") {
      // Le montant n'est pas renvoyé par Orange : écho de la clé de recherche (voir l'en-tête).
      return ok({ status: "SUCCEEDED", providerRef: request.providerRef, amount: request.amount, paidAt: this.runtime.clock.now() });
    }
    return ok({
      status: mapped.status,
      providerRef: request.providerRef,
      amount: null,
      paidAt: null,
      ...(mapped.reason ? { failureReason: mapped.reason } : {}),
    });
  }

  // ---- webhook ---------------------------------------------------------------------------------------------

  verifySignature(_rawBody: string, _headers: ProviderHeaders, meta?: ProviderWebhookMeta): boolean {
    const ref = meta?.query?.ref;
    if (!isNonEmpty(ref) || !UUID_RE.test(ref)) return false;
    return verifyWebhookUrlToken(this.settings.webhook_secret, meta?.query?.t, meta?.tenantId, ORANGE_MONEY_NAME, ref);
  }

  async handleWebhook(rawBody: string, _headers: ProviderHeaders, meta?: ProviderWebhookMeta): Promise<Result<ProviderWebhookEvent, AppError>> {
    const o = parseJsonObject(rawBody);
    const ref = meta?.query?.ref;
    const rawStatus = str(o?.status);
    if (!o || !rawStatus || !ref || !UUID_RE.test(ref)) {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Notification Orange Money illisible.", "body"));
    }
    const txn = str(o.txnid);
    const notifToken = str(o.notif_token);
    const discriminator = txn ?? (notifToken ? createHash("sha256").update(notifToken).digest("hex").slice(0, 16) : "none");
    return ok({
      eventId: `om:${ref}:${discriminator}:${rawStatus.toUpperCase()}`,
      type: `payment.${rawStatus.toLowerCase()}`,
      paymentId: ref,
      providerRef: null,
      status: mapOrangeStatus(rawStatus).status,
      amount: null,
      occurredAt: null,
      requiresActiveVerification: true,
      // Le jeton de notification n'est jamais conservé.
      storedPayload: { status: rawStatus, ...(txn ? { txnid: txn } : {}), hasNotifToken: Boolean(notifToken) },
    });
  }

  webhookUrl(baseUrl: string, _tenantId: string): string {
    return baseUrl;
  }

  // ---- test de connexion -----------------------------------------------------------------------------------

  async testConnection(): Promise<Result<ProviderConnectionCheck, AppError>> {
    this.tokens.invalidate();
    const t = await this.tokens.get();
    if (t.ok) return ok({ ok: true, code: "ok" });
    const reason = t.error.details?.reason;
    return ok({ ok: false, code: reason === "credentials_rejected" ? "credentials_rejected" : "unreachable" });
  }
}

function codeOf(o: Record<string, unknown> | undefined): Record<string, string> {
  const code = safeUpstreamCode(o?.code ?? o?.status);
  return code ? { upstreamCode: code } : {};
}

/** Statut inconnu ⇒ en attente (R-PAY-04). */
export function mapOrangeStatus(raw: string): { status: ProviderPaymentStatus; reason?: string } {
  switch (raw.toUpperCase()) {
    case "SUCCESS":
      return { status: "SUCCEEDED" };
    case "FAILED":
      return { status: "FAILED", reason: "declined" };
    case "EXPIRED":
      return { status: "FAILED", reason: "expired" };
    default:
      return { status: "PENDING" };
  }
}

