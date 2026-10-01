/**
 * API HTTP /api/v1/assess/* (Fastify inject + Postgres réel) : 401/403/404/409/400, permissions par étape du circuit,
 * saisie en lot avec `Idempotency-Key`, lectures famille, contrat de plugin `(app, runtime)`.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, newId, type RequestContext } from "@ecoledigitale/kernel";
import {
  assessGradeSheetDtoSchema,
  assessPublishedGradesPageDtoSchema,
  assessRevisionDtoSchema,
  assessSaveGradesResultDtoSchema,
  assessTypeDtoSchema,
  assessmentDtoSchema,
} from "@ecoledigitale/contracts/src/v2/assess";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import assessModulePlugin, { assessPlugin, registerAssessPorts, setup } from "../../http/plugin";
import { createAssessDeps } from "../../application/deps";
import { createAssessTestDb, describeIntegration, type AssessTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/assess/* (Fastify + Postgres réel)", () => {
  let db: AssessTestDb;
  let world: TestWorld;
  let school: School;
  let app: FastifyInstance;
  let features: Set<string>;
  const identities = new Map<string, Who>();

  const ALL = manifest.permissions.map((p) => p.key);
  const TEACHER = ["assessment.read", "assessment.create", "assessment.update", "grade.read", "grade.enter", "grade.revise.request"];

  const call = async (who: string | null, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({
      method,
      url: `/api/v1/assess${url}`,
      headers: { ...(who ? { "x-test-identity": who } : {}), ...headers },
      ...(body !== undefined ? { payload: body as never } : {}),
    });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, json };
  };
  const ok = <T>(r: { status: number; json: T }, status = 200): T => {
    expect(r.status, JSON.stringify(r.json)).toBe(status);
    return r.json;
  };

  beforeAll(async () => {
    db = await createAssessTestDb();
    world = makeWorld(db);
    school = await seedSchool(db, world, { students: 4, pack: "higher" });
    features = new Set(["assess.session2"]);
    identities.set("teacher", { ctx: school.teacher.ctx, perms: TEACHER });
    identities.set("coTeacher", { ctx: school.coTeacher.ctx, perms: TEACHER });
    identities.set("reviewer", { ctx: school.reviewer.ctx, perms: ["assessment.read", "grade.read", "grade.review", "grade.validate"] });
    identities.set("director", { ctx: school.director.ctx, perms: ALL });
    identities.set("guardian", { ctx: school.guardian.ctx, perms: ["grade.child.read"] });
    identities.set("pupil", { ctx: school.pupil.ctx, perms: ["grade.self.read"] });
    identities.set("nobody", { ctx: school.pupil.ctx, perms: [] });

    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const id = req.headers["x-test-identity"];
      const who = typeof id === "string" ? identities.get(id) : undefined;
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const whoOf = (req: FastifyRequest): Who | undefined => {
      const id = req.headers["x-test-identity"];
      return typeof id === "string" ? identities.get(id) : undefined;
    };
    await app.register(assessPlugin, {
      deps: createAssessDeps({ db: db.tenantDb, clock: world.clock, ports: world.ports as never, audit: world.audit }),
      requirePermission: (permission: string) =>
        async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
          const who = whoOf(req);
          if (!who) throw new UnauthorizedError();
          if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
        },
      requireFeature: (feature: string) =>
        async function gate() {
          if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
        },
      resolveContext: (req: FastifyRequest) => {
        const who = whoOf(req);
        if (!who) throw new UnauthorizedError();
        return who.ctx;
      },
      prefix: "/api/v1/assess",
    } as never);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  let assessmentId: string;
  let gradeIds: string[] = [];

  it("401 sans contexte, 403 sans permission, 404 inconnu, 400 corps invalide (jamais de 500)", async () => {
    expect((await call(null, "GET", "/assessments")).status).toBe(401);
    const forbidden = await call("nobody", "GET", "/assessments");
    expect(forbidden.status).toBe(403);
    expect(forbidden.json).toMatchObject({ status: 403, kind: "forbidden" });
    expect((await call("teacher", "GET", `/assessments/${newId()}`)).json).toMatchObject({ status: 404, code: "assess.assessment_not_found" });
    const bad = await call("teacher", "POST", "/assessments", { title: "" });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ kind: "validation" });
    expect((await call("teacher", "GET", "/assessments/pas-un-uuid")).status).toBe(400);
  });

  it("types d'évaluation : lecture par l'enseignant, gestion réservée (sensible)", async () => {
    const list = ok(await call("teacher", "GET", "/assessment-types"));
    for (const t of list.items) assessTypeDtoSchema.parse(t);
    expect(list.items.map((t: any) => t.code)).toEqual(["DEVOIR", "EXAMEN", "TP", "PROJET"]);
    expect((await call("teacher", "POST", "/assessment-types", { code: "ORAL2", label: "Oral", aggregationGroup: "ORAL" })).status).toBe(403);
    const created = ok(await call("director", "POST", "/assessment-types", { code: "ORAL2", label: "Oral 2", aggregationGroup: "ORAL" }), 201);
    expect(created).toMatchObject({ code: "ORAL2", isSystem: false, defaultScaleMax: "20.000" });
    expect((await call("director", "POST", "/assessment-types", { code: "ORAL2", label: "Doublon", aggregationGroup: "ORAL" })).json).toMatchObject({ status: 409, code: "assess.type_duplicate" });
    const patched = ok(await call("director", "PATCH", `/assessment-types/${created.id}`, { active: false }));
    expect(patched.active).toBe(false);
  });

  it("création d'une évaluation : l'enseignant affecté la crée, un autre non (403 assess.not_assigned) ; session 2 sous feature", async () => {
    const body = { typeId: school.typeByCode("DEVOIR").id, classroomId: school.classroomId, curriculumNodeId: school.nodeId, academicPeriodId: school.periodId, title: "Devoir HTTP", assessedOn: "2026-01-10" };
    const created = ok(await call("teacher", "POST", "/assessments", body), 201);
    assessmentDtoSchema.parse(created);
    assessmentId = created.id;
    expect(created).toMatchObject({ status: "DRAFT", scaleMax: "20.000", weight: "1.000", sessionNo: 1, teacherId: school.teacher.staffId });
    expect((await call("coTeacher", "POST", "/assessments", body)).json).toMatchObject({ status: 403, code: "assess.not_assigned" });
    const exam = { ...body, typeId: school.typeByCode("EXAMEN").id, sessionNo: 2 };
    features.delete("assess.session2");
    expect((await call("teacher", "POST", "/assessments", exam)).json).toMatchObject({ status: 403, code: "entitlements.feature_not_available" });
    features.add("assess.session2");
    ok(await call("teacher", "POST", "/assessments", exam), 201);
    // session 2 sur un type qui ne l'autorise pas
    expect((await call("teacher", "POST", "/assessments", { ...body, sessionNo: 2 })).json).toMatchObject({ status: 409, code: "assess.session2_not_allowed" });
    // liste : l'enseignant ne voit que les siennes
    const mine = ok(await call("teacher", "GET", "/assessments"));
    expect(mine.items.length).toBeGreaterThan(0);
    expect(ok(await call("coTeacher", "GET", "/assessments")).items).toEqual([]);
  });

  it("saisie en lot : Idempotency-Key, rejeu sans écriture, 400 hors barème, 409 sur ligne périmée", async () => {
    const entries = school.students.map((s, i) => ({ enrollmentId: s.enrollmentId, score: [12, 15.5, 8, 18][i] }));
    const first = ok(await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries }, { "idempotency-key": "http-lot-000001" }));
    assessSaveGradesResultDtoSchema.parse(first);
    expect(first).toMatchObject({ created: 4, updated: 0, replayed: false });
    gradeIds = first.grades.map((g: any) => g.id);
    expect(first.grades[1]).toMatchObject({ score: "15.500", entryStatus: "ENTERED", rowVersion: 1, status: "DRAFT" });
    const again = ok(await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries }, { "idempotency-key": "http-lot-000001" }));
    expect(again).toMatchObject({ replayed: true });

    const over = await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: 25, rowVersion: 1 }] });
    expect(over.json).toMatchObject({ status: 400, code: "assess.score_out_of_scale" });
    const stale = await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: 13, rowVersion: 99 }] });
    expect(stale.json).toMatchObject({ status: 409, code: "assess.stale_grade" });
    const abs = ok(await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries: [{ enrollmentId: school.students[2]!.enrollmentId, entryStatus: "ABSENT_EXCUSED", rowVersion: 1 }] }));
    expect(abs.grades[0]).toMatchObject({ score: null, entryStatus: "ABSENT_EXCUSED", rowVersion: 2 });
    expect((await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries: [{ enrollmentId: school.students[2]!.enrollmentId, entryStatus: "ABSENT_EXCUSED", score: 0, rowVersion: 2 }] })).status).toBe(400);
    expect((await call("coTeacher", "PUT", `/assessments/${assessmentId}/grades`, { entries })).json).toMatchObject({ status: 403, code: "assess.not_assigned" });
    const sheet = ok(await call("teacher", "GET", `/assessments/${assessmentId}/grades`));
    assessGradeSheetDtoSchema.extend({}).parse({ assessment: sheet.assessment, grades: sheet.grades });
    expect(sheet.pending).toEqual([]);
  });

  it("circuit : chaque étape exige SA permission ; la séparation des tâches s'applique ; la publication est atomique", async () => {
    const t = (who: string, to: string, extra: object = {}) => call(who, "POST", `/assessments/${assessmentId}/transitions`, { to, ...extra });
    expect((await t("reviewer", "REVIEWED")).json).toMatchObject({ status: 409, code: "assess.invalid_transition" });
    ok(await t("teacher", "SUBMITTED"));
    expect((await t("teacher", "REVIEWED")).status).toBe(403);
    expect((await t("reviewer", "PUBLISHED")).status).toBe(403);
    expect((await t("reviewer", "DRAFT")).status).toBe(400);
    ok(await t("reviewer", "REVIEWED"));
    ok(await t("reviewer", "APPROVED"));
    expect((await t("reviewer", "PUBLISHED")).status).toBe(403);
    const published = ok(await t("director", "PUBLISHED"));
    expect(published.assessment).toMatchObject({ status: "PUBLISHED", publishedBy: school.director.userId });
    const trail = ok(await call("director", "GET", `/assessments/${assessmentId}/transitions`));
    expect(trail.items.map((x: any) => x.to)).toEqual(["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED", "PUBLISHED"]);
    // plus de saisie
    expect((await call("teacher", "PUT", `/assessments/${assessmentId}/grades`, { entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: 1, rowVersion: 1 }] })).json).toMatchObject({ status: 409, code: "assess.grade_frozen" });
  });

  it("révision par HTTP : demande (enseignant), approbation par un tiers (sensible), application, historique réservé à la direction", async () => {
    const req = ok(await call("teacher", "POST", `/grades/${gradeIds[0]}/revisions`, { newScore: 13, reason: "Erreur de report de la note de l'élève." }), 201);
    assessRevisionDtoSchema.parse(req);
    expect(req).toMatchObject({ oldScore: "12.000", newScore: "13.000", status: "REQUESTED" });
    expect((await call("teacher", "POST", `/revisions/${req.id}/approve`, {})).status).toBe(403);
    expect((await call("teacher", "GET", `/grades/${gradeIds[0]}/history`)).status).toBe(403);
    const list = ok(await call("director", "GET", "/revisions?status=REQUESTED"));
    expect(list.items.map((r: any) => r.id)).toContain(req.id);
    const done = ok(await call("director", "POST", `/revisions/${req.id}/approve`, { comment: "Vérifié sur la copie." }));
    expect(done).toMatchObject({ applied: true });
    expect(done.revisions[0]).toMatchObject({ status: "APPLIED" });
    const history = ok(await call("director", "GET", `/grades/${gradeIds[0]}/history`));
    expect(history.current.score).toBe("13.000");
    expect(history.revisions).toHaveLength(1);
  });

  it("lectures famille : l'élève voit ses notes, le tuteur celles de son enfant, jamais celles d'un autre ; mention « corrigée le »", async () => {
    const mine = ok(await call("pupil", "GET", "/me/grades"));
    assessPublishedGradesPageDtoSchema.parse(mine);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items[0]).toMatchObject({ score: "13.000" });
    expect(mine.items[0].correctedAt).not.toBeNull();
    const child = ok(await call("guardian", "GET", `/children/${school.guardian.studentId}/grades`));
    expect(child.items.length).toBe(mine.items.length);
    const other = await call("guardian", "GET", `/children/${school.students[1]!.studentId}/grades`);
    expect(other.json).toMatchObject({ status: 403, code: "assess.not_visible" });
    expect((await call("pupil", "GET", `/children/${school.guardian.studentId}/grades`)).status).toBe(403);
    expect(JSON.stringify(mine)).not.toMatch(/requestedBy|reason|decision/i);
  });

  it("réglages : lecture, mise à jour sensible, valeurs invalides refusées", async () => {
    const s = ok(await call("director", "GET", "/settings"));
    expect(s).toMatchObject({ requireSeparateReviewer: true, requireSeparateApprover: true, maxScoreDecimals: 2 });
    expect((await call("teacher", "PUT", "/settings", { maxScoreDecimals: 1 })).status).toBe(403);
    expect((await call("director", "PUT", "/settings", { maxScoreDecimals: 7 })).status).toBe(400);
    expect(ok(await call("director", "PUT", "/settings", { maxScoreDecimals: 1 })).maxScoreDecimals).toBe(1);
    ok(await call("director", "PUT", "/settings", { maxScoreDecimals: 2 }));
  });

  it("contrat d'assemblage : `setup` décore la racine, le plugin par défaut se charge avec `(app, runtime)` et des routes SANS préfixe", async () => {
    const root = Fastify({ logger: false });
    const runtime = {
      tenantDb: db.tenantDb,
      clock: world.clock,
      auditPort: world.audit,
      logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
      requirePermission: () => async () => undefined,
      entitlements: { requireFeature: () => async () => undefined },
      resolveContext: () => school.director.ctx,
    } as unknown as ModuleRuntime;
    setup(root, runtime);
    registerAssessPorts(root, world.ports as never);
    await root.register(async (scope) => assessModulePlugin(scope, runtime), { prefix: "/api/v1/assess" });
    await root.ready();
    const res = await root.inject({ method: "GET", url: "/api/v1/assess/assessment-types" });
    expect(res.statusCode).toBe(200);
    expect((await root.inject({ method: "GET", url: "/api/v1/assess/api/v1/assess/assessment-types" })).statusCode).toBe(404);
    await root.close();
  });
});
