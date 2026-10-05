/**
 * Extraction du texte des PDF dans un processus isolé : texte, accents, pages, scan sans texte, PDF piégé (aucune connexion,
 * aucune exécution), bombe de décompression (tuée par la limite de durée ou de mémoire), PDF corrompu, taille refusée.
 * Lance de vrais processus Node : chaque cas dure quelques centaines de millisecondes.
 */
import { createServer, type Server } from "node:net";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHILD_GUARD_SOURCE, IsolatedPdfExtractor, permissionFlag, pdfTextExtractorFromEnv, resolvePdfParserPath } from "../../infrastructure/pdf-text-extractor";
import { NO_TEXT_EXTRACTOR } from "../../application/ports";
import { blankPdf, bombPdf, corruptPdf, textPdf, trappedPdf } from "../support/pdfs";

const parserPath = resolvePdfParserPath();

describe("résolution de l'analyseur", () => {
  it("pdf-parse est déjà présent dans apps/api (aucune dépendance ajoutée)", () => {
    expect(parserPath).not.toBeNull();
  });
  it("sans analyseur résolvable, l'extracteur est le port « indisponible »", async () => {
    const x = pdfTextExtractorFromEnv({ DOCUMENTS_PDF_PARSER_PATH: "C:/introuvable/pdf-parse.js" });
    expect(x).toBe(NO_TEXT_EXTRACTOR);
    expect(await x.extract(new Uint8Array([1]))).toEqual({ ok: false, code: "unavailable", retryable: true });
  });
  it("le drapeau de permissions dépend de la version de Node", () => {
    expect(permissionFlag("18.0.0")).toBeNull();
    expect(permissionFlag("20.11.0")).toBe("--experimental-permission");
    expect(permissionFlag("22.13.0")).toBe("--permission");
    expect(permissionFlag("24.1.0")).toBe("--permission");
  });
  it("un mode de bac à sable inconnu est refusé", () => {
    expect(() => pdfTextExtractorFromEnv({ DOCUMENTS_PDF_SANDBOX: "x" })).toThrow(/DOCUMENTS_PDF_SANDBOX/);
  });
});

describe.skipIf(!parserPath)("IsolatedPdfExtractor : vrais processus fils", () => {
  const make = (limits: ConstructorParameters<typeof IsolatedPdfExtractor>[0]["limits"] = {}, sandbox: "permission" | "none" = "permission") =>
    new IsolatedPdfExtractor({ parserPath: parserPath as string, limits, sandbox });

  it("extrait le texte et les accents, page par page, sans caractère de contrôle", async () => {
    const r = await make().extract(await textPdf(["Bulletin de notes du premier trimestre\nÉlève : Awa Koné — mathématiques", "Deuxième page : règlement intérieur"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(2);
    expect(r.pagesRead).toBe(2);
    expect(r.truncated).toBe(false);
    expect(r.text).toContain("Bulletin de notes du premier trimestre");
    expect(r.text).toContain("Élève : Awa Koné");
    expect(r.text).toContain("règlement intérieur");
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.text)).toBe(false);
  });

  it("un PDF sans couche de texte (scan) donne un texte vide : c'est l'appelant qui le marque « sans texte »", async () => {
    const r = await make().extract(await blankPdf(2));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.trim()).toBe("");
      expect(r.pageCount).toBe(2);
    }
  });

  it("limite de pages : seules les premières pages sont lues, le résultat est marqué tronqué", async () => {
    const pages = Array.from({ length: 6 }, (_, i) => `page numéro ${i + 1} alpha${i + 1}`);
    const r = await make({ maxPages: 3 }).extract(await textPdf(pages));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pagesRead).toBe(3);
    expect(r.pageCount).toBe(6);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("alpha3");
    expect(r.text).not.toContain("alpha4");
  });

  it("limite de caractères : le texte est coupé et marqué tronqué", async () => {
    const r = await make({ maxChars: 40 }).extract(await textPdf(["abcdefghij ".repeat(20)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.length).toBeLessThanOrEqual(40);
    expect(r.truncated).toBe(true);
  });

  it("taille : un PDF au-delà du plafond est refusé sans lancer de processus", async () => {
    const x = make({ maxBytes: 1000 });
    expect(await x.extract(new Uint8Array(5000))).toEqual({ ok: false, code: "too_large", retryable: false });
  });

  it("PDF corrompu : échec définitif « corrupt », jamais d'exception", async () => {
    expect(await make().extract(corruptPdf())).toEqual({ ok: false, code: "corrupt", retryable: false });
    expect(await make().extract(new Uint8Array([0, 1, 2, 3]))).toMatchObject({ ok: false, code: "corrupt" });
  });

  describe("PDF piégé", () => {
    let server: Server;
    let port = 0;
    let connections = 0;
    beforeAll(async () => {
      server = createServer((socket) => {
        connections += 1;
        socket.destroy();
      });
      await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
      port = (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      await new Promise<void>((res) => server.close(() => res()));
    });

    it("le texte visible est extrait, mais ni l'URI, ni le JavaScript, ni le lancement ne produisent la moindre connexion", async () => {
      const r = await make().extract(await trappedPdf(`http://127.0.0.1:${port}/exfiltre`, "Contrat de travail confidentiel"));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.text).toContain("Contrat de travail confidentiel");
      await new Promise((res) => setTimeout(res, 200));
      expect(connections).toBe(0);
    });

    it("la garde du fils refuse réseau, DNS, HTTP, fetch et processus enfants (même hors du bac à sable)", async () => {
      const probe = `
${CHILD_GUARD_SOURCE}
const results = {};
const isDenied = (e) => String(e && e.message).startsWith("denied:") || /fetch is not defined/.test(String(e && e.message));
const tryIt = (name, fn) => { try { fn(); results[name] = "OPEN"; } catch (e) { results[name] = isDenied(e) ? "denied" : "other:" + e.message; } };
tryIt("net.connect", () => require("net").connect(${port}, "127.0.0.1"));
tryIt("socket.connect", () => new (require("net").Socket)().connect(${port}, "127.0.0.1"));
tryIt("dns.lookup", () => require("dns").lookup("example.org", () => {}));
tryIt("spawn", () => require("child_process").spawn("node", ["-v"]));
tryIt("exec", () => require("child_process").execSync("echo x"));
// http et https passent par net.Socket.connect : la connexion échoue (événement « error » ou exception), jamais de réponse.
const finish = () => process.stdout.write(JSON.stringify(results));
let pending = 3;
const settle = (name) => (e) => { const m = String(e && (e.cause ? e.cause.message : e.message)); results[name] = m.startsWith("denied:") ? "denied" : "other:" + m; if (--pending === 0) finish(); };
fetch("http://127.0.0.1:${port}/").then(() => { results.fetch = "OPEN"; }, settle("fetch"));
try { require("http").get("http://127.0.0.1:${port}/").on("error", settle("http.get")).on("response", () => { results["http.get"] = "OPEN"; }); } catch (e) { settle("http.get")(e); }
try { require("https").get("https://127.0.0.1:${port}/").on("error", settle("https.get")); } catch (e) { settle("https.get")(e); }
setTimeout(finish, 3000).unref();
`;
      const dir = mkdtempSync(join(tmpdir(), "ed-probe-"));
      const file = join(dir, "probe.cjs");
      writeFileSync(file, probe);
      // Asynchrone : la boucle d'événements de ce test reste libre d'accepter une connexion si le fils en ouvrait une.
      const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: {}, encoding: "utf8" }, (e, o) => (e ? rej(e) : res(o))));
      rmSync(dir, { recursive: true, force: true });
      const results = JSON.parse(stdout) as Record<string, string>;
      expect(Object.values(results).every((v) => v === "denied")).toBe(true);
      expect(Object.keys(results).sort()).toEqual(["dns.lookup", "exec", "fetch", "http.get", "https.get", "net.connect", "socket.connect", "spawn"]);
      await new Promise((res) => setTimeout(res, 100));
      expect(connections).toBe(0);
    });
  });

  it("bombe de décompression : le fils est tué (durée ou mémoire), l'appelant reçoit un échec propre", async () => {
    const pdf = await bombPdf(400 * 1024 * 1024);
    expect(pdf.byteLength).toBeLessThan(2 * 1024 * 1024); // petite à l'entrée, énorme une fois décompressée
    const started = Date.now();
    const r = await make({ timeoutMs: 4000, maxMemoryMb: 128 }).extract(pdf);
    expect(Date.now() - started).toBeLessThan(15_000);
    if (r.ok) {
      // L'analyseur est peut-être venu à bout du flux de blancs : alors il n'a trouvé aucun texte et rien n'a débordé.
      expect(r.text.trim()).toBe("");
    } else {
      expect(["timeout", "memory", "crashed"]).toContain(r.code);
    }
  }, 30_000);

  it("le fils ne reçoit aucune variable d'application", async () => {
    process.env.ED_SECRET_CANARY = "ne-doit-pas-fuiter";
    try {
      const probe = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.env.ED_SECRET_CANARY))"], { encoding: "utf8", env: {} });
      expect(probe.stdout).toBe("undefined");
      const r = await make().extract(await textPdf(["variables d'environnement"]));
      expect(r.ok).toBe(true);
    } finally {
      delete process.env.ED_SECRET_CANARY;
    }
  });
});
