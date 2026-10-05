/**
 * Routes `/api/v1/scheduling/autogen/*` (Fastify `inject` + Postgres réel) : permissions, fonctionnalité du plan,
 * validation Zod, 201/202, conformité des réponses au contrat, application et refus d'écraser un publié.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId } from "@ecoledigitale/kernel";
import {
  schedulingAutogenAppliedDtoSchema,
  schedulingAutogenDefaultsDtoSchema,
  schedulingAutogenRunBodySchema,
  schedulingAutogenRunDetailDtoSchema,
  schedulingAutogenStartedDtoSchema,
} from "@ecoledigitale/contracts/src/v2/scheduling";
import { schedulingPlugin } from "../../http/plugin";
import { updateSchedulingSettings } from "../../application/reference";
import { createTimetable, publishTimetable, upsertTimetableEntry } from "../../application/timetables";
import { createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { addClass, addRoom, addStaff, createWorld, unwrap, type World } from "../support/world";

describeIntegration("API HTTP du générateur d'emploi du temps", () => {
  let db: SchedulingTestDb;
  let w: World;
  let app: FastifyInstance;
  let features: Set<string>;
  let body: Record<string, unknown>;
  let teacherId: string;
  let classroomId: string;
  let nodeId: string;

  const call = async (method: "GET" | "POST", url: string, opts: { perms?: string[]; body?: unknown; query?: Record<string, string> } = {}) =>
    app.inject({
      method,
      url: `/api/v1/scheduling${url}`,
      headers: { "x-test-tenant": w.tenantId, "x-test-user": newId(), "x-test-perms": (opts.perms ?? ["schedule.read", "schedule.manage"]).join(",") },
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      ...(opts.query ? { query: opts.query } : {}),
    });

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
    features = new Set(["scheduling.generation"]);
    unwrap(await updateSchedulingSettings(w.deps, w.ctx, { institutionId: w.institutionId, patch: { openingStart: "08:00", openingEnd: "12:00", openingWeekdays: [1, 2, 3, 4, 5] } }));
    teacherId = addStaff(w, "Prof Http");
    const cls = addClass(w, "6e HTTP", { headcount: 20 });
    classroomId = cls.classroomId;
    nodeId = cls.nodeId;
    await addRoom(w, "H1", 30);
    body = {
      institutionId: w.institutionId,
      academicYearId: w.yearId,
      name: "Proposition HTTP",
      validFrom: "2026-09-07",
      validTo: "2027-01-29",
      seed: "http",
      maxIterations: 500,
      requirements: [{ classroomId, curriculumNodeId: nodeId, sessionsPerWeek: 3, teacherIds: [teacherId] }],
    };
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: typeof user === "string" ? user : newId(), roles: [], institutionId: w.institutionId });
      }
    });
    await app.register(schedulingPlugin, {
      deps: w.deps,
      prefix: "/api/v1/scheduling",
      requirePermission: (permission) => async (req) => {
        const ctx = (req as unknown as { ctx?: unknown }).ctx;
        if (!ctx) throw new UnauthorizedError();
        if (!String(req.headers["x-test-perms"] ?? "").split(",").includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      requireFeature: (feature) => async (_req, reply) => {
        if (!features.has(feature)) return reply.status(403).send({ status: 403, code: "entitlements.feature_not_available", kind: "forbidden", message: "Fonctionnalité non incluse." });
        return undefined;
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("le contrat accepte le corps de test et applique ses valeurs par défaut", () => {
    const parsed = schedulingAutogenRunBodySchema.parse(body);
    expect(parsed).toMatchObject({ timeLimitSeconds: 20, maxIterations: 500, mode: "AUTO", deriveTeachers: false });
    expect(parsed.requirements[0]).toMatchObject({ sessionPeriods: 1, needsRoom: true, features: [] });
    expect(schedulingAutogenRunBodySchema.safeParse({ ...body, validTo: "2026-01-01" }).success).toBe(false);
  });

  it("permissions et fonctionnalité du plan", async () => {
    expect((await call("POST", "/autogen/runs", { perms: ["schedule.read"], body })).statusCode).toBe(403);
    expect((await call("GET", "/autogen/runs", { perms: [] })).statusCode).toBe(403);
    features.delete("scheduling.generation");
    const refused = await call("POST", "/autogen/runs", { body });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("entitlements.feature_not_available");
    // La lecture des propositions reste ouverte.
    expect((await call("GET", "/autogen/runs")).statusCode).toBe(200);
    features.add("scheduling.generation");
    const unauth = await app.inject({ method: "GET", url: "/api/v1/scheduling/autogen/runs" });
    expect(unauth.statusCode).toBe(401);
  });

  it("défauts, lancement (201 calculé / 202 en file), détail, application et refus d'écraser un publié", async () => {
    const defaults = await call("GET", "/autogen/defaults", { query: { institutionId: w.institutionId } });
    expect(defaults.statusCode).toBe(200);
    schedulingAutogenDefaultsDtoSchema.parse(defaults.json());

    const invalid = await call("POST", "/autogen/runs", { body: { ...body, requirements: [] } });
    expect(invalid.statusCode).toBe(400);

    const started = await call("POST", "/autogen/runs", { body: { ...body, mode: "SYNC" } });
    expect(started.statusCode).toBe(201);
    const run = schedulingAutogenStartedDtoSchema.parse(started.json());
    expect(run.run.status).toBe("COMPLETED");

    const queued = await call("POST", "/autogen/runs", { body: { ...body, mode: "ASYNC", seed: "http-async" } });
    expect(queued.statusCode).toBe(202);
    expect(schedulingAutogenStartedDtoSchema.parse(queued.json()).run.status).toBe("QUEUED");

    const detail = schedulingAutogenRunDetailDtoSchema.parse((await call("GET", `/autogen/runs/${run.run.id}`)).json());
    expect(detail.result?.placements).toHaveLength(3);
    expect(detail.result?.grid.periods).toHaveLength(4);
    expect((await call("GET", `/autogen/runs/${newId()}`)).statusCode).toBe(404);
    const list = (await call("GET", "/autogen/runs", { query: { status: "QUEUED" } })).json();
    expect(list.items).toHaveLength(1);

    // Un emploi du temps publié existe : il n'est jamais la cible, mais un nouveau brouillon est créé à côté.
    const published = unwrap(await createTimetable(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: w.yearId, name: "Publié HTTP", validFrom: "2026-09-07", validTo: "2027-01-29" }));
    unwrap(await upsertTimetableEntry(w.deps, w.ctx, { timetableId: published.id, kind: "LESSON", classroomId, curriculumNodeId: nodeId, weekday: 3, startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacherId, role: "LEAD" }] }));
    unwrap(await publishTimetable(w.deps, w.ctx, { timetableId: published.id }));
    const refusal = await call("POST", `/autogen/runs/${run.run.id}/apply`, { body: { mode: "REPLACE_DRAFT", targetTimetableId: published.id, confirmReplace: true } });
    expect(refusal.statusCode).toBe(409);
    expect(refusal.json().code).toBe("scheduling.autogen_would_overwrite_published");
    const noConfirm = await call("POST", `/autogen/runs/${run.run.id}/apply`, { body: { mode: "REPLACE_DRAFT", targetTimetableId: newId() } });
    expect(noConfirm.statusCode).toBe(404);

    const applied = schedulingAutogenAppliedDtoSchema.parse((await call("POST", `/autogen/runs/${run.run.id}/apply`, { body: { name: "Brouillon HTTP" } })).json());
    expect(applied).toMatchObject({ entriesCreated: 3, entriesReplaced: 0, timetable: { status: "DRAFT", name: "Brouillon HTTP" }, publishedTimetable: { id: published.id } });
    expect((await call("POST", `/autogen/runs/${run.run.id}/apply`, { body: {} })).statusCode).toBe(409);

    const discarded = await call("POST", `/autogen/runs/${queued.json().run.id}/discard`, { body: { reason: "test" } });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.json().status).toBe("DISCARDED");
  });
});
