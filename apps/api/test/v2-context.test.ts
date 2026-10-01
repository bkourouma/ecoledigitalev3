import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { TenantDb } from "@ecoledigitale/database";
import {
  UnsafeDatabaseRoleError,
  assertSafeDbRole,
  buildRequestContextFromLegacy,
  evaluateRoleSafety,
  v2ContextPlugin,
  type DbRoleRow,
} from "../src/platform/v2-context";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-3f4a5b6c7d8e";
const USER = "0192f0a4-7b1e-7c3a-8d2e-aaaaaaaaaaaa";

const SAFE: DbRoleRow = {
  role: "ed_v2_app",
  rolsuper: false,
  rolbypassrls: false,
  member_of_app_user: true,
  member_of_migrator: false,
  app_user_exists: true,
};

function fakePool(row: Partial<DbRoleRow> = {}) {
  const end = vi.fn(async () => undefined);
  return {
    query: vi.fn(async () => ({ rows: [{ ...SAFE, ...row }] })),
    connect: vi.fn(),
    on: vi.fn(),
    end,
  };
}

describe("vérification du rôle de connexion v2 (refus superuser / BYPASSRLS)", () => {
  it("accepte un rôle LOGIN membre de app_user, sans privilège particulier", () => {
    expect(evaluateRoleSafety(SAFE)).toEqual([]);
  });

  it("refuse un superuser", () => {
    expect(evaluateRoleSafety({ ...SAFE, rolsuper: true }).join(" ")).toMatch(/SUPERUSER/);
  });

  it("refuse BYPASSRLS", () => {
    expect(evaluateRoleSafety({ ...SAFE, rolbypassrls: true }).join(" ")).toMatch(/BYPASSRLS/);
  });

  it("refuse un rôle qui n'est pas membre de app_user, ou si app_user n'existe pas", () => {
    expect(evaluateRoleSafety({ ...SAFE, member_of_app_user: false }).join(" ")).toMatch(/membre de "app_user"/);
    expect(evaluateRoleSafety({ ...SAFE, app_user_exists: false, member_of_app_user: false }).join(" ")).toMatch(/db:v2:migrate/);
  });

  it("refuse un rôle membre de migrator (propriétaire des objets)", () => {
    expect(evaluateRoleSafety({ ...SAFE, member_of_migrator: true }).join(" ")).toMatch(/migrator/);
  });

  it("assertSafeDbRole lève UnsafeDatabaseRoleError avec toutes les raisons", async () => {
    const pool = fakePool({ rolsuper: true, rolbypassrls: true });
    const error = await assertSafeDbRole(pool).catch((e) => e);
    expect(error).toBeInstanceOf(UnsafeDatabaseRoleError);
    expect(error.problems).toHaveLength(2);
    expect(error.message).toContain("ed_v2_app");
  });

  it("assertSafeDbRole renvoie la ligne quand le rôle est sûr", async () => {
    await expect(assertSafeDbRole(fakePool())).resolves.toMatchObject({ role: "ed_v2_app" });
  });
});

describe("plugin v2-context", () => {
  const manifests = [] as never[];

  it("REFUSE de démarrer avec un rôle superuser, et ferme le pool", async () => {
    const pool = fakePool({ rolsuper: true });
    const app = Fastify({ logger: false });
    await expect(app.register(v2ContextPlugin, { pool: pool as never, manifests }).ready()).rejects.toThrow(/SUPERUSER/);
    expect(pool.end).toHaveBeenCalled();
    await app.close().catch(() => undefined);
  });

  it("REFUSE de démarrer avec un rôle BYPASSRLS", async () => {
    const app = Fastify({ logger: false });
    await expect(
      app.register(v2ContextPlugin, { pool: fakePool({ rolbypassrls: true }) as never, manifests }).ready(),
    ).rejects.toThrow(/BYPASSRLS/);
    await app.close().catch(() => undefined);
  });

  it("exige une URL ou un pool", async () => {
    const app = Fastify({ logger: false });
    await expect(app.register(v2ContextPlugin, { manifests }).ready()).rejects.toThrow(/connectionString/);
    await app.close().catch(() => undefined);
  });

  it("décore app.v2 et pose request.ctx depuis l'authentification legacy (hook enregistré après)", async () => {
    const pool = fakePool();
    const app = Fastify({ logger: false });

    // Simule auth-middleware legacy : un hook preHandler enregistré AVANT v2-context.
    app.addHook("preHandler", async (request) => {
      if (request.headers["x-legacy-user"]) {
        request.tenantId = TENANT;
        request.user = { id: USER, email: "a@b.c", tenantId: TENANT, activeRole: "teacher", role: "teacher", roles: ["teacher"] };
      }
    });
    await app.register(v2ContextPlugin, { pool: pool as never, manifests });
    app.get("/api/v1/whoami", async (request) => ({ ctx: request.ctx }));
    await app.ready();

    expect(app.v2.tenantDb).toBeInstanceOf(TenantDb);
    expect(app.v2.systemDb).toBeDefined();
    expect(app.v2.manifests).toBe(manifests);

    const anonymous = await app.inject({ method: "GET", url: "/api/v1/whoami" });
    expect(anonymous.json()).toEqual({ ctx: null });

    const authed = await app.inject({ method: "GET", url: "/api/v1/whoami", headers: { "x-legacy-user": "1" } });
    expect(authed.json().ctx).toMatchObject({ tenantId: TENANT, userId: USER, roles: ["teacher"], actor: "user" });

    await app.close();
    expect(pool.end).toHaveBeenCalled();
  });

  it("n'altère pas le comportement des routes legacy (aucune réponse, aucune erreur)", async () => {
    const app = Fastify({ logger: false });
    await app.register(v2ContextPlugin, { pool: fakePool() as never, manifests });
    app.get("/api/v1/legacy", async () => ({ legacy: true }));
    const res = await app.inject({ method: "GET", url: "/api/v1/legacy", headers: { authorization: "Bearer not-a-jwt" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ legacy: true });
    await app.close();
  });
});

describe("contexte de requête depuis le jeton legacy", () => {
  const base = {
    tenantId: TENANT,
    user: { id: USER, tenantId: TENANT, activeRole: "admin", roles: ["admin"] },
  };

  it("conserve userId, tenantId et le rôle ACTIF seul", () => {
    const ctx = buildRequestContextFromLegacy({
      ...base,
      user: { ...base.user, roles: ["admin", "teacher"] },
    });
    expect(ctx).toMatchObject({ tenantId: TENANT, userId: USER, roles: ["admin"], actor: "user" });
    expect(ctx?.requestId).toBeTruthy();
  });

  it("retombe sur role / roles[0] quand activeRole est absent", () => {
    expect(buildRequestContextFromLegacy({ ...base, user: { id: USER, tenantId: TENANT, role: "parent" } })?.roles).toEqual(["parent"]);
    expect(buildRequestContextFromLegacy({ ...base, user: { id: USER, tenantId: TENANT, roles: ["student"] } })?.roles).toEqual(["student"]);
  });

  it("super-admin avec tenant choisi : actor superAdmin, userId = compte technique usurpé", () => {
    const ctx = buildRequestContextFromLegacy({
      ...base,
      superAdmin: { id: "sa-1" },
      user: { ...base.user, impersonatedBySuperAdminId: "sa-1" },
    });
    expect(ctx).toMatchObject({ actor: "superAdmin", userId: USER, tenantId: TENANT });
  });

  it("reprend un x-request-id sain, ignore les autres", () => {
    expect(buildRequestContextFromLegacy({ ...base, headers: { "x-request-id": "req-abcdef-123" } })?.requestId).toBe("req-abcdef-123");
    const injected = buildRequestContextFromLegacy({ ...base, headers: { "x-request-id": "bad id\n<script>" } });
    expect(injected?.requestId).not.toContain("script");
  });

  it("renvoie null sans utilisateur, avec un identifiant non UUID, ou des tenants discordants", () => {
    expect(buildRequestContextFromLegacy({ tenantId: TENANT })).toBeNull();
    expect(buildRequestContextFromLegacy({ ...base, tenantId: "not-a-uuid", user: { id: USER } })).toBeNull();
    expect(buildRequestContextFromLegacy({ ...base, user: { ...base.user, id: "42" } })).toBeNull();
    expect(
      buildRequestContextFromLegacy({ ...base, user: { ...base.user, tenantId: "0192f0a4-7b1e-7c3a-8d2e-bbbbbbbbbbbb" } }),
    ).toBeNull();
  });

  it("le contexte est gelé", () => {
    expect(Object.isFrozen(buildRequestContextFromLegacy(base))).toBe(true);
  });
});
