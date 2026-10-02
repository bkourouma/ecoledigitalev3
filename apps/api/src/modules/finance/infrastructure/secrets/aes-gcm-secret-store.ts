/**
 * `AesGcmSecretStore` : chiffrement applicatif AES-256-GCM avec trousseau de clés maîtres d'environnement.
 *
 *   FINANCE_SECRETS_KEYS="k2:<base64 de 32 octets>,k1:<base64 de 32 octets>"
 *   FINANCE_SECRETS_ACTIVE_KEY="k2"        (défaut : la première clé du trousseau)
 *
 * Enveloppe : `v1.<kid>.<iv>.<chiffré>.<tag>` (base64url ; IV de 12 octets aléatoires, tag de 16). Les données
 * authentifiées (AAD) sont `finance-secret|v1|<tenant>|<fournisseur>|<champ>` : modifier l'enveloppe, la déplacer
 * vers un autre tenant ou un autre champ fait échouer l'ouverture (`tampered`).
 *
 * Rotation : ajouter la nouvelle clé EN TÊTE (ou la déclarer active) puis rechiffrer (`isCurrent` + `seal`). Une
 * clé retirée du trousseau rend ses enveloppes illisibles (`unknown_key`) : ne la retirer qu'après rechiffrement.
 *
 * Aucune erreur ne contient de clair ni de clé ; aucune clé n'est journalisée.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SecretStoreError, type SecretScope, type SecretStorePort } from "../../application/ports/secret-store";

const VERSION = "v1";
const KEY_ID_RE = /^[A-Za-z0-9]{1,16}$/;
export const ENVELOPE_RE = /^v1\.[A-Za-z0-9]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;

const b64u = (b: Buffer): string => b.toString("base64url");

const aadOf = (s: SecretScope): Buffer => Buffer.from(`finance-secret|${VERSION}|${s.tenantId}|${s.provider}|${s.field}`, "utf8");

export interface AesGcmKeyring {
  readonly keys: ReadonlyMap<string, Buffer>;
  readonly activeKeyId: string;
}

/** Lit le trousseau ; lève `Error` (sans clé dans le message) si la configuration est invalide. */
export function parseKeyring(keysSpec: string | undefined, activeKeyId?: string): AesGcmKeyring | null {
  if (!keysSpec || keysSpec.trim() === "") return null;
  const keys = new Map<string, Buffer>();
  for (const part of keysSpec.split(",")) {
    const idx = part.indexOf(":");
    const kid = idx > 0 ? part.slice(0, idx).trim() : "";
    const material = idx > 0 ? part.slice(idx + 1).trim() : "";
    if (!KEY_ID_RE.test(kid)) throw new Error("FINANCE_SECRETS_KEYS : identifiant de clé invalide (alphanumérique, 16 max).");
    const raw = Buffer.from(material, "base64");
    if (raw.length !== 32) throw new Error(`FINANCE_SECRETS_KEYS : la clé "${kid}" doit faire exactement 32 octets (base64).`);
    if (keys.has(kid)) throw new Error(`FINANCE_SECRETS_KEYS : identifiant de clé en double "${kid}".`);
    keys.set(kid, raw);
  }
  const active = activeKeyId?.trim() || [...keys.keys()][0]!;
  if (!keys.has(active)) throw new Error("FINANCE_SECRETS_ACTIVE_KEY : clé active absente du trousseau.");
  return { keys, activeKeyId: active };
}

export class AesGcmSecretStore implements SecretStorePort {
  readonly available = true;
  readonly activeKeyId: string;
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(keyring: AesGcmKeyring) {
    this.keys = keyring.keys;
    this.activeKeyId = keyring.activeKeyId;
  }

  async seal(scope: SecretScope, plaintext: string): Promise<string> {
    const key = this.keys.get(this.activeKeyId);
    if (!key) throw new SecretStoreError("unknown_key");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aadOf(scope));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, this.activeKeyId, b64u(iv), b64u(ct), b64u(cipher.getAuthTag())].join(".");
  }

  async open(scope: SecretScope, envelope: string): Promise<string> {
    if (!ENVELOPE_RE.test(envelope)) throw new SecretStoreError("malformed");
    const [, kid, iv, ct, tag] = envelope.split(".") as [string, string, string, string, string];
    const key = this.keys.get(kid);
    if (!key) throw new SecretStoreError("unknown_key");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(aadOf(scope));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretStoreError("tampered");
    }
  }

  isCurrent(envelope: string): boolean {
    return ENVELOPE_RE.test(envelope) && envelope.split(".")[1] === this.activeKeyId;
  }
}

/** Coffre INDISPONIBLE (aucune clé maître) : tout est refusé, jamais de repli en clair. */
export const unavailableSecretStore: SecretStorePort = Object.freeze({
  available: false,
  activeKeyId: null,
  async seal(): Promise<string> {
    throw new SecretStoreError("unavailable");
  },
  async open(): Promise<string> {
    throw new SecretStoreError("unavailable");
  },
  isCurrent(): boolean {
    return false;
  },
});

/** Coffre depuis l'environnement ; configuration invalide ⇒ indisponible (et `onInvalid` informé, sans matériau de clé). */
export function secretStoreFromEnv(env: Readonly<Record<string, string | undefined>>, onInvalid?: (message: string) => void): SecretStorePort {
  try {
    const ring = parseKeyring(env.FINANCE_SECRETS_KEYS, env.FINANCE_SECRETS_ACTIVE_KEY);
    return ring ? new AesGcmSecretStore(ring) : unavailableSecretStore;
  } catch (e) {
    onInvalid?.(e instanceof Error ? e.message : "configuration du coffre invalide");
    return unavailableSecretStore;
  }
}
