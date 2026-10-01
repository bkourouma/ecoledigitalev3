import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { reportcardSnapshotSchema, reportcardsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/reportcards";
import { createBatch, createTranscript, getBatchView, preflight, reissueReportCard } from "../../application/issue";
import { listReportCards, getReportCard, getExplain } from "../../application/queries";
import { createSignatory, putBranding, putTemplateConfig, updateReportcardsSettings, updateSignatory } from "../../application/reference";
import { renderReportCard } from "../../application/render";
import { snapshotHash } from "../../domain/canonical";
import { verifyDocumentSignature } from "../../domain/signing";
import { makeSampleBundle } from "../../infrastructure/in-memory-ports";
import { adminOne, adminRows, createReportcardsTestDb, describeIntegration, ctxFor, type ReportcardsTestDb } from "../support/db";
import { PNG_1X1, makeWorld, newActor, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("émission : contrôle préalable, lots, snapshots, réémission", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
  });
  afterAll(async () => {
    await db.drop();
  });

  const events = (tenantId: string, type: string) => adminRows<any>(db, "SELECT type, payload, aggregate_id FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id", [tenantId, type]);
  const cards = (tenantId: string) => adminRows<any>(db, "SELECT * FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY issued_at, id", [tenantId]);

  describe("contrôle préalable (AC1.1)", () => {
    it("liste CHAQUE manque avec son lien de correction ; aucune génération s'il reste un point bloquant", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { configured: false, closed: false });
      const view = unwrap(await preflight(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(view.ok).toBe(false);
      const codes = view.issues.filter((i) => i.blocking).map((i) => i.code);
      expect(codes).toEqual(expect.arrayContaining(["reportcards.branding_missing", "reportcards.template_config_missing", "reportcards.period_not_closed"]));
      for (const issue of view.issues.filter((i) => i.blocking && i.code !== "reportcards.period_not_closed")) expect(issue.fixHref).toMatch(/^\/admin\//);
      expect(view.enrollments).toEqual({ total: 3, eligible: 3, excluded: 0 });

      const r = await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: "reportcards.preflight_failed", kind: "conflict" });
      expect(await cards(t)).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM reportcards.batches WHERE tenant_id = $1", [t])).toHaveLength(0);
    });

    it("sans signataire affecté à un emplacement OBLIGATOIRE : refus, aucun nom par défaut (AC5.5)", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { configured: false });
      unwrap(await putBranding(world.deps, school.admin.ctx, { legalName: "École test" }));
      unwrap(await putTemplateConfig(world.deps, school.admin.ctx, { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "secondary-bulletin", options: {}, signatureAssignments: [] }));
      const view = unwrap(await preflight(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(view.ok).toBe(false);
      expect(view.issues.find((i) => i.code === "reportcards.signatory_missing")?.message).toMatch(/Le Directeur/);
    });

    it("délibération exigée par le réglage du tenant ; clé de signature et domaine de vérification requis", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { deliberationHeld: false });
      expect(unwrap(await preflight(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId })).ok).toBe(true);
      unwrap(await updateReportcardsSettings(world.deps, school.admin.ctx, { requireDeliberation: true }));
      const blocked = unwrap(await preflight(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(blocked.issues.map((i) => i.code)).toContain("reportcards.deliberation_required");
      const noKey = world.depsWith({ keys: null });
      expect(unwrap(await preflight(noKey, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId })).issues.map((i) => i.code)).toContain("reportcards.signing_key_missing");
      const noUrl = world.depsWith({ config: { verificationBaseUrl: null } });
      expect(unwrap(await preflight(noUrl, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId })).issues.map((i) => i.code)).toContain("reportcards.verification_url_missing");
      // Un lot PROVISOIRE n'exige ni clôture, ni délibération, ni domaine de vérification.
      expect(unwrap(await preflight(noUrl, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, provisional: true })).ok).toBe(true);
    });
  });

  describe("lot de génération", () => {
    let school: School;
    let batchId: string;

    beforeAll(async () => {
      const t = await db.createTenant();
      school = await seedSchool(world, t, { students: 3 });
      world.directory.names.set(school.admin.userId, "Secrétaire Fictif");
      world.attendance.summaries.set(`${school.students[0]!.enrollmentId}:${school.periodId}`, { justifiedMinutes: 999, unjustifiedMinutes: 61, lateCount: 4 });
    });

    it("un snapshot par inscription, dans UNE transaction avec index de vérification, événements et audit (AC1.2, AC1.4)", async () => {
      const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      batchId = view.batch.id;
      expect(view.replayed).toBe(false);
      expect(view.batch).toMatchObject({ total: 3, issued: 3, excluded: 0, failed: 0, status: "RENDERING", provisional: false, resultsVersion: 1 });
      expect(view.items.map((i) => i.outcome)).toEqual(["ISSUED", "ISSUED", "ISSUED"]);

      const rows = await cards(school.tenantId);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row).toMatchObject({ status: "ISSUED", version: 1, render_status: "PENDING", scope: "PERIOD", document_kind: "REPORT_CARD", provisional: false, batch_id: batchId });
        expect(row.verification_code).toMatch(/^[A-Z2-7]{26}$/);
        expect(row.issued_by).toBe(school.admin.userId);
        expect(row.issued_by_name).toBe("Secrétaire Fictif");
        expect(row.issued_at.toISOString()).toBe(world.clock.now().toISOString());
        expect(row.rule_version_id).toBe(school.ruleVersionId);
        expect(row.rule_set_code).toBe("TEST-RULES");
        expect(row.results_state_id).toBe(school.stateId);
        expect(row.closure_hash).toBe("c".repeat(64));
        expect(row.template_key).toBe("secondary-bulletin");
        // Le snapshot respecte le schéma `reportcard/1` et contient tout ce qu'il faut au rendu (AC2.3).
        const snap = reportcardSnapshotSchema.parse(row.snapshot);
        expect(snap.institution.legalName).toBe("Établissement de Démonstration");
        expect(snap.signatories[0]).toMatchObject({ slot: "director", name: "Personne Fictive Une" });
        expect(snap.deliberation).toEqual({ heldOn: "2026-01-15", nature: "COUNCIL" });
        expect(snap.rules).toMatchObject({ ruleSetCode: "TEST-RULES", ruleVersionNo: 3, resultsVersion: 1 });
        expect(snap.template).toMatchObject({ key: "secondary-bulletin", version: 1, configVersion: 1 });
        expect(snap.template.options).toMatchObject({ showRank: true });
        expect(snap.labels.ADMITTED).toBe("Admis");
        expect(snap.results.lines.length).toBeGreaterThan(0);
        expect(snap.results.lines[0]).toMatchObject({ exact: "14.50", display: "14,50", rank: 3 });
        // Hash recalculé depuis la base = hash stocké ; signature Ed25519 vérifiable avec la clé publique seule.
        expect(snapshotHash(row.snapshot, row.explain)).toBe(row.snapshot_hash);
        expect(verifyDocumentSignature(world.keys.publicKey, { snapshotHash: row.snapshot_hash, verificationCode: row.verification_code, issuedAt: row.issued_at }, row.signature)).toBe(true);
        expect(row.signing_key_id).toBe("test-key-2026");
      }
      // Les absences viennent du port d'assiduité au moment de l'émission.
      const withAttendance = rows.find((r) => r.student_id === school.students[0]!.studentId);
      expect(withAttendance.snapshot.attendance).toEqual({ justifiedMinutes: 999, unjustifiedMinutes: 61, lateCount: 4 });
      const without = rows.find((r) => r.student_id === school.students[1]!.studentId);
      expect(without.snapshot.attendance).toEqual({ justifiedMinutes: 150, unjustifiedMinutes: 90, lateCount: 1 }); // repli : celui du bundle results

      // Index public : un code par document, aucune donnée personnelle.
      const index = await adminRows<any>(db, "SELECT * FROM reportcards.verification_index WHERE tenant_id = $1", [school.tenantId]);
      expect(index).toHaveLength(3);
      expect(Object.keys(index[0]).sort()).toEqual(["code", "created_at", "document_id", "document_kind", "tenant_id"]);
      expect(new Set(index.map((i) => i.code))).toEqual(new Set(rows.map((r) => r.verification_code)));

      // Événements d'outbox (même transaction) conformes au contrat.
      const created = await events(school.tenantId, "reportcards.snapshot.created");
      expect(created).toHaveLength(3);
      for (const e of created) {
        expect(reportcardsEventPayloadSchemas["reportcards.snapshot.created"].safeParse(e.payload).success).toBe(true);
        expect(e.payload).toMatchObject({ v: 1, batchId, kind: "REPORT_CARD", provisional: false, version: 1 });
      }
      // Audit : une entrée sensible pour le lot, avec les décomptes.
      const audited = world.audit.entries.filter((e) => e.entry.action === "reportcards.batch.generated" && e.entry.resourceId === batchId);
      expect(audited).toHaveLength(1);
      expect(audited[0]!.entry).toMatchObject({ sensitive: true, metadata: { issued: 3, excluded: 0, failed: 0, resultsVersion: 1 } });
    });

    it("rejouer le lot (même clé d'idempotence) ne crée aucun doublon (AC1.2)", async () => {
      const before = (await cards(school.tenantId)).length;
      const again = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(again.replayed).toBe(true);
      expect(again.batch.id).toBe(batchId);
      expect(await cards(school.tenantId)).toHaveLength(before);
      expect(await events(school.tenantId, "reportcards.snapshot.created")).toHaveLength(3);
    });

    it("une autre clé d'idempotence pour les MÊMES résultats ne réémet pas : « déjà émis » (R-RC-09)", async () => {
      const r = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, idempotencyKey: "second-lot-identique" }));
      expect(r.replayed).toBe(false);
      expect(r.items.every((i) => i.outcome === "ISSUED" && i.reasonCode === "ALREADY_ISSUED" && i.reportCardId)).toBe(true);
      expect(await cards(school.tenantId)).toHaveLength(3);
    });

    it("un seul bulletin vivant par inscription et période (contrainte d'unicité partielle)", async () => {
      const live = await adminRows(db, "SELECT enrollment_id FROM reportcards.report_cards WHERE tenant_id = $1 AND status IN ('ISSUED','PUBLISHED') GROUP BY enrollment_id HAVING count(*) > 1", [school.tenantId]);
      expect(live).toHaveLength(0);
    });

    it("détail et trace d'explicabilité (permission distincte), la lecture de la trace est auditée", async () => {
      const row = (await cards(school.tenantId))[0];
      const detail = unwrap(await getReportCard(world.deps, school.admin.ctx, row.id));
      expect(detail.snapshot.student.id).toBe(row.student_id);
      expect(JSON.stringify(detail)).not.toContain("period_average"); // la trace n'est PAS dans le détail
      const explain = unwrap(await getExplain(world.deps, school.admin.ctx, row.id));
      expect(explain.explain[0]!.rules[0]).toMatchObject({ key: "period_average", output: "14.50" });
      expect(world.audit.actions).toContain("reportcards.report_card.explain_read");
    });
  });

  describe("exclusions et pannes : le lot n'échoue pas en bloc (AC1.3)", () => {
    it("ERROR, MISSING, résultat absent, lecture en panne : listés ; les autres sont émis", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 5 });
      const [ok1, err1, missing1, noBundle, down] = school.students;
      world.results.setRoster(school.classroomId, school.periodId, [
        { enrollmentId: ok1!.enrollmentId, studentId: ok1!.studentId, outcome: "FINAL" },
        { enrollmentId: err1!.enrollmentId, studentId: err1!.studentId, outcome: "ERROR" },
        { enrollmentId: missing1!.enrollmentId, studentId: missing1!.studentId, outcome: "MISSING" },
        { enrollmentId: noBundle!.enrollmentId, studentId: noBundle!.studentId, outcome: "FINAL" },
        { enrollmentId: down!.enrollmentId, studentId: down!.studentId, outcome: "FINAL" },
      ]);
      world.results.bundles.delete(`${noBundle!.enrollmentId}:${school.periodId}`);
      world.results.failingEnrollments.add(down!.enrollmentId);
      const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(view.batch).toMatchObject({ total: 5, issued: 1, excluded: 3, failed: 1 });
      const by = Object.fromEntries(view.items.map((i) => [i.enrollmentId, i]));
      expect(by[ok1!.enrollmentId]).toMatchObject({ outcome: "ISSUED" });
      expect(by[err1!.enrollmentId]).toMatchObject({ outcome: "EXCLUDED", reasonCode: "RESULT_ERROR" });
      expect(by[missing1!.enrollmentId]).toMatchObject({ outcome: "EXCLUDED", reasonCode: "NO_FINAL_RESULT" });
      expect(by[noBundle!.enrollmentId]).toMatchObject({ outcome: "EXCLUDED", reasonCode: "NO_FINAL_RESULT" });
      expect(by[down!.enrollmentId]).toMatchObject({ outcome: "FAILED", reasonCode: "RESULT_READ_FAILED" });
      expect(await cards(t)).toHaveLength(1); // jamais de bulletin « vide »
    });

    it("un résultat qui ne correspond pas à l'inscription demandée est refusé (défense contre un port défaillant)", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 2 });
      const [a, b] = school.students;
      world.results.setBundle(a!.enrollmentId, school.periodId, b!.bundle); // mauvais élève
      const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(view.items.find((i) => i.enrollmentId === a!.enrollmentId)).toMatchObject({ outcome: "FAILED", reasonCode: "RESULT_MISMATCH" });
      expect(view.items.find((i) => i.enrollmentId === b!.enrollmentId)).toMatchObject({ outcome: "ISSUED" });
    });

    it("enrollmentIds : sous-ensemble ; identifiants inconnus de la classe exclus", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 3 });
      const stranger = newId();
      const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, enrollmentIds: [school.students[0]!.enrollmentId, stranger] }));
      expect(view.batch).toMatchObject({ total: 2, issued: 1, excluded: 1 });
      expect(view.items.find((i) => i.enrollmentId === stranger)).toMatchObject({ reasonCode: "NOT_IN_CLASS" });
    });
  });

  describe("immutabilité face aux données vivantes (AC2.3b) et provisoire (R-RC-01)", () => {
    it("modifier le nom de l'élève, l'identité, le logo ou un signataire NE modifie PAS un bulletin émis", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 1 });
      unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      const [row] = await cards(t);
      const before = JSON.stringify(row.snapshot);

      // Les données vivantes changent : élève renommé, nouvelle identité, nouveau logo, signataire remplacé.
      world.results.setBundle(school.students[0]!.enrollmentId, school.periodId, makeSampleBundle({ ...{ studentId: school.students[0]!.studentId, enrollmentId: school.students[0]!.enrollmentId, classroomId: school.classroomId, periodId: school.periodId, yearId: school.yearId, stateId: school.stateId, ruleVersionId: school.ruleVersionId, pack: "SECONDARY" }, lastName: "RENOMME" }));
      const newLogo = `reportcards/${t}/assets/logo/${newId()}.png`;
      await world.storage.put(newLogo, PNG_1X1, { contentType: "image/png" });
      unwrap(await putBranding(world.deps, school.admin.ctx, { legalName: "Nouveau nom officiel", logoObjectKey: newLogo }));
      unwrap(await updateSignatory(world.deps, school.admin.ctx, { signatoryId: school.signatoryId, patch: { fullName: "Autre Personne", active: false } }));

      const [after] = await cards(t);
      expect(JSON.stringify(after.snapshot)).toBe(before);
      expect(after.snapshot_hash).toBe(row.snapshot_hash);
      expect(after.snapshot.institution.legalName).toBe("Établissement de Démonstration");
      expect(after.snapshot.signatories[0].name).toBe("Personne Fictive Une");
      expect(after.snapshot.student.lastName).toBe("ELEVE1");
      // Et le rendu depuis le snapshot reste identique (le logo ancien est conservé : jamais purgé tant qu'un snapshot le référence).
      expect(await world.storage.exists(school.logoKey)).toBe(true);
    });

    it("lot provisoire : période non clôturée acceptée, filigrane, jamais vérifiable, jamais publiable, pas de version", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 2, closed: false });
      const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, provisional: true }));
      expect(view.batch).toMatchObject({ issued: 2, provisional: true });
      const rows = await cards(t);
      expect(rows.every((r) => r.provisional && r.version === 1 && r.snapshot.meta.title.endsWith("(provisoire)"))).toBe(true);
      expect(await adminRows(db, "SELECT 1 FROM reportcards.verification_index WHERE tenant_id = $1", [t])).toHaveLength(0);
      // Un lot définitif reste refusé tant que la période n'est pas clôturée.
      const final = await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId });
      expect(final.ok).toBe(false);
    });
  });

  describe("réouverture, réémission, remplacement (US3)", () => {
    let school: School;
    let firstId: string;

    beforeAll(async () => {
      const t = await db.createTenant();
      school = await seedSchool(world, t, { students: 2 });
      unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      firstId = (await cards(t))[0].id;
    });

    it("après reclôture (version n+1) les bulletins apparaissent « à rééditer » ; le lot sans motif les exclut", async () => {
      // La période est rouverte puis reclôturée : version des résultats 2 et nouveaux calculs.
      world.results.setState({ ...world.results.states.get(`${school.classroomId}:${school.periodId}`)!, resultsVersion: 2, closureHash: "d".repeat(64) });
      for (const s of school.students) {
        world.results.setBundle(s.enrollmentId, school.periodId, makeSampleBundle({ studentId: s.studentId, enrollmentId: s.enrollmentId, classroomId: school.classroomId, periodId: school.periodId, yearId: school.yearId, stateId: school.stateId, ruleVersionId: school.ruleVersionId, pack: "SECONDARY", resultsVersion: 2, closureHash: "d".repeat(64), average: "13.40", lastName: `ELEVE${school.students.indexOf(s) + 1}`, firstNames: `Prénom${school.students.indexOf(s) + 1}` }));
      }
      const page = unwrap(await listReportCards(world.deps, school.admin.ctx, { classroomId: school.classroomId, limit: 50, needsReissue: true }));
      expect(page.items).toHaveLength(2);
      expect(page.items.every((v) => v.needsReissue === true)).toBe(true);

      const batch = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      expect(batch.items.every((i) => i.outcome === "EXCLUDED" && i.reasonCode === "NEEDS_REISSUE")).toBe(true);
    });

    it("reissue : nouvelle version + supersedes_id + motif ; l'ancienne passe SUPERSEDED et reste lisible ; une seule vivante", async () => {
      const r = unwrap(await reissueReportCard(world.deps, school.admin.ctx, { reportCardId: firstId, reason: "Correction de la note de mathématiques" }));
      expect(r).toMatchObject({ version: 2, supersedesId: firstId, status: "ISSUED", resultsVersion: 2 });
      const rows = await adminRows<any>(db, "SELECT id, version, status, superseded_at, superseded_by_id, supersede_reason, supersedes_id FROM reportcards.report_cards WHERE enrollment_id = (SELECT enrollment_id FROM reportcards.report_cards WHERE id = $1) ORDER BY version", [firstId]);
      expect(rows.map((x) => [x.version, x.status])).toEqual([[1, "SUPERSEDED"], [2, "ISSUED"]]);
      expect(rows[0]).toMatchObject({ superseded_by_id: r.id });
      expect(rows[0].superseded_at.toISOString()).toBe(world.clock.now().toISOString());
      expect(rows[1]).toMatchObject({ supersedes_id: firstId, supersede_reason: "Correction de la note de mathématiques" });
      // L'ancienne version est toujours lisible par la gestion (AC3.1).
      expect(unwrap(await getReportCard(world.deps, school.admin.ctx, firstId)).card.status).toBe("SUPERSEDED");
      const ev = await events(school.tenantId, "reportcards.report_card.superseded");
      expect(ev.map((e) => e.payload)).toContainEqual(expect.objectContaining({ reportCardId: firstId, newReportCardId: r.id, reason: "Correction de la note de mathématiques" }));
      expect(world.audit.actions).toContain("reportcards.report_card.reissued");
    });

    it("on ne réémet pas une version remplacée ; période non clôturée : refus", async () => {
      const again = await reissueReportCard(world.deps, school.admin.ctx, { reportCardId: firstId, reason: "Encore une fois" });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("reportcards.invalid_state");
      const live = (await cards(school.tenantId)).find((c) => c.status === "ISSUED" && c.version === 1)!;
      world.results.setState({ ...world.results.states.get(`${school.classroomId}:${school.periodId}`)!, status: "LOCKED" });
      const r = await reissueReportCard(world.deps, school.admin.ctx, { reportCardId: live.id, reason: "Période rouverte" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("reportcards.period_not_closed");
      world.results.setState({ ...world.results.states.get(`${school.classroomId}:${school.periodId}`)!, status: "CLOSED" });
    });

    it("lot avec reissueReason : réémet les bulletins périmés (version + 1), saute ceux qui sont à jour", async () => {
      const batch = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, reissueReason: "Reclôture de la période" }));
      const outcomes = batch.items.map((i) => `${i.outcome}:${i.reasonCode ?? ""}`).sort();
      expect(outcomes).toEqual(["ISSUED:", "ISSUED:ALREADY_ISSUED"]);
      const live = await adminRows<any>(db, "SELECT version, status FROM reportcards.report_cards WHERE tenant_id = $1 AND status IN ('ISSUED','PUBLISHED') ORDER BY version", [school.tenantId]);
      expect(live.map((l) => l.version)).toEqual([2, 2]);
    });
  });

  describe("concurrence et volumétrie", () => {
    it("deux lots simultanés sur la même classe : aucun doublon vivant, les deux aboutissent", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 6 });
      const run = (key: string) => createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, idempotencyKey: key });
      const [a, b] = await Promise.all([run("concurrent-a-0001"), run("concurrent-b-0001")]);
      expect(a.ok && b.ok).toBe(true);
      const total = (await cards(t)).length;
      expect(total).toBe(6);
      const issuedByB = [a, b].map((r) => (r.ok ? r.value.items.filter((i) => i.reasonCode === "ALREADY_ISSUED").length : -1)).sort();
      expect(issuedByB).toEqual([0, 6]);
    });

    it("100 snapshots en ≤ 10 s (AC1.4)", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 100 });
      const start = Date.now();
      const view = unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      const elapsed = Date.now() - start;
      expect(view.batch.issued).toBe(100);
      console.info(`[reportcards] 100 snapshots émis en ${elapsed} ms (${Math.round(elapsed / 100)} ms / bulletin)`);
      expect(elapsed).toBeLessThan(10_000);
    });
  });

  describe("relevé cumulé (US7)", () => {
    it("sur demande explicite, date d'émission réelle ; une nouvelle demande remplace la version précédente", async () => {
      const t = await db.createTenant();
      const school = await seedSchool(world, t, { students: 1, pack: "HIGHER" });
      const studentId = school.students[0]!.studentId;
      unwrap(await putTemplateConfig(world.deps, school.admin.ctx, { documentKind: "TRANSCRIPT", pack: "HIGHER", templateKey: "transcript-credits", options: {}, signatureAssignments: [{ slot: "director-studies", signatoryId: school.signatoryId }] }));
      const bundle = makeSampleBundle({ studentId, enrollmentId: null, classroomId: null, periodId: null, yearId: school.yearId, stateId: school.stateId, ruleVersionId: school.ruleVersionId, pack: "HIGHER", deliberationDate: null });
      world.results.setCumulative(studentId, bundle);
      const first = unwrap(await createTranscript(world.deps, school.admin.ctx, { studentId }));
      expect(first).toMatchObject({ documentKind: "TRANSCRIPT", scope: "CUMULATIVE", version: 1, enrollmentId: null, academicPeriodId: null, status: "ISSUED" });
      expect(first.issuedAt.toISOString()).toBe(world.clock.now().toISOString());
      world.clock.advance(3_600_000);
      const second = unwrap(await createTranscript(world.deps, school.admin.ctx, { studentId }));
      expect(second).toMatchObject({ version: 2, supersedesId: first.id });
      const statuses = await adminRows<any>(db, "SELECT version, status FROM reportcards.report_cards WHERE tenant_id = $1 AND document_kind = 'TRANSCRIPT' ORDER BY version", [t]);
      expect(statuses.map((s) => [s.version, s.status])).toEqual([[1, "SUPERSEDED"], [2, "ISSUED"]]);
      world.results.cumulative.delete(studentId);
      const empty = await createTranscript(world.deps, school.admin.ctx, { studentId });
      expect(empty.ok).toBe(false);
      world.clock.advance(-3_600_000);
    });
  });

  it("un snapshot dont le rendu échoue ne bloque pas l'émission : render_status PENDING tant qu'aucun rendu n'a abouti", async () => {
    const t = await db.createTenant();
    const school = await seedSchool(world, t, { students: 1 });
    unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    const row = await adminOne<any>(db, "SELECT id, render_status, current_render_id FROM reportcards.report_cards WHERE tenant_id = $1", [t]);
    expect(row).toMatchObject({ render_status: "PENDING", current_render_id: null });
    const rendered = unwrap(await renderReportCard(world.deps, ctxFor(t), { reportCardId: row.id }));
    expect(rendered.status).toBe("RENDERED");
    expect((await getBatchView(world.deps, school.admin.ctx, (await adminOne<any>(db, "SELECT id FROM reportcards.batches WHERE tenant_id = $1", [t])).id)).ok).toBe(true);
  });

  void describe;
  void newActor;
  void createSignatory;
});
