import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { InMemoryEventBus, createRequestContext, createSystemContext, noopLogger, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import {
  rbacAssignmentSchema,
  rbacMyPermissionsResponseSchema,
  rbacNavigationResponseSchema,
  rbacPermissionCatalogResponseSchema,
  rbacRoleDetailSchema,
  rbacRoleListResponseSchema,
} from "@ecoledigitale/contracts/src/v2/rbac";
import {
  TENANT_SCOPE,
  instantiateSystemRoles,
  rbacPlugin,
  scopeTreeFromPairs,
  syncPermissionCatalog,
  type AuditEntry,
} from "../index";
import { assignRoleUseCase } from "../application/assignments";
import { ALL_MANIFESTS, CAMPUS_A1, INST_A } from "./fixtures";
import { createRbacTestDb, describeIntegration, type RbacTestDb } from "./db";

const OWNER = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const TEACHER = "a1a1a1a1-0000-4a1a-8a1a-a1a1a1a1a1a1";
const STRANGER = "a2a2a2a2-0000-4a2a-8a2a-a2a2a2a2a2a2";
const OWNER_B = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";

describeIntegration("rbac — routes HTTP (Fastify + base réelle)", () => {
  let db: RbacTestDb;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  const audits: AuditEntry[] = [];
  const bus = new InMemoryEventBus({ errorMode: "isolate" });

  const as = (tenantId: string, userId: string, mfa = false, extra: Record<string, string> = {}) => ({
    "x-tenant": tenantId,
    "x-user": userId,
    "x-mfa": mfa ? "1" : "0",
    ...extra,
  });

  const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: Record<string, string>, payload?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1/rbac${url}`, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.body ? (res.json() as Record<string, any>) : {} };
  };

  async function bootstrapOwner(tenantId: string, userId: string): Promise<void> {
    const sys = createSystemContext(tenantId);
    await db.tenantDb.run(sys, async (tx) => {
      const owner = await tx.queryOne<{ id: string }>("SELECT id FROM rbac.roles WHERE template_key = 'owner'");
      const r = await assignRoleUseCase(
        { tx, clock: systemClock, outbox: new PgOutboxWriter(tx), audit: { record: async () => undefined }, logger: noopLogger },
        sys,
        { userId, roleId: (owner as { id: string }).id, scope: TENANT_SCOPE },
      );
      if (!r.ok) throw r.error;
    });
  }

  beforeAll(async () => {
    db = await createRbacTestDb();
    await db.systemDb.run("rbac-http-sync", (tx) => syncPermissionCatalog(tx, ALL_MANIFESTS));
    tenantA = await db.createTenant("http-a");
    tenantB = await db.createTenant("http-b");
    for (const t of [tenantA, tenantB]) await db.systemDb.runForTenant("rbac-http-prov", t, (tx) => instantiateSystemRoles(tx, t, { logger: noopLogger }));
    await bootstrapOwner(tenantA, OWNER);
    await bootstrapOwner(tenantB, OWNER_B);

    app = Fastify();
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-tenant"];
      const user = req.headers["x-user"];
      if (!tenant || !user) return;
      const campus = req.headers["x-campus"];
      (req as unknown as { ctx: RequestContext }).ctx = createRequestContext({
        tenantId: String(tenant),
        userId: String(user),
        mfa: req.headers["x-mfa"] === "1",
        ...(campus ? { campusId: String(campus), institutionId: INST_A } : {}),
      });
    });
    await app.register(rbacPlugin, {
      tenantDb: db.tenantDb,
      manifests: ALL_MANIFESTS,
      eventBus: bus,
      audit: { record: async (_tx, entry) => void audits.push(entry) },
      scopeTrees: { forTenant: async () => scopeTreeFromPairs({ [CAMPUS_A1]: INST_A }) },
      logger: noopLogger,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("401 sans contexte authentifié", async () => {
    const res = await call("GET", "/roles", {});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("refuse par défaut : un utilisateur sans rôle n'accède à rien de sensible", async () => {
    for (const [method, url] of [
      ["GET", "/roles"],
      ["GET", "/permissions"],
      ["GET", "/assignments"],
      ["POST", "/roles"],
      ["POST", "/assignments"],
    ] as const) {
      const res = await call(method, url, as(tenantA, STRANGER, true), method === "POST" ? {} : undefined);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    // ses propres droits, eux, sont lisibles : vides
    const me = await call("GET", "/me/permissions", as(tenantA, STRANGER));
    expect(me.status).toBe(200);
    expect(me.body.permissions).toEqual([]);
    const nav = await call("GET", "/me/navigation", as(tenantA, STRANGER));
    expect(rbacNavigationResponseSchema.parse(nav.body).availablePortals).toEqual([]);
  });

  it("GET /me/permissions et /me/navigation reflètent les droits ET la MFA", async () => {
    const weak = await call("GET", "/me/permissions", as(tenantA, OWNER, false));
    const parsedWeak = rbacMyPermissionsResponseSchema.parse(weak.body);
    expect(parsedWeak.mfa).toBe(false);
    expect(parsedWeak.permissions.map((p) => p.key)).toContain("rbac.role.read");
    expect(parsedWeak.permissions.map((p) => p.key)).not.toContain("rbac.role.manage");
    expect(parsedWeak.requiresMfa).toEqual(expect.arrayContaining(["rbac.role.manage", "rbac.assignment.manage", "grade.publish"]));
    expect(parsedWeak.permissions.find((p) => p.key === "rbac.role.read")?.scopes).toEqual([{ type: "tenant" }]);

    const strong = rbacMyPermissionsResponseSchema.parse((await call("GET", "/me/permissions", as(tenantA, OWNER, true))).body);
    expect(strong.requiresMfa).toEqual([]);
    expect(strong.permissions.map((p) => p.key)).toContain("rbac.role.manage");

    const navWeak = rbacNavigationResponseSchema.parse((await call("GET", "/me/navigation", as(tenantA, OWNER, false))).body);
    expect(navWeak.portals.admin.map((i) => i.key)).toContain("rbac.roles");
    expect(navWeak.portals.admin.map((i) => i.key)).not.toContain("rbac.assignments"); // permission sensible sans MFA
    const navStrong = rbacNavigationResponseSchema.parse((await call("GET", "/me/navigation", as(tenantA, OWNER, true))).body);
    expect(navStrong.portals.admin.map((i) => i.key)).toEqual(expect.arrayContaining(["students.list", "finance.payments", "rbac.roles", "rbac.assignments"]));
    // la feature `assess.advanced-reports` (pack HIGHER) n'est pas activée par défaut : pas de menu associé
    expect(navStrong.portals.admin.map((i) => i.key)).not.toContain("assess.reports");
    expect(navStrong.portals.teacher.map((i) => i.key)).toEqual(["assess.grades"]);
  });

  it("GET /permissions : catalogue avec module d'origine", async () => {
    const res = await call("GET", "/permissions", as(tenantA, OWNER));
    const parsed = rbacPermissionCatalogResponseSchema.parse(res.body);
    expect(parsed.permissions.find((p) => p.key === "grade.publish")).toMatchObject({ moduleKey: "assess", moduleTitle: "Évaluations", sensitive: true });
    expect(parsed.permissions.find((p) => p.key === "rbac.role.read")?.moduleTitle).toBe("Rôles et permissions");
  });

  it("GET /roles : les quatorze modèles système, verrouillés ; détail avec permissions", async () => {
    const res = await call("GET", "/roles", as(tenantA, OWNER));
    const list = rbacRoleListResponseSchema.parse(res.body);
    expect(list.roles.filter((r) => r.isSystem)).toHaveLength(14);
    expect(list.roles.filter((r) => r.isSystem).every((r) => r.locked)).toBe(true);
    const econome = list.roles.find((r) => r.key === "econome");
    expect(econome?.pendingCount).toBeGreaterThan(0); // `payroll.payslip.pay` n'existe pas encore dans ce catalogue

    const detail = rbacRoleDetailSchema.parse((await call("GET", `/roles/${econome?.id}`, as(tenantA, OWNER))).body);
    expect(detail.permissions).toContain("finance.payment.create");
    expect(detail.pendingPermissions).toContain("payroll.payslip.pay");
  });

  it("création / clonage / modification / suppression d'un rôle personnalisé, avec MFA", async () => {
    audits.length = 0;
    const noMfa = await call("POST", "/roles", as(tenantA, OWNER, false), { label: "Comptable", permissions: ["finance.invoice.read"] });
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.code).toBe("rbac.mfa_required");

    const created = await call("POST", "/roles", as(tenantA, OWNER, true), { label: "Comptable", permissions: ["finance.invoice.read", "finance.payment.read"] });
    expect(created.status).toBe(201);
    const role = rbacRoleDetailSchema.parse(created.body);
    expect(role).toMatchObject({ key: "comptable", isSystem: false, locked: false });

    const cloned = await call("POST", `/roles/${role.id}/clone`, as(tenantA, OWNER, true), { label: "Comptable senior" });
    expect(cloned.status).toBe(201);
    const clone = rbacRoleDetailSchema.parse(cloned.body);
    expect(clone).toMatchObject({ key: "comptable_senior", clonedFromRoleId: role.id });
    expect(clone.permissions).toEqual(role.permissions);

    const patched = await call("PATCH", `/roles/${clone.id}`, as(tenantA, OWNER, true), { permissions: ["finance.invoice.read", "finance.invoice.create"], description: "Peut facturer" });
    expect(patched.status).toBe(200);
    expect(rbacRoleDetailSchema.parse(patched.body).permissions).toEqual(["finance.invoice.create", "finance.invoice.read"]);
    expect(patched.body.description).toBe("Peut facturer");

    const deleted = await call("DELETE", `/roles/${clone.id}`, as(tenantA, OWNER, true));
    expect(deleted.status).toBe(200);
    expect((await call("GET", `/roles/${clone.id}`, as(tenantA, OWNER))).status).toBe(404);
    expect(audits.map((a) => a.action)).toEqual(["rbac.role.created", "rbac.role.cloned", "rbac.role.updated", "rbac.role.deleted"]);
  });

  it("validation : corps invalide -> 400 avec issues ; permission inconnue -> 400 ; JSON cassé -> 400", async () => {
    const bad = await call("POST", "/roles", as(tenantA, OWNER, true), { label: "", permissions: ["finance.*"], extra: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    expect(bad.body.issues.length).toBeGreaterThan(0);

    const unknown = await call("POST", "/roles", as(tenantA, OWNER, true), { label: "Fantôme", permissions: ["ghost.power"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("rbac.unknown_permission");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/rbac/roles",
      headers: { ...as(tenantA, OWNER, true), "content-type": "application/json" },
      payload: "{pas du json",
    });
    expect(res.statusCode).toBe(400);

    const badId = await call("GET", "/roles/pas-un-uuid", as(tenantA, OWNER));
    expect(badId.status).toBe(400);
  });

  it("rôle système : verrouillé (PATCH et DELETE -> 403 rbac.role_locked)", async () => {
    const list = rbacRoleListResponseSchema.parse((await call("GET", "/roles", as(tenantA, OWNER))).body);
    const id = list.roles.find((r) => r.key === "directeur")?.id;
    const patch = await call("PATCH", `/roles/${id}`, as(tenantA, OWNER, true), { label: "Piraté" });
    expect(patch.status).toBe(403);
    expect(patch.body.code).toBe("rbac.role_locked");
    expect((await call("DELETE", `/roles/${id}`, as(tenantA, OWNER, true))).body.code).toBe("rbac.role_locked");
  });

  it("assignation -> droits effectifs immédiats (cache invalidé), retrait -> perte immédiate", async () => {
    const list = rbacRoleListResponseSchema.parse((await call("GET", "/roles", as(tenantA, OWNER))).body);
    const teacherRole = list.roles.find((r) => r.key === "enseignant")?.id as string;

    // avant : aucun droit (et la réponse est mise en cache)
    expect((await call("GET", "/me/permissions", as(tenantA, TEACHER))).body.permissions).toEqual([]);
    expect((await call("GET", "/roles", as(tenantA, TEACHER))).status).toBe(403);

    const created = await call("POST", "/assignments", as(tenantA, OWNER, true), { userId: TEACHER, roleId: teacherRole, scope: { type: "tenant" } });
    expect(created.status).toBe(201);
    const assignment = rbacAssignmentSchema.parse(created.body);
    expect(assignment).toMatchObject({ userId: TEACHER, roleKey: "enseignant", scope: { type: "tenant" } });

    const after = rbacMyPermissionsResponseSchema.parse((await call("GET", "/me/permissions", as(tenantA, TEACHER))).body);
    expect(after.permissions.map((p) => p.key)).toContain("grade.enter");
    expect(after.permissions.map((p) => p.key)).not.toContain("grade.publish");
    // l'enseignant n'a toujours pas le droit de gérer les rôles, ni même de les lire
    expect((await call("POST", "/roles", as(tenantA, TEACHER, true), { label: "Pirate", permissions: [] })).status).toBe(403);
    expect((await call("GET", "/roles", as(tenantA, TEACHER))).status).toBe(403);
    const nav = rbacNavigationResponseSchema.parse((await call("GET", "/me/navigation", as(tenantA, TEACHER))).body);
    expect(nav.portals.teacher.map((i) => i.key)).toEqual(["assess.grades"]);

    const listed = await call("GET", `/assignments?userId=${TEACHER}`, as(tenantA, OWNER));
    expect(listed.body.assignments).toHaveLength(1);

    const revoked = await call("DELETE", `/assignments/${assignment.id}`, as(tenantA, OWNER, true));
    expect(revoked.status).toBe(200);
    expect((await call("GET", "/me/permissions", as(tenantA, TEACHER))).body.permissions).toEqual([]);
  });

  it("assignation limitée à un campus : valide pour ce campus, inconnue ailleurs ; l'enseignant n'a droit qu'à son campus", async () => {
    const list = rbacRoleListResponseSchema.parse((await call("GET", "/roles", as(tenantA, OWNER))).body);
    const teacherRole = list.roles.find((r) => r.key === "enseignant")?.id as string;

    const unknown = await call("POST", "/assignments", as(tenantA, OWNER, true), {
      userId: TEACHER,
      roleId: teacherRole,
      scope: { type: "campus", id: "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4" },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("rbac.unknown_scope");

    const ok = await call("POST", "/assignments", as(tenantA, OWNER, true), {
      userId: TEACHER,
      roleId: teacherRole,
      scope: { type: "campus", id: CAMPUS_A1 },
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.scope).toEqual({ type: "campus", id: CAMPUS_A1 });

    const me = rbacMyPermissionsResponseSchema.parse((await call("GET", "/me/permissions", as(tenantA, TEACHER, false, { "x-campus": CAMPUS_A1 }))).body);
    expect(me.permissions.find((p) => p.key === "grade.enter")?.scopes).toEqual([{ type: "campus", id: CAMPUS_A1 }]);

    // modifie la validité, puis retire
    const patched = await call("PATCH", `/assignments/${ok.body.id}`, as(tenantA, OWNER, true), { validUntil: null });
    expect(patched.status).toBe(200);
    expect(patched.body.validUntil).toBeNull();
    expect((await call("DELETE", `/assignments/${ok.body.id}`, as(tenantA, OWNER, true))).status).toBe(200);
  });

  it("un rôle assigné ne se supprime pas (409 rbac.role_in_use)", async () => {
    const created = rbacRoleDetailSchema.parse((await call("POST", "/roles", as(tenantA, OWNER, true), { label: "Utilisé", permissions: ["student.read"] })).body);
    const a = await call("POST", "/assignments", as(tenantA, OWNER, true), { userId: STRANGER, roleId: created.id });
    expect(a.status).toBe(201);
    const del = await call("DELETE", `/roles/${created.id}`, as(tenantA, OWNER, true));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("rbac.role_in_use");
    await call("DELETE", `/assignments/${a.body.id}`, as(tenantA, OWNER, true));
    expect((await call("DELETE", `/roles/${created.id}`, as(tenantA, OWNER, true))).status).toBe(200);
  });

  it("le dernier propriétaire ne peut pas être retiré (409 rbac.last_owner)", async () => {
    const list = rbacAssignmentSchemaList((await call("GET", `/assignments?userId=${OWNER}`, as(tenantA, OWNER))).body);
    const res = await call("DELETE", `/assignments/${list[0]?.id}`, as(tenantA, OWNER, true));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("rbac.last_owner");
  });

  it("isolation entre tenants à travers l'API", async () => {
    const listA = rbacRoleListResponseSchema.parse((await call("GET", "/roles", as(tenantA, OWNER))).body);
    const listB = rbacRoleListResponseSchema.parse((await call("GET", "/roles", as(tenantB, OWNER_B))).body);
    const idsA = new Set(listA.roles.map((r) => r.id));
    expect(listB.roles.some((r) => idsA.has(r.id))).toBe(false);
    expect(listB.roles.filter((r) => r.isSystem)).toHaveLength(14);
    expect(listB.roles.every((r) => r.key !== "comptable")).toBe(true); // rôle personnalisé de A invisible

    const foreign = listA.roles.find((r) => r.key === "econome")?.id;
    expect((await call("GET", `/roles/${foreign}`, as(tenantB, OWNER_B))).status).toBe(404);
    expect((await call("PATCH", `/roles/${foreign}`, as(tenantB, OWNER_B, true), { label: "x" })).status).toBe(404);
    expect((await call("DELETE", `/roles/${foreign}`, as(tenantB, OWNER_B, true))).status).toBe(404);
    expect((await call("POST", "/assignments", as(tenantB, OWNER_B, true), { userId: STRANGER, roleId: foreign })).status).toBe(404);

    // l'owner de A n'a aucun droit dans B : même utilisateur, autre tenant -> refus
    const crossTenant = await call("GET", "/roles", as(tenantB, OWNER));
    expect(crossTenant.status).toBe(403);
    // les assignations de A sont invisibles de B
    const assignmentsB = await call("GET", "/assignments", as(tenantB, OWNER_B));
    expect(assignmentsB.body.assignments.every((a: { userId: string }) => a.userId === OWNER_B)).toBe(true);
  });

  it("l'abonnement au bus d'événements invalide le cache entre instances", async () => {
    // Simule l'autre instance : un droit retiré directement en base, puis l'événement relayé.
    const list = rbacRoleListResponseSchema.parse((await call("GET", "/roles", as(tenantA, OWNER))).body);
    const teacherRole = list.roles.find((r) => r.key === "enseignant")?.id as string;
    const a = await call("POST", "/assignments", as(tenantA, OWNER, true), { userId: STRANGER, roleId: teacherRole });
    expect((await call("GET", "/me/permissions", as(tenantA, STRANGER))).body.permissions.length).toBeGreaterThan(0); // chauffe le cache

    await db.admin.query("DELETE FROM rbac.user_role_assignments WHERE id = $1", [a.body.id]); // « autre instance »
    expect((await call("GET", "/me/permissions", as(tenantA, STRANGER))).body.permissions.length).toBeGreaterThan(0); // cache encore chaud

    await bus.publish({
      id: "e1",
      type: "rbac.assignment.changed",
      version: 1,
      tenantId: tenantA,
      occurredAt: new Date().toISOString(),
      payload: { v: 1, change: "revoked", userId: STRANGER },
    });
    expect((await call("GET", "/me/permissions", as(tenantA, STRANGER))).body.permissions).toEqual([]);
  });

  it("les événements rbac.* sont écrits dans l'outbox de leur tenant, dans la transaction", async () => {
    const rows = await db.admin.query(
      "SELECT tenant_id, type, payload FROM kernel.domain_events WHERE type IN ('rbac.role.changed','rbac.assignment.changed') AND payload->>'change' <> 'resynced'",
    );
    expect(rows.rows.length).toBeGreaterThan(5);
    expect(rows.rows.every((r) => r.payload.v === 1)).toBe(true);
    const tenantsSeen = new Set(rows.rows.map((r) => r.tenant_id));
    expect(tenantsSeen.has(tenantA)).toBe(true);
    // un échec annule aussi l'événement : la création refusée n'a rien publié
    const phantom = rows.rows.filter((r) => r.payload.roleKey === "fantome");
    expect(phantom).toEqual([]);
  });
});

function rbacAssignmentSchemaList(body: Record<string, any>): Array<{ id: string }> {
  return (body.assignments as Array<{ id: string }>) ?? [];
}
