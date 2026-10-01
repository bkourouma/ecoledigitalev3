import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { ManualClock } from "@ecoledigitale/kernel";
import { InMemoryStorage } from "../../infrastructure/storage-memory";
import { S3Storage, s3ConfigFromEnv, safeFileName } from "../../infrastructure/storage-s3";

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

describe("StoragePort — adaptateur mémoire", () => {
  it("put / get / exists ; empreinte SHA-256 et taille renvoyées ; copie défensive", async () => {
    const s = new InMemoryStorage();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(await s.put("a/b.pdf", bytes, { contentType: "application/pdf" })).toEqual({ sha256: sha(bytes), size: 4 });
    bytes[0] = 99; // l'appelant modifie son tampon : l'objet stocké ne bouge pas
    expect((await s.get("a/b.pdf"))!.bytes[0]).toBe(1);
    expect(await s.exists("a/b.pdf")).toBe(true);
    expect(await s.exists("nope")).toBe(false);
    expect(await s.get("nope")).toBeNull();
  });

  it("URL signées : expiration, altération, dépôt (PUT) signé distinct de la lecture", async () => {
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");
    const s = new InMemoryStorage(clock);
    await s.put("k.pdf", new Uint8Array([1]), { contentType: "application/pdf" });
    const { url, expiresAt } = await s.signedUrl("k.pdf", { ttlSeconds: 300 });
    expect(expiresAt.toISOString()).toBe("2026-01-01T00:05:00.000Z");
    expect(s.verifySignedUrl(url)).toEqual({ ok: true, key: "k.pdf" });
    expect(s.verifySignedUrl(url.replace("k.pdf", "autre.pdf"))).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(s.verifySignedUrl("http://x")).toEqual({ ok: false, reason: "malformed" });
    clock.advance(301_000);
    expect(s.verifySignedUrl(url)).toEqual({ ok: false, reason: "expired" });
    // Le lien de dépôt n'ouvre pas la lecture et inversement.
    clock.set("2026-01-01T00:00:00.000Z");
    const up = await s.signedUploadUrl("logo.png", { ttlSeconds: 60, contentType: "image/png", maxBytes: 100 });
    expect(s.verifySignedUrl(up.url).ok).toBe(false);
    expect(s.acceptUpload(url, new Uint8Array([1]), "image/png")).toBe(false);
    expect(s.acceptUpload(up.url, new Uint8Array([7]), "image/png")).toBe(true);
    expect((await s.get("logo.png"))!.bytes[0]).toBe(7);
    clock.advance(61_000);
    expect(s.acceptUpload(up.url, new Uint8Array([8]), "image/png")).toBe(false);
  });
});

/** Faux client S3 : enregistre les commandes émises et simule un magasin d'objets. */
function fakeS3() {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();
  const sent: unknown[] = [];
  const client = {
    async send(command: any) {
      sent.push(command);
      const input = command.input;
      if (command instanceof PutObjectCommand) {
        store.set(input.Key, { body: input.Body, contentType: input.ContentType });
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const o = store.get(input.Key);
        if (!o) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => o.body }, ContentType: o.contentType };
      }
      if (command instanceof HeadObjectCommand) {
        if (!store.has(input.Key)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        store.delete(input.Key);
        return {};
      }
      throw new Error("commande inattendue");
    },
  };
  return { client, store, sent };
}

describe("StoragePort — adaptateur S3 / MinIO (client injecté)", () => {
  const signer = async (_c: unknown, command: any, o: { expiresIn: number }) => `https://s3.example.test/${command.input.Bucket}/${command.input.Key}?X-Amz-Expires=${o.expiresIn}&cd=${encodeURIComponent(command.input.ResponseContentDisposition ?? "")}`;

  it("put : chiffrement au repos SSE-S3 par défaut, type de contenu, empreinte en métadonnée ; get / exists ; 404 -> null / false", async () => {
    const f = fakeS3();
    const s = new S3Storage({ client: f.client, bucket: "bulletins", signer });
    const bytes = new TextEncoder().encode("%PDF-1.4 test");
    expect(await s.put("t/1.pdf", bytes, { contentType: "application/pdf" })).toEqual({ sha256: sha(bytes), size: bytes.length });
    const put = f.sent[0] as PutObjectCommand;
    expect(put.input).toMatchObject({ Bucket: "bulletins", Key: "t/1.pdf", ContentType: "application/pdf", ServerSideEncryption: "AES256", ContentLength: bytes.length, Metadata: { sha256: sha(bytes) } });
    expect((await s.get("t/1.pdf"))!.contentType).toBe("application/pdf");
    expect(await s.exists("t/1.pdf")).toBe(true);
    expect(await s.exists("t/2.pdf")).toBe(false);
    expect(await s.get("t/2.pdf")).toBeNull();
  });

  it("MinIO de développement : chiffrement désactivable ; KMS avec clé ; préfixe d'environnement", async () => {
    const f = fakeS3();
    await new S3Storage({ client: f.client, bucket: "b", serverSideEncryption: null }).put("k", new Uint8Array([1]), { contentType: "x/y" });
    expect((f.sent[0] as PutObjectCommand).input.ServerSideEncryption).toBeUndefined();
    const g = fakeS3();
    await new S3Storage({ client: g.client, bucket: "b", serverSideEncryption: "aws:kms", kmsKeyId: "alias/bulletins", keyPrefix: "prod/" }).put("k", new Uint8Array([1]), { contentType: "x/y" });
    expect((g.sent[0] as PutObjectCommand).input).toMatchObject({ Key: "prod/k", ServerSideEncryption: "aws:kms", SSEKMSKeyId: "alias/bulletins" });
  });

  it("URL signée de lecture : durée plafonnée à 5 min, Content-Disposition attachment assaini", async () => {
    const s = new S3Storage({ client: fakeS3().client, bucket: "b", signer });
    const { url, expiresAt } = await s.signedUrl("t/1.pdf", { ttlSeconds: 86_400, fileName: 'bulletin "é"; \r\nX: 1.pdf', contentType: "application/pdf" });
    expect(url).toContain("X-Amz-Expires=300");
    expect(decodeURIComponent(url)).toContain('attachment; filename="bulletin_X_1.pdf"');
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_500);
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("")).toBe("document.pdf");
    const up = await s.signedUploadUrl("assets/logo.png", { ttlSeconds: 9999, contentType: "image/png", maxBytes: 1 });
    expect(up.url).toContain("X-Amz-Expires=300");
    expect(up.headers).toMatchObject({ "Content-Type": "image/png", "x-amz-server-side-encryption": "AES256" });
  });

  it("refuse les clés d'objet dangereuses (traversée, absolue, contrôles)", async () => {
    const s = new S3Storage({ client: fakeS3().client, bucket: "b", signer });
    for (const bad of ["../x", "/abs", "a/../b", "a\u0000b", ""]) {
      await expect(s.put(bad, new Uint8Array([1]), { contentType: "x/y" }), JSON.stringify(bad)).rejects.toThrow(/Clé d'objet invalide/);
    }
  });

  it("autres erreurs (réseau, droits) : propagées, jamais confondues avec « absent »", async () => {
    const s = new S3Storage({ client: { send: async () => { throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }); } }, bucket: "b", signer });
    await expect(s.get("k")).rejects.toThrow(/AccessDenied/);
    await expect(s.exists("k")).rejects.toThrow(/AccessDenied/);
  });

  it("configuration depuis l'environnement : bucket obligatoire, MinIO par endpoint, SSE réglable — aucun secret en dur", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(s3ConfigFromEnv({ REPORTCARDS_S3_BUCKET: "b" })).toMatchObject({ bucket: "b", region: "us-east-1", forcePathStyle: false, serverSideEncryption: "AES256", keyPrefix: "" });
    expect(s3ConfigFromEnv({ REPORTCARDS_S3_BUCKET: "b", REPORTCARDS_S3_ENDPOINT: "http://127.0.0.1:9000", REPORTCARDS_S3_SSE: "none", REPORTCARDS_S3_ACCESS_KEY_ID: "id", REPORTCARDS_S3_SECRET_ACCESS_KEY: "secret" })).toMatchObject({
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      serverSideEncryption: null,
      accessKeyId: "id",
    });
    expect(s3ConfigFromEnv({ REPORTCARDS_S3_BUCKET: "b", REPORTCARDS_S3_SSE: "aws:kms", REPORTCARDS_S3_KMS_KEY_ID: "k" })).toMatchObject({ serverSideEncryption: "aws:kms", kmsKeyId: "k" });
  });
});
