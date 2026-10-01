/**
 * Stockage d'objets de la plateforme (`StoragePort`) : S3 / MinIO réel, configurable par l'environnement, avec REPLI DISQUE
 * pour le développement. Aucun secret dans le dépôt.
 *
 *   STORAGE_S3_BUCKET                  bucket (active S3 / MinIO) — repli : REPORTCARDS_S3_BUCKET
 *   STORAGE_S3_REGION                  défaut `us-east-1`
 *   STORAGE_S3_ENDPOINT                MinIO (force le style « chemin »)
 *   STORAGE_S3_FORCE_PATH_STYLE        `true` pour imposer le style chemin
 *   STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY   sinon la chaîne d'identifiants AWS par défaut
 *   STORAGE_S3_SSE                     `AES256` (défaut), `aws:kms`, `none` (MinIO de développement sans KMS)
 *   STORAGE_S3_KMS_KEY_ID, STORAGE_S3_PREFIX
 *   STORAGE_DISK_DIR                   dossier du repli disque (obligatoire hors développement pour l'activer)
 *   STORAGE_PUBLIC_BASE_URL            base des URL signées du repli disque (défaut `http://localhost:<PORT|3001>`)
 *   STORAGE_SIGNING_SECRET             secret des URL signées du repli disque (≥ 16 car.) ; absent : secret aléatoire PAR PROCESSUS
 *
 * Chaque variable `STORAGE_S3_*` retombe sur son homologue historique `REPORTCARDS_S3_*` (déploiements existants).
 * Ordre de choix : S3 si un bucket est configuré ; sinon disque si `STORAGE_DISK_DIR` est défini ou si `NODE_ENV` n'est pas
 * `production` (défaut `./.data/objects`) ; sinon AUCUN stockage (les fonctions qui en dépendent échouent fermé).
 *
 * Le repli disque n'est pas un stockage de production : pas de réplication, URL signées servies par l'API elle-même
 * (`GET /api/v1/storage/object?token=…`, publique, jeton HMAC à durée courte, clé confinée au dossier racine).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { s3StorageFromEnv, type StorageObject, type StoragePort as ReportcardsStoragePort } from "../../modules/reportcards";
import type { StoragePort as AttendanceStoragePort } from "../../modules/attendance";
import type { StoragePort as PeopleStoragePort } from "../../modules/people";

/** Port de base de la plateforme : celui de `reportcards` (le plus complet) + suppression. */
export interface ObjectStorage extends ReportcardsStoragePort {
  readonly driver: "s3" | "disk";
  delete(key: string): Promise<void>;
}

export type Env = Readonly<Record<string, string | undefined>>;

const S3_SUFFIXES = ["BUCKET", "REGION", "ENDPOINT", "FORCE_PATH_STYLE", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "SSE", "KMS_KEY_ID", "PREFIX"] as const;

/** `STORAGE_S3_*` d'abord, puis `REPORTCARDS_S3_*` : le même environnement alimente l'adaptateur S3 existant. */
export function s3EnvFrom(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const s of S3_SUFFIXES) out[`REPORTCARDS_S3_${s}`] = env[`STORAGE_S3_${s}`]?.trim() || env[`REPORTCARDS_S3_${s}`]?.trim() || undefined;
  return out;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}$/;

export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.endsWith(".meta.json")) throw new Error("Clé d'objet invalide.");
}

export interface DiskStorageOptions {
  rootDir: string;
  publicBaseUrl: string;
  signingSecret: string;
  now?: () => Date;
}

interface DiskToken {
  k: string;
  e: number;
  f?: string;
  c?: string;
}

const b64 = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/** Repli disque du développement : mêmes garanties de clé que S3, URL signées par HMAC servies par l'API. */
export class DiskStorage implements ObjectStorage {
  readonly driver = "disk" as const;
  private readonly root: string;
  private readonly now: () => Date;
  constructor(private readonly options: DiskStorageOptions) {
    this.root = resolve(options.rootDir);
    this.now = options.now ?? (() => new Date());
  }

  private pathOf(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error("Clé d'objet invalide.");
    return full;
  }

  async put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<{ sha256: string; size: number }> {
    const full = this.pathOf(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    await writeFile(`${full}.meta.json`, JSON.stringify({ contentType: options.contentType }));
    return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  }

  async get(key: string): Promise<StorageObject | null> {
    const full = this.pathOf(key);
    try {
      const bytes = await readFile(full);
      let contentType: string | null = null;
      try {
        contentType = (JSON.parse(await readFile(`${full}.meta.json`, "utf8")) as { contentType?: string }).contentType ?? null;
      } catch {
        /* pas de métadonnées : type inconnu */
      }
      return { bytes: new Uint8Array(bytes), contentType };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(key))).isFile();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.pathOf(key);
    await rm(full, { force: true });
    await rm(`${full}.meta.json`, { force: true });
  }

  private sign(payload: string): string {
    return b64(createHmac("sha256", this.options.signingSecret).update(payload).digest());
  }

  async signedUrl(key: string, options: { ttlSeconds: number; fileName?: string; contentType?: string }): Promise<{ url: string; expiresAt: Date }> {
    assertSafeKey(key);
    const ttl = Math.min(Math.max(Math.floor(options.ttlSeconds), 1), 300);
    const expiresAt = new Date(this.now().getTime() + ttl * 1000);
    const token: DiskToken = { k: key, e: expiresAt.getTime(), ...(options.fileName ? { f: options.fileName } : {}), ...(options.contentType ? { c: options.contentType } : {}) };
    const payload = b64(JSON.stringify(token));
    return { url: `${this.options.publicBaseUrl.replace(/\/+$/, "")}/api/v1/storage/object?token=${payload}.${this.sign(payload)}`, expiresAt };
  }

  /** Vérifie un jeton (signature en temps constant, expiration) et renvoie son contenu, sinon `null`. */
  verifyToken(token: string): DiskToken | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DiskToken;
      if (typeof t.k !== "string" || typeof t.e !== "number" || t.e < this.now().getTime()) return null;
      assertSafeKey(t.k);
      return t;
    } catch {
      return null;
    }
  }
}

export interface StorageFromEnvOptions {
  /** Journal d'avertissement (repli disque actif, secret aléatoire). */
  warn?: (message: string) => void;
}

/** Choisit l'adaptateur selon l'environnement (voir l'en-tête). `null` : aucun stockage disponible. */
export function createObjectStorage(env: Env, options: StorageFromEnvOptions = {}): ObjectStorage | null {
  const s3 = s3StorageFromEnv(s3EnvFrom(env));
  if (s3) return Object.assign(s3, { driver: "s3" as const });
  const production = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const dir = env.STORAGE_DISK_DIR?.trim() || (production ? "" : "./.data/objects");
  if (!dir) return null;
  const configured = env.STORAGE_SIGNING_SECRET?.trim();
  if (configured && configured.length < 16) throw new Error("STORAGE_SIGNING_SECRET doit compter au moins 16 caractères.");
  const secret = configured || randomBytes(32).toString("hex");
  options.warn?.(
    `stockage d'objets : repli DISQUE (${dir}) — réservé au développement${configured ? "" : " ; secret d'URL signées aléatoire par processus"}. Configurez STORAGE_S3_BUCKET pour S3 / MinIO.`,
  );
  return new DiskStorage({ rootDir: dir, publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL?.trim() || `http://localhost:${env.PORT?.trim() || "3001"}`, signingSecret: secret });
}

/** `GET /api/v1/storage/object?token=…` : sert un objet du repli disque ; publique (le jeton signé fait foi), `no-store`. */
export function registerDiskStorageRoute(app: FastifyInstance, storage: DiskStorage): void {
  app.get("/api/v1/storage/object", { config: { public: true } }, async (request, reply) => {
    const token = typeof (request.query as { token?: unknown }).token === "string" ? ((request.query as { token: string }).token) : "";
    const t = storage.verifyToken(token);
    if (!t) return reply.code(404).send({ error: { code: "storage.not_found", message: "Lien invalide ou expiré." } });
    const object = await storage.get(t.k);
    if (!object) return reply.code(404).send({ error: { code: "storage.not_found", message: "Lien invalide ou expiré." } });
    const fileName = (t.f ?? t.k.split("/").pop() ?? "document").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "document";
    reply
      .header("Content-Type", t.c ?? object.contentType ?? "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(Buffer.from(object.bytes));
  });
}

// ---------------------------------------------------------------------------
// Vues du stockage pour les modules qui ont leur propre forme de port
// ---------------------------------------------------------------------------

/** `attendance` : `put` sans empreinte, URL signée avec durée en secondes. */
export function asAttendanceStorage(storage: ObjectStorage): AttendanceStoragePort {
  return {
    async put(key, data, options) {
      await storage.put(key, data, options);
    },
    delete: (key) => storage.delete(key),
    signedUrl: (key, ttlSeconds) => storage.signedUrl(key, { ttlSeconds }),
  };
}

/** `people` : `put` sans empreinte, URL signée = chaîne. */
export function asPeopleStorage(storage: ObjectStorage): PeopleStoragePort {
  return {
    async put(key, bytes, options) {
      await storage.put(key, bytes, options);
    },
    delete: (key) => storage.delete(key),
    async signedUrl(key, options) {
      return (await storage.signedUrl(key, { ttlSeconds: options.ttlSec })).url;
    },
  };
}
