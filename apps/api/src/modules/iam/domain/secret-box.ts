/**
 * Chiffrement au repos des secrets TOTP : AES-256-GCM.
 *
 * Enveloppe : `v1.<keyId>.<iv base64url>.<chiffré base64url>.<tag base64url>`
 *  - IV de 12 octets aléatoires par chiffrement ;
 *  - `keyId` permet la ROTATION de clé : on déchiffre avec la clé nommée, on
 *    rechiffre avec la clé courante (voir `needsReencrypt`) ;
 *  - données authentifiées additionnelles (AAD) = identifiant de l'identité :
 *    un secret copié d'une ligne à une autre échoue à l'authentification.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MfaKeyRing } from "../config";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export function encryptSecret(ring: MfaKeyRing, plaintext: Uint8Array, aad: string): string {
  const key = ring.keys.get(ring.currentId);
  if (!key) throw new SecretBoxError("Clé de chiffrement courante introuvable.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", ring.currentId, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptSecret(ring: MfaKeyRing, envelope: string, aad: string): Buffer {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") throw new SecretBoxError("Enveloppe de secret invalide.");
  const [, keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
  const key = ring.keys.get(keyId);
  if (!key) throw new SecretBoxError("Clé de chiffrement inconnue (rotation incomplète ?).");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]);
  } catch {
    throw new SecretBoxError("Échec d'authentification du secret chiffré.");
  }
}

/** Vrai si l'enveloppe n'est pas chiffrée avec la clé courante (à rechiffrer au prochain usage). */
export function needsReencrypt(ring: MfaKeyRing, envelope: string): boolean {
  return envelope.split(".")[1] !== ring.currentId;
}
