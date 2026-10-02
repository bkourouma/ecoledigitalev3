/**
 * Pièces de l'élève (stockage objet) : dépôt, consultation (URL signée, lecture auditée), remplacement (versions),
 * retrait, expiration, anonymisation, cloisonnement ; HTTP avec les vrais modèles de rôles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { peopleStudentDocumentDtoSchema, peopleStudentDocumentUrlDtoSchema, peopleEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/people";
import { changeStudentStatus, anonymizeStudent } from "../../application/students";
import {
  emitExpiringStudentDocuments,
  getStudentDocumentUrl,
  listStudentDocuments,
  removeStudentDocument,
  replaceStudentDocument,
  updateStudentDocument,
  uploadStudentDocument,
} from "../../application/documents";
import { updateSettings } from "../../application/settings";
import { documentExpiryState, safeDocumentFileName, sniffDocument } from "../../domain/files";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeStorage, JPEG_BYTES, PNG_BYTES } from "../support/fakes";
import { buildHarness, type HttpHarness } from "../support/http-harness";
import { count, mkStudent } from "../support/scenario";

const PDF_BYTES = Uint8Array.from([...Buffer.from("%PDF-1.7\n"), ...Buffer.from("1 0 obj<<>>endobj\n%%EOF")]);

describe("contrôle des fichiers (pur)", () => {
  it("le type vient des octets : PDF, JPEG, PNG, WebP ; le reste est refusé", () => {
    expect(sniffDocument(PDF_BYTES)).toBe("application/pdf");
    expect(sniffDocument(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffDocument(PNG_BYTES)).toBe("image/png");
    expect(sniffDocument(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffDocument(Buffer.from("MZ\x90\x00 programme"))).toBeNull();
    expect(sniffDocument(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffDocument(Buffer.from("PK\x03\x04archive"))).toBeNull();
    expect(sniffDocument(new Uint8Array())).toBeNull();
  });
  it("le nom affiché est sans chemin ni caractère de contrôle, avec l'extension du type RÉEL", () => {
    expect(safeDocumentFileName("..\\..\\etc/passwd.exe", "application/pdf")).toBe("passwd.pdf");
    expect(safeDocumentFileName("CNI recto.JPEG", "image/jpeg")).toBe("CNI recto.jpeg");
    expect(safeDocumentFileName("scan.pdf", "image/png")).toBe("scan.png");
    expect(safeDocumentFileName("   ", "application/pdf")).toBe("document.pdf");
    expect(safeDocumentFileName(`${"a".repeat(300)}.pdf`, "application/pdf").length).toBeLessThanOrEqual(200);
  });
  it("l'échéance se dérive à la lecture", () => {
    expect(documentExpiryState(null, "2025-09-01", 30)).toEqual({ state: "NO_EXPIRY", daysLeft: null });
    expect(documentExpiryState("2025-12-01", "2025-09-01", 30)).toMatchObject({ state: "VALID", daysLeft: 91 });
    expect(documentExpiryState("2025-09-20", "2025-09-01", 30)).toMatchObject({ state: "EXPIRING", daysLeft: 19 });
    expect(documentExpiryState("2025-09-01", "2025-09-01", 30)).toMatchObject({ state: "EXPIRING", daysLeft: 0 });
    expect(documentExpiryState("2025-08-31", "2025-09-01", 30)).toMatchObject({ state: "EXPIRED", daysLeft: -1 });
    expect(documentExpiryState("2025-09-20", "2025-09-01", null)).toMatchObject({ state: "VALID" });
  });
});

describeIntegration("pièces de l'élève (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let storage: FakeStorage;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;
  let http: HttpHarness;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    storage = new FakeStorage();
    world = makeWorld(db, { storage });
    tenant = await db.createTenant("docs");
    ctx = ctxFor(tenant);
    http = await buildHarness(world.deps, { tenant });
  });
  afterAll(async () => {
    await http?.close();
    await db.drop();
  });

  const upload = (studentId: string, over: Partial<{ typeCode: "ID_CARD" | "BIRTH_CERTIFICATE" | "MEDICAL_CERTIFICATE" | "OTHER"; fileName: string; issuedOn: string; expiresOn: string; title: string }> = {}, bytes: Uint8Array = PDF_BYTES) =>
    uploadStudentDocument(world.deps, ctx, studentId, bytes, { typeCode: "ID_CARD", fileName: "cni.pdf", ...over });

  it("dépôt : type réel, empreinte, clé opaque (jamais le nom du fichier), audit sans nom de fichier", async () => {
    const s = await mkStudent(world.deps, ctx);
    const doc = unwrap(await upload(s.id, { fileName: "CNI de Jean DUPONT.pdf", title: "Carte nationale", issuedOn: "2024-01-10", expiresOn: "2034-01-09" }));
    expect(peopleStudentDocumentDtoSchema.safeParse(doc).success).toBe(true);
    expect(doc).toMatchObject({ studentId: s.id, typeCode: "ID_CARD", contentType: "application/pdf", sizeBytes: PDF_BYTES.byteLength, version: 1, status: "ACTIVE", supersedesId: null, expiryState: "VALID" });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    const row = (await adminRows<{ object_key: string }>(db, "SELECT object_key FROM people.student_documents WHERE id = $1", [doc.id]))[0]!;
    expect(row.object_key).toBe(`tenants/${tenant}/people/students/${s.id}/documents/${doc.id}`);
    expect(row.object_key).not.toMatch(/DUPONT|cni/i);
    expect(storage.objects.get(row.object_key)?.contentType).toBe("application/pdf");
    const entry = world.audit.find("people.student.document_uploaded").at(-1)!;
    expect(entry.severity).toBe("notice");
    expect(JSON.stringify(entry)).not.toMatch(/DUPONT|Carte nationale/);
  });

  it("refus : fichier vide, trop gros, format inconnu (SVG, exécutable, HTML déguisé en PDF), aucun stockage", async () => {
    const s = await mkStudent(world.deps, ctx);
    const before = storage.objects.size;
    expect(await upload(s.id, {}, new Uint8Array())).toMatchObject({ ok: false, error: { code: "people.invalid_document" } });
    expect(await upload(s.id, { fileName: "x.pdf" }, Buffer.from("<svg onload=alert(1)>"))).toMatchObject({ ok: false, error: { code: "people.invalid_document" } });
    expect(await upload(s.id, { fileName: "installer.pdf" }, Buffer.from("MZ\x90\x00\x03"))).toMatchObject({ ok: false, error: { code: "people.invalid_document" } });
    const small = makeWorld(db, { storage, config: { documentMaxBytes: 16 } });
    expect(await uploadStudentDocument(small.deps, ctx, s.id, PDF_BYTES, { typeCode: "ID_CARD", fileName: "a.pdf" })).toMatchObject({ ok: false, error: { code: "people.invalid_document" } });
    expect(storage.objects.size).toBe(before);
    expect(await count(db, "SELECT count(*) AS n FROM people.student_documents WHERE student_id = $1", [s.id])).toBe(0);
    expect(await upload(newId())).toMatchObject({ ok: false, error: { code: "people.student_not_found" } });
    // sans stockage : refus explicite, jamais de dépôt silencieux
    const bare = makeWorld(db);
    expect(await uploadStudentDocument(bare.deps, ctx, s.id, PDF_BYTES, { typeCode: "ID_CARD", fileName: "a.pdf" })).toMatchObject({ ok: false, error: { code: "people.storage_unavailable" } });
  });

  it("une seconde pièce du même type doit REMPLACER la première ; « autre » peut se répéter", async () => {
    const s = await mkStudent(world.deps, ctx);
    unwrap(await upload(s.id));
    expect(await upload(s.id, { fileName: "bis.pdf" })).toMatchObject({ ok: false, error: { code: "people.document_exists" } });
    unwrap(await upload(s.id, { typeCode: "OTHER", fileName: "a.pdf" }));
    unwrap(await upload(s.id, { typeCode: "OTHER", fileName: "b.pdf" }));
    expect(unwrap(await listStudentDocuments(world.deps, ctx, s.id)).filter((d) => d.typeCode === "OTHER")).toHaveLength(2);
  });

  it("l'échec de l'écriture en base ne laisse AUCUN fichier orphelin (le fichier déposé est retiré)", async () => {
    const s = await mkStudent(world.deps, ctx);
    unwrap(await upload(s.id));
    const before = storage.objects.size;
    // même type -> refus AVANT l'écriture du fichier
    expect(await upload(s.id, { fileName: "doublon.pdf" })).toMatchObject({ ok: false });
    expect(storage.objects.size).toBe(before);
    // anomalie après l'écriture du fichier (date d'émission postérieure à l'expiration contournant le schéma Zod) -> fichier retiré
    const r = await uploadStudentDocument(world.deps, ctx, s.id, PDF_BYTES, { typeCode: "BIRTH_CERTIFICATE", fileName: "acte.pdf", issuedOn: "2025-02-01", expiresOn: "2025-01-01" }).catch((e: unknown) => e);
    expect(r instanceof Error || (typeof r === "object" && r !== null && "ok" in r && (r as { ok: boolean }).ok === false)).toBe(true);
    expect(storage.objects.size).toBe(before);
  });

  it("remplacement : nouvelle version (même type), l'ancienne reste dans l'historique, lisible des habilités", async () => {
    const s = await mkStudent(world.deps, ctx);
    const v1 = unwrap(await upload(s.id, { expiresOn: "2025-12-31" }));
    const v2 = unwrap(await replaceStudentDocument(world.deps, ctx, s.id, v1.id, JPEG_BYTES, { fileName: "cni-v2.jpg", expiresOn: "2030-12-31" }));
    expect(v2).toMatchObject({ typeCode: "ID_CARD", version: 2, supersedesId: v1.id, status: "ACTIVE", contentType: "image/jpeg" });
    const current = unwrap(await listStudentDocuments(world.deps, ctx, s.id));
    expect(current.map((d) => [d.id, d.status])).toEqual([[v2.id, "ACTIVE"]]);
    const history = unwrap(await listStudentDocuments(world.deps, ctx, s.id, { includeHistory: true }));
    expect(history.map((d) => [d.version, d.status]).sort()).toEqual([[1, "REPLACED"], [2, "ACTIVE"]]);
    expect(history.find((d) => d.version === 1)!.replacedAt).not.toBeNull();
    // l'ancienne version reste téléchargeable (historique) ; une version déjà remplacée ne se remplace plus
    expect(unwrap(await getStudentDocumentUrl(world.deps, ctx, s.id, v1.id)).contentType).toBe("application/pdf");
    expect(await replaceStudentDocument(world.deps, ctx, s.id, v1.id, PDF_BYTES, { fileName: "x.pdf" })).toMatchObject({ ok: false, error: { code: "people.document_not_active" } });
    expect(await replaceStudentDocument(world.deps, ctx, s.id, newId(), PDF_BYTES, { fileName: "x.pdf" })).toMatchObject({ ok: false, error: { code: "people.document_not_found" } });
    // le contenu est immuable en base (même hors application)
    await expect(db.admin.query("UPDATE people.student_documents SET sha256 = repeat('a', 64) WHERE id = $1", [v1.id])).rejects.toThrow(/people\.document_immutable/);
    await expect(db.admin.query("DELETE FROM people.student_documents WHERE id = $1", [v1.id])).rejects.toThrow();
  });

  it("URL signée à durée courte, lecture AUDITÉE (liste et URL), jamais le chemin du stockage ni le nom du fichier dans l'audit", async () => {
    const s = await mkStudent(world.deps, ctx);
    const d = unwrap(await upload(s.id, { fileName: "Acte secret.pdf", typeCode: "BIRTH_CERTIFICATE" }));
    const before = world.audit.entries.length;
    unwrap(await listStudentDocuments(world.deps, ctx, s.id));
    const url = unwrap(await getStudentDocumentUrl(world.deps, ctx, s.id, d.id));
    expect(peopleStudentDocumentUrlDtoSchema.safeParse(url).success).toBe(true);
    expect(url).toMatchObject({ expiresInSec: 120, fileName: "Acte secret.pdf", contentType: "application/pdf" });
    expect(url.url).toMatch(/^https:\/\/storage\.example\.test\//);
    const reads = world.audit.entries.slice(before);
    expect(reads.map((e) => [e.action, e.severity])).toEqual([["people.student.documents_read", "notice"], ["people.student.document_read", "notice"]]);
    expect(JSON.stringify(reads)).not.toMatch(/Acte secret|tenants\//);
    expect(await getStudentDocumentUrl(world.deps, ctx, s.id, newId())).toMatchObject({ ok: false, error: { code: "people.document_not_found" } });
    // un autre élève ne partage pas les pièces
    const other = await mkStudent(world.deps, ctx);
    expect(await getStudentDocumentUrl(world.deps, ctx, other.id, d.id)).toMatchObject({ ok: false, error: { code: "people.document_not_found" } });
  });

  it("retrait motivé : la ligne reste (`REMOVED`), le fichier est supprimé, plus d'URL ; métadonnées corrigeables tant que la pièce est active", async () => {
    const s = await mkStudent(world.deps, ctx);
    const d = unwrap(await upload(s.id, { typeCode: "MEDICAL_CERTIFICATE", fileName: "certificat.pdf" }));
    const key = (await adminRows<{ object_key: string }>(db, "SELECT object_key FROM people.student_documents WHERE id = $1", [d.id]))[0]!.object_key;
    const edited = unwrap(await updateStudentDocument(world.deps, ctx, s.id, d.id, { title: "Certificat 2025", issuedOn: "2025-01-01", expiresOn: "2026-01-01" }));
    expect(edited).toMatchObject({ title: "Certificat 2025", expiresOn: "2026-01-01" });
    expect(await updateStudentDocument(world.deps, ctx, s.id, d.id, { issuedOn: "2027-01-01" })).toMatchObject({ ok: false, error: { code: "people.invalid_document" } });
    expect(storage.objects.has(key)).toBe(true);
    unwrap(await removeStudentDocument(world.deps, ctx, s.id, d.id, { reason: "Pièce déposée sur le mauvais dossier" }));
    expect(storage.objects.has(key)).toBe(false);
    const row = (await adminRows<{ status: string; removed_reason: string }>(db, "SELECT status, removed_reason FROM people.student_documents WHERE id = $1", [d.id]))[0]!;
    expect(row).toMatchObject({ status: "REMOVED", removed_reason: "Pièce déposée sur le mauvais dossier" });
    expect(unwrap(await listStudentDocuments(world.deps, ctx, s.id))).toEqual([]);
    expect(unwrap(await listStudentDocuments(world.deps, ctx, s.id, { includeHistory: true })).map((x) => x.status)).toEqual(["REMOVED"]);
    expect(await getStudentDocumentUrl(world.deps, ctx, s.id, d.id)).toMatchObject({ ok: false, error: { code: "people.document_not_found" } });
    expect(await removeStudentDocument(world.deps, ctx, s.id, d.id, { reason: "Deuxième retrait" })).toMatchObject({ ok: false, error: { code: "people.document_not_active" } });
    expect(await updateStudentDocument(world.deps, ctx, s.id, d.id, { title: "x" })).toMatchObject({ ok: false, error: { code: "people.document_not_active" } });
  });

  it("expiration : état dérivé à la lecture, filtre, alerte UNE fois par franchissement de seuil (une nouvelle échéance en rouvre le droit)", async () => {
    const tdb = await db.createTenant("docs-expiry");
    const c = ctxFor(tdb);
    const w = makeWorld(db, { storage });
    unwrap(await updateSettings(w.deps, c, { expiryAlertDays: 30 }));
    const s1 = await mkStudent(w.deps, c);
    const s2 = await mkStudent(w.deps, c);
    const soon = unwrap(await uploadStudentDocument(w.deps, c, s1.id, PDF_BYTES, { typeCode: "ID_CARD", fileName: "a.pdf", expiresOn: "2025-09-20" }));
    const past = unwrap(await uploadStudentDocument(w.deps, c, s2.id, PDF_BYTES, { typeCode: "ID_CARD", fileName: "b.pdf", expiresOn: "2025-08-01" }));
    unwrap(await uploadStudentDocument(w.deps, c, s2.id, PDF_BYTES, { typeCode: "BIRTH_CERTIFICATE", fileName: "c.pdf", expiresOn: "2030-01-01" }));
    expect(soon.expiryState).toBe("EXPIRING");
    expect(past).toMatchObject({ expiryState: "EXPIRED", daysLeft: -31 });
    expect(unwrap(await listStudentDocuments(w.deps, c, s2.id, { expiry: "EXPIRED" })).map((d) => d.id)).toEqual([past.id]);
    expect(unwrap(await listStudentDocuments(w.deps, c, s2.id, { expiry: "EXPIRING" })).map((d) => d.id)).toEqual([past.id]);

    expect(unwrap(await emitExpiringStudentDocuments(w.deps, c))).toEqual({ emitted: 2 });
    expect(unwrap(await emitExpiringStudentDocuments(w.deps, c))).toEqual({ emitted: 0 });
    const events = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'people.student_document.expiring' ORDER BY id", [tdb]);
    expect(events).toHaveLength(2);
    for (const e of events) expect(peopleEventPayloadSchemas["people.student_document.expiring"].safeParse(e.payload).success).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/\.pdf/);
    // une nouvelle échéance rouvre le droit à une alerte
    unwrap(await updateStudentDocument(w.deps, c, s1.id, soon.id, { expiresOn: "2025-09-25" }));
    expect(unwrap(await emitExpiringStudentDocuments(w.deps, c))).toEqual({ emitted: 1 });
    // sans préavis configuré : aucune alerte
    const t3 = await db.createTenant("docs-expiry-none");
    const c3 = ctxFor(t3);
    const s3 = await mkStudent(w.deps, c3);
    unwrap(await uploadStudentDocument(w.deps, c3, s3.id, PDF_BYTES, { typeCode: "ID_CARD", fileName: "d.pdf", expiresOn: "2025-08-01" }));
    unwrap(await updateSettings(w.deps, c3, { expiryAlertDays: null }));
    expect(unwrap(await emitExpiringStudentDocuments(w.deps, c3))).toEqual({ emitted: 0 });
  });

  it("anonymisation du dossier : toutes les pièces sont retirées, fichiers supprimés, titres et noms effacés", async () => {
    const t = await db.createTenant("docs-anon");
    const c = ctxFor(t);
    const w = makeWorld(db, { storage });
    unwrap(await updateSettings(w.deps, c, { studentRetentionDays: 0 }));
    const s = await mkStudent(w.deps, c);
    const a = unwrap(await uploadStudentDocument(w.deps, c, s.id, PDF_BYTES, { typeCode: "ID_CARD", fileName: "Mon nom.pdf", title: "Titre perso" }));
    const b = unwrap(await replaceStudentDocument(w.deps, c, s.id, a.id, PDF_BYTES, { fileName: "Mon nom v2.pdf", title: "Titre perso v2" }));
    unwrap(await changeStudentStatus(w.deps, c, s.id, { status: "WITHDRAWN", reasonText: "Départ de l'établissement" }));
    unwrap(await changeStudentStatus(w.deps, c, s.id, { status: "ARCHIVED" }));
    const keys = (await adminRows<{ object_key: string }>(db, "SELECT object_key FROM people.student_documents WHERE student_id = $1", [s.id])).map((r) => r.object_key);
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => storage.objects.has(k))).toBe(true);
    unwrap(await anonymizeStudent(w.deps, c, s.id, { reason: "Demande d'effacement" }));
    expect(keys.some((k) => storage.objects.has(k))).toBe(false);
    const rows = await adminRows<{ id: string; status: string; title: string | null; file_name: string }>(db, "SELECT id, status, title, file_name FROM people.student_documents WHERE student_id = $1 ORDER BY version", [s.id]);
    expect(rows.map((r) => [r.status, r.title, r.file_name])).toEqual([["REMOVED", null, "anonymisé"], ["REMOVED", null, "anonymisé"]]);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(await upload(s.id)).toMatchObject({ ok: false });
  });

  describe("HTTP : corps binaire, permissions réelles des rôles, aucun en-tête client", () => {
    it("secrétariat (MFA) dépose, lit, remplace, retire ; sans MFA la lecture est refusée ; parent, élève, enseignant : 403", async () => {
      const s = await mkStudent(world.deps, ctx);
      const q = { typeCode: "ID_CARD", fileName: "cni.pdf", expiresOn: "2035-01-01" };
      const put = await http.call("PUT", `/students/${s.id}/documents`, { role: "secretariat", mfa: true, rawBody: Buffer.from(PDF_BYTES), contentType: "application/pdf", query: q });
      expect(put.status).toBe(201);
      expect(peopleStudentDocumentDtoSchema.safeParse(put.json).success).toBe(true);
      expect(put.headers["cache-control"]).toBe("no-store");
      const id = put.json.id as string;
      const list = await http.call("GET", `/students/${s.id}/documents`, { role: "secretariat", mfa: true });
      expect(list.status).toBe(200);
      expect(list.json.items.map((d: { id: string }) => d.id)).toEqual([id]);
      const url = await http.call("GET", `/students/${s.id}/documents/${id}/url`, { role: "secretariat", mfa: true });
      expect(url.status).toBe(200);
      expect(url.json.url).toMatch(/^https:\/\//);
      // MFA exigée pour la lecture (permission sensible)
      expect((await http.call("GET", `/students/${s.id}/documents`, { role: "secretariat", mfa: false })).status).toBe(403);
      for (const role of ["parent", "eleve", "enseignant", "educateur", "econome", "aucun"] as const) {
        expect((await http.call("GET", `/students/${s.id}/documents`, { role, mfa: true })).status, role).toBe(403);
        expect((await http.call("PUT", `/students/${s.id}/documents`, { role, mfa: true, rawBody: Buffer.from(PDF_BYTES), contentType: "application/pdf", query: { typeCode: "OTHER", fileName: "x.pdf" } })).status, role).toBe(403);
        expect((await http.call("GET", `/students/${s.id}/documents/${id}/url`, { role, mfa: true })).status, role).toBe(403);
      }
      expect((await http.call("GET", `/students/${s.id}/documents`, { anonymous: true })).status).toBe(401);
      // remplacement, métadonnées, retrait
      const rep = await http.call("PUT", `/students/${s.id}/documents/${id}`, { role: "secretariat", mfa: true, rawBody: Buffer.from(JPEG_BYTES), contentType: "image/jpeg", query: { fileName: "cni2.jpg" } });
      expect(rep.status).toBe(201);
      expect(rep.json).toMatchObject({ version: 2, supersedesId: id });
      const patch = await http.call("PATCH", `/students/${s.id}/documents/${rep.json.id}`, { role: "secretariat", mfa: true, body: { title: "CNI recto" } });
      expect(patch.json.title).toBe("CNI recto");
      expect((await http.call("POST", `/students/${s.id}/documents/${rep.json.id}/remove`, { role: "secretariat", mfa: true, body: { reason: "ok" } })).status).toBe(400);
      expect((await http.call("POST", `/students/${s.id}/documents/${rep.json.id}/remove`, { role: "secretariat", mfa: true, body: { reason: "Pièce illisible, à redéposer" } })).status).toBe(200);
    });

    it("entrées strictes : champ inconnu, type inconnu, corps non binaire, format refusé (400, code stable)", async () => {
      const s = await mkStudent(world.deps, ctx);
      const call = (query: Record<string, string>, rawBody: Buffer | string = Buffer.from(PDF_BYTES), contentType = "application/pdf") => http.call("PUT", `/students/${s.id}/documents`, { role: "secretariat", mfa: true, rawBody, contentType, query });
      expect((await call({ typeCode: "ID_CARD", fileName: "a.pdf", extra: "1" })).status).toBe(400);
      expect((await call({ typeCode: "INCONNU", fileName: "a.pdf" })).status).toBe(400);
      expect((await call({ typeCode: "ID_CARD" })).status).toBe(400);
      expect((await call({ typeCode: "ID_CARD", fileName: "a.pdf", issuedOn: "2025-02-01", expiresOn: "2025-01-01" })).status).toBe(400);
      const bad = await call({ typeCode: "ID_CARD", fileName: "a.pdf" }, "<html><script>alert(1)</script>", "application/pdf");
      expect(bad.status).toBe(400);
      expect(bad.json.code).toBe("people.invalid_document");
      const json = await http.call("PUT", `/students/${s.id}/documents`, { role: "secretariat", mfa: true, body: { a: 1 }, query: { typeCode: "ID_CARD", fileName: "a.pdf" } });
      expect(json.status).toBe(400);
    });
  });
});
