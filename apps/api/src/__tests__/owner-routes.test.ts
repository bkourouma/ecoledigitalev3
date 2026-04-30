import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "@jest/globals";
import Fastify, { type FastifyInstance } from "fastify";
import { ownerRoutes } from "../routes/owner";
import type { OwnerDashboardResponse } from "@ecoledigitale/contracts";

const TENANT_ID = "e9f4c59f-0666-4dc7-a7d4-c63004000791";

vi.mock("../services/owner-dashboard.service", () => ({
  fetchOwnerDashboardKpis: vi.fn().mockResolvedValue({
    finances: {
      revenueCurrentMonth: 0,
      recoveryRate: 0,
      recoveryByCycle: [],
      teacherPaymentRate: 0,
      overdueCount: 0,
    },
    academic: {
      totalStudents: 0,
      totalClasses: 0,
      averageGrade: 0,
      successRate: 0,
      attendanceRate: 0,
      assignmentsGradedRate: 0,
    },
    staff: {
      activeTeachers: 0,
      totalHoursTaught: 0,
      coursesWithoutTeacher: 0,
      pendingPayrollValidations: 0,
    },
    formations: {
      activeSessions: 0,
      totalEnrollments: 0,
      revenueFormations: 0,
      clientCompanies: 0,
    },
  }),
}));

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

describe("routes /api/v1/owner (guards + dashboard)", () => {
  let app: FastifyInstance;

  const mockClient = {
    query: vi.fn(async (sql: string) => {
      if (/set_config/i.test(sql)) return { rows: [] };
      if (/owner_pilotage_alerts/i.test(sql) && /SELECT/i.test(sql)) return { rows: [] };
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

  it("GET /dashboard -> 403 without owner role", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/owner/dashboard" });
    expect(res.statusCode).toBe(403);
  });

  it("GET /dashboard -> 403 with admin role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { "x-test-role": "admin" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /dashboard -> 200 with owner role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { "x-test-role": "owner" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as OwnerDashboardResponse;
    expect(body.finances).toBeDefined();
    expect(body.alerts).toEqual([]);
  });

  it("PATCH /alerts/:id/acknowledge -> 403 without owner role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/owner/alerts/00000000-0000-0000-0000-000000000001/acknowledge",
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
