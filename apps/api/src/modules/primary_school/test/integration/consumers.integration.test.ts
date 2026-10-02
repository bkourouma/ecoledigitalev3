/**
 * Intégration : réactions aux événements des autres modules (abonnés du worker), idempotence, tolérance aux charges illisibles,
 * et objectifs de performance de la spec (activation d'un établissement vide, synthèse de compétences).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { onAnnualReviewSealed, onClassroomPeriodEvent, onInstitutionCreated, onOfficialDocumentRendered, onResultsDecisionConfirmed } from "../../application/consumers";
import { bulkRecordCompetencies, getCompetencySummary } from "../../application/competencies";
import { createFramework, listScales, publishFramework, putStructure } from "../../application/frameworks";
import { prepareAnnualReviews, sealAnnualReview } from "../../application/reviews";
import { prepareCouncil } from "../../application/council";
import { instantiatePrimaryReferenceData } from "../../application/template";
import { ConsumedEvents } from "../../domain/events";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, ctxOf, depsOf, IDS } from "../support/world";

describeIntegration("primary_school : abonnés (événements d'autres modules) et performance", () => {
  let db: ModuleTestDb;
  let tenantA: string;

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("consumers-a");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("tenancy.institution.created : le modèle de pack ne s'instancie QUE pour un établissement du pack PRIMARY, idempotent, en ≤ 5 s (AC1.4)", async () => {
    const w = buildWorld();
    const { deps } = depsOf(db.tenantDb, w.world);
    const admin = ctxOf(tenantA, IDS.admin);
    const payload = (pack: string) => ({ v: 1, institutionId: w.world.institutionId, pack, educationSystem: "CI" });
    const secondary = unwrap(await onInstitutionCreated(deps, admin, { id: newId(), type: ConsumedEvents.INSTITUTION_CREATED, payload: payload("SECONDARY") }));
    expect(secondary.applied).toBe(false);
    expect((await db.admin.query(`SELECT count(*)::int AS n FROM primary_school.rating_scales WHERE tenant_id = $1`, [tenantA])).rows[0].n).toBe(0);
    const started = Date.now();
    const first = unwrap(await onInstitutionCreated(deps, admin, { id: newId(), type: ConsumedEvents.INSTITUTION_CREATED, payload: payload("PRIMARY") }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(first.applied).toBe(true);
    const replay = unwrap(await onInstitutionCreated(deps, admin, { id: newId(), type: ConsumedEvents.INSTITUTION_CREATED, payload: payload("PRIMARY") }));
    expect(replay.applied).toBe(false);
    const ev = await db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'primary_school.template.applied' AND tenant_id = $1`, [tenantA]);
    expect(ev.rows[0].n).toBe(1);
    // charge utile illisible : ignorée (jamais une erreur qui rejouerait l'événement)
    expect(unwrap(await onInstitutionCreated(deps, admin, { id: newId(), type: ConsumedEvents.INSTITUTION_CREATED, payload: { nope: true } }))).toEqual({ applied: false });
  });

  it("academic.classroom_period.* : le miroir du verrou suit les événements, sans jamais reculer sur un événement plus ancien", async () => {
    const w = buildWorld();
    const { deps } = depsOf(db.tenantDb, w.world);
    const admin = ctxOf(tenantA, IDS.admin);
    const lockOf = async () => (await db.admin.query(`SELECT status FROM primary_school.period_locks WHERE tenant_id = $1 AND classroom_id = $2 AND academic_period_id = $3`, [tenantA, w.classA, w.periods[0]])).rows[0]?.status;
    const ev = (type: string, at: string) => ({ id: newId(), type, payload: { v: 1, classroomId: w.classA, periodId: w.periods[0] }, occurredAt: at });
    expect(unwrap(await onClassroomPeriodEvent(deps, admin, ev(ConsumedEvents.CLASSROOM_PERIOD_GRADING_CLOSED, "2026-10-02T08:00:00.000Z")))).toEqual({ updated: true });
    expect(await lockOf()).toBe("LOCKED");
    unwrap(await onClassroomPeriodEvent(deps, admin, ev(ConsumedEvents.CLASSROOM_PERIOD_REOPENED, "2026-10-02T09:00:00.000Z")));
    expect(await lockOf()).toBe("OPEN");
    // un événement ancien livré en retard ne ré-verrouille pas une période rouverte depuis
    unwrap(await onClassroomPeriodEvent(deps, admin, ev(ConsumedEvents.CLASSROOM_PERIOD_CLOSED, "2026-10-02T08:30:00.000Z")));
    expect(await lockOf()).toBe("OPEN");
    unwrap(await onClassroomPeriodEvent(deps, admin, ev(ConsumedEvents.CLASSROOM_PERIOD_CLOSED, "2026-10-02T10:00:00.000Z")));
    expect(await lockOf()).toBe("LOCKED");
    // événement d'un autre type ou charge utile illisible : ignoré
    expect(unwrap(await onClassroomPeriodEvent(deps, admin, { id: newId(), type: "academic.period.opened", payload: { v: 1, classroomId: w.classA, periodId: w.periods[0] } }))).toEqual({ updated: false });
    expect(unwrap(await onClassroomPeriodEvent(deps, admin, { id: newId(), type: ConsumedEvents.CLASSROOM_PERIOD_CLOSED, payload: { classroomId: "x" } }))).toEqual({ updated: false });
  });

  it("results.decision.confirmed : un dossier ouvert est décidé et l'issue de fin d'année enregistrée ; un dossier déjà décidé n'est pas retouché", async () => {
    const w = buildWorld();
    const { deps } = depsOf(db.tenantDb, w.world);
    const admin = ctxOf(tenantA, IDS.admin);
    const P3 = w.periods[2] as string;
    const { s1, s2 } = w.students;
    w.world.seedProposals(w.classA, P3, { [s1.enrollmentId]: "PROMOTED", [s2.enrollmentId]: "REPEAT" });
    const council = unwrap(await prepareCouncil(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, periodId: P3 }, {}));
    // décision confirmée DANS results (hors de ce module) : l'événement alimente le dossier et l'inscription
    const confirmed = await w.world.ports().results.confirmDecision(admin, { decisionId: (await w.world.ports().results.listProposals(admin, { classroomId: w.classA, periodId: P3 })).find((p) => p.enrollmentId === s1.enrollmentId)!.decisionId, deliberationId: council.deliberationId });
    const event = { id: newId(), type: ConsumedEvents.DECISION_CONFIRMED, aggregateId: confirmed.decisionId, payload: { v: 1, enrollmentId: s1.enrollmentId, finalCode: "PROMOTED", academicPeriodId: P3 } };
    expect(unwrap(await onResultsDecisionConfirmed(deps, admin, event))).toEqual({ caseUpdated: true, outcomeRecorded: "PROMOTED" });
    expect(w.world.outcomes).toContainEqual(expect.objectContaining({ enrollmentId: s1.enrollmentId, outcomeCode: "PROMOTED" }));
    const row = (await db.admin.query(`SELECT status, decision_ref FROM primary_school.council_cases WHERE tenant_id = $1 AND enrollment_id = $2`, [tenantA, s1.enrollmentId])).rows[0];
    expect(row).toMatchObject({ status: "DECIDED", decision_ref: confirmed.decisionId });
    // rejeu : plus aucun dossier ouvert pour cette inscription, aucune issue ré-enregistrée
    expect(unwrap(await onResultsDecisionConfirmed(deps, admin, event))).toEqual({ caseUpdated: false, outcomeRecorded: null });
    // une décision de période intermédiaire ne produit PAS d'issue d'inscription
    const mid = w.periods[0] as string;
    w.world.seedProposals(w.classA, mid, { [s2.enrollmentId]: "PROMOTED" });
    unwrap(await prepareCouncil(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, periodId: mid }, {}));
    const before = w.world.outcomes.length;
    unwrap(await onResultsDecisionConfirmed(deps, admin, { id: newId(), type: ConsumedEvents.DECISION_CONFIRMED, aggregateId: newId(), payload: { v: 1, enrollmentId: s2.enrollmentId, finalCode: "PROMOTED", academicPeriodId: mid } }));
    expect(w.world.outcomes).toHaveLength(before);
    // sans identifiant de décision (aggregateId) ou charge utile illisible : ignoré
    expect(unwrap(await onResultsDecisionConfirmed(deps, admin, { id: newId(), type: ConsumedEvents.DECISION_CONFIRMED, payload: { v: 1, enrollmentId: s1.enrollmentId } }))).toEqual({ caseUpdated: false, outcomeRecorded: null });
  });

  it("bilan scellé -> PDF demandé ; document rendu (ANNUAL_REVIEW seulement) -> identifiant émis renseigné une fois", async () => {
    const w = buildWorld();
    const { deps } = depsOf(db.tenantDb, w.world);
    const admin = ctxOf(tenantA, IDS.admin);
    const DIRECTION = { allClasses: true, councilManage: true, validate: true };
    const { s1 } = w.students;
    w.world.yearClosedForClass.add(`${w.classA}:${w.yearId}`);
    w.world.seedYearResult(s1.enrollmentId, w.yearId);
    w.world.confirmedYearDecisions.set(`${s1.enrollmentId}:${w.yearId}`, { decisionId: newId(), finalCode: "PROMOTED" });
    const prepared = unwrap(await prepareAnnualReviews(deps, admin, { classroomId: w.classA, academicYearId: w.yearId }, DIRECTION));
    const review = prepared.reviews.find((r) => r.enrollmentId === s1.enrollmentId)!;
    const sealed = unwrap(await sealAnnualReview(deps, admin, review.id, DIRECTION));
    expect(sealed.status).toBe("SEALED");
    expect(unwrap(await onAnnualReviewSealed(deps, admin, { id: newId(), type: "primary_school.annual_review.sealed", payload: { v: 1, reviewId: sealed.id } }))).toEqual({ requested: true });
    expect(w.world.requestedReviews.at(-1)).toMatchObject({ reviewId: sealed.id, contentHash: sealed.contentHash });
    // nature non livrée : l'abonné échoue (le worker rejoue), jamais une demande perdue
    w.world.documentsAvailable = false;
    const failing = await onAnnualReviewSealed(deps, admin, { id: newId(), type: "primary_school.annual_review.sealed", payload: { v: 1, reviewId: sealed.id } });
    expect(failing.ok).toBe(false);
    w.world.documentsAvailable = true;
    // document rendu d'une AUTRE nature : ignoré ; ANNUAL_REVIEW : identifiant renseigné
    const doc = newId();
    expect(unwrap(await onOfficialDocumentRendered(deps, admin, { id: newId(), type: ConsumedEvents.OFFICIAL_DOCUMENT_RENDERED, payload: { v: 1, documentId: doc, documentKind: "RECEIPT", sourceId: sealed.id } }))).toEqual({ updated: false });
    expect(unwrap(await onOfficialDocumentRendered(deps, admin, { id: newId(), type: ConsumedEvents.OFFICIAL_DOCUMENT_RENDERED, payload: { v: 1, documentId: doc, documentKind: "ANNUAL_REVIEW", sourceId: sealed.id } }))).toEqual({ updated: true });
    expect((await db.admin.query(`SELECT reportcard_id FROM primary_school.annual_reviews WHERE id = $1`, [sealed.id])).rows[0].reportcard_id).toBe(doc);
    // rejeu (autre événement, même document) : la ligne ne se réécrit pas
    expect(unwrap(await onOfficialDocumentRendered(deps, admin, { id: newId(), type: ConsumedEvents.OFFICIAL_DOCUMENT_RENDERED, payload: { v: 1, documentId: newId(), documentKind: "ANNUAL_REVIEW", sourceId: sealed.id } }))).toEqual({ updated: false });
    // bilan inexistant : tolérant
    expect(unwrap(await onAnnualReviewSealed(deps, admin, { id: newId(), type: "primary_school.annual_review.sealed", payload: { v: 1, reviewId: newId() } }))).toEqual({ requested: false });
  });

  it("performance : synthèse de compétences d'un élève (40 compétences × 3 périodes) rapide ; objectif de la spec : p95 < 100 ms (marge de CI : 300 ms)", async () => {
    const w = buildWorld();
    const { deps } = depsOf(db.tenantDb, w.world);
    const admin = ctxOf(tenantA, IDS.admin);
    unwrap(await instantiatePrimaryReferenceData(deps, admin, { institutionId: w.world.institutionId }));
    const scale = unwrap(await listScales(deps, admin)).find((s) => s.code === "MASTERY_4")!;
    const fw = unwrap(await createFramework(deps, admin, { code: "PERF_FW", label: "Perf", scaleId: scale.id, gradeLevelCodes: ["CE1"], sourceKind: "placeholder" }));
    unwrap(await putStructure(deps, admin, fw.id, { domains: Array.from({ length: 4 }, (_, d) => ({ code: `D${d + 1}`, label: `Domaine ${d + 1}`, competencies: Array.from({ length: 10 }, (_, c) => ({ code: `D${d + 1}.${c + 1}`, label: `Compétence ${d + 1}.${c + 1}` })) })) }));
    const published = unwrap(await publishFramework(deps, admin, fw.id));
    const competencies = published.domains.flatMap((d) => d.competencies);
    expect(competencies).toHaveLength(40);
    const level = scale.levels[2]!.id;
    for (const periodId of w.periods) {
      unwrap(
        await bulkRecordCompetencies(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, periodId, frameworkId: published.id, lines: competencies.map((c) => ({ enrollmentId: w.students.s1.enrollmentId, competencyId: c.id, ratingLevelId: level })) }, {}),
      );
      unwrap(await (await import("../../application/competencies")).validateCompetencies(deps, ctxOf(tenantA, IDS.teacherA), { classroomId: w.classA, periodId, frameworkId: published.id }, { validate: true }));
    }
    const timings: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const t0 = performance.now();
      const view = unwrap(await getCompetencySummary(deps, ctxOf(tenantA, IDS.teacherA), { enrollmentId: w.students.s1.enrollmentId }, {}));
      timings.push(performance.now() - t0);
      expect(Object.values(view.summary).reduce((n, d) => n + Object.values(d).reduce((a, b) => a + b, 0), 0)).toBe(120);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95) - 1] as number;
    expect(p95).toBeLessThan(300);
  });
});
