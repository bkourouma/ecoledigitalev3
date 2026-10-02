/**
 * API HTTP /api/v1/schoollife/* (Fastify + Postgres réel). L'authentification est simulée en amont (`request.ctx`) : le module
 * ne lit jamais d'identité dans la requête. Les permissions sont celles du manifeste, évaluées par une garde de test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, type RequestContext } from "@ecoledigitale/kernel";
import { schoollifeEventPayloadSchemas, schoollifeFamilyLifeDtoSchema, schoollifeIncidentDtoSchema, schoollifeMeasureDtoSchema, schoollifeStudentLifeDtoSchema } from "@ecoledigitale/contracts/src/v2/schoollife";
import manifest from "../../manifest";
import { schoollifePlugin } from "../../http/plugin";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { makeWorld, type TestWorld } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);
const TEACHER = ["schoollife.read", "schoollife.incident.write", "schoollife.note.write"];
const EDUCATOR = ["schoollife.read", "schoollife.read.all", "schoollife.incident.write", "schoollife.incident.review", "schoollife.measure.propose", "schoollife.note.write", "schoollife.convocation.manage"];
const PARENT = ["schoollife.child.read", "schoollife.child.appeal", "schoollife.child.acknowledge"];
const PUPIL = ["schoollife.self.read", "schoollife.self.appeal"];

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/schoollife/* (Fastify + Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  let app: FastifyInstance;
  const identities = new Map<string, Who>();
  const features = new Set(["schoollife.core", "schoollife.conduct-points", "schoollife.convocations"]);

  const call = async (who: string | null, method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1/schoollife${url}`, headers: who ? { "x-test-identity": who } : {}, ...(body !== undefined ? { payload: body as never } : {}) });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, json, headers: res.headers };
  };

  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
    identities.set("teacher", { ctx: w.teacher.ctx, perms: TEACHER });
    identities.set("otherTeacher", { ctx: w.otherTeacher.ctx, perms: TEACHER });
    identities.set("educator", { ctx: w.educator.ctx, perms: EDUCATOR });
    identities.set("director", { ctx: w.director.ctx, perms: ALL });
    identities.set("director2", { ctx: w.director2.ctx, perms: ALL });
    identities.set("parent", { ctx: w.guardian.ctx, perms: PARENT });
    identities.set("otherParent", { ctx: w.otherGuardian.ctx, perms: PARENT });
    identities.set("pupil", { ctx: w.pupil.ctx, perms: PUPIL });
    identities.set("system", { ctx: w.systemCtx(), perms: ALL });
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const id = req.headers["x-test-identity"];
      const who = typeof id === "string" ? identities.get(id) : undefined;
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const requirePermission = (permission: string) =>
      async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
        const id = req.headers["x-test-identity"];
        const who = typeof id === "string" ? identities.get(id) : undefined;
        if (!who) throw new UnauthorizedError();
        if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      };
    await app.register(
      async (scope) => {
        await scope.register(schoollifePlugin, {
          deps: w.deps,
          requirePermission,
          requireFeature: (feature: string) =>
            async function gate() {
              if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
            },
        });
      },
      { prefix: "/api/v1/schoollife" },
    );
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  const student = () => w.students[0]!;

  it("401 sans identité, 403 sans permission (code stable), réponses jamais mises en cache", async () => {
    expect((await call(null, "GET", "/incidents")).status).toBe(401);
    const denied = await call("teacher", "POST", "/measures", { enrollmentId: student().enrollmentId, typeId: w.types.WARN, reason: "Motif valable" });
    expect(denied.status).toBe(403);
    const ok = await call("teacher", "GET", "/incidents");
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(denied.headers["cache-control"]).toBe("no-store");
  });

  it("entrées strictes : 400 avec les champs fautifs ; identifiant non UUID refusé ; champ inconnu refusé (aucun champ « déclarant » accepté)", async () => {
    const bad = await call("educator", "POST", "/measures", { enrollmentId: "pas-un-uuid", typeId: w.types.WARN, reason: "x" });
    expect(bad.status).toBe(400);
    expect(bad.json.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(["enrollmentId", "reason"]);
    const spoof = await call("educator", "POST", "/measures", { enrollmentId: student().enrollmentId, typeId: w.types.WARN, reason: "Motif valable", proposedBy: w.director.userId });
    expect(spoof.status).toBe(400);
    expect((await call("educator", "GET", "/measures/pas-un-uuid")).status).toBe(400);
  });

  it("parcours : l'enseignant déclare, l'éducateur propose, la direction valide ; quatre yeux ; contrat de réponse", async () => {
    const inc = await call("teacher", "POST", "/incidents", { typeId: w.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Altercation dans la cour", involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR" }] });
    expect(inc.status).toBe(201);
    schoollifeIncidentDtoSchema.parse(inc.json);
    expect((await call("otherTeacher", "POST", "/incidents", { typeId: w.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Hors classe", involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR" }] })).status).toBe(404);
    expect((await call("teacher", "POST", `/incidents/${inc.json.id}/review`, {})).status).toBe(403); // instruction : permission dédiée

    const m = await call("educator", "POST", "/measures", { enrollmentId: student().enrollmentId, typeId: w.types.SANC, incidentId: inc.json.id, reason: "Comportement répété en classe" });
    expect(m.status).toBe(201);
    schoollifeMeasureDtoSchema.parse(m.json);
    expect(m.json).toMatchObject({ status: "PROPOSED", proposedBy: w.educator.userId });
    expect((await call("educator", "POST", `/measures/${m.json.id}/validate`, {})).status).toBe(403); // pas de permission de valider
    // la direction qui a proposé ne valide pas sa propre proposition
    const own = await call("director", "POST", "/measures", { enrollmentId: student().enrollmentId, typeId: w.types.SANC, reason: "Proposition de la direction" });
    const fourEyes = await call("director", "POST", `/measures/${own.json.id}/validate`, {});
    expect(fourEyes.status).toBe(403);
    expect(fourEyes.json.code).toBe("schoollife.four_eyes_required");
    const v = await call("director2", "POST", `/measures/${m.json.id}/validate`, { note: "Faits établis" });
    expect(v.status).toBe(200);
    expect(v.json.status).toBe("VALIDATED");
    expect((await call("director2", "POST", `/measures/${m.json.id}/notify`, {})).json.status).toBe("NOTIFIED");
    const life = await call("educator", "GET", `/students/${student().studentId}/life`);
    expect(life.status).toBe(200);
    schoollifeStudentLifeDtoSchema.parse(life.json);
    expect(life.json.attendance).toMatchObject({ available: true });
    // une propriété de requête ne peut pas se substituer à l'utilisateur de la session
    expect(life.json.measures.find((x: { id: string }) => x.id === m.json.id).proposedBy).toBe(w.educator.userId);
  });

  it("l'humain décide : un contexte non humain est refusé par le module et par la base (403 `human_actor_required`)", async () => {
    const r = await call("system", "POST", "/notes", { enrollmentId: student().enrollmentId, typeId: w.types.ENC, body: "Bravo", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("schoollife.human_actor_required");
  });

  it("portails : le parent lit ses enfants (404 hors lien), l'élève lui-même ; contrat famille", async () => {
    const mine = await call("parent", "GET", `/children/${student().studentId}/life`);
    expect(mine.status).toBe(200);
    const parsed = schoollifeFamilyLifeDtoSchema.parse(mine.json);
    expect(parsed.items.every((i) => i.entityKind !== ("INCIDENT" as never))).toBe(true);
    expect(JSON.stringify(mine.json)).not.toMatch(/Altercation|proposedBy|validatedBy|Faits établis|Proposition de la direction/); // incident, note de validation et mesure non notifiée jamais visibles
    expect((await call("otherParent", "GET", `/children/${student().studentId}/life`)).status).toBe(404);
    expect((await call("parent", "GET", `/children/${w.outsiderStudent.studentId}/life`)).status).toBe(404);
    expect((await call("teacher", "GET", `/children/${student().studentId}/life`)).status).toBe(403);
    expect((await call("pupil", "GET", "/me/life")).status).toBe(200);
    expect((await call("parent", "GET", "/me/life")).status).toBe(403);
    const children = await call("parent", "GET", "/me/children");
    expect(children.json.items).toEqual([{ studentId: student().studentId, studentName: student().name }]);
  });

  it("lecture confidentielle : permission dédiée, motif exigé, journal consultable seulement par la permission d'audit", async () => {
    const secret = await call("educator", "POST", "/notes", { enrollmentId: student().enrollmentId, typeId: w.types.SECRET_OBS, body: "Information protégée", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" });
    expect(secret.status).toBe(201);
    expect((await call("educator", "POST", "/confidential-reads", { entityKind: "NOTE", entityId: secret.json.id, purpose: "Instruction du dossier" })).status).toBe(403);
    expect((await call("director", "POST", "/confidential-reads", { entityKind: "NOTE", entityId: secret.json.id })).json.code).toBe("schoollife.purpose_required");
    const read = await call("director", "POST", "/confidential-reads", { entityKind: "NOTE", entityId: secret.json.id, purpose: "Instruction du dossier" });
    expect(read.status).toBe(200);
    expect(read.json.note.body).toBe("Information protégée");
    const journal = await call("director", "GET", `/confidential-reads?entityId=${secret.json.id}`);
    expect(journal.json.items).toHaveLength(1);
    expect((await call("educator", "GET", "/confidential-reads")).status).toBe(403);
  });

  it("features : sans `schoollife.convocations` la route est refusée ; sans `schoollife.core` tout est refusé", async () => {
    features.delete("schoollife.convocations");
    const r = await call("educator", "GET", "/convocations");
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("entitlements.feature_not_available");
    features.add("schoollife.convocations");
    expect((await call("educator", "GET", "/convocations")).status).toBe(200);
    features.delete("schoollife.core");
    expect((await call("educator", "GET", "/incidents")).status).toBe(403);
    features.add("schoollife.core");
  });

  it("paramètres : types d'événements en données, circuit imposé par le type, refus d'une incohérence", async () => {
    const bad = await call("director", "PUT", "/event-types", { code: "EXCL_BAD", label: "Exclusion sans validation", kind: "TEMP_EXCLUSION", requiresValidation: false });
    expect(bad.status).toBe(400);
    const good = await call("director", "PUT", "/event-types", { code: "RETARD_DEMO", label: "Type de démonstration", kind: "WARNING", isPlaceholder: true });
    expect(good.status).toBe(200);
    expect((await call("educator", "PUT", "/event-types", { code: "X", label: "x", kind: "WARNING" })).status).toBe(403);
    const list = await call("educator", "GET", "/event-types");
    expect(list.json.items.some((t: { code: string }) => t.code === "RETARD_DEMO")).toBe(true);
  });

  it("événements écrits : charge conforme au contrat versionné", async () => {
    const rows = await db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE type LIKE 'schoollife.%'");
    expect(rows.rows.length).toBeGreaterThan(3);
    for (const r of rows.rows as Array<{ type: string; payload: unknown }>) {
      const schema = (schoollifeEventPayloadSchemas as Record<string, { parse: (v: unknown) => unknown }>)[r.type];
      expect(schema, `contrat de ${r.type}`).toBeDefined();
      expect(() => schema!.parse(r.payload), r.type).not.toThrow();
    }
  });
});
