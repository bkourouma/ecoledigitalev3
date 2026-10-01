/**
 * Signature Ed25519 des documents (spec 013 US4, data-model §5) — `node:crypto`, aucune dépendance.
 *
 *   message  = "ed-rc/v1" 0x00 snapshot_hash 0x00 verification_code 0x00 issued_at(ISO UTC, ms)
 *   signature = Ed25519(message), encodée en base64
 *
 * La CLÉ PRIVÉE n'existe qu'en mémoire du processus qui signe (fournie par l'environnement / un gestionnaire de secrets,
 * voir `infrastructure/key-provider.ts`) : ni en base, ni dans le dépôt, ni dans un journal. Seule la clé PUBLIQUE (SPKI DER,
 * base64) est stockée (`reportcards.signing_keys`) et publiée (`/.well-known/ecoledigitale-keys.json`) : un tiers vérifie
 * un document hors ligne avec le message ci-dessus et cette clé.
 *
 * Le code de vérification est opaque : 128 bits aléatoires en base32 (RFC 4648 sans remplissage) = 26 caractères,
 * jamais dérivé d'une donnée de l'élève (R-RC-05).
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";

export const SIGNATURE_PREFIX = "ed-rc/v1";
export const VERIFICATION_CODE_RE = /^[A-Z2-7]{26}$/;
export const KEY_ID_RE = /^[a-z0-9-]{6,40}$/;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode en base32 RFC 4648 sans remplissage. 16 octets -> 26 caractères. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Code de vérification : 128 bits CSPRNG. `random` est injectable pour les tests (jamais en production). */
export function generateVerificationCode(random: (n: number) => Uint8Array = randomBytes): string {
  return base32Encode(random(16));
}

export const isVerificationCode = (value: unknown): value is string => typeof value === "string" && VERIFICATION_CODE_RE.test(value);

/** Message exact signé. `issuedAt` : instant UTC ; toujours sérialisé en ISO avec millisecondes. */
export function signingMessage(input: { snapshotHash: string; verificationCode: string; issuedAt: Date | string }): Buffer {
  if (!/^[0-9a-f]{64}$/.test(input.snapshotHash)) throw new TypeError("snapshotHash : SHA-256 hexadécimal attendu.");
  if (!isVerificationCode(input.verificationCode)) throw new TypeError("verificationCode invalide.");
  const iso = (input.issuedAt instanceof Date ? input.issuedAt : new Date(input.issuedAt)).toISOString();
  return Buffer.concat([
    Buffer.from(SIGNATURE_PREFIX, "utf8"),
    Buffer.from([0]),
    Buffer.from(input.snapshotHash, "utf8"),
    Buffer.from([0]),
    Buffer.from(input.verificationCode, "utf8"),
    Buffer.from([0]),
    Buffer.from(iso, "utf8"),
  ]);
}

export interface SigningInput {
  snapshotHash: string;
  verificationCode: string;
  issuedAt: Date | string;
}

/** Signe avec une clé privée Ed25519 (KeyObject). Retourne la signature en base64. */
export function signDocument(privateKey: KeyObject, input: SigningInput): string {
  return edSign(null, signingMessage(input), privateKey).toString("base64");
}

/** Vérifie une signature avec une clé publique SPKI DER (base64) ou un KeyObject. Jamais d'exception : `false` si invalide. */
export function verifyDocumentSignature(publicKey: string | KeyObject, input: SigningInput, signature: string): boolean {
  try {
    const key = typeof publicKey === "string" ? createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }) : publicKey;
    const sig = Buffer.from(signature, "base64");
    if (sig.length !== 64) return false;
    return edVerify(null, signingMessage(input), key, sig);
  } catch {
    return false;
  }
}

/** Clé publique SPKI DER en base64 d'une clé privée. */
export function publicKeyOf(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
}

/** Empreinte SHA-256 (hex) de la clé publique SPKI DER : identifie la clé sans la transporter. */
export function publicKeyFingerprint(publicKeySpkiBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeySpkiBase64, "base64")).digest("hex");
}

/**
 * Lit une clé privée Ed25519 fournie par l'environnement : PEM PKCS#8 (avec ou sans retours à la ligne échappés `\n`) ou
 * DER PKCS#8 en base64. Lève une erreur SANS reprendre le contenu de la valeur (jamais de secret dans un message).
 */
export function parsePrivateKey(raw: string): KeyObject {
  const value = raw.trim();
  try {
    const key = value.includes("BEGIN")
      ? createPrivateKey({ key: value.replace(/\\n/g, "\n"), format: "pem" })
      : createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("type de clé inattendu");
    return key;
  } catch {
    throw new Error("Clé de signature invalide : une clé privée Ed25519 au format PKCS#8 (PEM ou DER base64) est attendue.");
  }
}
