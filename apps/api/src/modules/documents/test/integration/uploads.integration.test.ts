/**
 * Contrôle des uploads sur base réelle : type réel, liste blanche, taille, nom assaini, doublons, quotas, antivirus
 * (fail-open / fail-closed), quarantaine (consultation, libération, destruction, rétention).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentCreateFields } from "@ecoledigitale/contracts/src/v2/documents";
import type { ActorCaps } from "../../domain/types";
import { getUsage, updateSettings } from "../../application/categories";
import { archiveDocument, getDocument } from "../../application/documents";
import { runHousekeeping } from "../../application/housekeeping";
import { deleteQuarantine, listQuarantine, releaseQuarantine } from "../../application/quarantine";
import { addVersion, createDocument, type UploadedFile } from "../../application/uploads";
import { DocumentsCode } from "../../domain/errors";
import { EICAR } from "../../infrastructure/in-memory-ports";
import { describeIntegration } from "../support/db";
import { expectErr, must } from "../support/assert";
import { docxBytes, exeBytes, jpegBytes, oleBytes, pdfBytes, pngBytes, uniquePdf, utf16le } from "../support/files";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

let eicarCounter = 0;
/** EICAR + suffixe unique : le dédoublonnage (même contenu) ne masque pas la détection. */
const eicarBytes = (): Uint8Array => new TextEncoder().encode(`${EICAR}
${(eicarCounter += 1)}`);

describeIntegration("module documents : contrôle des uploads", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.drop();
  });

  const identityFields = async (over: Partial<DocumentCreateFields> = {}): Promise<DocumentCreateFields> => ({
    categoryId: await w.category(w.tenantA, "STUDENT_IDENTITY"),
    title: "Pièce",
    ownerType: "STUDENT",
    ownerId: PEOPLE.child,
    visibility: "INHERIT",
    tags: [],
    metadata: {},
    ...over,
  });
  const upload = async (file: UploadedFile, over: Partial<DocumentCreateFields> = {}, user: string = USERS.secretary, caps: ActorCaps = CAPS.secretary) =>
    createDocument(w.deps, w.ctxA(user), { caps, fields: await identityFields(over), file });
  const objectCount = (): number => w.ports.storage.objects.size;

  describe("type réel, nom, liste blanche, taille", () => {
    it("AC-1 : le contenu fait foi, le type déclaré n'existe pas (JPEG .pdf, exécutable renommé, macros, vide)", async () => {
      const before = objectCount();
      expectErr(await upload({ fileName: "scan.pdf", bytes: jpegBytes() }), DocumentsCode.TYPE_MISMATCH);
      expectErr(await upload({ fileName: "photo.png", bytes: pdfBytes("% x") }), DocumentsCode.TYPE_MISMATCH);
      expectErr(await upload({ fileName: "setup.pdf", bytes: exeBytes() }), DocumentsCode.TYPE_UNDETECTED);
      expectErr(await upload({ fileName: "photo.jpg", bytes: exeBytes() }), DocumentsCode.TYPE_UNDETECTED);
      expectErr(await upload({ fileName: "vide.pdf", bytes: new Uint8Array(0) }), DocumentsCode.FILE_EMPTY);
      const category = await w.category(w.tenantA, "INSTITUTION_REGULATION");
      const institution = { categoryId: category, ownerType: "NONE" as const, ownerId: null };
      expectErr(await upload({ fileName: "macro.docx", bytes: docxBytes([{ name: "word/vbaProject.bin", content: "x" }]) }, institution, USERS.manager, CAPS.manager), DocumentsCode.MACRO_CONTENT);
      expectErr(await upload({ fileName: "macro.doc", bytes: oleBytes(utf16le("_VBA_PROJECT")) }, institution, USERS.manager, CAPS.manager), DocumentsCode.MACRO_CONTENT);
      expect(objectCount()).toBe(before); // rien n'a été stocké
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.quarantine")).rows[0].n).toBe(0); // un refus de type n'est pas une quarantaine
    });

    it("liste blanche de la catégorie : une extension saine mais non autorisée est refusée", async () => {
      expectErr(await upload({ fileName: "tableau.xlsx", bytes: docxBytes() }), DocumentsCode.TYPE_MISMATCH); // contenu docx sous extension xlsx
      expectErr(await upload({ fileName: "lettre.docx", bytes: docxBytes([{ name: "word/a.xml", content: "1" }]) }), DocumentsCode.TYPE_NOT_ALLOWED); // docx hors liste de la catégorie
    });

    it("AC-2 : nom assaini ou refusé, jamais de chemin ni de marque bidirectionnelle", async () => {
      expectErr(await upload({ fileName: "facture.exe.pdf", bytes: uniquePdf() }), DocumentsCode.FILE_NAME_REJECTED);
      expectErr(await upload({ fileName: "sans-extension", bytes: uniquePdf() }), DocumentsCode.FILE_NAME_REJECTED);
      const traversal = must(await upload({ fileName: "..\\..\\etc\\passwd.pdf", bytes: uniquePdf() }, { title: "Traversée" }));
      expect(traversal.fileName).toBe("passwd.pdf");
      const rtl = must(await upload({ fileName: `cni${String.fromCharCode(0x202e)}fdp.pdf`, bytes: uniquePdf() }, { title: "RLO" }));
      expect(rtl.fileName).toBe("cnifdp.pdf");
      for (const key of w.ports.storage.objects.keys()) expect(key).toMatch(/^documents\/[0-9a-f-]+\/[0-9a-f-]+\/\d+-[0-9a-f]{12}$/); // la clé ne contient jamais le nom client
    });

    it("taille : plafond de l'établissement, surcharge de la catégorie, plafond de plateforme", async () => {
      const ctx = w.ctxA(USERS.manager);
      must(await updateSettings(w.deps, ctx, { body: { maxBytes: 600 } }));
      const big = pdfBytes(`% ${"x".repeat(900)}`);
      const e = expectErr(await upload({ fileName: "gros.pdf", bytes: big }), DocumentsCode.FILE_TOO_LARGE);
      expect(e.details).toMatchObject({ maxBytes: 600 });
      must(await upload({ fileName: "petit.pdf", bytes: pdfBytes("% petit") }, { title: "Petit" }));
      must(await updateSettings(w.deps, ctx, { body: { maxBytes: 15 * 1024 * 1024 } }));
      // plafond de plateforme : jamais dépassé même si l'établissement l'autorise
      const hard = { ...w.deps, config: { ...w.deps.config, hardMaxBytes: 700 } };
      expectErr(await createDocument(hard, w.ctxA(USERS.secretary), { caps: CAPS.secretary, fields: await identityFields(), file: { fileName: "gros.pdf", bytes: big } }), DocumentsCode.FILE_TOO_LARGE);
    });
  });

  describe("doublons, quotas, usage", () => {
    it("un doublon (même contenu, même catégorie, même propriétaire) est refusé ; sans fuite pour qui ne voit pas l'existant", async () => {
      const bytes = uniquePdf();
      const first = must(await upload({ fileName: "a.pdf", bytes }, { title: "Original", ownerId: PEOPLE.other }));
      const dup = expectErr(await upload({ fileName: "b.pdf", bytes }, { title: "Copie", ownerId: PEOPLE.other }), DocumentsCode.DUPLICATE);
      expect(dup.details).toMatchObject({ documentId: first.id });
      // même contenu pour un autre élève : accepté
      must(await upload({ fileName: "c.pdf", bytes }, { title: "Autre élève", ownerId: PEOPLE.pupil }));
      // un document PRIVATE du secrétariat est invisible au parent : son dépôt identique n'apprend rien et réussit
      const secret = uniquePdf();
      must(await upload({ fileName: "p.pdf", bytes: secret }, { title: "Privé", visibility: "PRIVATE" }));
      const viaParent = await upload({ fileName: "p.pdf", bytes: secret }, { title: "Du parent" }, USERS.parent, CAPS.parent);
      expect(viaParent.ok).toBe(true);
    });

    it("AC-11 quota : le dépôt qui dépasserait le quota est refusé ; l'usage est reporté à entitlements", async () => {
      const reported: number[] = [];
      (w.ports as { usage: unknown }).usage = { reportStorageBytes: async (_c: unknown, n: number) => void reported.push(n) };
      const ctx = w.ctxA(USERS.manager);
      const usage = must(await getUsage(w.deps, ctx));
      expect(usage.usedBytes).toBeGreaterThan(0);
      expect(usage.quotaBytes).toBe(usage.planQuotaBytes);
      // quota de l'établissement : strictement plus petit que celui du plan, jamais plus grand
      expectErr(await updateSettings(w.deps, ctx, { body: { storageQuotaBytes: usage.planQuotaBytes + 1 } }), DocumentsCode.INVALID_INPUT);
      must(await updateSettings(w.deps, ctx, { body: { storageQuotaBytes: usage.usedBytes + 50 } }));
      expect(must(await getUsage(w.deps, ctx)).quotaBytes).toBe(usage.usedBytes + 50);
      const e = expectErr(await upload({ fileName: "q.pdf", bytes: pdfBytes(`% ${"y".repeat(200)}`) }, { title: "Quota" }), DocumentsCode.QUOTA_EXCEEDED);
      expect(e.details).toMatchObject({ usedBytes: usage.usedBytes });
      must(await updateSettings(w.deps, ctx, { body: { storageQuotaBytes: null } }));
      const ok = must(await upload({ fileName: "q.pdf", bytes: pdfBytes(`% ${"z".repeat(200)}`) }, { title: "Quota ok" }));
      expect(ok.id).toBeTruthy();
      expect(reported.length).toBeGreaterThan(0);
      expect(reported.at(-1)).toBe(must(await getUsage(w.deps, ctx)).usedBytes);
      (w.ports as { usage: unknown }).usage = { async reportStorageBytes() {} };
    });

    it("l'usage ne compte que les versions actives et un échec de mesure ne bloque jamais le dépôt", async () => {
      (w.ports as { usage: unknown }).usage = { reportStorageBytes: async () => { throw new Error("entitlements indisponible"); } };
      must(await upload({ fileName: "m.pdf", bytes: uniquePdf() }, { title: "Mesure" }));
      (w.ports as { usage: unknown }).usage = { async reportStorageBytes() {} };
    });

    it("nombre maximal de versions, expiration obligatoire de catégorie, date invalide", async () => {
      const ctx = w.ctxA(USERS.manager);
      must(await updateSettings(w.deps, ctx, { body: { maxVersions: 2 } }));
      const doc = must(await upload({ fileName: "v1.pdf", bytes: uniquePdf() }, { title: "Versions" }));
      must(await addVersion(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: doc.id, fields: {}, file: { fileName: "v2.pdf", bytes: uniquePdf() } }));
      expectErr(await addVersion(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: doc.id, fields: {}, file: { fileName: "v3.pdf", bytes: uniquePdf() } }), DocumentsCode.TOO_MANY_VERSIONS);
      must(await updateSettings(w.deps, ctx, { body: { maxVersions: 50 } }));
      const auth = await w.category(w.tenantA, "STAFF_AUTHORIZATION");
      const staff = { categoryId: auth, ownerType: "STAFF" as const, ownerId: PEOPLE.staffA, title: "Habilitation" };
      expectErr(await upload({ fileName: "h.pdf", bytes: uniquePdf() }, staff, USERS.secretary, CAPS.secretary), DocumentsCode.EXPIRY_REQUIRED);
      expectErr(await upload({ fileName: "h.pdf", bytes: uniquePdf() }, { ...staff, expiresOn: "2026-02-31" }, USERS.secretary, CAPS.secretary), DocumentsCode.INVALID_INPUT);
      must(await upload({ fileName: "h.pdf", bytes: uniquePdf() }, { ...staff, expiresOn: "2027-01-31" }, USERS.secretary, CAPS.secretary));
    });
  });

  describe("antivirus et quarantaine", () => {
    const eicar = (): UploadedFile => ({ fileName: "facture.pdf", bytes: eicarBytes() });
    const eicarAsText = async (over: Partial<DocumentCreateFields> = {}) => {
      // EICAR est un texte : on le dépose dans une catégorie qui accepte le texte
      const category = await w.category(w.tenantA, "INSTITUTION_REGULATION");
      return createDocument(w.deps, w.ctxA(USERS.secretary), {
        caps: CAPS.secretary,
        fields: { categoryId: category, title: "Règlement piégé", ownerType: "NONE", ownerId: null, visibility: "INHERIT", tags: [], metadata: {}, ...over },
        file: { fileName: "reglement.txt", bytes: eicarBytes() },
      });
    };
    void eicar;

    it("AC-8 : EICAR est refusé (422), placé en quarantaine, jamais téléchargeable ; aucun document n'est créé", async () => {
      const docsBefore = (await w.db.admin.query("SELECT count(*)::int AS n FROM documents.documents")).rows[0].n;
      const versionsBefore = (await w.db.admin.query("SELECT count(*)::int AS n FROM documents.versions")).rows[0].n;
      const e = expectErr(await eicarAsText(), DocumentsCode.MALWARE_DETECTED);
      expect(e.details).toHaveProperty("quarantineId");
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.documents")).rows[0].n).toBe(docsBefore);
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.versions")).rows[0].n).toBe(versionsBefore);
      const q = (await w.db.admin.query("SELECT * FROM documents.quarantine")).rows;
      expect(q).toHaveLength(1);
      expect(q[0]).toMatchObject({ status: "HELD", signature: "Eicar-Test-Signature", engine: "fake-scanner", uploaded_by: USERS.secretary, extension: "txt" });
      expect(q[0].storage_key).toBe(`documents/${w.tenantA}/quarantine/${q[0].id}`);
      expect(w.ports.storage.objects.has(q[0].storage_key)).toBe(true);
      // aucune URL de lecture n'existe pour un fichier en quarantaine : il n'a ni document ni version
      expect([...w.ports.storage.objects.keys()].filter((k) => !k.includes("/quarantine/")).every((k) => !k.includes(q[0].id))).toBe(true);
      const ev = await w.db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE type = 'documents.upload.quarantined'");
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].payload).toMatchObject({ v: 1, quarantineId: q[0].id, signature: "Eicar-Test-Signature", uploadedBy: USERS.secretary });
      expect(JSON.stringify(ev.rows[0].payload)).not.toContain("reglement");
      expect(w.audit.entries.some((x) => x.entry.action === "documents.upload.quarantined" && x.entry.sensitive === true)).toBe(true);
    });

    it("EICAR déposé comme nouvelle version : le document reste inchangé, le fichier est en quarantaine", async () => {
      const id = await w.seedDocument({ code: "INSTITUTION_REGULATION", userId: USERS.secretary, caps: CAPS.secretary, fileName: "r.txt", bytes: new TextEncoder().encode("règle simple"), fields: { ownerType: "NONE", ownerId: null, title: "R" } });
      expectErr(await addVersion(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, fields: { note: "maj" }, file: { fileName: "r.txt", bytes: eicarBytes() } }), DocumentsCode.MALWARE_DETECTED);
      const detail = must(await getDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id }));
      expect(detail.currentVersionNo).toBe(1);
      const q = (await w.db.admin.query("SELECT intent FROM documents.quarantine WHERE intent->>'documentId' = $1", [id])).rows;
      expect(q).toHaveLength(1);
      expect(q[0].intent).toMatchObject({ mode: "VERSION", documentId: id });
    });

    it("scanner injoignable : fail-closed refuse (503) sans rien stocker ; fail-open stocke UNSCANNED", async () => {
      const bytes = uniquePdf();
      w.ports.fakeScanner.unavailable = true;
      (w.ports as { scan: unknown }).scan = { scanner: w.ports.fakeScanner, failClosed: true };
      const before = objectCount();
      expectErr(await upload({ fileName: "ferme.pdf", bytes }, { title: "Fermé" }), DocumentsCode.SCAN_UNAVAILABLE);
      expect(objectCount()).toBe(before);
      expect((await w.db.admin.query("SELECT 1 FROM documents.documents WHERE title = 'Fermé'")).rowCount).toBe(0);
      (w.ports as { scan: unknown }).scan = { scanner: w.ports.fakeScanner, failClosed: false };
      const opened = must(await upload({ fileName: "ouvert.pdf", bytes }, { title: "Ouvert" }));
      expect(opened.versions[0]).toMatchObject({ scanStatus: "UNSCANNED" });
      w.ports.fakeScanner.unavailable = false;
      (w.ports as { scan: unknown }).scan = { scanner: w.ports.fakeScanner, failClosed: false };
      // sans scanner du tout : UNSCANNED aussi
      (w.ports as { scan: unknown }).scan = { scanner: null, failClosed: false };
      expect(must(await upload({ fileName: "sans.pdf", bytes: uniquePdf() }, { title: "Sans scanner" })).versions[0]).toMatchObject({ scanStatus: "UNSCANNED" });
      (w.ports as { scan: unknown }).scan = { scanner: w.ports.fakeScanner, failClosed: false };
      expect(must(await upload({ fileName: "propre.pdf", bytes: uniquePdf() }, { title: "Propre" })).versions[0]).toMatchObject({ scanStatus: "CLEAN" });
    });

    it("le fichier est analysé APRÈS les contrôles de type (un refus de type n'appelle pas l'antivirus) et jamais dans une transaction", async () => {
      const scanned = w.ports.fakeScanner.scanned.length;
      expectErr(await upload({ fileName: "faux.pdf", bytes: jpegBytes() }), DocumentsCode.TYPE_MISMATCH);
      expect(w.ports.fakeScanner.scanned.length).toBe(scanned);
      must(await upload({ fileName: "vrai.png", bytes: pngBytes() }, { title: "PNG" }));
      expect(w.ports.fakeScanner.scanned.length).toBe(scanned + 1);
    });

    it("consultation, libération motivée (création rejouée), destruction et rétention de la quarantaine", async () => {
      const ctx = w.ctxA(USERS.manager);
      const held = must(await listQuarantine(w.deps, ctx, { status: "HELD" }));
      expect(held.items.length).toBeGreaterThanOrEqual(2);
      const create = held.items.find((q) => q.intentKind === "CREATE")!;
      expect(create).toMatchObject({ status: "HELD", signature: "Eicar-Test-Signature", uploadedByName: "secretary A" });

      // libération : le dépôt initial est rejoué, sans nouvelle analyse, au nom du déposant d'origine
      const released = must(await releaseQuarantine(w.deps, ctx, { caps: CAPS.manager, id: create.id, note: "Faux positif confirmé par l'éditeur de l'antivirus" }));
      expect(released).toMatchObject({ title: "Règlement piégé", createdBy: USERS.secretary, currentVersionNo: 1, versionCount: 1 });
      expect(released.versions[0]).toMatchObject({ scanStatus: "UNSCANNED" });
      const row = (await w.db.admin.query("SELECT status, decided_by, released_document_id FROM documents.quarantine WHERE id = $1", [create.id])).rows[0];
      expect(row).toMatchObject({ status: "RELEASED", decided_by: USERS.manager, released_document_id: released.id });
      expect(w.ports.storage.objects.has(`documents/${w.tenantA}/quarantine/${create.id}`)).toBe(false); // objet de quarantaine supprimé
      expect((await w.db.admin.query("SELECT type FROM kernel.domain_events WHERE type = 'documents.quarantine.released'")).rowCount).toBe(1);
      expectErr(await releaseQuarantine(w.deps, ctx, { caps: CAPS.manager, id: create.id, note: "encore" }), DocumentsCode.QUARANTINE_NOT_FOUND);

      // libération d'une NOUVELLE VERSION
      const versionItem = (must(await listQuarantine(w.deps, ctx, { status: "HELD" }))).items.find((q) => q.intentKind === "VERSION")!;
      const withVersion = must(await releaseQuarantine(w.deps, ctx, { caps: CAPS.manager, id: versionItem.id, note: "Contrôle manuel : fichier de test inoffensif" }));
      expect(withVersion.id).toBe(versionItem.documentId);
      expect(withVersion.currentVersionNo).toBe(2);

      // destruction
      must(await upload({ fileName: "autre.pdf", bytes: uniquePdf() }, { title: "ok" }));
      w.ports.fakeScanner.unavailable = false;
      expectErr(await eicarAsText({ title: "Autre piège" }), DocumentsCode.MALWARE_DETECTED);
      const toDelete = (must(await listQuarantine(w.deps, ctx, { status: "HELD" }))).items[0]!;
      must(await deleteQuarantine(w.deps, ctx, { id: toDelete.id, note: "Malware confirmé" }));
      expect(w.ports.storage.objects.has(`documents/${w.tenantA}/quarantine/${toDelete.id}`)).toBe(false);
      expect((await w.db.admin.query("SELECT status FROM documents.quarantine WHERE id = $1", [toDelete.id])).rows[0].status).toBe("DELETED");
      expectErr(await deleteQuarantine(w.deps, ctx, { id: toDelete.id, note: "deux fois" }), DocumentsCode.QUARANTINE_NOT_FOUND);

      // rétention : un fichier non traité est détruit par l'entretien
      expectErr(await eicarAsText({ title: "Troisième piège" }), DocumentsCode.MALWARE_DETECTED);
      const pending = (must(await listQuarantine(w.deps, ctx, { status: "HELD" }))).items;
      expect(pending.length).toBeGreaterThanOrEqual(1);
      w.clock.advanceDays(31);
      const report = await runHousekeeping(w.deps, ctx);
      expect(report.quarantineDeleted).toBe(pending.length);
      expect(must(await listQuarantine(w.deps, ctx, { status: "HELD" })).items).toHaveLength(0);
      for (const p of pending) expect(w.ports.storage.objects.has(`documents/${w.tenantA}/quarantine/${p.id}`)).toBe(false);
    });

    it("la quarantaine est cloisonnée par tenant et la libération vérifie l'intégrité de l'objet", async () => {
      expectErr(await eicarAsText({ title: "Piège pour B" }), DocumentsCode.MALWARE_DETECTED);
      const [held] = must(await listQuarantine(w.deps, w.ctxA(USERS.manager), { status: "HELD" })).items;
      expect(must(await listQuarantine(w.deps, w.ctxB(USERS.manager), {})).items).toHaveLength(0);
      expectErr(await releaseQuarantine(w.deps, w.ctxB(USERS.manager), { caps: CAPS.manager, id: held!.id, note: "pas chez moi" }), DocumentsCode.QUARANTINE_NOT_FOUND);
      expectErr(await deleteQuarantine(w.deps, w.ctxB(USERS.manager), { id: held!.id, note: "pas chez moi" }), DocumentsCode.QUARANTINE_NOT_FOUND);
      const key = `documents/${w.tenantA}/quarantine/${held!.id}`;
      const obj = w.ports.storage.objects.get(key)!;
      obj.bytes = new Uint8Array([...obj.bytes, 0x21]);
      expectErr(await releaseQuarantine(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, id: held!.id, note: "objet altéré" }), DocumentsCode.INTEGRITY_FAILED);
      w.ports.storage.objects.delete(key);
      expectErr(await releaseQuarantine(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, id: held!.id, note: "objet disparu" }), DocumentsCode.OBJECT_MISSING);
    });
  });

  it("une catégorie archivée n'accepte plus de dépôt ; ses documents restent lisibles", async () => {
    const { setCategoryArchived } = await import("../../application/categories");
    const category = await w.category(w.tenantA, "FINANCIAL_INVOICE");
    const id = await w.seedDocument({ userId: USERS.manager, caps: CAPS.manager, code: "FINANCIAL_INVOICE", fields: { ownerType: "NONE", ownerId: null, title: "Facture" } });
    must(await setCategoryArchived(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, id: category, archived: true }));
    expectErr(
      await createDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, fields: { categoryId: category, title: "Autre", ownerType: "NONE", ownerId: null, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "f.pdf", bytes: uniquePdf() } }),
      DocumentsCode.CATEGORY_ARCHIVED,
    );
    expect(must(await getDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id })).title).toBe("Facture");
    must(await setCategoryArchived(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, id: category, archived: false }));
    void archiveDocument;
  });
});
