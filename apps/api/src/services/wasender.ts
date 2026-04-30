/**
 * WaSender client (aligné sur CONFIGURATION_WASENDER_COMPLETE.md).
 * Ne pas versionner de clé API : variables d'environnement uniquement.
 */

const DEFAULT_BASE = "https://wasenderapi.com/api";

export function isWasenderConfigured(): boolean {
  const key = process.env.WASENDER_API_KEY?.trim();
  const provider = (process.env.WHATSAPP_PROVIDER || "").toLowerCase();
  if (provider === "wasender") return !!key;
  if (!process.env.WHATSAPP_PROVIDER && key) return true;
  return false;
}

function baseUrl(): string {
  return (process.env.WASENDER_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function timeoutMs(): number {
  const n = parseInt(process.env.WASENDER_TIMEOUT_MS || "10000", 10);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

function defaultCountryCode(): string {
  return (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "225").replace(/^\+/, "");
}

/** Normalise vers E.164 (+...) pour WaSender. */
export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.startsWith("+")) {
    const rest = s.slice(1).replace(/[^0-9]/g, "");
    return rest ? `+${rest}` : null;
  }
  if (s.startsWith("00")) {
    const rest = s.slice(2).replace(/[^0-9]/g, "");
    return rest ? `+${rest}` : null;
  }
  const digits = s.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0") && digits.length >= 9) {
    const cc = defaultCountryCode();
    return `+${cc}${digits.replace(/^0+/, "")}`;
  }
  if (digits.length >= 10) {
    const cc = defaultCountryCode();
    return `+${cc}${digits}`;
  }
  return `+${digits}`;
}

async function fetchJson(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? timeoutMs());
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
        Accept: "application/json",
        ...(init.headers as Record<string, string>),
      },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

export async function wasenderSessionStatus(): Promise<{ connected: boolean; detail: any }> {
  if (!isWasenderConfigured()) {
    return { connected: false, detail: { reason: "wasender_not_configured" } };
  }
  if (["1", "true", "yes", "on"].includes((process.env.WASENDER_SKIP_STATUS_CHECK || "").toLowerCase())) {
    return { connected: true, detail: { skipped: true } };
  }
  const r = await fetchJson("/status", { method: "GET" });
  const status = r.json?.status ?? r.json?.data?.status;
  const connected = String(status).toLowerCase() === "connected";
  return { connected, detail: r.json };
}

export async function wasenderSendText(toE164: string, text: string): Promise<{ ok: boolean; detail: any; error?: string }> {
  if (!isWasenderConfigured()) {
    return { ok: false, detail: {}, error: "wasender_not_configured" };
  }
  const skip = ["1", "true", "yes", "on"].includes((process.env.WASENDER_SKIP_STATUS_CHECK || "").toLowerCase());
  if (!skip) {
    const st = await wasenderSessionStatus();
    if (!st.connected) {
      return { ok: false, detail: st.detail, error: "wasender_session_not_connected" };
    }
  }
  const body: Record<string, string> = {
    to: toE164,
    text,
  };
  const session = process.env.WASENDER_SESSION?.trim();
  const sessionName = process.env.WASENDER_SESSION_NAME?.trim();
  if (session) body.session = session;
  if (sessionName) body.sessionName = sessionName;

  const r = await fetchJson("/send-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    return {
      ok: false,
      detail: r.json,
      error: r.json?.message || r.json?.error || `http_${r.status}`,
    };
  }
  return { ok: true, detail: r.json };
}
