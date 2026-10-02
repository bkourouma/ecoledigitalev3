/**
 * Wave — Checkout API (Côte d'Ivoire).
 *
 * Flux : `POST /v1/checkout/sessions` (montant en CHAÎNE d'entiers, `client_reference` = identifiant du paiement,
 * `success_url`/`error_url` HTTPS) → le payeur ouvre `wave_launch_url` → webhook `checkout.session.completed`
 * (signé) ; lecture `GET /v1/checkout/sessions/{id}` ; recherche `GET /v1/checkout/sessions/search?client_reference=`.
 *
 * Idempotence : avant de créer une session on cherche par `client_reference` ; après une réponse ambiguë (5xx,
 * délai dépassé) on cherche à nouveau AVANT de réessayer : jamais deux sessions pour un même paiement.
 *
 * Sécurité : deux stratégies documentées par Wave. « Signing secret » (défaut) : en-tête
 * `Wave-Signature: t=<horodatage>,v1=<hex>[,v1=<hex>]`, `HMAC-SHA256(secret, horodatage + corps brut)`, horodatage
 * toléré à ± 5 minutes. « Shared secret » : `Authorization: Bearer <secret>`. Secret absent ⇒ refus.
 *
 * Un `checkout.session.payment_failed` est une TENTATIVE échouée : la session reste ouverte et le payeur peut
 * réessayer. Il ne fait donc PAS échouer notre paiement ; l'échec définitif vient de l'expiration de la session
 * (lue par `verify`) ou de son annulation (Q-PAY-24).
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
  headerOf,
  hmacSha256Hex,
  integerAmountString,
  isNonEmpty,
  obj,
  parseDate,
  parseJsonObject,
  parseProviderAmount,
  str,
  withQuery,
} from "./common";
import { ProviderHttp, type HttpResult } from "./http";
import type { ProviderSettings } from "./registry";

export const WAVE_NAME = "wave";
export const WAVE_DEFAULT_BASE_URL = "https://api.wave.com";
export const WAVE_SIGNATURE_HEADER = "wave-signature";
export const WAVE_TIMESTAMP_TOLERANCE_SEC = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONNECTION_TEST_REFERENCE = "ed-connection-test";

export class WaveProvider implements PaymentProvider {
  readonly simulated = false;
  private readonly http: ProviderHttp;
  private readonly baseUrl: string;

  constructor(
    _tenantId: string,
    private readonly settings: ProviderSettings,
    private readonly runtime: AdapterRuntime,
  ) {
    const mode = modeOf(settings);
    this.baseUrl = endpointFor(runtime, WAVE_NAME, mode, { production: WAVE_DEFAULT_BASE_URL, sandbox: WAVE_DEFAULT_BASE_URL });
    this.http = new ProviderHttp({
      provider: WAVE_NAME,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      ...(runtime.sleep ? { sleep: runtime.sleep } : {}),
      ...(runtime.timeoutMs ? { timeoutMs: runtime.timeoutMs } : {}),
      ...(runtime.retries !== undefined ? { retries: runtime.retries } : {}),
      logger: runtime.logger,
      ...(runtime.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    });
  }

  getProviderName(): string {
    return WAVE_NAME;
  }

  private call(method: "GET" | "POST", path: string, operation: string, safeToRetry: boolean, body?: string): Promise<Result<HttpResult, AppError>> {
    return this.http.request({
      method,
      url: `${this.baseUrl}${path}`,
      headers: { authorization: `Bearer ${this.settings.api_key ?? ""}`, "content-type": "application/json" },
      ...(body !== undefined ? { body } : {}),
      operation,
      safeToRetry,
    });
  }

  /** Recherche des sessions d'un paiement. `null` si l'endpoint est indisponible (400/403/404) : on peut alors créer. */
  private async findSessionsByReference(reference: string): Promise<Result<Array<Record<string, unknown>> | null, AppError>> {
    const res = await this.call("GET", `/v1/checkout/sessions/search?client_reference=${encodeURIComponent(reference)}`, "search", true);
    if (!res.ok) return res;
    const { status, json } = res.value;
    if (status === 401) return err(upstreamError(WAVE_NAME, "search", "credentials_rejected", { httpStatus: status }));
    if (status >= 400) return ok(null);
    const list = Array.isArray(json) ? json : Array.isArray(obj(json)?.result) ? (obj(json)?.result as unknown[]) : Array.isArray(obj(json)?.sessions) ? (obj(json)?.sessions as unknown[]) : null;
    if (!list) return malformed(WAVE_NAME, "search");
    return ok(list.map((s) => obj(s)).filter((s): s is Record<string, unknown> => s !== undefined));
  }

  // ---- initiation -------------------------------------------------------------------------------------------

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    if (request.amount.currency !== "XOF" || !request.amount.isPositive()) {
      return err(invalidAmount("Wave accepte uniquement un montant entier positif en XOF."));
    }
    if (!isNonEmpty(request.returnUrl) || !request.returnUrl.startsWith("https://")) {
      return err(invalidInput("Wave exige une URL de retour HTTPS.", "returnUrl"));
    }
    const reference = request.paymentId;

    // 1. Session déjà créée pour ce paiement (rejeu) ?
    const existing = await this.findSessionsByReference(reference);
    if (!existing.ok) return existing;
    const reused = existing.value ? this.pickSession(existing.value, request) : null;
    if (reused) return reused;

    // 2. Création ; après une réponse ambiguë, on cherche avant de réessayer.
    const body = JSON.stringify({
      amount: integerAmountString(request.amount),
      currency: "XOF",
      client_reference: reference,
      success_url: withQuery(request.returnUrl, { wave: "success" }),
      error_url: withQuery(request.returnUrl, { wave: "error" }),
    });
    let lastAmbiguity: AppError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        const again = await this.findSessionsByReference(reference);
        if (!again.ok) return again;
        const found = again.value ? this.pickSession(again.value, request) : null;
        if (found) return found;
      }
      const res = await this.call("POST", "/v1/checkout/sessions", "initiate", false, body);
      if (!res.ok) {
        lastAmbiguity = res.error;
        continue;
      }
      const { status, json } = res.value;
      if (status >= 500) {
        lastAmbiguity = upstreamError(WAVE_NAME, "initiate", "upstream_5xx", { httpStatus: status });
        continue;
      }
      if (status === 401 || status === 403) return err(upstreamError(WAVE_NAME, "initiate", "credentials_rejected", { httpStatus: status }));
      const session = obj(json);
      if (status >= 400) return err(upstreamError(WAVE_NAME, "initiate", "rejected", { httpStatus: status, ...codeOf(session) }));
      if (!session) return malformed(WAVE_NAME, "initiate");
      const initiation = this.initiationOf(session);
      return initiation ? ok(initiation) : malformed(WAVE_NAME, "initiate");
    }
    return err(lastAmbiguity ?? upstreamError(WAVE_NAME, "initiate", "unavailable"));
  }

  /** Session réutilisable d'un rejeu : la plus récente ; refus si le montant diffère. */
  private pickSession(sessions: Array<Record<string, unknown>>, request: ProviderInitiateRequest): Result<ProviderInitiation, AppError> | null {
    const mine = sessions.filter((s) => str(s.client_reference) === request.paymentId);
    if (mine.length === 0) return null;
    const session = mine.find((s) => str(s.checkout_status) === "open" || str(s.payment_status) === "succeeded") ?? mine[0]!;
    const amount = parseProviderAmount(session.amount, "XOF");
    if (!amount || !amount.equals(request.amount)) {
      return err(upstreamError(WAVE_NAME, "initiate", "amount_mismatch"));
    }
    const mapped = mapWaveSession(session);
    const providerRef = str(session.id) ?? null;
    if (mapped.status === "SUCCEEDED") return ok({ providerRef, status: "SUCCEEDED" });
    if (mapped.status === "FAILED" || mapped.status === "CANCELLED") {
      return ok({ providerRef, status: "FAILED", failureReason: mapped.reason ?? "declined" });
    }
    const initiation = this.initiationOf(session);
    return initiation ? ok(initiation) : malformed(WAVE_NAME, "initiate");
  }

  private initiationOf(session: Record<string, unknown>): ProviderInitiation | null {
    const id = str(session.id);
    const url = str(session.wave_launch_url);
    if (!id || !url) return null;
    const expires = parseDate(session.when_expires);
    return {
      providerRef: id,
      status: "PENDING",
      redirectUrl: url,
      instructions: "Ouvrez l'application Wave pour valider le paiement.",
      ...(expires ? { expiresAt: expires } : {}),
    };
  }

  // ---- vérification ----------------------------------------------------------------------------------------

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    let session: Record<string, unknown> | undefined;
    if (request.providerRef) {
      const res = await this.call("GET", `/v1/checkout/sessions/${encodeURIComponent(request.providerRef)}`, "verify", true);
      if (!res.ok) return res;
      if (res.value.status === 404) return ok({ status: "PENDING", providerRef: request.providerRef, amount: null, paidAt: null });
      if (res.value.status >= 400) return err(upstreamError(WAVE_NAME, "verify", "rejected", { httpStatus: res.value.status, ...codeOf(obj(res.value.json)) }));
      session = obj(res.value.json);
    } else {
      const found = await this.findSessionsByReference(request.paymentId);
      if (!found.ok) return found;
      session = found.value?.find((s) => str(s.client_reference) === request.paymentId);
      if (!session) return ok({ status: "PENDING", providerRef: null, amount: null, paidAt: null });
    }
    if (!session) return malformed(WAVE_NAME, "verify");
    const reference = str(session.client_reference);
    if (reference && reference !== request.paymentId) return err(upstreamError(WAVE_NAME, "verify", "reference_mismatch"));
    const mapped = mapWaveSession(session);
    const providerRef = str(session.id) ?? request.providerRef;
    if (mapped.status !== "SUCCEEDED") {
      return ok({ status: mapped.status, providerRef, amount: null, paidAt: null, ...(mapped.reason ? { failureReason: mapped.reason } : {}) });
    }
    const currency = str(session.currency);
    const amount = currency === "XOF" ? parseProviderAmount(session.amount, "XOF") : null;
    if (!amount) return malformed(WAVE_NAME, "verify");
    return ok({ status: "SUCCEEDED", providerRef, amount, paidAt: parseDate(session.when_completed) ?? this.runtime.clock.now() });
  }

  // ---- webhook ---------------------------------------------------------------------------------------------

  /** Authenticité (Q-PAY-12). Faux si le secret manque. */
  verifySignature(rawBody: string, headers: ProviderHeaders): boolean {
    const secret = this.settings.webhook_secret;
    if (!isNonEmpty(secret)) return false;
    if (this.settings.webhook_strategy === "shared_secret") {
      const auth = headerOf(headers, "authorization");
      const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null;
      return m ? constantTimeEqual(m[1] as string, secret) : false;
    }
    return this.computeSigningSecretVerdict(rawBody, headerOf(headers, WAVE_SIGNATURE_HEADER), secret);
  }

  private computeSigningSecretVerdict(rawBody: string, header: string | undefined, secret: string): boolean {
    if (!header) return false;
    let t: string | undefined;
    const signatures: string[] = [];
    for (const part of header.split(",")) {
      const [k, ...rest] = part.trim().split("=");
      const v = rest.join("=");
      if (k === "t") t = v;
      else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
    }
    if (!t || !/^\d{9,12}$/.test(t) || signatures.length === 0) return false;
    const skew = Math.abs(this.runtime.clock.now().getTime() / 1000 - Number(t));
    if (skew > WAVE_TIMESTAMP_TOLERANCE_SEC) return false;
    const expected = hmacSha256Hex(secret, `${t}${rawBody}`);
    // On compare TOUTES les signatures sans court-circuit (rotation de clé : plusieurs `v1`).
    let valid = false;
    for (const s of signatures) if (constantTimeEqual(expected, s)) valid = true;
    return valid;
  }

  async handleWebhook(rawBody: string, _headers: ProviderHeaders, _meta?: ProviderWebhookMeta): Promise<Result<ProviderWebhookEvent, AppError>> {
    const o = parseJsonObject(rawBody);
    const id = str(o?.id);
    const type = str(o?.type);
    const data = obj(o?.data);
    if (!o || !id || !type) return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Webhook Wave illisible.", "body"));
    const isCheckout = type.startsWith("checkout.session.");
    if (!isCheckout || !data) {
      // `test.test_event`, `merchant.*`, `b2b.*` : accusé de réception sans effet sur un paiement.
      return ok({ eventId: id, type, paymentId: null, providerRef: null, status: "PENDING", amount: null, occurredAt: null });
    }
    const mapped = mapWaveSession(data);
    let status: ProviderPaymentStatus = mapped.status;
    // `completed` n'encaisse que si la session est réellement payée ; `payment_failed` = tentative (voir l'en-tête).
    if (type === "checkout.session.completed" && str(data.payment_status) !== "succeeded") status = "PENDING";
    if (type === "checkout.session.payment_failed" && status === "FAILED" && str(data.checkout_status) !== "expired") status = "PENDING";
    const clientRef = str(data.client_reference);
    const currency = str(data.currency);
    const amount = status === "SUCCEEDED" && currency === "XOF" ? parseProviderAmount(data.amount, "XOF") : null;
    if (status === "SUCCEEDED" && !amount) {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "Montant du webhook Wave invalide.", "amount"));
    }
    return ok({
      eventId: id,
      type,
      paymentId: clientRef && UUID_RE.test(clientRef) ? clientRef : null,
      providerRef: str(data.id) ?? null,
      status,
      amount,
      occurredAt: parseDate(data.when_completed),
      storedPayload: {
        id,
        type,
        data: {
          id: str(data.id),
          client_reference: clientRef,
          amount: str(data.amount),
          currency,
          payment_status: str(data.payment_status),
          checkout_status: str(data.checkout_status),
        },
      },
    });
  }

  webhookUrl(baseUrl: string, _tenantId: string): string {
    return baseUrl;
  }

  // ---- remboursement (total uniquement ; idempotent chez Wave) ---------------------------------------------

  /** Total uniquement, idempotent (documenté) : renvoyer la même demande ne rembourse pas deux fois. Aucune lecture d'état dédiée. */
  readonly refundCapabilities = { partial: false, idempotent: true, statusQuery: false } as const;

  async refund(request: ProviderRefundRequest): Promise<Result<ProviderRefundResult, AppError>> {
    if (!request.providerRef) return err(invalidInput("Référence Wave du paiement manquante.", "providerRef"));
    const read = await this.call("GET", `/v1/checkout/sessions/${encodeURIComponent(request.providerRef)}`, "refund_read", true);
    if (!read.ok) return read;
    const session = obj(read.value.json);
    if (read.value.status >= 400 || !session) return err(upstreamError(WAVE_NAME, "refund", "rejected", { httpStatus: read.value.status }));
    const paid = parseProviderAmount(session.amount, "XOF");
    if (!paid || !paid.equals(request.amount)) {
      return err(invalidAmount("Wave ne rembourse que la totalité d'un paiement."));
    }
    const res = await this.call("POST", `/v1/checkout/sessions/${encodeURIComponent(request.providerRef)}/refund`, "refund", true);
    if (!res.ok) return res;
    if (res.value.status >= 200 && res.value.status < 300) return ok({ status: "SUCCEEDED", providerRefundRef: request.providerRef });
    return ok({ status: "FAILED", providerRefundRef: null, failureReason: safeUpstreamCode(obj(res.value.json)?.code)?.toLowerCase() ?? `http_${res.value.status}` });
  }

  // ---- test de connexion -----------------------------------------------------------------------------------

  async testConnection(): Promise<Result<ProviderConnectionCheck, AppError>> {
    const res = await this.call("GET", `/v1/checkout/sessions/search?client_reference=${CONNECTION_TEST_REFERENCE}`, "test", true);
    if (!res.ok) return ok({ ok: false, code: "unreachable" });
    const s = res.value.status;
    if (s === 401 || s === 403) return ok({ ok: false, code: "credentials_rejected" });
    return s < 400 ? ok({ ok: true, code: "ok" }) : ok({ ok: false, code: "unexpected_response" });
  }
}

function codeOf(o: Record<string, unknown> | undefined): Record<string, string> {
  const code = safeUpstreamCode(o?.code);
  return code ? { upstreamCode: code } : {};
}

/** État d'une session Wave. Inconnu ⇒ en attente. */
export function mapWaveSession(s: Record<string, unknown>): { status: ProviderPaymentStatus; reason?: string } {
  const payment = str(s.payment_status);
  const checkout = str(s.checkout_status);
  if (payment === "succeeded") return { status: "SUCCEEDED" };
  if (payment === "cancelled") return { status: "CANCELLED", reason: "cancelled" };
  if (checkout === "expired") return { status: "FAILED", reason: "expired" };
  // `payment_status = failed` sur une session encore ouverte = tentative échouée : le payeur peut réessayer.
  return { status: "PENDING" };
}
