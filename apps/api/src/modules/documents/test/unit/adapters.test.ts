/**
 * Adaptateurs de l'infrastructure sans base : ClamAV (clamd simulé en TCP et en socket, passerelle HTTP simulée),
 * fabrique d'après l'environnement, convertisseur Office (processus simulé), stockage et annuaire en mémoire.
 */
import { createServer as createNetServer, type Server, type Socket } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClamavScanner, clamavScannerFromEnv, DevEicarScanner, parseClamdResponse, scanPolicyFromEnv } from "../../infrastructure/clamav-scanner";
import { OfficeConverter, officeConverterFromEnv, type ExecFn } from "../../infrastructure/office-converter";
import { eicarBytes, InMemoryStorage } from "../../infrastructure/in-memory-ports";
import { pdfBytes } from "../support/files";

const servers: Array<{ close(cb?: () => void): unknown }> = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((resolve) => void s.close(() => resolve()));
  }
});

/** clamd simulé : lit `zINSTREAM\0` puis des blocs [longueur][données] jusqu'à la longueur nulle ; répond selon le contenu. */
function fakeClamd(options: { maxStream?: number; silent?: boolean } = {}): Promise<{ port: number; received: number[]; server: Server }> {
  return new Promise((resolve) => {
    const received: number[] = [];
    const server = createNetServer((socket: Socket) => {
      let buffer = Buffer.alloc(0);
      let started = false;
      let total = 0;
      const body: Buffer[] = [];
      socket.on("data", (d) => {
        buffer = Buffer.concat([buffer, d]);
        if (!started) {
          if (buffer.length < 10) return;
          if (buffer.subarray(0, 10).toString() !== "zINSTREAM\0") {
            socket.end("UNKNOWN COMMAND\0");
            return;
          }
          buffer = buffer.subarray(10);
          started = true;
        }
        for (;;) {
          if (buffer.length < 4) return;
          const len = buffer.readUInt32BE(0);
          if (len === 0) {
            received.push(total);
            if (options.silent) return;
            const content = Buffer.concat(body).toString("latin1");
            if (options.maxStream !== undefined && total > options.maxStream) socket.end("INSTREAM size limit exceeded. ERROR\0");
            else if (content.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) socket.end("stream: Eicar-Test-Signature FOUND\0");
            else socket.end("stream: OK\0");
            return;
          }
          if (buffer.length < 4 + len) return;
          body.push(buffer.subarray(4, 4 + len));
          total += len;
          buffer = buffer.subarray(4 + len);
        }
      });
      socket.on("error", () => undefined);
    });
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve({ port: (server.address() as { port: number }).port, received, server });
    });
  });
}

describe("ClamAV : protocole INSTREAM (clamd simulé)", () => {
  it("fichier sain : CLEAN ; contenu envoyé en blocs, longueur totale exacte (y compris au-delà d'un bloc)", async () => {
    const { port, received } = await fakeClamd();
    const scanner = new ClamavScanner({ transport: { kind: "tcp", host: "127.0.0.1", port }, chunkSize: 1000 });
    expect(scanner.engine).toBe("clamav-tcp");
    const big = pdfBytes(`% ${"a".repeat(5000)}`);
    expect(await scanner.scan(big, { fileName: "a.pdf", mime: "application/pdf" })).toEqual({ status: "CLEAN" });
    expect(received).toEqual([big.length]);
  });

  it("EICAR : INFECTED avec le nom du programme malveillant", async () => {
    const { port } = await fakeClamd();
    const scanner = new ClamavScanner({ transport: { kind: "tcp", host: "127.0.0.1", port } });
    expect(await scanner.scan(eicarBytes(), { fileName: "x.txt", mime: "text/plain" })).toEqual({ status: "INFECTED", signature: "Eicar-Test-Signature" });
  });

  it("taille limite de clamd dépassée, serveur muet, connexion refusée : verdict ERROR (jamais d'exception)", async () => {
    const limited = await fakeClamd({ maxStream: 10 });
    expect(await new ClamavScanner({ transport: { kind: "tcp", host: "127.0.0.1", port: limited.port } }).scan(pdfBytes(`% ${"b".repeat(100)}`), { fileName: "a.pdf", mime: "application/pdf" })).toMatchObject({ status: "ERROR" });
    const silent = await fakeClamd({ silent: true });
    expect(await new ClamavScanner({ transport: { kind: "tcp", host: "127.0.0.1", port: silent.port }, timeoutMs: 150 }).scan(pdfBytes(), { fileName: "a.pdf", mime: "application/pdf" })).toEqual({ status: "ERROR", reason: "délai d'analyse dépassé" });
    // port fermé : on réserve un port libre puis on l'abandonne
    const tmp = await fakeClamd();
    const closedPort = tmp.port;
    await new Promise<void>((r) => tmp.server.close(() => r()));
    const refused = await new ClamavScanner({ transport: { kind: "tcp", host: "127.0.0.1", port: closedPort }, timeoutMs: 2000 }).scan(pdfBytes(), { fileName: "a.pdf", mime: "application/pdf" });
    expect(refused).toMatchObject({ status: "ERROR" });
  });

  it("interprétation des réponses de clamd", () => {
    expect(parseClamdResponse("stream: OK\0")).toEqual({ status: "CLEAN" });
    expect(parseClamdResponse("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ status: "INFECTED", signature: "Win.Test.EICAR_HDB-1" });
    expect(parseClamdResponse("INSTREAM size limit exceeded. ERROR")).toMatchObject({ status: "ERROR" });
    expect(parseClamdResponse("")).toMatchObject({ status: "ERROR" });
    expect(parseClamdResponse("n'importe quoi")).toMatchObject({ status: "ERROR" });
  });
});

describe("ClamAV : passerelle HTTP (simulée)", () => {
  function fakeGateway(handler: (body: string) => { status: number; json: unknown }): Promise<{ url: string; server: HttpServer }> {
    return new Promise((resolve) => {
      const server = createHttpServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const r = handler(Buffer.concat(chunks).toString("latin1"));
          res.writeHead(r.status, { "Content-Type": "application/json" }).end(JSON.stringify(r.json));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/scan`, server });
      });
    });
  }

  it("OK / FOUND / erreur HTTP / JSON inattendu", async () => {
    const gw = await fakeGateway((body) => (body.includes("EICAR-STANDARD") ? { status: 200, json: { Status: "FOUND", Description: "Eicar-Test-Signature FOUND" } } : { status: 200, json: { Status: "OK", Description: "" } }));
    const scanner = new ClamavScanner({ transport: { kind: "http", url: gw.url } });
    expect(scanner.engine).toBe("clamav-http");
    expect(await scanner.scan(pdfBytes(), { fileName: "a.pdf", mime: "application/pdf" })).toEqual({ status: "CLEAN" });
    expect(await scanner.scan(eicarBytes(), { fileName: "a.txt", mime: "text/plain" })).toEqual({ status: "INFECTED", signature: "Eicar-Test-Signature" });
    const broken = await fakeGateway(() => ({ status: 500, json: {} }));
    expect(await new ClamavScanner({ transport: { kind: "http", url: broken.url } }).scan(pdfBytes(), { fileName: "a.pdf", mime: "application/pdf" })).toMatchObject({ status: "ERROR" });
    const weird = await fakeGateway(() => ({ status: 200, json: { hello: "world" } }));
    expect(await new ClamavScanner({ transport: { kind: "http", url: weird.url } }).scan(pdfBytes(), { fileName: "a.pdf", mime: "application/pdf" })).toMatchObject({ status: "ERROR" });
    expect(await new ClamavScanner({ transport: { kind: "http", url: "http://127.0.0.1:9/scan" }, timeoutMs: 500 }).scan(pdfBytes(), { fileName: "a.pdf", mime: "application/pdf" })).toMatchObject({ status: "ERROR" });
  });
});

describe("configuration par l'environnement", () => {
  it("aucun scanner par défaut ; tcp / socket / http demandent leur paramètre ; mode inconnu refusé", () => {
    expect(clamavScannerFromEnv({})).toBeNull();
    expect(clamavScannerFromEnv({ DOCUMENTS_SCANNER: "none" })).toBeNull();
    expect(() => clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-tcp" })).toThrow(/DOCUMENTS_CLAMAV_HOST/);
    expect(() => clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-tcp", DOCUMENTS_CLAMAV_HOST: "clam", DOCUMENTS_CLAMAV_PORT: "99999" })).toThrow(/PORT/);
    expect(() => clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-socket" })).toThrow(/SOCKET/);
    expect(() => clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-http", DOCUMENTS_CLAMAV_URL: "ftp://x" })).toThrow(/URL/);
    expect(() => clamavScannerFromEnv({ DOCUMENTS_SCANNER: "virustotal" })).toThrow(/inconnu/);
    expect(clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-tcp", DOCUMENTS_CLAMAV_HOST: "clam" })?.engine).toBe("clamav-tcp");
    expect(clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-socket", DOCUMENTS_CLAMAV_SOCKET: "/run/clamd.sock" })?.engine).toBe("clamav-socket");
    expect(clamavScannerFromEnv({ DOCUMENTS_SCANNER: "clamav-http", DOCUMENTS_CLAMAV_URL: "http://clam:8080/scan" })?.engine).toBe("clamav-http");
  });

  it("fail-closed par défaut en production dès qu'un scanner est configuré ; relâchable ; avertissement sans scanner en production", () => {
    const base = { DOCUMENTS_SCANNER: "clamav-tcp", DOCUMENTS_CLAMAV_HOST: "clam" };
    expect(scanPolicyFromEnv({ ...base, NODE_ENV: "production" }).failClosed).toBe(true);
    expect(scanPolicyFromEnv({ ...base, NODE_ENV: "development" }).failClosed).toBe(false);
    expect(scanPolicyFromEnv({ ...base, NODE_ENV: "production", DOCUMENTS_SCAN_FAIL_CLOSED: "false" }).failClosed).toBe(false);
    expect(scanPolicyFromEnv({ ...base, NODE_ENV: "development", DOCUMENTS_SCAN_FAIL_CLOSED: "true" }).failClosed).toBe(true);
    const warnings: string[] = [];
    const none = scanPolicyFromEnv({ NODE_ENV: "production" }, { warn: (m) => warnings.push(m) });
    expect(none).toEqual({ scanner: null, failClosed: false });
    expect(warnings[0]).toMatch(/aucun antivirus/);
    expect(scanPolicyFromEnv({ NODE_ENV: "development" }, { warn: (m) => warnings.push(m) }).scanner).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

describe("analyseur de développement (dev-eicar)", () => {
  it("la chaîne d'essai EICAR est « infectée », tout autre fichier est « sain » ; refusé en production", async () => {
    const scanner = new DevEicarScanner();
    expect(await scanner.scan(eicarBytes())).toEqual({ status: "INFECTED", signature: "Eicar-Test-Signature" });
    expect(await scanner.scan(pdfBytes())).toEqual({ status: "CLEAN" });
    const policy = scanPolicyFromEnv({ DOCUMENTS_SCANNER: "dev-eicar", NODE_ENV: "development" });
    expect(policy.scanner?.engine).toBe("dev-eicar");
    expect(policy.failClosed).toBe(false);
    expect(() => scanPolicyFromEnv({ DOCUMENTS_SCANNER: "dev-eicar", NODE_ENV: "production" })).toThrow(/réservé au développement/);
  });
});

describe("convertisseur Office (processus simulé)", () => {
  it("désactivé par défaut ; LibreOffice demandé par l'environnement", () => {
    expect(officeConverterFromEnv({}).enabled).toBe(false);
    expect(officeConverterFromEnv({ DOCUMENTS_OFFICE_CONVERTER: "off" }).enabled).toBe(false);
    expect(officeConverterFromEnv({ DOCUMENTS_OFFICE_CONVERTER: "libreoffice" }).enabled).toBe(true);
    expect(() => officeConverterFromEnv({ DOCUMENTS_OFFICE_CONVERTER: "word-online" })).toThrow(/inconnu/);
  });

  it("produit un PDF, nettoie le dossier de travail, n'hérite d'aucune variable d'application, sans shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "ed-test-office-"));
    try {
      const calls: Array<{ file: string; args: readonly string[]; env: Record<string, string>; cwd: string }> = [];
      const exec: ExecFn = async (file, args, options) => {
        calls.push({ file, args, env: options.env, cwd: options.cwd });
        await writeFile(join(options.cwd, "in.pdf"), pdfBytes("% converti"));
        return { code: 0 };
      };
      process.env.DOCUMENTS_SECRET_PROBE = "ne-doit-pas-fuiter";
      const converter = new OfficeConverter({ exec, tmpRoot: root, sofficePath: "/usr/bin/soffice" });
      const pdf = await converter.toPdf(new Uint8Array([1, 2, 3]), { extension: "docx", mime: "x" });
      expect(Buffer.from(pdf!).subarray(0, 5).toString()).toBe("%PDF-");
      expect(calls[0]?.file).toBe("/usr/bin/soffice");
      expect(calls[0]?.args).toEqual(expect.arrayContaining(["--headless", "--convert-to", "pdf"]));
      expect(Object.keys(calls[0]!.env)).not.toContain("DOCUMENTS_SECRET_PROBE");
      expect(calls[0]!.env.HOME).toBe(calls[0]!.cwd);
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(root)).toEqual([]); // dossier de travail supprimé
      delete process.env.DOCUMENTS_SECRET_PROBE;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("échec du processus, sortie vide ou non-PDF, extension inconnue : null (la prévisualisation répond « indisponible »)", async () => {
    const root = await mkdtemp(join(tmpdir(), "ed-test-office-"));
    try {
      const failing = new OfficeConverter({ tmpRoot: root, exec: async () => ({ code: 1 }) });
      expect(await failing.toPdf(new Uint8Array([1]), { extension: "docx", mime: "x" })).toBeNull();
      const empty = new OfficeConverter({ tmpRoot: root, exec: async () => ({ code: 0 }) });
      expect(await empty.toPdf(new Uint8Array([1]), { extension: "docx", mime: "x" })).toBeNull();
      const notPdf = new OfficeConverter({ tmpRoot: root, exec: async (_f, _a, o) => { await writeFile(join(o.cwd, "in.pdf"), "pas un pdf"); return { code: 0 }; } });
      expect(await notPdf.toPdf(new Uint8Array([1]), { extension: "docx", mime: "x" })).toBeNull();
      const unknown = new OfficeConverter({ tmpRoot: root, exec: async () => ({ code: 0 }) });
      expect(await unknown.toPdf(new Uint8Array([1]), { extension: "exe", mime: "x" })).toBeNull();
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("stockage en mémoire (double de test)", () => {
  it("URL signée : valide, expirée, altérée", async () => {
    let now = new Date("2026-10-02T10:00:00Z");
    const storage = new InMemoryStorage(() => now);
    await storage.put("documents/t/d/1-abc", new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    const signed = await storage.signedUrl("documents/t/d/1-abc", { ttlSeconds: 600, fileName: "a.pdf", contentType: "application/pdf" });
    expect(signed.expiresAt.getTime() - now.getTime()).toBe(300_000); // plafonné à 5 minutes
    expect(storage.resolve(signed.url)?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(storage.resolve(signed.url.replace(/.$/, "z"))).toBeNull();
    now = new Date(now.getTime() + 301_000);
    expect(storage.resolve(signed.url)).toBeNull();
  });
});
