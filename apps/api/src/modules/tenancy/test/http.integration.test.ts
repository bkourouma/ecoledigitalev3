/** Routes `/api/v1/tenancy/*` via Fastify `inject`, contre un vrai Postgres. */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock, createRequestContext, newId, ForbiddenError, type RequestContext } from "@ecoledigitale/kernel";
import { provisionTenant, tenancyPlugin } from "../index";
import { TENANCY_MIGRATIONS, createTestDb, describeIntegration, type TestDb } from "./support/db";

const clock = new ManualClock("2026-10-01T08:00:00.000Z");

describeIntegration("tenancy — HTTP", () => {
  let db: TestDb;
  let app: FastifyInstance;
  let denyApp: FastifyInstance;
  let A: { tenantId: string; institutionId: string; campusId: string };
  let B: { tenantId: string; institutionId: string; campusId: string };
  const USER = newId();

  /** Contexte et permissions simulés par en-têtes (le vrai câblage vient de iam/rbac). */
  const resolveContext = (req: FastifyRequest): RequestContext =>
    createRequestContext({ tenantId: String(req.headers["x-tenant-id"]), userId: USER, roles: ["director"] });
  const requirePermission = (permission: string) => async (req: FastifyRequest) => {
    const granted = String(req.headers["x-permissions"] ?? "").split(",");
    if (!granted.includes(permission)) throw new ForbiddenError("Permission refusée.", { code: "rbac.denied", details: { permission } });
  };

  const headers = (tenantId: string, ...permissions: string[]) => ({
    "x-tenant-id": tenantId,
    "x-permissions": permissions.join(","),
  });
  const ALL = ["tenancy.institution.read", "tenancy.institution.manage", "tenancy.campus.manage"];

  async function provision(slug: string, pack: "PRIMARY" | "HIGHER") {
    const r = await provisionTenant(
      { db: db.tenantDb, clock },
      { name: `Org ${slug}`, slug, countryCode: "CI", packs: [pack], adminContact: { name: "Awa Koné", email: `a@${slug}.ci` } },
    );
    if (!r.ok) throw r.error;
    return { tenantId: r.value.tenantId, institutionId: r.value.institutions[0]!.id, campusId: r.value.institutions[0]!.defaultCampusId };
  }

  beforeAll(async () => {
    db = await createTestDb([TENANCY_MIGRATIONS]);
    A = await provision("http-a", "PRIMARY");
    B = await provision("http-b", "HIGHER");

    app = Fastify({ logger: false });
    await app.register(tenancyPlugin, { db: db.tenantDb, clock, requirePermission, resolveContext });
    await app.ready();

    // Plugin SANS garde de permissions : doit tout refuser (échec fermé).
    denyApp = Fastify({ logger: false });
    await denyApp.register(tenancyPlugin, { db: db.tenantDb, resolveContext });
    await denyApp.ready();
  });

  afterAll(async () => {
    await app?.close();
    await denyApp?.close();
    await db?.drop();
  });

  it("garde de permission : sans la permission, 403 avec code stable ; aucune donnée", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/tenancy/institutions", headers: headers(A.tenantId) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "rbac.denied", kind: "forbidden", status: 403 });
  });

  it("échec fermé : sans garde de permissions câblée, toutes les routes refusent", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/tenancy/institutions"],
      ["GET", "/api/v1/tenancy/profile"],
      ["GET", "/api/v1/tenancy/onboarding"],
      ["POST", "/api/v1/tenancy/institutions"],
    ] as const) {
      const res = await denyApp.inject({ method, url, headers: headers(A.tenantId, ...ALL), payload: method === "POST" ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code).toBe("tenancy.permission_guard_missing");
    }
  });

  it("sans contexte d'authentification : 401", async () => {
    const bare = Fastify({ logger: false });
    await bare.register(tenancyPlugin, { db: db.tenantDb, requirePermission: () => async () => undefined });
    const res = await bare.inject({ method: "GET", url: "/api/v1/tenancy/profile" });
    expect(res.statusCode).toBe(401);
    await bare.close();
  });

  it("GET /institutions : seulement celles du tenant courant", async () => {
    const a = await app.inject({ method: "GET", url: "/api/v1/tenancy/institutions", headers: headers(A.tenantId, ALL[0]!) });
    expect(a.statusCode).toBe(200);
    expect(a.json().items.map((i: { id: string }) => i.id)).toEqual([A.institutionId]);
    const b = await app.inject({ method: "GET", url: "/api/v1/tenancy/institutions", headers: headers(B.tenantId, ALL[0]!) });
    expect(b.json().items.map((i: { id: string }) => i.id)).toEqual([B.institutionId]);
  });

  it("GET /institutions/:id d'un autre tenant : 404 ; identifiant invalide : 400", async () => {
    const cross = await app.inject({ method: "GET", url: `/api/v1/tenancy/institutions/${B.institutionId}`, headers: headers(A.tenantId, ALL[0]!) });
    expect(cross.statusCode).toBe(404);
    expect(cross.json().code).toBe("tenancy.institution_not_found");

    const bad = await app.inject({ method: "GET", url: "/api/v1/tenancy/institutions/pas-un-uuid", headers: headers(A.tenantId, ALL[0]!) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /institutions : 201, campus par défaut inclus ; corps invalide : 400 avec les champs fautifs", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/tenancy/institutions",
      headers: headers(A.tenantId, ALL[1]!),
      payload: { name: "Lycée des Lauriers", pack: "SECONDARY" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ pack: "SECONDARY", code: "secondary", defaultCampus: { isDefault: true, code: "main" } });

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/tenancy/institutions",
      headers: headers(A.tenantId, ALL[1]!),
      payload: { name: "x", pack: "MATERNELLE", surprise: 1 },
    });
    expect(bad.statusCode).toBe(400);
    const issuePaths = bad.json().issues.map((i: { path: string[] }) => i.path[0]);
    expect(issuePaths).toEqual(expect.arrayContaining(["name", "pack"]));
  });

  it("permission distincte pour les campus : institution.manage ne suffit pas", async () => {
    const url = `/api/v1/tenancy/institutions/${A.institutionId}/campuses`;
    const denied = await app.inject({ method: "POST", url, headers: headers(A.tenantId, ALL[1]!), payload: { name: "Campus Nord" } });
    expect(denied.statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url, headers: headers(A.tenantId, ALL[2]!), payload: { name: "Campus Nord" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ code: "campus-nord", isDefault: false, institutionId: A.institutionId });

    const list = await app.inject({ method: "GET", url, headers: headers(A.tenantId, ALL[0]!) });
    expect(list.json().items).toHaveLength(2);
  });

  it("PATCH/DELETE /campuses/:id : protections du campus par défaut, 204 à la suppression", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/v1/tenancy/campuses/${A.campusId}`, headers: headers(A.tenantId, ALL[2]!) });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("tenancy.campus_default_protected");

    const list = await app.inject({ method: "GET", url: `/api/v1/tenancy/institutions/${A.institutionId}/campuses`, headers: headers(A.tenantId, ALL[0]!) });
    const other = list.json().items.find((c: { isDefault: boolean }) => !c.isDefault);
    const ok = await app.inject({ method: "DELETE", url: `/api/v1/tenancy/campuses/${other.id}`, headers: headers(A.tenantId, ALL[2]!) });
    expect(ok.statusCode).toBe(204);

    // Le campus de B reste intact et inaccessible à A.
    const cross = await app.inject({ method: "PATCH", url: `/api/v1/tenancy/campuses/${B.campusId}`, headers: headers(A.tenantId, ALL[2]!), payload: { name: "Piraté" } });
    expect(cross.statusCode).toBe(404);
  });

  it("GET/PATCH /profile : branding validé", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/tenancy/profile",
      headers: headers(A.tenantId, ALL[1]!),
      payload: { primaryColor: "#0B5FFF", customDomain: "ecole.http-a.ci" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().branding).toMatchObject({ primaryColor: "#0B5FFF", customDomain: "ecole.http-a.ci" });

    const bad = await app.inject({ method: "PATCH", url: "/api/v1/tenancy/profile", headers: headers(A.tenantId, ALL[1]!), payload: { primaryColor: "bleu" } });
    expect(bad.statusCode).toBe(400);

    const get = await app.inject({ method: "GET", url: "/api/v1/tenancy/profile", headers: headers(B.tenantId, ALL[0]!) });
    expect(get.json()).toMatchObject({ slug: "http-b", branding: { customDomain: null } });
  });

  it("GET /countries : référentiel avec la Côte d'Ivoire", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/tenancy/countries", headers: headers(A.tenantId, ALL[0]!) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      { code: "CI", name: "Côte d'Ivoire", currencyCode: "XOF", currencyExponent: 0, locale: "fr-CI", timezone: "Africa/Abidjan", phonePrefix: "+225", educationSystem: "CI" },
    ]);
  });

  it("onboarding : lecture, étape terminée, étape indisponible refusée, étape inconnue 400", async () => {
    const get = await app.inject({ method: "GET", url: "/api/v1/tenancy/onboarding", headers: headers(A.tenantId, ALL[0]!) });
    expect(get.json()).toMatchObject({ status: "IN_PROGRESS", currentStep: "ACADEMIC_YEAR" });

    const early = await app.inject({ method: "POST", url: "/api/v1/tenancy/onboarding/steps/CLASSES/complete", headers: headers(A.tenantId, ALL[1]!) });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("tenancy.onboarding.prerequisites_unmet");

    const ok = await app.inject({ method: "POST", url: "/api/v1/tenancy/onboarding/steps/ACADEMIC_YEAR/complete", headers: headers(A.tenantId, ALL[1]!) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().progress.done).toBe(6);

    const skip = await app.inject({ method: "POST", url: "/api/v1/tenancy/onboarding/steps/FINANCE/skip", headers: headers(A.tenantId, ALL[1]!) });
    expect(skip.statusCode).toBe(200);

    const unknown = await app.inject({ method: "POST", url: "/api/v1/tenancy/onboarding/steps/NOPE/complete", headers: headers(A.tenantId, ALL[1]!) });
    expect(unknown.statusCode).toBe(400);
  });

  it("JSON invalide : 400 sans fuite d'information interne", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/tenancy/profile",
      headers: { ...headers(A.tenantId, ALL[1]!), "content-type": "application/json" },
      payload: "{pas du json",
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).not.toMatch(/at .*\.ts|node_modules/);
  });
});
