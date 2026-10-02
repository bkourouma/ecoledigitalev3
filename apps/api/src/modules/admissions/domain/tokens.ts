/**
 * Jetons du module : slug public d'un établissement, jeton de formulaire, code de suivi, jeton de réponse à une offre.
 *
 * Règle commune : le secret EN CLAIR n'est jamais stocké, seule son empreinte SHA-256 l'est. Empreintes d'IP et d'agent : HMAC
 * (clé du serveur), jamais en clair. Aucun `Math.random` : `node:crypto` uniquement.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
/** Alphabet du code de suivi : sans caractères ambigus (0/O, 1/I/L), 31 symboles. */
const TRACKING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export const hmacHex = (secret: string, value: string): string => createHmac("sha256", secret).update(value, "utf8").digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Slug public : 26 caractères `a-z0-9` (≈ 134 bits ; la base exige 16 à 40 caractères, soit ≥ 82 bits). */
export function newPublicSlug(): string {
  let out = "";
  for (let i = 0; i < 26; i += 1) out += ALNUM[randomInt(ALNUM.length)];
  return out;
}

/** Jeton de formulaire à usage unique : 32 octets aléatoires (256 bits), base64url. */
export const newOpaqueToken = (): string => randomBytes(32).toString("base64url");

/** Code de suivi : 16 symboles groupés par 4 (`ABCD-EFGH-JKMN-PQRS`, ≈ 79 bits). */
export function newTrackingCode(): string {
  let raw = "";
  for (let i = 0; i < 16; i += 1) raw += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  return raw.replace(/(.{4})(?=.)/g, "$1-");
}

/** Forme canonique d'un code saisi (majuscules, sans séparateur) : sert à calculer l'empreinte stockée. */
export function canonicalTrackingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const trackingCodeHash = (input: string): string => sha256Hex(`tracking:${canonicalTrackingCode(input)}`);

export const tokenHash = (token: string, purpose: "form" | "offer"): string => sha256Hex(`${purpose}:${token}`);

/** Empreinte d'IP / d'agent : HMAC, tronquée à l'IPv4 /24 ou IPv6 /48 AVANT calcul (pas d'IP exacte même hachée). */
export function ipFingerprint(secret: string, ip: string): string {
  return hmacHex(secret, `ip:${truncateIp(ip)}`);
}

export const userAgentFingerprint = (secret: string, userAgent: string): string => hmacHex(secret, `ua:${userAgent.slice(0, 300)}`);

export function truncateIp(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48";
  return "unknown";
}
