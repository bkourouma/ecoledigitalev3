/**
 * De bout en bout sur un vrai Postgres : démarrage de la plateforme v2 dans une instance Fastify
 * (registre + v2-context + synchronisation des tenants) avec un module GÉNÉRÉ, authentification
 * legacy simulée, et preuve que la RLS isole deux tenants à travers l'API.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { migrate } from "@ecoledigitale/database";
import { noopLogger, systemClock } from "@ecoledigitale/kernel";
import { getLoadedManifests, resetRegistryForTests } from "../../src/modules/registry";
import { buildPermissionSet } from "../../src/modules/rbac/domain/permission-set";
import { EMPTY_SCOPE_TREE, TENANT_SCOPE } from "../../src/modules/rbac/domain/scope";
import { scaffoldModule } from "../../src/platform/module-scaffold";
import { UnsafeDatabaseRoleError } from "../../src/platform/v2-context";
import { createLoginRole } from "../../src/platform/v2-login-role";
import { runV2Migrations } from "../../src/platform/v2-migrations";
import { configureTenantSync, syncAllTenantsToKernel, syncTenantToKernel } from "../../src/platform/tenant-sync";
import { registerV2Platform } from "../../src/platform/v2-bootstrap";
import { createEphemeralDb, describeIntegration, randomSuffix, type EphemeralDb } from "../helpers/fixtures";

const TENANT_A = "0192f0a4-7b1e-7c3a-8d2e-00000000000a";
const TENANT_B = "0192f0a4-7b1e-7c3a-8d2e-00000000000b";
const USER_A = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER_B = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = resolve(here, `.tmp-e2e-${process.pid}`);
const AUDIT_MIGRATIONS_DIR = resolve(here, "../../src/modules/audit/migrations");
const GENERATED_PERMISSIONS = ["e2e_demo.item.read", "e2e_demo.item.create"];

describeIntegration("plateforme v2 de bout en bout", () => {
  let db: EphemeralDb;
  const roleName = `ed_e2e_${randomSuffix()}`;
  let appUrl: string;
  const legacyTenants = [
    { id: TENANT_A, slug: "École A", name: "École A", is_active: true },
    { id: TENANT_B, slug: "ecole-b", name: "École B", is_active: true },
  ];
  const legacyPool = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        const rows = /WHERE id = \$1/.test(sql) ? legacyTenants.filter((t) => t.id === values?.[0]) : legacyTenants;
        return { rows };
      },
      release: () => undefined,
    }),
  };

  beforeAll(async () => {
    mkdirSync(sandbox, { recursive: true });
    scaffoldModule({ key: "e2e_demo", modulesDir: sandbox });
    db = await createEphemeralDb("test", [roleName]);
    await runV2Migrations({ url: db.adminUrl, modulesDir: sandbox, logger: noopLogger });
    // Le module généré audite par runtime.auditPort (= le vrai module audit) : ses tables doivent exister.
    await migrate({ client: db.admin, dirs: [AUDIT_MIGRATIONS_DIR], table: "schema_migrations_audit", role: "migrator", logger: noopLogger });
    appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role: roleName })).applicationUrl;
  }, 120_000);

  afterAll(async () => {
    rmSync(sandbox, { recursive: true, force: true });
    await db?.drop();
  });

  let app: FastifyInstance;
  beforeEach(() => {
    resetRegistryForTests();
    app = Fastify({ logger: false });
    // Le module généré se protège par runtime.requirePermission (rbac). Le module rbac n'est pas chargé dans ce bac à
    // sable : on pose sa décoration racine (app.rbac) avec un rôle fictif qui accorde les permissions du module généré
    // à tout utilisateur authentifié. Le comportement réel du RBAC est couvert par les tests du module rbac.
    app.decorate("rbac", {
      clock: systemClock,
      logger: noopLogger,
      scopeTrees: { forTenant: async () => EMPTY_SCOPE_TREE },
      permissions: {
        get: async (ctx: { tenantId: string; userId: string | null }) =>
          buildPermissionSet({
            tenantId: ctx.tenantId,
            userId: ctx.userId as string,
            assignments: [{ assignmentId: "e2e-assignment", roleId: "e2e-role", scope: TENANT_SCOPE, validFrom: null, validUntil: null }],
            rolePermissions: new Map([["e2e-role", GENERATED_PERMISSIONS]]),
            sensitive: [],
            now: systemClock.now(),
          }),
      },
    } as never);
    // Simule l'authentification legacy (auth-middleware) : en-têtes -> request.user / tenantId.
    app.addHook("preHandler", async (request) => {
      const user = request.headers["x-legacy-user"];
      const tenant = request.headers["x-legacy-tenant"];
      if (typeof user === "string" && typeof tenant === "string") {
        request.tenantId = tenant;
        request.user = { id: user, email: "x@y.z", tenantId: tenant, activeRole: "admin", role: "admin", roles: ["admin"] };
      }
    });
  });
  afterEach(async () => {
    configureTenantSync(null);
    await app.close();
  });

  const asA = { "x-legacy-user": USER_A, "x-legacy-tenant": TENANT_A };
  const asB = { "x-legacy-user": USER_B, "x-legacy-tenant": TENANT_B };

  it("sans V2_DATABASE_URL : avertit et ne charge RIEN (l'API legacy démarre normalement)", async () => {
    const status = await registerV2Platform(app, { env: {}, modulesDir: sandbox });
    expect(status).toEqual({ enabled: false, modules: [] });
    expect(app.hasDecorator("v2")).toBe(false);
    expect(getLoadedManifests()).toEqual([]);
    app.get("/api/v1/legacy", async () => ({ legacy: true }));
    expect((await app.inject({ method: "GET", url: "/api/v1/legacy" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/e2e_demo/items", headers: asA })).statusCode).toBe(404);
  });

  it("REFUSE de démarrer avec V2_DATABASE_URL pointant sur un superuser", async () => {
    await expect(registerV2Platform(app, { env: { V2_DATABASE_URL: db.adminUrl }, modulesDir: sandbox, legacyPool })).rejects.toBeInstanceOf(
      UnsafeDatabaseRoleError,
    );
  });

  it("charge le module généré, synchronise les tenants, pose request.ctx et isole A / B via la RLS", async () => {
    const status = await registerV2Platform(app, { env: { V2_DATABASE_URL: appUrl }, modulesDir: sandbox, legacyPool });
    expect(status).toEqual({ enabled: true, modules: ["e2e_demo"] });
    expect(getLoadedManifests().map((m) => m.key)).toEqual(["e2e_demo"]);
    expect(app.v2.manifests.map((m) => m.key)).toEqual(["e2e_demo"]);

    // Synchronisation à sens unique au démarrage : mêmes UUID, slug normalisé.
    const synced = await db.admin.query("SELECT id, slug, status FROM kernel.tenants ORDER BY slug");
    expect(synced.rows).toEqual([
      { id: TENANT_A, slug: "ecole-a", status: "active" },
      { id: TENANT_B, slug: "ecole-b", status: "active" },
    ]);

    // Sans authentification legacy : 401 posé par la garde du module.
    expect((await app.inject({ method: "GET", url: "/api/v1/e2e_demo/items" })).statusCode).toBe(401);

    // A crée deux éléments, B un seul.
    for (const label of ["Alpha", "Beta"]) {
      const created = await app.inject({ method: "POST", url: "/api/v1/e2e_demo/items", headers: asA, payload: { label } });
      expect(created.statusCode).toBe(201);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/e2e_demo/items", headers: asB, payload: { label: "Gamma" } })).statusCode).toBe(201);

    const listA = (await app.inject({ method: "GET", url: "/api/v1/e2e_demo/items", headers: asA })).json().items;
    const listB = (await app.inject({ method: "GET", url: "/api/v1/e2e_demo/items", headers: asB })).json().items;
    expect(listA.map((i: { label: string }) => i.label).sort()).toEqual(["Alpha", "Beta"]);
    expect(listB.map((i: { label: string }) => i.label)).toEqual(["Gamma"]);
    expect(new Set(listA.map((i: { tenantId: string }) => i.tenantId))).toEqual(new Set([TENANT_A]));

    // Validation : erreur du kernel traduite en 400 JSON stable.
    const invalid = await app.inject({ method: "POST", url: "/api/v1/e2e_demo/items", headers: asA, payload: { label: "   " } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "VALIDATION_FAILED", kind: "validation" });

    // L'événement d'outbox a été écrit dans la même transaction, pour le bon tenant.
    const events = await db.admin.query(
      "SELECT tenant_id, type, payload->>'v' AS v FROM kernel.domain_events ORDER BY tenant_id, id",
    );
    expect(events.rows.filter((r) => r.tenant_id === TENANT_A)).toHaveLength(2);
    expect(events.rows.filter((r) => r.tenant_id === TENANT_B)).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ type: "e2e_demo.item.created", v: "1" });

    // L'audit (runtime.auditPort -> audit.record) a été écrit dans la même transaction, pour le bon tenant.
    const audited = await db.admin.query("SELECT tenant_id, action, entity FROM audit.audit_log WHERE action = 'e2e_demo.item.create'");
    expect(audited.rows.filter((r) => r.tenant_id === TENANT_A)).toHaveLength(2);
    expect(audited.rows.filter((r) => r.tenant_id === TENANT_B)).toHaveLength(1);
    expect(audited.rows[0]).toMatchObject({ entity: "item" });
  });

  it("syncTenantToKernel : statut suspendu, jamais de désarchivage, collision de slug désambiguïsée", async () => {
    await registerV2Platform(app, { env: { V2_DATABASE_URL: appUrl }, modulesDir: sandbox, legacyPool });

    // Suspension côté legacy -> 'suspended' côté v2.
    legacyTenants[1] = { ...legacyTenants[1]!, is_active: false };
    expect(await syncTenantToKernel(TENANT_B)).toBe("synced");
    expect((await db.admin.query("SELECT status FROM kernel.tenants WHERE id = $1", [TENANT_B])).rows[0]?.status).toBe("suspended");

    // Un tenant archivé côté v2 le reste, même si le legacy est actif.
    await db.admin.query("UPDATE kernel.tenants SET status = 'archived' WHERE id = $1", [TENANT_A]);
    expect(await syncTenantToKernel(TENANT_A)).toBe("synced");
    expect((await db.admin.query("SELECT status FROM kernel.tenants WHERE id = $1", [TENANT_A])).rows[0]?.status).toBe("archived");

    // Nouveau tenant legacy dont le slug normalisé entre en collision avec un slug existant.
    const TENANT_C = "0192f0a4-7b1e-7c3a-8d2e-00000000000c";
    legacyTenants.push({ id: TENANT_C, slug: "ECOLE-B", name: "Doublon", is_active: true });
    const report = await syncAllTenantsToKernel();
    expect(report.disambiguated).toBe(1);
    const slugs = (await db.admin.query("SELECT slug FROM kernel.tenants WHERE id = $1", [TENANT_C])).rows[0]?.slug;
    expect(slugs).toBe("ecole-b-0192f0a4");
    legacyTenants.pop();
  });
});
