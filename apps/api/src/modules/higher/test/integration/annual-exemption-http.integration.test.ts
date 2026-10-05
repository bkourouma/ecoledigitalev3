/**
 * API HTTP des décisions O-11 (UE annuelle) et O-14 (dispense d'UE) : plugin chargé par le VRAI registre de modules,
 * 401 / 403 par permission dédiée, validation stricte, DTO conformes aux contrats, motif obligatoire.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import { higherAnnualUeDtoSchema, higherEventPayloadSchemas, higherExemptionDtoSchema, higherExemptionSettingsDtoSchema } from "@ecoledigitale/contracts/src/v2/higher";
import type { ModuleRuntime } from "../../../../platform/runtime";
import { registerModules, resetRegistryForTests } from "../../../registry";
import manifest from "../../manifest";
import { registerHigherPorts } from "../../http/plugin";
import { adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, scriptRules, seedSchool, type School, type TestWorld } from "../support/world";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ALL = manifest.permissions.map((p) => p.key);

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP — UE annuelle (O-11) et dispense d'UE (O-14)", () => {
  let db: HigherTestDb;
  let world: TestWorld;
  let school: School;
  let app: FastifyInstance;
  const identities = new Map<string, Who>();
  const call = async (who: string | null, method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1/higher${url}`, headers: who ? { "x-test-identity": who } : {}, ...(body !== undefined ? { payload: body as never } : {}) });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, json };
  };

  beforeAll(async () => {
    db = await createHigherTestDb();
    world = makeWorld(db);
    scriptRules(world);
    school = await seedSchool(db, world, { students: 2 });
    const mk = (perms: string[], roles: string[] = []) => ({ ctx: createRequestContext({ tenantId: school.tenantId, userId: newId(), roles }), perms });
    identities.set("admin", { ctx: school.admin.ctx, perms: ALL });
    identities.set("direction", mk(["higher.exemption.read", "higher.exemption.grant", "higher.settings.manage", "higher.annual_ue.manage", "higher.diploma.read"], ["directeur"]));
    // lecture seule : voit les dispenses mais ne peut ni en accorder, ni changer la politique
    identities.set("reader", mk(["higher.exemption.read", "higher.diploma.read"], ["secretariat"]));
    identities.set("registrar", mk(["higher.diploma.read", "higher.diploma.manage", "higher.credits.read", "higher.document.read", "higher.award.read"], ["secretariat"]));
    identities.set("teacher", mk([], ["enseignant"]));

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    const identityOf = (req: FastifyRequest): Who | undefined => {
      const id = req.headers["x-test-identity"];
      return typeof id === "string" ? identities.get(id) : undefined;
    };
    app.addHook("onRequest", async (req) => {
      const who = identityOf(req);
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const features = new Set(["higher.diplomas", "higher.session2", "higher.prerequisites", "higher.attestations"]);
    const runtime = {
      tenantDb: db.tenantDb,
      systemDb: db.systemDb,
      clock: world.clock,
      logger: noopLogger,
      manifests: [manifest],
      env: {},
      requirePermission: (permission: string) =>
        async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
          const who = identityOf(req);
          if (!who) throw new UnauthorizedError();
          if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
        },
      auditPort: { record: async (_tx: unknown, entry: unknown) => void world.audit.entries.push({ ctx: school.admin.ctx, entry: { action: (entry as { action: string }).action, resourceType: "x", resourceId: "x" } }), recordPlatform: async () => undefined },
      entitlements: {
        reader: {},
        requireFeature: (feature: string) =>
          async function gate() {
            if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
          },
        isFeatureEnabled: async (_c: unknown, f: string) => features.has(f),
      },
      scopeTrees: {},
      resolveContext: (req: FastifyRequest) => {
        const who = identityOf(req);
        if (!who) throw new UnauthorizedError();
        return who.ctx;
      },
    } as unknown as ModuleRuntime;
    registerHigherPorts(app, world.ports);
    await registerModules(app, {
      enabled: true,
      runtime,
      logger: noopLogger as never,
      importer: (path) => import(/* @vite-ignore */ path),
      discovered: [{ key: "higher", dir: moduleDir, manifestPath: join(moduleDir, "manifest.ts"), manifest, pluginPath: join(moduleDir, "http/plugin.ts"), migrationsDir: join(moduleDir, "migrations") }],
    });
    await app.ready();
  });
  afterAll(async () => {
    resetRegistryForTests();
    await app.close();
    await db.drop();
  });

  const st = () => school.students[0]!;
  const grantBody = (over: Record<string, unknown> = {}) => ({ studentId: st().studentId, enrollmentId: st().enrollmentId, ueNodeId: school.ues[0]!.nodeId, academicPeriodId: school.periodId, reason: "Équivalence reconnue par la direction", ...over });

  it("401 sans contexte ; 403 pour l'enseignant, le secrétariat et le lecteur sur toute écriture ; permissions dédiées", async () => {
    expect((await call(null, "GET", "/exemptions")).status).toBe(401);
    expect((await call(null, "GET", "/annual-ues")).status).toBe(401);
    for (const [who, method, url, body] of [
      ["teacher", "GET", "/exemptions", undefined],
      ["teacher", "POST", "/exemptions", grantBody()],
      ["registrar", "POST", "/exemptions", grantBody()],
      ["registrar", "GET", "/exemptions", undefined],
      ["reader", "POST", "/exemptions", grantBody()],
      ["reader", "POST", `/exemptions/${newId()}/revoke`, { reason: "Motif suffisamment long" }],
      ["reader", "PUT", "/exemption-settings", { exemptionCreditPolicy: "GRANT_CREDITS" }],
      ["reader", "GET", "/exemption-settings", undefined],
      ["registrar", "POST", "/annual-ues", { ueNodeId: school.ues[0]!.nodeId, reason: "Motif de déclaration" }],
      ["teacher", "GET", "/annual-ues", undefined],
    ] as const) {
      expect((await call(who, method, url, body)).status, `${who} ${method} ${url}`).toBe(403);
    }
    expect((await call("reader", "GET", "/exemptions")).status).toBe(200);
  });

  it("validation stricte : motif trop court, champ inconnu, UUID invalide, politique inconnue -> 400 stable", async () => {
    for (const [method, url, body] of [
      ["POST", "/exemptions", grantBody({ reason: "court" })],
      ["POST", "/exemptions", grantBody({ extra: true })],
      ["POST", "/exemptions", grantBody({ studentId: "pas-un-uuid" })],
      ["POST", `/exemptions/${newId()}/revoke`, { reason: "court" }],
      ["PUT", "/exemption-settings", { exemptionCreditPolicy: "TOUT" }],
      ["PUT", "/exemption-settings", {}],
      ["POST", "/annual-ues", { ueNodeId: school.ues[0]!.nodeId, reason: "ab" }],
      ["POST", "/annual-ues", { ueNodeId: school.ues[0]!.nodeId, reason: "Motif suffisant", partsExpected: 9 }],
      ["POST", "/annual-ues", { ueNodeId: school.ues[0]!.nodeId, reason: "Motif suffisant", surprise: 1 }],
    ] as const) {
      const r = await call("admin", method, url, body);
      expect(r.status, `${method} ${url} ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it("dispense : accord (201, DTO conforme), liste filtrée, révocation motivée, politique réglable ; événements conformes aux contrats", async () => {
    const r = await call("direction", "POST", "/exemptions", grantBody());
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const dto = higherExemptionDtoSchema.parse(r.json);
    expect(dto).toMatchObject({ status: "ACTIVE", creditPolicy: "RECORD_ONLY", ledgerId: null, studentId: st().studentId });
    expect((await call("direction", "POST", "/exemptions", grantBody())).json).toMatchObject({ status: 409, code: "higher.exemption_exists" });
    const list = await call("reader", "GET", `/exemptions?studentId=${st().studentId}&status=ACTIVE`);
    expect(list.status).toBe(200);
    expect(list.json.items).toHaveLength(1);
    expect((await call("reader", "GET", `/exemptions?studentId=${school.students[1]!.studentId}`)).json.items).toHaveLength(0);

    const settings = await call("direction", "PUT", "/exemption-settings", { exemptionCreditPolicy: "GRANT_CREDITS" });
    expect(higherExemptionSettingsDtoSchema.parse(settings.json)).toEqual({ exemptionCreditPolicy: "GRANT_CREDITS" });
    expect((await call("direction", "GET", "/exemption-settings")).json).toEqual({ exemptionCreditPolicy: "GRANT_CREDITS" });
    const second = await call("direction", "POST", "/exemptions", grantBody({ ueNodeId: school.ues[1]!.nodeId }));
    expect(second.status).toBe(201);
    expect(higherExemptionDtoSchema.parse(second.json)).toMatchObject({ creditPolicy: "GRANT_CREDITS", credits: 6 });
    expect(second.json.ledgerId).toEqual(expect.any(String));

    const revoked = await call("direction", "POST", `/exemptions/${dto.id}/revoke`, { reason: "Dispense accordée par erreur" });
    expect(revoked.status).toBe(200);
    expect(higherExemptionDtoSchema.parse(revoked.json)).toMatchObject({ status: "REVOKED", revokeReason: "Dispense accordée par erreur" });
    expect((await call("direction", "POST", `/exemptions/${dto.id}/revoke`, { reason: "Encore une fois svp" })).json).toMatchObject({ status: 409, code: "higher.exemption_already_revoked" });
    expect((await call("direction", "POST", `/exemptions/${newId()}/revoke`, { reason: "Dispense inconnue du tenant" })).json).toMatchObject({ status: 404, code: "higher.exemption_not_found" });

    // tous les événements publiés respectent leur schéma versionné
    const events = await adminRows<{ type: string; payload: unknown }>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'higher.ue.%'", [school.tenantId]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["higher.ue.exempted", "higher.ue.exemption_revoked"]));
    for (const e of events) expect((higherEventPayloadSchemas as Record<string, { safeParse(v: unknown): { success: boolean } }>)[e.type]!.safeParse(e.payload).success, e.type).toBe(true);
  });

  it("UE annuelle : déclaration (201, DTO conforme), doublon 409, liste, retrait motivé", async () => {
    const body = { ueNodeId: school.ues[2]!.nodeId, memberNodeIds: [], partsExpected: 2, reason: "UE annuelle de la licence" };
    const created = await call("direction", "POST", "/annual-ues", body);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const dto = higherAnnualUeDtoSchema.parse(created.json);
    expect(dto).toMatchObject({ ueNodeId: school.ues[2]!.nodeId, partsExpected: 2 });
    expect((await call("direction", "POST", "/annual-ues", body)).json).toMatchObject({ status: 409, code: "higher.annual_ue_exists" });
    expect((await call("direction", "POST", "/annual-ues", { ...body, ueNodeId: newId() })).json).toMatchObject({ status: 404, code: "higher.annual_ue_unknown_ue" });
    const list = await call("registrar", "GET", "/annual-ues");
    expect(list.json.items.map((x: { id: string }) => x.id)).toContain(dto.id);
    expect((await call("direction", "POST", `/annual-ues/${dto.id}/remove`, { reason: "ab" })).status).toBe(400);
    expect((await call("direction", "POST", `/annual-ues/${dto.id}/remove`, { reason: "Déclaration erronée" })).json).toEqual({ removed: true });
    expect((await call("direction", "POST", `/annual-ues/${dto.id}/remove`, { reason: "Déclaration erronée" })).json).toMatchObject({ status: 404, code: "higher.annual_ue_not_found" });
  });
});
