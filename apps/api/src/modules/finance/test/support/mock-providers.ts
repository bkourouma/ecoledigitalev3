/**
 * Serveurs HTTP SIMULÉS (127.0.0.1, port éphémère) conformes à la documentation publique de chaque fournisseur :
 * Orange Money Web Payment, MTN MoMo Collection, Wave Checkout, CinetPay Checkout v2, TresorPay (contrat legacy).
 * Aucun appel réseau réel : les adaptateurs sont pointés sur ces serveurs par `AdapterRuntime.endpoints`.
 *
 * Chaque serveur est avec ÉTAT (les transactions créées sont relues par la vérification) et expose des commandes de
 * test : `overrideNext(...)` (5xx, réponse malformée, délai), `settle(...)`, etc.
 */
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface MockReply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

export abstract class MockHttp {
  readonly requests: RecordedRequest[] = [];
  private server: Server | null = null;
  private readonly overrides: Array<MockReply | ((req: RecordedRequest) => MockReply | undefined)> = [];
  url = "";

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        const recorded: RecordedRequest = {
          method: req.method ?? "GET",
          path: u.pathname,
          query: u.searchParams,
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        this.requests.push(recorded);
        const next = this.overrides.shift();
        const forced = typeof next === "function" ? next(recorded) : next;
        let reply = forced ?? this.handle(recorded);
        // « Réponse perdue » : la requête est TRAITÉE (effets chez le fournisseur) mais la réponse arrive trop tard pour l'appelant.
        if (!forced && this.lostResponses > 0 && this.lostMatcher(recorded)) {
          this.lostResponses--;
          reply = { ...reply, delayMs: 5_000 };
        }
        const send = (): void => {
          const body = reply.text ?? (reply.json !== undefined ? JSON.stringify(reply.json) : "");
          res.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
          res.end(body);
        };
        if (reply.delayMs) {
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            send();
          }, reply.delayMs);
          this.timers.add(timer);
        } else send();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const s = this.server;
    this.server = null;
    s?.closeAllConnections?.();
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private lostResponses = 0;
  private lostMatcher: (req: RecordedRequest) => boolean = () => true;

  /**
   * Les `count` prochaines requêtes (celles qui satisfont `matcher`) sont TRAITÉES normalement mais leur réponse
   * n'arrive que 5 s plus tard : l'appelant (délai court) conclut à un délai dépassé alors que l'effet a eu lieu.
   */
  loseNextResponses(count: number, matcher: (req: RecordedRequest) => boolean = () => true): void {
    this.lostResponses = count;
    this.lostMatcher = matcher;
  }

  /** Les N prochaines réponses sont forcées (5xx, malformée, délai…), dans l'ordre. */
  overrideNext(...replies: Array<MockReply | ((req: RecordedRequest) => MockReply | undefined)>): void {
    this.overrides.push(...replies);
  }

  /** Requêtes reçues dont le chemin se termine par / contient `fragment`. */
  calls(fragment: string, method?: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path.includes(fragment) && (!method || r.method === method));
  }

  reset(): void {
    this.requests.length = 0;
    this.overrides.length = 0;
    this.lostResponses = 0;
  }

  protected abstract handle(req: RecordedRequest): MockReply;
}

const parse = (body: string): Record<string, any> => {
  try {
    return JSON.parse(body) as Record<string, any>;
  } catch {
    return {};
  }
};
const bearer = (req: RecordedRequest): string | undefined => /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ===========================================================================
// Orange Money Web Payment
// ===========================================================================

export interface OrangeOrder {
  orderId: string;
  amount: number;
  payToken: string;
  notifToken: string;
  notifUrl: string;
  status: "INITIATED" | "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED";
  txnid?: string;
}

export class OrangeMock extends MockHttp {
  readonly orders = new Map<string, OrangeOrder>();
  tokensIssued = 0;
  private validTokens = new Set<string>();
  constructor(
    readonly creds: { clientId: string; clientSecret: string; merchantKey: string; segment: string; currency: string },
    private readonly tokenTtlSec = 3600,
  ) {
    super();
  }

  /** Invalide tous les jetons émis (le prochain appel reçoit 401). */
  revokeTokens(): void {
    this.validTokens.clear();
  }

  settle(payToken: string, status: OrangeOrder["status"]): OrangeOrder {
    const o = this.orders.get(payToken)!;
    o.status = status;
    if (status === "SUCCESS") o.txnid = `MP${payToken.slice(-8)}`;
    return o;
  }

  protected handle(req: RecordedRequest): MockReply {
    if (req.method === "POST" && req.path === "/oauth/v3/token") {
      const expected = `Basic ${Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64")}`;
      if (req.headers.authorization !== expected || !req.body.includes("grant_type=client_credentials")) {
        return { status: 401, json: { error: "invalid_client" } };
      }
      const token = `om-tok-${++this.tokensIssued}`;
      this.validTokens.add(token);
      return { json: { token_type: "Bearer", access_token: token, expires_in: this.tokenTtlSec } };
    }
    const token = bearer(req);
    if (!token || !this.validTokens.has(token)) return { status: 401, json: { code: 42, message: "Expired token" } };
    const base = `/orange-money-webpay/${this.creds.segment}/v1/`;
    if (req.method === "POST" && req.path === `${base}webpayment`) {
      const b = parse(req.body);
      if (b.merchant_key !== this.creds.merchantKey) return { status: 401, json: { code: 1, message: "Invalid merchant" } };
      if (b.currency !== this.creds.currency || !Number.isInteger(b.amount) || b.amount <= 0) return { status: 400, json: { code: 2, message: "Invalid amount" } };
      if (typeof b.order_id !== "string" || b.order_id.length > 30 || b.order_id !== b.reference) return { status: 400, json: { code: 3, message: "Invalid order" } };
      if ([...this.orders.values()].some((o) => o.orderId === b.order_id)) return { status: 400, json: { code: 4, message: "order_id already used" } };
      const payToken = `pt_${createHash("sha256").update(b.order_id).digest("hex").slice(0, 24)}`;
      const o: OrangeOrder = { orderId: b.order_id, amount: b.amount, payToken, notifToken: `nt_${payToken}`, notifUrl: String(b.notif_url), status: "INITIATED" };
      this.orders.set(payToken, o);
      return { status: 201, json: { status: 201, message: "OK", pay_token: payToken, payment_url: `https://webpayment.example.invalid/${payToken}`, notif_token: o.notifToken } };
    }
    if (req.method === "POST" && req.path === `${base}transactionstatus`) {
      const b = parse(req.body);
      const o = this.orders.get(b.pay_token);
      if (!o || o.orderId !== b.order_id || o.amount !== b.amount) return { status: 404, json: { code: 5, message: "Transaction not found" } };
      return { json: { status: o.status, order_id: o.orderId, ...(o.txnid ? { txnid: o.txnid } : {}) } };
    }
    return { status: 404, json: { message: "unknown route" } };
  }

  /** Corps de notification tel qu'Orange l'enverrait (et l'URL appelée : `notif_url` reçue à l'initiation). */
  notification(payToken: string): { rawBody: string; url: URL } {
    const o = this.orders.get(payToken)!;
    return { rawBody: JSON.stringify({ status: o.status, notif_token: o.notifToken, ...(o.txnid ? { txnid: o.txnid } : {}) }), url: new URL(o.notifUrl) };
  }
}

// ===========================================================================
// MTN MoMo Collection
// ===========================================================================

export interface MtnTransaction {
  referenceId: string;
  amount: string;
  currency: string;
  externalId: string;
  partyId: string;
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  reason?: string;
  callbackUrl?: string;
}

export class MtnMock extends MockHttp {
  readonly transactions = new Map<string, MtnTransaction>();
  readonly refunds: Array<Record<string, any>> = [];
  tokensIssued = 0;
  private validTokens = new Set<string>();
  constructor(readonly creds: { apiUser: string; apiKey: string; subscriptionKey: string; targetEnvironment: string; currency: string; callbacksAllowed: boolean }) {
    super();
  }

  revokeTokens(): void {
    this.validTokens.clear();
  }

  settle(referenceId: string, status: "SUCCESSFUL" | "FAILED", reason?: string): MtnTransaction {
    const t = this.transactions.get(referenceId)!;
    t.status = status;
    if (reason) t.reason = reason;
    return t;
  }

  callbackBody(referenceId: string): string {
    const t = this.transactions.get(referenceId)!;
    return JSON.stringify({
      financialTransactionId: t.status === "SUCCESSFUL" ? "123456789" : undefined,
      externalId: t.externalId,
      amount: t.amount,
      currency: t.currency,
      payer: { partyIdType: "MSISDN", partyId: t.partyId },
      status: t.status,
      ...(t.reason ? { reason: t.reason } : {}),
    });
  }

  protected handle(req: RecordedRequest): MockReply {
    const key = req.headers["ocp-apim-subscription-key"];
    if (key !== this.creds.subscriptionKey) return { status: 401, json: { statusCode: 401, message: "Access denied due to invalid subscription key." } };
    if (req.method === "POST" && req.path === "/collection/token/") {
      const expected = `Basic ${Buffer.from(`${this.creds.apiUser}:${this.creds.apiKey}`).toString("base64")}`;
      if (req.headers.authorization !== expected) return { status: 401, json: { error: "unauthorized" } };
      const token = `mtn-tok-${++this.tokensIssued}`;
      this.validTokens.add(token);
      return { json: { access_token: token, token_type: "access_token", expires_in: 3600 } };
    }
    const token = bearer(req);
    if (!token || !this.validTokens.has(token)) return { status: 401, json: { error: "token expired" } };
    if (req.headers["x-target-environment"] !== this.creds.targetEnvironment) return { status: 400, json: { code: "INVALID_TARGET_ENVIRONMENT" } };
    if (req.method === "POST" && req.path === "/collection/v1_0/requesttopay") {
      const ref = String(req.headers["x-reference-id"] ?? "");
      if (!UUID_V4.test(ref)) return { status: 400, json: { code: "INVALID_REFERENCE_ID" } };
      const callback = req.headers["x-callback-url"];
      if (callback && !this.creds.callbacksAllowed) return { status: 400, json: { code: "CALLBACK_NOT_ALLOWED_IN_SANDBOX" } };
      const b = parse(req.body);
      if (b.currency !== this.creds.currency || typeof b.amount !== "string" || !/^\d+$/.test(b.amount)) return { status: 400, json: { code: "INVALID_CURRENCY_OR_AMOUNT" } };
      if (b.payer?.partyIdType !== "MSISDN" || !/^\d{8,15}$/.test(String(b.payer?.partyId))) return { status: 400, json: { code: "INVALID_PAYER" } };
      if (this.transactions.has(ref)) return { status: 409, json: { code: "RESOURCE_ALREADY_EXIST", message: "Duplicated reference id." } };
      this.transactions.set(ref, {
        referenceId: ref,
        amount: b.amount,
        currency: b.currency,
        externalId: String(b.externalId),
        partyId: String(b.payer.partyId),
        status: "PENDING",
        ...(typeof callback === "string" ? { callbackUrl: callback } : {}),
      });
      return { status: 202, text: "" };
    }
    const get = /^\/collection\/v1_0\/requesttopay\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && get) {
      const t = this.transactions.get(get[1] as string);
      if (!t) return { status: 404, json: { code: "RESOURCE_NOT_FOUND" } };
      return {
        json: {
          amount: t.amount,
          currency: t.currency,
          ...(t.status === "SUCCESSFUL" ? { financialTransactionId: "123456789" } : {}),
          externalId: t.externalId,
          payer: { partyIdType: "MSISDN", partyId: t.partyId },
          status: t.status,
          ...(t.reason ? { reason: { code: t.reason, message: "technical detail" } } : {}),
        },
      };
    }
    if (req.method === "POST" && req.path === "/collection/v2_0/refund") {
      const ref = String(req.headers["x-reference-id"] ?? "");
      if (!UUID_V4.test(ref)) return { status: 400, json: { code: "INVALID_REFERENCE_ID" } };
      // Référence déjà utilisée : le remboursement existe déjà, JAMAIS un second (idempotence documentée).
      if (this.refundStates.has(ref)) return { status: 409, json: { code: "RESOURCE_ALREADY_EXIST" } };
      const b = parse(req.body);
      if (!this.transactions.has(String(b.referenceIdToRefund))) return { status: 404, json: { code: "RESOURCE_NOT_FOUND" } };
      this.refunds.push({ ...b, referenceId: ref });
      this.refundStates.set(ref, { status: "PENDING", externalId: String(b.externalId), amount: String(b.amount) });
      return { status: 202, text: "" };
    }
    const refundGet = /^\/collection\/v2_0\/refund\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && refundGet) {
      const r = this.refundStates.get(refundGet[1] as string);
      if (!r) return { status: 404, json: { code: "RESOURCE_NOT_FOUND" } };
      return { json: { amount: r.amount, currency: this.creds.currency, externalId: r.externalId, status: r.status, ...(r.reason ? { reason: { code: r.reason, message: "technical detail" } } : {}) } };
    }
    return { status: 404, json: { message: "unknown route" } };
  }

  /** Remboursements reçus, par `X-Reference-Id`. */
  readonly refundStates = new Map<string, { status: "PENDING" | "SUCCESSFUL" | "FAILED"; externalId: string; amount: string; reason?: string }>();

  settleRefund(referenceId: string, status: "SUCCESSFUL" | "FAILED", reason?: string): void {
    const r = this.refundStates.get(referenceId)!;
    r.status = status;
    if (reason) r.reason = reason;
  }
}

// ===========================================================================
// Wave Checkout
// ===========================================================================

export interface WaveSession {
  id: string;
  amount: string;
  currency: string;
  client_reference: string;
  checkout_status: "open" | "complete" | "expired";
  payment_status: "processing" | "cancelled" | "succeeded";
  wave_launch_url: string;
  when_expires: string;
  when_completed?: string;
  transaction_id?: string;
}

export class WaveMock extends MockHttp {
  readonly sessions = new Map<string, WaveSession>();
  readonly refunded = new Set<string>();
  /** Appels de remboursement reçus (un rejeu idempotent compte, mais ne rembourse qu'une fois : `refunded.size`). */
  refundCalls = 0;
  /** Nombre de créations effectivement exécutées (preuve d'absence de doublon). */
  creations = 0;
  constructor(readonly apiKey: string, private readonly searchSupported = true) {
    super();
  }

  complete(id: string): WaveSession {
    const s = this.sessions.get(id)!;
    s.checkout_status = "complete";
    s.payment_status = "succeeded";
    s.when_completed = "2025-09-01T08:05:00Z";
    s.transaction_id = `TCN${id.slice(-6)}`;
    return s;
  }
  expire(id: string): void {
    this.sessions.get(id)!.checkout_status = "expired";
  }

  protected handle(req: RecordedRequest): MockReply {
    if (bearer(req) !== this.apiKey) return { status: 401, json: { code: "unauthorized", message: "Invalid API key" } };
    if (req.method === "POST" && req.path === "/v1/checkout/sessions") {
      const b = parse(req.body);
      if (typeof b.amount !== "string" || !/^\d+$/.test(b.amount) || b.currency !== "XOF") return { status: 422, json: { code: "request-validation-error", message: "bad amount" } };
      if (!String(b.success_url).startsWith("https://") || !String(b.error_url).startsWith("https://")) return { status: 422, json: { code: "request-validation-error" } };
      this.creations++;
      const id = `cos-${(this.creations).toString().padStart(6, "0")}`;
      const s: WaveSession = {
        id,
        amount: b.amount,
        currency: b.currency,
        client_reference: String(b.client_reference ?? ""),
        checkout_status: "open",
        payment_status: "processing",
        wave_launch_url: `https://pay.wave.com/c/${id}`,
        when_expires: "2025-09-02T08:00:00Z",
      };
      this.sessions.set(id, s);
      return { status: 200, json: s };
    }
    if (req.method === "GET" && req.path === "/v1/checkout/sessions/search") {
      if (!this.searchSupported) return { status: 404, json: { code: "not-found" } };
      const ref = req.query.get("client_reference");
      return { json: { result: [...this.sessions.values()].filter((s) => s.client_reference === ref) } };
    }
    const one = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && one) {
      const s = this.sessions.get(one[1] as string);
      return s ? { json: s } : { status: 404, json: { code: "not-found" } };
    }
    const refund = /^\/v1\/checkout\/sessions\/([^/]+)\/refund$/.exec(req.path);
    if (req.method === "POST" && refund) {
      const s = this.sessions.get(refund[1] as string);
      if (!s || s.payment_status !== "succeeded") return { status: 409, json: { code: "refund-not-possible" } };
      this.refunded.add(s.id);
      this.refundCalls++;
      return { status: 200, text: "{}" };
    }
    return { status: 404, json: { message: "unknown route" } };
  }

  /** Webhook `checkout.session.completed` / `payment_failed` signé comme Wave. */
  static webhook(
    secret: string,
    event: { id: string; type: string; data: Record<string, unknown> },
    options: { timestamp?: number; strategy?: "signing_secret" | "shared_secret" } = {},
  ): { rawBody: string; headers: Record<string, string> } {
    const rawBody = JSON.stringify(event);
    if (options.strategy === "shared_secret") return { rawBody, headers: { authorization: `Bearer ${secret}` } };
    const t = String(options.timestamp ?? Math.floor(Date.now() / 1000));
    const v1 = createHmac("sha256", secret).update(`${t}${rawBody}`).digest("hex");
    return { rawBody, headers: { "wave-signature": `t=${t},v1=${v1}` } };
  }
}

// ===========================================================================
// CinetPay Checkout v2
// ===========================================================================

export interface CinetPayTransaction {
  transactionId: string;
  amount: number;
  token: string;
  status: "WAITING_FOR_CUSTOMER" | "ACCEPTED" | "REFUSED" | "CANCELED";
  paymentDate?: string;
}

export class CinetPayMock extends MockHttp {
  readonly transactions = new Map<string, CinetPayTransaction>();
  constructor(readonly creds: { apiKey: string; siteId: string; secretKey: string }) {
    super();
  }

  settle(transactionId: string, status: CinetPayTransaction["status"]): void {
    const t = this.transactions.get(transactionId)!;
    t.status = status;
    if (status === "ACCEPTED") t.paymentDate = "2025-09-01 08:05:00";
  }

  protected handle(req: RecordedRequest): MockReply {
    const b = parse(req.body);
    if (req.method !== "POST") return { status: 404, json: { message: "unknown route" } };
    if (b.apikey !== this.creds.apiKey || String(b.site_id) !== this.creds.siteId) return { status: 200, json: { code: "-1", message: "INVALID_APIKEY_OR_SITE_ID", description: "invalid credentials" } };
    if (req.path === "/v2/payment") {
      const id = String(b.transaction_id ?? "");
      if (!/^[A-Za-z0-9]{1,25}$/.test(id)) return { status: 200, json: { code: "-1", message: "INVALID_TRANSACTION_ID" } };
      if (!Number.isInteger(b.amount) || b.amount < 100 || b.amount % 5 !== 0) return { status: 200, json: { code: "-1", message: "INVALID_AMOUNT" } };
      if (b.currency !== "XOF" || !b.notify_url || !b.return_url) return { status: 200, json: { code: "-1", message: "INVALID_PARAMS" } };
      if (this.transactions.has(id)) return { status: 200, json: { code: "-1", message: "TRANSACTION_ID_ALREADY_USED" } };
      const token = `cp_${id.slice(0, 8)}_${this.transactions.size}`;
      this.transactions.set(id, { transactionId: id, amount: b.amount, token, status: "WAITING_FOR_CUSTOMER" });
      return { status: 200, json: { code: "201", message: "CREATED", description: "Transaction created", data: { payment_token: token, payment_url: `https://checkout.example.invalid/${token}` }, api_response_id: "r1" } };
    }
    if (req.path === "/v2/payment/check") {
      const t = this.transactions.get(String(b.transaction_id));
      if (!t) return { status: 200, json: { code: "627", message: "TRANSACTION_NOT_FOUND" } };
      const code = t.status === "ACCEPTED" ? "00" : t.status === "WAITING_FOR_CUSTOMER" ? "662" : t.status === "REFUSED" ? "600" : "627";
      const message = t.status === "ACCEPTED" ? "SUCCES" : t.status;
      return { status: 200, json: { code, message, data: { amount: String(t.amount), currency: "XOF", status: t.status, payment_method: "OM", description: "x", metadata: null, operator_id: null, payment_date: t.paymentDate ?? null }, api_response_id: "r2" } };
    }
    return { status: 404, json: { message: "unknown route" } };
  }

  /** Notification `application/x-www-form-urlencoded` + en-tête `x-token`, comme CinetPay. */
  static notification(
    secretKey: string,
    fields: Record<string, string>,
    options: { tokenOverride?: string } = {},
  ): { rawBody: string; headers: Record<string, string> } {
    const order = [
      "cpm_site_id", "cpm_trans_id", "cpm_trans_date", "cpm_amount", "cpm_currency", "signature", "payment_method", "cel_phone_num",
      "cpm_phone_prefixe", "cpm_language", "cpm_version", "cpm_payment_config", "cpm_page_action", "cpm_custom", "cpm_designation", "cpm_error_message",
    ];
    const token = options.tokenOverride ?? createHmac("sha256", secretKey).update(order.map((k) => fields[k] ?? "").join("")).digest("hex");
    return { rawBody: new URLSearchParams(fields).toString(), headers: { "x-token": token, "content-type": "application/x-www-form-urlencoded" } };
  }
}

// ===========================================================================
// TresorPay (contrat du client legacy)
// ===========================================================================

export interface TresorPayPayment {
  id: string;
  merchantTransactionId: string;
  amount: number;
  status: "pending" | "completed" | "failed" | "cancelled";
}

export class TresorPayMock extends MockHttp {
  readonly payments = new Map<string, TresorPayPayment>();
  /** Remboursements EXÉCUTÉS (un par appel reçu). */
  readonly refundsDone: Array<{ transaction_id: string; amount: number }> = [];
  constructor(readonly creds: { apiKey: string; secretKey: string; merchantId: string }) {
    super();
  }

  protected handle(req: RecordedRequest): MockReply {
    const ts = String(req.headers["x-timestamp"] ?? "");
    const endpoint = req.path.replace(/^\/v1/, "");
    const expected = createHmac("sha256", this.creds.secretKey).update(`${req.method}${endpoint}${req.body}${ts}`).digest("hex");
    if (req.headers["x-api-key"] !== this.creds.apiKey || req.headers["x-merchant-id"] !== this.creds.merchantId || req.headers["x-signature"] !== expected) {
      return { status: 401, json: { status: "error", error: "invalid signature" } };
    }
    if (req.method === "POST" && endpoint === "/payments/initialize") {
      const b = parse(req.body);
      const id = `tp_${this.payments.size + 1}`;
      this.payments.set(id, { id, merchantTransactionId: b.transaction_id, amount: b.amount, status: "pending" });
      return { json: { status: "success", message: "ok", data: { transaction_id: id, payment_url: `https://pay.tresorpay.example.invalid/${id}`, payment_token: "t" } } };
    }
    const verify = /^\/payments\/([^/]+)\/verify$/.exec(endpoint);
    if (req.method === "GET" && verify) {
      const p = this.payments.get(verify[1] as string);
      if (!p) return { status: 404, json: { status: "error", error: "not found" } };
      return { json: { status: "success", data: { transaction_id: p.id, status: p.status, amount: p.amount, currency: "XOF", payment_method: "ORANGE_MONEY", processed_at: "2025-09-01T08:05:00Z" } } };
    }
    if (req.method === "POST" && endpoint === "/refunds") {
      // Aucune clé d'idempotence documentée : chaque appel REMBOURSE (d'où l'interdiction de renvoyer après une réponse ambiguë).
      this.refundsDone.push({ transaction_id: parse(req.body).transaction_id, amount: parse(req.body).amount });
      return { json: { status: "success", message: "ok", data: { refund_id: `rf_${this.refundsDone.length}`, transaction_id: parse(req.body).transaction_id, amount: parse(req.body).amount, status: "completed" } } };
    }
    return { status: 404, json: { message: "unknown route" } };
  }

  static webhook(webhookSecret: string, body: Record<string, unknown>): { rawBody: string; headers: Record<string, string> } {
    const rawBody = JSON.stringify(body);
    return { rawBody, headers: { "x-signature": createHmac("sha256", webhookSecret).update(rawBody).digest("hex") } };
  }
}
