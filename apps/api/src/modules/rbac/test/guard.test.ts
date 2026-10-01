import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock, createRequestContext, createSystemContext, noopLogger, toErrorBody, type RequestContext } from "@ecoledigitale/kernel";
import {
  TENANT_SCOPE,
  buildPermissionSet,
  campusScope,
  grantedScopes,
  institutionScope,
  loadAuthorization,
  requirePermission,
  scopeTreeFromPairs,
  type PermissionSet,
  type RbacRuntime,
  type ScopeRef,
} from "../index";
import { CAMPUS_A1, CAMPUS_A2, INST_A, NOW, T1, U1, U2 } from "./fixtures";

interface GrantSpec {
  permissions: string[];
  scope?: ScopeRef;
  validUntil?: string;
}

function setFor(userId: string, grants: GrantSpec[], sensitive: string[] = []): PermissionSet {
  return buildPermissionSet({
    tenantId: T1,
    userId,
    assignments: grants.map((g, i) => ({
      assignmentId: `a${i}`,
      roleId: `r${i}`,
      scope: g.scope ?? TENANT_SCOPE,
      validFrom: null,
      validUntil: g.validUntil ? new Date(g.validUntil) : null,
    })),
    rolePermissions: new Map(grants.map((g, i) => [`r${i}`, g.permissions])),
    sensitive,
    now: NOW,
  });
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

interface Harness {
  app: FastifyInstance;
  loads: { count: number };
}

async function harness(options: {
  sets: Record<string, PermissionSet>;
  ctxFor: (req: FastifyRequest) => RequestContext | undefined;
  withRuntime?: boolean;
  routes: (app: FastifyInstance) => void;
}): Promise<Harness> {
  const app = Fastify();
  apps.push(app);
  const loads = { count: 0 };
  if (options.withRuntime !== false) {
    const runtime: RbacRuntime = {
      permissions: {
        get: async (ctx) => {
          loads.count += 1;
          return options.sets[ctx.userId as string] ?? setFor(ctx.userId as string, []);
        },
      },
      scopeTrees: { forTenant: async () => scopeTreeFromPairs({ [CAMPUS_A1]: INST_A, [CAMPUS_A2]: INST_A }) },
      clock: new ManualClock(NOW),
      logger: noopLogger,
    };
    app.decorate("rbac", runtime);
  }
  app.addHook("onRequest", async (req) => {
    const ctx = options.ctxFor(req);
    if (ctx) (req as unknown as { ctx: RequestContext }).ctx = ctx;
  });
  app.setErrorHandler((error, req, reply) => {
    const body = toErrorBody(error, req.id);
    void reply.status(body.status).send(body);
  });
  options.routes(app);
  await app.ready();
  return { app, loads };
}

const userCtx = (userId = U1, mfa = false, extra: { campusId?: string; institutionId?: string } = {}): RequestContext =>
  createRequestContext({ tenantId: T1, userId, mfa, ...extra });

const headerCtx = (req: FastifyRequest): RequestContext | undefined => {
  const user = req.headers["x-user"];
  if (!user) return undefined;
  const campus = req.headers["x-campus"];
  return userCtx(String(user), req.headers["x-mfa"] === "1", campus ? { campusId: String(campus), institutionId: INST_A } : {});
};

describe("requirePermission — garde Fastify", () => {
  it("401 sans request.ctx", async () => {
    const { app } = await harness({
      sets: {},
      ctxFor: () => undefined,
      routes: (a) => a.get("/x", { preHandler: requirePermission("grade.read") }, async () => ({ ok: true })),
    });
    const res = await app.inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("403 FORBIDDEN par défaut (aucune assignation) et 200 avec la permission", async () => {
    const { app } = await harness({
      sets: { [U2]: setFor(U2, [{ permissions: ["grade.read"] }]) },
      ctxFor: headerCtx,
      routes: (a) => a.get("/x", { preHandler: requirePermission("grade.read") }, async () => ({ ok: true })),
    });
    const denied = await app.inject({ method: "GET", url: "/x", headers: { "x-user": U1 } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "FORBIDDEN", kind: "forbidden", details: { permission: "grade.read" } });
    const allowed = await app.inject({ method: "GET", url: "/x", headers: { "x-user": U2 } });
    expect(allowed.statusCode).toBe(200);
  });

  it("une autre permission du même utilisateur ne suffit pas", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["grade.read"] }]) },
      ctxFor: headerCtx,
      routes: (a) => a.post("/x", { preHandler: requirePermission("grade.enter") }, async () => ({ ok: true })),
    });
    expect((await app.inject({ method: "POST", url: "/x", headers: { "x-user": U1 } })).statusCode).toBe(403);
  });

  it("permission sensible : 403 rbac.mfa_required sans MFA, 200 avec", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["grade.publish"] }], ["grade.publish"]) },
      ctxFor: headerCtx,
      routes: (a) => a.post("/publish", { preHandler: requirePermission("grade.publish") }, async () => ({ ok: true })),
    });
    const noMfa = await app.inject({ method: "POST", url: "/publish", headers: { "x-user": U1 } });
    expect(noMfa.statusCode).toBe(403);
    expect(noMfa.json()).toMatchObject({ code: "rbac.mfa_required", kind: "forbidden" });
    const withMfa = await app.inject({ method: "POST", url: "/publish", headers: { "x-user": U1, "x-mfa": "1" } });
    expect(withMfa.statusCode).toBe(200);
  });

  it("l'expiration est évaluée à l'instant de la requête, même sur un set en cache", async () => {
    const clock = new ManualClock(NOW);
    const set = setFor(U1, [{ permissions: ["grade.read"], validUntil: "2026-10-01T12:30:00.000Z" }]);
    const app = Fastify();
    apps.push(app);
    app.decorate("rbac", {
      permissions: { get: async () => set },
      scopeTrees: { forTenant: async () => scopeTreeFromPairs({}) },
      clock,
      logger: noopLogger,
    } satisfies RbacRuntime);
    app.addHook("onRequest", async (req) => void ((req as unknown as { ctx: RequestContext }).ctx = userCtx()));
    app.setErrorHandler((e, req, reply) => {
      const b = toErrorBody(e, req.id);
      void reply.status(b.status).send(b);
    });
    app.get("/x", { preHandler: requirePermission("grade.read") }, async () => ({ ok: true }));
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/x" })).statusCode).toBe(200);
    clock.advance(31 * 60_000);
    expect((await app.inject({ method: "GET", url: "/x" })).statusCode).toBe(403);
  });

  it("périmètre explicite : un rôle de campus ne passe que sur son campus", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }]) },
      ctxFor: headerCtx,
      routes: (a) =>
        a.get<{ Params: { campus: string } }>(
          "/campus/:campus/students",
          { preHandler: requirePermission("student.read", { scope: (req) => campusScope((req.params as { campus: string }).campus) }) },
          async () => ({ ok: true }),
        ),
    });
    expect((await app.inject({ method: "GET", url: `/campus/${CAMPUS_A1}/students`, headers: { "x-user": U1 } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/campus/${CAMPUS_A2}/students`, headers: { "x-user": U1 } })).statusCode).toBe(403);
  });

  it("périmètre établissement : couvre ses campus via l'arbre fourni par le runtime", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["student.read"], scope: institutionScope(INST_A) }]) },
      ctxFor: headerCtx,
      routes: (a) =>
        a.get("/c", { preHandler: requirePermission("student.read", { scope: campusScope(CAMPUS_A2) }) }, async () => ({ ok: true })),
    });
    expect((await app.inject({ method: "GET", url: "/c", headers: { "x-user": U1 } })).statusCode).toBe(200);
  });

  it("sans option `scope`, utilise le campus actif de la requête", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }]) },
      ctxFor: headerCtx,
      routes: (a) => a.get("/s", { preHandler: requirePermission("student.read") }, async () => ({ ok: true })),
    });
    // aucun périmètre actif -> cible = tenant : un rôle de campus ne suffit pas
    expect((await app.inject({ method: "GET", url: "/s", headers: { "x-user": U1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/s", headers: { "x-user": U1, "x-campus": CAMPUS_A1 } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/s", headers: { "x-user": U1, "x-campus": CAMPUS_A2 } })).statusCode).toBe(403);
  });

  it('`scope: "any"` : détenue quelque part suffit', async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }]) },
      ctxFor: headerCtx,
      routes: (a) => a.get("/s", { preHandler: requirePermission("student.read", { scope: "any" }) }, async () => ({ ok: true })),
    });
    expect((await app.inject({ method: "GET", url: "/s", headers: { "x-user": U1 } })).statusCode).toBe(200);
  });

  it("les handlers récupèrent les périmètres accordés pour filtrer leurs listes", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }]) },
      ctxFor: headerCtx,
      routes: (a) =>
        a.get("/s", { preHandler: requirePermission("student.read", { scope: "any" }) }, async (req) => {
          const auth = await loadAuthorization(req);
          return { scopes: grantedScopes(auth, "student.read") };
        }),
    });
    const res = await app.inject({ method: "GET", url: "/s", headers: { "x-user": U1 } });
    expect(res.json().scopes).toEqual([{ type: "campus", id: CAMPUS_A1 }]);
  });

  it("charge les droits UNE fois par requête, même avec plusieurs gardes", async () => {
    const { app, loads } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["grade.read", "grade.enter"] }]) },
      ctxFor: headerCtx,
      routes: (a) =>
        a.get("/x", { preHandler: [requirePermission("grade.read"), requirePermission("grade.enter")] }, async () => ({ ok: true })),
    });
    expect((await app.inject({ method: "GET", url: "/x", headers: { "x-user": U1 } })).statusCode).toBe(200);
    expect(loads.count).toBe(1);
  });

  it("un acteur système n'a aucun droit RBAC (403)", async () => {
    const { app } = await harness({
      sets: {},
      ctxFor: () => createSystemContext(T1),
      routes: (a) => a.get("/x", { preHandler: requirePermission("grade.read") }, async () => ({ ok: true })),
    });
    const res = await app.inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("rbac.no_user");
  });

  it("plugin rbac absent : refus bruyant (500 rbac.not_configured), jamais un accès", async () => {
    const { app } = await harness({
      sets: {},
      withRuntime: false,
      ctxFor: headerCtx,
      routes: (a) => a.get("/x", { preHandler: requirePermission("grade.read") }, async () => ({ ok: true })),
    });
    const res = await app.inject({ method: "GET", url: "/x", headers: { "x-user": U1 } });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("rbac.not_configured");
  });

  it("une erreur de chargement des droits refuse la requête (échec fermé)", async () => {
    const app = Fastify();
    apps.push(app);
    app.decorate("rbac", {
      permissions: { get: async () => Promise.reject(new Error("db down")) },
      scopeTrees: { forTenant: async () => scopeTreeFromPairs({}) },
      clock: new ManualClock(NOW),
      logger: noopLogger,
    } satisfies RbacRuntime);
    app.addHook("onRequest", async (req) => void ((req as unknown as { ctx: RequestContext }).ctx = userCtx()));
    app.setErrorHandler((e, req, reply) => {
      const b = toErrorBody(e, req.id);
      void reply.status(b.status).send(b);
    });
    let reached = false;
    app.get("/x", { preHandler: requirePermission("grade.read") }, async () => {
      reached = true;
      return { ok: true };
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/x" });
    expect(res.statusCode).toBe(500);
    expect(reached).toBe(false);
  });

  it("refuse à la déclaration une clé de permission mal formée", () => {
    expect(() => requirePermission("Grade.Read")).toThrow(TypeError);
    expect(() => requirePermission("grade")).toThrow(TypeError);
    expect(() => requirePermission("grade.*")).toThrow(TypeError);
    expect(() => requirePermission("grade.read")).not.toThrow();
  });

  it("les droits d'un utilisateur ne fuient pas vers une autre requête concurrente", async () => {
    const { app } = await harness({
      sets: { [U1]: setFor(U1, [{ permissions: ["grade.read"] }]), [U2]: setFor(U2, []) },
      ctxFor: headerCtx,
      routes: (a) => a.get("/x", { preHandler: requirePermission("grade.read") }, async () => ({ ok: true })),
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => app.inject({ method: "GET", url: "/x", headers: { "x-user": i % 2 === 0 ? U1 : U2 } })),
    );
    results.forEach((r, i) => expect(r.statusCode).toBe(i % 2 === 0 ? 200 : 403));
  });
});
