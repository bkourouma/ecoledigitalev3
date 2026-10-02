/**
 * CinetPay — Checkout API v2 (agrégateur : mobile money + cartes).
 *
 * Flux : `POST /v2/payment` (`apikey`, `site_id`, `transaction_id`, `amount` entier multiple de 5, `notify_url`,
 * `return_url`, `channels`) → `data.payment_url` ; notification POST (`application/x-www-form-urlencoded`) sur
 * `notify_url` avec l'en-tête `x-token` ; vérification `POST /v2/payment/check` (`transaction_id`).
 *
 * Références : `transaction_id` ≤ 25 caractères alphanumériques → encodage compact réversible de l'identifiant du
 * paiement (22 caractères, `references` de `common.ts`).
 *
 * Sécurité (Q-PAY-16) : `x-token` = HMAC-SHA256(secret_key, concaténation ordonnée des champs `NOTIFY_TOKEN_FIELDS`),
 * comparé à temps constant ; `cpm_site_id` doit être le nôtre ; secret absent ⇒ refus. CinetPay recommande en outre
 * de relire la transaction : la notification est un INDICE (`requiresActiveVerification`), le montant, la devise et
 * le statut ne sont crus qu'après `/v2/payment/check`.
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
} from "./adapter-kit";
import {
  constantTimeEqual,
  decodePaymentReference,
  encodePaymentReference,
  headerOf,
  hmacSha256Hex,
  isNonEmpty,
  maskMsisdn,
  normalizeMsisdn,
  obj,
  parseJsonObject,
  parseProviderAmount,
  str,
} from "./common";
import { ProviderHttp } from "./http";
import type { ProviderSettings } from "./registry";

export const CINETPAY_NAME = "cinetpay";
export const CINETPAY_DEFAULT_BASE_URL = "https://api-checkout.cinetpay.com";
export const CINETPAY_MIN_AMOUNT = 100;
export const CINETPAY_AMOUNT_STEP = 5;
const CONNECTION_TEST_TRANSACTION = "EDCONNECTIONTEST0000001";

/** Ordre documenté de la concaténation du jeton `x-token` (Q-PAY-16). Un champ absent compte pour une chaîne vide. */
export const NOTIFY_TOKEN_FIELDS = [
  "cpm_site_id",
  "cpm_trans_id",
  "cpm_trans_date",
  "cpm_amount",
  "cpm_currency",
  "signature",
  "payment_method",
  "cel_phone_num",
  "cpm_phone_prefixe",
  "cpm_language",
  "cpm_version",
  "cpm_payment_config",
  "cpm_page_action",
  "cpm_custom",
  "cpm_designation",
  "cpm_error_message",
] as const;

const CARD_CHANNELS = new Set(["ALL", "CREDIT_CARD"]);
const CHANNELS = new Set(["ALL", "MOBILE_MONEY", "CREDIT_CARD", "WALLET"]);

export class CinetPayProvider implements PaymentProvider {
  readonly simulated = false;
  private readonly http: ProviderHttp;
  private readonly baseUrl: string;

  constructor(
    _tenantId: string,
    private readonly settings: ProviderSettings,
    private readonly runtime: AdapterRuntime,
  ) {
    this.baseUrl = endpointFor(runtime, CINETPAY_NAME, modeOf(settings), { production: CINETPAY_DEFAULT_BASE_URL, sandbox: CINETPAY_DEFAULT_BASE_URL });
    this.http = new ProviderHttp({
      provider: CINETPAY_NAME,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      ...(runtime.sleep ? { sleep: runtime.sleep } : {}),
      ...(runtime.timeoutMs ? { timeoutMs: runtime.timeoutMs } : {}),
      ...(runtime.retries !== undefined ? { retries: runtime.retries } : {}),
      logger: runtime.logger,
      ...(runtime.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    });
  }

  getProviderName(): string {
    return CINETPAY_NAME;
  }

  /** XOF : entier, multiple de 5, minimum 100 (Q-PAY-17). */
  private assertAmountSupported(amount: ProviderInitiateRequest["amount"]): AppError | null {
    if (amount.currency !== "XOF" || !amount.isPositive()) return invalidAmount("CinetPay accepte uniquement un montant entier positif en XOF.");
    const n = amount.toNumber();
    if (n < CINETPAY_MIN_AMOUNT || n % CINETPAY_AMOUNT_STEP !== 0) {
      return invalidAmount(`CinetPay exige un montant multiple de ${CINETPAY_AMOUNT_STEP} FCFA, d'au moins ${CINETPAY_MIN_AMOUNT} FCFA.`);
    }
    return null;
  }

  private channels(): string {
    const c = (this.settings.channels ?? "ALL").trim().toUpperCase();
    return CHANNELS.has(c) ? c : "ALL";
  }

  /** Champs client (Q-PAY-19) : nom et e-mail exigés si le canal inclut la carte. */
  private customerFields(request: ProviderInitiateRequest): Result<Record<string, string>, AppError> {
    const name = request.payer?.name?.trim() ?? "";
    const email = request.payer?.email?.trim() ?? "";
    if (CARD_CHANNELS.has(this.channels()) && (!name || !email)) {
      return err(invalidInput("Le nom et l'adresse e-mail du payeur sont obligatoires pour un paiement par carte.", "payer"));
    }
    const [first = "", ...rest] = name.split(/\s+/);
    const phone = normalizeMsisdn(request.payer?.phoneNumber);
    return ok({
      customer_name: first || "Client",
      customer_surname: rest.join(" ") || first || "Client",
      customer_email: email,
      customer_phone_number: phone ? `+${phone}` : "",
      customer_address: "Abidjan",
      customer_city: "Abidjan",
      customer_country: "CI",
      customer_state: "CI",
      customer_zip_code: "00225",
    });
  }

  // ---- initiation -------------------------------------------------------------------------------------------

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    const amountError = this.assertAmountSupported(request.amount);
    if (amountError) return err(amountError);
    if (!isNonEmpty(request.returnUrl)) return err(invalidInput("L'URL de retour est obligatoire pour CinetPay.", "returnUrl"));
    if (!isNonEmpty(request.notifyUrl)) return err(invalidInput("L'URL de notification est obligatoire pour CinetPay.", "notifyUrl"));
    const customer = this.customerFields(request);
    if (!customer.ok) return customer;

    const body = JSON.stringify({
      apikey: this.settings.api_key,
      site_id: this.settings.site_id,
      transaction_id: encodePaymentReference(request.paymentId),
      amount: request.amount.toNumber(),
      currency: "XOF",
      description: sanitizeDescription(request.description),
      notify_url: request.notifyUrl,
      return_url: request.returnUrl,
      channels: this.channels(),
      lang: "fr",
      ...customer.value,
    });
    // POST non idempotent (un `transaction_id` déjà pris est refusé) : pas de reprise après réponse ambiguë (Q-PAY-25).
    const res = await this.http.request({
      method: "POST",
      url: `${this.baseUrl}/v2/payment`,
      headers: { "content-type": "application/json" },
      body,
      operation: "initiate",
      safeToRetry: false,
    });
    if (!res.ok) return res;
    const { status, json } = res.value;
    if (status >= 500) return err(upstreamError(CINETPAY_NAME, "initiate", "upstream_5xx", { httpStatus: status }));
    const o = obj(json);
    if (!o) return status >= 400 ? err(upstreamError(CINETPAY_NAME, "initiate", "rejected", { httpStatus: status })) : malformed(CINETPAY_NAME, "initiate");
    // CinetPay répond souvent HTTP 200 avec un `code` d'erreur.
    if (String(o.code) !== "201") {
      return err(upstreamError(CINETPAY_NAME, "initiate", "rejected", { httpStatus: status, ...codeOf(o) }));
    }
    const data = obj(o.data);
    const token = str(data?.payment_token);
    const url = str(data?.payment_url);
    if (!token || !url) return malformed(CINETPAY_NAME, "initiate");
    return ok({ providerRef: token, status: "PENDING", redirectUrl: url, instructions: "Choisissez votre moyen de paiement sur la page CinetPay." });
  }

  // ---- vérification ----------------------------------------------------------------------------------------

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    const transactionId = encodePaymentReference(request.paymentId);
    const res = await this.check(transactionId, "verify");
    if (!res.ok) return res;
    const { status, o } = res.value;
    if (!o) return status >= 400 ? err(upstreamError(CINETPAY_NAME, "verify", "rejected", { httpStatus: status })) : malformed(CINETPAY_NAME, "verify");
    const data = obj(o.data);
    const mapped = mapCinetPayStatus(String(o.code), str(data?.status));
    const providerRef = request.providerRef;
    if (mapped.status !== "SUCCEEDED") {
      return ok({ status: mapped.status, providerRef, amount: null, paidAt: null, ...(mapped.reason ? { failureReason: mapped.reason } : {}) });
    }
    const currency = str(data?.currency);
    const amount = currency === "XOF" ? parseProviderAmount(data?.amount, "XOF") : null;
    if (!amount) return malformed(CINETPAY_NAME, "verify");
    return ok({ status: "SUCCEEDED", providerRef, amount, paidAt: parseCinetPayDate(data?.payment_date) ?? this.runtime.clock.now() });
  }

  private async check(transactionId: string, operation: string): Promise<Result<{ status: number; o: Record<string, unknown> | undefined }, AppError>> {
    const res = await this.http.request({
      method: "POST",
      url: `${this.baseUrl}/v2/payment/check`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apikey: this.settings.api_key, site_id: this.settings.site_id, transaction_id: transactionId }),
      operation,
      safeToRetry: true,
    });
    if (!res.ok) return res;
    return ok({ status: res.value.status, o: obj(res.value.json) });
  }

  // ---- webhook ---------------------------------------------------------------------------------------------

  /** Jeton attendu pour un corps de notification (Q-PAY-16), ou `null` si le secret manque. */
  computeNotifyToken(fields: Readonly<Record<string, string>>): string | null {
    const secret = this.settings.secret_key;
    if (!isNonEmpty(secret)) return null;
    return hmacSha256Hex(secret, NOTIFY_TOKEN_FIELDS.map((k) => fields[k] ?? "").join(""));
  }

  verifySignature(rawBody: string, headers: ProviderHeaders, _meta?: ProviderWebhookMeta): boolean {
    const given = headerOf(headers, "x-token");
    const fields = parseNotification(rawBody);
    if (!isNonEmpty(given) || !fields) return false;
    if (!isNonEmpty(this.settings.site_id) || fields.cpm_site_id !== this.settings.site_id) return false;
    const expected = this.computeNotifyToken(fields);
    return expected !== null && constantTimeEqual(expected, given.trim().toLowerCase());
  }

  async handleWebhook(rawBody: string, _headers: ProviderHeaders, _meta?: ProviderWebhookMeta): Promise<Result<ProviderWebhookEvent, AppError>> {
    const f = parseNotification(rawBody);
    const transId = f?.cpm_trans_id;
    const paymentId = transId ? decodePaymentReference(transId) : null;
    if (!f || !transId || !paymentId) {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Notification CinetPay illisible.", "body"));
    }
    const hintSucceeded = (f.cpm_error_message ?? "").toUpperCase() === "SUCCES";
    return ok({
      eventId: `cp:${transId}:${createHash("sha256").update(rawBody).digest("hex").slice(0, 16)}`,
      type: "payment.notification",
      paymentId,
      providerRef: null,
      status: hintSucceeded ? "SUCCEEDED" : "PENDING",
      amount: null,
      occurredAt: null,
      requiresActiveVerification: true,
      storedPayload: {
        cpm_site_id: f.cpm_site_id,
        cpm_trans_id: transId,
        cpm_trans_date: f.cpm_trans_date,
        cpm_amount: f.cpm_amount,
        cpm_currency: f.cpm_currency,
        payment_method: f.payment_method,
        cpm_error_message: f.cpm_error_message,
        ...(f.cel_phone_num ? { cel_phone_num: maskMsisdn(`${f.cpm_phone_prefixe ?? ""}${f.cel_phone_num}`) } : {}),
      },
    });
  }

  webhookUrl(baseUrl: string, _tenantId: string): string {
    return baseUrl;
  }

  // ---- test de connexion (Q-PAY-20, confiance faible) -----------------------------------------------------

  async testConnection(): Promise<Result<ProviderConnectionCheck, AppError>> {
    const res = await this.check(CONNECTION_TEST_TRANSACTION, "test");
    if (!res.ok) return ok({ ok: false, code: "unreachable" });
    const { status, o } = res.value;
    if (status === 401 || status === 403) return ok({ ok: false, code: "credentials_rejected" });
    const message = `${str(o?.message) ?? ""} ${str(o?.description) ?? ""}`;
    if (/api[\s_-]?key|site[\s_-]?id|credential|unauthori[sz]ed|forbidden|invalid[\s_-]?(auth|key)/i.test(message)) {
      return ok({ ok: false, code: "credentials_rejected" });
    }
    return o ? ok({ ok: true, code: "ok" }) : ok({ ok: false, code: "unexpected_response" });
  }
}

function codeOf(o: Record<string, unknown>): Record<string, string> {
  const code = safeUpstreamCode(o.code);
  return code ? { upstreamCode: code } : {};
}

/** Libellé sans caractère spécial (CinetPay refuse `#`, `/`, `$`, `_`, `&`…). */
export function sanitizeDescription(text: string | undefined): string {
  const cleaned = (text ?? "").replace(/[^A-Za-z0-9À-ÿ .,'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned || "Paiement scolarite";
}

/** Corps de notification : formulaire (`a=1&b=2`) ou JSON à plat ; `null` si illisible. */
export function parseNotification(rawBody: string): Record<string, string> | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    const o = parseJsonObject(trimmed);
    if (!o) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === "string" || typeof v === "number") out[k] = String(v);
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(trimmed)) out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

/** `2021-01-22 10:50:06` (heure de Côte d'Ivoire = UTC+0) → Date. */
export function parseCinetPayDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(`${v.trim().replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(v.trim()) ? "" : "Z"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Q-PAY-18. Seul `code = 00` ET `ACCEPTED` encaisse ; inconnu ⇒ en attente. */
export function mapCinetPayStatus(code: string, status: string | undefined): { status: ProviderPaymentStatus; reason?: string } {
  switch ((status ?? "").toUpperCase()) {
    case "ACCEPTED":
      return code === "00" ? { status: "SUCCEEDED" } : { status: "PENDING" };
    case "REFUSED":
      return { status: "FAILED", reason: "declined" };
    case "CANCELED":
    case "CANCELLED":
      return { status: "CANCELLED", reason: "cancelled" };
    case "EXPIRED":
      return { status: "FAILED", reason: "expired" };
    default:
      return { status: "PENDING" };
  }
}
