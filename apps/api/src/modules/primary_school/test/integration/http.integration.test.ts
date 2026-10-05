/**
 * Intégration HTTP (Fastify `inject`, Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL).
 * Les gardes de permission sont simulées à partir des modèles de rôles attendus du module rbac (instituteur, directeur, secrétariat,
 * parent) ; le LIEN (classe affectée, tuteur lié) est vérifié par les cas d'usage sur le monde en mémoire.
 * Les réponses sont validées par les SCHÉMAS DES CONTRATS partagés avec le web.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ManualClock, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import {
  primaryAnnualReviewDtoSchema,
  primaryCompetencySheetDtoSchema,
  primaryCouncilOverviewDtoSchema,
  primaryFrameworkDetailDtoSchema,
  primaryMyClassroomDtoSchema,
  primaryReadinessDtoSchema,
  primaryReportDtoSchema,
  primaryYearArchiveDtoSchema,
} from "@ecoledigitale/contracts/src/v2/primary_school";
import { createPrimarySchoolDeps, type PrimarySchoolDeps } from "../../application/deps";
import { onReviewDocumentRendered } from "../../application/reviews";
import { RecordingAudit } from "../../application/ports";
import { primarySchoolPlugin } from "../../http/plugin";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, IDS, permissionsOf, type World } from "../support/world";

describeIntegration("primary_school : HTTP (matrice par rôle, contrats)", () => {
  let db: ModuleTestDb;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  let w: World;
  let deps: PrimarySchoolDeps;
  const audit = new RecordingAudit();
  const clock = new ManualClock("2026-10-02T09:00:00.000Z");

  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, user: string | null, payload?: unknown, tenant = tenantA) =>
    app.inject({ method, url, headers: { ...(user ? { "x-user": user, "x-tenant": tenant } : {}) }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const ok = async (method: "GET" | "POST" | "PUT" | "PATCH", url: string, user: string, payload?: unknown, status = 200) => {
    const res = await call(method, url, user, payload);
    expect(res.statusCode, `${method} ${url} -> ${res.body}`).toBe(status);
    return res.json();
  };

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("http-a");
    tenantB = await db.createTenant("http-b");
    w = buildWorld();
    deps = createPrimarySchoolDeps({ db: db.tenantDb, clock, audit, ports: w.world.ports() });
    app = Fastify({ logger: false });
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      const user = request.headers["x-user"];
      const tenant = request.headers["x-tenant"];
      if (typeof user === "string" && typeof tenant === "string") (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: user });
    });
    await app.register(primarySchoolPlugin, {
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
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("sans contexte : refus ; identité usurpée par en-tête sans effet ; réponses jamais mises en cache", async () => {
    expect((await call("GET", "/my-classrooms", null)).statusCode).toBeGreaterThanOrEqual(401);
    const res = await app.inject({ method: "GET", url: "/my-classrooms", headers: { "x-user": IDS.teacherA, "x-tenant": tenantA, "x-user-id": IDS.admin } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().items.map((c: { classroomId: string }) => c.classroomId)).toEqual([w.classA]); // l'identité vient du contexte, pas de l'en-tête
    expect((await call("GET", "/my-classrooms", IDS.nobody)).statusCode).toBe(403);
  });

  it("modèle de pack : seule la direction l'applique (rôle sensible), idempotent", async () => {
    expect((await call("POST", "/template/apply", IDS.teacherA, {})).statusCode).toBe(403);
    expect((await call("POST", "/template/apply", IDS.secretary, {})).statusCode).toBe(403);
    const first = await ok("POST", "/template/apply", IDS.admin, { institutionId: w.world.institutionId });
    expect(first).toMatchObject({ alreadyApplied: false, created: { scales: 1, frameworks: 2, phrases: 3, settings: 1 } });
    expect(await ok("POST", "/template/apply", IDS.admin, { institutionId: w.world.institutionId })).toMatchObject({ alreadyApplied: true });
    const settings = await ok("GET", `/settings?institutionId=${w.world.institutionId}`, IDS.admin);
    expect(settings).toMatchObject({ requireHomeroomForActivation: true, councilRequiredForBilan: true, archiveRetentionYears: null });
    expect((await call("PUT", "/settings", IDS.teacherA, { phraseBankEnabled: false })).statusCode).toBe(403);
    expect(await ok("PUT", "/settings", IDS.admin, { institutionId: w.world.institutionId, archiveRetentionYears: 10 })).toMatchObject({ archiveRetentionYears: 10 });
    expect((await call("PUT", "/settings", IDS.admin, { archiveRetentionYears: -1 })).statusCode).toBe(400);
  });

  it("instituteur : voit SES classes et leur grille ; une autre classe est introuvable (404) ; la banque de phrases se filtre", async () => {
    const mineA = (await ok("GET", "/my-classrooms", IDS.teacherA)).items;
    const mineB = (await ok("GET", "/my-classrooms", IDS.teacherB)).items;
    expect(mineA.map((c: { classroomId: string }) => c.classroomId)).toEqual([w.classA]);
    expect(mineB.map((c: { classroomId: string }) => c.classroomId)).toEqual([w.classB]);
    expect(mineA[0]).toMatchObject({ studentCount: 3, isHomeroom: true, gradeLevelCode: "CE1" });
    expect(mineA[0].periods).toHaveLength(3);
    const direction = (await ok("GET", "/my-classrooms", IDS.admin)).items;
    expect(direction).toHaveLength(2);

    const p1 = w.periods[0];
    const sheet = primaryCompetencySheetDtoSchema.parse(await ok("GET", `/classrooms/${w.classA}/competency-sheet?periodId=${p1}`, IDS.teacherA));
    expect(sheet.framework?.code).toBe("PRIMARY_DEMO");
    expect(sheet.students).toHaveLength(3);
    expect((await call("GET", `/classrooms/${w.classA}/competency-sheet?periodId=${p1}`, IDS.teacherB)).statusCode).toBe(404);
    expect((await call("GET", `/classrooms/${w.classA}/competency-sheet`, IDS.teacherA)).statusCode).toBe(400);

    const phrases = (await ok("GET", "/phrases?scope=PERIOD&ratingLevelCode=N1", IDS.teacherA)).items;
    expect(phrases.map((p: { code: string }) => p.code)).toEqual(["PERIOD_N1"]);
    expect(phrases[0].sourceKind).toBe("placeholder");
    expect((await call("POST", "/phrases", IDS.teacherA, { code: "MA_PHRASE", scope: "PERIOD", body: "x" })).statusCode).toBe(403);
    expect((await call("POST", "/phrases", IDS.admin, { code: "MA_PHRASE", scope: "PERIOD", body: "Bravo pour ce trimestre.", ratingLevelCode: "N4" })).statusCode).toBe(201);
    expect((await call("POST", "/phrases", IDS.admin, { code: "MA_PHRASE", scope: "PERIOD", body: "Doublon" })).statusCode).toBe(409);
  });

  it("saisie en lot par HTTP : idempotente, 400 sur lot invalide, 409 période verrouillée, validation puis révision réservée à la direction", async () => {
    const p1 = w.periods[0]!;
    const sheet = primaryCompetencySheetDtoSchema.parse(await ok("GET", `/classrooms/${w.classA}/competency-sheet?periodId=${p1}`, IDS.teacherA));
    const fw = sheet.framework!;
    const competency = fw.domains[0]!.competencies[0]!;
    const [n1, n2, n3] = fw.scale.levels;
    const lines = sheet.students.map((s) => ({ enrollmentId: s.enrollmentId, competencyId: competency.id, ratingLevelId: n2!.id }));
    const body = { classroomId: w.classA, periodId: p1, frameworkId: fw.id, lines };
    const first = await ok("PUT", "/competency-assessments/bulk", IDS.teacherA, body);
    expect(first).toMatchObject({ created: 3, updated: 0, unchanged: 0 });
    expect(await ok("PUT", "/competency-assessments/bulk", IDS.teacherA, body)).toMatchObject({ created: 0, unchanged: 3 });
    expect((await call("PUT", "/competency-assessments/bulk", IDS.teacherB, body)).statusCode).toBe(404); // pas SA classe
    expect((await call("PUT", "/competency-assessments/bulk", IDS.parent1, body)).statusCode).toBe(403);
    expect((await call("PUT", "/competency-assessments/bulk", IDS.teacherA, { ...body, lines: [] })).statusCode).toBe(400);
    expect((await call("PUT", "/competency-assessments/bulk", IDS.teacherA, { ...body, lines: [{ ...lines[0], ratingLevelId: n1!.id }, { ...lines[0], ratingLevelId: n3!.id }] })).statusCode).toBe(400);

    w.world.lock(w.classA, w.periods[1]!);
    const locked = await call("PUT", "/competency-assessments/bulk", IDS.teacherA, { ...body, periodId: w.periods[1] });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ code: "primary_school.period_locked", kind: "conflict" });
    w.world.lock(w.classA, w.periods[1]!, false);

    // Q-P18 : une saisie brouillon n'est JAMAIS visible de la famille (ni période prête, ni validée, ni publiée)
    expect((await ok("GET", `/enrollments/${w.students.s1.enrollmentId}/competency-summary`, IDS.parent1)).summary).toEqual({});

    // validation (instituteur) puis correction : seule la direction révise (permission sensible)
    expect(await ok("POST", `/classrooms/${w.classA}/periods/${p1}/competencies/validate`, IDS.teacherA, { frameworkId: fw.id })).toMatchObject({ validated: 3 });
    const target = first.assessments[0];
    const revision = { toRatingLevelId: n3!.id, reason: "Erreur de saisie constatée au conseil." };
    expect((await call("POST", `/competency-assessments/${target.id}/revisions`, IDS.teacherA, revision)).statusCode).toBe(403);
    expect((await call("POST", `/competency-assessments/${target.id}/revisions`, IDS.admin, { ...revision, reason: "court" })).statusCode).toBe(400);
    const done = await ok("POST", `/competency-assessments/${target.id}/revisions`, IDS.admin, revision, 201);
    expect(done.assessment.ratingLevelId).toBe(n3!.id);
    expect((await ok("GET", `/competency-assessments/${target.id}/revisions`, IDS.teacherA)).items).toHaveLength(1);
    // la saisie ne touche plus une ligne validée
    const frozen = await call("PUT", "/competency-assessments/bulk", IDS.teacherA, { ...body, lines: [{ ...lines[0], ratingLevelId: n1!.id, rowVersion: 1 }] });
    expect(frozen.statusCode).toBe(409);

    // synthèse : compteurs ; la famille voit la période APRÈS validation (Q-P18), même sans bulletin publié
    const e1 = w.students.s1.enrollmentId;
    const staffSummary = await ok("GET", `/enrollments/${e1}/competency-summary`, IDS.teacherA);
    expect(Object.keys(staffSummary.summary)).toEqual(["D1"]);
    expect((await call("GET", `/enrollments/${e1}/competency-summary`, IDS.teacherB)).statusCode).toBe(404);
    expect(Object.keys((await ok("GET", `/enrollments/${e1}/competency-summary`, IDS.parent1)).summary)).toEqual(["D1"]);
    w.world.publishedPeriods.set(e1, [p1]);
    expect(Object.keys((await ok("GET", `/enrollments/${e1}/competency-summary`, IDS.parent1)).summary)).toEqual(["D1"]);
    expect((await call("GET", `/enrollments/${e1}/competency-summary`, IDS.parent2)).statusCode).toBe(404); // pas le tuteur de cet enfant
    expect((await call("GET", `/children/${w.students.s1.studentId}/enrollments/${e1}/competency-summary`, IDS.parent1)).statusCode).toBe(200);
    expect((await call("GET", `/children/${w.students.s1.studentId}/enrollments/${e1}/competency-summary`, IDS.parent2)).statusCode).toBe(404);
  });

  it("Q-P18 : « prêts » par HTTP : l'instituteur de la classe marque et retire (motif), parent et autre instituteur refusés, contrat validé", async () => {
    const p3 = w.periods[2]!;
    const base = `/classrooms/${w.classA}/periods/${p3}/ready`;
    expect((await call("POST", base, IDS.parent1)).statusCode).toBe(403); // la famille ne marque pas
    expect((await call("POST", base, IDS.teacherB)).statusCode).toBe(404); // pas SA classe
    expect((await call("POST", base, null)).statusCode).toBe(403); // sans contexte
    const marked = primaryReadinessDtoSchema.parse(await ok("POST", base, IDS.teacherA));
    expect(marked).toMatchObject({ classroomId: w.classA, periodId: p3, status: "READY", withdrawnAt: null });
    const list = await ok("GET", `/classrooms/${w.classA}/readiness`, IDS.teacherA);
    expect(list.items.map((r: { periodId: string; status: string }) => [r.periodId, r.status])).toEqual([[p3, "READY"]]);
    const mine = await ok("GET", "/my-classrooms", IDS.teacherA);
    expect(primaryMyClassroomDtoSchema.parse(mine.items[0]).periods.find((p) => p.id === p3)?.ready).toBe(true);
    // retrait : motif de 10 caractères au moins (400), la famille ne retire pas (403)
    expect((await call("POST", `${base}/withdraw`, IDS.teacherA, { reason: "court" })).statusCode).toBe(400);
    expect((await call("POST", `${base}/withdraw`, IDS.parent1, { reason: "Retrait demandé par un parent." })).statusCode).toBe(403);
    expect(await ok("POST", `${base}/withdraw`, IDS.teacherA, { reason: "Marquage posé trop tôt." })).toMatchObject({ status: "NOT_READY" });
    expect((await call("POST", `${base}/withdraw`, IDS.teacherA, { reason: "Marquage posé trop tôt." })).statusCode).toBe(409);
  });

  it("référentiels : brouillon, structure, publication par la direction ; un référentiel publié est immuable (409) ; version suivante", async () => {
    const scale = (await ok("GET", "/rating-scales", IDS.admin)).items[0];
    const created = await ok("POST", "/frameworks", IDS.admin, { code: "HTTP_FW", label: "HTTP", scaleId: scale.id, gradeLevelCodes: ["CM2"], sourceKind: "institution" }, 201);
    expect(primaryFrameworkDetailDtoSchema.parse(created).publishBlockers.length).toBeGreaterThan(0); // pas publiable : aucune compétence
    expect((await call("POST", `/frameworks/${created.id}/publish`, IDS.admin)).statusCode).toBe(409);
    expect((await call("PUT", `/frameworks/${created.id}/structure`, IDS.teacherA, { domains: [] })).statusCode).toBe(403);
    await ok("PUT", `/frameworks/${created.id}/structure`, IDS.admin, { domains: [{ code: "D", label: "Domaine", competencies: [{ code: "D.1", label: "Compétence" }] }] });
    expect((await call("POST", `/frameworks/${created.id}/publish`, IDS.teacherA)).statusCode).toBe(403);
    expect(await ok("POST", `/frameworks/${created.id}/publish`, IDS.admin)).toMatchObject({ status: "PUBLISHED", publishBlockers: [] });
    const locked = await call("PUT", `/frameworks/${created.id}/structure`, IDS.admin, { domains: [{ code: "D", label: "Autre", competencies: [{ code: "D.1", label: "Modifié" }] }] });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe("primary_school.framework_published_immutable");
    expect((await call("DELETE", `/frameworks/${created.id}`, IDS.admin)).statusCode).toBe(409);
    const v2 = await ok("POST", `/frameworks/${created.id}/new-version`, IDS.admin, undefined, 201);
    expect(v2).toMatchObject({ version: 2, status: "DRAFT" });
    expect((await call("DELETE", `/frameworks/${v2.id}`, IDS.admin)).statusCode).toBe(204);
    // l'échelle employée par un référentiel publié est figée
    const levels = scale.levels.map((l: { code: string; label: string; ordinal: number; meetsExpectation: boolean }) => ({ code: l.code, label: l.label, ordinal: l.ordinal, meetsExpectation: l.meetsExpectation }));
    expect((await call("PUT", `/rating-scales/${scale.id}/levels`, IDS.admin, { levels })).statusCode).toBe(409);
  });

  it("conseil, bilan annuel et archive par HTTP : droits par rôle, scellement sensible, famille limitée à son enfant", async () => {
    const [P1, , P3] = w.periods as [string, string, string];
    const { s1, s2, s3 } = w.students;
    w.world.seedProposals(w.classA, P3, { [s1.enrollmentId]: "PROMOTED", [s2.enrollmentId]: "COUNCIL_REVIEW", [s3.enrollmentId]: "REPEAT" });
    w.world.flags.set(s2.enrollmentId, ["BORDERLINE"]);

    // conseil : l'instituteur prépare ses dossiers ; seule la présidence préside et décide
    expect((await call("POST", "/councils/prepare", IDS.teacherB, { classroomId: w.classA, periodId: P3 })).statusCode).toBe(404);
    expect((await call("POST", "/councils/prepare", IDS.parent1, { classroomId: w.classA, periodId: P3 })).statusCode).toBe(403);
    const council = primaryCouncilOverviewDtoSchema.parse(await ok("POST", "/councils/prepare", IDS.teacherA, { classroomId: w.classA, periodId: P3 }, 201));
    expect(council.cases).toHaveLength(3);
    expect(council.ruleSourceKind).toBe("placeholder");
    const caseS2 = council.cases.find((c) => c.enrollmentId === s2.enrollmentId)!;
    const patch = await ok("PATCH", `/councils/${council.deliberationId}/cases/${caseS2.id}`, IDS.teacherA, { proposalCode: "REPEATED", proposalNote: "Absences." });
    expect(patch).toMatchObject({ proposalCode: "REPEATED", status: "OPEN" });
    expect((await call("POST", `/councils/${council.deliberationId}/cases/${caseS2.id}/decide`, IDS.teacherA, {})).statusCode).toBe(403);
    expect((await call("PUT", `/councils/${council.deliberationId}/attendance`, IDS.teacherA, { participants: [{ staffId: w.staffA, roleCode: "HOMEROOM" }] })).statusCode).toBe(403);
    const weak = await call("POST", `/councils/${council.deliberationId}/cases/${caseS2.id}/decide`, IDS.admin, { finalCode: "REPEAT" });
    expect(weak.statusCode).toBe(400);
    for (const c of council.cases) {
      const body = c.enrollmentId === s2.enrollmentId ? { finalCode: "REPEAT", justification: "Trois mois d'absence non justifiée." } : {};
      expect((await call("POST", `/councils/${council.deliberationId}/cases/${c.id}/decide`, IDS.admin, body)).statusCode).toBe(200);
    }
    const attendance = await ok("PUT", `/councils/${council.deliberationId}/attendance`, IDS.admin, { participants: [{ staffId: w.staffA, roleCode: "HOMEROOM", present: true }], signedStaffIds: [w.staffA] });
    expect(primaryCouncilOverviewDtoSchema.parse(attendance).counts.decided).toBe(3);
    expect((await call("POST", `/councils/${council.deliberationId}/minutes`, IDS.admin, {})).statusCode).toBe(409); // date réelle de séance requise
    expect((await call("POST", `/councils/${council.deliberationId}/minutes`, IDS.admin, { heldOn: "2026-10-02" })).statusCode).toBe(201);
    expect((await ok("GET", `/councils?classroomId=${w.classA}`, IDS.teacherA)).items).toHaveLength(1);
    expect((await ok("GET", `/councils/${council.deliberationId}/cases`, IDS.admin)).items).toHaveLength(3);

    // bilan : préparation par la direction, scellement refusé avant clôture, puis sensible
    w.world.seedYearResult(s1.enrollmentId, w.yearId);
    w.world.seedYearResult(s2.enrollmentId, w.yearId);
    w.world.seedYearResult(s3.enrollmentId, w.yearId);
    expect((await call("POST", "/annual-reviews/prepare", IDS.teacherA, { classroomId: w.classA, academicYearId: w.yearId })).statusCode).toBe(403);
    const prepared = await ok("POST", "/annual-reviews/prepare", IDS.admin, { classroomId: w.classA, academicYearId: w.yearId });
    expect(prepared.created).toBe(3);
    const review = primaryAnnualReviewDtoSchema.parse(prepared.reviews.find((r: { enrollmentId: string }) => r.enrollmentId === s1.enrollmentId));
    const open = await call("POST", `/annual-reviews/${review.id}/seal`, IDS.admin);
    expect(open.statusCode).toBe(409);
    expect(open.json().code).toBe("primary_school.review_periods_open");
    w.world.yearClosedForClass.add(`${w.classA}:${w.yearId}`);
    await ok("POST", "/annual-reviews/prepare", IDS.admin, { classroomId: w.classA, academicYearId: w.yearId });
    expect((await call("POST", `/annual-reviews/${review.id}/seal`, IDS.teacherA)).statusCode).toBe(403);
    const sealed = primaryAnnualReviewDtoSchema.parse(await ok("POST", `/annual-reviews/${review.id}/seal`, IDS.admin));
    expect(sealed).toMatchObject({ status: "SEALED", ruleSourceKind: "placeholder" });
    expect(sealed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("POST", `/annual-reviews/${review.id}/seal`, IDS.admin)).statusCode).toBe(409);
    expect((await call("GET", `/annual-reviews?classroomId=${w.classA}&yearId=${w.yearId}`, IDS.teacherB)).statusCode).toBe(404);
    expect((await ok("GET", `/annual-reviews?classroomId=${w.classA}&yearId=${w.yearId}`, IDS.teacherA)).items).toHaveLength(3);

    // famille : bilan scellé ET émis de SON enfant seulement
    expect((await ok("GET", `/children/${s1.studentId}/annual-reviews`, IDS.parent1)).items).toEqual([]);
    unwrapOk(await onReviewDocumentRendered(deps, createPrimaryCtx(tenantA, IDS.admin), { reviewId: review.id, documentId: "0192f0a4-7b1e-7c3a-8d2e-0000000009d1" }));
    const mine = (await ok("GET", `/children/${s1.studentId}/annual-reviews`, IDS.parent1)).items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: review.id, reportcardId: "0192f0a4-7b1e-7c3a-8d2e-0000000009d1" });
    expect((await call("GET", `/children/${s1.studentId}/annual-reviews`, IDS.parent2)).statusCode).toBe(404);
    expect((await call("GET", `/children/${s3.studentId}/annual-reviews`, IDS.parent1)).statusCode).toBe(404);
    expect((await call("POST", `/annual-reviews/${review.id}/reissue`, IDS.parent1, { reason: "Je veux changer." })).statusCode).toBe(403);
    expect((await call("GET", `/annual-reviews/${review.id}`, IDS.parent1)).statusCode).toBe(403);

    // archive : préparation (direction), gel sensible et irréversible
    const prep = primaryYearArchiveDtoSchema.parse(await ok("POST", "/year-archives/prepare", IDS.admin, { academicYearId: w.yearId, institutionId: w.world.institutionId }));
    expect(prep.status).toBe("PREPARING");
    expect(prep.blockers.length).toBeGreaterThan(0);
    expect((await call("POST", `/year-archives/${prep.id}/freeze`, IDS.teacherA)).statusCode).toBe(403);
    expect((await call("POST", `/year-archives/${prep.id}/freeze`, IDS.admin)).statusCode).toBe(409);
    expect((await ok("GET", "/year-archives", IDS.admin)).items).toHaveLength(1);
    expect((await call("POST", "/year-archives/prepare", IDS.teacherA, { academicYearId: w.yearId })).statusCode).toBe(403);
    void P1;
  });

  it("rapports : lecture seule, bornés par le périmètre ; export CSV ; avancement réservé à la direction", async () => {
    const list = primaryReportDtoSchema.parse(await ok("GET", `/reports/class-list?classroomId=${w.classA}`, IDS.secretary));
    expect(list.rows.map((r) => r.student)).toEqual(["Awa Koné", "Yao Kouadio", "Fanta Traoré"]);
    expect(list.parameters.classroomId).toBe(w.classA);
    expect((await call("GET", `/reports/class-list?classroomId=${w.classA}`, IDS.teacherA)).statusCode).toBe(403); // pas de permission de rapport
    expect((await call("GET", "/reports/class-list", IDS.secretary)).statusCode).toBe(400);
    expect((await call("GET", "/reports/inconnu", IDS.secretary)).statusCode).toBe(400);
    const csv = await call("GET", `/reports/class-list?classroomId=${w.classA}&format=csv`, IDS.secretary);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body.startsWith("﻿N°;Élève;Redoublant")).toBe(true);
    const stats = (await ok("GET", "/reports/enrollment-stats", IDS.secretary)).rows;
    expect(stats.map((r: { students: number }) => r.students).sort()).toEqual([1, 3]);
    const repeaters = (await ok("GET", "/reports/repeaters", IDS.admin)).rows;
    expect(repeaters).toEqual([{ grade: "CE1", classroom: "CE1 A", student: "Yao Kouadio" }]);
    const progress = (await ok("GET", "/progress", IDS.admin)).items;
    expect(progress).toHaveLength(6); // 2 classes × 3 périodes
    expect(progress[0]).toHaveProperty("competencies.expected");
    const coverage = await ok("GET", `/reports/competency-coverage?classroomId=${w.classA}&periodId=${w.periods[0]}`, IDS.admin);
    expect(coverage.rows).toHaveLength(3);
    expect((await call("GET", `/reports/attendance-register?classroomId=${w.classA}&month=2026-10`, IDS.admin)).statusCode).toBe(200);
    // le tenant B n'a rien de tout cela
    const other = await call("GET", "/rating-scales", IDS.admin, undefined, tenantB);
    expect(other.statusCode).toBe(200);
    expect(other.json().items).toEqual([]);
    const bannerB = await call("GET", "/rule-banner", IDS.admin, undefined, tenantB);
    expect(bannerB.statusCode).toBe(200);
    expect(await ok("GET", "/rule-banner", IDS.teacherA)).toEqual({ ruleSourceKind: "placeholder", isPlaceholder: true });
  });
});

function createPrimaryCtx(tenantId: string, userId: string): RequestContext {
  return createRequestContext({ tenantId, userId });
}

function unwrapOk<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
