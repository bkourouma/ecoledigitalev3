/**
 * Intégration réelle (Postgres, rôle applicatif soumis à la RLS) : isolation A/B, jeu de catégories, dépôt, versions
 * immuables, téléchargement par URL signée, prévisualisation, historique, atomicité. S'ignore sans TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import allowlist from "../../../isolation-allowlist.documents";
import { createDocumentsDeps } from "../../application/deps";
import { getMyContext, listCategories } from "../../application/categories";
import { getDocument, getDownloadUrl, getHistory, getPreview, listDocuments } from "../../application/documents";
import { addVersion } from "../../application/uploads";
import { DEFAULT_CATEGORIES } from "../../domain/default-categories";
import { DocumentsCode } from "../../domain/errors";
import { sha256Hex } from "../../domain/file-policy";
import { describeIntegration } from "../support/db";
import { expectErr, must } from "../support/assert";
import { docxBytes, jpegBytes, pdfBytes, textBytes, uniquePdf } from "../support/files";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

describeIntegration("module documents : base réelle", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.drop();
  });

  it("assertTenantIsolation : chaque table du schéma documents est isolée par tenant (RLS forcée)", async () => {
    const report = await assertTenantIsolation({ pool: w.db.appPool, schemas: ["documents"], allowlist: allowlist.map((e) => e.table) });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
  });

  it("jeu de catégories de départ : créé à la première lecture, idempotent, propre à chaque tenant ; drapeau canUpload par acteur", async () => {
    const first = must(await listCategories(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary }));
    expect(first).toHaveLength(DEFAULT_CATEGORIES.length);
    const again = must(await listCategories(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary }));
    expect(again).toHaveLength(DEFAULT_CATEGORIES.length);
    expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.categories WHERE tenant_id = $1", [w.tenantA])).rows[0].n).toBe(DEFAULT_CATEGORIES.length);
    expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.settings WHERE tenant_id = $1", [w.tenantA])).rows[0].n).toBe(1);

    const byCode = new Map(first.map((c) => [c.code, c]));
    expect(byCode.get("STUDENT_IDENTITY")?.canUpload).toBe(true);
    expect(byCode.get("STUDENT_MEDICAL")?.canUpload).toBe(false); // CONFIDENTIAL : le secrétariat n'y dépose pas
    expect(byCode.get("FINANCIAL_ACCOUNTING")?.canUpload).toBe(false);
    expect(byCode.get("STUDENT_IDENTITY")?.documentCount).toBeNull(); // compteurs réservés aux gestionnaires

    const parent = must(await listCategories(w.deps, w.ctxA(USERS.parent), { caps: CAPS.parent }));
    const parentByCode = new Map(parent.map((c) => [c.code, c]));
    expect(parentByCode.get("STUDENT_IDENTITY")?.canUpload).toBe(true); // dépôt par le propriétaire autorisé + enfant lié
    expect(parentByCode.get("STAFF_CONTRACT")?.canUpload).toBe(false);
    expect(parentByCode.get("INSTITUTION_REGULATION")?.canUpload).toBe(false);

    // Un tenant n'a que SES catégories.
    expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.categories WHERE tenant_id = $1", [w.tenantB])).rows[0].n).toBe(0);
    must(await listCategories(w.deps, w.ctxB(USERS.manager), { caps: CAPS.manager }));
    expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.categories WHERE tenant_id = $1", [w.tenantB])).rows[0].n).toBe(DEFAULT_CATEGORIES.length);
  });

  it("dépôt : document + version 1, objet sous une clé propre à la version, événement sans titre, audit, historique", async () => {
    const id = await w.seedDocument({ fields: { title: "CNI de Awa Secret", tags: ["identité"], metadata: { numero: "CI-998877" } }, fileName: "Cni Awa.pdf" });
    const detail = must(await getDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id }));
    expect(detail).toMatchObject({ kind: "STUDENT", currentVersionNo: 1, versionCount: 1, status: "ACTIVE", ownerName: "Enfant A", fileName: "Cni Awa.pdf", extension: "pdf", mime: "application/pdf", previewKind: "PDF", categoryCode: "STUDENT_IDENTITY" });
    expect(detail.access).toMatchObject({ write: true, share: true, archive: false, history: true });
    expect(detail.access.via).toContain("UPLOADER");
    expect(detail.versions).toHaveLength(1);
    const v1 = detail.versions[0]!;
    expect(v1).toMatchObject({ versionNo: 1, current: true, scanStatus: "CLEAN", state: "ACTIVE" });
    expect(w.ports.storage.objects.has(`documents/${w.tenantA}/${id}/1-${v1.sha256.slice(0, 12)}`)).toBe(true);

    const events = await w.db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY occurred_at", [id]);
    expect(events.rows.map((r) => r.type)).toEqual(["documents.document.created"]);
    const serialized = JSON.stringify(events.rows[0].payload);
    expect(events.rows[0].payload).toMatchObject({ v: 1, documentId: id, kind: "STUDENT", ownerType: "STUDENT", ownerId: PEOPLE.child, versionNo: 1, createdBy: USERS.secretary });
    expect(serialized).not.toContain("Awa Secret");
    expect(serialized).not.toContain("Cni Awa");
    expect(w.audit.actions()).toEqual(expect.arrayContaining(["documents.document.created", "documents.document.read"]));
    for (const e of w.audit.entries) expect(JSON.stringify(e.entry)).not.toContain("Awa Secret"); // jamais de titre dans l'audit

    const history = await w.db.admin.query("SELECT action FROM documents.document_events WHERE document_id = $1 ORDER BY occurred_at, id", [id]);
    expect(history.rows.map((r) => r.action)).toEqual(["CREATED", "VIEWED"]);
  });

  it("AC-3 versions : remplacer crée la version 2, la version 1 reste téléchargeable, un doublon et un conflit sont refusés", async () => {
    const first = uniquePdf();
    const id = await w.seedDocument({ bytes: first });
    const ctx = w.ctxA(USERS.secretary);
    const second = uniquePdf();
    const v2 = must(await addVersion(w.deps, ctx, { caps: CAPS.secretary, documentId: id, fields: { note: "recto verso" }, file: { fileName: "nouvelle version.pdf", bytes: second } }));
    expect(v2).toMatchObject({ currentVersionNo: 2, versionCount: 2, fileName: "nouvelle version.pdf" });
    expect(v2.versions.map((v) => [v.versionNo, v.current])).toEqual([[2, true], [1, false]]);
    expect(v2.versions[0]?.note).toBe("recto verso");

    // la version 1 reste téléchargeable, avec SES octets
    const url1 = must(await getDownloadUrl(w.deps, ctx, { caps: CAPS.secretary, documentId: id, versionNo: 1 }));
    expect(url1.versionNo).toBe(1);
    expect(sha256Hex(w.ports.storage.resolve(url1.url)!.bytes)).toBe(sha256Hex(first));
    const urlCurrent = must(await getDownloadUrl(w.deps, ctx, { caps: CAPS.secretary, documentId: id }));
    expect(urlCurrent.versionNo).toBe(2);
    expect(sha256Hex(w.ports.storage.resolve(urlCurrent.url)!.bytes)).toBe(sha256Hex(second));

    expectErr(await addVersion(w.deps, ctx, { caps: CAPS.secretary, documentId: id, fields: {}, file: { fileName: "encore.pdf", bytes: second } }), DocumentsCode.VERSION_IDENTICAL);
    expectErr(await addVersion(w.deps, ctx, { caps: CAPS.secretary, documentId: id, fields: { baseVersion: 1 }, file: { fileName: "v3.pdf", bytes: uniquePdf() } }), DocumentsCode.VERSION_CONFLICT);
    const v3 = must(await addVersion(w.deps, ctx, { caps: CAPS.secretary, documentId: id, fields: { baseVersion: 2 }, file: { fileName: "v3.pdf", bytes: uniquePdf() } }));
    expect(v3.currentVersionNo).toBe(3);
    expectErr(await getDownloadUrl(w.deps, ctx, { caps: CAPS.secretary, documentId: id, versionNo: 9 }), DocumentsCode.VERSION_NOT_FOUND);

    const events = await w.db.admin.query("SELECT type FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY occurred_at", [id]);
    expect(events.rows.map((r) => r.type)).toEqual(["documents.document.created", "documents.document.version_added", "documents.document.version_added"]);
  });

  it("AC-3 immuabilité : aucune version ni ligne d'historique ne se modifie ni ne se supprime, même pour le propriétaire de la base", async () => {
    const id = await w.seedDocument();
    const admin = w.db.admin;
    await expect(admin.query("UPDATE documents.versions SET sha256 = repeat('a', 64) WHERE document_id = $1", [id])).rejects.toThrow(/immuable/);
    await expect(admin.query("UPDATE documents.versions SET storage_key = 'documents/x' WHERE document_id = $1", [id])).rejects.toThrow(/immuable/);
    await expect(admin.query("UPDATE documents.versions SET file_name = 'autre.pdf' WHERE document_id = $1", [id])).rejects.toThrow(/nom de fichier/);
    await expect(admin.query("DELETE FROM documents.versions WHERE document_id = $1", [id])).rejects.toThrow(/suppression interdite/);
    await expect(admin.query("UPDATE documents.document_events SET action = 'VIEWED' WHERE document_id = $1", [id])).rejects.toThrow(/ajout seul/);
    await expect(admin.query("DELETE FROM documents.document_events WHERE document_id = $1", [id])).rejects.toThrow(/ajout seul/);
    await expect(admin.query("TRUNCATE documents.document_events")).rejects.toThrow(/ajout seul|cannot truncate/);
    // sous replication « replica » (contournement classique des déclencheurs) : ENABLE ALWAYS tient bon
    await admin.query("BEGIN");
    await admin.query("SET LOCAL session_replication_role = replica");
    await expect(admin.query("DELETE FROM documents.versions WHERE document_id = $1", [id])).rejects.toThrow(/suppression interdite/);
    await admin.query("ROLLBACK");
    // le rôle applicatif n'a même pas le droit de supprimer
    await expect(w.db.tenantDb.run(w.ctxA(USERS.manager), (tx) => tx.query("DELETE FROM documents.documents WHERE id = $1", [id]))).rejects.toThrow(/permission denied|droit/i);
    // seuls l'état (purge) et la rendition évoluent ; la purge se fait en une transition légale
    await admin.query("UPDATE documents.versions SET rendition_key = 'documents/r.pdf', rendition_at = now() WHERE document_id = $1", [id]);
  });

  it("AC-6 isolation : le tenant B ne voit, ne télécharge ni ne prévisualise un document du tenant A (404 identique, même pour sa gestion)", async () => {
    const id = await w.seedDocument();
    const ctxB = w.ctxB(USERS.manager);
    const missing = expectErr(await getDocument(w.deps, ctxB, { caps: CAPS.manager, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
    const unknown = expectErr(await getDocument(w.deps, ctxB, { caps: CAPS.manager, documentId: "0192f0a4-7b1e-7c3a-8d2e-00000000ffff" }), DocumentsCode.DOCUMENT_NOT_FOUND);
    expect(missing.message.replace(id, "X")).toBe(unknown.message.replace("0192f0a4-7b1e-7c3a-8d2e-00000000ffff", "X"));
    expectErr(await getDownloadUrl(w.deps, ctxB, { caps: CAPS.manager, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
    expectErr(await getPreview(w.deps, ctxB, { caps: CAPS.manager, documentId: id, officeEnabled: false }), DocumentsCode.DOCUMENT_NOT_FOUND);
    expectErr(await getHistory(w.deps, ctxB, { caps: CAPS.manager, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
    expect(must(await listDocuments(w.deps, ctxB, { caps: CAPS.manager, query: {} })).items.map((d) => d.id)).not.toContain(id);
    // SQL direct sous le contexte de B : aucune ligne de A, et l'insertion au nom de A est refusée par la RLS
    const seen = await w.db.tenantDb.run(ctxB, (tx) => tx.many("SELECT id FROM documents.documents WHERE id = $1", [id]));
    expect(seen).toHaveLength(0);
    await expect(
      w.db.tenantDb.run(ctxB, (tx) => tx.query("INSERT INTO documents.settings (tenant_id) VALUES ($1)", [w.tenantA])),
    ).rejects.toThrow();
    // un propriétaire inconnu de B (même identifiant qu'un élève de A) est refusé : l'annuaire est cloisonné par tenant
    w.ports.owners.addStudent(w.tenantA, "0192f0a4-7b1e-7c3a-8d2e-0000000000aa", "Seulement chez A");
    const cat = await w.category(w.tenantB, "STUDENT_IDENTITY");
    const { createDocument } = await import("../../application/uploads");
    expectErr(
      await createDocument(w.deps, ctxB, { caps: CAPS.manager, fields: { categoryId: cat, title: "x", ownerType: "STUDENT", ownerId: "0192f0a4-7b1e-7c3a-8d2e-0000000000aa", visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "a.pdf", bytes: uniquePdf() } }),
      DocumentsCode.OWNER_NOT_FOUND,
    );
  });

  it("une catégorie d'un autre tenant ne peut pas recevoir un dépôt (404)", async () => {
    const catOfB = await w.category(w.tenantB, "STUDENT_IDENTITY");
    const { createDocument } = await import("../../application/uploads");
    expectErr(
      await createDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, fields: { categoryId: catOfB, title: "x", ownerType: "STUDENT", ownerId: PEOPLE.child, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "a.pdf", bytes: uniquePdf() } }),
      DocumentsCode.CATEGORY_NOT_FOUND,
    );
  });

  it("AC-7 URL signée : durée courte, expirée refusée, chaque téléchargement audité et historisé", async () => {
    const id = await w.seedDocument();
    const ctx = w.ctxA(USERS.secretary);
    const before = w.audit.actions().filter((a) => a === "documents.document.downloaded").length;
    const signed = must(await getDownloadUrl(w.deps, ctx, { caps: CAPS.secretary, documentId: id }));
    expect(new Date(signed.expiresAt).getTime() - w.clock.now().getTime()).toBeLessThanOrEqual(300_000);
    expect(new Date(signed.expiresAt).getTime() - w.clock.now().getTime()).toBe(60_000);
    expect(signed.fileName).toBe("piece.pdf");
    expect(signed.mime).toBe("application/pdf");
    expect(w.ports.storage.resolve(signed.url)).not.toBeNull();
    w.clock.advanceSeconds(61);
    expect(w.ports.storage.resolve(signed.url)).toBeNull(); // URL expirée
    expect(w.ports.storage.resolve(signed.url.replace(/.$/, "x"))).toBeNull(); // signature altérée
    expect(w.audit.actions().filter((a) => a === "documents.document.downloaded").length).toBe(before + 1);
    const history = await w.db.admin.query("SELECT action, actor_id FROM documents.document_events WHERE document_id = $1 AND action = 'DOWNLOADED'", [id]);
    expect(history.rows).toEqual([{ action: "DOWNLOADED", actor_id: USERS.secretary }]);
  });

  it("prévisualisation : images, PDF et texte servis après contrôle d'accès ; Office refusé tant que la conversion est désactivée ; intégrité vérifiée", async () => {
    const ctx = w.ctxA(USERS.secretary);
    const img = await w.seedDocument({ fileName: "photo.jpg", bytes: jpegBytes(), fields: { title: "Photo" } });
    const p = must(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: img, officeEnabled: false }));
    expect(p).toMatchObject({ contentType: "image/jpeg", kind: "IMAGE", fileName: "photo.jpg", truncated: false });
    expect(Buffer.from(p.bytes).equals(Buffer.from(jpegBytes()))).toBe(true);

    const pdf = await w.seedDocument();
    expect(must(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: pdf, officeEnabled: false }))).toMatchObject({ contentType: "application/pdf", kind: "PDF" });

    const txt = await w.seedDocument({ code: "INSTITUTION_REGULATION", fileName: "regle.txt", bytes: textBytes("Règle n°1 : ponctualité."), fields: { ownerType: "NONE", ownerId: null } });
    expect(must(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: txt, officeEnabled: false }))).toMatchObject({ contentType: "text/plain; charset=utf-8", kind: "TEXT" });

    const office = await w.seedDocument({ code: "INSTITUTION_REGULATION", fileName: "reglement.docx", bytes: docxBytes([{ name: "word/n.xml", content: String(Math.random()) }]), fields: { ownerType: "NONE", ownerId: null } });
    expectErr(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: office, officeEnabled: false }), DocumentsCode.PREVIEW_UNAVAILABLE);
    // conversion activée (double) : PDF dérivé, conservé et réutilisé
    let calls = 0;
    (w.ports as { converter: unknown }).converter = { enabled: true, toPdf: async () => { calls += 1; return pdfBytes("% rendition"); } };
    const r1 = must(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: office, officeEnabled: true }));
    expect(r1).toMatchObject({ contentType: "application/pdf", kind: "PDF", fileName: "reglement.pdf" });
    must(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: office, officeEnabled: true }));
    expect(calls).toBe(1);
    (w.ports as { converter: unknown }).converter = { enabled: false, async toPdf() { return null; } };
    expectErr(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: office, officeEnabled: true }), DocumentsCode.PREVIEW_UNAVAILABLE);

    // intégrité : un objet altéré est refusé et signalé
    const victim = await w.seedDocument();
    const key = (await w.db.admin.query("SELECT storage_key FROM documents.versions WHERE document_id = $1", [victim])).rows[0].storage_key as string;
    const obj = w.ports.storage.objects.get(key)!;
    obj.bytes = new Uint8Array([...obj.bytes.slice(0, 20), 0x58, ...obj.bytes.slice(21)]);
    expectErr(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: victim, officeEnabled: false }), DocumentsCode.INTEGRITY_FAILED);
    const ev = await w.db.admin.query("SELECT type FROM kernel.domain_events WHERE aggregate_id = $1", [victim]);
    expect(ev.rows.map((r) => r.type)).toContain("documents.integrity.mismatch");
    // objet disparu
    w.ports.storage.objects.delete(key);
    expectErr(await getPreview(w.deps, ctx, { caps: CAPS.secretary, documentId: victim, officeEnabled: false }), DocumentsCode.OBJECT_MISSING);
  });

  it("historique : réservé à qui a la permission (ou au déposant), paginé, avec le nom de l'acteur", async () => {
    const id = await w.seedDocument();
    must(await getDownloadUrl(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id }));
    const page = must(await getHistory(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, limit: 1 }));
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items[0]?.action).toBe("DOWNLOADED");
    expect(page.items[0]?.actorName).toBe("secretary A");
    const next = must(await getHistory(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, limit: 5, cursor: page.nextCursor! }));
    expect(next.items.map((e) => e.action)).toEqual(["CREATED"]);
    // une enseignante qui voit le document sans droit d'historique ne le consulte pas
    const regulation = await w.seedDocument({ code: "INSTITUTION_REGULATION", fields: { ownerType: "NONE", ownerId: null } });
    expect(must(await getDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: regulation })).access.history).toBe(false);
    expectErr(await getHistory(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: regulation }), DocumentsCode.FORBIDDEN);
  });

  it("atomicité : si l'audit échoue, ni ligne, ni événement, ni objet ne subsistent (l'objet est supprimé)", async () => {
    const failing = createDocumentsDeps({
      db: w.db.tenantDb,
      clock: w.clock,
      ports: w.ports,
      audit: { record: async () => { throw new Error("audit indisponible"); } },
    });
    const categoryId = await w.category(w.tenantA, "STUDENT_IDENTITY");
    const { createDocument } = await import("../../application/uploads");
    const bytes = uniquePdf();
    const before = w.ports.storage.objects.size;
    await expect(
      createDocument(failing, w.ctxA(USERS.secretary), { caps: CAPS.secretary, fields: { categoryId, title: "Annulé", ownerType: "STUDENT", ownerId: PEOPLE.child, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "a.pdf", bytes } }),
    ).rejects.toThrow(/audit indisponible/);
    expect((await w.db.admin.query("SELECT 1 FROM documents.documents WHERE title = 'Annulé'")).rowCount).toBe(0);
    expect(w.ports.storage.objects.size).toBe(before);
    expect(w.ports.storage.deleted.some((k) => k.includes(`documents/${w.tenantA}/`))).toBe(true);
  });

  it("contexte de l'appelant : capacités, liens relus à chaque appel (jamais d'un jeton), politique d'upload et antivirus", async () => {
    const ctx = must(await getMyContext(w.deps, w.ctxA(USERS.parent), { caps: CAPS.parent, officePreview: true }));
    expect(ctx.caps).toMatchObject({ childRead: true, childUpload: true, read: false, manage: false });
    expect(ctx.links).toMatchObject({ childStudentIds: [PEOPLE.child], children: [{ id: PEOPLE.child, displayName: "Enfant A" }], studentId: null, staffId: null });
    expect(ctx.upload.defaultMaxBytes).toBe(15 * 1024 * 1024);
    expect(ctx.scanner).toEqual({ enabled: true, failClosed: false });
    expect(ctx.officePreview).toBe(false); // convertisseur absent : jamais annoncé
    // le lien est relu : retirer le lien coupe l'accès à l'appel suivant
    w.ports.owners.setLinks(w.tenantA, USERS.parent2, {});
    expect(must(await getMyContext(w.deps, w.ctxA(USERS.parent2), { caps: CAPS.parent, officePreview: false })).links.childStudentIds).toEqual([]);
    w.ports.owners.setLinks(w.tenantA, USERS.parent2, { childStudentIds: [PEOPLE.other] });
  });
});
