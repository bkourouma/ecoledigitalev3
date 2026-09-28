import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "@jest/globals";
import Fastify, { type FastifyInstance } from "fastify";
import { ownerRoutes } from "../routes/owner";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

/*
   LE MOCK DE `owner-dashboard.service` A DISPARU AVEC LUI (23/09/2026).

   L'endpoint `GET /owner/dashboard` et son service de 434 lignes ont été
   retirés : plus aucune des trois applications du monorepo ne les appelait, et
   l'écran `/owner/dashboard` lit `/owner/pulse` et `/owner/tresorerie`.

   Les deux tests de GARDE qu'il portait sont conservés, portés sur `/scolarite`
   — une route `requireOwner` bien vivante. C'est le garde-fou qui compte, pas la
   route sur laquelle on l'éprouve : un 403 est rendu par le `preHandler` avant
   tout accès aux données, donc n'importe quelle route protégée fait l'affaire.

   Le troisième test (200 avec le rôle owner) n'est PAS reporté : il exigeait un
   mock de base réaliste, et un 200 obtenu sur un client qui renvoie des lignes
   vides ne prouverait rien de plus que l'absence de crash.
*/

vi.mock("../services/owner-users.service", () => ({
  OWNER_ASSIGNABLE_ROLE_KEYS: ["admin", "teacher", "student", "parent", "formateur"],
  listOwnerTenantUsers: vi.fn().mockResolvedValue([]),
  patchUserRolesAsOwner: vi.fn().mockResolvedValue({
    ok: true,
    body: {
      userId: "22222222-2222-2222-2222-222222222222",
      email: "admin@ecoledigitale.local",
      firstName: "Admin",
      lastName: "Tenant",
      roleKeys: ["admin"],
    },
  }),
}));

describe("routes /api/v1/owner (gardes + accès)", () => {
  let app: FastifyInstance;

  const mockClient = {
    query: vi.fn(async (sql: string) => {
      if (/set_config/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorate("pg", {
      connect: vi.fn(async () => mockClient),
    });

    app.addHook("preHandler", async (req: any) => {
      if (typeof req.url === "string" && req.url.startsWith("/api/v1/owner")) {
        req.tenantId = TENANT_ID;
        const roleHeader = req.headers["x-test-role"];
        const role = typeof roleHeader === "string" ? roleHeader : "teacher";
        req.user = {
          id: "11111111-1111-1111-1111-111111111111",
          email: "owner-test@ecoledigitale.test",
          roles: [role],
          tenantId: TENANT_ID,
        };
      }
    });

    await app.register(ownerRoutes, { prefix: "/api/v1/owner" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /scolarite -> 403 without owner role", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/owner/scolarite" });
    expect(res.statusCode).toBe(403);
  });

  /*
     Le rôle admin seul ne suffit pas sur une route `requireOwner`, et ce test
     tient toujours après le correctif du 403 owner+admin : le middleware
     autorise désormais sur `availableRoles`, que ce faux utilisateur ne porte
     pas. Un admin qui n'est PAS owner reste dehors — c'était tout l'enjeu de ne
     pas élargir `roles` à la source.
  */
  it("GET /scolarite -> 403 with admin role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/owner/scolarite",
      headers: { "x-test-role": "admin" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /roles/assignable -> 200 with admin role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/owner/roles/assignable",
      headers: { "x-test-role": "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      roleKeys: ["admin", "teacher", "student", "parent", "formateur"],
    });
  });

  it("GET /users -> 200 with admin role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/owner/users",
      headers: { "x-test-role": "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ users: [] });
  });

  it("PATCH /users/:userId/roles -> 200 with admin role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/owner/users/22222222-2222-2222-2222-222222222222/roles",
      headers: { "x-test-role": "admin", "content-type": "application/json" },
      payload: { roleKeys: ["admin"] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      userId: "22222222-2222-2222-2222-222222222222",
      email: "admin@ecoledigitale.local",
      firstName: "Admin",
      lastName: "Tenant",
      roleKeys: ["admin"],
    });
  });
});
