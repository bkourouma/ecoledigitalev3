/**
 * Intégration HTTP (Fastify `inject`, Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL).
 * Les gardes de permission sont simulées à partir des capacités des rôles ; le DOCUMENT visé (niveau, propriétaire, tuteur lié,
 * partage) est vérifié par les cas d'usage. Dépôts en multipart/form-data réels.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { documentsPlugin, normalizeUploadFields } from "../../http/plugin";
import { PERMISSIONS } from "../../http/guards";
import { createDocumentsDeps, type DocumentsDeps } from "../../application/deps";
import type { ActorCaps } from "../../domain/types";
import { EICAR } from "../../infrastructure/in-memory-ports";
import { describeIntegration } from "../support/db";
import { docxBytes, exeBytes, jpegBytes, pdfBytes, textBytes, uniquePdf } from "../support/files";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

const CAPS_BY_USER: Record<string, ActorCaps> = {
  [USERS.manager]: CAPS.manager,
  [USERS.secretary]: CAPS.secretary,
  [USERS.directeurEtudes]: CAPS.directeurEtudes,
  [USERS.teacher]: CAPS.teacher,
  [USERS.parent]: CAPS.parent,
  [USERS.parent2]: CAPS.parent,
  [USERS.pupil]: CAPS.pupil,
  [USERS.staffUser]: CAPS.staffOwn,
  [USERS.stranger]: CAPS.none,
};

const permissionsOf = (userId: string): Set<string> =>
  new Set(Object.entries(CAPS_BY_USER[userId] ?? {}).filter(([, v]) => v === true).map(([k]) => PERMISSIONS[k as keyof typeof PERMISSIONS]));

interface Part {
  name: string;
  value?: string;
  file?: { name: string; bytes: Uint8Array; type?: string };
}

function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----ed-test-boundary-7MA4YWxkTrZu0gW";
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if (p.file) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.file.name}"\r\nContent-Type: ${p.file.type ?? "application/octet-stream"}\r\n\r\n`));
      chunks.push(Buffer.from(p.file.bytes));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value ?? ""}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describeIntegration("module documents : HTTP (matrice par rôle)", () => {
  let w: World;
  let app: FastifyInstance;
  let deps: DocumentsDeps;
  let throttleAfter = Number.POSITIVE_INFINITY;
  let hits = 0;

  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, user: string | null, payload?: unknown, tenant = w.tenantA) =>
    app.inject({
      method,
      url,
      headers: { ...(user ? { "x-user": user, "x-tenant": tenant } : {}) },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  const upload = (url: string, user: string, parts: Part[], tenant = w.tenantA) => {
    const m = multipart(parts);
    return app.inject({ method: "POST", url, headers: { "x-user": user, "x-tenant": tenant, ...m.headers }, payload: m.payload });
  };
  const identityFields = async (title = "Pièce HTTP", extra: Part[] = []): Promise<Part[]> => [
    { name: "categoryId", value: await w.category(w.tenantA, "STUDENT_IDENTITY") },
    { name: "title", value: title },
    { name: "ownerType", value: "STUDENT" },
    { name: "ownerId", value: PEOPLE.child },
    ...extra,
  ];

  beforeAll(async () => {
    w = await createWorld();
    deps = createDocumentsDeps({ db: w.db.tenantDb, clock: w.clock, audit: w.audit, ports: w.ports, config: { hardMaxBytes: 60_000 } });
    app = Fastify({ logger: false });
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      const user = request.headers["x-user"];
      const tenant = request.headers["x-tenant"];
      if (typeof user === "string" && typeof tenant === "string") (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: user });
    });
    await app.register(documentsPlugin, {
      deps,
      resolveContext: (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("sans contexte");
        return ctx;
      },
      requirePermission: (permission) => async (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("Authentification requise.", { code: "UNAUTHORIZED" });
        if (!permissionsOf(ctx.userId as string).has(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      rateLimiter: {
        hit: async () => {
          hits += 1;
          return hits > throttleAfter ? { allowed: false, count: hits, retryAfterMs: 4500 } : { allowed: true, count: hits, retryAfterMs: 0 };
        },
      },
      isFeatureEnabled: async () => false,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await w?.drop();
  });

  describe("accès et contexte", () => {
    it("sans contexte : refus ; sans permission : 403 ; en-tête d'identité usurpé sans effet", async () => {
      expect((await call("GET", "/documents", null)).statusCode).toBeGreaterThanOrEqual(401);
      expect((await call("GET", "/documents", USERS.stranger)).statusCode).toBe(403);
      expect((await call("POST", "/categories", USERS.secretary, {})).statusCode).toBe(403);
      const res = await app.inject({ method: "GET", url: "/documents", headers: { "x-user": USERS.parent, "x-tenant": w.tenantA, "x-user-id": USERS.manager } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("/me/context : capacités et liens propres à l'appelant ; /categories : canUpload par rôle", async () => {
      const parent = (await call("GET", "/me/context", USERS.parent)).json();
      expect(parent.caps).toMatchObject({ childRead: true, childUpload: true, manage: false, read: false });
      expect(parent.links.childStudentIds).toEqual([PEOPLE.child]);
      expect(parent.upload.supportedExtensions).toContain("pdf");
      const cats = (await call("GET", "/categories", USERS.secretary)).json().items as Array<{ code: string; canUpload: boolean; documentCount: number | null }>;
      expect(cats.find((c) => c.code === "STUDENT_IDENTITY")).toMatchObject({ canUpload: true, documentCount: null });
      expect(cats.find((c) => c.code === "STUDENT_MEDICAL")).toMatchObject({ canUpload: false });
      expect((await call("GET", "/categories", USERS.stranger)).statusCode).toBe(403);
    });

    it("catégories : création par la gestion (201), code unique (409), validation (400), archivage", async () => {
      const body = { code: "STUDENT_SPORT", kind: "STUDENT", label: "Certificats sportifs", confidentiality: "RESTRICTED", allowedExtensions: ["pdf"], audienceGuardians: true, ownerUpload: true };
      const created = await call("POST", "/categories", USERS.manager, body);
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ code: "STUDENT_SPORT", kind: "STUDENT", canUpload: true, documentCount: 0 });
      const dup = await call("POST", "/categories", USERS.manager, body);
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe("documents.category_code_taken");
      expect((await call("POST", "/categories", USERS.manager, { ...body, code: "bad code" })).statusCode).toBe(400);
      expect((await call("POST", "/categories", USERS.manager, { ...body, code: "X_EXT", allowedExtensions: ["exe"] })).statusCode).toBe(400);
      const id = created.json().id as string;
      const patched = await call("PATCH", `/categories/${id}`, USERS.manager, { label: "Sport", confidentiality: "INTERNAL" });
      expect(patched.json()).toMatchObject({ label: "Sport", confidentiality: "INTERNAL" });
      expect((await call("POST", `/categories/${id}/archive`, USERS.manager)).json().status).toBe("ARCHIVED");
      expect((await call("POST", `/categories/${id}/restore`, USERS.manager)).json().status).toBe("ACTIVE");
    });
  });

  describe("dépôt multipart", () => {
    it("201 : document et version 1 ; liste CSV des étiquettes, métadonnées JSON ; en-têtes sans cache", async () => {
      const res = await upload("/documents", USERS.secretary, [
        ...(await identityFields("CNI Awa", [{ name: "tags", value: "identité, 2026" }, { name: "metadata", value: JSON.stringify({ numero: "CI-1" }) }, { name: "description", value: "recto verso" }])),
        { name: "file", file: { name: "Cni Awa.pdf", bytes: uniquePdf(), type: "application/pdf" } },
      ]);
      expect(res.statusCode).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.json()).toMatchObject({ title: "CNI Awa", tags: ["identité", "2026"], metadata: { numero: "CI-1" }, description: "recto verso", currentVersionNo: 1, fileName: "Cni Awa.pdf", ownerName: "Enfant A" });
    });

    it("AC-1 : le Content-Type déclaré est ignoré — JPEG nommé .pdf et exécutable déclarés application/pdf : 415", async () => {
      const mismatch = await upload("/documents", USERS.secretary, [...(await identityFields()), { name: "file", file: { name: "scan.pdf", bytes: jpegBytes(), type: "application/pdf" } }]);
      expect(mismatch.statusCode).toBe(415);
      expect(mismatch.json().code).toBe("documents.type_mismatch");
      const exe = await upload("/documents", USERS.secretary, [...(await identityFields()), { name: "file", file: { name: "setup.pdf", bytes: exeBytes(), type: "application/pdf" } }]);
      expect(exe.statusCode).toBe(415);
      expect(exe.json().code).toBe("documents.type_undetected");
      const notAllowed = await upload("/documents", USERS.secretary, [...(await identityFields()), { name: "file", file: { name: "lettre.docx", bytes: docxBytes(), type: "application/pdf" } }]);
      expect(notAllowed.statusCode).toBe(415);
      expect(notAllowed.json().code).toBe("documents.type_not_allowed");
    });

    it("AC-2 : nom piégé 400 ; chemin assaini ; fichier manquant 400 ; dépôt non multipart 400 ; champs illisibles 400", async () => {
      const trap = await upload("/documents", USERS.secretary, [...(await identityFields()), { name: "file", file: { name: "facture.exe.pdf", bytes: uniquePdf() } }]);
      expect(trap.statusCode).toBe(400);
      expect(trap.json().code).toBe("documents.file_name_rejected");
      const traversal = await upload("/documents", USERS.secretary, [...(await identityFields("Traversée")), { name: "file", file: { name: "..\\..\\secret.pdf", bytes: uniquePdf() } }]);
      expect(traversal.statusCode).toBe(201);
      expect(traversal.json().fileName).toBe("secret.pdf");
      const none = await upload("/documents", USERS.secretary, await identityFields());
      expect(none.statusCode).toBe(400);
      expect(none.json().code).toBe("documents.file_missing");
      const json = await call("POST", "/documents", USERS.secretary, { title: "x" });
      expect(json.statusCode).toBe(400);
      expect(json.json().code).toBe("documents.invalid_input");
      const badMeta = await upload("/documents", USERS.secretary, [...(await identityFields("Méta", [{ name: "metadata", value: "{pas du json" }])), { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
      expect(badMeta.statusCode).toBe(400);
      const noTitle = await upload("/documents", USERS.secretary, [{ name: "categoryId", value: await w.category(w.tenantA, "STUDENT_IDENTITY") }, { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
      expect(noTitle.statusCode).toBe(400);
      expect(noTitle.json().code).toBe("documents.invalid_input");
    });

    it("taille : un fichier plus gros que le plafond de plateforme est refusé en flux (413) sans être lu en entier", async () => {
      const big = pdfBytes(`% ${"x".repeat(70_000)}`);
      const res = await upload("/documents", USERS.secretary, [...(await identityFields("Gros")), { name: "file", file: { name: "gros.pdf", bytes: big } }]);
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe("documents.file_too_large");
      expect((await w.db.admin.query("SELECT 1 FROM documents.documents WHERE title = 'Gros'")).rowCount).toBe(0);
    });

    it("AC-8 : EICAR 422 (quarantaine) ; scanner HS fail-closed 503 ; rien n'est stocké", async () => {
      const category = await w.category(w.tenantA, "INSTITUTION_REGULATION");
      const fields: Part[] = [{ name: "categoryId", value: category }, { name: "title", value: "Piégé" }];
      const eicar = new TextEncoder().encode(`${EICAR}\nhttp`);
      const infected = await upload("/documents", USERS.secretary, [...fields, { name: "file", file: { name: "piege.txt", bytes: eicar } }]);
      expect(infected.statusCode).toBe(422);
      expect(infected.json()).toMatchObject({ code: "documents.malware_detected", details: { quarantineId: expect.any(String) } });
      expect((await w.db.admin.query("SELECT 1 FROM documents.documents WHERE title = 'Piégé'")).rowCount).toBe(0);
      w.ports.fakeScanner.unavailable = true;
      (w.ports as { scan: unknown }).scan = { scanner: w.ports.fakeScanner, failClosed: true };
      try {
        const down = await upload("/documents", USERS.secretary, [...(await identityFields("Scan HS")), { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
        expect(down.statusCode).toBe(503);
        expect(down.json().code).toBe("documents.scan_unavailable");
      } finally {
        w.ports.fakeScanner.unavailable = false;
        (w.ports as { scan: unknown }).scan = { scanner: w.ports.fakeScanner, failClosed: false };
      }
    });

    it("rôles : parent dépose pour son enfant (201), jamais pour un autre (403) ; enseignant refusé (403)", async () => {
      const mine = await upload("/documents", USERS.parent, [...(await identityFields("Du parent")), { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
      expect(mine.statusCode).toBe(201);
      const other = await upload("/documents", USERS.parent, [{ name: "categoryId", value: await w.category(w.tenantA, "STUDENT_IDENTITY") }, { name: "title", value: "Autre" }, { name: "ownerType", value: "STUDENT" }, { name: "ownerId", value: PEOPLE.other }, { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
      expect(other.statusCode).toBe(403);
      expect(other.json().code).toBe("documents.forbidden");
      const teacher = await upload("/documents", USERS.teacher, [...(await identityFields("Enseignant")), { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
      expect(teacher.statusCode).toBe(403);
      const none = await upload("/documents", USERS.stranger, [...(await identityFields("Inconnu")), { name: "file", file: { name: "a.pdf", bytes: uniquePdf() } }]);
      expect(none.statusCode).toBe(403);
    });

    it("doublon 409, quota 413", async () => {
      const bytes = uniquePdf();
      const parts = async (t: string): Promise<Part[]> => [...(await identityFields(t)), { name: "file", file: { name: "d.pdf", bytes } }];
      expect((await upload("/documents", USERS.secretary, await parts("Premier"))).statusCode).toBe(201);
      const dup = await upload("/documents", USERS.secretary, await parts("Second"));
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ code: "documents.duplicate", details: { documentId: expect.any(String) } });
      const { updateSettings } = await import("../../application/categories");
      const used = (await w.db.admin.query("SELECT coalesce(sum(size_bytes),0)::bigint AS n FROM documents.versions WHERE tenant_id = $1", [w.tenantA])).rows[0].n as string;
      await updateSettings(deps, createRequestContext({ tenantId: w.tenantA, userId: USERS.manager }), { body: { storageQuotaBytes: Number(used) + 10 } });
      const over = await upload("/documents", USERS.secretary, [...(await identityFields("Quota")), { name: "file", file: { name: "q.pdf", bytes: uniquePdf() } }]);
      expect(over.statusCode).toBe(413);
      expect(over.json().code).toBe("documents.quota_exceeded");
      await updateSettings(deps, createRequestContext({ tenantId: w.tenantA, userId: USERS.manager }), { body: { storageQuotaBytes: null } });
    });
  });

  describe("lecture, versions, téléchargement, prévisualisation", () => {
    let docId: string;
    beforeAll(async () => {
      docId = await w.seedDocument({ fields: { title: "Dossier HTTP" }, fileName: "photo.jpg", bytes: jpegBytes() });
    });

    it("liste filtrée, détail, 404 identique pour un document inexistant ou invisible", async () => {
      const list = (await call("GET", "/documents?limit=2&sort=title&dir=asc", USERS.secretary)).json();
      expect(list.items.length).toBeLessThanOrEqual(2);
      expect(list.nextCursor).not.toBeNull();
      expect((await call("GET", `/documents?q=${encodeURIComponent("dossier http")}&kind=STUDENT`, USERS.secretary)).json().items.map((d: { id: string }) => d.id)).toContain(docId);
      const detail = await call("GET", `/documents/${docId}`, USERS.secretary);
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id: docId, access: { write: true } });
      // un parent d'un AUTRE enfant : 404, comme un identifiant inconnu
      const hidden = await call("GET", `/documents/${docId}`, USERS.parent2);
      const unknown = await call("GET", "/documents/0192f0a4-7b1e-7c3a-8d2e-00000000dead", USERS.parent2);
      expect(hidden.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
      expect(hidden.json().code).toBe(unknown.json().code);
      expect((await call("GET", "/documents/pas-un-uuid", USERS.secretary)).statusCode).toBe(400);
      expect((await call("GET", "/documents?status=ARCHIVED", USERS.secretary)).statusCode).toBe(403);
      expect((await call("GET", "/documents?limit=500", USERS.secretary)).statusCode).toBe(400);
    });

    it("AC-6 : le tenant B reçoit 404 pour tout ce qui touche un document de A", async () => {
      for (const [method, url] of [["GET", `/documents/${docId}`], ["GET", `/documents/${docId}/download-url`], ["GET", `/documents/${docId}/preview`], ["GET", `/documents/${docId}/history`], ["GET", `/documents/${docId}/shares`], ["POST", `/documents/${docId}/archive`]] as const) {
        const res = await call(method, url, USERS.manager, method === "POST" ? { reason: "intrusion" } : undefined, w.tenantB);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
      expect((await call("GET", "/documents", USERS.manager, undefined, w.tenantB)).json().items.map((d: { id: string }) => d.id)).not.toContain(docId);
    });

    it("nouvelle version : 201, conflit 409, identique 409, historique complet téléchargeable", async () => {
      const second = uniquePdf();
      const v2 = await upload(`/documents/${docId}/versions`, USERS.secretary, [{ name: "note", value: "scan plus net" }, { name: "baseVersion", value: "1" }, { name: "file", file: { name: "v2.pdf", bytes: second } }]);
      expect(v2.statusCode).toBe(201);
      expect(v2.json()).toMatchObject({ currentVersionNo: 2, versionCount: 2 });
      const stale = await upload(`/documents/${docId}/versions`, USERS.secretary, [{ name: "baseVersion", value: "1" }, { name: "file", file: { name: "v3.pdf", bytes: uniquePdf() } }]);
      expect(stale.statusCode).toBe(409);
      expect(stale.json().code).toBe("documents.version_conflict");
      const same = await upload(`/documents/${docId}/versions`, USERS.secretary, [{ name: "file", file: { name: "v2bis.pdf", bytes: second } }]);
      expect(same.statusCode).toBe(409);
      expect(same.json().code).toBe("documents.version_identical");
      const readOnly = await upload(`/documents/${docId}/versions`, USERS.teacher, [{ name: "file", file: { name: "x.pdf", bytes: uniquePdf() } }]);
      expect(readOnly.statusCode).toBe(404); // l'enseignant ne voit pas ce document (RESTRICTED)
      const v1Url = (await call("GET", `/documents/${docId}/versions/1/download-url`, USERS.secretary)).json();
      expect(v1Url.versionNo).toBe(1);
      expect(w.ports.storage.resolve(v1Url.url)?.bytes.length).toBe(jpegBytes().length);
    });

    it("AC-7 : URL signée courte, audit du téléchargement, expiration", async () => {
      const res = await call("GET", `/documents/${docId}/download-url`, USERS.secretary);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ fileName: expect.stringMatching(/\.pdf$/), mime: "application/pdf" });
      expect(new Date(body.expiresAt).getTime() - w.clock.now().getTime()).toBeLessThanOrEqual(300_000);
      expect(w.ports.storage.resolve(body.url)).not.toBeNull();
      w.clock.advanceSeconds(120);
      expect(w.ports.storage.resolve(body.url)).toBeNull();
      expect(w.audit.actions()).toContain("documents.document.downloaded");
      expect((await call("GET", `/documents/${docId}/versions/9/download-url`, USERS.secretary)).statusCode).toBe(404);
    });

    it("prévisualisation : octets servis avec en-têtes de sécurité ; images et texte sous CSP sandbox ; PDF sans ; Office 415", async () => {
      const img = await w.seedDocument({ fields: { title: "Photo" }, fileName: "ID photo é.jpg", bytes: jpegBytes() });
      const res = await call("GET", `/documents/${img}/preview`, USERS.secretary);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["content-security-policy"]).toContain("sandbox");
      expect(res.headers["content-disposition"]).toMatch(/^inline; filename="ID photo _\.jpg"; filename\*=UTF-8''ID%20photo%20%C3%A9\.jpg$/);
      expect(Buffer.from(res.rawPayload).equals(Buffer.from(jpegBytes()))).toBe(true);

      const pdf = await call("GET", `/documents/${docId}/preview`, USERS.secretary);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      expect(pdf.headers["content-security-policy"]).toBeUndefined();
      expect(pdf.headers["x-content-type-options"]).toBe("nosniff");

      const txt = await w.seedDocument({ code: "INSTITUTION_REGULATION", fileName: "r.txt", bytes: textBytes("Article 1"), fields: { ownerType: "NONE", ownerId: null, title: "Texte" } });
      const text = await call("GET", `/documents/${txt}/preview`, USERS.secretary);
      expect(text.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(text.body).toBe("Article 1");

      const office = await w.seedDocument({ code: "INSTITUTION_REGULATION", fileName: "r.docx", bytes: docxBytes([{ name: "word/h.xml", content: String(Math.random()) }]), fields: { ownerType: "NONE", ownerId: null, title: "Office" } });
      const refused = await call("GET", `/documents/${office}/preview`, USERS.secretary);
      expect(refused.statusCode).toBe(415);
      expect(refused.json().code).toBe("documents.preview_unavailable");

      // objet altéré : 409 intégrité (jamais servi)
      const victim = await w.seedDocument({ fields: { title: "Victime" } });
      const key = (await w.db.admin.query("SELECT storage_key FROM documents.versions WHERE document_id = $1", [victim])).rows[0].storage_key as string;
      const obj = w.ports.storage.objects.get(key)!;
      obj.bytes = new Uint8Array([...obj.bytes.slice(0, 10), 0x58, ...obj.bytes.slice(11)]);
      const bad = await call("GET", `/documents/${victim}/preview`, USERS.secretary);
      expect(bad.statusCode).toBe(409);
      expect(bad.json().code).toBe("documents.integrity_failed");
      w.ports.storage.objects.delete(key);
      const gone = await call("GET", `/documents/${victim}/preview`, USERS.secretary);
      expect(gone.statusCode).toBe(410);
      expect(gone.json().code).toBe("documents.object_missing");
    });

    it("historique : 200 avec la permission, 403 sans (document visible), curseur", async () => {
      const ok = await call("GET", `/documents/${docId}/history?limit=2`, USERS.secretary);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().items.length).toBeGreaterThan(0);
      const regulation = await w.seedDocument({ code: "INSTITUTION_REGULATION", fields: { ownerType: "NONE", ownerId: null, title: "Visible enseignant" } });
      expect((await call("GET", `/documents/${regulation}`, USERS.teacher)).statusCode).toBe(200);
      const denied = await call("GET", `/documents/${regulation}/history`, USERS.teacher);
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("documents.forbidden");
    });

    it("mise à jour : PATCH 200 par qui écrit ; 403 par qui lit seulement ; 400 sans modification", async () => {
      const patched = await call("PATCH", `/documents/${docId}`, USERS.secretary, { title: "Dossier HTTP (maj)", tags: ["a", "A", "b"] });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({ title: "Dossier HTTP (maj)", tags: ["a", "b"] });
      expect((await call("PATCH", `/documents/${docId}`, USERS.secretary, {})).statusCode).toBe(400);
      expect((await call("PATCH", `/documents/${docId}`, USERS.parent2, { title: "x" })).statusCode).toBe(404); // parent d'un autre enfant : invisible
      expect((await call("PATCH", `/documents/${docId}`, USERS.parent, { title: "x" })).statusCode).toBe(403); // parent de l'enfant : lit, n'écrit pas
      const regulation = await w.seedDocument({ code: "INSTITUTION_REGULATION", fields: { ownerType: "NONE", ownerId: null, title: "Lecture seule" } });
      const ro = await call("PATCH", `/documents/${regulation}`, USERS.teacher, { title: "x" });
      expect(ro.statusCode).toBe(403);
    });
  });

  describe("partages, archivage, quarantaine, paramètres", () => {
    it("partage : 201 par qui partage, 403 sinon ; la personne voit ; retrait 204", async () => {
      const id = await w.seedDocument({ fields: { title: "À partager" } });
      expect((await call("GET", `/documents/${id}`, USERS.teacher)).statusCode).toBe(404);
      const forbidden = await call("POST", `/documents/${id}/shares`, USERS.teacher, { userId: USERS.stranger, level: "READ" });
      expect(forbidden.statusCode).toBe(403);
      const shared = await call("POST", `/documents/${id}/shares`, USERS.secretary, { userId: USERS.teacher, level: "READ", note: "conseil" });
      expect(shared.statusCode).toBe(201);
      expect(shared.json()).toMatchObject({ userId: USERS.teacher, level: "READ", active: true });
      expect((await call("GET", `/documents/${id}`, USERS.teacher)).statusCode).toBe(200);
      expect((await call("GET", `/documents/${id}/shares`, USERS.secretary)).json().items).toHaveLength(1);
      expect((await call("POST", `/documents/${id}/shares`, USERS.secretary, { userId: USERS.secretary, level: "READ" })).statusCode).toBe(400);
      const removed = await call("DELETE", `/documents/${id}/shares/${shared.json().id}`, USERS.secretary);
      expect(removed.statusCode).toBe(204);
      expect((await call("GET", `/documents/${id}`, USERS.teacher)).statusCode).toBe(404);
    });

    it("sélecteurs de personnes : réservés à qui partage ou dépose ; tuteurs d'un élève", async () => {
      expect((await call("GET", "/people?q=secre&kind=USER", USERS.secretary)).json().items.length).toBeGreaterThan(0);
      expect((await call("GET", "/people?q=Enfant&kind=STUDENT", USERS.secretary)).json().items[0]).toMatchObject({ kind: "STUDENT" });
      expect((await call("GET", "/people?q=secre&kind=USER", USERS.parent)).statusCode).toBe(403);
      expect((await call("GET", "/people?q=x&kind=USER", USERS.secretary)).statusCode).toBe(400);
      // un enseignant sans droit de partage ne cherche pas des comptes ; sans dépôt (hors ownUpload), pas de propriétaires
      expect((await call("GET", "/people?q=secre&kind=USER", USERS.teacher)).statusCode).toBe(403);
      const guardians = await call("GET", `/students/${PEOPLE.child}/guardians`, USERS.secretary);
      expect(guardians.json().items.map((g: { id: string }) => g.id)).toEqual([USERS.parent]);
      expect((await call("GET", `/students/${PEOPLE.child}/guardians`, USERS.parent)).statusCode).toBe(403);
    });

    it("archivage : 403 sans permission, accusé 200 avec ; la gestion restaure ; la restauration est réservée à la gestion", async () => {
      const id = await w.seedDocument({ fields: { title: "À archiver HTTP" } });
      expect((await call("POST", `/documents/${id}/archive`, USERS.secretary, { reason: "obsolète" })).statusCode).toBe(403);
      const archived = await call("POST", `/documents/${id}/archive`, USERS.directeurEtudes, { reason: "obsolète" });
      expect(archived.statusCode).toBe(200);
      expect(archived.json()).toMatchObject({ id, status: "ARCHIVED" });
      expect((await call("POST", `/documents/${id}/archive`, USERS.directeurEtudes, { reason: "déjà fait" })).statusCode).toBe(404);
      expect((await call("POST", `/documents/${id}/archive`, USERS.manager, {})).statusCode).toBe(400); // motif obligatoire
      expect((await call("POST", `/documents/${id}/restore`, USERS.directeurEtudes)).statusCode).toBe(403);
      const restored = await call("POST", `/documents/${id}/restore`, USERS.manager);
      expect(restored.statusCode).toBe(200);
      expect(restored.json().status).toBe("ACTIVE");
    });

    it("quarantaine : liste, libération et destruction réservées à la gestion de la quarantaine", async () => {
      const category = await w.category(w.tenantA, "INSTITUTION_REGULATION");
      const eicar = new TextEncoder().encode(`${EICAR}\nq2`);
      const res = await upload("/documents", USERS.secretary, [{ name: "categoryId", value: category }, { name: "title", value: "Faux positif" }, { name: "file", file: { name: "fp.txt", bytes: eicar } }]);
      const qid = res.json().details.quarantineId as string;
      expect((await call("GET", "/quarantine", USERS.secretary)).statusCode).toBe(403);
      const list = (await call("GET", "/quarantine?status=HELD", USERS.manager)).json();
      expect(list.items.find((q: { id: string }) => q.id === qid)).toMatchObject({ status: "HELD", signature: "Eicar-Test-Signature", intentKind: "CREATE" });
      expect((await call("POST", `/quarantine/${qid}/release`, USERS.manager, {})).statusCode).toBe(400); // motif obligatoire
      const released = await call("POST", `/quarantine/${qid}/release`, USERS.manager, { note: "Faux positif confirmé" });
      expect(released.statusCode).toBe(200);
      expect(released.json()).toMatchObject({ title: "Faux positif", createdBy: USERS.secretary });
      const res2 = await upload("/documents", USERS.secretary, [{ name: "categoryId", value: category }, { name: "title", value: "Vrai malware" }, { name: "file", file: { name: "m.txt", bytes: new TextEncoder().encode(`${EICAR}\nq3`) } }]);
      const q2 = res2.json().details.quarantineId as string;
      expect((await call("DELETE", `/quarantine/${q2}`, USERS.secretary, { note: "non" })).statusCode).toBe(403);
      const deleted = await call("DELETE", `/quarantine/${q2}`, USERS.manager, { note: "Malware confirmé" });
      expect(deleted.statusCode).toBe(204);
      expect((await call("DELETE", `/quarantine/${q2}`, USERS.manager, { note: "deux fois" })).statusCode).toBe(404);
    });

    it("paramètres et usage : lecture et écriture par la direction ; validation", async () => {
      expect((await call("GET", "/settings", USERS.secretary)).statusCode).toBe(403);
      const settings = await call("GET", "/settings", USERS.manager);
      expect(settings.json()).toMatchObject({ maxBytes: 15 * 1024 * 1024, defaultAlertDays: [30, 7, 1], archiveRetentionDays: 0, maxVersions: 50 });
      const put = await call("PUT", "/settings", USERS.manager, { archiveRetentionDays: 400, defaultAlertDays: [45, 15] });
      expect(put.json()).toMatchObject({ archiveRetentionDays: 400, defaultAlertDays: [45, 15] });
      await call("PUT", "/settings", USERS.manager, { archiveRetentionDays: 0, defaultAlertDays: [30, 7, 1] });
      expect((await call("PUT", "/settings", USERS.manager, {})).statusCode).toBe(400);
      expect((await call("PUT", "/settings", USERS.manager, { maxBytes: 999_999_999 })).statusCode).toBe(400);
      expect((await call("PUT", "/settings", USERS.manager, { storageQuotaBytes: 10 * 1024 ** 4 })).statusCode).toBe(400);
      const usage = (await call("GET", "/usage", USERS.manager)).json();
      expect(usage.usedBytes).toBeGreaterThan(0);
      expect(usage.documentCount).toBeGreaterThan(0);
      expect((await call("GET", "/summary?withinDays=30", USERS.secretary)).json()).toMatchObject({ withinDays: 30, quarantineHeld: null });
    });

    it("droits de catégorie : routes réservées à la gestion des catégories", async () => {
      const medical = await w.category(w.tenantA, "STUDENT_MEDICAL");
      expect((await call("POST", `/categories/${medical}/grants`, USERS.secretary, { userId: USERS.teacher, level: "READ" })).statusCode).toBe(403);
      const granted = await call("POST", `/categories/${medical}/grants`, USERS.manager, { userId: USERS.teacher, level: "READ" });
      expect(granted.statusCode).toBe(201);
      expect((await call("GET", `/categories/${medical}/grants`, USERS.manager)).json().items).toHaveLength(1);
      expect((await call("DELETE", `/categories/${medical}/grants/${granted.json().id}`, USERS.manager)).statusCode).toBe(204);
    });
  });

  describe("limiteur de débit", () => {
    it("429 + Retry-After quand l'utilisateur dépasse la fenêtre", async () => {
      throttleAfter = hits;
      const res = await call("GET", "/documents", USERS.secretary);
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.json().code).toBe("documents.rate_limited");
      throttleAfter = Number.POSITIVE_INFINITY;
      expect((await call("GET", "/documents", USERS.secretary)).statusCode).toBe(200);
    });
  });
});

describe("normalizeUploadFields (sans base)", () => {
  it("listes en CSV ou en JSON, métadonnées JSON, champs vides ignorés", () => {
    expect(normalizeUploadFields({ title: " Titre ", tags: "a, b ,,c", alertDays: "30,7", note: "", expiresOn: "2027-01-31" })).toEqual({ title: "Titre", tags: ["a", "b", "c"], alertDays: [30, 7], expiresOn: "2027-01-31" });
    expect(normalizeUploadFields({ tags: '["x","y"]', metadata: '{"k":"v"}' })).toEqual({ tags: ["x", "y"], metadata: { k: "v" } });
    expect(() => normalizeUploadFields({ metadata: "{pas du json" })).toThrow();
    expect(() => normalizeUploadFields({ tags: "[pas du json" })).toThrow();
  });
});
