/**
 * Adaptateur S3 / MinIO contre un VRAI serveur (conditionnel : ignoré sans variables d'environnement).
 *
 *   docker run -d --name ed-rc-minio -p 127.0.0.1:59000:9000 -e MINIO_ROOT_USER=<identifiant> -e MINIO_ROOT_PASSWORD=<mot-de-passe-local> \
 *     minio/minio server /data
 *   REPORTCARDS_TEST_S3_ENDPOINT=http://127.0.0.1:59000 REPORTCARDS_TEST_S3_BUCKET=bulletins-test \
 *   REPORTCARDS_TEST_S3_ACCESS_KEY=<identifiant> REPORTCARDS_TEST_S3_SECRET_KEY=<mot-de-passe-local> pnpm --filter @ecoledigitale/api exec vitest run src/modules/reportcards/test/integration/s3-live.test.ts
 *
 * Le bucket est créé s'il manque. Le chiffrement SSE est désactivé (un MinIO de développement n'a pas de KMS).
 */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { S3Storage } from "../../infrastructure/storage-s3";

const endpoint = process.env.REPORTCARDS_TEST_S3_ENDPOINT;
const bucket = process.env.REPORTCARDS_TEST_S3_BUCKET;
const accessKeyId = process.env.REPORTCARDS_TEST_S3_ACCESS_KEY;
const secretAccessKey = process.env.REPORTCARDS_TEST_S3_SECRET_KEY;
const enabled = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
if (!enabled) console.warn("[reportcards] REPORTCARDS_TEST_S3_* absentes : le test S3/MinIO RÉEL est IGNORÉ (l'adaptateur reste testé avec un client injecté).");

describe.skipIf(!enabled)("S3Storage contre un serveur S3 / MinIO réel", () => {
  let storage: S3Storage;
  const prefix = `it-${newId()}/`;

  beforeAll(async () => {
    const client = new S3Client({ region: "us-east-1", endpoint: endpoint!, forcePathStyle: true, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } });
    await client.send(new HeadBucketCommand({ Bucket: bucket! })).catch(() => client.send(new CreateBucketCommand({ Bucket: bucket! })));
    storage = new S3Storage({ client, bucket: bucket!, serverSideEncryption: null, keyPrefix: prefix });
  });
  afterAll(async () => {
    await storage?.delete("a.pdf").catch(() => undefined);
  });

  it("put / get / exists / URL signée de lecture (téléchargeable) / URL signée de dépôt", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 contenu de test");
    const put = await storage.put("a.pdf", bytes, { contentType: "application/pdf" });
    expect(put.size).toBe(bytes.length);
    expect(await storage.exists("a.pdf")).toBe(true);
    expect(await storage.exists("absent.pdf")).toBe(false);
    expect(await storage.get("absent.pdf")).toBeNull();
    expect(Buffer.from((await storage.get("a.pdf"))!.bytes).toString()).toContain("%PDF");
    const { url } = await storage.signedUrl("a.pdf", { ttlSeconds: 60, fileName: "bulletin.pdf", contentType: "application/pdf" });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="bulletin.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toContain("%PDF");
    const up = await storage.signedUploadUrl("b.png", { ttlSeconds: 60, contentType: "image/png", maxBytes: 100 });
    const putRes = await fetch(up.url, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    expect(putRes.status).toBe(200);
    expect(await storage.exists("b.png")).toBe(true);
    await storage.delete("b.png");
  });
});
