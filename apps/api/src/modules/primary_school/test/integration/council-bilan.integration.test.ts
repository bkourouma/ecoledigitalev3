/**
 * Intégration (Postgres réel ; s'ignore sans TEST_DATABASE_URL) : conseil des maîtres (dossiers, présence, décisions, PV figé),
 * bilan annuel SCELLÉ (conditions, immuabilité, version n+1, lecture famille) et archive d'année gelée.
 * Le monde extérieur (academic, people, results, rules, reportcards) est en mémoire ; les adaptateurs réels sont éprouvés ailleurs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { freezeYearArchive, getYearArchive, prepareYearArchive } from "../../application/archives";
import { decideCouncilCase, getCouncil, listCouncils, prepareCouncil, putCouncilAttendance, requestCouncilMinutes, updateCouncilCase } from "../../application/council";
import { listFamilyAnnualReviews, onReviewDocumentRendered, prepareAnnualReviews, reissueAnnualReview, requestReviewDocument, sealAnnualReview } from "../../application/reviews";
import { checkHomeroomForActivation } from "../../application/activation";
import { updateSettings } from "../../application/settings";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, ctxOf, depsOf, IDS, type World } from "../support/world";

describeIntegration("primary_school : conseil des maîtres, bilan annuel scellé, archive (base réelle)", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let w: World;
  let deps: ReturnType<typeof depsOf>["deps"];
  let audit: ReturnType<typeof depsOf>["audit"];
  let deliberationId = "";
  let caseOf: Record<string, string> = {};
  const staffDirector = "0192f0a4-7b1e-7c3a-8d2e-0000000000d1";
  const staffSecretary = "0192f0a4-7b1e-7c3a-8d2e-0000000000d2";

  const admin = () => ctxOf(tenantA, IDS.admin);
  const teacherA = () => ctxOf(tenantA, IDS.teacherA);
  const teacherB = () => ctxOf(tenantA, IDS.teacherB);
  const DIRECTION = { allClasses: true, councilManage: true, validate: true };
  const e = (k: "s1" | "s2" | "s3") => w.students[k].enrollmentId;
  const P3 = () => w.periods[2] as string;

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("council-a");
    tenantB = await db.createTenant("council-b");
    w = buildWorld();
    ({ deps, audit } = depsOf(db.tenantDb, w.world));
    w.world.seedProposals(w.classA, P3(), { [e("s1")]: "PROMOTED", [e("s2")]: "COUNCIL_REVIEW", [e("s3")]: "REPEAT" });
    w.world.flags.set(e("s2"), ["BORDERLINE"]);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("préparation : une délibération, un dossier par élève avec les motifs des règles ; rejouer n'ajoute rien ; hors classe : 404", async () => {
    const o = unwrap(await prepareCouncil(deps, teacherA(), { classroomId: w.classA, periodId: P3() }, {}));
    deliberationId = o.deliberationId;
    expect(o.counts).toEqual({ total: 3, open: 3, decided: 0, deferred: 0 });
    expect(o.ruleSourceKind).toBe("placeholder");
    caseOf = Object.fromEntries(o.cases.map((c) => [c.enrollmentId, c.id]));
    expect(o.cases.find((c) => c.enrollmentId === e("s2"))).toMatchObject({ reasonCodes: ["BORDERLINE"], ruleProposalCode: "COUNCIL_REVIEW", studentName: "Yao Kouadio" });
    expect(o.cases.find((c) => c.enrollmentId === e("s1"))?.reasonCodes).toEqual([]);
    // la feuille de présence initiale convoque les maîtres affectés, présence à constater
    expect(o.attendance).toHaveLength(1);
    expect(o.attendance[0]).toMatchObject({ convened: true, present: null, roleCode: "HOMEROOM" });
    // aucun quorum bloquant tant qu'aucune règle n'est liée : présence comptée et affichée
    expect(o.quorum).toEqual({ convened: 1, present: 0, met: null, source: "none" });

    const again = unwrap(await prepareCouncil(deps, teacherA(), { classroomId: w.classA, periodId: P3() }, {}));
    expect(again.deliberationId).toBe(deliberationId);
    expect(again.cases).toHaveLength(3);
    const created = await db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'primary_school.council.prepared' AND tenant_id = $1`, [tenantA]);
    expect(created.rows[0].n).toBe(1);

    const denied = await prepareCouncil(deps, teacherB(), { classroomId: w.classA, periodId: P3() }, {});
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.httpStatus).toBe(404);
    expect(unwrap(await listCouncils(deps, teacherA(), {}, {}))).toHaveLength(1);
    expect(unwrap(await listCouncils(deps, teacherB(), {}, {}))).toHaveLength(0);
    expect(unwrap(await listCouncils(deps, admin(), { classroomId: w.classA }, DIRECTION))).toHaveLength(1);
  });

  it("dossier : l'instituteur ajoute sa proposition et ses notes ; un dossier décidé ne change plus", async () => {
    const c = unwrap(await updateCouncilCase(deps, teacherA(), caseOf[e("s2")] as string, { proposalCode: "REPEATED", proposalNote: "Absences répétées.", discussionNote: "À revoir en séance." }, {}));
    expect(c).toMatchObject({ proposalCode: "REPEATED", status: "OPEN" });
    const deferred = unwrap(await updateCouncilCase(deps, teacherA(), caseOf[e("s2")] as string, { status: "DEFERRED" }, {}));
    expect(deferred.status).toBe("DEFERRED");
    unwrap(await updateCouncilCase(deps, teacherA(), caseOf[e("s2")] as string, { status: "OPEN" }, {}));
    // les notes ne sont pas dans l'audit
    expect(JSON.stringify(audit.entries.filter((a) => a.action === "primary_school.council_case.updated"))).not.toContain("Absences répétées");
    const denied = await updateCouncilCase(deps, teacherB(), caseOf[e("s2")] as string, { proposalCode: "PROMOTED" }, {});
    expect(denied.ok).toBe(false);
  });

  it("présence : président et secrétaire, signature exige la présence, présence signée figée ; réservé à la présidence", async () => {
    const staffA = w.staffA;
    const participants = [
      { staffId: staffA, roleCode: "HOMEROOM" as const, convened: true, present: true },
      { staffId: staffDirector, roleCode: "CHAIR" as const, convened: true, present: true },
      { staffId: staffSecretary, roleCode: "SECRETARY" as const, convened: true, present: false },
    ];
    expect((await putCouncilAttendance(deps, teacherA(), deliberationId, { participants }, {})).ok).toBe(false); // sans councilManage
    const absentSigner = await putCouncilAttendance(deps, admin(), deliberationId, { participants, signedStaffIds: [staffSecretary] }, DIRECTION);
    expect(absentSigner.ok).toBe(false);
    if (!absentSigner.ok) expect(absentSigner.error.kind).toBe("validation");
    const o = unwrap(await putCouncilAttendance(deps, admin(), deliberationId, { participants, signedStaffIds: [staffA] }, DIRECTION));
    expect(o.quorum).toMatchObject({ convened: 3, present: 2 });
    expect(o.attendance.find((a) => a.staffId === staffA)?.signedAt).not.toBeNull();
    // une présence signée est figée : on ne la retourne pas à « absent »
    const frozen = await putCouncilAttendance(deps, admin(), deliberationId, { participants: participants.map((p) => (p.staffId === staffA ? { ...p, present: false } : p)) }, DIRECTION);
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error.code).toBe("primary_school.attendance_signed");
    // le quorum vient d'une RÈGLE : 3 convoqués, 2 présents
    w.world.quorumRule = (convened, present) => present * 100 >= 50 * convened;
    expect(unwrap(await getCouncil(deps, admin(), deliberationId, DIRECTION)).quorum).toEqual({ convened: 3, present: 2, met: true, source: "rule" });
    w.world.quorumRule = (convened, present) => present * 100 >= 80 * convened;
    expect(unwrap(await getCouncil(deps, admin(), deliberationId, DIRECTION)).quorum.met).toBe(false);
    w.world.quorumRule = null;
  });

  it("décision : confirmer la proposition de la règle ; un écart exige une justification ; l'issue de fin d'année est enregistrée", async () => {
    // droit de présider requis
    expect((await decideCouncilCase(deps, teacherA(), caseOf[e("s1")] as string, {}, {})).ok).toBe(false);
    const d1 = unwrap(await decideCouncilCase(deps, admin(), caseOf[e("s1")] as string, {}, DIRECTION));
    expect(d1).toMatchObject({ finalCode: "PROMOTED", changedFromProposal: false, outcomeRecorded: "PROMOTED", case: { status: "DECIDED" } });
    expect(w.world.outcomes).toContainEqual({ enrollmentId: e("s1"), outcomeCode: "PROMOTED" });

    // écart sans justification : refusé ; justification trop courte : refusé
    const noWhy = await decideCouncilCase(deps, admin(), caseOf[e("s2")] as string, { finalCode: "REPEAT" }, DIRECTION);
    expect(noWhy.ok).toBe(false);
    const shortWhy = await decideCouncilCase(deps, admin(), caseOf[e("s2")] as string, { finalCode: "REPEAT", justification: "trop court" }, DIRECTION);
    expect(shortWhy.ok).toBe(false);
    const d2 = unwrap(await decideCouncilCase(deps, admin(), caseOf[e("s2")] as string, { finalCode: "REPEAT", justification: "Trois mois d'absence non justifiée cette année." }, DIRECTION));
    expect(d2).toMatchObject({ finalCode: "REPEAT", ruleProposalCode: "COUNCIL_REVIEW", changedFromProposal: true, outcomeRecorded: "REPEATED" });
    expect(audit.entries.find((a) => a.action === "primary_school.council_case.decided" && a.resourceId === caseOf[e("s2")])).toMatchObject({ sensitive: true, reason: "Trois mois d'absence non justifiée cette année." });

    const twice = await decideCouncilCase(deps, admin(), caseOf[e("s1")] as string, {}, DIRECTION);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe("primary_school.case_already_decided");
    unwrap(await decideCouncilCase(deps, admin(), caseOf[e("s3")] as string, {}, DIRECTION));
    const o = unwrap(await getCouncil(deps, admin(), deliberationId, DIRECTION));
    expect(o.counts).toEqual({ total: 3, open: 0, decided: 3, deferred: 0 });
    expect(o.cases.find((c) => c.enrollmentId === e("s2"))).toMatchObject({ finalCode: "REPEAT", justification: "Trois mois d'absence non justifiée cette année." });
  });

  it("procès-verbal : contenu FIGÉ (date réelle, participants, décisions), idempotent, échec fermé si la nature de document n'est pas livrée", async () => {
    const noDate = await requestCouncilMinutes(deps, admin(), deliberationId, {}, DIRECTION);
    expect(noDate.ok).toBe(false);
    if (!noDate.ok) expect(noDate.error.code).toBe("primary_school.minutes_not_ready");
    const first = unwrap(await requestCouncilMinutes(deps, admin(), deliberationId, { heldOn: "2026-10-02" }, DIRECTION));
    expect(first).toMatchObject({ version: 1, alreadyRequested: false });
    expect(w.world.requestedMinutes).toHaveLength(1);
    const req = w.world.requestedMinutes[0]!;
    expect(req.ruleSourceKind).toBe("placeholder");
    expect(req.content).toMatchObject({ heldOn: "2026-10-02", schema: 1 });
    expect((req.content as { decisions: unknown[] }).decisions).toHaveLength(3);
    expect((req.content as { participants: Array<{ signed: boolean }> }).participants.some((p) => p.signed)).toBe(true);
    const replay = unwrap(await requestCouncilMinutes(deps, admin(), deliberationId, { heldOn: "2026-10-02" }, DIRECTION));
    expect(replay).toMatchObject({ alreadyRequested: true, version: 1, documentId: first.documentId });
    expect(w.world.requestedMinutes).toHaveLength(1);

    // un autre contenu (autre date de séance) = version 2 ; nature non livrée : tout est annulé
    w.world.documentsAvailable = false;
    const failed = await requestCouncilMinutes(deps, admin(), deliberationId, { heldOn: "2026-10-03" }, DIRECTION);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("primary_school.port_unavailable");
    const versions = await db.admin.query(`SELECT count(*)::int AS n FROM primary_school.council_minutes WHERE tenant_id = $1`, [tenantA]);
    expect(versions.rows[0].n).toBe(1);
    w.world.documentsAvailable = true;
    // le procès-verbal ne se modifie pas (déclencheur) : seul le document émis se renseigne, une fois
    await expect(db.admin.query(`UPDATE primary_school.council_minutes SET content = '{}'::jsonb WHERE tenant_id = $1`, [tenantA])).rejects.toThrow(/append_only/);
  });

  it("bilan annuel : brouillons rassemblant résultats, décision, compteurs et assiduité ; scellement conditionné", async () => {
    w.world.attendanceSummaries.set(`${e("s1")}:${w.yearId}`, { openDays: 150, absentDays: 3, justifiedAbsentDays: 2, lateCount: 1 });
    const first = unwrap(await prepareAnnualReviews(deps, teacherA(), { classroomId: w.classA, academicYearId: w.yearId }, {}));
    expect(first).toMatchObject({ created: 3, refreshed: 0 });
    const r1 = first.reviews.find((r) => r.enrollmentId === e("s1"))!;
    expect(r1).toMatchObject({ status: "DRAFT", version: 1, outcomeCode: "PROMOTED", yearResultRef: null, studentName: "Awa Koné", ruleSourceKind: "placeholder" });
    expect(r1.attendanceSummary).toMatchObject({ openDays: 150, absentDays: 3 });

    // année non clôturée : refus (liste des manques)
    const open = await sealAnnualReview(deps, admin(), r1.id, DIRECTION);
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.error.code).toBe("primary_school.review_periods_open");
    w.world.yearClosedForClass.add(`${w.classA}:${w.yearId}`);
    // pas de résultat d'année FINAL
    const noResults = await sealAnnualReview(deps, admin(), r1.id, DIRECTION);
    expect(noResults.ok).toBe(false);
    if (!noResults.ok) expect(noResults.error.code).toBe("primary_school.review_needs_results");

    w.world.seedYearResult(e("s1"), w.yearId);
    w.world.seedYearResult(e("s2"), w.yearId, { yearDecisionCode: "COUNCIL_REVIEW" });
    // s3 : résultat incomplet -> jamais scellable
    w.world.seedYearResult(e("s3"), w.yearId, { complete: false, yearResultRef: null });
    const second = unwrap(await prepareAnnualReviews(deps, teacherA(), { classroomId: w.classA, academicYearId: w.yearId }, {}));
    expect(second).toMatchObject({ created: 0, refreshed: 3 });
    expect(second.reviews.find((r) => r.enrollmentId === e("s1"))).toMatchObject({ status: "READY" });
    expect(second.reviews.find((r) => r.enrollmentId === e("s3"))).toMatchObject({ status: "DRAFT" });
    const s3 = await sealAnnualReview(deps, admin(), second.reviews.find((r) => r.enrollmentId === e("s3"))!.id, DIRECTION);
    expect(s3.ok).toBe(false);

    // scellement
    const sealed = unwrap(await sealAnnualReview(deps, admin(), r1.id, DIRECTION));
    expect(sealed).toMatchObject({ status: "SEALED", version: 1, outcomeCode: "PROMOTED" });
    expect(sealed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const ev = await db.admin.query(`SELECT payload FROM kernel.domain_events WHERE type = 'primary_school.annual_review.sealed' AND tenant_id = $1`, [tenantA]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].payload).toMatchObject({ v: 1, reviewId: r1.id, contentHash: sealed.contentHash });
    expect(Object.keys(ev.rows[0].payload).sort()).toEqual(["academicYearId", "classroomId", "contentHash", "enrollmentId", "reviewId", "v", "version"]);
    expect(audit.entries.find((a) => a.action === "primary_school.annual_review.sealed")).toMatchObject({ sensitive: true, resourceId: r1.id });

    // immuabilité : application ET déclencheurs
    const again = await sealAnnualReview(deps, admin(), r1.id, DIRECTION);
    expect(again.ok).toBe(false);
    await expect(db.admin.query(`UPDATE primary_school.annual_reviews SET outcome_code = 'REPEATED' WHERE id = $1`, [r1.id])).rejects.toThrow(/review_sealed/);
    await expect(db.admin.query(`UPDATE primary_school.annual_reviews SET competency_summary = '{}'::jsonb WHERE id = $1`, [r1.id])).rejects.toThrow(/review_sealed/);
    await expect(db.admin.query(`DELETE FROM primary_school.annual_reviews WHERE id = $1`, [r1.id])).rejects.toThrow(/review_delete_forbidden/);
    // un bilan scellé n'est pas retouché par une nouvelle préparation
    const third = unwrap(await prepareAnnualReviews(deps, teacherA(), { classroomId: w.classA, academicYearId: w.yearId }, {}));
    expect(third.skippedSealed).toBe(1);
    expect(third.reviews.find((r) => r.id === r1.id)?.contentHash).toBe(sealed.contentHash);
  });

  it("bilan : PDF demandé depuis l'instantané figé ; l'identifiant émis se renseigne UNE fois ; les familles ne voient que les bilans scellés ET émis", async () => {
    const live = (await db.admin.query(`SELECT id FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2`, [tenantA, e("s1")])).rows[0].id as string;
    expect(unwrap(await listFamilyAnnualReviews(deps, ctxOf(tenantA, IDS.parent1), w.students.s1.studentId))).toEqual([]); // scellé mais pas encore émis
    const req = unwrap(await requestReviewDocument(deps, admin(), live));
    expect(req.requested).toBe(true);
    expect(w.world.requestedReviews[0]).toMatchObject({ reviewId: live, ruleSourceKind: "placeholder" });
    expect(w.world.requestedReviews[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const doc = "0192f0a4-7b1e-7c3a-8d2e-0000000009d1";
    expect(unwrap(await onReviewDocumentRendered(deps, admin(), { reviewId: live, documentId: doc }))).toEqual({ updated: true });
    expect(unwrap(await onReviewDocumentRendered(deps, admin(), { reviewId: live, documentId: "0192f0a4-7b1e-7c3a-8d2e-0000000009d2" }))).toEqual({ updated: false });
    const visible = unwrap(await listFamilyAnnualReviews(deps, ctxOf(tenantA, IDS.parent1), w.students.s1.studentId));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ enrollmentId: e("s1"), reportcardId: doc, status: "SEALED" });
    // l'élève lui-même (compte lié) voit son propre bilan ; « moi » sans fiche élève : introuvable
    const studentUser = "0192f0a4-7b1e-7c3a-8d2e-0000000000b9";
    w.world.studentByUser.set(studentUser, w.students.s1.studentId);
    expect(unwrap(await listFamilyAnnualReviews(deps, ctxOf(tenantA, studentUser), null))).toHaveLength(1);
    const noProfile = await listFamilyAnnualReviews(deps, ctxOf(tenantA, IDS.parent1), null);
    expect(noProfile.ok).toBe(false);
    // le parent d'un autre élève ne voit rien de cet enfant ; un compte sans lien : introuvable
    expect(unwrap(await listFamilyAnnualReviews(deps, ctxOf(tenantA, IDS.parent2), w.students.s3.studentId))).toEqual([]);
    const intruder = await listFamilyAnnualReviews(deps, ctxOf(tenantA, IDS.parent2), w.students.s1.studentId);
    expect(intruder.ok).toBe(false);
    if (!intruder.ok) expect(intruder.error.httpStatus).toBe(404);
    // nature non livrée : échec fermé (le scellement, lui, n'en dépend pas)
    w.world.documentsAvailable = false;
    const other = (await db.admin.query(`SELECT id FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2`, [tenantA, e("s2")])).rows[0].id as string;
    await db.admin.query(`UPDATE primary_school.annual_reviews SET status = 'SEALED', content_hash = repeat('b', 64), sealed_at = now(), sealed_by = $2, year_result_ref = gen_random_uuid(), decision_ref = gen_random_uuid(), outcome_code = 'REPEATED' WHERE id = $1`, [other, IDS.admin]);
    const closed = await requestReviewDocument(deps, admin(), other);
    expect(closed.ok).toBe(false);
    w.world.documentsAvailable = true;
  });

  it("réémission : version n+1 avec motif, l'ancienne passe SUPERSEDED, une seule version vivante", async () => {
    const live = (await db.admin.query(`SELECT id FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2 AND status = 'SEALED' AND content_hash IS NOT NULL ORDER BY version LIMIT 1`, [tenantA, e("s1")])).rows[0].id as string;
    const noReason = await reissueAnnualReview(deps, admin(), live, { reason: "court" }, DIRECTION);
    expect(noReason.ok).toBe(false);
    const v2 = unwrap(await reissueAnnualReview(deps, admin(), live, { reason: "Correction de l'assiduité après justificatif." }, DIRECTION));
    expect(v2).toMatchObject({ version: 2, status: "DRAFT", supersedesId: live, supersedeReason: "Correction de l'assiduité après justificatif." });
    const old = (await db.admin.query(`SELECT status FROM primary_school.annual_reviews WHERE id = $1`, [live])).rows[0];
    expect(old.status).toBe("SUPERSEDED");
    const lives = await db.admin.query(`SELECT count(*)::int AS n FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2 AND status <> 'SUPERSEDED'`, [tenantA, e("s1")]);
    expect(lives.rows[0].n).toBe(1);
    const resealed = unwrap(await sealAnnualReview(deps, admin(), v2.id, DIRECTION));
    expect(resealed).toMatchObject({ status: "SEALED", version: 2 });
    const oldHash = (await db.admin.query(`SELECT content_hash FROM primary_school.annual_reviews WHERE id = $1`, [live])).rows[0].content_hash;
    expect(resealed.contentHash).not.toBe(oldHash);
    // un brouillon ne se réémet pas
    const notSealed = await reissueAnnualReview(deps, admin(), (await db.admin.query(`SELECT id FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2`, [tenantA, e("s3")])).rows[0].id, { reason: "Motif suffisamment long." }, DIRECTION);
    expect(notSealed.ok).toBe(false);
    expect(audit.entries.filter((a) => a.action === "primary_school.annual_review.reissued")).toHaveLength(1);
  });

  it("archive d'année : manifeste et empreinte, READY seulement si tout est scellé, gel IRRÉVERSIBLE (plus aucun bilan ne s'écrit)", async () => {
    const notClosed = unwrap(await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(notClosed.status).toBe("PREPARING");
    expect(notClosed.blockers.map((b) => b.code)).toContain("primary_school.archive_year_not_closed");
    expect(notClosed.manifestHash).toBeNull();

    w.world.years.set(w.yearId, { id: w.yearId, institutionId: w.world.institutionId, label: "2026-2027", status: "CLOSED", closed: true });
    const unsealed = unwrap(await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(unsealed.status).toBe("PREPARING");
    expect(unsealed.blockers.some((b) => /non scellé/.test(b.message))).toBe(true);
    const frozenEarly = await freezeYearArchive(deps, admin(), unsealed.id);
    expect(frozenEarly.ok).toBe(false);
    if (!frozenEarly.ok) expect(frozenEarly.error.code).toBe("primary_school.archive_not_ready");

    // on scelle les bilans restants : s2 (déjà posé en SEALED par la préparation précédente) et s3 (résultat d'année complété)
    w.world.seedYearResult(e("s3"), w.yearId);
    unwrap(await prepareAnnualReviews(deps, admin(), { classroomId: w.classA, academicYearId: w.yearId }, DIRECTION));
    const s3 = (await db.admin.query(`SELECT id, status FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2`, [tenantA, e("s3")])).rows[0];
    if (s3.status !== "SEALED") unwrap(await sealAnnualReview(deps, admin(), s3.id, DIRECTION));

    // la classe B (CM2) a aussi un élève : sans bilan, l'archive de l'établissement n'est pas prête
    const missing = unwrap(await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(missing.status).toBe("PREPARING");
    expect(missing.blockers.some((b) => /sans bilan/.test(b.message))).toBe(true);
    // classe B : bilan préparé puis scellé
    w.world.yearClosedForClass.add(`${w.classB}:${w.yearId}`);
    w.world.seedYearResult(w.students.b1.enrollmentId, w.yearId);
    w.world.confirmedYearDecisions.set(`${w.students.b1.enrollmentId}:${w.yearId}`, { decisionId: "0192f0a4-7b1e-7c3a-8d2e-0000000008d1", finalCode: "PROMOTED" });
    const b = unwrap(await prepareAnnualReviews(deps, ctxOf(tenantA, IDS.teacherB), { classroomId: w.classB, academicYearId: w.yearId }, {}));
    unwrap(await sealAnnualReview(deps, admin(), b.reviews[0]!.id, DIRECTION));

    // tous scellés mais PDF non émis : le PDF ne se renseignera plus après le gel, l'archive n'est donc pas prête
    const noPdf = unwrap(await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(noPdf.status).toBe("PREPARING");
    expect(noPdf.blockers.some((x) => /sans PDF/.test(x.message))).toBe(true);
    await db.admin.query(`UPDATE primary_school.annual_reviews SET reportcard_id = gen_random_uuid() WHERE tenant_id = $1 AND status = 'SEALED' AND reportcard_id IS NULL`, [tenantA]);

    const ready = unwrap(await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(ready).toMatchObject({ status: "READY", reviewsTotal: 4, reviewsSealed: 4, blockers: [] });
    expect(ready.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    const manifest = ready.manifest as { reviews: unknown[]; classrooms: unknown[] };
    expect(manifest.reviews).toHaveLength(4);
    expect(manifest.classrooms).toHaveLength(2);
    // même état = même empreinte (manifeste déterministe)
    const again = unwrap(await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(again.manifestHash).toBe(ready.manifestHash);

    const frozen = unwrap(await freezeYearArchive(deps, admin(), ready.id));
    expect(frozen.status).toBe("FROZEN");
    expect(frozen.frozenAt).not.toBeNull();
    expect(audit.entries.find((a) => a.action === "primary_school.year_archive.frozen")).toMatchObject({ sensitive: true });
    // irréversible : ni nouveau gel, ni nouvelle préparation, ni écriture SQL, ni suppression
    const twice = await freezeYearArchive(deps, admin(), ready.id);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe("primary_school.archive_frozen");
    const reprep = await prepareYearArchive(deps, admin(), { academicYearId: w.yearId, institutionId: w.world.institutionId });
    expect(reprep.ok).toBe(false);
    await expect(db.admin.query(`UPDATE primary_school.year_archives SET manifest = '{}'::jsonb WHERE id = $1`, [ready.id])).rejects.toThrow(/archive_frozen/);
    await expect(db.admin.query(`DELETE FROM primary_school.year_archives WHERE id = $1`, [ready.id])).rejects.toThrow(/append_only/);
    // plus aucun bilan de cet établissement et de cette année ne s'écrit : la réémission est refusée (409)
    const liveS1 = (await db.admin.query(`SELECT id FROM primary_school.annual_reviews WHERE tenant_id = $1 AND enrollment_id = $2 AND status = 'SEALED'`, [tenantA, e("s1")])).rows[0].id as string;
    const reissue = await reissueAnnualReview(deps, admin(), liveS1, { reason: "Tentative après archivage de l'année." }, DIRECTION);
    expect(reissue.ok).toBe(false);
    if (!reissue.ok) expect(reissue.error.code).toBe("primary_school.year_frozen");
    // les données archivées restent lisibles
    expect(unwrap(await getYearArchive(deps, admin(), ready.id)).status).toBe("FROZEN");
    expect(unwrap(await listFamilyAnnualReviews(deps, ctxOf(tenantA, IDS.parent1), w.students.s1.studentId))).toHaveLength(1);
  });

  it("garde d'activation : classe du primaire sans titulaire refusée ; règle désactivée = dérogation auditée ; autre cycle sans objet", async () => {
    const noHomeroom = w.world.addClassroom({ yearId: w.yearId, gradeLevelCode: "CP1", name: "CP1 B" });
    const refused = await checkHomeroomForActivation(deps, admin(), { classroomId: noHomeroom });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("primary_school.homeroom_required");
    expect(unwrap(await checkHomeroomForActivation(deps, admin(), { classroomId: w.classA }))).toMatchObject({ applies: true, hasHomeroom: true, overridden: false });
    unwrap(await updateSettings(deps, admin(), { institutionId: w.world.institutionId, requireHomeroomForActivation: false }));
    expect(unwrap(await checkHomeroomForActivation(deps, admin(), { classroomId: noHomeroom }))).toMatchObject({ overridden: true });
    expect(audit.entries.some((a) => a.action === "primary_school.activation.homeroom_waived" && a.sensitive)).toBe(true);
    expect(audit.entries.find((a) => a.action === "primary_school.settings.updated")).toMatchObject({ sensitive: true });
    const secondary = w.world.addClassroom({ yearId: w.yearId, gradeLevelCode: "6E", educationLevelCode: "SECONDARY", name: "6e A" });
    expect(unwrap(await checkHomeroomForActivation(deps, admin(), { classroomId: secondary }))).toMatchObject({ applies: false });
  });

  it("isolation tenant : le tenant B ne voit ni dossiers, ni présence, ni bilans, ni archives, ni procès-verbaux", async () => {
    const counts = await db.tenantDb.run(
      ctxOf(tenantB, IDS.admin),
      (tx) =>
        tx.queryOne(`SELECT (SELECT count(*) FROM primary_school.council_cases)::int AS cases, (SELECT count(*) FROM primary_school.council_attendance)::int AS attendance,
                            (SELECT count(*) FROM primary_school.annual_reviews)::int AS reviews, (SELECT count(*) FROM primary_school.year_archives)::int AS archives,
                            (SELECT count(*) FROM primary_school.council_minutes)::int AS minutes, (SELECT count(*) FROM primary_school.settings)::int AS settings`),
      { readOnly: true },
    );
    expect(counts).toEqual({ cases: 0, attendance: 0, reviews: 0, archives: 0, minutes: 0, settings: 0 });
    // écrire pour un autre tenant sous le rôle applicatif : refusé par la RLS
    await expect(
      db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) =>
        tx.query(`INSERT INTO primary_school.year_archives (id, tenant_id, institution_id, academic_year_id) VALUES (gen_random_uuid(), $1, gen_random_uuid(), gen_random_uuid())`, [tenantA]),
      ),
    ).rejects.toThrow(/row-level security|sécurité/i);
  });
});
