import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutboxWriter, assertTenantIsolation, type Tx } from "@ecoledigitale/database";
import {
  ManualClock,
  createRequestContext,
  createSystemContext,
  defineModule,
  noopLogger,
  systemClock,
  newId,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import {
  PermissionSetCache,
  PermissionSetService,
  RBAC_ASSIGNMENT_CHANGED,
  RBAC_ROLE_CHANGED,
  SYSTEM_ROLE_TEMPLATES,
  TENANT_SCOPE,
  buildPermissionCatalog,
  campusScope,
  can,
  createAuthorizationContext,
  institutionScope,
  instantiateSystemRoles,
  loadPermissionCatalog,
  loadPermissionSet,
  scopeTreeFromPairs,
  syncPermissionCatalog,
  syncRbac,
  type AuditEntry,
  type AuditPort,
  type AuthorizationContext,
  type ScopeRef,
} from "../index";
import { assignRoleUseCase, revokeAssignmentUseCase, updateAssignmentUseCase } from "../application/assignments";
import {
  cloneRoleUseCase,
  createRoleUseCase,
  deleteRoleUseCase,
  getRoleUseCase,
  listRolesUseCase,
  updateRoleUseCase,
} from "../application/roles";
import type { UseCaseDeps } from "../application/ports";
import { rbacIsolationAllowlistTables } from "../../isolation-allowlist.rbac";
import { ALL_MANIFESTS, CAMPUS_A1, CAMPUS_A2, INST_A, U1, U2, assessManifest } from "./fixtures";
import { createRbacTestDb, describeIntegration, type RbacTestDb } from "./db";

describeIntegration("rbac — base de données réelle", () => {
  let db: RbacTestDb;
  let tenantA: string;
  let tenantB: string;
  const audits: AuditEntry[] = [];
  const auditSpy: AuditPort = { record: async (_tx, entry) => void audits.push(entry) };

  const userCtx = (tenantId: string, userId: string, mfa = true, extra: { campusId?: string; institutionId?: string } = {}): RequestContext =>
    createRequestContext({ tenantId, userId, mfa, ...extra });

  const depsFor = (tx: Tx, actor?: AuthorizationContext, clock = systemClock): UseCaseDeps => ({
    tx,
    clock,
    outbox: new PgOutboxWriter(tx),
    audit: auditSpy,
    logger: noopLogger,
    ...(actor ? { actor } : {}),
    scopeTree: scopeTreeFromPairs({ [CAMPUS_A1]: INST_A, [CAMPUS_A2]: INST_A }),
  });

  /** Droits réels de l'utilisateur, chargés depuis la base. */
  async function actorOf(ctx: RequestContext): Promise<AuthorizationContext> {
    const set = await db.tenantDb.run(ctx, (tx) => loadPermissionSet(tx, ctx.tenantId, ctx.userId as string), { readOnly: true });
    return createAuthorizationContext({
      ctx,
      permissionSet: set,
      now: new Date(),
      tree: scopeTreeFromPairs({ [CAMPUS_A1]: INST_A, [CAMPUS_A2]: INST_A }),
    });
  }

  async function run<T>(ctx: RequestContext, fn: (deps: UseCaseDeps) => Promise<Result<T, AppError>>, withActor = true): Promise<Result<T, AppError>> {
    const actor = withActor && ctx.actor !== "system" ? await actorOf(ctx) : undefined;
    return db.tenantDb.run(ctx, (tx) => fn(depsFor(tx, actor)));
  }

  async function must<T>(r: Promise<Result<T, AppError>>): Promise<T> {
    const res = await r;
    if (!res.ok) throw res.error;
    return res.value;
  }

  async function bootstrapOwner(tenantId: string, userId: string): Promise<void> {
    const sys = createSystemContext(tenantId);
    await db.tenantDb.run(sys, async (tx) => {
      const owner = await tx.queryOne<{ id: string }>("SELECT id FROM rbac.roles WHERE template_key = 'owner'");
      const r = await assignRoleUseCase(depsFor(tx), sys, { userId, roleId: (owner as { id: string }).id, scope: TENANT_SCOPE });
      if (!r.ok) throw r.error;
    });
  }

  async function roleIdOf(tenantId: string, templateKey: string): Promise<string> {
    const ctx = createSystemContext(tenantId);
    const row = await db.tenantDb.run(ctx, (tx) => tx.queryOne<{ id: string }>("SELECT id FROM rbac.roles WHERE template_key = $1", [templateKey]));
    return (row as { id: string }).id;
  }

  beforeAll(async () => {
    db = await createRbacTestDb();
    await db.systemDb.run("rbac-test-sync", (tx) => syncPermissionCatalog(tx, ALL_MANIFESTS));
    tenantA = await db.createTenant("ecole-a");
    tenantB = await db.createTenant("ecole-b");
    for (const t of [tenantA, tenantB]) {
      await db.systemDb.runForTenant("rbac-test-provision", t, (tx) => instantiateSystemRoles(tx, t, { logger: noopLogger }));
    }
  });

  afterAll(async () => {
    await db?.drop();
  });

  // -------------------------------------------------------------------------
  describe("schéma, RLS et isolation", () => {
    it("assertTenantIsolation passe sur le schéma rbac (table globale en liste blanche, justifiée)", async () => {
      const report = await assertTenantIsolation({
        pool: db.appPool,
        schemas: ["rbac"],
        allowlist: rbacIsolationAllowlistTables,
      });
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
      expect(report.allowlisted).toEqual(["rbac.permissions"]);
      expect(report.behavioural).toContain("rbac.roles");
      // Les tables à clé étrangère composite ne sont vérifiées que structurellement par le test générique :
      // le comportement est couvert ci-dessous.
      const checked = [...report.behavioural, ...report.structuralOnly.map((s) => s.table)].sort();
      expect(checked).toEqual(["rbac.role_pending_permissions", "rbac.role_permissions", "rbac.roles", "rbac.user_role_assignments"]);
    });

    it("sans la liste blanche, la table globale serait rejetée (la justification est nécessaire)", async () => {
      await expect(assertTenantIsolation({ pool: db.appPool, schemas: ["rbac"] })).rejects.toThrow(/rbac\.permissions/);
    });

    it("chaque tenant ne voit que ses propres rôles, permissions de rôle et assignations", async () => {
      await bootstrapOwner(tenantA, U1);
      const rolesA = await must(run(userCtx(tenantA, U1), (d) => listRolesUseCase(d, userCtx(tenantA, U1))));
      expect(rolesA).toHaveLength(SYSTEM_ROLE_TEMPLATES.length);
      expect(new Set(rolesA.map((r) => r.tenantId))).toEqual(new Set([tenantA]));

      const ctxB = createSystemContext(tenantB);
      const rows = await db.tenantDb.run(ctxB, async (tx) => ({
        roles: await tx.many<{ tenant_id: string }>("SELECT tenant_id FROM rbac.roles"),
        perms: await tx.many<{ tenant_id: string }>("SELECT tenant_id FROM rbac.role_permissions"),
        assignments: await tx.many<{ tenant_id: string }>("SELECT tenant_id FROM rbac.user_role_assignments"),
      }));
      expect(rows.roles).toHaveLength(SYSTEM_ROLE_TEMPLATES.length);
      expect(new Set(rows.roles.map((r) => r.tenant_id))).toEqual(new Set([tenantB]));
      expect(new Set(rows.perms.map((r) => r.tenant_id))).toEqual(new Set([tenantB]));
      expect(rows.assignments).toEqual([]); // l'assignation d'owner de A est invisible de B
    });

    it("un tenant ne peut pas lire, modifier ni supprimer le rôle d'un autre, même en connaissant son id", async () => {
      const roleA = await roleIdOf(tenantA, "econome");
      const ctxB = userCtx(tenantB, U1);
      expect((await run(ctxB, (d) => getRoleUseCase(d, ctxB, roleA), false)).ok).toBe(false);
      const get = await run(ctxB, (d) => getRoleUseCase(d, ctxB, roleA), false);
      expect(get.ok === false && get.error.code).toBe("NOT_FOUND");
      const del = await db.tenantDb.run(createSystemContext(tenantB), (tx) => tx.query("DELETE FROM rbac.roles WHERE id = $1", [roleA]));
      expect(del.rowCount).toBe(0);
    });

    it("la clé étrangère composite interdit de rattacher une ligne au rôle d'un autre tenant", async () => {
      const roleA = await roleIdOf(tenantA, "econome");
      const ctxB = createSystemContext(tenantB);
      await expect(
        db.tenantDb.run(ctxB, (tx) =>
          tx.query("INSERT INTO rbac.role_permissions (tenant_id, role_id, permission_key) VALUES ($1, $2, 'grade.read')", [tenantB, roleA]),
        ),
      ).rejects.toThrow();
      await expect(
        db.tenantDb.run(ctxB, (tx) =>
          tx.query("INSERT INTO rbac.user_role_assignments (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)", [newId(), tenantB, U2, roleA]),
        ),
      ).rejects.toThrow();
      // et pas d'insertion « au nom » d'un autre tenant (WITH CHECK)
      await expect(
        db.tenantDb.run(ctxB, (tx) =>
          tx.query("INSERT INTO rbac.roles (id, tenant_id, key, label) VALUES ($1, $2, 'intrus', 'Intrus')", [newId(), tenantA]),
        ),
      ).rejects.toThrow();
    });

    it("sans tenant (SystemDb.run), aucune ligne de tenant n'est visible", async () => {
      const rows = await db.systemDb.run("rbac-test-no-tenant", (tx) => tx.many("SELECT id FROM rbac.roles"), { readOnly: true });
      expect(rows).toEqual([]);
    });

    it("rôles système : suppression et changement de clé refusés par la base", async () => {
      const ctx = createSystemContext(tenantA);
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("DELETE FROM rbac.roles WHERE template_key = 'owner'"))).rejects.toThrow(/ne peut pas être supprimé/);
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rbac.roles SET key = 'autre' WHERE template_key = 'owner'"))).rejects.toThrow(/immuables/);
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rbac.roles SET is_system = false, template_key = NULL WHERE template_key = 'owner'"))).rejects.toThrow();
    });

    it("contraintes : périmètre bien formé, validité ordonnée, un modèle par tenant", async () => {
      const ctx = createSystemContext(tenantA);
      const role = await roleIdOf(tenantA, "enseignant");
      const insert = (scopeType: string, scopeId: string | null, from: string | null = null, until: string | null = null) =>
        db.tenantDb.run(ctx, (tx) =>
          tx.query(
            "INSERT INTO rbac.user_role_assignments (id, tenant_id, user_id, role_id, scope_type, scope_id, valid_from, valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [newId(), tenantA, U2, role, scopeType, scopeId, from, until],
          ),
        );
      await expect(insert("campus", null)).rejects.toThrow(); // campus sans id
      await expect(insert("tenant", CAMPUS_A1)).rejects.toThrow(); // tenant avec id
      await expect(insert("galaxie", CAMPUS_A1)).rejects.toThrow();
      await expect(insert("tenant", null, "2026-10-02T00:00:00Z", "2026-10-01T00:00:00Z")).rejects.toThrow(); // fin avant début
      await expect(
        db.tenantDb.run(ctx, (tx) =>
          tx.query("INSERT INTO rbac.roles (id, tenant_id, key, label, is_system, template_key) VALUES ($1,$2,'dup','Dup',true,'owner')", [newId(), tenantA]),
        ),
      ).rejects.toThrow(); // second rôle du modèle owner
      await expect(
        db.tenantDb.run(ctx, (tx) => tx.query("INSERT INTO rbac.roles (id, tenant_id, key, label, is_system) VALUES ($1,$2,'sys_sans_modele','X',true)", [newId(), tenantA])),
      ).rejects.toThrow(); // système sans template_key
    });
  });

  // -------------------------------------------------------------------------
  describe("catalogue de permissions (table globale)", () => {
    it("reflète exactement les manifestes", async () => {
      const catalog = await db.systemDb.run("rbac-test-read", (tx) => loadPermissionCatalog(tx), { readOnly: true });
      const expected = buildPermissionCatalog(ALL_MANIFESTS);
      expect(catalog.keys).toEqual(expected.keys);
      expect(catalog.byKey.get("grade.publish")?.sensitive).toBe(true);
      expect(catalog.byKey.get("rbac.role.manage")).toMatchObject({ moduleKey: "rbac", sensitive: true });
    });

    it("la synchro est idempotente, détecte les changements, retire sans supprimer, réactive", async () => {
      const again = await db.systemDb.run("rbac-test-sync2", (tx) => syncPermissionCatalog(tx, ALL_MANIFESTS));
      expect(again).toMatchObject({ changed: false, inserted: [], updated: [], retired: [] });

      const modified = defineModule({
        key: "assess",
        title: "Évaluations",
        packs: ["CORE"],
        permissions: assessManifest.permissions
          .filter((p) => p.key !== "grade.validate")
          .map((p) => (p.key === "grade.read" ? { ...p, label: "Consulter les notes (renommé)" } : p)),
        features: [...assessManifest.features],
        menus: [],
      });
      const manifests = ALL_MANIFESTS.map((m) => (m.key === "assess" ? modified : m));
      const r2 = await db.systemDb.run("rbac-test-sync3", (tx) => syncPermissionCatalog(tx, manifests));
      expect(r2.changed).toBe(true);
      expect(r2.retired).toEqual(["grade.validate"]);
      expect(r2.updated).toEqual(["grade.read"]);

      // retirée, pas supprimée : la ligne existe toujours (les rôles qui la portent ne perdent rien)
      const row = await db.admin.query("SELECT retired_at FROM rbac.permissions WHERE key = 'grade.validate'");
      expect(row.rows[0].retired_at).not.toBeNull();
      const active = await db.systemDb.run("rbac-test-read2", (tx) => loadPermissionCatalog(tx), { readOnly: true });
      expect(active.byKey.has("grade.validate")).toBe(false);

      // retour à l'état initial : réactivée
      const r3 = await db.systemDb.run("rbac-test-sync4", (tx) => syncPermissionCatalog(tx, ALL_MANIFESTS));
      expect(r3.updated).toEqual(expect.arrayContaining(["grade.validate", "grade.read"]));
      const back = await db.systemDb.run("rbac-test-read3", (tx) => loadPermissionCatalog(tx), { readOnly: true });
      expect(back.byKey.has("grade.validate")).toBe(true);
    });

    it("refuse un catalogue vide (assemblage défectueux)", async () => {
      await expect(db.systemDb.run("rbac-test-empty", (tx) => syncPermissionCatalog(tx, []))).rejects.toThrow(/aucun manifeste/);
      const catalog = await db.systemDb.run("rbac-test-read4", (tx) => loadPermissionCatalog(tx), { readOnly: true });
      expect(catalog.keys.length).toBeGreaterThan(0);
    });

    it("seul l'acteur `system` peut écrire dans le catalogue ; un utilisateur de tenant le lit seulement", async () => {
      const ctx = userCtx(tenantA, U1);
      const read = await db.tenantDb.run(ctx, (tx) => loadPermissionCatalog(tx), { readOnly: true });
      expect(read.keys.length).toBeGreaterThan(0);
      await expect(
        db.tenantDb.run(ctx, (tx) => tx.query("INSERT INTO rbac.permissions (key, module_key, label) VALUES ('evil.root', 'evil', 'Root')")),
      ).rejects.toThrow();
      const upd = await db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rbac.permissions SET sensitive = false WHERE key = 'grade.publish'"));
      expect(upd.rowCount).toBe(0); // RLS : aucune ligne modifiable
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("DELETE FROM rbac.permissions"))).rejects.toThrow(); // pas de GRANT DELETE
      const still = await db.admin.query("SELECT sensitive FROM rbac.permissions WHERE key = 'grade.publish'");
      expect(still.rows[0].sensitive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("instanciation des rôles système", () => {
    it("crée les onze modèles par tenant, verrouillés, avec leurs permissions résolues", async () => {
      const ctx = createSystemContext(tenantA);
      const roles = await db.tenantDb.run(ctx, (tx) => tx.many<{ key: string; is_system: boolean; template_key: string; n: number }>(
        `SELECT r.key, r.is_system, r.template_key,
                (SELECT count(*)::int FROM rbac.role_permissions p WHERE p.role_id = r.id) AS n
           FROM rbac.roles r ORDER BY r.key`,
      ));
      expect(roles.map((r) => r.key)).toEqual(SYSTEM_ROLE_TEMPLATES.map((t) => t.key).sort());
      expect(roles.every((r) => r.is_system && r.template_key === r.key)).toBe(true);
      const catalog = buildPermissionCatalog(ALL_MANIFESTS);
      expect(roles.find((r) => r.key === "owner")?.n).toBe(catalog.keys.length);
      expect(roles.find((r) => r.key === "eleve")?.n).toBe(1); // grade.self.read (le catalogue de test est partiel)
    });

    it("est idempotente : rejouer ne crée ni ne modifie rien", async () => {
      const snapshot = async (t: string) =>
        db.tenantDb.run(createSystemContext(t), async (tx) => ({
          roles: await tx.many("SELECT id, key, label, updated_at FROM rbac.roles ORDER BY key"),
          perms: (await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM rbac.role_permissions"))?.n,
          pending: (await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM rbac.role_pending_permissions"))?.n,
        }));
      const before = await snapshot(tenantA);
      const report = await db.tenantDb.run(createSystemContext(tenantA), (tx) => instantiateSystemRoles(tx, tenantA, { logger: noopLogger }));
      expect(report.created).toEqual([]);
      expect(report.existing).toHaveLength(SYSTEM_ROLE_TEMPLATES.length);
      expect(report).toMatchObject({ changed: [], permissionsAdded: 0, permissionsRemoved: 0, relocated: [] });
      expect(await snapshot(tenantA)).toEqual(before);
    });

    it("deux appels concurrents pour un même tenant ne produisent pas de doublon", async () => {
      const t = await db.createTenant("ecole-concurrente");
      const results = await Promise.allSettled([
        db.systemDb.runForTenant("rbac-test-conc-1", t, (tx) => instantiateSystemRoles(tx, t, { logger: noopLogger })),
        db.systemDb.runForTenant("rbac-test-conc-2", t, (tx) => instantiateSystemRoles(tx, t, { logger: noopLogger })),
        db.systemDb.runForTenant("rbac-test-conc-3", t, (tx) => instantiateSystemRoles(tx, t, { logger: noopLogger })),
      ]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const n = await db.tenantDb.run(createSystemContext(t), (tx) => tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM rbac.roles"));
      expect(n?.n).toBe(SYSTEM_ROLE_TEMPLATES.length);
    });

    it("conserve en attente les motifs sans correspondance (en base, signalés en log), puis les résout à la synchro suivante", async () => {
      const ctx = createSystemContext(tenantA);
      const pendingOf = (key: string) =>
        db.tenantDb.run(ctx, (tx) =>
          tx.many<{ pattern: string }>(
            "SELECT pattern FROM rbac.role_pending_permissions p JOIN rbac.roles r ON r.id = p.role_id WHERE r.key = $1 ORDER BY pattern",
            [key],
          ),
        );
      const permsOf = (key: string) =>
        db.tenantDb.run(ctx, async (tx) =>
          (await tx.many<{ permission_key: string }>(
            "SELECT permission_key FROM rbac.role_permissions p JOIN rbac.roles r ON r.id = p.role_id WHERE r.key = $1",
            [key],
          )).map((r) => r.permission_key),
        );

      expect((await pendingOf("econome")).map((p) => p.pattern)).toContain("payroll.payslip.pay");
      expect(await permsOf("econome")).not.toContain("payroll.payslip.pay");

      // Le log signale ce qui est en attente.
      const warnings: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
      const spyLogger = { ...noopLogger, warn: (obj: Record<string, unknown>, msg?: string) => void warnings.push({ obj, ...(msg ? { msg } : {}) }) };
      await db.tenantDb.run(ctx, (tx) => instantiateSystemRoles(tx, tenantA, { logger: spyLogger }));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.msg).toMatch(/en attente/);
      expect((warnings[0]?.obj.pendingByRole as Record<string, string[]>).econome).toContain("payroll.payslip.pay");

      // Un module « payroll » arrive : la synchro + re-résolution complète les rôles existants.
      const payroll = defineModule({
        key: "payroll",
        title: "Paie",
        packs: ["CORE"],
        permissions: [
          { key: "payroll.payslip.pay", label: "Constater le versement", sensitive: true },
          { key: "payroll.payslip.read_own", label: "Consulter ses bulletins" },
        ],
      });
      const manifests = [...ALL_MANIFESTS, payroll];
      const report = await syncRbac(db.systemDb, manifests, { logger: noopLogger });
      expect(report.catalog.inserted).toEqual(["payroll.payslip.pay", "payroll.payslip.read_own"]);
      expect(report.reconciled).toBe(true);
      expect(report.tenants.failed).toEqual([]);

      expect(await permsOf("econome")).toContain("payroll.payslip.pay");
      expect(await permsOf("econome")).not.toContain("payroll.payslip.read_own");
      expect(await permsOf("enseignant")).toContain("payroll.payslip.read_own");
      expect(await permsOf("enseignant")).not.toContain("payroll.payslip.pay");
      expect((await pendingOf("econome")).map((p) => p.pattern)).not.toContain("payroll.payslip.pay");
      expect(await permsOf("owner")).toContain("payroll.payslip.pay");

      // L'événement rbac.role.changed (resynced) est écrit dans l'outbox, dans la même transaction.
      const events = await db.admin.query(
        "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 AND payload->>'change' = 'resynced'",
        [tenantA, RBAC_ROLE_CHANGED],
      );
      expect(events.rows.length).toBeGreaterThanOrEqual(3);
      const owner = events.rows.map((r) => r.payload).find((p) => p.roleKey === "owner");
      expect(owner.addedPermissions).toEqual(["payroll.payslip.pay", "payroll.payslip.read_own"]);

      // Les autres tenants (déjà provisionnés) sont aussi mis à jour, sans fuite entre eux.
      const otherOwner = await db.tenantDb.run(createSystemContext(tenantB), (tx) =>
        tx.queryOne<{ n: number }>(
          "SELECT count(*)::int AS n FROM rbac.role_permissions p JOIN rbac.roles r ON r.id = p.role_id WHERE r.key = 'owner' AND p.permission_key = 'payroll.payslip.pay'",
        ),
      );
      expect(otherOwner?.n).toBe(1);

      // Une seconde synchro identique ne touche plus rien.
      const quiet = await syncRbac(db.systemDb, manifests, { logger: noopLogger });
      expect(quiet.reconciled).toBe(false);
    });

    it("un rôle personnalisé portant déjà la clé d'un nouveau modèle système est déplacé, pas écrasé", async () => {
      const t = await db.createTenant("ecole-legacy-key");
      const ctx = createSystemContext(t);
      const customId = newId();
      await db.tenantDb.run(ctx, (tx) =>
        tx.query("INSERT INTO rbac.roles (id, tenant_id, key, label) VALUES ($1, $2, 'enseignant', 'Mon enseignant à moi')", [customId, t]),
      );
      const report = await db.tenantDb.run(ctx, (tx) => instantiateSystemRoles(tx, t, { logger: noopLogger }));
      expect(report.relocated).toEqual([{ from: "enseignant", to: "enseignant_custom" }]);
      const rows = await db.tenantDb.run(ctx, (tx) => tx.many<{ id: string; key: string; is_system: boolean }>("SELECT id, key, is_system FROM rbac.roles WHERE key LIKE 'enseignant%' ORDER BY key"));
      expect(rows).toEqual([
        expect.objectContaining({ key: "enseignant", is_system: true }),
        { id: customId, key: "enseignant_custom", is_system: false },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("rôles personnalisés", () => {
    let ownerCtx: RequestContext;
    let ownerNoMfa: RequestContext;
    const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    beforeAll(async () => {
      await bootstrapOwner(tenantA, ADMIN).catch(() => undefined);
      ownerCtx = userCtx(tenantA, ADMIN, true);
      ownerNoMfa = userCtx(tenantA, ADMIN, false);
    });

    it("création à partir de zéro : clé dérivée du libellé, permissions, événement, audit", async () => {
      audits.length = 0;
      const created = await must(run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Comptable Junior", permissions: ["finance.invoice.read", "finance.payment.read"] })));
      expect(created.role).toMatchObject({ key: "comptable_junior", label: "Comptable Junior", isSystem: false, templateKey: null });
      expect(created.permissions).toEqual(["finance.invoice.read", "finance.payment.read"]);
      expect(audits.map((a) => a.action)).toContain("rbac.role.created");
      const ev = await db.admin.query("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2", [tenantA, created.role.id]);
      expect(ev.rows[0].payload).toMatchObject({ v: 1, change: "created", roleKey: "comptable_junior" });
    });

    it("deux libellés identiques donnent des clés distinctes ; une clé explicite déjà prise est un conflit", async () => {
      const a = await must(run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Surveillant", permissions: [] })));
      const b = await must(run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Surveillant", permissions: [] })));
      expect([a.role.key, b.role.key]).toEqual(["surveillant", "surveillant_2"]);
      const dup = await run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { key: "surveillant", label: "Autre", permissions: [] }));
      expect(dup.ok === false && dup.error.code).toBe("rbac.role_key_taken");
    });

    it("refuse une clé réservée à un modèle système, y compris dérivée du libellé", async () => {
      const explicit = await run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { key: "econome", label: "Pirate", permissions: [] }));
      expect(explicit.ok === false && explicit.error.code).toBe("rbac.role_key_reserved");
      const derived = await must(run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Directeur", permissions: [] })));
      expect(derived.role.key).toBe("directeur_2");
    });

    it("refuse une permission inconnue et un libellé vide", async () => {
      const unknown = await run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "X", permissions: ["finance.invoice.read", "nope.nope"] }));
      expect(unknown.ok === false && unknown.error.code).toBe("rbac.unknown_permission");
      const empty = await run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "   ", permissions: [] }));
      expect(empty.ok === false && empty.error.code).toBe("rbac.invalid_label");
    });

    it("clonage d'un rôle système : copie des permissions, rôle personnalisé modifiable, lien d'origine", async () => {
      const econome = await roleIdOf(tenantA, "econome");
      const original = await must(run(ownerCtx, (d) => getRoleUseCase(d, ownerCtx, econome)));
      const clone = await must(run(ownerCtx, (d) => cloneRoleUseCase(d, ownerCtx, econome, { label: "Économe adjoint" })));
      expect(clone.role).toMatchObject({ key: "econome_adjoint", isSystem: false, templateKey: null, clonedFromRoleId: econome });
      expect(clone.permissions).toEqual(original.permissions);
      expect(clone.permissions.length).toBeGreaterThan(5);

      // modifiable : on retire l'encaissement
      const edited = await must(
        run(ownerCtx, (d) =>
          updateRoleUseCase(d, ownerCtx, clone.role.id, {
            label: "Économe adjoint (lecture)",
            permissions: clone.permissions.filter((p) => p !== "finance.payment.create" && p !== "finance.settings.manage"),
          }),
        ),
      );
      expect(edited.role.label).toBe("Économe adjoint (lecture)");
      expect(edited.permissions).not.toContain("finance.payment.create");
      // …sans toucher à l'original
      const again = await must(run(ownerCtx, (d) => getRoleUseCase(d, ownerCtx, econome)));
      expect(again.permissions).toContain("finance.payment.create");
    });

    it("rôle système : verrouillé (modification et suppression refusées)", async () => {
      const econome = await roleIdOf(tenantA, "econome");
      const upd = await run(ownerCtx, (d) => updateRoleUseCase(d, ownerCtx, econome, { label: "Piraté" }));
      expect(upd.ok === false && upd.error.code).toBe("rbac.role_locked");
      const del = await run(ownerCtx, (d) => deleteRoleUseCase(d, ownerCtx, econome));
      expect(del.ok === false && del.error.code).toBe("rbac.role_locked");
      const fresh = await must(run(ownerCtx, (d) => getRoleUseCase(d, ownerCtx, econome)));
      expect(fresh.role.label).toBe("Économe");
    });

    it("suppression : possible si non assigné, refusée (409) si assigné, rôle intact", async () => {
      const role = await must(run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Temporaire", permissions: ["student.read"] })));
      const assignment = await must(run(ownerCtx, (d) => assignRoleUseCase(d, ownerCtx, { userId: U2, roleId: role.role.id, scope: TENANT_SCOPE })));
      const blocked = await run(ownerCtx, (d) => deleteRoleUseCase(d, ownerCtx, role.role.id));
      expect(blocked.ok).toBe(false);
      expect(blocked.ok === false && blocked.error).toMatchObject({ code: "rbac.role_in_use", details: { assignments: 1 } });
      await must(run(ownerCtx, (d) => getRoleUseCase(d, ownerCtx, role.role.id))); // toujours là

      await must(run(ownerCtx, (d) => revokeAssignmentUseCase(d, ownerCtx, assignment.id)));
      await must(run(ownerCtx, (d) => deleteRoleUseCase(d, ownerCtx, role.role.id)));
      const gone = await run(ownerCtx, (d) => getRoleUseCase(d, ownerCtx, role.role.id));
      expect(gone.ok === false && gone.error.code).toBe("NOT_FOUND");
      const ev = await db.admin.query("SELECT payload->>'change' AS change FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY id", [role.role.id]);
      expect(ev.rows.map((r) => r.change)).toEqual(["created", "deleted"]);
    });

    it("la gestion des rôles exige rbac.role.manage ET la MFA (permission sensible)", async () => {
      const noMfa = await run(ownerNoMfa, (d) => createRoleUseCase(d, ownerNoMfa, { label: "Sans MFA", permissions: [] }));
      expect(noMfa.ok === false && noMfa.error.code).toBe("rbac.mfa_required");

      // un enseignant n'a pas le droit
      const teacher = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      const roleId = await roleIdOf(tenantA, "enseignant");
      await must(run(ownerCtx, (d) => assignRoleUseCase(d, ownerCtx, { userId: teacher, roleId, scope: TENANT_SCOPE })));
      const tctx = userCtx(tenantA, teacher, true);
      const denied = await run(tctx, (d) => createRoleUseCase(d, tctx, { label: "Pirate", permissions: [] }));
      expect(denied.ok === false && denied.error.code).toBe("FORBIDDEN");
    });

    it("anti-escalade : on ne peut accorder que ce que l'on détient", async () => {
      // « Gestionnaire de rôles » : peut gérer les rôles, mais ne détient ni finance.payment.create ni grade.publish
      const manager = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      const mgrRole = await must(
        run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Gestionnaire de rôles", permissions: ["rbac.role.manage", "rbac.role.read", "rbac.assignment.manage", "student.read"] })),
      );
      await must(run(ownerCtx, (d) => assignRoleUseCase(d, ownerCtx, { userId: manager, roleId: mgrRole.role.id, scope: TENANT_SCOPE })));
      const mctx = userCtx(tenantA, manager, true);

      const createEsc = await run(mctx, (d) => createRoleUseCase(d, mctx, { label: "Super", permissions: ["student.read", "finance.payment.create"] }));
      expect(createEsc.ok).toBe(false);
      expect(createEsc.ok === false && createEsc.error).toMatchObject({ code: "rbac.escalation_denied", details: { permissions: ["finance.payment.create"] } });

      const ok = await must(run(mctx, (d) => createRoleUseCase(d, mctx, { label: "Lecteur élèves", permissions: ["student.read"] })));
      const updEsc = await run(mctx, (d) => updateRoleUseCase(d, mctx, ok.role.id, { permissions: ["student.read", "grade.publish"] }));
      expect(updEsc.ok === false && updEsc.error.code).toBe("rbac.escalation_denied");

      // cloner l'économe (ce qu'il ne détient pas) est aussi une escalade
      const econome = await roleIdOf(tenantA, "econome");
      const cloneEsc = await run(mctx, (d) => cloneRoleUseCase(d, mctx, econome, { label: "Faux économe" }));
      expect(cloneEsc.ok === false && cloneEsc.error.code).toBe("rbac.escalation_denied");

      // attribuer le rôle owner (qui contient tout) est refusé
      const owner = await roleIdOf(tenantA, "owner");
      const assignEsc = await run(mctx, (d) => assignRoleUseCase(d, mctx, { userId: manager, roleId: owner, scope: TENANT_SCOPE }));
      expect(assignEsc.ok === false && assignEsc.error.code).toBe("rbac.escalation_denied");

      // retirer des permissions n'est jamais une escalade
      const shrink = await must(run(mctx, (d) => updateRoleUseCase(d, mctx, ok.role.id, { permissions: [] })));
      expect(shrink.permissions).toEqual([]);
    });

    it("un acteur humain sans droits fournis est refusé (échec fermé)", async () => {
      const r = await run(ownerCtx, (d) => createRoleUseCase(d, ownerCtx, { label: "Sans acteur", permissions: [] }), false);
      expect(r.ok === false && r.error.code).toBe("rbac.authorization_missing");
    });
  });

  // -------------------------------------------------------------------------
  describe("assignations et chargement du PermissionSet", () => {
    const user = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let tenantC: string;
    let ownerC: RequestContext;
    const OWNER_C = "99999999-9999-4999-8999-999999999999";

    beforeAll(async () => {
      tenantC = await db.createTenant("ecole-c");
      await db.systemDb.runForTenant("rbac-test-provision-c", tenantC, (tx) => instantiateSystemRoles(tx, tenantC, { logger: noopLogger }));
      await bootstrapOwner(tenantC, OWNER_C);
      ownerC = userCtx(tenantC, OWNER_C, true);
    });

    const loadSet = (userId: string, now?: Date) =>
      db.tenantDb.run(createSystemContext(tenantC), (tx) => loadPermissionSet(tx, tenantC, userId, now ? { now } : {}), { readOnly: true });
    const authOf = async (userId: string, mfa: boolean, extra: { campusId?: string; institutionId?: string } = {}, now = new Date()) => {
      const ctx = userCtx(tenantC, userId, mfa, extra);
      return createAuthorizationContext({
        ctx,
        permissionSet: await loadSet(userId, now),
        now,
        tree: scopeTreeFromPairs({ [CAMPUS_A1]: INST_A, [CAMPUS_A2]: INST_A }),
      });
    };

    it("rôle d'établissement : couvre l'établissement et ses campus, pas le tenant", async () => {
      const roleId = await roleIdOf(tenantC, "secretariat");
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: user, roleId, scope: institutionScope(INST_A) })));
      const auth = await authOf(user, false);
      expect(can(auth, "student.create", institutionScope(INST_A))).toBe(true);
      expect(can(auth, "student.create", campusScope(CAMPUS_A1))).toBe(true);
      expect(can(auth, "student.create", campusScope(CAMPUS_A2))).toBe(true);
      expect(can(auth, "student.create", TENANT_SCOPE)).toBe(false);
      expect(can(auth, "finance.payment.create", institutionScope(INST_A))).toBe(false);
    });

    it("rôle de campus + rôle d'un autre campus s'additionnent ; ré-attribuer met à jour au lieu de dupliquer", async () => {
      const u = "12121212-1212-4121-8121-121212121212";
      const roleId = await roleIdOf(tenantC, "enseignant");
      const first = await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: campusScope(CAMPUS_A1) })));
      const second = await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: campusScope(CAMPUS_A1), validUntil: new Date(Date.now() + 86_400_000) })));
      expect(second.id).toBe(first.id);
      expect(second.validUntil).not.toBeNull();
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: campusScope(CAMPUS_A2) })));
      const count = await db.tenantDb.run(createSystemContext(tenantC), (tx) => tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM rbac.user_role_assignments WHERE user_id = $1", [u]));
      expect(count?.n).toBe(2);

      const auth = await authOf(u, false);
      expect(can(auth, "grade.enter", campusScope(CAMPUS_A1))).toBe(true);
      expect(can(auth, "grade.enter", campusScope(CAMPUS_A2))).toBe(true);
      expect(can(auth, "grade.enter", institutionScope(INST_A))).toBe(false);
      expect(can(auth, "grade.enter", TENANT_SCOPE)).toBe(false);
      // avec un campus actif dans le contexte, `can` sans cible suit ce campus
      const withActive = await authOf(u, false, { campusId: CAMPUS_A2, institutionId: INST_A });
      expect(can(withActive, "grade.enter")).toBe(true);
    });

    it("validité : future = pas encore active ; expirée = ignorée au chargement ; fin exclue", async () => {
      const u = "34343434-3434-4343-8343-343434343434";
      const roleId = await roleIdOf(tenantC, "enseignant");
      const now = Date.now();
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: TENANT_SCOPE, validFrom: new Date(now + 3_600_000), validUntil: new Date(now + 7_200_000) })));

      const early = await authOf(u, false, {}, new Date(now));
      expect(can(early, "grade.enter")).toBe(false);
      const during = await authOf(u, false, {}, new Date(now + 5_400_000));
      expect(can(during, "grade.enter")).toBe(true);
      const after = await authOf(u, false, {}, new Date(now + 7_200_000));
      expect(can(after, "grade.enter")).toBe(false);
      expect((await loadSet(u, new Date(now + 7_200_001))).byPermission.size).toBe(0); // chargée après expiration : ignorée
    });

    it("on ne peut pas attribuer avec une fin de validité déjà passée, ni inversée, ni vers un périmètre inconnu", async () => {
      const roleId = await roleIdOf(tenantC, "enseignant");
      const past = await run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: user, roleId, scope: TENANT_SCOPE, validUntil: new Date(Date.now() - 1000) }));
      expect(past.ok === false && past.error.code).toBe("rbac.invalid_validity");
      const inverted = await run(ownerC, (d) =>
        assignRoleUseCase(d, ownerC, { userId: user, roleId, scope: TENANT_SCOPE, validFrom: new Date(Date.now() + 2000), validUntil: new Date(Date.now() + 1000) }),
      );
      expect(inverted.ok === false && inverted.error.code).toBe("rbac.invalid_validity");
      const unknownCampus = await run(ownerC, (d) =>
        assignRoleUseCase(d, ownerC, { userId: user, roleId, scope: campusScope("d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4") }),
      );
      expect(unknownCampus.ok === false && unknownCampus.error.code).toBe("rbac.unknown_scope");
      const noRole = await run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: user, roleId: newId(), scope: TENANT_SCOPE }));
      expect(noRole.ok === false && noRole.error.code).toBe("NOT_FOUND");
    });

    it("un rôle d'un AUTRE tenant ne peut pas être attribué", async () => {
      const foreignRole = await roleIdOf(tenantA, "enseignant");
      const r = await run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: user, roleId: foreignRole, scope: TENANT_SCOPE }));
      expect(r.ok === false && r.error.code).toBe("NOT_FOUND");
    });

    it("permission sensible : détenue mais inutilisable sans MFA", async () => {
      const u = "56565656-5656-4565-8565-565656565656";
      const roleId = await roleIdOf(tenantC, "econome");
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: TENANT_SCOPE })));
      const weak = await authOf(u, false);
      const strong = await authOf(u, true);
      expect(can(weak, "finance.invoice.read")).toBe(true);
      expect(can(weak, "finance.payment.create")).toBe(false);
      expect(can(strong, "finance.payment.create")).toBe(true);
    });

    it("modification de la validité et retrait, avec événements et audit", async () => {
      audits.length = 0;
      const u = "78787878-7878-4787-8787-787878787878";
      const roleId = await roleIdOf(tenantC, "educateur");
      const a = await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: TENANT_SCOPE })));
      const updated = await must(run(ownerC, (d) => updateAssignmentUseCase(d, ownerC, a.id, { validUntil: new Date(Date.now() + 60_000) })));
      expect(updated.validUntil).not.toBeNull();
      const cleared = await must(run(ownerC, (d) => updateAssignmentUseCase(d, ownerC, a.id, { validUntil: null })));
      expect(cleared.validUntil).toBeNull();
      await must(run(ownerC, (d) => revokeAssignmentUseCase(d, ownerC, a.id)));
      expect((await loadSet(u)).byPermission.size).toBe(0);
      expect((await run(ownerC, (d) => revokeAssignmentUseCase(d, ownerC, a.id))).ok).toBe(false);

      const events = await db.admin.query("SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 AND aggregate_id = $3 ORDER BY id", [
        tenantC,
        RBAC_ASSIGNMENT_CHANGED,
        a.id,
      ]);
      expect(events.rows.map((r) => r.payload.change)).toEqual(["granted", "updated", "updated", "revoked"]);
      expect(events.rows[0].payload).toMatchObject({ v: 1, userId: u, roleKey: "educateur", scope: { type: "tenant", id: null } });
      expect(audits.map((x) => x.action)).toEqual(["rbac.assignment.granted", "rbac.assignment.updated", "rbac.assignment.updated", "rbac.assignment.revoked"]);
    });

    it("jamais de retrait du dernier propriétaire (suppression ou expiration immédiate)", async () => {
      const ownerAssignment = await db.tenantDb.run(createSystemContext(tenantC), (tx) =>
        tx.queryOne<{ id: string }>("SELECT a.id FROM rbac.user_role_assignments a JOIN rbac.roles r ON r.id = a.role_id WHERE r.template_key = 'owner'"),
      );
      const id = (ownerAssignment as { id: string }).id;
      const revoke = await run(ownerC, (d) => revokeAssignmentUseCase(d, ownerC, id));
      expect(revoke.ok === false && revoke.error.code).toBe("rbac.last_owner");
      const expire = await run(ownerC, (d) => updateAssignmentUseCase(d, ownerC, id, { validUntil: new Date(Date.now() - 1000) }));
      expect(expire.ok === false && expire.error.code).toBe("rbac.last_owner");

      // avec un second propriétaire, le retrait est permis
      const second = "abababab-abab-4bab-8bab-abababababab";
      const ownerRole = await roleIdOf(tenantC, "owner");
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: second, roleId: ownerRole, scope: TENANT_SCOPE })));
      await must(run(ownerC, (d) => revokeAssignmentUseCase(d, ownerC, id)));
      // … mais le nouveau dernier propriétaire est protégé à son tour
      const lastCtx = userCtx(tenantC, second, true);
      const lastId = (await db.tenantDb.run(createSystemContext(tenantC), (tx) =>
        tx.queryOne<{ id: string }>("SELECT id FROM rbac.user_role_assignments WHERE user_id = $1", [second]),
      )) as { id: string };
      const again = await run(lastCtx, (d) => revokeAssignmentUseCase(d, lastCtx, lastId.id));
      expect(again.ok === false && again.error.code).toBe("rbac.last_owner");
      // le propriétaire initial est redevenu simple utilisateur : on le rétablit pour les tests suivants
      await bootstrapOwner(tenantC, OWNER_C);
    });

    it("les permissions retirées du catalogue ne sont plus accordées (inertes), sans perte des rôles", async () => {
      const u = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
      const role = await must(run(ownerC, (d) => createRoleUseCase(d, ownerC, { label: "Éphémère", permissions: ["student.read", "student.list"] })));
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId: role.role.id, scope: TENANT_SCOPE })));
      expect([...(await loadSet(u)).byPermission.keys()].sort()).toEqual(["student.list", "student.read"]);

      await db.admin.query("UPDATE rbac.permissions SET retired_at = now() WHERE key = 'student.list'");
      try {
        expect([...(await loadSet(u)).byPermission.keys()]).toEqual(["student.read"]);
        const detail = await must(run(ownerC, (d) => getRoleUseCase(d, ownerC, role.role.id)));
        expect(detail.permissions).toContain("student.list"); // la ligne est conservée
      } finally {
        await db.admin.query("UPDATE rbac.permissions SET retired_at = NULL WHERE key = 'student.list'");
      }
      expect([...(await loadSet(u)).byPermission.keys()].sort()).toEqual(["student.list", "student.read"]);
    });

    it("PermissionSetService : cache court, invalidé par l'événement d'assignation", async () => {
      const u = "efefefef-efef-4fef-8fef-efefefefefef";
      const clock = new ManualClock(new Date());
      const cache = new PermissionSetCache({ ttlMs: 60_000, clock });
      const service = new PermissionSetService({ tenantDb: db.tenantDb, cache, clock });
      const ctx = userCtx(tenantC, u, false);

      expect((await service.get(ctx)).byPermission.size).toBe(0);
      const roleId = await roleIdOf(tenantC, "enseignant");
      await must(run(ownerC, (d) => assignRoleUseCase(d, ownerC, { userId: u, roleId, scope: TENANT_SCOPE })));
      // le cache n'a pas encore été prévenu : il sert l'ancien état (borné par le TTL)
      expect((await service.get(ctx)).byPermission.size).toBe(0);
      cache.invalidateUser(tenantC, u); // ce que fait l'abonnement à rbac.assignment.changed
      expect((await service.get(ctx)).byPermission.size).toBeGreaterThan(0);
      clock.advance(61_000);
      const reloaded = await service.get(ctx);
      expect(reloaded.byPermission.size).toBeGreaterThan(0);
    });

    it("un acteur système n'obtient aucun droit RBAC", async () => {
      const service = new PermissionSetService({ tenantDb: db.tenantDb, cache: new PermissionSetCache() });
      const set = await service.get(createSystemContext(tenantC));
      expect(set.byPermission.size).toBe(0);
    });
  });
});
