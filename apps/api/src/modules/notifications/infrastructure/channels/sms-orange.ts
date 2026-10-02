/**
 * Canal SMS : adaptateur DÉDIÉ « Orange SMS API » (Orange Côte d'Ivoire), choisi par `NOTIFICATIONS_SMS_PROVIDER=orange`
 * (décision métier du 2026-10-02, `specs/v2/DECISIONS-METIER.md`). Même port `ChannelAdapter` que l'adaptateur HTTP générique.
 *
 * Flux (à valider avec la documentation et le contrat Orange de l'établissement ; les URL sont configurables) :
 *   1. OAuth2 « client credentials » : `POST {base}/oauth/v3/token` (`grant_type=client_credentials`, en-tête
 *      `Authorization: Basic base64(client_id:client_secret)`) -> `access_token` + `expires_in`, MIS EN CACHE (mémoire du
 *      processus, un seul appel concurrent, marge de 60 s), renouvelé sur 401 (une seule reprise) ;
 *   2. envoi : `POST {base}/smsmessaging/v1/outbound/{tel:+expéditeur encodé}/requests` (corps `outboundSMSMessageRequest`).
 *
 * Configuration (environnement ; AUCUN secret en dur, jamais journalisé : cet adaptateur n'écrit rien dans les logs) :
 *   ORANGE_SMS_MODE                 disabled (DÉFAUT : le canal échoue explicitement) | sandbox (aucun appel réseau : valide et
 *                                   consigne SIMULATED ; refusé en production) | live
 *   ORANGE_SMS_CLIENT_ID / ORANGE_SMS_CLIENT_SECRET   identifiants OAuth2 (secret) ; ou ORANGE_SMS_AUTHORIZATION_HEADER
 *                                   (« Basic xxx », secret) fourni tel quel par le portail Orange
 *   ORANGE_SMS_SENDER               numéro expéditeur E.164 déclaré chez Orange (ex. +2250000) — requis en live
 *   ORANGE_SMS_SENDER_NAME          nom d'expéditeur alphanumérique affiché (facultatif, 11 caractères au plus)
 *   ORANGE_SMS_API_BASE_URL         https://api.orange.com (défaut) ; ORANGE_SMS_TOKEN_URL pour surcharger l'URL du jeton
 *   ORANGE_SMS_TIMEOUT_MS           10000 (défaut)
 *   ORANGE_SMS_DEFAULT_DIAL_CODE    225 (défaut) : complète un numéro national
 *   ORANGE_SMS_ALLOW_INTERNATIONAL  « 1 » pour autoriser d'autres indicatifs que +225 (refusés par défaut : maîtrise du coût)
 *   ORANGE_SMS_MAX_SEGMENTS         3 (défaut) : un message plus long est refusé (échec définitif `sms_too_long`)
 *   ORANGE_SMS_UNIT_COST            coût entier par segment, en XOF, consigné au journal (aucun tarif n'est supposé : absent = pas de coût)
 *   ORANGE_SMS_MAX_PER_MINUTE       plafond local d'envois par minute et par processus (0 = illimité, défaut) ; au-delà : reprise
 *   ORANGE_SMS_QUOTA_PAUSE_SECONDS  900 (défaut) : pause locale après un refus « quota / forfait épuisé »
 *
 * Classement : 201/2xx -> envoyé (identifiant = dernier segment de `resourceURL`) ; 401 -> renouvellement du jeton puis une reprise ;
 * 408/425/429/5xx, coupure, délai -> RETRY (`Retry-After` respecté) ; quota épuisé -> RETRY + pause locale (les envois suivants
 * ne sollicitent pas Orange) ; autre 4xx -> échec définitif. Idempotence : la clé d'envoi est mémorisée en processus (un message déjà
 * accepté n'est pas renvoyé) ; l'API Orange n'offre pas de clé d'idempotence : entre processus, la livraison reste « au moins une
 * fois » (voir README). Le quota/plafond PAR ÉTABLISSEMENT est appliqué en amont par le module (`dailyCaps.SMS`, coût au journal).
 */
import { normalizePhone, scrubAddresses } from "../../domain/addresses";
import { smsSegments as estimateSegments } from "../../domain/templating";
import type { ChannelAdapter, ChannelConfigStatus, ChannelMessage, ChannelOutcome } from "../../application/ports";

export type OrangeSmsMode = "disabled" | "sandbox" | "live";

export interface OrangeSmsSettings {
  readonly mode: "sandbox" | "live";
  readonly baseUrl: string;
  readonly tokenUrl: string;
  readonly authorization: string | null;
  readonly sender: string | null;
  readonly senderName: string | null;
  readonly timeoutMs: number;
  readonly defaultDialCode: string;
  readonly allowInternational: boolean;
  readonly maxSegments: number;
  readonly unitCost: number | null;
  readonly maxPerMinute: number;
  readonly quotaPauseMs: number;
}

export interface OrangeSmsReadResult {
  readonly mode: OrangeSmsMode;
  readonly settings: OrangeSmsSettings | null;
  readonly missing: string[];
  readonly problems: string[];
}

const present = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);
const posInt = (v: string | null, fallback: number): number => {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Lit et valide la configuration (jamais de valeur de secret dans `missing` / `problems`). */
export function readOrangeSmsSettings(env: Readonly<Record<string, string | undefined>>, options: { production?: boolean } = {}): OrangeSmsReadResult {
  const rawMode = (present(env.ORANGE_SMS_MODE) ?? "disabled").toLowerCase();
  const missing: string[] = [];
  const problems: string[] = [];
  if (rawMode !== "disabled" && rawMode !== "sandbox" && rawMode !== "live") {
    return { mode: "disabled", settings: null, missing, problems: ["ORANGE_SMS_MODE inconnu (disabled, sandbox, live)"] };
  }
  const mode: OrangeSmsMode = rawMode;
  if (mode === "disabled") return { mode, settings: null, missing: ["ORANGE_SMS_MODE (sandbox ou live)"], problems };
  if (mode === "sandbox" && options.production) {
    return { mode, settings: null, missing, problems: ["ORANGE_SMS_MODE=sandbox est interdit en production"] };
  }

  const base = (present(env.ORANGE_SMS_API_BASE_URL) ?? "https://api.orange.com").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) problems.push("ORANGE_SMS_API_BASE_URL doit commencer par http(s)://");
  const tokenUrl = present(env.ORANGE_SMS_TOKEN_URL) ?? `${base}/oauth/v3/token`;
  if (present(env.ORANGE_SMS_TOKEN_URL) && !/^https?:\/\//i.test(tokenUrl)) problems.push("ORANGE_SMS_TOKEN_URL doit commencer par http(s)://");

  const clientId = present(env.ORANGE_SMS_CLIENT_ID);
  const clientSecret = present(env.ORANGE_SMS_CLIENT_SECRET);
  const header = present(env.ORANGE_SMS_AUTHORIZATION_HEADER);
  let authorization: string | null = null;
  if (header) authorization = /^basic\s+/i.test(header) ? header : `Basic ${header}`;
  else if (clientId && clientSecret) authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  const dial = (present(env.ORANGE_SMS_DEFAULT_DIAL_CODE) ?? "225").replace(/^\+/, "");
  if (!/^[0-9]{1,4}$/.test(dial)) problems.push("ORANGE_SMS_DEFAULT_DIAL_CODE invalide");
  const senderRaw = present(env.ORANGE_SMS_SENDER);
  // L'expéditeur est l'adresse déclarée chez Orange (numéro ou code court, ex. +2250000) : pas de normalisation de numéro d'abonné.
  const senderClean = senderRaw ? senderRaw.replace(/[\s.-]/g, "") : "";
  const sender = /^\+[0-9]{4,15}$/.test(senderClean) ? senderClean : null;
  if (senderRaw && !sender) problems.push("ORANGE_SMS_SENDER doit être au format +<indicatif><numéro>");
  const senderName = present(env.ORANGE_SMS_SENDER_NAME);
  if (senderName && !/^[A-Za-z0-9 ._-]{1,11}$/.test(senderName)) problems.push("ORANGE_SMS_SENDER_NAME : 11 caractères alphanumériques au plus");

  if (mode === "live") {
    if (!authorization) missing.push("ORANGE_SMS_CLIENT_ID", "ORANGE_SMS_CLIENT_SECRET");
    if (!senderRaw) missing.push("ORANGE_SMS_SENDER");
  }
  if (missing.length > 0 || problems.length > 0) return { mode, settings: null, missing, problems };

  const unitCostRaw = present(env.ORANGE_SMS_UNIT_COST);
  const unitCost = unitCostRaw !== null && Number.isSafeInteger(Number(unitCostRaw)) && Number(unitCostRaw) >= 0 ? Number(unitCostRaw) : null;
  const maxSegments = Math.max(1, Math.min(10, posInt(present(env.ORANGE_SMS_MAX_SEGMENTS), 3)));
  return {
    mode,
    missing,
    problems,
    settings: {
      mode,
      baseUrl: base,
      tokenUrl,
      authorization,
      sender,
      senderName,
      timeoutMs: Math.max(1, posInt(present(env.ORANGE_SMS_TIMEOUT_MS), 10_000)),
      defaultDialCode: dial,
      allowInternational: present(env.ORANGE_SMS_ALLOW_INTERNATIONAL) === "1",
      maxSegments,
      unitCost,
      maxPerMinute: posInt(present(env.ORANGE_SMS_MAX_PER_MINUTE), 0),
      quotaPauseMs: Math.max(1, posInt(present(env.ORANGE_SMS_QUOTA_PAUSE_SECONDS), 900)) * 1000,
    },
  };
}

/** Numéro de destination accepté (E.164 ; +225 seulement sauf autorisation internationale), ou `null`. */
export function orangeDestination(raw: string, settings: Pick<OrangeSmsSettings, "defaultDialCode" | "allowInternational">): string | null {
  const e164 = normalizePhone(raw, settings.defaultDialCode);
  if (!e164) return null;
  if (!settings.allowInternational && !e164.startsWith("+225")) return null;
  return e164;
}

// --- Réponses Orange ------------------------------------------------------------------------------------------------

function errorDetail(json: unknown): { code: string | null; text: string | null } {
  if (!json || typeof json !== "object") return { code: null, text: null };
  const o = json as Record<string, unknown>;
  const req = o.requestError as Record<string, unknown> | undefined;
  const exc = (req?.serviceException ?? req?.policyException) as Record<string, unknown> | undefined;
  if (exc && typeof exc === "object") {
    return { code: typeof exc.messageId === "string" ? exc.messageId : null, text: typeof exc.text === "string" ? exc.text : null };
  }
  const code = typeof o.code === "number" || typeof o.code === "string" ? String(o.code) : null;
  const text = typeof o.description === "string" ? o.description : typeof o.message === "string" ? o.message : typeof o.error_description === "string" ? o.error_description : null;
  return { code, text };
}

const QUOTA_RE = /quota|bundle|forfait|balance|solde|insufficient|out of/i;

function resourceId(json: unknown): string | undefined {
  const url = (json as { outboundSMSMessageRequest?: { resourceURL?: unknown } } | null)?.outboundSMSMessageRequest?.resourceURL;
  if (typeof url !== "string") return undefined;
  const last = url.split("?")[0]!.split("/").filter(Boolean).pop();
  return last && /^[A-Za-z0-9._:-]{1,120}$/.test(last) ? last : undefined;
}

export interface OrangeSmsOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `fetch` injectable (tests : serveur HTTP local factice). */
  readonly fetch?: typeof fetch;
  /** Production : le mode sandbox est refusé. */
  readonly production?: boolean;
  readonly now?: () => number;
}

const IDEMPOTENCY_MEMORY = 2_000;

export function createOrangeSmsChannel(options: OrangeSmsOptions): ChannelAdapter {
  const read = readOrangeSmsSettings(options.env, { production: options.production === true });
  const settings = read.settings;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  const missing = [...read.missing, ...read.problems];

  let token: { value: string; expiresAt: number } | null = null;
  let tokenInflight: Promise<{ ok: true; token: string } | { ok: false; outcome: ChannelOutcome }> | null = null;
  let quotaBlockedUntil = 0;
  const windowStarts: number[] = [];
  const accepted = new Map<string, ChannelOutcome>();

  const status = (): ChannelConfigStatus => ({ configured: settings !== null, missing });

  async function call(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response; json: unknown } | { error: "timeout" | "unreachable" }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { ...init, signal: controller.signal });
      const raw = await res.text().catch(() => "");
      let json: unknown = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      return { res, json };
    } catch (e) {
      return { error: e instanceof Error && e.name === "AbortError" ? "timeout" : "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  const retryAfterOf = (res: Response): number | undefined => {
    const s = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    return Number.isFinite(s) && s > 0 ? Math.min(s, 3600) * 1000 : undefined;
  };

  async function fetchToken(s: OrangeSmsSettings): Promise<{ ok: true; token: string } | { ok: false; outcome: ChannelOutcome }> {
    const r = await call(
      s.tokenUrl,
      { method: "POST", headers: { Authorization: s.authorization!, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: "grant_type=client_credentials" },
      s.timeoutMs,
    );
    if ("error" in r) {
      return { ok: false, outcome: { status: "RETRY", code: r.error === "timeout" ? "orange_token_timeout" : "orange_token_unreachable", message: "Jeton Orange SMS indisponible (délai ou coupure)." } };
    }
    if (!r.res.ok) {
      const retryable = r.res.status === 408 || r.res.status === 425 || r.res.status === 429 || r.res.status >= 500;
      if (retryable) {
        const after = retryAfterOf(r.res);
        return { ok: false, outcome: { status: "RETRY", code: `orange_token_http_${r.res.status}`, message: "Jeton Orange SMS refusé temporairement.", ...(after ? { retryAfterMs: after } : {}) } };
      }
      return { ok: false, outcome: { status: "FAILED", code: "orange_auth_failed", message: `Identifiants Orange SMS refusés (HTTP ${r.res.status}).` } };
    }
    const j = r.json as { access_token?: unknown; expires_in?: unknown } | null;
    if (!j || typeof j.access_token !== "string" || j.access_token === "") {
      return { ok: false, outcome: { status: "RETRY", code: "orange_token_unreadable", message: "Réponse de jeton Orange SMS illisible." } };
    }
    const ttl = typeof j.expires_in === "number" ? j.expires_in : Number.parseInt(String(j.expires_in ?? ""), 10);
    const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 3600;
    token = { value: j.access_token, expiresAt: now() + Math.max(0, seconds - 60) * 1000 };
    return { ok: true, token: j.access_token };
  }

  async function accessToken(s: OrangeSmsSettings, forceRefresh: boolean): Promise<{ ok: true; token: string } | { ok: false; outcome: ChannelOutcome }> {
    if (!forceRefresh && token && token.expiresAt > now()) return { ok: true, token: token.value };
    if (forceRefresh) token = null;
    if (!tokenInflight) {
      tokenInflight = fetchToken(s).finally(() => {
        tokenInflight = null;
      });
    }
    return tokenInflight;
  }

  function remember(key: string, outcome: ChannelOutcome): ChannelOutcome {
    if (accepted.size >= IDEMPOTENCY_MEMORY) accepted.delete(accepted.keys().next().value as string);
    accepted.set(key, outcome);
    return outcome;
  }

  async function sendOnce(s: OrangeSmsSettings, bearer: string, to: string, text: string): Promise<{ res: Response; json: unknown } | { error: "timeout" | "unreachable" }> {
    const senderUri = `tel:${s.sender}`;
    const url = `${s.baseUrl}/smsmessaging/v1/outbound/${encodeURIComponent(senderUri)}/requests`;
    const body = {
      outboundSMSMessageRequest: {
        address: `tel:${to}`,
        senderAddress: senderUri,
        ...(s.senderName ? { senderName: s.senderName } : {}),
        outboundSMSTextMessage: { message: text },
      },
    };
    return call(url, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }, s.timeoutMs);
  }

  return {
    channel: "SMS",
    provider: "orange-sms",
    status,
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      if (!settings) return { status: "FAILED", code: "channel_not_configured", message: `Canal SMS Orange non configuré (${missing.join(" ; ") || "ORANGE_SMS_MODE"}).` };
      const done = accepted.get(m.idempotencyKey);
      if (done) return done;
      const to = orangeDestination(m.address, settings);
      if (!to) return { status: "FAILED", code: "invalid_recipient", message: "Numéro de destination refusé (format E.164 +225 attendu)." };
      const text = m.text.trim();
      if (text === "") return { status: "FAILED", code: "empty_message", message: "Message SMS vide." };
      const segments = estimateSegments(text).segments; // GSM 7 bits / UCS-2 (estimation partagée du module)
      if (segments > settings.maxSegments) return { status: "FAILED", code: "sms_too_long", message: `Message trop long (${segments} segments, maximum ${settings.maxSegments}).` };
      const cost = settings.unitCost !== null ? { amount: segments * settings.unitCost, currency: "XOF" } : undefined;

      if (settings.mode === "sandbox") return remember(m.idempotencyKey, { status: "SIMULATED", providerId: `orange-sandbox:${m.idempotencyKey}` });

      const t0 = now();
      if (quotaBlockedUntil > t0) return { status: "RETRY", code: "orange_quota_paused", message: "Quota Orange SMS épuisé : envois suspendus localement.", retryAfterMs: quotaBlockedUntil - t0 };
      if (settings.maxPerMinute > 0) {
        while (windowStarts.length > 0 && windowStarts[0]! <= t0 - 60_000) windowStarts.shift();
        if (windowStarts.length >= settings.maxPerMinute) return { status: "RETRY", code: "orange_local_rate_limit", message: "Plafond local d'envois par minute atteint.", retryAfterMs: Math.max(1_000, windowStarts[0]! + 60_000 - t0) };
        windowStarts.push(t0);
      }

      let tok = await accessToken(settings, false);
      if (!tok.ok) return tok.outcome;
      let r = await sendOnce(settings, tok.token, to, text);
      if (!("error" in r) && r.res.status === 401) {
        tok = await accessToken(settings, true);
        if (!tok.ok) return tok.outcome;
        r = await sendOnce(settings, tok.token, to, text);
      }
      if ("error" in r) {
        return { status: "RETRY", code: r.error === "timeout" ? "sms_timeout" : "sms_unreachable", message: r.error === "timeout" ? "Délai dépassé vers Orange SMS." : "Orange SMS injoignable." };
      }
      const { res, json } = r;
      if (res.ok) return remember(m.idempotencyKey, { status: "SENT", providerId: resourceId(json), cost });
      const detail = errorDetail(json);
      const message = scrubAddresses(detail.text ?? `Réponse HTTP ${res.status} d'Orange SMS.`).slice(0, 300);
      if (res.status === 401) return { status: "FAILED", code: "orange_auth_failed", message };
      if ((res.status === 403 || res.status === 400 || res.status === 429) && QUOTA_RE.test(`${detail.text ?? ""} ${detail.code ?? ""}`)) {
        quotaBlockedUntil = now() + settings.quotaPauseMs;
        return { status: "RETRY", code: "orange_quota_exhausted", message, retryAfterMs: settings.quotaPauseMs };
      }
      if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
        const after = retryAfterOf(res);
        return { status: "RETRY", code: `http_${res.status}`, message, ...(after ? { retryAfterMs: after } : {}) };
      }
      return { status: "FAILED", code: `http_${res.status}`, message: detail.code ? `${detail.code} : ${message}`.slice(0, 300) : message };
    },
  };
}
