/**
 * Canal WHATSAPP : WaSender, comme dans le legacy (`apps/api/src/services/wasender.ts`), derrière le port.
 *
 * Mêmes variables : `WASENDER_API_KEY` (secret), `WASENDER_API_BASE_URL` (défaut `https://wasenderapi.com/api`),
 * `WASENDER_SESSION`, `WASENDER_SESSION_NAME`, `WASENDER_TIMEOUT_MS`, `WASENDER_SKIP_STATUS_CHECK`, `WHATSAPP_PROVIDER`
 * (si défini, doit valoir `wasender`). Comportement conservé : contrôle de l'état de la session avant l'envoi, envoi par
 * `POST /send-message { to, text, session?, sessionName? }`, numéro normalisé E.164.
 *
 * Amélioré : issues CLASSÉES (session déconnectée, 429, 5xx, coupure = reprise avec backoff ; autre 4xx = échec définitif),
 * lien de désinscription ajouté au texte, aucun numéro ni texte dans les journaux d'exécution.
 */
import { scrubAddresses } from "../../domain/addresses";
import type { ChannelAdapter, ChannelConfigStatus, ChannelMessage, ChannelOutcome } from "../../application/ports";

const DEFAULT_BASE = "https://wasenderapi.com/api";
const TRUE = ["1", "true", "yes", "on"];

const present = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

export interface WasenderOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
}

export function wasenderStatus(env: Readonly<Record<string, string | undefined>>): ChannelConfigStatus {
  const key = present(env.WASENDER_API_KEY);
  const provider = (env.WHATSAPP_PROVIDER ?? "").toLowerCase();
  const missing: string[] = [];
  if (!key) missing.push("WASENDER_API_KEY");
  if (provider !== "" && provider !== "wasender") missing.push("WHATSAPP_PROVIDER (doit valoir « wasender »)");
  return { configured: missing.length === 0, missing };
}

export function createWasenderChannel(options: WasenderOptions): ChannelAdapter {
  const { env } = options;
  const doFetch = options.fetch ?? fetch;
  const status = (): ChannelConfigStatus => wasenderStatus(env);
  const base = (present(env.WASENDER_API_BASE_URL) ?? DEFAULT_BASE).replace(/\/$/, "");
  const timeout = (() => {
    const n = Number.parseInt(env.WASENDER_TIMEOUT_MS ?? "10000", 10);
    return Number.isFinite(n) && n > 0 ? n : 10_000;
  })();

  async function call(path: string, init: { method: string; body?: string }): Promise<{ ok: boolean; status: number; json: unknown; retryAfter: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await doFetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
        method: init.method,
        headers: { Authorization: `Bearer ${env.WASENDER_API_KEY}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      });
      const text = await res.text().catch(() => "");
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 200) };
      }
      const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      return { ok: res.ok, status: res.status, json, retryAfter: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) * 1000 : null };
    } finally {
      clearTimeout(timer);
    }
  }

  const pick = (json: unknown, ...paths: string[]): string | undefined => {
    for (const p of paths) {
      let cur: unknown = json;
      for (const part of p.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
      if (typeof cur === "string" && cur) return cur;
      if (typeof cur === "number") return String(cur);
    }
    return undefined;
  };

  return {
    channel: "WHATSAPP",
    provider: "wasender",
    status,
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      const st = status();
      if (!st.configured) return { status: "FAILED", code: "channel_not_configured", message: `Canal WhatsApp non configuré (${st.missing.join(", ")}).` };
      try {
        if (!TRUE.includes((env.WASENDER_SKIP_STATUS_CHECK ?? "").toLowerCase())) {
          const s = await call("/status", { method: "GET" });
          const state = pick(s.json, "status", "data.status");
          if (!s.ok || String(state).toLowerCase() !== "connected") {
            return { status: "RETRY", code: "wasender_session_not_connected", message: "La session WhatsApp n'est pas connectée." };
          }
        }
        const text = m.unsubscribeUrl ? `${m.text}\n\nNe plus recevoir de messages WhatsApp : ${m.unsubscribeUrl}` : m.text;
        const body: Record<string, string> = { to: m.address, text };
        const session = present(env.WASENDER_SESSION);
        const sessionName = present(env.WASENDER_SESSION_NAME);
        if (session) body.session = session;
        if (sessionName) body.sessionName = sessionName;
        const r = await call("/send-message", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) {
          const detail = scrubAddresses(pick(r.json, "message", "error") ?? `Réponse HTTP ${r.status} de WaSender.`).slice(0, 300);
          if (r.status === 408 || r.status === 425 || r.status === 429 || r.status >= 500) return { status: "RETRY", code: `http_${r.status}`, message: detail, ...(r.retryAfter ? { retryAfterMs: r.retryAfter } : {}) };
          return { status: "FAILED", code: `http_${r.status}`, message: detail };
        }
        return { status: "SENT", providerId: pick(r.json, "data.msgId", "data.id", "data.messageId", "msgId", "id", "messageId") };
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        return { status: "RETRY", code: aborted ? "wasender_timeout" : "wasender_unreachable", message: aborted ? "Délai dépassé vers WaSender." : "WaSender injoignable." };
      }
    },
  };
}
