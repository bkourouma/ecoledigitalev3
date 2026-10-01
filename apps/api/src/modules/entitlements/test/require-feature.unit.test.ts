/** `requireFeature` : preHandler Fastify, sans base de données (lecteur factice). */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { UnauthorizedError, createRequestContext, toErrorBody, toAppError, type RequestContext } from "@ecoledigitale/kernel";
import { createRequireFeature, requireFeature, type EntitlementsService } from "../http/require-feature";
import type { EntitlementsReader } from "../application/reader";
import type { EffectiveEntitlements } from "../domain/resolve";

const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";
const USER = "00000000-0000-7000-8000-0000000000ff";

function ent(tenantId: string, features: string[], reason: EffectiveEntitlements["reason"] = "OK"): EffectiveEntitlements {
  return {
    tenantId, reason, planKey: null, packs: [], subscriptionStatus: null, features, sources: {},
    limits: { learnerTierMax: null }, validUntil: null, computedAt: new Date(),
  };
}

const readerOf = (byTenant: Record<string, EffectiveEntitlements>): EntitlementsReader => ({
  async getEntitlements(tenantId) {
    const e = byTenant[tenantId];
    if (!e) throw new Error("tenant inconnu");
    return e;
  },
  async hasFeature(tenantId, key) {
    return (await this.getEntitlements(tenantId)).features.includes(key);
  },
});

const resolveContext = (req: FastifyRequest): RequestContext => {
  const tenant = req.headers["x-tenant-id"];
  if (typeof tenant !== "string") throw new UnauthorizedError();
  return createRequestContext({ tenantId: tenant, userId: USER });
};

function appWith(handlerGuard: (key: string) => ReturnType<typeof requireFeature>, decorate?: EntitlementsService): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const e = toAppError(error);
    void reply.status(e.httpStatus).send(toErrorBody(e));
  });
  if (decorate) app.decorate("entitlements", decorate);
  app.get("/paid", { preHandler: handlerGuard("finance.online-payment") }, async () => ({ ok: true }));
  app.get("/free", async () => ({ ok: true }));
  return app;
}

describe("requireFeature", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  const reader = readerOf({
    [A]: ent(A, ["core.dashboard", "finance.online-payment"]),
    [B]: ent(B, ["core.dashboard"], "SUBSCRIPTION_INACTIVE"),
  });

  it("feature accordée : la requête passe", async () => {
    app = appWith(createRequireFeature(reader, resolveContext));
    const res = await app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": A } });
    expect(res.statusCode).toBe(200);
  });

  it("feature non accordée : 403 avec code stable, feature et raison", async () => {
    app = appWith(createRequireFeature(reader, resolveContext));
    const res = await app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": B } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "entitlements.feature_not_available",
      details: { feature: "finance.online-payment", reason: "SUBSCRIPTION_INACTIVE" },
    });
  });

  it("deux tenants, deux réponses différentes (décision par tenant du contexte)", async () => {
    app = appWith(createRequireFeature(reader, resolveContext));
    const [a, b] = await Promise.all([
      app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": A } }),
      app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": B } }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 403]);
  });

  it("sans contexte authentifié : 401", async () => {
    app = appWith(createRequireFeature(reader, resolveContext));
    const res = await app.inject({ method: "GET", url: "/paid" });
    expect(res.statusCode).toBe(401);
  });

  it("clé de feature invalide : erreur dès la fabrique (au démarrage), pas à la première requête", () => {
    expect(() => createRequireFeature(reader, resolveContext)("Pas Une Cle")).toThrow(TypeError);
    expect(() => requireFeature("sans-point")).toThrow(TypeError);
  });

  it("version globale : lit le service posé par le plugin (app.entitlements)", async () => {
    const service: EntitlementsService = { reader, resolveContext, requireFeature: createRequireFeature(reader, resolveContext) };
    app = appWith(requireFeature, service);
    expect((await app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": A } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": B } })).statusCode).toBe(403);
  });

  it("version globale sans plugin enregistré : refus explicite (500), la route payante ne s'ouvre jamais", async () => {
    app = appWith(requireFeature);
    const res = await app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": A } });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("entitlements.not_registered");
    // Une route sans garde reste accessible.
    expect((await app.inject({ method: "GET", url: "/free" })).statusCode).toBe(200);
  });

  it("une erreur du lecteur (tenant inconnu…) ne laisse jamais passer la requête", async () => {
    app = appWith(createRequireFeature(reader, resolveContext));
    const res = await app.inject({ method: "GET", url: "/paid", headers: { "x-tenant-id": "00000000-0000-7000-8000-0000000000cc" } });
    expect(res.statusCode).toBe(500);
  });
});
