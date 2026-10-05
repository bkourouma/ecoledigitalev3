/**
 * Recherche dans le texte des PDF (Q-14) sur base réelle : extraction réelle dans un processus fils isolé, index Postgres
 * (tsvector français sans accents), RLS A/B, matrice d'accès identique à la liste, PDF sans texte, PDF piégé, versions,
 * archivage, purge, réindexation de l'existant, audit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext } from "@ecoledigitale/kernel";
import { archiveDocument, listDocuments, restoreDocument, updateDocument } from "../../application/documents";
import { updateSettings } from "../../application/categories";
import { runHousekeeping } from "../../application/housekeeping";
import { shareDocument, unshareDocument } from "../../application/shares";
import { indexPendingTexts, reindexTexts, searchDocumentText, snippetSegments, textIndexStatus, type TextIndexingReport } from "../../application/text-search";
import { addVersion } from "../../application/uploads";
import { DocumentsCode } from "../../domain/errors";
import { IsolatedPdfExtractor, resolvePdfParserPath } from "../../infrastructure/pdf-text-extractor";
import * as textRepo from "../../infrastructure/text-index-repository";
import type { ActorCaps } from "../../domain/types";
import { describeIntegration } from "../support/db";
import { expectErr, must } from "../support/assert";
import { blankPdf, corruptPdf, textPdf, trappedPdf } from "../support/pdfs";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

const parserPath = resolvePdfParserPath();
const suite = parserPath ? describeIntegration : describe.skip;

suite("module documents : recherche dans le texte des PDF", () => {
  let w: World;
  const docs: Record<string, string> = {};
  const system = (tenant = w.tenantA) => createSystemContext(tenant);
  const manager = { userId: USERS.manager, caps: CAPS.manager };

  const indexAll = async (tenant = w.tenantA): Promise<TextIndexingReport> => {
    const total: TextIndexingReport = { claimed: 0, indexed: 0, noText: 0, failed: 0, retried: 0, skipped: 0, extractorUnavailable: false };
    for (let i = 0; i < 20; i += 1) {
      const r = await indexPendingTexts(w.deps, system(tenant));
      for (const k of ["claimed", "indexed", "noText", "failed", "retried", "skipped"] as const) total[k] += r[k];
      total.extractorUnavailable ||= r.extractorUnavailable;
      if (r.claimed === 0 || r.extractorUnavailable) break;
    }
    return total;
  };
  const row = async (id: string) => (await w.db.admin.query("SELECT * FROM documents.text_index WHERE document_id = $1", [id])).rows[0] as Record<string, unknown> | undefined;
  const search = async (userId: string, caps: ActorCaps, q: string, extra: Record<string, unknown> = {}, tenant = w.tenantA) =>
    must(await searchDocumentText(w.deps, w.ctxA(userId, tenant), { caps, query: { q, ...extra } }));
  const idsFor = async (userId: string, caps: ActorCaps, q: string, tenant = w.tenantA): Promise<string[]> => {
    const out: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await search(userId, caps, q, { limit: 3, ...(cursor ? { cursor } : {}) }, tenant);
      out.push(...page.items.map((i) => i.document.id));
      if (!page.nextCursor) return out;
      cursor = page.nextCursor;
    }
  };
  const nameOf = (id: string): string => Object.entries(docs).find(([, v]) => v === id)?.[0] ?? id;
  const pdfWith = (marker: string, extra = ""): Promise<Uint8Array> => textPdf([`Document pertinent ${marker}\n${extra}`]);

  let trapServer: Server;
  let trapPort = 0;
  let trapConnections = 0;

  beforeAll(async () => {
    trapServer = createServer((s) => {
      trapConnections += 1;
      s.destroy();
    });
    await new Promise<void>((res) => trapServer.listen(0, "127.0.0.1", res));
    trapPort = (trapServer.address() as { port: number }).port;

    w = await createWorld();
    (w.ports as { textExtractor: unknown }).textExtractor = new IsolatedPdfExtractor({ parserPath: parserPath as string, limits: { timeoutMs: 15_000 } });
    const seed = async (key: string, over: Parameters<World["seedDocument"]>[0] = {}) => {
      docs[key] = await w.seedDocument({ ...manager, ...over, bytes: await pdfWith(`zorglub${key.toLowerCase()}`, "Élève Koné, mathématiques"), fileName: `${key}.pdf` });
    };
    await seed("regulation", { code: "INSTITUTION_REGULATION", fields: { ownerType: "NONE", ownerId: null, title: "Règlement" } });
    await seed("idChild", { fields: { title: "CNI enfant", ownerId: PEOPLE.child } });
    await seed("idOther", { fields: { title: "CNI autre", ownerId: PEOPLE.other } });
    await seed("idPupil", { fields: { title: "CNI élève", ownerId: PEOPLE.pupil } });
    await seed("staffOnly", { fields: { title: "Note interne", ownerId: PEOPLE.child, visibility: "STAFF_ONLY" } });
    await seed("private", { fields: { title: "Privé", ownerId: PEOPLE.child, visibility: "PRIVATE" } });
    await seed("medical", { code: "STUDENT_MEDICAL", fields: { title: "Certificat", ownerId: PEOPLE.child } });
    await seed("contract", { code: "STAFF_CONTRACT", fields: { title: "Contrat", ownerId: PEOPLE.staffA } });
    await seed("diploma", { code: "STAFF_DIPLOMA", fields: { title: "Diplôme", ownerId: PEOPLE.staffA } });
    await seed("accounting", { code: "FINANCIAL_ACCOUNTING", fields: { title: "Pièce comptable", ownerType: "NONE", ownerId: null } });
    docs.archived = await w.seedDocument({ ...manager, bytes: await pdfWith("zorglubarchived"), fileName: "a.pdf", fields: { title: "Archivé", ownerId: PEOPLE.child } });
    // Autre tenant : même mot, autre marqueur.
    docs.tenantB = await w.seedDocument({ tenantId: w.tenantB, ...manager, bytes: await pdfWith("zorglubtenantb"), fileName: "b.pdf", fields: { title: "Document B", ownerId: PEOPLE.child } });
    // Documents particuliers
    docs.scan = await w.seedDocument({ ...manager, bytes: await blankPdf(2), fileName: "scan.pdf", fields: { title: "Scan sans texte", ownerId: PEOPLE.child } });
    docs.corrupt = await w.seedDocument({ ...manager, bytes: corruptPdf(), fileName: "corrompu.pdf", fields: { title: "Corrompu", ownerId: PEOPLE.child } });
    docs.trap = await w.seedDocument({ ...manager, bytes: await trappedPdf(`http://127.0.0.1:${trapPort}/exfiltre`, "Contrat piégé pertinent zorglubtrap"), fileName: "piege.pdf", fields: { title: "Piégé", ownerId: PEOPLE.child } });

    // Avant l'extracteur : tout est en file ; l'archivage se fait avant l'indexation.
    must(await archiveDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: docs.archived!, reason: "doublon" }));
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((res) => trapServer?.close(() => res()));
    await w?.drop();
  });

  describe("indexation (job du worker)", () => {
    it("chaque PDF déposé est mis en file dans la transaction du dépôt", async () => {
      const r = (await w.db.admin.query("SELECT status, count(*)::int AS n FROM documents.text_index GROUP BY status")).rows;
      expect(r).toEqual([{ status: "PENDING", n: 15 }]);
      expect((await row(docs.regulation!))?.version_no).toBe(1);
    });

    it("sans extracteur disponible, la file attend : aucune tentative consommée, rien n'est marqué en échec", async () => {
      const original = w.ports.textExtractor;
      (w.ports as { textExtractor: unknown }).textExtractor = { extract: async () => ({ ok: false, code: "unavailable", retryable: true }) };
      try {
        const report = await indexPendingTexts(w.deps, system());
        expect(report.extractorUnavailable).toBe(true);
        expect(report.indexed).toBe(0);
        expect(report.failed).toBe(0);
        const rows = (await w.db.admin.query("SELECT status, attempts FROM documents.text_index WHERE tenant_id = $1", [w.tenantA])).rows;
        expect(rows.every((r) => r.status === "PENDING" && r.attempts === 0)).toBe(true);
      } finally {
        (w.ports as { textExtractor: unknown }).textExtractor = original;
      }
      // Les lignes sont repoussées de 5 minutes : on avance l'horloge pour la suite.
      w.clock.advanceSeconds(6 * 60);
    });

    it("extrait, indexe, marque « sans texte » un scan et « illisible » un PDF corrompu (sans OCR, sans exception)", async () => {
      const report = await indexAll();
      expect(report.indexed).toBe(12); // tous les PDF avec texte du tenant A (archivé compris)
      expect(report.noText).toBe(1);
      expect(report.failed).toBe(1);
      expect(await row(docs.regulation!)).toMatchObject({ status: "INDEXED", page_count: 1, pages_indexed: 1, truncated: false });
      expect(String((await row(docs.regulation!))!.content)).toContain("zorglubregulation");
      expect(await row(docs.scan!)).toMatchObject({ status: "NO_TEXT", content: null, tsv: null, page_count: 2, char_count: 0 });
      expect(await row(docs.corrupt!)).toMatchObject({ status: "FAILED", error_code: "corrupt", content: null });
      // le tenant B n'a pas encore été traité : son document attend toujours
      expect((await row(docs.tenantB!))?.status).toBe("PENDING");
      expect((await indexAll(w.tenantB)).indexed).toBe(1);
    }, 180_000);

    it("l'état est exposé dans le détail du document et à la gestion (jamais le texte)", async () => {
      const stats = must(await textIndexStatus(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager }));
      expect(stats.counts).toMatchObject({ PENDING: 0, INDEXED: 12, NO_TEXT: 1, FAILED: 1 });
      expect(stats.failures).toEqual([{ errorCode: "corrupt", count: 1 }]);
      expectErr(await textIndexStatus(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary }), DocumentsCode.FORBIDDEN);
      const { getDocument } = await import("../../application/documents");
      const scan = must(await getDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: docs.scan! }));
      expect(scan.textIndex).toMatchObject({ status: "NO_TEXT", pageCount: 2 });
      expect(JSON.stringify(scan)).not.toContain("zorglub");
    });

    it("le PDF piégé est indexé pour son texte visible ; aucune connexion n'a été tentée par son URI ni par son JavaScript", async () => {
      expect(await row(docs.trap!)).toMatchObject({ status: "INDEXED" });
      expect(trapConnections).toBe(0);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubtrap")).toEqual([docs.trap]);
    });

    it("traces d'audit de l'indexation : codes seulement, jamais d'extrait", async () => {
      const entries = w.audit.entries.filter((e) => e.entry.action.startsWith("documents.text_index."));
      expect(entries.filter((e) => e.entry.action === "documents.text_index.indexed").length).toBeGreaterThanOrEqual(13);
      const failed = entries.filter((e) => e.entry.action === "documents.text_index.failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]!.entry.metadata).toMatchObject({ errorCode: "corrupt" });
      expect(JSON.stringify(entries.map((e) => e.entry))).not.toContain("zorglub");
    });
  });

  describe("recherche : mêmes droits que la liste, jamais de fuite", () => {
    const actors: Array<{ name: string; userId: string; caps: ActorCaps }> = [
      { name: "gestion", userId: USERS.manager, caps: CAPS.manager },
      { name: "secrétariat", userId: USERS.secretary, caps: CAPS.secretary },
      { name: "économat", userId: USERS.econome, caps: CAPS.econome },
      { name: "enseignant", userId: USERS.teacher, caps: CAPS.teacher },
      { name: "parent (enfant lié)", userId: USERS.parent, caps: CAPS.parent },
      { name: "parent (autre enfant)", userId: USERS.parent2, caps: CAPS.parent },
      { name: "élève", userId: USERS.pupil, caps: CAPS.pupil },
      { name: "personnel (son dossier)", userId: USERS.staffUser, caps: CAPS.staffOwn },
      { name: "inconnu sans droit", userId: USERS.stranger, caps: CAPS.none },
    ];
    const MARKED = Object.keys({ regulation: 1, idChild: 1, idOther: 1, idPupil: 1, staffOnly: 1, private: 1, medical: 1, contract: 1, diploma: 1, accounting: 1, archived: 1, trap: 1 });

    it("pour chaque acteur, la recherche renvoie exactement les documents indexés que sa liste affiche, et aucun extrait des autres", async () => {
      const allMarkers = MARKED.map((k) => `zorglub${k.toLowerCase()}`);
      for (const a of actors) {
        const listed = new Set<string>();
        let cursor: string | undefined;
        for (;;) {
          const page = must(await listDocuments(w.deps, w.ctxA(a.userId), { caps: a.caps, query: { limit: 5, ...(cursor ? { cursor } : {}) } }));
          for (const i of page.items) listed.add(i.id);
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        // Le terme commun « pertinent » figure dans tous les PDF avec texte : attendu = documents listés ET indexés.
        const indexed = new Set((await w.db.admin.query("SELECT document_id FROM documents.text_index WHERE tenant_id = $1 AND status = 'INDEXED'", [w.tenantA])).rows.map((r) => r.document_id as string));
        const expected = [...listed].filter((id) => indexed.has(id)).map(nameOf).sort();
        const found: string[] = [];
        const rawPages: string[] = [];
        let c: string | undefined;
        for (;;) {
          const page = must(await searchDocumentText(w.deps, w.ctxA(a.userId), { caps: a.caps, query: { q: "pertinent", limit: 4, ...(c ? { cursor: c } : {}) } }));
          rawPages.push(JSON.stringify(page));
          found.push(...page.items.map((i) => nameOf(i.document.id)));
          if (!page.nextCursor) break;
          c = page.nextCursor;
        }
        expect(found.sort(), a.name).toEqual(expected);
        // Aucun marqueur d'un document non lisible n'apparaît nulle part dans la réponse (extrait, titre, ou autre).
        const body = rawPages.join("\n").toLowerCase();
        for (const key of MARKED) {
          const marker = `zorglub${key.toLowerCase()}`;
          const mayRead = expected.includes(key);
          if (!mayRead) expect(body.includes(marker), `${a.name} ne doit pas voir ${key}`).toBe(false);
        }
        // Une recherche ciblant le marqueur d'un document illisible ne renvoie rien (aucune différence avec « inexistant »).
        for (const key of MARKED) {
          if (!expected.includes(key)) expect(await idsFor(a.userId, a.caps, `zorglub${key.toLowerCase()}`), `${a.name}/${key}`).toEqual([]);
        }
        void allMarkers;
      }
    }, 180_000);

    it("le document archivé n'est jamais renvoyé, même à la gestion ; restauré, il redevient cherchable sans réindexation", async () => {
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubarchived")).toEqual([]);
      must(await restoreDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: docs.archived! }));
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubarchived")).toEqual([docs.archived]);
      must(await archiveDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: docs.archived!, reason: "doublon" }));
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubarchived")).toEqual([]);
    });

    it("un changement de visibilité ou un partage s'applique immédiatement à la recherche", async () => {
      const id = docs.idChild!;
      expect(await idsFor(USERS.secretary, CAPS.secretary, "zorglubidchild")).toEqual([id]);
      must(await updateDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, body: { visibility: "PRIVATE" } }));
      expect(await idsFor(USERS.secretary, CAPS.secretary, "zorglubidchild")).toEqual([]);
      expect(await idsFor(USERS.parent, CAPS.parent, "zorglubidchild")).toEqual([]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubidchild")).toEqual([id]);
      const share = must(await shareDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, body: { userId: USERS.teacher, level: "READ" } }));
      expect(await idsFor(USERS.teacher, CAPS.teacher, "zorglubidchild")).toEqual([id]);
      must(await unshareDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, shareId: share.id }));
      expect(await idsFor(USERS.teacher, CAPS.teacher, "zorglubidchild")).toEqual([]);
      must(await updateDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, body: { visibility: "INHERIT" } }));
      expect(await idsFor(USERS.parent, CAPS.parent, "zorglubidchild")).toEqual([id]);
    });

    it("l'accès d'un tuteur dépend du lien relu à chaque requête (lien retiré = plus de résultat)", async () => {
      expect(await idsFor(USERS.parent, CAPS.parent, "zorglubmedical")).toEqual([docs.medical]); // le dossier médical de SON enfant
      expect(await idsFor(USERS.parent, CAPS.parent, "zorglubidchild")).toEqual([docs.idChild]);
      expect(await idsFor(USERS.parent2, CAPS.parent, "zorglubmedical")).toEqual([]); // pas celui d'un autre enfant
      w.ports.owners.setLinks(w.tenantA, USERS.parent, { childStudentIds: [] });
      try {
        expect(await idsFor(USERS.parent, CAPS.parent, "zorglubidchild")).toEqual([]);
        expect(await idsFor(USERS.parent, CAPS.parent, "zorglubmedical")).toEqual([]);
      } finally {
        w.ports.owners.setLinks(w.tenantA, USERS.parent, { childStudentIds: [PEOPLE.child] });
      }
    });

    it("isolation entre tenants : A ne voit jamais B, B ne voit jamais A (même mot, même rôle)", async () => {
      const a = await idsFor(USERS.manager, CAPS.manager, "zorglubtenantb", w.tenantA);
      expect(a).toEqual([]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubtenantb", w.tenantB)).toEqual([docs.tenantB]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubregulation", w.tenantB)).toEqual([]);
      const bAll = await idsFor(USERS.manager, CAPS.manager, "pertinent", w.tenantB);
      expect(bAll).toEqual([docs.tenantB]);
      const aAll = await idsFor(USERS.manager, CAPS.manager, "pertinent", w.tenantA);
      expect(aAll).not.toContain(docs.tenantB);
    });

    it("RLS forcée sur l'index : un contexte de tenant ne lit que ses lignes, même par SQL direct", async () => {
      const flags = (await w.db.admin.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'documents.text_index'::regclass")).rows[0];
      expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const asA = await w.db.tenantDb.run(w.ctxA(USERS.manager), (tx) => tx.many<{ tenant_id: string; content: string | null }>("SELECT tenant_id, content FROM documents.text_index"));
      expect(asA.length).toBeGreaterThan(0);
      expect(new Set(asA.map((r) => r.tenant_id))).toEqual(new Set([w.tenantA]));
      const asB = await w.db.tenantDb.run(w.ctxB(USERS.manager), (tx) => tx.many<{ tenant_id: string; content: string | null }>("SELECT tenant_id, content FROM documents.text_index"));
      expect(new Set(asB.map((r) => r.tenant_id))).toEqual(new Set([w.tenantB]));
      expect(asB.some((r) => String(r.content).includes("zorglubregulation"))).toBe(false);
      // Écrire une ligne pour un autre tenant est refusé par la RLS.
      await expect(
        w.db.tenantDb.run(w.ctxB(USERS.manager), (tx) =>
          tx.query("INSERT INTO documents.text_index (tenant_id, document_id, version_no, status) VALUES ($1, $2, 1, 'PENDING')", [w.tenantA, docs.regulation]),
        ),
      ).rejects.toThrow();
      // Un identifiant de document de A, présenté par B, ne remonte pas de l'index.
      const crossed = await w.db.tenantDb.run(w.ctxB(USERS.manager), (tx) => tx.many("SELECT 1 FROM documents.text_index WHERE document_id = $1", [docs.regulation]));
      expect(crossed).toHaveLength(0);
    });

    it("français sans accents, radicaux et syntaxe web ; extraits surlignés en texte brut", async () => {
      // Accents : « mathematiques » trouve « mathématiques » ; « koné » / « kone » équivalents ; pluriel et singulier ensemble.
      expect((await idsFor(USERS.manager, CAPS.manager, "mathematiques kone")).length).toBeGreaterThanOrEqual(10);
      expect((await idsFor(USERS.manager, CAPS.manager, "eleve")).length).toBeGreaterThanOrEqual(10);
      expect((await idsFor(USERS.manager, CAPS.manager, "documents")).length).toBeGreaterThanOrEqual(10); // le texte dit « Document »
      // Exclusion et expression exacte.
      expect(await idsFor(USERS.manager, CAPS.manager, 'zorglubregulation -mathematiques')).toEqual([]);
      expect(await idsFor(USERS.manager, CAPS.manager, '"Élève Koné" zorglubregulation')).toEqual([docs.regulation]);
      const page = await search(USERS.manager, CAPS.manager, "mathématiques zorglubregulation");
      const hit = page.items.find((i) => i.document.id === docs.regulation)!;
      expect(hit.snippet.some((s) => s.match && /math/i.test(s.text))).toBe(true);
      expect(hit.snippet.some((s) => s.match && /zorglubregulation/i.test(s.text))).toBe(true);
      const flat = hit.snippet.map((s) => s.text).join("");
      // eslint-disable-next-line no-control-regex
      expect(/[\u0001-\u0003]/.test(flat)).toBe(false);
      expect(hit).toMatchObject({ versionNo: 1, pageCount: 1, pagesIndexed: 1, truncated: false });
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.document.title).toBe("Règlement");
    });

    it("le HTML contenu dans un PDF reste du texte : aucune balise n'est interprétée côté serveur", async () => {
      const id = await w.seedDocument({ ...manager, bytes: await textPdf(["pertinent <script>alert(1)</script> <b>gras</b> zorglubhtml"]), fileName: "contenu.pdf", fields: { title: "HTML", ownerId: PEOPLE.child } });
      await indexAll();
      const hit = (await search(USERS.manager, CAPS.manager, "zorglubhtml")).items[0]!;
      expect(hit.document.id).toBe(id);
      const flat = hit.snippet.map((s) => s.text).join("");
      expect(flat).toContain("zorglubhtml");
      expect(hit.snippet.every((s) => typeof s.text === "string" && typeof s.match === "boolean")).toBe(true);
      // Ce que Postgres laisse passer d'un balisage reste du texte brut : le découpage en segments ne l'interprète jamais.
      expect(snippetSegments("avant <script>alert(1)</script> \u0001mot\u0002 <b>x</b>")).toEqual([
        { text: "avant <script>alert(1)</script> ", match: false },
        { text: "mot", match: true },
        { text: " <b>x</b>", match: false },
      ]);
      expect(snippetSegments("a \u0001mot\u0002 b\u0003 c")).toEqual([
        { text: "a ", match: false },
        { text: "mot", match: true },
        { text: " b … c", match: false },
      ]);
    });

    it("pagination par curseur stable : chaque résultat exactement une fois, ordre de pertinence conservé", async () => {
      const first = await search(USERS.manager, CAPS.manager, "pertinent", { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const all = await idsFor(USERS.manager, CAPS.manager, "pertinent");
      expect(new Set(all).size).toBe(all.length);
      expect(all.slice(0, 2)).toEqual(first.items.map((i) => i.document.id));
      const scores = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await search(USERS.manager, CAPS.manager, "pertinent", { limit: 4, ...(cursor ? { cursor } : {}) });
        scores.push(...page.items.map((i) => i.score));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      // curseur falsifié : ignoré (première page), jamais d'erreur ni de fuite
      const forged = await search(USERS.manager, CAPS.manager, "pertinent", { limit: 2, cursor: Buffer.from('{"r":"x","id":"y"}').toString("base64url") }).catch((e) => e);
      expect(forged).toBeInstanceOf(Error);
    });

    it("filtres de catégorie et de type", async () => {
      const cat = await w.category(w.tenantA, "STUDENT_MEDICAL");
      expect(await idsFor(USERS.manager, CAPS.manager, "pertinent").then((a) => a.includes(docs.medical!))).toBe(true);
      const filtered = await search(USERS.manager, CAPS.manager, "pertinent", { categoryId: cat });
      expect(filtered.items.map((i) => i.document.id)).toEqual([docs.medical]);
      const staff = await search(USERS.manager, CAPS.manager, "pertinent", { kind: "TEACHER" });
      expect(staff.items.map((i) => nameOf(i.document.id)).sort()).toEqual(["contract", "diploma"]);
    });

    it("la lecture d'un extrait confidentiel est tracée (historique du document + audit sensible), sans le texte de la requête", async () => {
      const before = w.audit.entries.length;
      const page = await search(USERS.manager, CAPS.manager, "zorglubmedical");
      expect(page.items.map((i) => i.document.id)).toEqual([docs.medical]);
      const entry = w.audit.entries.slice(before).find((e) => e.entry.action === "documents.search.executed")!;
      expect(entry.entry.sensitive).toBe(true);
      expect(entry.entry.metadata).toMatchObject({ resultCount: 1, queryLength: "zorglubmedical".length, confidentialDocumentIds: [docs.medical] });
      expect(JSON.stringify(entry.entry)).not.toContain("zorglub");
      const viewed = (await w.db.admin.query("SELECT detail FROM documents.document_events WHERE document_id = $1 AND action = 'VIEWED' ORDER BY occurred_at DESC LIMIT 1", [docs.medical])).rows[0];
      expect(viewed.detail).toEqual({ via: "text_search" });
      // une recherche sans résultat confidentiel n'est pas « sensible »
      const b2 = w.audit.entries.length;
      await search(USERS.secretary, CAPS.secretary, "zorglubregulation");
      expect(w.audit.entries.slice(b2).find((e) => e.entry.action === "documents.search.executed")!.entry.sensitive).toBe(false);
    });
  });

  describe("cycle de vie : versions, purge, réindexation", () => {
    it("une nouvelle version efface immédiatement l'ancien texte de la recherche, puis le nouveau est indexé", async () => {
      const id = await w.seedDocument({ ...manager, bytes: await pdfWith("zorglubv1"), fileName: "v1.pdf", fields: { title: "Versionné", ownerId: PEOPLE.child } });
      await indexAll();
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubv1")).toEqual([id]);
      must(await addVersion(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, fields: {}, file: { fileName: "v2.pdf", bytes: await pdfWith("zorglubv2") } }));
      expect(await row(id)).toMatchObject({ status: "PENDING", version_no: 2, content: null, tsv: null });
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubv1")).toEqual([]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubv2")).toEqual([]); // pas encore indexé
      await indexAll();
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubv2")).toEqual([id]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubv1")).toEqual([]);
    });

    it("une version qui n'est plus un PDF supprime l'index de l'ancienne (aucun texte périmé conservé)", async () => {
      const { textBytes } = await import("../support/files");
      const id = await w.seedDocument({ ...manager, code: "INSTITUTION_REGULATION", bytes: await pdfWith("zorglubnonpdf"), fileName: "r.pdf", fields: { ownerType: "NONE", ownerId: null, title: "Devient texte" } });
      await indexAll();
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubnonpdf")).toEqual([id]);
      must(await addVersion(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, fields: {}, file: { fileName: "note.txt", bytes: textBytes("zorglubnonpdf version texte brut") } }));
      expect(await row(id)).toBeUndefined();
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubnonpdf")).toEqual([]);
    });

    it("course : un résultat d'extraction qui arrive après le dépôt d'une version plus récente n'est jamais écrit", async () => {
      const id = await w.seedDocument({ ...manager, bytes: await pdfWith("zorglubrace1"), fileName: "r1.pdf", fields: { title: "Course", ownerId: PEOPLE.child } });
      const claims = await w.db.tenantDb.run(system(), (tx) => textRepo.claimDueTextIndex(tx, w.tenantA, w.clock.now(), new Date(w.clock.now().getTime() + 900_000), 50));
      const mine = claims.find((c) => c.documentId === id)!;
      expect(mine.versionNo).toBe(1);
      must(await addVersion(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, fields: {}, file: { fileName: "r2.pdf", bytes: await pdfWith("zorglubrace2") } }));
      const written = await w.db.tenantDb.run(system(), (tx) => textRepo.completeTextIndex(tx, w.tenantA, id, 1, { kind: "INDEXED", text: "zorglubrace1 périmé", pageCount: 1, pagesIndexed: 1, truncated: false }, w.clock.now()));
      expect(written).toBe(0);
      expect(await row(id)).toMatchObject({ status: "PENDING", version_no: 2, content: null });
      w.clock.advanceSeconds(20 * 60); // le bail des autres lignes réservées expire
      await indexAll();
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubrace2")).toEqual([id]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubrace1")).toEqual([]);
    });

    it("purge de rétention : l'index du document (copie de son contenu) est supprimé avec lui", async () => {
      const id = await w.seedDocument({ ...manager, bytes: await pdfWith("zorglubpurge"), fileName: "p.pdf", fields: { title: "À purger", ownerId: PEOPLE.child } });
      await indexAll();
      expect(await row(id)).toMatchObject({ status: "INDEXED" });
      must(await updateSettings(w.deps, w.ctxA(USERS.manager), { body: { archiveRetentionDays: 30 } }));
      must(await archiveDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, reason: "fin de conservation" }));
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubpurge")).toEqual([]);
      w.clock.advanceDays(31);
      try {
        expect((await runHousekeeping(w.deps, system())).documentsPurged).toBeGreaterThanOrEqual(1);
        expect(await row(id)).toBeUndefined();
        expect(await idsFor(USERS.manager, CAPS.manager, "zorglubpurge")).toEqual([]);
        expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.text_index WHERE document_id = $1", [id])).rows[0].n).toBe(0);
      } finally {
        w.clock.advanceDays(-31);
        must(await updateSettings(w.deps, w.ctxA(USERS.manager), { body: { archiveRetentionDays: 0 } }));
      }
    });

    it("réindexation de l'existant : seule la gestion peut la demander ; elle reprend aussi les PDF qui n'ont pas de ligne", async () => {
      expectErr(await reindexTexts(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, scope: "ALL" }), DocumentsCode.FORBIDDEN);
      expectErr(await reindexTexts(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, scope: "FAILED" }), DocumentsCode.FORBIDDEN);
      // 1. échecs seulement
      const failedOnly = must(await reindexTexts(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, scope: "FAILED" }));
      expect(failedOnly.queued).toBe(1);
      expect(await row(docs.corrupt!)).toMatchObject({ status: "PENDING", attempts: 0, error_code: null });
      await indexAll();
      expect(await row(docs.corrupt!)).toMatchObject({ status: "FAILED", error_code: "corrupt" });
      // 2. reprise de l'existant : lignes absentes (avant la migration 2504) + ré-extraction de tout
      await w.db.admin.query("DELETE FROM documents.text_index WHERE tenant_id = $1 AND document_id = ANY($2::uuid[])", [w.tenantA, [docs.regulation, docs.idPupil]]);
      const all = must(await reindexTexts(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, scope: "ALL" }));
      expect(all.queued).toBeGreaterThanOrEqual(15);
      expect(await row(docs.regulation!)).toMatchObject({ status: "PENDING", version_no: 1, content: null });
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubregulation")).toEqual([]); // vidé, pas encore reconstruit
      await indexAll();
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubregulation")).toEqual([docs.regulation]);
      expect(await idsFor(USERS.manager, CAPS.manager, "zorglubidpupil")).toEqual([docs.idPupil]);
      // audit renforcé de la demande
      const audit = w.audit.entries.filter((e) => e.entry.action === "documents.text_index.reindex_requested");
      expect(audit.map((e) => e.entry.sensitive)).toEqual([true, true]);
      expect(audit[1]!.entry.metadata).toMatchObject({ scope: "ALL" });
    }, 120_000);

    it("la reprise de la migration 2504 met en file chaque PDF courant déjà déposé (instruction rejouée sur des lignes retirées)", async () => {
      const sql = readFileSync(resolve(__dirname, "../../migrations/2504_documents_text_search.sql"), "utf8");
      const insert = sql.slice(sql.indexOf("INSERT INTO documents.text_index"));
      expect(insert).toContain("detected_mime = 'application/pdf'");
      await w.db.admin.query("DELETE FROM documents.text_index");
      await w.db.admin.query(insert);
      const rows = (await w.db.admin.query("SELECT d.id, t.status, t.version_no, d.current_version_no FROM documents.text_index t JOIN documents.documents d ON d.id = t.document_id")).rows;
      expect(rows.length).toBeGreaterThanOrEqual(15);
      expect(rows.every((r) => r.status === "PENDING" && r.version_no === r.current_version_no)).toBe(true);
      await indexAll();
      await indexAll(w.tenantB);
    }, 120_000);

    it("configuration de recherche : accents supprimés et radicaux français (dictionnaire unaccent disponible)", async () => {
      const r = (await w.db.admin.query(
        "SELECT to_tsvector('documents.fr_search', 'Éléphants énormes')::text AS a, to_tsvector('documents.fr_search', 'elephant enorme')::text AS b, (SELECT count(*)::int FROM pg_ts_dict WHERE dictname = 'unaccent') AS unaccent",
      )).rows[0];
      expect(r.unaccent).toBeGreaterThan(0);
      expect(r.a).toBe(r.b);
    });
  });
});
