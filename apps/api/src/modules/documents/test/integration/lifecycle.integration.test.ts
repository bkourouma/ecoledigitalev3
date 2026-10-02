/**
 * Cycle de vie sur base réelle : archivage (suppression logique), restauration, purge de rétention, alertes d'expiration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext } from "@ecoledigitale/kernel";
import { updateCategory, updateSettings } from "../../application/categories";
import { archiveDocument, expirationCounts, getDocument, getDownloadUrl, listDocuments, restoreDocument, updateDocument } from "../../application/documents";
import { runHousekeeping, sweepExpirations } from "../../application/housekeeping";
import { addVersion, createDocument } from "../../application/uploads";
import { DocumentsCode } from "../../domain/errors";
import { addDays, isoDay } from "../../domain/expiry";
import { describeIntegration } from "../support/db";
import { expectErr, must } from "../support/assert";
import { uniquePdf } from "../support/files";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

describeIntegration("module documents : archivage, purge, expiration", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.drop();
  });

  const events = async (type: string, documentId?: string): Promise<Array<Record<string, unknown>>> =>
    (await w.db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = $1 AND ($2::text IS NULL OR aggregate_id = $2::text) ORDER BY occurred_at, id", [type, documentId ?? null])).rows.map((r) => r.payload as Record<string, unknown>);
  const system = (tenant = w.tenantA) => createSystemContext(tenant);
  const manager = () => ({ userId: USERS.manager, caps: CAPS.manager });
  const today = (): string => isoDay(w.clock.now());
  const adminCtx = () => w.ctxA(USERS.manager);

  describe("AC-10 archivage, restauration, purge", () => {
    it("archiver exige la permission et masque le document (sauf à la gestion) ; restaurer est réservé à la gestion", async () => {
      const id = await w.seedDocument({ ...manager(), fields: { title: "À archiver" } });
      expectErr(await archiveDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id, reason: "doublon" }), DocumentsCode.FORBIDDEN);

      const ack = must(await archiveDocument(w.deps, w.ctxA(USERS.directeurEtudes), { caps: CAPS.directeurEtudes, documentId: id, reason: "pièce périmée" }));
      expect(ack).toMatchObject({ id, status: "ARCHIVED" });
      expect(new Date(ack.purgeAfter!).getTime() - w.clock.now().getTime()).toBe(365 * 86_400_000); // rétention par défaut des paramètres

      // plus visible hors gestion (404), ni dans les listes, ni pour le déposant
      expectErr(await getDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      expectErr(await getDocument(w.deps, w.ctxA(USERS.directeurEtudes), { caps: CAPS.directeurEtudes, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      expect(must(await listDocuments(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, query: {} })).items.map((i) => i.id)).not.toContain(id);
      // la gestion le voit, avec le motif, et peut encore le lire
      const seen = must(await getDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }));
      expect(seen).toMatchObject({ status: "ARCHIVED", archiveReason: "pièce périmée" });
      expect(must(await listDocuments(w.deps, adminCtx(), { caps: CAPS.manager, query: { status: "ARCHIVED" } })).items.map((i) => i.id)).toContain(id);
      must(await getDownloadUrl(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }));
      // un archivé ne se modifie ni ne reçoit de version
      expectErr(await archiveDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id, reason: "encore" }), DocumentsCode.ARCHIVED);
      expectErr(await updateDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id, body: { title: "x" } }), DocumentsCode.ARCHIVED);
      expectErr(await addVersion(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id, fields: {}, file: { fileName: "v.pdf", bytes: uniquePdf() } }), DocumentsCode.ARCHIVED);

      // restauration : réservée à la gestion (les autres ne voient même pas le document)
      expectErr(await restoreDocument(w.deps, w.ctxA(USERS.directeurEtudes), { caps: CAPS.directeurEtudes, documentId: id }), DocumentsCode.DOCUMENT_NOT_FOUND);
      const restored = must(await restoreDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }));
      expect(restored).toMatchObject({ status: "ACTIVE", archivedAt: null, purgeAfter: null });
      expect(must(await getDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id })).id).toBe(id);
      expectErr(await restoreDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }), DocumentsCode.NOT_ARCHIVED);

      expect((await events("documents.document.archived", id)).length).toBe(1);
      expect((await events("documents.document.restored", id)).length).toBe(1);
      const history = await w.db.admin.query("SELECT action FROM documents.document_events WHERE document_id = $1 AND action IN ('ARCHIVED', 'RESTORED') ORDER BY occurred_at, id", [id]);
      expect(history.rows.map((r) => r.action)).toEqual(["ARCHIVED", "RESTORED"]);
      expect(w.audit.entries.filter((e) => ["documents.document.archived", "documents.document.restored"].includes(e.entry.action)).every((e) => e.entry.sensitive === true)).toBe(true);
    });

    it("purge de rétention : objets supprimés, versions PURGED, contenu descriptif effacé, historique et empreintes conservés", async () => {
      const id = await w.seedDocument({ ...manager(), fields: { title: "À purger", description: "texte privé", tags: ["secret"], metadata: { ref: "R-1" } } });
      must(await addVersion(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id, fields: {}, file: { fileName: "v2.pdf", bytes: uniquePdf() } }));
      const versions = (await w.db.admin.query("SELECT storage_key, sha256 FROM documents.versions WHERE document_id = $1 ORDER BY version_no", [id])).rows as Array<{ storage_key: string; sha256: string }>;
      for (const v of versions) expect(w.ports.storage.objects.has(v.storage_key)).toBe(true);
      must(await archiveDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id, reason: "fin de conservation" }));

      w.clock.advanceDays(364);
      expect((await runHousekeeping(w.deps, system())).documentsPurged).toBe(0); // rétention pas encore échue
      for (const v of versions) expect(w.ports.storage.objects.has(v.storage_key)).toBe(true);

      w.clock.advanceDays(2);
      const report = await runHousekeeping(w.deps, system());
      expect(report).toMatchObject({ documentsPurged: 1, versionsPurged: 2, failures: 0 });
      for (const v of versions) expect(w.ports.storage.objects.has(v.storage_key)).toBe(false);

      const doc = (await w.db.admin.query("SELECT title, description, tags, metadata, search_key, purged_at, status FROM documents.documents WHERE id = $1", [id])).rows[0];
      expect(doc).toMatchObject({ title: "[purgé]", description: null, tags: [], metadata: {}, search_key: "", status: "ARCHIVED" });
      expect(doc.purged_at).not.toBeNull();
      const vs = (await w.db.admin.query("SELECT state, file_name, sha256 FROM documents.versions WHERE document_id = $1 ORDER BY version_no", [id])).rows;
      expect(vs.map((v) => v.state)).toEqual(["PURGED", "PURGED"]);
      expect(vs.map((v) => v.sha256)).toEqual(versions.map((v) => v.sha256)); // l'empreinte reste (preuve)
      expect(vs.every((v) => v.file_name.startsWith("purgé."))).toBe(true);
      const history = await w.db.admin.query("SELECT action FROM documents.document_events WHERE document_id = $1 ORDER BY occurred_at, id", [id]);
      expect(history.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["CREATED", "VERSION_ADDED", "ARCHIVED", "PURGED"]));
      expect((await events("documents.document.purged", id))[0]).toMatchObject({ v: 1, documentId: id, versionsPurged: 2 });
      expect(JSON.stringify(await events("documents.document.purged", id))).not.toContain("secret");

      // la gestion voit encore la trace, plus le fichier ; plus de restauration ; le job est idempotent
      const traced = must(await getDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }));
      expect(traced.versions.every((v) => v.state === "PURGED" && v.previewKind === "NONE")).toBe(true);
      expectErr(await getDownloadUrl(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }), DocumentsCode.OBJECT_MISSING);
      expectErr(await restoreDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id }), DocumentsCode.NOT_ARCHIVED);
      expect((await runHousekeeping(w.deps, system())).documentsPurged).toBe(0);
    });

    it("échec du stockage : la ligne n'est pas purgée (l'objet d'abord), le job réessaie ensuite", async () => {
      const id = await w.seedDocument({ ...manager(), fields: { title: "Purge retardée" } });
      must(await archiveDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: id, reason: "test" }));
      w.clock.advanceDays(400);
      w.ports.storage.failDelete = true;
      try {
        const failed = await runHousekeeping(w.deps, system());
        expect(failed.failures).toBeGreaterThanOrEqual(1);
        expect(failed.documentsPurged).toBe(0);
        expect((await w.db.admin.query("SELECT purged_at FROM documents.documents WHERE id = $1", [id])).rows[0].purged_at).toBeNull();
        expect((await w.db.admin.query("SELECT state FROM documents.versions WHERE document_id = $1", [id])).rows[0].state).toBe("ACTIVE");
      } finally {
        w.ports.storage.failDelete = false;
      }
      expect((await runHousekeeping(w.deps, system())).documentsPurged).toBe(1);
    });

    it("rétention propre à la catégorie et rétention 0 (jamais purgé)", async () => {
      const identity = (await w.db.admin.query("SELECT id FROM documents.categories WHERE tenant_id = $1 AND code = 'STUDENT_IDENTITY'", [w.tenantA])).rows[0].id as string;
      must(await updateCategory(w.deps, adminCtx(), { caps: CAPS.manager, id: identity, body: { retentionDays: 10 } }));
      const short = await w.seedDocument({ ...manager(), fields: { title: "Rétention courte" } });
      const ack = must(await archiveDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: short, reason: "test" }));
      expect(new Date(ack.purgeAfter!).getTime() - w.clock.now().getTime()).toBe(10 * 86_400_000);
      w.clock.advanceDays(11);
      expect((await runHousekeeping(w.deps, system())).documentsPurged).toBe(1);

      must(await updateCategory(w.deps, adminCtx(), { caps: CAPS.manager, id: identity, body: { retentionDays: null } }));
      must(await updateSettings(w.deps, adminCtx(), { body: { archiveRetentionDays: 0 } }));
      const forever = await w.seedDocument({ ...manager(), fields: { title: "Jamais purgé" } });
      expect(must(await archiveDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: forever, reason: "test" })).purgeAfter).toBeNull();
      w.clock.advanceDays(5000);
      expect((await runHousekeeping(w.deps, system())).documentsPurged).toBe(0);
      expect((await w.db.admin.query("SELECT purged_at FROM documents.documents WHERE id = $1", [forever])).rows[0].purged_at).toBeNull();
      must(await updateSettings(w.deps, adminCtx(), { body: { archiveRetentionDays: 365 } }));
    });
  });

  describe("AC-9 expiration et alertes", () => {
    const authorization = async (): Promise<string> => (await w.db.admin.query("SELECT id FROM documents.categories WHERE tenant_id = $1 AND code = 'STAFF_AUTHORIZATION'", [w.tenantA])).rows[0].id as string;
    const createAuthorization = async (over: { expiresOn: string; alertDays?: number[]; title?: string }) =>
      must(
        await createDocument(w.deps, w.ctxA(USERS.secretary), {
          caps: CAPS.secretary,
          fields: { categoryId: await authorization(), title: over.title ?? "Habilitation", ownerType: "STAFF", ownerId: PEOPLE.staffA, visibility: "INHERIT", tags: [], metadata: {}, expiresOn: over.expiresOn, ...(over.alertDays ? { alertDays: over.alertDays } : {}) },
          file: { fileName: "habilitation.pdf", bytes: uniquePdf() },
        }),
      );

    it("une alerte par seuil franchi (30, 7, 1), puis « échu » une fois ; jamais deux fois ; sans titre ni nom de fichier", async () => {
      // le jeu de catégories existe (première lecture) avant la première balayage
      w.clock.set(new Date("2027-03-01T09:00:00Z"));
      const doc = await createAuthorization({ expiresOn: addDays(today(), 20), title: "Habilitation secrète" });
      const id = doc.id;
      expect(doc.expiryState).toBe("EXPIRING");
      expect(doc.daysToExpiry).toBe(20);

      expect((await sweepExpirations(w.deps, system())).alerted).toBeGreaterThanOrEqual(1);
      let alerts = await events("documents.document.expiring", id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ v: 1, documentId: id, kind: "TEACHER", ownerType: "STAFF", ownerId: PEOPLE.staffA, createdBy: USERS.secretary, expiresOn: addDays(today(), 20), daysLeft: 20, threshold: 30 });
      expect(JSON.stringify(alerts)).not.toMatch(/secrète|habilitation\.pdf/i);

      expect((await sweepExpirations(w.deps, system())).alerted).toBe(0); // idempotent
      expect(await events("documents.document.expiring", id)).toHaveLength(1);

      w.clock.advanceDays(14); // 6 jours restants : seuil 7
      await sweepExpirations(w.deps, system());
      alerts = await events("documents.document.expiring", id);
      expect(alerts.map((a) => a.threshold)).toEqual([30, 7]);
      expect(alerts[1]).toMatchObject({ daysLeft: 6 });

      w.clock.advanceDays(6); // le jour même : encore valable, seuil 1
      await sweepExpirations(w.deps, system());
      expect((await events("documents.document.expiring", id)).map((a) => a.threshold)).toEqual([30, 7, 1]);
      expect(await events("documents.document.expired", id)).toHaveLength(0);

      w.clock.advanceDays(1); // échu depuis 1 jour
      await sweepExpirations(w.deps, system());
      await sweepExpirations(w.deps, system());
      const expired = await events("documents.document.expired", id);
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ v: 1, documentId: id, daysOverdue: 1, createdBy: USERS.secretary });
      expect(await events("documents.document.expiring", id)).toHaveLength(3);

      const detail = must(await getDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: id }));
      expect(detail).toMatchObject({ expiryState: "EXPIRED", daysToExpiry: -1 });
      const history = await w.db.admin.query("SELECT action FROM documents.document_events WHERE document_id = $1 AND actor_id IS NULL ORDER BY occurred_at, id", [id]);
      expect(history.rows.map((r) => r.action)).toEqual(["EXPIRY_ALERTED", "EXPIRY_ALERTED", "EXPIRY_ALERTED", "EXPIRED"]);
    });

    it("changer l'échéance réarme les alertes ; une version avec une nouvelle échéance aussi ; sans échéance, la catégorie l'exige", async () => {
      const doc = await createAuthorization({ expiresOn: addDays(today(), 25), title: "Renouvelable" });
      await sweepExpirations(w.deps, system());
      expect((await events("documents.document.expiring", doc.id)).map((a) => a.threshold)).toEqual([30]);

      // repousser l'échéance à +40 jours : plus d'alerte jusqu'à nouveau franchissement
      must(await updateDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: doc.id, body: { expiresOn: addDays(today(), 40) } }));
      await sweepExpirations(w.deps, system());
      expect(await events("documents.document.expiring", doc.id)).toHaveLength(1);
      w.clock.advanceDays(15); // 25 jours restants : le seuil 30 est franchi À NOUVEAU (réarmé)
      await sweepExpirations(w.deps, system());
      expect((await events("documents.document.expiring", doc.id)).map((a) => a.threshold)).toEqual([30, 30]);

      // échéance retirée : refusé par la catégorie
      expectErr(await updateDocument(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: doc.id, body: { expiresOn: null } }), DocumentsCode.EXPIRY_REQUIRED);

      // après échéance : une nouvelle version DOIT porter une nouvelle échéance
      w.clock.advanceDays(40);
      await sweepExpirations(w.deps, system());
      expect(await events("documents.document.expired", doc.id)).toHaveLength(1);
      expectErr(await addVersion(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: doc.id, fields: {}, file: { fileName: "renouvelee.pdf", bytes: uniquePdf() } }), DocumentsCode.EXPIRY_REQUIRED);
      const renewed = must(await addVersion(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, documentId: doc.id, fields: { expiresOn: addDays(today(), 200) }, file: { fileName: "renouvelee.pdf", bytes: uniquePdf() } }));
      expect(renewed).toMatchObject({ currentVersionNo: 2, expiryState: "VALID", expiresOn: addDays(today(), 200) });
      await sweepExpirations(w.deps, system());
      expect(await events("documents.document.expired", doc.id)).toHaveLength(1); // réarmé, pas renotifié
    });

    it("seuils propres au document (prioritaires) ; seuils de l'établissement modifiables", async () => {
      const own = await createAuthorization({ expiresOn: addDays(today(), 20), alertDays: [3], title: "Seuil propre" });
      await sweepExpirations(w.deps, system());
      expect(await events("documents.document.expiring", own.id)).toHaveLength(0); // 20 jours > 3
      w.clock.advanceDays(17); // 3 jours restants
      await sweepExpirations(w.deps, system());
      expect((await events("documents.document.expiring", own.id)).map((a) => a.threshold)).toEqual([3]);

      must(await updateSettings(w.deps, adminCtx(), { body: { defaultAlertDays: [60, 45] } }));
      const settingsBound = await createAuthorization({ expiresOn: addDays(today(), 50), title: "Seuil établissement" });
      // la catégorie n'a pas de seuils propres : ceux de l'établissement s'appliquent
      await sweepExpirations(w.deps, system());
      expect((await events("documents.document.expiring", settingsBound.id)).map((a) => a.threshold)).toEqual([60]);
      must(await updateSettings(w.deps, adminCtx(), { body: { defaultAlertDays: [30, 7, 1] } }));
    });

    it("compteurs et filtres : à échoir, échus, sans échéance alors que la catégorie l'exige", async () => {
      const soon = await createAuthorization({ expiresOn: addDays(today(), 5), title: "Bientôt" });
      const diploma = (await w.db.admin.query("SELECT id FROM documents.categories WHERE tenant_id = $1 AND code = 'STAFF_DIPLOMA'", [w.tenantA])).rows[0].id as string;
      const undated = must(
        await createDocument(w.deps, w.ctxA(USERS.secretary), {
          caps: CAPS.secretary,
          fields: { categoryId: diploma, title: "Diplôme sans date", ownerType: "STAFF", ownerId: PEOPLE.staffA, visibility: "INHERIT", tags: [], metadata: {} },
          file: { fileName: "d.pdf", bytes: uniquePdf() },
        }),
      );
      must(await updateCategory(w.deps, adminCtx(), { caps: CAPS.manager, id: diploma, body: { requiresExpiry: true } })); // la règle se durcit : le diplôme est « sans date »
      const counts = must(await expirationCounts(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, withinDays: 30 }));
      expect(counts.expiring).toBeGreaterThanOrEqual(1);
      expect(counts.expired).toBeGreaterThanOrEqual(1);
      expect(counts.missingExpiry).toBeGreaterThanOrEqual(1);
      expect(counts.quarantineHeld).toBeNull(); // réservé à la gestion de la quarantaine
      expect(must(await expirationCounts(w.deps, adminCtx(), { caps: CAPS.manager })).quarantineHeld).toBe(0);
      const ids = async (expiry: "expiring" | "expired" | "missing" | "dated") =>
        must(await listDocuments(w.deps, w.ctxA(USERS.secretary), { caps: CAPS.secretary, query: { expiry, withinDays: 30 } })).items.map((i) => i.id);
      expect(await ids("expiring")).toContain(soon.id);
      expect(await ids("expiring")).not.toContain(undated.id);
      expect(await ids("missing")).toContain(undated.id);
      expect(await ids("dated")).toContain(soon.id);
      expect((await ids("expired")).length).toBeGreaterThanOrEqual(1);
      expect(await ids("expired")).not.toContain(soon.id);
    });

    it("le balayage d'un tenant n'émet rien pour un autre (isolation) et un archivé n'alerte pas", async () => {
      const before = (await events("documents.document.expiring")).length;
      const report = await sweepExpirations(w.deps, system(w.tenantB));
      expect(report).toMatchObject({ checked: 0, alerted: 0, expired: 0 });
      expect((await events("documents.document.expiring")).length).toBe(before);
      const doc = await createAuthorization({ expiresOn: addDays(today(), 3), title: "Archivée avant l'alerte" });
      must(await archiveDocument(w.deps, adminCtx(), { caps: CAPS.manager, documentId: doc.id, reason: "test" }));
      await sweepExpirations(w.deps, system());
      expect(await events("documents.document.expiring", doc.id)).toHaveLength(0);
    });
  });
});
