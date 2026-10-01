/**
 * Rendu PDF RÉEL par Puppeteer / Chromium (conditionnel : ignoré, avec un message, si aucun Chrome n'est disponible sur la
 * machine — `REPORTCARDS_CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, ou le cache Puppeteer). Aucune base requise.
 *
 *  - rendu des 5 gabarits : 1 page, texte attendu, métadonnées (titre, dates = émission), taille ≤ 300 Ko ;
 *  - test d'INJECTION : HTML hostile (hors validation, donc pire cas) — aucune requête sortante (serveur local à l'écoute),
 *    aucun JavaScript exécuté (`<noscript>` rendu), aucune lecture de fichier ;
 *  - déterminisme : deux rendus du même HTML + même date d'émission = mêmes octets ;
 *  - débit : temps par bulletin avec la concurrence bornée (objectif AC1.5 : 100 bulletins ≤ 120 s sur 2 vCPU).
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
// `pdf-parse/lib/...` : l'index du paquet exécute un code de démonstration à l'import.
// @ts-expect-error — pas de types pour ce sous-chemin
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { encodeQr, qrToSvg } from "../../domain/qr";
import { renderDocumentHtml } from "../../domain/document-html";
import { PuppeteerPdfRenderer, findChromeExecutable, findPuppeteerCachedChrome } from "../../infrastructure/puppeteer-renderer";
import { ALL_BUILTIN_KEYS, FIXED_ISSUED_AT, snapshotFor } from "../support/fixtures";
import { PNG_1X1 } from "../support/world";

const chrome = findChromeExecutable() ?? findPuppeteerCachedChrome();
if (!chrome) console.warn("[reportcards] Aucun Chrome/Chromium trouvé : les tests de rendu PDF RÉEL sont IGNORÉS (le rendu HTML déterministe reste testé).");
const describeChrome = describe.skipIf(!chrome);

const textOf = async (pdf: Uint8Array): Promise<string> => (await pdfParse(Buffer.from(pdf))).text as string;
const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, 26);
const verification = { code: CODE, url: `https://verif.example.test/v/${CODE}`, qrSvg: qrToSvg(encodeQr(`https://verif.example.test/v/${CODE}`)) };

describeChrome("rendu PDF réel (Chromium)", () => {
  let renderer: PuppeteerPdfRenderer;
  const blocked: string[] = [];

  beforeAll(() => {
    renderer = new PuppeteerPdfRenderer({ noSandbox: process.env.REPORTCARDS_CHROME_NO_SANDBOX === "1", concurrency: 2, onBlockedRequest: (u) => blocked.push(u), timeoutMs: 60_000 });
  }, 60_000);
  afterAll(async () => {
    await renderer?.close();
  });

  for (const key of ALL_BUILTIN_KEYS) {
    it(`${key} : 1 page, texte du snapshot, QR, métadonnées d'émission, ≤ 300 Ko`, async () => {
      const s = snapshotFor(key);
      const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification, assets: { logo: `data:image/png;base64,${PNG_1X1.toString("base64")}` } });
      const out = await renderer.render({ html, title: s.title, issuedAt: FIXED_ISSUED_AT });
      expect(out.pages).toBe(1);
      expect(out.pdf.length).toBeLessThan(300 * 1024);
      expect(out.rendererVersion).toMatch(/Chrome/);
      const text = await textOf(out.pdf);
      expect(text).toContain("ÉTABLISSEMENT DE DÉMONSTRATION");
      expect(text).toContain("TESTEUR Amina");
      expect(text).toContain(`Code : ${CODE}`);
      expect(text).toContain("Personne Fictive Une");
      expect(text).toContain("Pied de page de démonstration.");
      if (key !== "transcript-credits") expect(text).toContain("Moyenne");
      // Métadonnées : titre, producteur, dates = émission (reproductibilité), pas la date du rendu.
      const doc = await PDFDocument.load(out.pdf, { updateMetadata: false });
      expect(doc.getTitle()).toBe(s.title);
      expect(doc.getProducer()).toBe("EcoleDigitale");
      expect(doc.getCreationDate()?.toISOString()).toBe(FIXED_ISSUED_AT.toISOString());
      expect(doc.getModificationDate()?.toISOString()).toBe(FIXED_ISSUED_AT.toISOString());
      expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 0); // A4
    });
  }

  it("polices intégrées au PDF (aucune police système requise à l'ouverture)", async () => {
    const s = snapshotFor("secondary-bulletin");
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification });
    const out = await renderer.render({ html, title: s.title, issuedAt: FIXED_ISSUED_AT });
    expect(Buffer.from(out.pdf).toString("latin1")).toMatch(/\/FontFile2|\/FontFile3|\/FontFile/);
  });

  it("élève au nom hostile : le texte est imprimé tel quel (échappé), rien n'est interprété", async () => {
    const s = snapshotFor("secondary-bulletin", { hostile: true });
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification });
    const out = await renderer.render({ html, title: s.title, issuedAt: FIXED_ISSUED_AT });
    const text = await textOf(out.pdf);
    expect(text).toContain("<B>O'BRIEN</B>");
    expect(text).toContain("<script>alert(1)</script>".toUpperCase());
    expect(out.pages).toBe(1);
  });

  describe("test d'INJECTION : JavaScript désactivé, réseau coupé, aucune lecture de fichier", () => {
    let hits: string[] = [];
    let server: ReturnType<typeof createServer>;
    let port = 0;

    beforeAll(async () => {
      server = createServer((req: IncomingMessage, res) => {
        hits.push(`${req.method} ${req.url}`);
        res.writeHead(200, { "content-type": "text/css" }).end("body { background: red }");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("script, image, feuille de style, @import, iframe, fetch, XHR, file:// : ZÉRO requête reçue", async () => {
      hits = [];
      blocked.length = 0;
      const base = `http://127.0.0.1:${port}`;
      const hostile = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <link rel="stylesheet" href="${base}/link.css">
        <style>@import url(${base}/import.css); body { background: url(${base}/bg.png); } div.x { background-image: url('file:///C:/Windows/win.ini'); }</style>
        <script src="${base}/script.js"></script>
        <script>fetch("${base}/fetch"); var x = new XMLHttpRequest(); x.open("GET", "${base}/xhr"); x.send(); document.body.innerHTML = "PWNED-PAR-SCRIPT";</script>
        </head><body onload="fetch('${base}/onload')">
        <h1>CONTENU-LEGITIME</h1>
        <noscript>JAVASCRIPT-DESACTIVE</noscript>
        <img src="${base}/img.png"> <img src="http://169.254.169.254/latest/meta-data/"> <img src="file:///C:/Windows/win.ini">
        <iframe src="${base}/iframe.html"></iframe> <iframe src="file:///C:/Windows/win.ini"></iframe>
        <object data="${base}/object"></object> <embed src="${base}/embed">
        <video src="${base}/video.mp4"></video> <audio src="${base}/audio.mp3"></audio>
        <div class="x" style="background:url(${base}/inline-style)">x</div>
        <form action="${base}/form" method="post"><input type="submit" id="s"></form>
        <a href="${base}/lien">lien</a>
        </body></html>`;
      const out = await renderer.render({ html: hostile, title: "Injection", issuedAt: FIXED_ISSUED_AT });
      expect(out.pages).toBeGreaterThanOrEqual(1);
      // Le serveur local n'a reçu AUCUNE requête (réseau coupé), même pas une résolution/connexion.
      await new Promise((r) => setTimeout(r, 500));
      expect(hits).toEqual([]);
      // Les requêtes ont été tentées puis bloquées par l'interception.
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.every((u) => !u.startsWith("data:"))).toBe(true);
      // JavaScript désactivé : le script n'a pas modifié la page, le <noscript> est rendu.
      const text = await textOf(out.pdf);
      expect(text).toContain("CONTENU-LEGITIME");
      expect(text).toContain("JAVASCRIPT-DESACTIVE");
      expect(text).not.toContain("PWNED-PAR-SCRIPT");
      // Aucun contenu de fichier local n'a été lu.
      expect(text).not.toMatch(/\[fonts\]|\[extensions\]|MAPI=1/);
    });
  });

  it("redirection <meta refresh> vers une URL : la navigation est bloquée, aucune requête n'atteint le serveur (le rendu peut échouer, jamais fuir)", async () => {
    const probe = createServer((req, res) => {
      probeHits.push(req.url ?? "");
      res.writeHead(200).end("ok");
    });
    const probeHits: string[] = [];
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(probe.address() as AddressInfo).port}/meta-refresh`;
    const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body>REDIRIGE</body></html>`;
    await renderer.render({ html, title: "redirection", issuedAt: FIXED_ISSUED_AT }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    expect(probeHits).toEqual([]);
  });

  it("déterminisme : deux rendus du même HTML avec la même date d'émission donnent les mêmes octets", async () => {
    const s = snapshotFor("higher-bulletin-credits");
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification });
    const a = await renderer.render({ html, title: s.title, issuedAt: FIXED_ISSUED_AT });
    const b = await renderer.render({ html, title: s.title, issuedAt: FIXED_ISSUED_AT });
    expect(await textOf(a.pdf)).toBe(await textOf(b.pdf));
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true);
  });

  it("débit : 24 bulletins avec concurrence bornée à 2 (mesure pour l'objectif AC1.5 : 100 en ≤ 120 s sur 2 vCPU)", async () => {
    const s = snapshotFor("secondary-bulletin");
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification, assets: { logo: `data:image/png;base64,${PNG_1X1.toString("base64")}` } });
    const start = Date.now();
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => renderer.render({ html, title: `Bulletin ${i}`, issuedAt: FIXED_ISSUED_AT })));
    const elapsed = Date.now() - start;
    expect(results.every((r) => r.pages === 1)).toBe(true);
    console.info(`[reportcards] rendu Chromium : 24 bulletins en ${elapsed} ms (${Math.round(elapsed / 24)} ms / bulletin, concurrence 2) -> extrapolation 100 bulletins ≈ ${Math.round((elapsed / 24) * 100 / 1000)} s`);
    expect(elapsed / 24).toBeLessThan(3000);
  });

  it("échec du moteur (page qui plante / délai dépassé) : l'erreur remonte, le moteur reste utilisable", async () => {
    const tight = new PuppeteerPdfRenderer({ timeoutMs: 1, concurrency: 1 });
    await expect(tight.render({ html: "<html><body>x</body></html>", title: "t", issuedAt: FIXED_ISSUED_AT })).rejects.toBeDefined();
    await tight.close();
    const s = snapshotFor("primary-bulletin");
    const html = renderDocumentHtml({ snapshot: s.snapshot, template: { body: s.template.body, css: s.template.css }, verification });
    expect((await renderer.render({ html, title: s.title, issuedAt: FIXED_ISSUED_AT })).pages).toBe(1);
  });
});
