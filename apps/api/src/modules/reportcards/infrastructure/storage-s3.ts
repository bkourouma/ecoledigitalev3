/**
 * Adaptateur S3 / MinIO du `StoragePort` (`@aws-sdk/client-s3`, déjà dépendance de l'API).
 *
 *  - chiffrement au repos : `ServerSideEncryption: AES256` par défaut (SSE-S3) ; désactivable pour un MinIO sans KMS
 *    (`serverSideEncryption: null`) — en production le chiffrement du bucket reste exigé (spec 013 §13) ;
 *  - URL signées de lecture à durée courte, avec `Content-Disposition: attachment` (nom de fichier assaini) ;
 *  - MinIO : `forcePathStyle: true` et `endpoint` ; les identifiants viennent de l'environnement / du gestionnaire de secrets,
 *    jamais du dépôt (voir `s3StorageFromEnv`).
 *
 * Le client et le signataire d'URL sont INJECTABLES : les tests vérifient les commandes émises sans réseau, et le test
 * d'intégration (MinIO éphémère, conditionnel) exerce l'adaptateur réel.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sha256Hex } from "../domain/canonical";
import type { StorageObject, StoragePort } from "../application/ports";

export interface S3Like {
  send(command: unknown): Promise<any>;
}

export type UrlSigner = (client: any, command: any, options: { expiresIn: number }) => Promise<string>;

export interface S3StorageOptions {
  client: S3Like;
  bucket: string;
  /** Défaut `AES256`. `null` : aucun en-tête de chiffrement (MinIO de développement). */
  serverSideEncryption?: "AES256" | "aws:kms" | null;
  kmsKeyId?: string;
  /** Préfixe de toutes les clés (isolation par environnement). */
  keyPrefix?: string;
  signer?: UrlSigner;
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.Code === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
};

/** Nom de fichier assaini pour l'en-tête `Content-Disposition`. */
export const safeFileName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 100) || "document.pdf";

export class S3Storage implements StoragePort {
  private readonly signer: UrlSigner;
  constructor(private readonly options: S3StorageOptions) {
    this.signer = options.signer ?? (getSignedUrl as unknown as UrlSigner);
  }

  private key(k: string): string {
    if (!k || k.startsWith("/") || k.includes("..") || /[\u0000-\u001f]/.test(k)) throw new Error("Clé d'objet invalide.");
    return `${this.options.keyPrefix ?? ""}${k}`;
  }

  async put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<{ sha256: string; size: number }> {
    const sha256 = sha256Hex(bytes);
    const sse = this.options.serverSideEncryption === undefined ? "AES256" : this.options.serverSideEncryption;
    await this.options.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.key(key),
        Body: bytes,
        ContentType: options.contentType,
        ContentLength: bytes.length,
        ...(sse ? { ServerSideEncryption: sse, ...(sse === "aws:kms" && this.options.kmsKeyId ? { SSEKMSKeyId: this.options.kmsKeyId } : {}) } : {}),
        Metadata: { sha256 },
      }),
    );
    return { sha256, size: bytes.length };
  }

  async get(key: string): Promise<StorageObject | null> {
    try {
      const res = await this.options.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.key(key) }));
      const body = res.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
      if (!body) return null;
      return { bytes: await body.transformToByteArray(), contentType: (res.ContentType as string | undefined) ?? null };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.options.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: this.key(key) }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async signedUrl(key: string, options: { ttlSeconds: number; fileName?: string; contentType?: string }): Promise<{ url: string; expiresAt: Date }> {
    const ttl = Math.min(Math.max(Math.floor(options.ttlSeconds), 1), 300);
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: this.key(key),
      ResponseContentDisposition: `attachment; filename="${safeFileName(options.fileName ?? "document.pdf")}"`,
      ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
    });
    const url = await this.signer(this.options.client, command, { expiresIn: ttl });
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async signedUploadUrl(key: string, options: { ttlSeconds: number; contentType: string; maxBytes: number }): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }> {
    const ttl = Math.min(Math.max(Math.floor(options.ttlSeconds), 1), 300);
    const sse = this.options.serverSideEncryption === undefined ? "AES256" : this.options.serverSideEncryption;
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: this.key(key),
      ContentType: options.contentType,
      ...(sse ? { ServerSideEncryption: sse } : {}),
    });
    const url = await this.signer(this.options.client, command, { expiresIn: ttl });
    return { url, expiresAt: new Date(Date.now() + ttl * 1000), headers: { "Content-Type": options.contentType, ...(sse ? { "x-amz-server-side-encryption": sse } : {}) } };
  }

  /** Suppression technique (tests, nettoyage d'un objet orphelin). Jamais appelée sur un objet référencé par un snapshot. */
  async delete(key: string): Promise<void> {
    await this.options.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.key(key) }));
  }
}

export interface S3EnvConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  serverSideEncryption: "AES256" | "aws:kms" | null;
  kmsKeyId?: string;
  keyPrefix: string;
}

/**
 * Configuration depuis l'environnement (aucun secret dans le dépôt). Variables : `REPORTCARDS_S3_BUCKET` (obligatoire),
 * `REPORTCARDS_S3_REGION` (défaut `us-east-1`), `REPORTCARDS_S3_ENDPOINT` (MinIO), `REPORTCARDS_S3_FORCE_PATH_STYLE`,
 * `REPORTCARDS_S3_ACCESS_KEY_ID` / `REPORTCARDS_S3_SECRET_ACCESS_KEY` (sinon la chaîne d'identifiants AWS par défaut),
 * `REPORTCARDS_S3_SSE` (`AES256` par défaut, `aws:kms`, `none`), `REPORTCARDS_S3_KMS_KEY_ID`, `REPORTCARDS_S3_PREFIX`.
 * Retourne `null` si le bucket n'est pas configuré.
 */
export function s3ConfigFromEnv(env: Readonly<Record<string, string | undefined>>): S3EnvConfig | null {
  const bucket = env.REPORTCARDS_S3_BUCKET?.trim();
  if (!bucket) return null;
  const sse = env.REPORTCARDS_S3_SSE?.trim();
  return {
    bucket,
    region: env.REPORTCARDS_S3_REGION?.trim() || "us-east-1",
    ...(env.REPORTCARDS_S3_ENDPOINT?.trim() ? { endpoint: env.REPORTCARDS_S3_ENDPOINT.trim() } : {}),
    forcePathStyle: env.REPORTCARDS_S3_FORCE_PATH_STYLE === "true" || Boolean(env.REPORTCARDS_S3_ENDPOINT?.trim()),
    ...(env.REPORTCARDS_S3_ACCESS_KEY_ID && env.REPORTCARDS_S3_SECRET_ACCESS_KEY
      ? { accessKeyId: env.REPORTCARDS_S3_ACCESS_KEY_ID, secretAccessKey: env.REPORTCARDS_S3_SECRET_ACCESS_KEY }
      : {}),
    serverSideEncryption: sse === "none" ? null : sse === "aws:kms" ? "aws:kms" : "AES256",
    ...(env.REPORTCARDS_S3_KMS_KEY_ID ? { kmsKeyId: env.REPORTCARDS_S3_KMS_KEY_ID } : {}),
    keyPrefix: env.REPORTCARDS_S3_PREFIX?.trim() ?? "",
  };
}

export function s3StorageFromEnv(env: Readonly<Record<string, string | undefined>>): S3Storage | null {
  const c = s3ConfigFromEnv(env);
  if (!c) return null;
  const client = new S3Client({
    region: c.region,
    ...(c.endpoint ? { endpoint: c.endpoint } : {}),
    forcePathStyle: c.forcePathStyle,
    ...(c.accessKeyId && c.secretAccessKey ? { credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } } : {}),
  });
  return new S3Storage({ client, bucket: c.bucket, serverSideEncryption: c.serverSideEncryption, ...(c.kmsKeyId ? { kmsKeyId: c.kmsKeyId } : {}), keyPrefix: c.keyPrefix });
}
