/**
 * Briques communes des adaptateurs de paiement : HMAC, comparaison à temps constant, montants entiers
 * stricts, références compactes réversibles, masquage des numéros, jeton d'URL de webhook.
 *
 * Tout est pur et sans réseau. Aucune fonction ne journalise : les appelants ne passent jamais un secret
 * à un logger.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { ProviderHeaders } from "../../application/ports/payment-provider";

// ---------------------------------------------------------------------------
// HMAC et comparaison à temps constant
// ---------------------------------------------------------------------------

export const hmacSha256Hex = (secret: string, data: string): string =>
  createHmac("sha256", secret).update(data, "utf8").digest("hex");

/**
 * Égalité de deux chaînes à temps constant, quelle que soit leur longueur : chacune est d'abord condensée
 * (SHA-256) pour que `timingSafeEqual` reçoive deux tampons de même taille sans révéler la longueur du secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function headerOf(headers: ProviderHeaders, name: string): string | undefined {
  const key = name.toLowerCase();
  const direct = headers[key];
  const value = direct ?? Object.entries(headers).find(([k]) => k.toLowerCase() === key)?.[1];
  return Array.isArray(value) ? value[0] : value;
}

export const isNonEmpty = (s: string | undefined | null): s is string => typeof s === "string" && s.trim().length > 0;

// ---------------------------------------------------------------------------
// Montants : entiers uniquement, jamais d'arrondi
// ---------------------------------------------------------------------------

/**
 * Lit un montant rapporté par un fournisseur : entier sûr, chaîne de chiffres, ou chaîne décimale dont la
 * partie fractionnaire est NULLE (`"1000.00"`). Tout le reste (`"1000.5"`, `1e3`, `-5`, `NaN`, objet) ⇒ `null`
 * (réponse malformée) : on ne devine ni n'arrondit jamais un montant.
 */
export function parseProviderAmount(value: unknown, currency: CurrencyCode): Money | null {
  try {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value >= 0 ? Money.of(value, currency) : null;
    }
    if (typeof value === "string") {
      const m = /^(\d{1,15})(?:\.0{1,6})?$/.exec(value.trim());
      return m ? Money.of(BigInt(m[1] as string), currency) : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Montant → chaîne d'entiers (`"25000"`) pour les API qui exigent une chaîne. Refuse une devise à décimales. */
export function integerAmountString(amount: Money): string {
  return amount.toBigInt().toString();
}

// ---------------------------------------------------------------------------
// Références compactes réversibles (UUID ↔ base 62)
// ---------------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMPACT_REFERENCE_LENGTH = 22;

/** UUID (36 caractères) → 22 caractères alphanumériques : tient dans les limites d'Orange (30) et CinetPay (25). */
export function encodePaymentReference(paymentId: string): string {
  if (!UUID_RE.test(paymentId)) throw new TypeError("Identifiant de paiement : UUID attendu.");
  let n = BigInt(`0x${paymentId.replace(/-/g, "")}`);
  let out = "";
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(COMPACT_REFERENCE_LENGTH, "0");
}

/** Opération inverse ; `null` si la référence n'est pas une de nos références compactes. */
export function decodePaymentReference(ref: string): string | null {
  if (typeof ref !== "string" || ref.length !== COMPACT_REFERENCE_LENGTH || !/^[0-9A-Za-z]+$/.test(ref)) return null;
  let n = 0n;
  for (const c of ref) n = n * 62n + BigInt(BASE62.indexOf(c));
  if (n >= 1n << 128n) return null;
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * MTN MoMo exige un `X-Reference-Id` en UUID **v4**. Nos identifiants sont des UUID v7 : on remplace le quartet de
 * version (7 → 4), ce qui est déterministe et injectif sur les v7 ; tout autre UUID est dérivé par SHA-256.
 */
export function toMtnReferenceId(paymentId: string): string {
  const id = paymentId.toLowerCase();
  if (UUID_RE.test(id)) {
    const version = id[14];
    if (version === "4") return id;
    if (version === "7") return `${id.slice(0, 14)}4${id.slice(15)}`;
  }
  const h = createHash("sha256").update(paymentId, "utf8").digest("hex");
  const variant = ((parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Numéros de téléphone
// ---------------------------------------------------------------------------

/** Chiffres seuls, préfixe pays inclus (`225…`) ; `null` si le numéro n'est pas plausible (8 à 15 chiffres). */
export function normalizeMsisdn(input: string | undefined, defaultCountryCode = "225"): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith("0")) digits = `${defaultCountryCode}${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** `22507010203 04` → `225•••••0304` : jamais un numéro complet dans un journal ou un contenu stocké. */
export function maskMsisdn(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 3)}${"•".repeat(Math.max(3, digits.length - 7))}${digits.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Jeton d'URL de webhook (schémas sans signature de contenu : Orange Money, MTN MoMo)
// ---------------------------------------------------------------------------

/** `HMAC(secret, "webhook-url|tenant|fournisseur|ref")` : lie l'URL à un tenant, un fournisseur et (facultatif) un paiement. */
export function webhookUrlToken(secret: string, tenantId: string, provider: string, ref = ""): string {
  return hmacSha256Hex(secret, `webhook-url|${tenantId}|${provider}|${ref}`);
}

export function withQuery(baseUrl: string, params: Record<string, string>): string {
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Vrai seulement si le secret existe ET que le jeton fourni est exact (temps constant). */
export function verifyWebhookUrlToken(
  secret: string | undefined,
  provided: string | undefined,
  tenantId: string | undefined,
  provider: string,
  ref = "",
): boolean {
  if (!isNonEmpty(secret) || !isNonEmpty(provided) || !isNonEmpty(tenantId)) return false;
  return constantTimeEqual(webhookUrlToken(secret, tenantId, provider, ref), provided);
}

/** Corps JSON objet, ou `null` (jamais d'exception). */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
export const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

export function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
