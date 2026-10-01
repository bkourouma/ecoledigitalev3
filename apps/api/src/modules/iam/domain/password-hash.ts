/**
 * Hachage des mots de passe : scrypt (node:crypto) + vérification des hashes
 * bcrypt LEGACY avec re-hachage transparent.
 *
 * Format scrypt (inspiré PHC, paramètres ENCODÉS dans le hash, donc évolutifs) :
 *
 *     $scrypt$ln=16,r=8,p=1$<sel base64url>$<dérivé base64url>
 *
 *  - sel de 16 octets aléatoires, dérivé de 32 octets ;
 *  - comparaison à TEMPS CONSTANT (`timingSafeEqual`) ;
 *  - à la vérification, les paramètres lus dans le hash sont BORNÉS avant tout
 *    calcul (un hash corrompu ne doit pas pouvoir allouer des Go de mémoire) ;
 *  - `needsRehash` signale un hash bcrypt ou scrypt plus faible que la config
 *    courante : l'appelant le re-calcule après un login réussi.
 *
 * Concurrence : scrypt travaille dans le pool de threads libuv (4 par défaut) et
 * alloue 128·N·r octets (64 Mio pour N=2^16, r=8). Un sémaphore borne le nombre
 * de dérivations simultanées pour qu'un afflux de tentatives ne puisse pas
 * épuiser la mémoire du processus.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { ScryptParams } from "../config";

const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** Octets maximum acceptés pour un mot de passe (évite le hachage de corps géants). */
export const MAX_PASSWORD_BYTES = 1024;

const LOG_N_MIN = 10;
const LOG_N_MAX = 20;
const R_MAX = 16;
const P_MAX = 4;

export type HashKind = "scrypt" | "bcrypt" | "unknown";

export interface ParsedScrypt {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

export function hashKind(hash: string): HashKind {
  if (hash.startsWith("$scrypt$")) return "scrypt";
  if (/^\$2[abxy]\$\d{2}\$/.test(hash)) return "bcrypt";
  return "unknown";
}

export function parseScryptHash(hash: string): ParsedScrypt | null {
  const parts = hash.split("$");
  // ["", "scrypt", "ln=..,r=..,p=..", salt, key]
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "scrypt") return null;
  const m = /^ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})$/.exec(parts[2] ?? "");
  if (!m) return null;
  const logN = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  if (logN < LOG_N_MIN || logN > LOG_N_MAX || r < 1 || r > R_MAX || p < 1 || p > P_MAX) return null;
  const b64 = /^[A-Za-z0-9_-]+$/;
  if (!b64.test(parts[3] ?? "") || !b64.test(parts[4] ?? "")) return null;
  const salt = Buffer.from(parts[3] as string, "base64url");
  const key = Buffer.from(parts[4] as string, "base64url");
  if (salt.length < 8 || salt.length > 64 || key.length < 16 || key.length > 128) return null;
  return { params: { logN, r, p }, salt, key };
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

function derive(password: Buffer, salt: Buffer, params: ScryptParams, keyLen: number): Promise<Buffer> {
  const N = 2 ** params.logN;
  // maxmem : 128·N·r (+ marge) ; Node refuse sinon au-delà de 32 Mio.
  const maxmem = 128 * N * params.r * 2 + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N, r: params.r, p: params.p, maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export interface VerifyResult {
  ok: boolean;
  /** Vrai si le mot de passe est correct ET que le hash doit être recalculé. */
  needsRehash: boolean;
}

export interface PasswordHasherOptions {
  params: ScryptParams;
  /** Dérivations scrypt simultanées maximum. */
  maxConcurrency?: number;
}

export class PasswordHasher {
  private readonly params: ScryptParams;
  private readonly gate: Semaphore;
  private dummy: Promise<string> | null = null;

  constructor(options: PasswordHasherOptions) {
    this.params = options.params;
    this.gate = new Semaphore(options.maxConcurrency ?? 4);
  }

  private normalize(password: string): Buffer | null {
    // NFKC : « é » composé ou décomposé donne le même hash (portabilité clavier/OS).
    const buf = Buffer.from(password.normalize("NFKC"), "utf8");
    return buf.length === 0 || buf.length > MAX_PASSWORD_BYTES ? null : buf;
  }

  async hash(password: string): Promise<string> {
    const buf = this.normalize(password);
    if (!buf) throw new RangeError("Mot de passe vide ou trop long.");
    const salt = randomBytes(SALT_BYTES);
    const key = await this.gate.run(() => derive(buf, salt, this.params, KEY_BYTES));
    return `$scrypt$ln=${this.params.logN},r=${this.params.r},p=${this.params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  }

  async verify(storedHash: string | null | undefined, password: string): Promise<VerifyResult> {
    const buf = this.normalize(password);
    if (!storedHash || !buf) {
      await this.verifyDummy(password);
      return { ok: false, needsRehash: false };
    }
    switch (hashKind(storedHash)) {
      case "scrypt": {
        const parsed = parseScryptHash(storedHash);
        if (!parsed) {
          await this.verifyDummy(password);
          return { ok: false, needsRehash: false };
        }
        const key = await this.gate.run(() => derive(buf, parsed.salt, parsed.params, parsed.key.length));
        const ok = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
        return { ok, needsRehash: ok && this.isWeaker(parsed.params) };
      }
      case "bcrypt": {
        // Legacy : le mot de passe est comparé tel quel (bcrypt tronque à 72 octets, comportement historique conservé).
        let ok = false;
        try {
          ok = await bcrypt.compare(password, storedHash);
        } catch {
          ok = false;
        }
        return { ok, needsRehash: ok };
      }
      default:
        await this.verifyDummy(password);
        return { ok: false, needsRehash: false };
    }
  }

  /**
   * Calcul factice de même coût qu'une vérification réelle : appelé quand
   * l'identité n'existe pas, pour que « e-mail inconnu » et « mot de passe
   * faux » prennent le même temps.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= (async () => this.hash("dummy-password-for-timing-equalisation"))();
    const dummyHash = await this.dummy;
    const parsed = parseScryptHash(dummyHash) as ParsedScrypt;
    const buf = this.normalize(password) ?? Buffer.from("x");
    const key = await this.gate.run(() => derive(buf, parsed.salt, parsed.params, parsed.key.length));
    // Comparaison réelle (résultat ignoré) pour garder le même chemin de code.
    timingSafeEqual(key, parsed.key);
  }

  private isWeaker(p: ScryptParams): boolean {
    return p.logN < this.params.logN || p.r < this.params.r || p.p < this.params.p;
  }
}
