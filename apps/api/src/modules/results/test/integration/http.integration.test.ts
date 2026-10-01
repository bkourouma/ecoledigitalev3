/**
 * API HTTP /api/v1/results/* (Fastify inject + Postgres réel + VRAIES règles) : 401/403/404/400/409, cycle complet d'une période
 * (calcul → surcharge à quatre yeux → verrouillage → clôture → réouverture), garde de fonctionnalité, lecture famille, DTO conformes
 * aux schémas partagés de `packages/contracts`.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, newId, type RequestContext } from "@ecoledigitale/kernel";
import {
  resultsClassMatrixDtoSchema,
  resultsDecisionDtoSchema,
  resultsEnrollmentResultDtoSchema,
  resultsFamilyResultDtoSchema,
  resultsOverrideDtoSchema,
  resultsSettingsDtoSchema,
  resultsStateDtoSchema,
  resultsYearResultDtoSchema,
} from "@ecoledigitale/contracts/src/v2/results";
import manifest from "../../manifest";
import { resultsPlugin } from "../../http/plugin";
import type { EnrollmentRef } from "../../domain/types";
import { createResultsTestDb, ctxFor, describeIntegration, type ResultsTestDb } from "../support/db";
import { bind, creditStructure, grade, makeWorld, period, type World } from "../support/world";

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/results/* (Fastify + Postgres réel + règles réelles)", () => {
  let db: ResultsTestDb;
  let w: World;
  let app: FastifyInstance;
  const identities = new Map<string, Who>();
  const features = new Set<string>();

  const classroomId = newId();
  const yearId = newId();
  const p = period(newId());
  const built = creditStructure({ classroomId, yearId, period: p, ues: [{ code: "UE1", ecues: [{ code: "E1", credits: "4" }, { code: "E2", credits: "4" }] }] });
  const id = (c: string): string => built.ids.get(c) as string;
  let students: EnrollmentRef[];
  const ALL = manifest.permissions.map((x) => x.key);
  const base = `/classrooms/${classroomId}/periods/${p.id}`;

  const call = async (who: string | null, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1/results${url}`, headers: who ? { "x-test-identity": who } : {}, ...(body !== undefined ? { payload: body as never } : {}) });
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
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    w.curriculum.set(built.structure);
    students = Array.from({ length: 3 }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const s of students) w.roster.entries.push({ ...s, active: true, classroomId });
    const pair = (e: EnrollmentRef, node: string, dev: string, exam: string) => [grade(e.enrollmentId, id(node), dev), grade(e.enrollmentId, id(node), exam, { aggregationGroup: "EXAM" })];
    w.assess.grades = [...pair(students[0]!, "E1", "14", "14"), ...pair(students[0]!, "E2", "13", "13"), ...pair(students[1]!, "E1", "16", "16"), ...pair(students[1]!, "E2", "4", "4"), ...pair(students[2]!, "E1", "11", "11"), ...pair(students[2]!, "E2", "11", "11")];

    const pupilUser = newId();
    const guardianUser = newId();
    w.guardianship.studentByUser.set(pupilUser, students[0]!.studentId);
    w.guardianship.links.add(`${guardianUser}|${students[0]!.studentId}`);
    w.names.staff.set(w.director.userId as string, newId());
    identities.set("director", { ctx: w.director, perms: ALL });
    identities.set("second", { ctx: w.second, perms: ALL });
    identities.set("reader", { ctx: ctxFor(w.tenantId, newId(), ["enseignant"], false), perms: ["result.read", "result.explain"] });
    identities.set("pupil", { ctx: ctxFor(w.tenantId, pupilUser, ["eleve"], false), perms: ["result.self.read"] });
    identities.set("guardian", { ctx: ctxFor(w.tenantId, guardianUser, ["parent"], false), perms: ["result.child.read"] });
    identities.set("nobody", { ctx: ctxFor(w.tenantId, newId(), ["x"], false), perms: [] });

    app = Fastify({ logger: false });
    const whoOf = (req: FastifyRequest): Who | undefined => {
      const k = req.headers["x-test-identity"];
      return typeof k === "string" ? identities.get(k) : undefined;
    };
    await app.register(resultsPlugin, {
      deps: w.deps,
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
      prefix: "/api/v1/results",
    } as never);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("401 sans contexte, 403 sans permission, 404 sans état de période, 400 corps ou paramètres invalides (jamais de 500)", async () => {
    expect((await call(null, "GET", base)).status).toBe(401);
    const denied = await call("nobody", "GET", base);
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ status: 403, kind: "forbidden" });
    expect((await call("reader", "GET", base)).json).toMatchObject({ status: 404, code: "results.state_not_found" });
    expect((await call("reader", "GET", `/enrollments/${newId()}/periods/${p.id}`)).json).toMatchObject({ status: 404, code: "results.result_not_found" });
    expect((await call("director", "POST", "/recompute", { classroomId: "pas-un-uuid" })).status).toBe(400);
    expect((await call("director", "GET", "/classrooms/x/periods/y")).status).toBe(400);
    expect((await call("director", "POST", `${base}/lock`, { force: true })).json).toMatchObject({ status: 400, kind: "validation" });
  });

  it("recalcul manuel (droit requis) puis lecture de la matrice : DTO conformes au contrat partagé, valeurs exactes issues des règles", async () => {
    expect((await call("reader", "POST", "/recompute", { classroomId, periodId: p.id })).status).toBe(403);
    const report = ok(await call("director", "POST", "/recompute", { classroomId, periodId: p.id }));
    expect(report).toMatchObject({ computed: 3, created: 3, errors: 0, contractId: "credit-semester@1" });

    const matrix = resultsClassMatrixDtoSchema.parse(ok(await call("reader", "GET", `${base}?lines=true`)));
    expect(matrix.state).toMatchObject({ status: "OPEN", ruleSetCode: "CI-HIGHER-LMD", scope: "PERIOD" });
    expect(matrix.rows).toHaveLength(3);
    const a = matrix.rows.find((r) => r.header.enrollmentId === students[0]!.enrollmentId)!;
    expect(a.header).toMatchObject({ status: "DRAFT", average: "13.5", decisionCode: "ADMITTED", validated: true, rank: 1, cohortSize: 3 });
    expect(a.lines.find((l) => l.level === "UE")).toMatchObject({ value: "13.5", validated: true });
    // sans `lines=true` : en-têtes seuls
    const light = resultsClassMatrixDtoSchema.parse(ok(await call("reader", "GET", base)));
    expect(light.rows.every((r) => r.lines.length === 0)).toBe(true);

    const one = resultsEnrollmentResultDtoSchema.parse(ok(await call("reader", "GET", `/enrollments/${students[1]!.enrollmentId}/periods/${p.id}`)));
    expect(one.header.validated).toBe(false);
    expect(one.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E2"))).toMatchObject({ statusCode: "ELIMINATORY", value: "4" });
  });

  it("explicabilité : `result.explain` requis ; un brouillon est expliqué par rejeu", async () => {
    const header = resultsEnrollmentResultDtoSchema.parse(ok(await call("reader", "GET", `/enrollments/${students[1]!.enrollmentId}/periods/${p.id}`))).header;
    expect((await call("pupil", "GET", `/results/${header.id}/explain`)).status).toBe(403);
    const ex = ok(await call("reader", "GET", `/results/${header.id}/explain`));
    expect(ex.source).toBe("REPLAY");
    expect(ex.lines.length).toBeGreaterThan(0);
    expect((await call("reader", "GET", `/results/${newId()}/explain`)).status).toBe(404);
  });

  let overrideId: string;
  let stateId: string;
  it("surcharge de validation : 400 si motif trop court, 201, quatre yeux (409), approbation par un tiers (200), effet au recalcul", async () => {
    stateId = resultsStateDtoSchema.parse(ok(await call("reader", "GET", `${base}/state`)).state).id;
    const body = { stateId, enrollmentId: students[1]!.enrollmentId, level: "ECUE", curriculumNodeId: id("E2"), ruleKey: "ecue_validee", kind: "VALIDATION", flag: true, justification: "Le jury valide l'ECUE après examen de la copie de l'étudiant." };
    expect((await call("director", "POST", "/overrides", { ...body, justification: "court" })).status).toBe(400);
    expect((await call("reader", "POST", "/overrides", body)).status).toBe(403);
    const created = resultsOverrideDtoSchema.parse(ok(await call("director", "POST", "/overrides", body), 201));
    overrideId = created.id;
    expect(created).toMatchObject({ status: "REQUESTED", kind: "VALIDATION", overrideFlag: true });
    expect((await call("director", "POST", "/overrides", body)).json).toMatchObject({ status: 409, code: "results.override_duplicate" });
    expect((await call("director", "POST", `/overrides/${overrideId}/approve`, {})).json).toMatchObject({ status: 409, code: "results.four_eyes" });
    const approved = resultsOverrideDtoSchema.parse(ok(await call("second", "POST", `/overrides/${overrideId}/approve`, { comment: "Conforme au PV du jury." })));
    expect(approved.status).toBe("APPROVED");
    ok(await call("director", "POST", "/recompute", { classroomId, periodId: p.id }));
    const b = resultsEnrollmentResultDtoSchema.parse(ok(await call("reader", "GET", `/enrollments/${students[1]!.enrollmentId}/periods/${p.id}`)));
    expect(b.header.validated).toBe(true);
    expect(b.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E2"))).toMatchObject({ overridden: true, validated: true });
    expect((await call("reader", "GET", `/overrides?stateId=${stateId}`)).status).toBe(403); // la liste des surcharges est réservée à qui les demande ou les approuve
    const listed = ok(await call("second", "GET", `/overrides?stateId=${stateId}&status=APPROVED`));
    expect(listed.items.map((o: { id: string }) => o.id)).toEqual([overrideId]);
  });

  it("verrouillage : des évaluations non publiées bloquent (409 avec la liste) ; forcé avec motif (110), puis idempotent", async () => {
    w.assess.pending = [{ assessmentId: newId(), title: "Devoir non publié", status: "DRAFT", teacherId: null } as never];
    const blocked = await call("director", "POST", `${base}/lock`, {});
    expect(blocked.json).toMatchObject({ status: 409, code: "results.pending_assessments" });
    w.assess.pending = [];
    const locked = resultsStateDtoSchema.parse(ok(await call("director", "POST", `${base}/lock`, {})));
    expect(locked.status).toBe("GRADING_LOCKED");
    expect(resultsStateDtoSchema.parse(ok(await call("director", "POST", `${base}/lock`, {}))).status).toBe("GRADING_LOCKED");
    expect(w.assess.locks.get(`${classroomId}:${p.id}`)).toEqual([1, 2]);
  });

  it("délibération : fonctionnalité `results.deliberation` requise (403), séance tenue requise (409), clôture avec délibération obligatoire (409)", async () => {
    expect((await call("director", "POST", `${base}/deliberate`, {})).json).toMatchObject({ status: 403, code: "entitlements.feature_not_available" });
    features.add("results.deliberation");
    expect((await call("director", "POST", `${base}/deliberate`, {})).json).toMatchObject({ status: 409, code: "results.deliberation_required" });
    expect((await call("director", "POST", `${base}/close`, {})).json).toMatchObject({ status: 409, code: "results.deliberation_required" });
    const settings = resultsSettingsDtoSchema.parse(ok(await call("reader", "GET", "/settings")));
    expect(settings.requireDeliberation).toBe(true);
    expect((await call("reader", "PUT", "/settings", { requireDeliberation: false })).status).toBe(403);
    expect(resultsSettingsDtoSchema.parse(ok(await call("director", "PUT", "/settings", { requireDeliberation: false }))).requireDeliberation).toBe(false);
  });

  it("clôture : résultats FINAL, hash de clôture, état CLOSED ; une seconde clôture est refusée (409) ; un recalcul est bloqué", async () => {
    const closed = ok(await call("director", "POST", `${base}/close`, {}));
    expect(closed).toMatchObject({ resultsCount: 3, resultsVersion: 1, withoutDeliberation: true });
    expect(closed.closureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(resultsStateDtoSchema.parse(closed.state).status).toBe("CLOSED");
    expect((await call("director", "POST", `${base}/close`, {})).json).toMatchObject({ status: 409 });
    const matrix = resultsClassMatrixDtoSchema.parse(ok(await call("reader", "GET", base)));
    expect(matrix.rows.every((r) => r.header.status === "FINAL" && r.header.finalizedAt !== null)).toBe(true);
    // l'année (une seule période requise ici) est complète : moyenne annuelle = celle du semestre, via les règles de l'étape « année »
    const year = resultsYearResultDtoSchema.parse(ok(await call("reader", "GET", `/enrollments/${students[0]!.enrollmentId}/years/${yearId}`)));
    expect(year).toMatchObject({ complete: true, contractId: "credit-semester@1", rank: 1, cohortSize: 3, ruleSetCode: "CI-HIGHER-LMD" });
    expect(year.average).toBe("13.5");
    expect((await call("nobody", "GET", `/enrollments/${students[0]!.enrollmentId}/years/${yearId}`)).status).toBe(403);
    expect((await call("reader", "GET", `/enrollments/${newId()}/years/${yearId}`)).status).toBe(404);
    // une surcharge sur une période clôturée est refusée
    const late = await call("director", "POST", "/overrides", { stateId, enrollmentId: students[2]!.enrollmentId, level: "UE", curriculumNodeId: id("UE1"), ruleKey: "moyenne_ue", kind: "VALUE", value: "15", justification: "Correction demandée après la clôture de la période." });
    expect(late.json).toMatchObject({ status: 409, code: "results.state_closed" });
  });

  it("lecture famille : fonctionnalité requise ; l'élève voit ses résultats FINAL, le tuteur ceux de ses enfants seulement", async () => {
    expect((await call("pupil", "GET", "/me/results")).json).toMatchObject({ status: 403, code: "entitlements.feature_not_available" });
    features.add("results.public-visibility");
    const mine = ok(await call("pupil", "GET", "/me/results"));
    expect(mine.items).toHaveLength(1);
    resultsFamilyResultDtoSchema.parse(mine.items[0]);
    expect(JSON.stringify(mine)).not.toMatch(/inputs|trace|override|justification|inputsHash/i);
    expect((await call("guardian", "GET", `/children/${students[0]!.studentId}/results`)).json.items).toHaveLength(1);
    expect((await call("guardian", "GET", `/children/${students[1]!.studentId}/results`)).status).toBe(403);
    expect((await call("guardian", "GET", "/me/results")).status).toBe(403);
    expect((await call("nobody", "GET", "/me/results")).status).toBe(403);
  });

  it("réouverture : droit sensible, motif obligatoire (400), CORRECTION → OPEN ; les FINAL restent consultables (version 1)", async () => {
    expect((await call("reader", "POST", `${base}/reopen`, { reason: "Erreur de saisie constatée en conseil." })).status).toBe(403);
    expect((await call("director", "POST", `${base}/reopen`, { reason: "court" })).status).toBe(400);
    const reopened = resultsStateDtoSchema.parse(ok(await call("director", "POST", `${base}/reopen`, { kind: "CORRECTION", reason: "Erreur de saisie constatée en conseil de classe." })));
    expect(reopened).toMatchObject({ status: "OPEN", reopenCount: 1, lastReopenKind: "CORRECTION" });
    expect(w.assess.locks.has(`${classroomId}:${p.id}`)).toBe(false);
    const pageDecisions = ok(await call("director", "GET", `/decisions?stateId=${stateId}`));
    for (const d of pageDecisions.items) resultsDecisionDtoSchema.parse(d);
  });

  it("contrat de plugin : les 15 permissions du manifeste sont exactement celles que la couche HTTP exige", async () => {
    const used = new Set<string>();
    const spy = Fastify({ logger: false });
    await spy.register(resultsPlugin, {
      deps: w.deps,
      requirePermission: (permission: string) => {
        used.add(permission);
        return async () => undefined;
      },
      requireFeature: () => async () => undefined,
      resolveContext: () => w.director,
    } as never);
    await spy.ready();
    await spy.close();
    expect([...used].sort()).toEqual(manifest.permissions.map((x) => x.key).sort());
  });
});
