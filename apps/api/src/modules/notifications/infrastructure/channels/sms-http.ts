/**
 * Canal SMS : adaptateur HTTP GÉNÉRIQUE, configuré par l'environnement — le fournisseur n'est pas choisi (question ouverte
 * Q-18, `specs/v2/016-communications/open-questions.md`).
 *
 * Le MODÈLE DE REQUÊTE est configurable (URL, méthode, en-têtes, corps JSON ou formulaire avec jetons `{{to}}`, `{{toDigits}}`,
 * `{{text}}`, `{{sender}}`, `{{reference}}`), ainsi que la LECTURE DE LA RÉPONSE (chemin du critère de succès, de
 * l'identifiant de message, du coût). Un profil de référence documenté (`SMS_HTTP_PROFILE=africastalking`) préremplit ces
 * réglages ; chaque variable explicite l'emporte sur le profil.
 *
 *   SMS_HTTP_URL                 obligatoire                         (ou fournie par le profil)
 *   SMS_HTTP_METHOD              POST (défaut)
 *   SMS_HTTP_CONTENT_TYPE        json (défaut) | form
 *   SMS_HTTP_BODY                modèle de corps : objet JSON dont les valeurs texte contiennent des jetons
 *   SMS_HTTP_HEADERS             objet JSON d'en-têtes supplémentaires
 *   SMS_HTTP_API_KEY             secret ; envoyé dans l'en-tête SMS_HTTP_API_KEY_HEADER (défaut Authorization) avec le préfixe
 *                                SMS_HTTP_API_KEY_PREFIX (défaut « Bearer »)
 *   SMS_HTTP_SENDER_ID           expéditeur alphanumérique ou numéro
 *   SMS_HTTP_SUCCESS_PATH        chemin JSON du critère de succès (ex. data.status) ; SMS_HTTP_SUCCESS_EQUALS : valeur attendue
 *   SMS_HTTP_ID_PATH             chemin JSON de l'identifiant de message du fournisseur
 *   SMS_HTTP_COST_PATH           chemin JSON du coût ; SMS_HTTP_COST_MULTIPLIER (défaut 1) ; SMS_HTTP_COST_CURRENCY (défaut XOF)
 *   SMS_HTTP_ERROR_PATH          chemin JSON du message d'erreur
 *   SMS_HTTP_TIMEOUT_MS          10000 (défaut)
 *
 * Classement : 2xx + critère de succès -> envoyé ; 408/425/429/5xx, coupure, délai -> panne PASSAGÈRE (reprise avec backoff,
 * `Retry-After` respecté) ; autre 4xx ou critère de succès non satisfait -> échec DÉFINITIF. Rien n'est écrit dans les journaux
 * d'exécution (ni numéro, ni texte).
 */
import { scrubAddresses } from "../../domain/addresses";
import type { ChannelAdapter, ChannelConfigStatus, ChannelMessage, ChannelOutcome } from "../../application/ports";

export interface SmsHttpSettings {
  readonly url: string;
  readonly method: string;
  readonly contentType: "json" | "form";
  readonly body: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly senderId: string;
  readonly successPath: string | null;
  readonly successEquals: string | null;
  readonly idPath: string | null;
  readonly costPath: string | null;
  readonly costMultiplier: number;
  readonly costCurrency: string;
  readonly errorPath: string | null;
  readonly timeoutMs: number;
}

/** Profils de référence (à valider avec le fournisseur retenu : les variables explicites les surchargent). */
const PROFILES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  generic: {
    SMS_HTTP_CONTENT_TYPE: "json",
    SMS_HTTP_BODY: '{"to":"{{to}}","message":"{{text}}","from":"{{sender}}","reference":"{{reference}}"}',
    SMS_HTTP_ID_PATH: "id",
  },
  // Africa's Talking — API REST « messaging » (formulaire, clé dans l'en-tête `apiKey`).
  africastalking: {
    SMS_HTTP_URL: "https://api.africastalking.com/version1/messaging",
    SMS_HTTP_CONTENT_TYPE: "form",
    SMS_HTTP_BODY: '{"username":"{{username}}","to":"{{to}}","message":"{{text}}","from":"{{sender}}"}',
    SMS_HTTP_API_KEY_HEADER: "apiKey",
    SMS_HTTP_API_KEY_PREFIX: "",
    SMS_HTTP_HEADERS: '{"Accept":"application/json"}',
    SMS_HTTP_SUCCESS_PATH: "SMSMessageData.Recipients.0.status",
    SMS_HTTP_SUCCESS_EQUALS: "Success",
    SMS_HTTP_ID_PATH: "SMSMessageData.Recipients.0.messageId",
    SMS_HTTP_ERROR_PATH: "SMSMessageData.Recipients.0.status",
  },
});

export const SMS_HTTP_PROFILES: readonly string[] = Object.keys(PROFILES);

const present = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

function parseJsonObject(raw: string | null, name: string): { value: Record<string, unknown>; error: string | null } {
  if (!raw) return { value: {}, error: null };
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { value: {}, error: `${name} doit être un objet JSON` };
    return { value: v as Record<string, unknown>, error: null };
  } catch {
    return { value: {}, error: `${name} n'est pas un JSON valide` };
  }
}

export function readSmsHttpSettings(env: Readonly<Record<string, string | undefined>>): { settings: SmsHttpSettings | null; missing: string[]; problems: string[] } {
  const profileName = present(env.SMS_HTTP_PROFILE)?.toLowerCase() ?? "generic";
  const profile = PROFILES[profileName] ?? PROFILES.generic!;
  const get = (key: string): string | null => present(env[key]) ?? (profile[key] !== undefined ? profile[key]! : null);
  const problems: string[] = [];
  if (present(env.SMS_HTTP_PROFILE) && !PROFILES[profileName]) problems.push(`SMS_HTTP_PROFILE inconnu (${SMS_HTTP_PROFILES.join(", ")})`);
  const url = get("SMS_HTTP_URL");
  const missing: string[] = [];
  if (!url) missing.push("SMS_HTTP_URL");
  if (url && !/^https?:\/\//i.test(url)) problems.push("SMS_HTTP_URL doit commencer par http(s)://");
  const body = parseJsonObject(get("SMS_HTTP_BODY"), "SMS_HTTP_BODY");
  if (body.error) problems.push(body.error);
  const headers = parseJsonObject(get("SMS_HTTP_HEADERS"), "SMS_HTTP_HEADERS");
  if (headers.error) problems.push(headers.error);
  const apiKey = present(env.SMS_HTTP_API_KEY);
  const allHeaders: Record<string, string> = Object.fromEntries(Object.entries(headers.value).map(([k, v]) => [k, String(v)]));
  if (apiKey) {
    const headerName = get("SMS_HTTP_API_KEY_HEADER") ?? "Authorization";
    const prefix = env.SMS_HTTP_API_KEY_PREFIX !== undefined ? env.SMS_HTTP_API_KEY_PREFIX : (profile.SMS_HTTP_API_KEY_PREFIX ?? "Bearer");
    allHeaders[headerName] = prefix ? `${prefix.trim()} ${apiKey}` : apiKey;
  } else if (url) {
    // Sans clé, certains fournisseurs acceptent une authentification dans l'URL ou le corps : on ne l'impose pas.
  }
  if (!url || problems.length > 0) return { settings: null, missing, problems };
  const multiplier = Number(get("SMS_HTTP_COST_MULTIPLIER") ?? "1");
  const timeout = Number.parseInt(get("SMS_HTTP_TIMEOUT_MS") ?? "10000", 10);
  const contentType = (get("SMS_HTTP_CONTENT_TYPE") ?? "json").toLowerCase() === "form" ? "form" : "json";
  return {
    settings: {
      url,
      method: (get("SMS_HTTP_METHOD") ?? "POST").toUpperCase(),
      contentType,
      body: Object.fromEntries(Object.entries(body.value).map(([k, v]) => [k, String(v)])),
      headers: allHeaders,
      senderId: get("SMS_HTTP_SENDER_ID") ?? "",
      successPath: get("SMS_HTTP_SUCCESS_PATH"),
      successEquals: get("SMS_HTTP_SUCCESS_EQUALS"),
      idPath: get("SMS_HTTP_ID_PATH"),
      costPath: get("SMS_HTTP_COST_PATH"),
      costMultiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
      costCurrency: get("SMS_HTTP_COST_CURRENCY") ?? "XOF",
      errorPath: get("SMS_HTTP_ERROR_PATH"),
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000,
    },
    missing,
    problems,
  };
}

/** Lit un chemin « a.b.0.c » dans un objet JSON. */
export function readPath(json: unknown, path: string): unknown {
  let cur: unknown = json;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

function fill(template: string, tokens: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_m, name: string) => tokens[name] ?? "");
}

export interface SmsHttpOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `fetch` injectable (tests : serveur HTTP simulé). */
  readonly fetch?: typeof fetch;
}

export function createSmsHttpChannel(options: SmsHttpOptions): ChannelAdapter {
  const { settings, missing, problems } = readSmsHttpSettings(options.env);
  const doFetch = options.fetch ?? fetch;
  const status = (): ChannelConfigStatus => ({ configured: settings !== null, missing: [...missing, ...problems] });

  return {
    channel: "SMS",
    provider: "http-sms",
    status,
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      if (!settings) return { status: "FAILED", code: "channel_not_configured", message: `Canal SMS non configuré (${[...missing, ...problems].join(" ; ") || "SMS_HTTP_URL"}).` };
      const tokens: Record<string, string> = {
        to: m.address,
        toDigits: m.address.replace(/^\+/, ""),
        text: m.text,
        sender: settings.senderId,
        reference: m.idempotencyKey,
        username: options.env.SMS_HTTP_USERNAME ?? "",
      };
      const fields = Object.fromEntries(Object.entries(settings.body).map(([k, v]) => [k, fill(v, tokens)]));
      const headers: Record<string, string> = { ...settings.headers };
      let body: string | undefined;
      if (settings.method !== "GET") {
        if (settings.contentType === "form") {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
          body = new URLSearchParams(Object.entries(fields).filter(([, v]) => v !== "")).toString();
        } else {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(fields);
        }
      }
      const url = settings.method === "GET" ? `${settings.url}${settings.url.includes("?") ? "&" : "?"}${new URLSearchParams(fields).toString()}` : settings.url;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, { method: settings.method, redirect: "error", headers, ...(body !== undefined ? { body } : {}), signal: controller.signal });
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        return { status: "RETRY", code: aborted ? "sms_timeout" : "sms_unreachable", message: aborted ? "Délai dépassé vers le fournisseur SMS." : "Fournisseur SMS injoignable." };
      } finally {
        clearTimeout(timer);
      }
      const raw = await res.text().catch(() => "");
      let json: unknown = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const retryable = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
        const detail = settings.errorPath ? readPath(json, settings.errorPath) : undefined;
        const message = scrubAddresses(typeof detail === "string" ? detail : `Réponse HTTP ${res.status} du fournisseur SMS.`).slice(0, 300);
        if (retryable) {
          const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
          return { status: "RETRY", code: `http_${res.status}`, message, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: Math.min(retryAfter, 3600) * 1000 } : {}) };
        }
        return { status: "FAILED", code: `http_${res.status}`, message };
      }
      if (settings.successPath) {
        const v = readPath(json, settings.successPath);
        const ok = settings.successEquals !== null ? String(v) === settings.successEquals : v !== undefined && v !== null && v !== false && v !== "";
        if (!ok) {
          const detail = settings.errorPath ? readPath(json, settings.errorPath) : v;
          return { status: "FAILED", code: "provider_rejected", message: scrubAddresses(typeof detail === "string" ? detail : "Le fournisseur SMS a refusé le message.").slice(0, 300) };
        }
      }
      const id = settings.idPath ? readPath(json, settings.idPath) : undefined;
      let cost: { amount: number; currency: string } | undefined;
      if (settings.costPath) {
        const raw = readPath(json, settings.costPath);
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw.replace(/[^0-9.,-]/g, "").replace(",", ".")) : Number.NaN;
        if (Number.isFinite(n) && n >= 0) cost = { amount: Math.round(n * settings.costMultiplier), currency: settings.costCurrency };
      }
      return { status: "SENT", providerId: typeof id === "string" || typeof id === "number" ? String(id) : undefined, cost };
    },
  };
}
