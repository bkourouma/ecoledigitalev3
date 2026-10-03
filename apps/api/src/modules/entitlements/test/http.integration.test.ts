/** Routes `/api/v1/entitlements/*` et `requireFeature` de bout en bout, contre un vrai Postgres. */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ForbiddenError,
  ManualClock,
  UnauthorizedError,
  createRequestContext,
  defineModule,
  newId,
  noopLogger,
  type RequestContext,
} from "@ecoledigitale/kernel";
import { provisionTenant } from "../../tenancy";
import {
  entitlementsPlugin,
  requireFeature,
  syncFeatureCatalog,
  type SuperAdminAuthorizer,
} from "../index";
import { MyFeaturesSchema } from "@ecoledigitale/contracts/src/v2/entitlements";
import { createTestDb, describeIntegration, type TestDb } from "./support/db";

const clock = new ManualClock("2026-10-01T08:00:00.000Z");
const OPERATOR = newId();

const MANIFESTS = [
  defineModule({
    key: "platformcore",
    title: "Noyau",
    packs: ["CORE"],
    features: [{ key: "platformcore.dashboard", label: "Tableau de bord", packs: ["CORE"] }],
  }),
  defineModule({
    key: "finance",
    title: "Finance",
    packs: ["PRIMARY"],
    features: [
      { key: "finance.online-payment", label: "Paiement en ligne", packs: [] },
      { key: "finance.receipts", label: "Reçus PDF", packs: ["PRIMARY"] },
    ],
  }),
];

describeIntegration("entitlements — HTTP", () => {
  let db: TestDb;
  let app: FastifyInstance;
  let lockedApp: FastifyInstance;
  let A: string;
  let B: string;

  const resolveContext = (req: FastifyRequest): RequestContext => {
    const tenant = req.headers["x-tenant-id"];
    if (typeof tenant !== "string") throw new UnauthorizedError();
    return createRequestContext({ tenantId: tenant, userId: newId(), roles: ["director"] });
  };
  const requirePermission = (permission: string) => async (req: FastifyRequest) => {
    const granted = String(req.headers["x-permissions"] ?? "").split(",");
    if (!granted.includes(permission)) throw new ForbiddenError("Permission refusée.", { code: "rbac.denied", details: { permission } });
  };
  /** Autorisateur de test : un en-tête secret désigne l'opérateur (le vrai vit dans iam / console plateforme). */
  const superAdminAuthorizer: SuperAdminAuthorizer = {
    async authorize(req) {
      if (req.headers["x-operator-token"] !== "ok") throw new ForbiddenError("Réservé aux opérateurs de la plateforme.", { code: "iam.not_super_admin" });
      return { actorId: OPERATOR };
    },
  };

  const asTenant = (tenantId: string, ...permissions: string[]) => ({ "x-tenant-id": tenantId, "x-permissions": permissions.join(",") });
  const asOperator = { "x-operator-token": "ok" };

  async function provision(slug: string) {
    const r = await provisionTenant(
      { db: db.tenantDb, clock },
      { name: `Org ${slug}`, slug, countryCode: "CI", packs: ["PRIMARY"], adminContact: { name: "Awa Koné", email: `a@${slug}.ci` } },
    );
    if (!r.ok) throw r.error;
    return r.value.tenantId;
  }

  beforeAll(async () => {
    db = await createTestDb();
    const sync = await syncFeatureCatalog({ db: db.tenantDb, systemDb: db.systemDb, clock }, MANIFESTS);
    if (!sync.ok) throw sync.error;
    A = await provision("http-a");
    B = await provision("http-b");

    app = Fastify({ logger: false });
    await app.register(entitlementsPlugin, {
      db: db.tenantDb,
      clock,
      logger: noopLogger,
      requirePermission,
      resolveContext,
      superAdminAuthorizer,
      cacheTtlMs: 600_000, // TTL long : prouve que l'invalidation, pas le temps, rend les changements visibles
    });
    // Une route d'un AUTRE module, protégée par requireFeature, enregistrée après le plugin.
    await app.register(async (other) => {
      other.get("/api/v1/finance/pay", { preHandler: requireFeature("finance.online-payment") }, async () => ({ paid: true }));
      other.get("/api/v1/finance/receipt", { preHandler: requireFeature("finance.receipts") }, async () => ({ receipt: true }));
    });
    await app.ready();

    // Plugin sans autorisateur ni garde de permissions branchés : tout est refusé.
    lockedApp = Fastify({ logger: false });
    await lockedApp.register(entitlementsPlugin, { db: db.tenantDb, logger: noopLogger, resolveContext });
    await lockedApp.ready();
  });

  afterAll(async () => {
    await app?.close();
    await lockedApp?.close();
    await db?.drop();
  });

  const admin = (method: "GET" | "PUT" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = asOperator) =>
    app.inject({ method, url: `/api/v1/entitlements${url}`, headers, payload: payload as never });

  it("échec fermé : sans autorisateur ni garde, les routes /admin et /me refusent", async () => {
    const adminRes = await lockedApp.inject({ method: "GET", url: "/api/v1/entitlements/admin/catalog", headers: asOperator });
    expect(adminRes.statusCode).toBe(403);
    expect(adminRes.json().code).toBe("entitlements.super_admin_authorizer_missing");
    const me = await lockedApp.inject({ method: "GET", url: "/api/v1/entitlements/me", headers: asTenant(A, "entitlements.read") });
    expect(me.statusCode).toBe(403);
    expect(me.json().code).toBe("entitlements.permission_guard_missing");
  });

  it("administration : refusée à un non-opérateur (même avec toutes les permissions de tenant)", async () => {
    const res = await admin("GET", "/admin/catalog", undefined, asTenant(A, "entitlements.read", "entitlements.manage"));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("iam.not_super_admin");
    for (const [m, u] of [
      ["PUT", `/admin/tenants/${A}/subscription`],
      ["PUT", `/admin/tenants/${A}/overrides/finance.receipts`],
      ["DELETE", `/admin/tenants/${A}/overrides/finance.receipts`],
      ["PUT", "/admin/plans/PROFESSIONAL"],
    ] as const) {
      const r = await admin(m, u, {}, asTenant(A, "entitlements.manage"));
      expect(r.statusCode, `${m} ${u}`).toBe(403);
    }
  });

  it("GET /me : permission requise ; sans abonnement, uniquement les features CORE", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/v1/entitlements/me", headers: asTenant(A) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("rbac.denied");

    const res = await app.inject({ method: "GET", url: "/api/v1/entitlements/me", headers: asTenant(A, "entitlements.read") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tenantId: A, reason: "NO_SUBSCRIPTION", features: ["platformcore.dashboard"], planKey: null });
  });

  it("requireFeature : route payante fermée sans abonnement", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/finance/pay", headers: asTenant(A) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "entitlements.feature_not_available",
      details: { feature: "finance.online-payment", reason: "NO_SUBSCRIPTION" },
    });
  });

  it("l'administration d'un abonnement ouvre les routes aussitôt (cache invalidé, malgré un TTL de 10 minutes)", async () => {
    const put = await admin("PUT", `/admin/tenants/${A}/subscription`, { planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE", learnerTierMax: 300 });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ planKey: "PROFESSIONAL", packs: ["PRIMARY"], status: "ACTIVE", learnerTierMax: 300, tenantId: A });

    // Le plan n'a pas encore finance.online-payment : seul le pack (reçus) est ouvert.
    expect((await app.inject({ method: "GET", url: "/api/v1/finance/receipt", headers: asTenant(A) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/finance/pay", headers: asTenant(A) })).statusCode).toBe(403);

    const plan = await admin("PUT", "/admin/plans/PROFESSIONAL/features", { featureKeys: ["finance.online-payment"] });
    expect(plan.statusCode).toBe(200);
    expect(plan.json().featureKeys).toEqual(["finance.online-payment"]);
    expect((await app.inject({ method: "GET", url: "/api/v1/finance/pay", headers: asTenant(A) })).statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/v1/entitlements/me", headers: asTenant(A, "entitlements.read") });
    expect(me.json()).toMatchObject({
      reason: "OK",
      planKey: "PROFESSIONAL",
      limits: { learnerTierMax: 300 },
      features: ["finance.online-payment", "finance.receipts", "platformcore.dashboard"],
      sources: { "finance.online-payment": "PLAN", "finance.receipts": "PACK", "platformcore.dashboard": "CORE" },
    });
  });

  it("les droits sont par tenant : B n'a rien de ce qui a été ouvert pour A", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/finance/pay", headers: asTenant(B) });
    expect(res.statusCode).toBe(403);
    const me = await app.inject({ method: "GET", url: "/api/v1/entitlements/me", headers: asTenant(B, "entitlements.read") });
    expect(me.json().features).toEqual(["platformcore.dashboard"]);
  });

  it("surcharge DENY via l'API : la route se ferme immédiatement ; suppression : elle se rouvre (204)", async () => {
    const put = await admin("PUT", `/admin/tenants/${A}/overrides/finance.online-payment`, { effect: "DENY", reason: "Litige en cours avec la banque" });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ effect: "DENY", featureKey: "finance.online-payment", createdBy: OPERATOR });
    expect((await app.inject({ method: "GET", url: "/api/v1/finance/pay", headers: asTenant(A) })).statusCode).toBe(403);

    const list = await admin("GET", `/admin/tenants/${A}/overrides`);
    expect(list.json().items).toHaveLength(1);

    const del = await admin("DELETE", `/admin/tenants/${A}/overrides/finance.online-payment`);
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/v1/finance/pay", headers: asTenant(A) })).statusCode).toBe(200);

    const again = await admin("DELETE", `/admin/tenants/${A}/overrides/finance.online-payment`);
    expect(again.statusCode).toBe(404);
  });

  it("validation des entrées d'administration : 400 avec les champs fautifs", async () => {
    const badSub = await admin("PUT", `/admin/tenants/${A}/subscription`, { planKey: "pro", packs: ["X"], status: "GRATUIT" });
    expect(badSub.statusCode).toBe(400);
    expect(badSub.json().issues.map((i: { path: string[] }) => i.path[0])).toEqual(expect.arrayContaining(["planKey", "packs", "status"]));

    const badOverride = await admin("PUT", `/admin/tenants/${A}/overrides/finance.receipts`, { effect: "GRANT", reason: "x" });
    expect(badOverride.statusCode).toBe(400);

    const badTenant = await admin("GET", "/admin/tenants/pas-un-uuid/entitlements");
    expect(badTenant.statusCode).toBe(400);

    const unknownTenant = await admin("GET", `/admin/tenants/${newId()}/entitlements`);
    expect(unknownTenant.statusCode).toBe(404);

    const unknownPlan = await admin("PUT", "/admin/plans/GHOST/features", { featureKeys: [] });
    expect(unknownPlan.statusCode).toBe(404);
  });

  it("GET /admin/tenants/:id/entitlements : vérité courante, sans cache", async () => {
    const res = await admin("GET", `/admin/tenants/${A}/entitlements`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tenantId: A, reason: "OK", planKey: "PROFESSIONAL" });
  });

  it("GET /admin/catalog : plans, packs, features", async () => {
    const res = await admin("GET", "/admin/catalog");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plans.map((p: { key: string }) => p.key)).toEqual(["STARTER", "PROFESSIONAL", "ENTERPRISE"]);
    expect(body.packs).toHaveLength(4);
    expect(body.features.map((f: { key: string }) => f.key)).toEqual([
      "finance.online-payment",
      "finance.receipts",
      "platformcore.dashboard",
    ]);
  });

  it("usage : lecture par le tenant, par l'opérateur ; le tenant ne voit que le sien", async () => {
    const { recordUsage } = await import("../index");
    await recordUsage({ db: db.tenantDb, clock }, createRequestContext({ tenantId: A, userId: newId() }), { metric: "SMS_SENT", amount: 12 });

    const mine = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/usage?from=2026-10&to=2026-10", headers: asTenant(A, "entitlements.read") });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items).toEqual([{ metric: "SMS_SENT", period: "2026-10-01", value: 12, updatedAt: expect.any(String) }]);

    const other = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/usage?from=2026-10&to=2026-10", headers: asTenant(B, "entitlements.read") });
    expect(other.json().items).toEqual([]);

    const viaAdmin = await admin("GET", `/admin/tenants/${A}/usage?from=2026-10&to=2026-10`);
    expect(viaAdmin.json().items).toHaveLength(1);

    const badQuery = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/usage?from=n-importe-quoi", headers: asTenant(A, "entitlements.read") });
    expect(badQuery.statusCode).toBe(400);
    const strict = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/usage?tenantId=autre", headers: asTenant(A, "entitlements.read") });
    expect(strict.statusCode).toBe(400);
  });

  it("option adminRequiresPermission : exige AUSSI la permission sensible entitlements.manage", async () => {
    const strictApp = Fastify({ logger: false });
    await strictApp.register(entitlementsPlugin, {
      db: db.tenantDb, clock, logger: noopLogger, requirePermission, resolveContext, superAdminAuthorizer, adminRequiresPermission: true,
    });
    await strictApp.ready();
    const without = await strictApp.inject({ method: "GET", url: "/api/v1/entitlements/admin/catalog", headers: { ...asOperator, ...asTenant(A, "entitlements.read") } });
    expect(without.statusCode).toBe(403);
    expect(without.json().code).toBe("rbac.denied");
    const withPerm = await strictApp.inject({ method: "GET", url: "/api/v1/entitlements/admin/catalog", headers: { ...asOperator, ...asTenant(A, "entitlements.manage") } });
    expect(withPerm.statusCode).toBe(200);
    await strictApp.close();
  });

  describe("GET /me/features : tout membre authentifié, vue minimale", () => {
    it("sans session : 401 ; sans AUCUNE permission : 200 (parent, élève, enseignant)", async () => {
      const anon = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/features" });
      expect(anon.statusCode).toBe(401);
      for (const role of ["parent", "eleve", "enseignant"]) {
        const res = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/features", headers: { ...asTenant(A), "x-role": role } });
        expect(res.statusCode, role).toBe(200);
      }
      // Le plugin sans garde de permissions (échec fermé sur /me) sert quand même la vue minimale : elle n'en dépend pas.
      const locked = await lockedApp.inject({ method: "GET", url: "/api/v1/entitlements/me/features", headers: asTenant(A) });
      expect(locked.statusCode).toBe(200);
    });

    it("forme EXACTE : uniquement `features` (clés triées) ; ni plan, ni pack, ni quota, ni date, ni source", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/features", headers: asTenant(A) });
      const body = res.json();
      expect(Object.keys(body)).toEqual(["features"]);
      expect(MyFeaturesSchema.safeParse(body).success).toBe(true);
      expect(body.features).toEqual([...body.features].sort());
      expect(body.features).toEqual(expect.arrayContaining(["platformcore.dashboard", "finance.receipts"]));
      const text = JSON.stringify(body);
      for (const leak of ["PROFESSIONAL", "learnerTierMax", "validUntil", "computedAt", "subscription", "tenantId", "sources"]) {
        expect(text, leak).not.toContain(leak);
      }
      // Même jeu de clés que /me (la source de vérité), sans rien d'autre.
      const full = await app.inject({ method: "GET", url: "/api/v1/entitlements/me", headers: asTenant(A, "entitlements.read") });
      expect(body.features).toEqual(full.json().features);
    });

    it("A/B : un membre du tenant B ne voit jamais les fonctionnalités du tenant A", async () => {
      const b = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/features", headers: asTenant(B) });
      expect(b.json()).toEqual({ features: ["platformcore.dashboard"] });
      const a = await app.inject({ method: "GET", url: "/api/v1/entitlements/me/features", headers: asTenant(A) });
      expect(a.json().features).toContain("finance.receipts");
      // Aucun paramètre ne permet de cibler un autre tenant : la route ignore la requête et lit la session.
      const spoof = await app.inject({ method: "GET", url: `/api/v1/entitlements/me/features?tenantId=${A}`, headers: asTenant(B) });
      expect(spoof.json()).toEqual({ features: ["platformcore.dashboard"] });
    });
  });
});
