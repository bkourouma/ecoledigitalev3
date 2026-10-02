/**
 * Jetons signés (HMAC-SHA256) : lien de désinscription et signature des accusés de fournisseurs. Fonctions pures,
 * comparaison à temps constant. Le secret vient de l'environnement (`NOTIFICATIONS_UNSUBSCRIBE_SECRET`,
 * `NOTIFICATIONS_WEBHOOK_SECRET`) : jamais dans le code ni les logs.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import { NOTIF_CHANNELS } from "@ecoledigitale/contracts/src/v2/notifications";

const b64 = (buf: Buffer): string => buf.toString("base64url");

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface UnsubscribeClaims {
  readonly tenantId: string;
  readonly subjectKey: string;
  readonly channel: NotifChannel;
}

/** `v1.<charge utile base64url>.<signature base64url>` — pas de date d'expiration : un lien dans un vieil e-mail doit marcher. */
export function signUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ t: claims.tenantId, s: claims.subjectKey, c: claims.channel })));
  return `v1.${payload}.${b64(hmac(secret, `v1.${payload}`))}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, sig] = parts as [string, string, string];
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (!safeEqual(given, hmac(secret, `v1.${payload}`))) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { t?: unknown; s?: unknown; c?: unknown };
    if (typeof raw.t !== "string" || typeof raw.s !== "string" || typeof raw.c !== "string") return null;
    if (!(NOTIF_CHANNELS as readonly string[]).includes(raw.c)) return null;
    return { tenantId: raw.t, subjectKey: raw.s, channel: raw.c as NotifChannel };
  } catch {
    return null;
  }
}

/** Signature d'un corps de requête brut (accusés de fournisseurs) : `sha256=<hex>`. */
export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyBodySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const given = Buffer.from(header);
  return safeEqual(given, expected);
}
