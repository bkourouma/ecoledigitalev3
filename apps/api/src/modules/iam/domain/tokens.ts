/**
 * Primitives de jetons : JWT HS256 minimal et STRICT, jetons opaques, hachage.
 *
 * Pourquoi un JWT « maison » de 60 lignes plutôt que `jsonwebtoken` ? Parce que
 * la surface acceptée est volontairement minuscule et vérifiable ligne à ligne :
 *  - un seul algorithme, HS256 ; `alg: none` (et tout autre) est refusé, il
 *    n'existe aucun chemin « sans signature » ;
 *  - l'en-tête doit contenir EXACTEMENT {alg, typ} : pas de `kid`, `jku`, `jwk`,
 *    `x5u`, `crit`… (vecteurs classiques de confusion de clé) ;
 *  - `typ` est contrôlé : un jeton de challenge MFA ne peut pas servir de jeton
 *    d'accès, même signé avec la même clé (et les clés sont déjà distinctes) ;
 *  - la signature est vérifiée à temps constant AVANT tout JSON.parse du payload ;
 *  - base64url strict (alphabet, canonicité de la signature), taille bornée.
 *
 * La validation des revendications (exp, aud, tenant…) est faite par l'appelant
 * sur le payload RENDU par `verifyJwt` : jamais sur un payload non authentifié.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type JwtErrorCode = "malformed" | "too_large" | "bad_header" | "bad_signature" | "bad_payload";

export class JwtError extends Error {
  constructor(readonly code: JwtErrorCode) {
    super(`JWT invalide (${code}).`);
    this.name = "JwtError";
  }
}

const MAX_JWT_LENGTH = 4096;
const B64URL = /^[A-Za-z0-9_-]+$/;

export type JwtTyp = "at+jwt" | "imp+jwt" | "mfa+jwt" | "enr+jwt";

function hmac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function signJwt(payload: Record<string, unknown>, key: Buffer, typ: JwtTyp): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ }), "utf8").toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${hmac(key, signingInput).toString("base64url")}`;
}

/**
 * Vérifie signature + en-tête et renvoie le payload (objet JSON). Ne contrôle PAS
 * les dates ni les audiences. Lève `JwtError` sinon.
 */
export function verifyJwt(token: string, key: Buffer, allowedTyp: readonly JwtTyp[]): Record<string, unknown> {
  if (typeof token !== "string") throw new JwtError("malformed");
  if (token.length > MAX_JWT_LENGTH) throw new JwtError("too_large");
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed");
  const [h, p, s] = parts as [string, string, string];
  if (!B64URL.test(h) || !B64URL.test(p) || !B64URL.test(s)) throw new JwtError("malformed");

  // 1. En-tête : alg/typ stricts.
  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  } catch {
    throw new JwtError("bad_header");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) throw new JwtError("bad_header");
  const keys = Object.keys(header).sort();
  const hdr = header as Record<string, unknown>;
  if (keys.length !== 2 || keys[0] !== "alg" || keys[1] !== "typ") throw new JwtError("bad_header");
  if (hdr.alg !== "HS256") throw new JwtError("bad_header");
  if (typeof hdr.typ !== "string" || !(allowedTyp as readonly string[]).includes(hdr.typ)) throw new JwtError("bad_header");

  // 2. Signature, à temps constant, avant de toucher au payload.
  const given = Buffer.from(s, "base64url");
  if (given.length !== 32 || given.toString("base64url") !== s) throw new JwtError("bad_signature");
  const expected = hmac(key, `${h}.${p}`);
  if (!timingSafeEqual(given, expected)) throw new JwtError("bad_signature");

  // 3. Payload (désormais authentifié).
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    throw new JwtError("bad_payload");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new JwtError("bad_payload");
  return payload as Record<string, unknown>;
}

/** Type (`typ`) lu dans l'en-tête SANS rien authentifier : sert uniquement à choisir la clé à essayer. */
export function peekJwtTyp(token: string): string | null {
  const first = token.split(".", 1)[0];
  if (!first || !B64URL.test(first)) return null;
  try {
    const h = JSON.parse(Buffer.from(first, "base64url").toString("utf8")) as { typ?: unknown };
    return typeof h.typ === "string" ? h.typ : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Jetons opaques (refresh, réinitialisation, invitation)
// -----------------------------------------------------------------------------

/** 256 bits aléatoires en base64url (43 caractères). */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Empreinte d'un jeton opaque : HMAC-SHA256 avec une clé SERVEUR (hors base).
 * Le secret étant déjà à 256 bits d'entropie, un hachage rapide suffit ; le HMAC
 * garantit qu'une fuite de la seule base ne permet pas de forger ni de tester des jetons.
 */
export function hashOpaqueToken(key: Buffer, token: string): string {
  return createHmac("sha256", key).update("tok:").update(token, "utf8").digest("hex");
}

export function hashRecoveryCode(key: Buffer, normalizedCode: string): string {
  return createHmac("sha256", key).update("rcv:").update(normalizedCode, "utf8").digest("hex");
}

/** Clé de limitation : empreinte HMAC d'une valeur (e-mail, IP) pour ne pas stocker de donnée personnelle brute dans Redis. */
export function limiterKey(key: Buffer, scope: string, value: string): string {
  return `${scope}:${createHmac("sha256", key).update("rl:").update(value, "utf8").digest("hex").slice(0, 32)}`;
}

/** Comparaison à temps constant de deux chaînes (longueurs différentes : faux, sans fuite sur le contenu). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

// -----------------------------------------------------------------------------
// Format du refresh token : rt1.<tenantId sans tirets>.<secret>
// -----------------------------------------------------------------------------

const REFRESH_RE = /^rt1\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

export function formatRefreshToken(tenantId: string, secret: string): string {
  return `rt1.${tenantId.replace(/-/g, "")}.${secret}`;
}

/**
 * Extrait le tenant porté par le jeton. Cette valeur est NON AUTHENTIFIÉE : elle
 * ne sert qu'à choisir la transaction (RLS) dans laquelle chercher l'empreinte.
 * Un tenant falsifié ne trouve simplement aucune ligne.
 */
export function parseRefreshToken(token: string): { tenantId: string; secret: string } | null {
  const m = REFRESH_RE.exec(token);
  if (!m) return null;
  const h = m[1] as string;
  const tenantId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return { tenantId, secret: m[2] as string };
}

// -----------------------------------------------------------------------------
// Codes de secours MFA : 12 caractères base32 (60 bits), affichés « XXXX-XXXX-XXXX »
// -----------------------------------------------------------------------------

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1 (lisibilité)

export function generateRecoveryCode(): string {
  const bytes = randomBytes(12);
  let raw = "";
  for (const b of bytes) raw += RECOVERY_ALPHABET[b & 31];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}
