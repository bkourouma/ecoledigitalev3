import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createBatch, reissueReportCard } from "../../application/issue";
import { publishMany, publishReportCard, revokeReportCard, withdrawReportCard } from "../../application/lifecycle";
import { getDownloadUrl, listForFamily, listReportCards } from "../../application/queries";
import { updateReportcardsSettings } from "../../application/reference";
import { renderReportCard } from "../../application/render";
import { makeSampleBundle } from "../../infrastructure/in-memory-ports";
import { adminRows, createReportcardsTestDb, describeIntegration, ctxFor, type ReportcardsTestDb } from "../support/db";
import { makeWorld, newActor, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("accès aux bulletins : gestion, élève, tuteur lié, tuteur non lié, autre tenant (US6)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;
  let ids: string[]; // un bulletin par élève
  const MANAGE = { manage: true } as const;

  const studentActor = newActor;
  let pupil0: ReturnType<typeof newActor>; // élève du bulletin 0
  let guardian0: ReturnType<typeof newActor>; // tuteur lié à l'élève 0
  let guardian1: ReturnType<typeof newActor>; // tuteur lié à l'élève 1 seulement
  let stranger: ReturnType<typeof newActor>; // aucun lien
  let otherTenantAdmin: ReturnType<typeof newActor>;

  const download = (ctx: ReturnType<typeof newActor>, id: string, caps: Parameters<typeof getDownloadUrl>[2]) => getDownloadUrl(world.deps, ctx.ctx, { ...caps, reportCardId: id });
  const code = async (r: Awaited<ReturnType<typeof download>>): Promise<string> => (r.ok ? "ok" : r.error.code);

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 3 });
    unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    const rows = await adminRows<any>(db, "SELECT id, student_id FROM reportcards.report_cards WHERE tenant_id = $1", [school.tenantId]);
    ids = school.students.map((s) => rows.find((r) => r.student_id === s.studentId)!.id);
    pupil0 = studentActor(school.tenantId);
    guardian0 = studentActor(school.tenantId);
    guardian1 = studentActor(school.tenantId);
    stranger = studentActor(school.tenantId);
    world.guardianship.studentOfUser.set(pupil0.userId, school.students[0]!.studentId);
    world.guardianship.link(guardian0.userId, school.students[0]!.studentId);
    world.guardianship.link(guardian1.userId, school.students[1]!.studentId);
    otherTenantAdmin = studentActor(await db.createTenant());
  });
  afterAll(async () => {
    await db.drop();
  });

  it("publication impossible tant que le PDF n'est pas prêt, puis possible ; provisoire jamais publiable", async () => {
    const early = await publishReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.code).toBe("reportcards.not_rendered");
    for (const id of ids) unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: id }));
  });

  describe("avant publication", () => {
    it("la gestion télécharge un bulletin émis non publié (URL signée ≤ 5 min, nom de fichier assaini)", async () => {
      const r = unwrap(await download(school.admin, ids[0]!, MANAGE));
      expect(r.fileName).toMatch(/^bulletin-ELEVE1-Pr-nom1-v1\.pdf$|^bulletin-[A-Za-z0-9-]+-v1\.pdf$/);
      expect(r.expiresAt.getTime() - world.clock.now().getTime()).toBe(300_000);
      expect(world.storage.verifySignedUrl(r.url)).toMatchObject({ ok: true });
      expect(r.pdfHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("l'élève et le tuteur lié se voient REFUSER un bulletin non publié (403, sans détail) ; rien n'est journalisé", async () => {
      expect(await code(await download(pupil0, ids[0]!, { manage: false, family: { self: true } }))).toBe("reportcards.not_published");
      expect(await code(await download(guardian0, ids[0]!, { manage: false, family: { child: true } }))).toBe("reportcards.not_published");
      expect(await adminRows(db, "SELECT 1 FROM reportcards.access_log")).toHaveLength(0);
      const list = unwrap(await listForFamily(world.deps, pupil0.ctx, { caps: { self: true }, limit: 20 }));
      expect(list.items).toHaveLength(0);
    });

    it("tuteur non lié, élève d'un autre, inconnu, autre tenant : 404 identique à un bulletin inexistant (aucune fuite d'existence)", async () => {
      const unknown = await code(await download(stranger, newId(), { manage: false, family: { child: true } }));
      expect(unknown).toBe("reportcards.not_found");
      expect(await code(await download(stranger, ids[0]!, { manage: false, family: { child: true } }))).toBe(unknown);
      expect(await code(await download(guardian1, ids[0]!, { manage: false, family: { child: true } }))).toBe(unknown);
      expect(await code(await download(pupil0, ids[1]!, { manage: false, family: { self: true } }))).toBe(unknown);
      // Une capacité sans la relation ne suffit pas : être « parent » n'ouvre que SES enfants.
      expect(await code(await download(guardian0, ids[1]!, { manage: false, family: { child: true, self: true } }))).toBe(unknown);
      // Autre tenant, même avec la capacité de gestion : la RLS rend la ligne invisible.
      expect(await code(await download(otherTenantAdmin, ids[0]!, MANAGE))).toBe(unknown);
      // Sans aucune capacité : refus fermé.
      expect(await code(await download(stranger, ids[0]!, { manage: false }))).toBe(unknown);
    });
  });

  describe("publication", () => {
    beforeAll(async () => {
      unwrap(await publishReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
    });

    it("publié : l'élève et SON tuteur lié téléchargent ; chaque accès famille est journalisé (qui, quand, quoi) et audité", async () => {
      const p = unwrap(await download(pupil0, ids[0]!, { manage: false, family: { self: true } }));
      const g = unwrap(await download(guardian0, ids[0]!, { manage: false, family: { child: true } }));
      expect(world.storage.verifySignedUrl(p.url)).toMatchObject({ ok: true });
      expect(g.expiresAt.getTime() - world.clock.now().getTime()).toBe(300_000);
      const log = await adminRows<any>(db, "SELECT user_id, actor_kind, report_card_id, occurred_at FROM reportcards.access_log ORDER BY occurred_at, id");
      expect(log.map((l) => [l.user_id, l.actor_kind, l.report_card_id])).toEqual([[pupil0.userId, "STUDENT", ids[0]], [guardian0.userId, "GUARDIAN", ids[0]]]);
      const audited = world.audit.entries.filter((e) => e.entry.action === "reportcards.report_card.downloaded");
      expect(audited.map((a) => (a.entry.metadata as any).by)).toEqual(expect.arrayContaining(["STUDENT", "GUARDIAN", "MANAGEMENT"]));
      expect(audited.filter((a) => (a.entry.metadata as any).by !== "MANAGEMENT").every((a) => a.entry.sensitive)).toBe(true);
    });

    it("l'URL signée expire (≤ 5 min) : refusée une seconde après, altérée refusée", async () => {
      const r = unwrap(await download(guardian0, ids[0]!, { manage: false, family: { child: true } }));
      expect(world.storage.verifySignedUrl(r.url).ok).toBe(true);
      expect(world.storage.verifySignedUrl(r.url.replace(/sig=[0-9a-f]/, "sig=0"))).toEqual({ ok: false, reason: "bad_signature" });
      world.clock.advance(301_000);
      expect(world.storage.verifySignedUrl(r.url)).toEqual({ ok: false, reason: "expired" });
      world.clock.advance(-301_000);
    });

    it("liste « Mes bulletins » / enfants : uniquement les publiés, uniquement les siens", async () => {
      const mine = unwrap(await listForFamily(world.deps, pupil0.ctx, { caps: { self: true }, limit: 20 }));
      expect(mine.items.map((c) => c.id)).toEqual([ids[0]]);
      const kids = unwrap(await listForFamily(world.deps, guardian0.ctx, { caps: { child: true }, limit: 20 }));
      expect(kids.items.map((c) => c.id)).toEqual([ids[0]]);
      // Le tuteur de l'élève 1 (bulletin NON publié) n'en voit aucun ; un enfant non lié → 404.
      expect(unwrap(await listForFamily(world.deps, guardian1.ctx, { caps: { child: true }, limit: 20 })).items).toHaveLength(0);
      const notMine = await listForFamily(world.deps, guardian1.ctx, { caps: { child: true }, studentId: school.students[0]!.studentId, limit: 20 });
      expect(notMine.ok).toBe(false);
      if (!notMine.ok) expect(notMine.error.code).toBe("reportcards.not_found");
      expect(unwrap(await listForFamily(world.deps, stranger.ctx, { caps: { child: true, self: true }, limit: 20 })).items).toHaveLength(0);
    });

    it("tutelle retirée : l'accès est perdu IMMÉDIATEMENT, aucun jeton long (AC6.3)", async () => {
      world.guardianship.unlink(guardian0.userId, school.students[0]!.studentId);
      expect(await code(await download(guardian0, ids[0]!, { manage: false, family: { child: true } }))).toBe("reportcards.not_found");
      expect(unwrap(await listForFamily(world.deps, guardian0.ctx, { caps: { child: true }, limit: 20 })).items).toHaveLength(0);
      world.guardianship.link(guardian0.userId, school.students[0]!.studentId);
      expect(await code(await download(guardian0, ids[0]!, { manage: false, family: { child: true } }))).toBe("ok");
    });

    it("retrait aux familles (withdraw) : plus visible ni téléchargeable côté famille, toujours côté gestion ; republication", async () => {
      unwrap(await withdrawReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
      expect(await code(await download(pupil0, ids[0]!, { manage: false, family: { self: true } }))).toBe("reportcards.not_published");
      expect(unwrap(await listForFamily(world.deps, pupil0.ctx, { caps: { self: true }, limit: 20 })).items).toHaveLength(0);
      expect(await code(await download(school.admin, ids[0]!, MANAGE))).toBe("ok");
      const again = await withdrawReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! });
      expect(again.ok).toBe(false);
      unwrap(await publishReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! }));
      expect(await code(await download(pupil0, ids[0]!, { manage: false, family: { self: true } }))).toBe("ok");
      const dup = await publishReportCard(world.deps, school.admin.ctx, { reportCardId: ids[0]! });
      expect(dup.ok).toBe(false);
    });

    it("événements `published` / `withdrawn` conformes ; publication et retrait audités (sensibles)", async () => {
      const ev = await adminRows<any>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type IN ('reportcards.report_card.published','reportcards.report_card.withdrawn') ORDER BY id", [school.tenantId]);
      expect(ev.map((e) => e.type)).toEqual(["reportcards.report_card.published", "reportcards.report_card.withdrawn", "reportcards.report_card.published"]);
      expect(ev[0].payload).toMatchObject({ v: 1, reportCardId: ids[0], studentId: school.students[0]!.studentId, version: 1 });
      expect(world.audit.entries.filter((e) => e.entry.action === "reportcards.report_card.published" && e.entry.sensitive)).toHaveLength(2);
    });
  });

  describe("publication par lot", () => {
    it("publie les bulletins rendus, ignore (et liste) ceux qui ne sont pas éligibles", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 3 });
      const view = unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const rows = await adminRows<any>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [t]);
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: rows[0].id }));
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: rows[1].id }));
      unwrap(await publishReportCard(world.deps, s.admin.ctx, { reportCardId: rows[0].id }));
      const result = unwrap(await publishMany(world.deps, s.admin.ctx, { batchId: view.batch.id }));
      expect(result).toMatchObject({ published: 1, alreadyPublished: 1 });
      expect(result.skipped).toEqual([{ reportCardId: rows[2].id, reason: "NOT_RENDERED" }]);
      const ids2 = await publishMany(world.deps, s.admin.ctx, { reportCardIds: [rows[2].id, newId()] });
      expect(ids2.ok && ids2.value.published).toBe(0);
      expect(ids2.ok && ids2.value.skipped.map((x) => x.reason).sort()).toEqual(["NOT_FOUND", "NOT_RENDERED"]);
      expect(world.audit.actions).toContain("reportcards.report_cards.published");
    });
  });

  describe("remplacement et révocation (US3)", () => {
    it("après réémission, la famille voit la DERNIÈRE version publiée ; l'ancienne n'est plus proposée mais reste lisible par la gestion", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1 });
      const pupil = newActor(t);
      world.guardianship.studentOfUser.set(pupil.userId, s.students[0]!.studentId);
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const v1 = (await adminRows<any>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0].id;
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: v1 }));
      unwrap(await publishReportCard(world.deps, s.admin.ctx, { reportCardId: v1 }));
      expect(await code(await download(pupil, v1, { manage: false, family: { self: true } }))).toBe("ok");

      // Réouverture puis reclôture : résultats v2, réémission.
      world.results.setState({ ...world.results.states.get(`${s.classroomId}:${s.periodId}`)!, resultsVersion: 2, closureHash: "e".repeat(64) });
      world.results.setBundle(s.students[0]!.enrollmentId, s.periodId, makeSampleBundle({ studentId: s.students[0]!.studentId, enrollmentId: s.students[0]!.enrollmentId, classroomId: s.classroomId, periodId: s.periodId, yearId: s.yearId, stateId: s.stateId, ruleVersionId: s.ruleVersionId, pack: "SECONDARY", resultsVersion: 2, closureHash: "e".repeat(64), lastName: "ELEVE1", firstNames: "Prénom1" }));
      const v2 = unwrap(await reissueReportCard(world.deps, s.admin.ctx, { reportCardId: v1, reason: "Correction après reclôture" }));
      // Ancienne version : plus proposée à la famille, toujours disponible pour la gestion.
      expect(await code(await download(pupil, v1, { manage: false, family: { self: true } }))).toBe("reportcards.not_published");
      expect(unwrap(await listForFamily(world.deps, pupil.ctx, { caps: { self: true }, limit: 10 })).items).toHaveLength(0);
      expect(await code(await download(s.admin, v1, MANAGE))).toBe("ok");
      // Nouvelle version : à rendre puis publier ; alors la famille voit uniquement elle.
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: v2.id }));
      unwrap(await publishReportCard(world.deps, s.admin.ctx, { reportCardId: v2.id }));
      const list = unwrap(await listForFamily(world.deps, pupil.ctx, { caps: { self: true }, limit: 10 }));
      expect(list.items.map((c) => [c.id, c.version])).toEqual([[v2.id, 2]]);
      // La gestion filtre sur « live » et voit l'historique complet sans filtre.
      expect(unwrap(await listReportCards(world.deps, s.admin.ctx, { classroomId: s.classroomId, live: true, limit: 10 })).items).toHaveLength(1);
      expect(unwrap(await listReportCards(world.deps, s.admin.ctx, { classroomId: s.classroomId, limit: 10 })).items).toHaveLength(2);
    });

    it("révocation : motif tracé, disparaît du portail familles, reste lisible par la gestion, audit sensible + événement", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1 });
      const pupil = newActor(t);
      world.guardianship.studentOfUser.set(pupil.userId, s.students[0]!.studentId);
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const id = (await adminRows<any>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0].id;
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: id }));
      unwrap(await publishReportCard(world.deps, s.admin.ctx, { reportCardId: id }));
      world.directory.names.set(s.admin.userId, "Directrice Fictive");
      const revoked = unwrap(await revokeReportCard(world.deps, s.admin.ctx, { reportCardId: id, reason: "Notes attribuées à un autre élève" }));
      expect(revoked).toMatchObject({ status: "REVOKED", revokeReason: "Notes attribuées à un autre élève", revokedBy: s.admin.userId });
      const row = (await adminRows<any>(db, "SELECT revoked_by_name, revoked_at FROM reportcards.report_cards WHERE id = $1", [id]))[0];
      expect(row.revoked_by_name).toBe("Directrice Fictive");
      expect(await code(await download(pupil, id, { manage: false, family: { self: true } }))).toBe("reportcards.not_published");
      expect(unwrap(await listForFamily(world.deps, pupil.ctx, { caps: { self: true }, limit: 10 })).items).toHaveLength(0);
      expect(await code(await download(s.admin, id, MANAGE))).toBe("ok");
      const again = await revokeReportCard(world.deps, s.admin.ctx, { reportCardId: id, reason: "Deuxième révocation" });
      expect(again.ok).toBe(false);
      const ev = await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'reportcards.report_card.revoked'", [t]);
      expect(ev[0].payload).toMatchObject({ v: 1, reportCardId: id, reason: "Notes attribuées à un autre élève" });
      expect(world.audit.entries.find((e) => e.entry.action === "reportcards.report_card.revoked" && e.entry.resourceId === id)?.entry).toMatchObject({ sensitive: true, reason: "Notes attribuées à un autre élève" });
      // Un bulletin révoqué ne peut plus être publié ni réémis.
      expect((await publishReportCard(world.deps, s.admin.ctx, { reportCardId: id })).ok).toBe(false);
    });

    it("bulletin provisoire : jamais publié, jamais visible aux familles", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1, closed: false });
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, provisional: true }));
      const id = (await adminRows<any>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0].id;
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: id }));
      const r = await publishReportCard(world.deps, s.admin.ctx, { reportCardId: id });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("reportcards.provisional");
      // Le rendu d'un provisoire ne s'indexe pas pour la comparaison de fichiers (non vérifiable).
      expect(await adminRows(db, "SELECT 1 FROM reportcards.file_hash_index WHERE tenant_id = $1", [t])).toHaveLength(0);
    });
  });

  describe("option « bloquer si impayé » (Q-13, AC6.2)", () => {
    it("message sans détail de la dette ; levée dès que la situation est régularisée ; la gestion n'est jamais bloquée", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1 });
      const pupil = newActor(t);
      const studentId = s.students[0]!.studentId;
      world.guardianship.studentOfUser.set(pupil.userId, studentId);
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const id = (await adminRows<any>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0].id;
      unwrap(await renderReportCard(world.deps, s.admin.ctx, { reportCardId: id }));
      unwrap(await publishReportCard(world.deps, s.admin.ctx, { reportCardId: id }));
      const family = { manage: false, family: { self: true } };
      expect(await code(await download(pupil, id, family))).toBe("ok"); // option désactivée par défaut
      unwrap(await updateReportcardsSettings(world.deps, s.admin.ctx, { blockIfUnpaid: true }));
      world.standing.indebted.add(studentId);
      const blocked = await download(pupil, id, family);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error.code).toBe("reportcards.contact_accounting");
        expect(blocked.error.message).toMatch(/économat/);
        expect(blocked.error.message).not.toMatch(/\d/); // aucun montant
        expect(JSON.stringify(blocked.error.details ?? {})).not.toMatch(/\d{3}/);
      }
      expect(await code(await download(s.admin, id, MANAGE))).toBe("ok");
      world.standing.indebted.delete(studentId);
      expect(await code(await download(pupil, id, family))).toBe("ok");
      // Sans le port finance branché, l'option échoue FERMÉ (jamais d'accès accordé par défaut).
      const noStanding = world.depsWith({ ports: { ...world.deps.ports, standing: null as never } });
      const closed = await getDownloadUrl(noStanding, pupil.ctx, { reportCardId: id, manage: false, family: { self: true } });
      expect(closed.ok).toBe(false);
      void ctxFor;
    });
  });
});
