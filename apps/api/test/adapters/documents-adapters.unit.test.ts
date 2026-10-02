/**
 * Adaptateurs de plateforme de la GED, sans base : vue de stockage `documents` sur le repli disque RÉEL (URL signées,
 * expiration, route de service), enveloppe antivirus des modules qui stockent des fichiers (messagerie, photos, justificatifs).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "@ecoledigitale/kernel";
import { EICAR, FakeScanner, type ScanPolicy } from "../../src/modules/documents";
import { DiskStorage, registerDiskStorageRoute } from "../../src/platform/adapters";
import { asAttendanceStorage, asDocumentsStorage, asMessagingStorage, asPeopleStorage } from "../../src/platform/adapters/storage";
import { withMalwareScan } from "../../src/platform/adapters/storage-scan";

describe("vue documents du repli disque : stockage, URL signées, expiration", () => {
  let dir: string;
  let now = new Date("2026-10-02T09:00:00Z");
  let storage: DiskStorage;
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ed-docs-disk-"));
    storage = new DiskStorage({ rootDir: dir, publicBaseUrl: "http://api.test", signingSecret: "secret-de-test-0123456789", now: () => now });
    registerDiskStorageRoute(app, storage);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("put / get / delete par clé, clé confinée au dossier racine", async () => {
    const docs = asDocumentsStorage(storage);
    const key = "documents/t1/d1/1-abcdef123456";
    await docs.put(key, new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    const got = await docs.get(key);
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3]);
    expect(got!.contentType).toBe("application/pdf");
    await docs.delete(key);
    expect(await docs.get(key)).toBeNull();
    await expect(docs.get("../../etc/passwd")).rejects.toThrow(/Clé d'objet invalide/);
    await expect(docs.put("documents/../x", new Uint8Array([1]), { contentType: "text/plain" })).rejects.toThrow();
  });

  it("URL signée servie par l'API : octets, téléchargement forcé, nosniff ; expirée ou altérée : 404", async () => {
    const docs = asDocumentsStorage(storage);
    const key = "documents/t1/d2/1-0123456789ab";
    await docs.put(key, new TextEncoder().encode("%PDF-1.4 test"), { contentType: "application/pdf" });
    const signed = await docs.signedUrl(key, { ttlSeconds: 60, fileName: "Acte de naissance.pdf", contentType: "application/pdf" });
    expect(signed.expiresAt.getTime() - now.getTime()).toBe(60_000);
    const path = signed.url.replace("http://api.test", "");
    const ok = await app.inject({ method: "GET", url: path });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/pdf");
    expect(ok.headers["content-disposition"]).toBe('attachment; filename="Acte_de_naissance.pdf"');
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.body).toBe("%PDF-1.4 test");
    const tampered = await app.inject({ method: "GET", url: path.replace(/.$/, (c) => (c === "A" ? "B" : "A")) });
    expect(tampered.statusCode).toBe(404);
    // durée maximale : 5 minutes, quoi que demande l'appelant
    const long = await docs.signedUrl(key, { ttlSeconds: 86_400, fileName: "a.pdf", contentType: "application/pdf" });
    expect(long.expiresAt.getTime() - now.getTime()).toBe(300_000);
    // expiration
    now = new Date(now.getTime() + 61_000);
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: long.url.replace("http://api.test", "") })).statusCode).toBe(200);
  });
});

describe("analyse antivirus des pièces des autres modules (aucune modification de leur code)", () => {
  const eicar = new TextEncoder().encode(EICAR);
  const clean = new TextEncoder().encode("%PDF-1.4 propre");

  function recording() {
    const puts: string[] = [];
    return { puts, port: { async put(key: string, _data?: Uint8Array, _options?: { contentType: string }): Promise<void> { puts.push(key); }, async delete(): Promise<void> {}, async signedUrl() { return { url: "u", expiresAt: new Date() }; } } };
  }
  const fakeStorage = (puts: string[]) => ({
    driver: "disk" as const,
    async put(key: string, bytes: Uint8Array) { puts.push(key); return { sha256: "x", size: bytes.length }; },
    async get() { return null; },
    async exists() { return false; },
    async delete() {},
    async signedUrl() { return { url: "http://u", expiresAt: new Date() }; },
  });

  it("messagerie, photos et justificatifs : un fichier infecté est refusé AVANT l'écriture (erreur de validation stable)", async () => {
    const scanner = new FakeScanner();
    const policy: ScanPolicy = { scanner, failClosed: true };
    const puts: string[] = [];
    const base = fakeStorage(puts);
    for (const view of [asMessagingStorage(base), asPeopleStorage(base), asAttendanceStorage(base)] as Array<{ put: (key: string, data: Uint8Array, options: { contentType: string }) => Promise<unknown> }>) {
      const wrapped = withMalwareScan(view, () => policy);
      const err = await wrapped.put("messaging/t/a.pdf", eicar, { contentType: "application/pdf" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("documents.malware_detected");
      await wrapped.put("messaging/t/propre.pdf", clean, { contentType: "application/pdf" });
    }
    expect(puts).toEqual(["messaging/t/propre.pdf", "messaging/t/propre.pdf", "messaging/t/propre.pdf"]);
  });

  it("antivirus injoignable : refus si fail-closed (503 côté documents), écriture sans analyse sinon ; sans scanner : inchangé", async () => {
    const scanner = new FakeScanner();
    scanner.unavailable = true;
    const { puts, port } = recording();
    const warnings: string[] = [];
    const closed = withMalwareScan(port, () => ({ scanner, failClosed: true }), (m) => warnings.push(m));
    const e = await closed.put("k/a.pdf", clean, { contentType: "application/pdf" }).catch((x: unknown) => x);
    expect((e as ValidationError).code).toBe("documents.scan_unavailable");
    expect(puts).toEqual([]);
    expect(warnings[0]).toMatch(/indisponible/);
    const open = withMalwareScan(port, () => ({ scanner, failClosed: false }));
    await open.put("k/b.pdf", clean, { contentType: "application/pdf" });
    const none = withMalwareScan(port, () => ({ scanner: null, failClosed: false }));
    await none.put("k/c.pdf", eicar, { contentType: "application/pdf" }); // aucun antivirus : comportement historique
    expect(puts).toEqual(["k/b.pdf", "k/c.pdf"]);
    // les autres méthodes de la vue restent disponibles
    expect(typeof (closed as unknown as { delete: unknown }).delete).toBe("function");
  });
});
