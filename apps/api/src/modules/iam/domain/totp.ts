/**
 * TOTP (RFC 6238) et HOTP (RFC 4226) implémentés avec node:crypto, sans dépendance.
 *
 * Paramètres compatibles avec les applications d'authentification courantes :
 * SHA-1, 6 chiffres, pas de 30 s. Les autres algorithmes (SHA-256/512) et les
 * 8 chiffres sont supportés pour valider l'implémentation sur les vecteurs de test
 * de la RFC 6238 (Annexe B) et de la RFC 4226 (Annexe D).
 *
 * Vérification :
 *  - fenêtre de tolérance ±`window` pas (défaut ±1 = ±30 s, dérive d'horloge) ;
 *  - comparaison à temps constant sur TOUS les candidats (pas de sortie
 *    anticipée) ;
 *  - renvoie le NUMÉRO DE PAS accepté : l'appelant le persiste et refuse tout pas
 *    ≤ au dernier accepté (anti-rejeu d'un code déjà utilisé).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

const HMAC_NAME: Record<TotpAlgorithm, string> = { SHA1: "sha1", SHA256: "sha256", SHA512: "sha512" };

// -----------------------------------------------------------------------------
// Base32 (RFC 4648, alphabet standard, sans remplissage à l'encodage)
// -----------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Décode du base32 (insensible à la casse, espaces/tirets/« = » ignorés). Lève `RangeError` si invalide. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new RangeError("Caractère base32 invalide.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

// -----------------------------------------------------------------------------
// HOTP / TOTP
// -----------------------------------------------------------------------------

/** HOTP(K, C) — RFC 4226 §5.3, troncature dynamique. */
export function hotp(secret: Uint8Array, counter: number | bigint, digits = 6, algorithm: TotpAlgorithm = "SHA1"): string {
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) throw new RangeError("digits doit être entre 6 et 10.");
  const c = typeof counter === "bigint" ? counter : BigInt(counter);
  if (c < 0n || c > 0xffffffffffffffffn) throw new RangeError("Compteur hors limites.");
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(c);
  const mac = createHmac(HMAC_NAME[algorithm], secret).update(msg).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const bin =
    (((mac[offset] as number) & 0x7f) << 24) |
    (((mac[offset + 1] as number) & 0xff) << 16) |
    (((mac[offset + 2] as number) & 0xff) << 8) |
    ((mac[offset + 3] as number) & 0xff);
  // 10 chiffres : 2^31 < 10^10, le modulo reste exact dans un nombre JS (< 2^53).
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export interface TotpOptions {
  /** Durée d'un pas, en secondes (défaut 30). */
  period?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
  /** Instant d'origine Unix (défaut 0). */
  t0?: number;
}

export function totpStep(timeMs: number, options: Pick<TotpOptions, "period" | "t0"> = {}): number {
  const period = options.period ?? 30;
  const t0 = options.t0 ?? 0;
  return Math.floor((Math.floor(timeMs / 1000) - t0) / period);
}

/** TOTP(K, T) — RFC 6238 §4.2. `timeMs` : millisecondes Unix. */
export function totp(secret: Uint8Array, timeMs: number, options: TotpOptions = {}): string {
  return hotp(secret, totpStep(timeMs, options), options.digits ?? 6, options.algorithm ?? "SHA1");
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Nombre de pas tolérés avant/après le pas courant (défaut 1). */
  window?: number;
  /** Refuse tout pas ≤ à cette valeur (dernier pas déjà accepté). */
  minStepExclusive?: number;
}

/**
 * Vérifie `code`. Renvoie le pas accepté, ou `null`. Examine toujours toutes les
 * positions de la fenêtre (temps indépendant de la position du code valide).
 */
export function verifyTotp(secret: Uint8Array, code: string, timeMs: number, options: VerifyTotpOptions = {}): number | null {
  const digits = options.digits ?? 6;
  if (typeof code !== "string" || code.length !== digits || !/^\d+$/.test(code)) return null;
  const window = options.window ?? 1;
  const current = totpStep(timeMs, options);
  const given = Buffer.from(code, "utf8");
  let accepted: number | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step, digits, options.algorithm ?? "SHA1"), "utf8");
    const match = expected.length === given.length && timingSafeEqual(expected, given);
    if (match && (options.minStepExclusive === undefined || step > options.minStepExclusive)) {
      // On garde le pas le plus RÉCENT si plusieurs correspondent (cas d'un code répété).
      if (accepted === null || step > accepted) accepted = step;
    }
  }
  return accepted;
}

// -----------------------------------------------------------------------------
// Enrôlement
// -----------------------------------------------------------------------------

/** Secret TOTP aléatoire de 160 bits (taille recommandée par la RFC 4226 §4). */
export function generateTotpSecret(bytes = 20): Buffer {
  return randomBytes(bytes);
}

export interface OtpauthOptions {
  issuer: string;
  accountName: string;
  secret: Uint8Array;
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
}

/** URI `otpauth://totp/...` (Key Uri Format de Google Authenticator), à rendre en QR code côté client. */
export function otpauthUri(options: OtpauthOptions): string {
  const issuer = options.issuer.replace(/:/g, " ");
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(options.accountName)}`;
  const params = new URLSearchParams({
    secret: base32Encode(options.secret),
    issuer,
    algorithm: options.algorithm ?? "SHA1",
    digits: String(options.digits ?? 6),
    period: String(options.period ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
