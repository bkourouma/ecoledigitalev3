/**
 * Fournisseur de la clé de signature Ed25519 (spec 013, data-model §5). La clé PRIVÉE vient de l'environnement ou d'un
 * gestionnaire de secrets monté en fichier — JAMAIS du dépôt, JAMAIS de la base, jamais journalisée :
 *
 *   REPORTCARDS_SIGNING_KEY       PEM PKCS#8 (les retours à la ligne peuvent être écrits `\n`) ou DER PKCS#8 en base64
 *   REPORTCARDS_SIGNING_KEY_FILE  chemin d'un fichier contenant la même valeur (secret Docker / Kubernetes monté)
 *   REPORTCARDS_SIGNING_KEY_ID    identifiant de la clé (6 à 40 car. `a-z0-9-`) ; défaut : `ed-` + 16 premiers hex de l'empreinte
 *
 * Rotation : générer une nouvelle clé (`generateSigningKeyPair`), la déployer avec un nouvel identifiant ; l'ancienne clé
 * publique reste en base (statut RETIRED) : les documents qu'elle a signés restent vérifiables (AC4.6).
 */
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import type { KeyProvider } from "../application/ports";
import { KEY_ID_RE, parsePrivateKey, publicKeyFingerprint, publicKeyOf, signDocument, type SigningInput } from "../domain/signing";

export class StaticKeyProvider implements KeyProvider {
  readonly keyId: string;
  readonly publicKey: string;
  // `#` : champ privé de classe — jamais énumérable, jamais sérialisé par JSON.stringify ni par un logger.
  readonly #privateKey: KeyObject;

  constructor(privateKey: KeyObject, keyId?: string) {
    this.#privateKey = privateKey;
    this.publicKey = publicKeyOf(privateKey);
    this.keyId = keyId ?? `ed-${publicKeyFingerprint(this.publicKey).slice(0, 16)}`;
    if (!KEY_ID_RE.test(this.keyId)) throw new Error("Identifiant de clé de signature invalide (6 à 40 caractères a-z, 0-9, -).");
  }

  sign(input: SigningInput): string {
    return signDocument(this.#privateKey, input);
  }

  toJSON(): { keyId: string; publicKey: string } {
    return { keyId: this.keyId, publicKey: this.publicKey };
  }
}

/** Lit la clé depuis l'environnement. `null` si aucune clé n'est configurée ; lève (sans afficher la valeur) si elle est invalide. */
export function keyProviderFromEnv(env: Readonly<Record<string, string | undefined>>): KeyProvider | null {
  const inline = env.REPORTCARDS_SIGNING_KEY?.trim();
  const file = env.REPORTCARDS_SIGNING_KEY_FILE?.trim();
  let raw = inline;
  if (!raw && file) {
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      throw new Error("REPORTCARDS_SIGNING_KEY_FILE : fichier illisible.");
    }
  }
  if (!raw) return null;
  return new StaticKeyProvider(parsePrivateKey(raw), env.REPORTCARDS_SIGNING_KEY_ID?.trim() || undefined);
}

/** Génère une paire Ed25519 (outil d'exploitation / tests) : la clé privée en PEM PKCS#8 et la clé publique SPKI en base64. */
export function generateSigningKeyPair(): { privateKeyPem: string; privateKey: KeyObject; publicKey: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), privateKey, publicKey: publicKeyOf(privateKey) };
}
