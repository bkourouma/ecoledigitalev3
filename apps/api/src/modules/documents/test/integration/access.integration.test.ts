/**
 * Matrice d'accès sur base réelle : parent / enseignant / élève / personnel / gestion, héritage de catégorie, visibilité,
 * partages, droits de catégorie, lien de tutelle revérifié. Vérifie surtout que la LISTE (SQL) et la DÉCISION (TypeScript,
 * `resolveAccess`) ne divergent jamais.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDocument, getDownloadUrl, listDocuments, archiveDocument, updateDocument } from "../../application/documents";
import { grantCategory, listCategoryGrants, revokeCategoryGrant } from "../../application/categories";
import { listShares, shareDocument, unshareDocument } from "../../application/shares";
import { addVersion, createDocument } from "../../application/uploads";
import { DocumentsCode } from "../../domain/errors";
import { resolveAccess } from "../../domain/policy";
import type { Actor, ActorCaps } from "../../domain/types";
import { factsOf } from "../../application/support";
import * as docsRepo from "../../infrastructure/documents-repository";
import { describeIntegration } from "../support/db";
import { expectErr, must } from "../support/assert";
import { uniquePdf } from "../support/files";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

describeIntegration("module documents : matrice d'accès", () => {
  let w: World;
  const docs: Record<string, string> = {};

  beforeAll(async () => {
    w = await createWorld();
    const m = { userId: USERS.manager, caps: CAPS.manager };
    docs.regulation = await w.seedDocument({ ...m, code: "INSTITUTION_REGULATION", fields: { ownerType: "NONE", ownerId: null, title: "Règlement" } });
    docs.idChild = await w.seedDocument({ ...m, fields: { title: "CNI enfant", ownerId: PEOPLE.child } });
    docs.idOther = await w.seedDocument({ ...m, fields: { title: "CNI autre", ownerId: PEOPLE.other } });
    docs.idPupil = await w.seedDocument({ ...m, fields: { title: "CNI élève", ownerId: PEOPLE.pupil } });
    docs.staffOnly = await w.seedDocument({ ...m, fields: { title: "Note interne", ownerId: PEOPLE.child, visibility: "STAFF_ONLY" } });
    docs.private = await w.seedDocument({ ...m, fields: { title: "Privé", ownerId: PEOPLE.child, visibility: "PRIVATE" } });
    docs.medical = await w.seedDocument({ ...m, code: "STUDENT_MEDICAL", fields: { title: "Certificat", ownerId: PEOPLE.child } });
    docs.contract = await w.seedDocument({ ...m, code: "STAFF_CONTRACT", fields: { title: "Contrat", ownerId: PEOPLE.staffA } });
    docs.diploma = await w.seedDocument({ ...m, code: "STAFF_DIPLOMA", fields: { title: "Diplôme", ownerId: PEOPLE.staffA } });
    docs.accounting = await w.seedDocument({ ...m, code: "FINANCIAL_ACCOUNTING", fields: { title: "Pièce comptable", ownerType: "NONE", ownerId: null } });
    docs.byParent = await w.seedDocument({ userId: USERS.parent, caps: CAPS.parent, fields: { title: "Dépôt du parent", ownerId: PEOPLE.child } });
    docs.archived = await w.seedDocument({ ...m, fields: { title: "Archivé", ownerId: PEOPLE.child } });
    must(await archiveDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: docs.archived!, reason: "doublon" }));
  });
  afterAll(async () => {
    await w?.drop();
  });

  const actors: Array<{ name: string; userId: string; caps: ActorCaps; expected: string[] }> = [
    { name: "gestion", userId: USERS.manager, caps: CAPS.manager, expected: Object.keys(docs) /* rempli après beforeAll */ },
    { name: "secrétariat", userId: USERS.secretary, caps: CAPS.secretary, expected: ["regulation", "idChild", "idOther", "idPupil", "staffOnly", "diploma", "byParent"] },
    { name: "économat", userId: USERS.econome, caps: CAPS.econome, expected: ["regulation", "idChild", "idOther", "idPupil", "staffOnly", "diploma", "byParent"] },
    { name: "enseignant", userId: USERS.teacher, caps: CAPS.teacher, expected: ["regulation"] },
    { name: "parent (enfant lié)", userId: USERS.parent, caps: CAPS.parent, expected: ["idChild", "medical", "byParent"] },
    { name: "parent (autre enfant)", userId: USERS.parent2, caps: CAPS.parent, expected: ["idOther"] },
    { name: "élève", userId: USERS.pupil, caps: CAPS.pupil, expected: ["idPupil"] },
    { name: "personnel (son dossier)", userId: USERS.staffUser, caps: CAPS.staffOwn, expected: ["contract", "diploma"] },
    { name: "inconnu sans droit", userId: USERS.stranger, caps: CAPS.none, expected: [] },
  ];

  const idsOf = async (a: { userId: string; caps: ActorCaps }, status: "ACTIVE" | "ALL" = "ACTIVE"): Promise<string[]> => {
    const out: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = must(await listDocuments(w.deps, w.ctxA(a.userId), { caps: a.caps, query: { limit: 5, ...(cursor ? { cursor } : {}), ...(status === "ALL" ? { status } : {}) } }));
      out.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) return out;
      cursor = page.nextCursor;
    }
  };
  const nameOf = (id: string): string => Object.entries(docs).find(([, v]) => v === id)?.[0] ?? id;

  it("liste par acteur : exactement les documents que la matrice autorise (pagination par curseur comprise)", async () => {
    for (const a of actors) {
      const expected = a.name === "gestion" ? Object.keys(docs).filter((k) => k !== "archived") : a.expected;
      const got = (await idsOf(a)).map(nameOf).sort();
      expect(got, a.name).toEqual([...expected].sort());
    }
    // la gestion, et elle seule, voit l'archivé
    expect((await idsOf({ userId: USERS.manager, caps: CAPS.manager }, "ALL")).map(nameOf)).toContain("archived");
    expect(await idsOf({ userId: USERS.secretary, caps: CAPS.secretary })).not.toContain(docs.archived);
  });

  it("non-divergence : la liste SQL et resolveAccess (TypeScript) donnent la même réponse pour chaque acteur x document", async () => {
    const rows = await w.db.admin.query("SELECT id FROM documents.documents WHERE tenant_id = $1", [w.tenantA]);
    for (const a of actors) {
      const links = await w.ports.owners.resolveActorLinks(w.ctxA(a.userId));
      const actor: Actor = { userId: a.userId, caps: a.caps, links };
      const listed = new Set(await idsOf(a, a.caps.manage === true ? "ALL" : "ACTIVE"));
      for (const r of rows.rows as Array<{ id: string }>) {
        const decided = await w.db.tenantDb.run(w.ctxA(a.userId), async (tx) => {
          const row = await docsRepo.getDocument(tx, w.tenantA, r.id, a.userId, w.clock.now());
          return row ? resolveAccess(actor, factsOf(row)).view : false;
        });
        const fetched = (await getDocument(w.deps, w.ctxA(a.userId), { caps: a.caps, documentId: r.id })).ok;
        expect(fetched, `${a.name} / ${nameOf(r.id)} : détail`).toBe(decided);
        expect(listed.has(r.id), `${a.name} / ${nameOf(r.id)} : liste`).toBe(decided);
      }
    }
  });

  it("AC-4 parent : jamais un élève non lié, jamais PRIVATE / STAFF_ONLY ; 404 identique à un document inexistant", async () => {
    const ctx = w.ctxA(USERS.parent);
    for (const hidden of ["idOther", "idPupil", "staffOnly", "private", "contract", "regulation"]) {
      expectErr(await getDocument(w.deps, ctx, { caps: CAPS.parent, documentId: docs[hidden]! }), DocumentsCode.DOCUMENT_NOT_FOUND);
      expectErr(await getDownloadUrl(w.deps, ctx, { caps: CAPS.parent, documentId: docs[hidden]! }), DocumentsCode.DOCUMENT_NOT_FOUND);
    }
    const visible = must(await getDocument(w.deps, ctx, { caps: CAPS.parent, documentId: docs.idChild! }));
    expect(visible.access).toMatchObject({ write: false, share: false, archive: false, history: false, via: ["GUARDIAN"] });
    expect(visible.shares).toBeNull(); // un parent ne voit pas les partages
    must(await getDownloadUrl(w.deps, ctx, { caps: CAPS.parent, documentId: docs.idChild! }));
  });

  it("AC-4 le lien de tutelle est revérifié à chaque requête : retiré, l'accès est coupé aussitôt ; le dépôt du parent aussi", async () => {
    expect(await idsOf({ userId: USERS.parent, caps: CAPS.parent })).toContain(docs.byParent);
    w.ports.owners.setLinks(w.tenantA, USERS.parent, {});
    try {
      expect(await idsOf({ userId: USERS.parent, caps: CAPS.parent })).toEqual([]);
      expectErr(await getDocument(w.deps, w.ctxA(USERS.parent), { caps: CAPS.parent, documentId: docs.byParent! }), DocumentsCode.DOCUMENT_NOT_FOUND);
    } finally {
      w.ports.owners.setLinks(w.tenantA, USERS.parent, { childStudentIds: [PEOPLE.child] });
    }
    expect(await idsOf({ userId: USERS.parent, caps: CAPS.parent })).toContain(docs.byParent);
  });

  it("AC-5 enseignant : lit INTERNAL, jamais RESTRICTED / CONFIDENTIAL, ne dépose pas dans une catégorie de niveau supérieur", async () => {
    const ctx = w.ctxA(USERS.teacher);
    must(await getDocument(w.deps, ctx, { caps: CAPS.teacher, documentId: docs.regulation! }));
    expectErr(await getDocument(w.deps, ctx, { caps: CAPS.teacher, documentId: docs.idChild! }), DocumentsCode.DOCUMENT_NOT_FOUND);
    expectErr(await getDocument(w.deps, ctx, { caps: CAPS.teacher, documentId: docs.medical! }), DocumentsCode.DOCUMENT_NOT_FOUND);
    const categoryId = await w.category(w.tenantA, "STUDENT_IDENTITY");
    expectErr(
      await createDocument(w.deps, ctx, { caps: CAPS.teacher, fields: { categoryId, title: "x", ownerType: "STUDENT", ownerId: PEOPLE.child, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "a.pdf", bytes: uniquePdf() } }),
      DocumentsCode.FORBIDDEN,
    );
  });

  it("dépôt par le propriétaire : parent pour son enfant lié, élève pour lui-même, personnel pour son dossier ; jamais pour un autre", async () => {
    const identity = await w.category(w.tenantA, "STUDENT_IDENTITY");
    const base = { visibility: "INHERIT" as const, tags: [], metadata: {} };
    const file = () => ({ fileName: "piece.pdf", bytes: uniquePdf() });
    must(await createDocument(w.deps, w.ctxA(USERS.parent), { caps: CAPS.parent, fields: { ...base, categoryId: identity, title: "Parent", ownerType: "STUDENT", ownerId: PEOPLE.child }, file: file() }));
    expectErr(await createDocument(w.deps, w.ctxA(USERS.parent), { caps: CAPS.parent, fields: { ...base, categoryId: identity, title: "Autre enfant", ownerType: "STUDENT", ownerId: PEOPLE.other }, file: file() }), DocumentsCode.FORBIDDEN);
    must(await createDocument(w.deps, w.ctxA(USERS.pupil), { caps: CAPS.pupil, fields: { ...base, categoryId: identity, title: "Élève", ownerType: "STUDENT", ownerId: PEOPLE.pupil }, file: file() }));
    expectErr(await createDocument(w.deps, w.ctxA(USERS.pupil), { caps: CAPS.pupil, fields: { ...base, categoryId: identity, title: "Camarade", ownerType: "STUDENT", ownerId: PEOPLE.child }, file: file() }), DocumentsCode.FORBIDDEN);
    const diploma = await w.category(w.tenantA, "STAFF_DIPLOMA");
    must(await createDocument(w.deps, w.ctxA(USERS.staffUser), { caps: CAPS.staffOwn, fields: { ...base, categoryId: diploma, title: "Mon diplôme", ownerType: "STAFF", ownerId: PEOPLE.staffA }, file: file() }));
    expectErr(await createDocument(w.deps, w.ctxA(USERS.staffUser), { caps: CAPS.staffOwn, fields: { ...base, categoryId: diploma, title: "Diplôme d'un collègue", ownerType: "STAFF", ownerId: PEOPLE.staffB }, file: file() }), DocumentsCode.FORBIDDEN);
    // catégorie sans dépôt par le propriétaire (contrat) : refusé même pour soi
    const contract = await w.category(w.tenantA, "STAFF_CONTRACT");
    expectErr(await createDocument(w.deps, w.ctxA(USERS.staffUser), { caps: CAPS.staffOwn, fields: { ...base, categoryId: contract, title: "Mon contrat", ownerType: "STAFF", ownerId: PEOPLE.staffA }, file: file() }), DocumentsCode.FORBIDDEN);
    // type / propriétaire incohérents
    expectErr(await createDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, fields: { ...base, categoryId: identity, title: "x", ownerType: "NONE", ownerId: null }, file: file() }), DocumentsCode.OWNER_REQUIRED);
    expectErr(await createDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, fields: { ...base, categoryId: identity, title: "x", ownerType: "STUDENT", ownerId: "0192f0a4-7b1e-7c3a-8d2e-0000000fffff" }, file: file() }), DocumentsCode.OWNER_NOT_FOUND);
  });

  describe("partage explicite", () => {
    it("lecture : l'enseignant voit un dossier d'élève partagé, le télécharge, mais ne le modifie ni ne le repartage", async () => {
      const id = docs.idChild!;
      expectErr(await getDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      const share = must(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.teacher, level: "READ", note: "pour le conseil" } }));
      expect(share).toMatchObject({ userId: USERS.teacher, userName: "teacher A", level: "READ", active: true });
      const seen = must(await getDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id }));
      expect(seen.access).toMatchObject({ write: false, share: false, via: ["SHARE"] });
      must(await getDownloadUrl(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id }));
      expectErr(await updateDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id, body: { title: "piraté" } }), DocumentsCode.FORBIDDEN);
      expectErr(await shareDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id, body: { userId: USERS.stranger, level: "READ" } }), DocumentsCode.FORBIDDEN);
      expectErr(await listShares(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id }), DocumentsCode.FORBIDDEN);
      const shares = must(await listShares(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id }));
      expect(shares.filter((s) => s.active)).toHaveLength(1);
      // retrait : tracé, jamais effacé, effet immédiat
      must(await unshareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, shareId: share.id }));
      expectErr(await getDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      expect((await w.db.admin.query("SELECT revoked_at IS NOT NULL AS revoked FROM documents.shares WHERE id = $1", [share.id])).rows[0].revoked).toBe(true);
      const events = await w.db.admin.query("SELECT type FROM kernel.domain_events WHERE aggregate_id = $1 AND type LIKE 'documents.document.%shared' ORDER BY occurred_at", [id]);
      expect(events.rows.map((r) => r.type)).toEqual(["documents.document.shared", "documents.document.unshared"]);
    });

    it("écriture : un partage WRITE permet de déposer une version ; remplacé par un nouveau partage (jamais deux actifs)", async () => {
      const id = docs.idOther!;
      must(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.teacher, level: "WRITE" } }));
      const v2 = must(await addVersion(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id, fields: {}, file: { fileName: "maj.pdf", bytes: uniquePdf() } }));
      expect(v2.currentVersionNo).toBe(2);
      must(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.teacher, level: "READ" } }));
      const active = (await w.db.admin.query("SELECT level FROM documents.shares WHERE document_id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, USERS.teacher])).rows;
      expect(active).toEqual([{ level: "READ" }]);
      expectErr(await addVersion(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id, fields: {}, file: { fileName: "maj2.pdf", bytes: uniquePdf() } }), DocumentsCode.FORBIDDEN);
    });

    it("durée : un partage expire à sa date ; une date passée, soi-même, une personne inconnue, un autre tenant sont refusés", async () => {
      const id = docs.idPupil!;
      const until = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
      must(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.stranger, level: "READ", expiresAt: until } }));
      must(await getDocument(w.deps, w.ctxA(USERS.stranger), { caps: CAPS.none, documentId: id }));
      w.clock.advanceSeconds(3601);
      expectErr(await getDocument(w.deps, w.ctxA(USERS.stranger), { caps: CAPS.none, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      expect(await idsOf({ userId: USERS.stranger, caps: CAPS.none })).not.toContain(id);
      // un nouveau partage remplace le partage périmé
      must(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.stranger, level: "READ" } }));
      must(await getDocument(w.deps, w.ctxA(USERS.stranger), { caps: CAPS.none, documentId: id }));

      expectErr(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.doctor, level: "READ", expiresAt: new Date(w.clock.now().getTime() - 1000).toISOString() } }), DocumentsCode.SHARE_INVALID);
      expectErr(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: USERS.secretary, level: "READ" } }), DocumentsCode.SHARE_INVALID);
      expectErr(await shareDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { userId: "0192f0a4-7b1e-7c3a-8d2e-0000000eeeee", level: "READ" } }), DocumentsCode.SHARE_INVALID);
      // le tenant B ne peut pas partager un document de A, même avec toutes les permissions
      expectErr(await shareDocument(w.deps, w.ctxB(USERS.manager), { caps: CAPS.manager, documentId: id, body: { userId: USERS.doctor, level: "READ" } }), DocumentsCode.DOCUMENT_NOT_FOUND);
    });

    it("un document archivé ne se partage pas et un partage ne donne jamais accès à un archivé", async () => {
      const id = await w.seedDocument({ userId: USERS.manager, caps: CAPS.manager, fields: { title: "À archiver", ownerId: PEOPLE.child } });
      must(await shareDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, body: { userId: USERS.teacher, level: "READ" } }));
      must(await archiveDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, reason: "erreur de saisie" }));
      expectErr(await getDocument(w.deps, w.ctxA(USERS.teacher), { caps: CAPS.teacher, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      expectErr(await shareDocument(w.deps, w.ctxA(USERS.manager), { caps: CAPS.manager, documentId: id, body: { userId: USERS.doctor, level: "READ" } }), DocumentsCode.ARCHIVED);
    });
  });

  describe("droits de catégorie par personne", () => {
    it("un droit READ sur le dossier médical donne la lecture de la catégorie entière, jusqu'à sa révocation", async () => {
      const medical = await w.category(w.tenantA, "STUDENT_MEDICAL");
      const doctor = { userId: USERS.doctor, caps: CAPS.staffOwn };
      expect(await idsOf(doctor)).not.toContain(docs.medical);
      const grant = must(await grantCategory(w.deps, w.ctxA(USERS.manager), { categoryId: medical, body: { userId: USERS.doctor, level: "READ", note: "médecin scolaire" } }));
      expect(grant).toMatchObject({ level: "READ", active: true, userName: "doctor A" });
      expect((await idsOf(doctor)).map(nameOf)).toContain("medical");
      expect((await idsOf(doctor)).map(nameOf)).not.toContain("idChild");
      const detail = must(await getDocument(w.deps, w.ctxA(USERS.doctor), { caps: CAPS.staffOwn, documentId: docs.medical! }));
      expect(detail.access).toMatchObject({ write: false, via: ["CATEGORY_GRANT"] });
      expect(must(await listCategoryGrants(w.deps, w.ctxA(USERS.manager), { categoryId: medical }))).toHaveLength(1);
      must(await revokeCategoryGrant(w.deps, w.ctxA(USERS.manager), { categoryId: medical, grantId: grant.id }));
      expect(await idsOf(doctor)).not.toContain(docs.medical);
      expectErr(await revokeCategoryGrant(w.deps, w.ctxA(USERS.manager), { categoryId: medical, grantId: "0192f0a4-7b1e-7c3a-8d2e-0000000ddddd" }), DocumentsCode.GRANT_NOT_FOUND);
    });

    it("un droit WRITE ouvre le dépôt dans la catégorie ; un droit expiré ne vaut plus rien", async () => {
      const medical = await w.category(w.tenantA, "STUDENT_MEDICAL");
      const until = new Date(w.clock.now().getTime() + 60_000).toISOString();
      must(await grantCategory(w.deps, w.ctxA(USERS.manager), { categoryId: medical, body: { userId: USERS.doctor, level: "WRITE", expiresAt: until } }));
      const fields = { categoryId: medical, title: "Certificat 2", ownerType: "STUDENT" as const, ownerId: PEOPLE.child, visibility: "INHERIT" as const, tags: [], metadata: {} };
      must(await createDocument(w.deps, w.ctxA(USERS.doctor), { caps: CAPS.staffOwn, fields, file: { fileName: "cert.pdf", bytes: uniquePdf() } }));
      w.clock.advanceSeconds(61);
      expectErr(await createDocument(w.deps, w.ctxA(USERS.doctor), { caps: CAPS.staffOwn, fields: { ...fields, title: "Certificat 3" }, file: { fileName: "cert.pdf", bytes: uniquePdf() } }), DocumentsCode.FORBIDDEN);
      // droit rejoué : le nouveau remplace l'ancien, jamais deux droits actifs
      const g1 = must(await grantCategory(w.deps, w.ctxA(USERS.manager), { categoryId: medical, body: { userId: USERS.doctor, level: "READ" } }));
      const g2 = must(await grantCategory(w.deps, w.ctxA(USERS.manager), { categoryId: medical, body: { userId: USERS.doctor, level: "WRITE" } }));
      expect(g2.id).not.toBe(g1.id);
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM documents.category_grants WHERE category_id = $1 AND user_id = $2 AND revoked_at IS NULL", [medical, USERS.doctor])).rows[0].n).toBe(1);
    });

    it("le tenant B ne peut ni lister ni accorder un droit sur une catégorie de A", async () => {
      const medicalA = await w.category(w.tenantA, "STUDENT_MEDICAL");
      expectErr(await listCategoryGrants(w.deps, w.ctxB(USERS.manager), { categoryId: medicalA }), DocumentsCode.CATEGORY_NOT_FOUND);
      expectErr(await grantCategory(w.deps, w.ctxB(USERS.manager), { categoryId: medicalA, body: { userId: USERS.doctor, level: "READ" } }), DocumentsCode.CATEGORY_NOT_FOUND);
    });
  });

  it("recherche : titre, étiquettes, métadonnées, nom du fichier, catégorie, nom du propriétaire ; filtres de catégorie, d'état et de portée", async () => {
    const id = await w.seedDocument({
      userId: USERS.manager,
      caps: CAPS.manager,
      fileName: "Acte de naissance.pdf",
      fields: { title: "Extrait Zébré", ownerId: PEOPLE.other, tags: ["état-civil"], metadata: { numeroActe: "N-2026-0042" }, description: "copie intégrale" },
    });
    const find = async (q: string, extra: Record<string, string> = {}): Promise<string[]> =>
      must(await listDocuments(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, query: { q, ...extra } })).items.map((i) => i.id);
    expect(await find("zebre")).toContain(id); // sans accents ni casse
    expect(await find("ETAT-CIVIL")).toContain(id);
    expect(await find("n-2026-0042")).toContain(id);
    expect(await find("acte de naissance")).toContain(id);
    expect(await find("copie intégrale")).toContain(id);
    expect(await find("pièces d'identité")).toContain(id); // libellé de la catégorie
    expect(await find("Autre A")).toContain(id); // nom du propriétaire (annuaire)
    expect(await find("introuvable-xyz")).not.toContain(id);
    expect(await find("100%")).toEqual([]); // les jokers LIKE sont neutralisés
    const identity = await w.category(w.tenantA, "STUDENT_IDENTITY");
    expect(await find("", { categoryId: identity, ownerId: PEOPLE.other })).toContain(id);
    expect(await find("", { kind: "FINANCIAL" })).toEqual([]);
    expect(await find("", { scope: "mine" })).not.toContain(id); // déposé par la gestion
    expectErr(await listDocuments(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, query: { status: "ARCHIVED" } }), DocumentsCode.FORBIDDEN);
    expect(must(await listDocuments(w.deps, w.ctxA(USERS.parent), { caps: CAPS.parent, query: { scope: "child" } })).items.every((i) => i.ownerId === PEOPLE.child)).toBe(true);
    expect(must(await listDocuments(w.deps, w.ctxA(USERS.pupil), { caps: CAPS.pupil, query: { scope: "self" } })).items.every((i) => i.ownerId === PEOPLE.pupil)).toBe(true);
    // tri par titre et curseur cohérents
    const asc = must(await listDocuments(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, query: { sort: "title", dir: "asc", limit: 3 } }));
    const titles = asc.items.map((i) => i.title.toLowerCase());
    expect([...titles].sort()).toEqual(titles);
    const more = must(await listDocuments(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, query: { sort: "title", dir: "asc", limit: 3, cursor: asc.nextCursor! } }));
    expect(more.items[0]!.title.toLowerCase() >= titles[2]!).toBe(true);
  });

  it("métadonnées : un parent ne peut pas modifier la visibilité d'un document qu'il voit, le secrétariat le peut (audité)", async () => {
    const id = docs.byParent!;
    expectErr(await updateDocument(w.deps, w.ctxA(USERS.parent2), { caps: CAPS.parent, documentId: id, body: { visibility: "INHERIT" } }), DocumentsCode.DOCUMENT_NOT_FOUND);
    const updated = must(await updateDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, body: { visibility: "STAFF_ONLY", tags: ["vérifié"], title: "Dépôt vérifié" } }));
    expect(updated).toMatchObject({ visibility: "STAFF_ONLY", title: "Dépôt vérifié", tags: ["vérifié"] });
    expect(w.audit.entries.some((e) => e.entry.action === "documents.document.updated" && e.entry.sensitive === true)).toBe(true);
    // STAFF_ONLY : le parent (déposant, lien valide) garde son dépôt, mais le parent d'un autre enfant n'y accède pas
    expect((await idsOf({ userId: USERS.parent, caps: CAPS.parent })).includes(id)).toBe(true);
  });
});
