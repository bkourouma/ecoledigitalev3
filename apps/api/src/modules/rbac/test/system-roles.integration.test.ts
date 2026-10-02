/**
 * Provisioning d'un tenant avec le catalogue RÉEL (tous les modules découverts) : les douze rôles système
 * sont créés, AUCUN motif ne reste « en attente » HORS de la liste blanche `RESERVED_FOR_UPCOMING_MODULES`
 * (permissions des modules pas encore livrés : en attente signalée au niveau `info`, sans échec), et les
 * permissions stockées sont exactement celles que résout le catalogue.
 *
 * Synchronisation des tenants EXISTANTS : un nouveau modèle système (`instituteur`) est ajouté sans toucher
 * aux rôles personnalisés ni aux autres rôles, de façon idempotente ; un rôle personnalisé qui occupait la clé
 * est déplacé, pas écrasé ; l'arrivée du manifeste d'un module à venir résout les permissions réservées.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSystemContext, defineModule, noopLogger, newId, type ModuleManifest } from "@ecoledigitale/kernel";
import {
  RESERVED_FOR_UPCOMING_MODULES,
  SYSTEM_ROLE_TEMPLATES,
  instantiateSystemRoles,
  isReservedPermission,
  resolveSystemRoles,
  syncPermissionCatalog,
  syncRbac,
} from "../index";
import { insertRole, replaceRolePermissions } from "../infrastructure/repository";
import { RESERVED_MODULES } from "../templates/reserved-permissions";
import { createRbacTestDb, describeIntegration, type RbacTestDb } from "./db";
import { loadRealCatalog, type RealCatalog } from "./real-catalog";

interface StoredRole {
  readonly isSystem: boolean;
  readonly templateKey: string | null;
  readonly permissions: readonly string[];
  readonly pending: readonly string[];
}

describeIntegration("rôles système — provisioning contre le catalogue réel", () => {
  let db: RbacTestDb;
  let real: RealCatalog;
  let tenant: string;
  const warnings: Array<Record<string, unknown>> = [];
  const infos: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const spyLogger = {
    ...noopLogger,
    warn: (obj: Record<string, unknown>) => void warnings.push(obj),
    info: (obj: Record<string, unknown>, msg?: string) => void infos.push({ obj, ...(msg ? { msg } : {}) }),
  };

  /** Rôles d'un tenant, indexés par clé, avec permissions et motifs en attente stockés. */
  async function rolesOf(tenantId: string): Promise<Map<string, StoredRole>> {
    return db.tenantDb.run(createSystemContext(tenantId), async (tx) => {
      const roles = await tx.many<{ id: string; key: string; is_system: boolean; template_key: string | null }>(
        "SELECT id, key, is_system, template_key FROM rbac.roles",
      );
      const perms = await tx.many<{ role_id: string; permission_key: string }>("SELECT role_id, permission_key FROM rbac.role_permissions");
      const pending = await tx.many<{ role_id: string; pattern: string }>("SELECT role_id, pattern FROM rbac.role_pending_permissions");
      return new Map(
        roles.map((r) => [
          r.key,
          {
            isSystem: r.is_system,
            templateKey: r.template_key,
            permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission_key).sort(),
            pending: pending.filter((p) => p.role_id === r.id).map((p) => p.pattern).sort(),
          },
        ]),
      );
    });
  }

  const provision = (tenantId: string, templates?: typeof SYSTEM_ROLE_TEMPLATES) =>
    db.systemDb.runForTenant("rbac-real-provision", tenantId, (tx) =>
      instantiateSystemRoles(tx, tenantId, { logger: spyLogger, ...(templates ? { templates } : {}) }),
    );

  beforeAll(async () => {
    real = await loadRealCatalog();
    db = await createRbacTestDb();
    await db.systemDb.run("rbac-real-sync", (tx) => syncPermissionCatalog(tx, real.manifests));
    tenant = await db.createTenant("ecole-reelle");
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("instanciation : douze rôles, motifs en attente = UNIQUEMENT des permissions réservées (liste blanche), aucun avertissement", async () => {
    const report = await provision(tenant);
    expect(report.created).toHaveLength(12);
    expect(report.created).toContain("personnel");
    expect(report.created).toContain("instituteur");

    // tout motif en attente (rapport et base) figure dans la liste blanche ; aucun `warn`
    const reportPending = Object.values(report.pendingByRole).flat();
    expect(reportPending.filter((p) => !isReservedPermission(p)), "motifs en attente hors liste blanche").toEqual([]);
    expect(warnings).toEqual([]);

    const stored = await rolesOf(tenant);
    const storedPending = [...stored.values()].flatMap((r) => r.pending);
    expect(storedPending.filter((p) => !isReservedPermission(p))).toEqual([]);
    // les modules à venir ne sont pas chargés : leurs permissions sont bien en attente (et non accordées)
    const expectedPending = resolveSystemRoles(real.catalog, SYSTEM_ROLE_TEMPLATES).flatMap((r) => r.pending);
    expect(storedPending.length).toBe(expectedPending.length);
    expect(stored.get("instituteur")?.pending).toEqual(expect.arrayContaining(["primary.competency.read", "primary.council.prepare"]));
    expect(stored.get("parent")?.pending).toEqual(expect.arrayContaining(["primary.competency.child.read", "primary.bilan.child.read"]));
    expect(stored.get("instituteur")?.permissions).not.toContain("primary.competency.read");

    // signalé au niveau info, avec la liste blanche pour référence
    expect(infos.some((i) => /réservées/.test(i.msg ?? ""))).toBe(true);
  });

  it("les permissions stockées de chaque rôle = celles du catalogue réel résolu ; owner/directeur à `*` seuls", async () => {
    const expected = new Map(resolveSystemRoles(real.catalog, SYSTEM_ROLE_TEMPLATES).map((r) => [r.template.key, [...r.permissions].sort()]));
    const stored = await rolesOf(tenant);
    for (const [key, perms] of expected) expect([...(stored.get(key)?.permissions ?? [])], key).toEqual(perms);

    const wide = [...stored.entries()].filter(([, r]) => r.permissions.length >= real.catalog.keys.length - 5).map(([key]) => key).sort();
    expect(wide).toEqual(["directeur", "owner"]);
    expect(stored.get("owner")?.permissions).not.toContain("rules.platform.manage");
  });

  it("l'instituteur stocké reçoit ses permissions réelles (patron enseignant) mais ni validation/publication ni finance", async () => {
    const instituteur = (await rolesOf(tenant)).get("instituteur");
    expect(instituteur?.isSystem).toBe(true);
    expect(instituteur?.templateKey).toBe("instituteur");
    expect(instituteur?.permissions).toEqual(
      expect.arrayContaining(["attendance.take", "attendance.read", "assessment.create", "assessment.update", "grade.enter", "student.class.read", "reportcard.read"]),
    );
    for (const k of ["grade.validate", "grade.publish", "grade.revise.approve", "period.close"]) expect(instituteur?.permissions).not.toContain(k);
    expect(instituteur?.permissions.filter((k) => k.startsWith("finance."))).toEqual([]);
  });

  it("syncRbac complet (tous les tenants) sur le catalogue réel : aucun échec, aucun motif hors liste blanche, rien ne change au second passage", async () => {
    const first = await syncRbac(db.systemDb, real.manifests, { logger: spyLogger, force: true });
    expect(first.tenants.failed).toEqual([]);
    const second = await syncRbac(db.systemDb, real.manifests, { logger: spyLogger });
    expect(second.reconciled).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("tenant EXISTANT sans `instituteur` : la synchro ajoute le rôle, n'écrase aucune personnalisation, et reste idempotente", async () => {
    const legacy = await db.createTenant("ecole-ancienne");
    const withoutInstituteur = SYSTEM_ROLE_TEMPLATES.filter((t) => t.key !== "instituteur");
    const first = await provision(legacy, withoutInstituteur);
    expect(first.created).toHaveLength(11);
    expect(first.created).not.toContain("instituteur");

    // personnalisation du tenant : un rôle personnalisé (clone-like) avec un sous-ensemble de droits
    const customPerms = ["grade.read", "grade.enter", "attendance.take"];
    await db.systemDb.runForTenant("rbac-custom-role", legacy, async (tx) => {
      const role = await insertRole(tx, {
        id: newId(),
        tenantId: legacy,
        key: "titulaire_cp",
        label: "Titulaire CP (personnalisé)",
        description: "Rôle propre à l'école",
        isSystem: false,
        templateKey: null,
        clonedFromRoleId: null,
        createdBy: null,
        now: new Date(),
      });
      await replaceRolePermissions(tx, legacy, role.id, customPerms);
    });
    const before = await rolesOf(legacy);
    expect(before.has("instituteur")).toBe(false);

    const report = await syncRbac(db.systemDb, real.manifests, { logger: spyLogger, force: true });
    expect(report.tenants.failed).toEqual([]);

    const after = await rolesOf(legacy);
    // le rôle est ajouté, verrouillé, relié à son modèle et résolu contre le catalogue réel
    const instituteur = after.get("instituteur");
    expect(instituteur).toMatchObject({ isSystem: true, templateKey: "instituteur" });
    const expectedInstituteur = resolveSystemRoles(real.catalog, SYSTEM_ROLE_TEMPLATES).find((r) => r.template.key === "instituteur");
    expect(instituteur?.permissions).toEqual([...(expectedInstituteur?.permissions ?? [])].sort());
    expect(instituteur?.pending).toEqual([...(expectedInstituteur?.pending ?? [])].sort());

    // aucune personnalisation écrasée : le rôle personnalisé et tous les autres rôles système sont inchangés
    expect(after.get("titulaire_cp")).toEqual(before.get("titulaire_cp"));
    expect(after.get("titulaire_cp")?.permissions).toEqual([...customPerms].sort());
    for (const [key, role] of before) expect(after.get(key), key).toEqual(role);

    // idempotent : rejouer ne crée, ne modifie ni ne retire rien
    const replay = await provision(legacy);
    expect(replay.created).toEqual([]);
    expect(replay.changed).toEqual([]);
    expect(replay.permissionsAdded).toBe(0);
    expect(replay.permissionsRemoved).toBe(0);
    expect(replay.relocated).toEqual([]);
    expect(await rolesOf(legacy)).toEqual(after);
  });

  it("un rôle PERSONNALISÉ qui occupe la clé `instituteur` est déplacé (instituteur_custom), jamais écrasé", async () => {
    const squatted = await db.createTenant("ecole-instituteur-perso");
    const withoutInstituteur = SYSTEM_ROLE_TEMPLATES.filter((t) => t.key !== "instituteur");
    await provision(squatted, withoutInstituteur);
    await db.systemDb.runForTenant("rbac-squatter", squatted, async (tx) => {
      const role = await insertRole(tx, {
        id: newId(),
        tenantId: squatted,
        key: "instituteur",
        label: "Instituteur maison",
        description: null,
        isSystem: false,
        templateKey: null,
        clonedFromRoleId: null,
        createdBy: null,
        now: new Date(),
      });
      await replaceRolePermissions(tx, squatted, role.id, ["grade.read", "attendance.read"]);
    });

    const report = await provision(squatted);
    expect(report.created).toEqual(["instituteur"]);
    expect(report.relocated).toEqual([{ from: "instituteur", to: "instituteur_custom" }]);
    // le déplacement est signalé (avertissement attendu, consommé ici pour ne pas polluer les assertions suivantes)
    expect(warnings.filter((w) => w.from === "instituteur" && w.to === "instituteur_custom")).toHaveLength(1);
    warnings.length = 0;

    const roles = await rolesOf(squatted);
    expect(roles.get("instituteur_custom")).toMatchObject({ isSystem: false, templateKey: null, permissions: ["attendance.read", "grade.read"] });
    expect(roles.get("instituteur")).toMatchObject({ isSystem: true, templateKey: "instituteur" });
    // second passage : stable
    const replay = await provision(squatted);
    expect(replay.created).toEqual([]);
    expect(replay.relocated).toEqual([]);
  });

  it("l'arrivée des manifestes des modules à venir résout les permissions réservées dans les tenants EXISTANTS (en base)", async () => {
    // Catalogue réel (sans les modules à venir s'ils sont déjà chargés) + un manifeste fictif par module à venir.
    const fakes = RESERVED_MODULES.map((module) =>
      defineModule({
        key: module,
        title: `Module à venir ${module}`,
        packs: ["CORE"],
        permissions: RESERVED_FOR_UPCOMING_MODULES.filter((r) => r.module === module).map((r) => ({
          key: r.key,
          label: `Réservée ${r.key}`,
          ...(r.sensitive ? { sensitive: true } : {}),
        })),
      }),
    ) as ModuleManifest[];
    const manifests = [...real.manifests.filter((m) => !(RESERVED_MODULES as readonly string[]).includes(m.key)), ...fakes];

    const before = await rolesOf(tenant);
    expect(before.get("instituteur")?.pending.length).toBeGreaterThan(0);
    const customBefore = await rolesOf(await db.admin.query<{ id: string }>("SELECT id FROM kernel.tenants WHERE slug = 'ecole-ancienne'").then((r) => r.rows[0]?.id as string));

    const report = await syncRbac(db.systemDb, manifests, { logger: spyLogger });
    expect(report.catalog.changed).toBe(true);
    expect(report.reconciled).toBe(true);
    expect(report.tenants.failed).toEqual([]);

    for (const slug of ["ecole-reelle", "ecole-ancienne", "ecole-instituteur-perso"]) {
      const id = await db.admin.query<{ id: string }>("SELECT id FROM kernel.tenants WHERE slug = $1", [slug]).then((r) => r.rows[0]?.id as string);
      const roles = await rolesOf(id);
      for (const [key, role] of roles) expect(role.pending, `${slug}/${key} : motifs encore en attente`).toEqual([]);
      expect(roles.get("instituteur")?.permissions, slug).toEqual(
        expect.arrayContaining(["primary.competency.read", "primary.competency.record", "primary.competency.validate", "primary.council.prepare"]),
      );
      expect(roles.get("instituteur")?.permissions, slug).not.toContain("primary.competency.revise");
      expect(roles.get("parent")?.permissions, slug).toEqual(expect.arrayContaining(["primary.competency.child.read", "primary.bilan.child.read", "exam.document.child.read"]));
      expect(roles.get("eleve")?.permissions, slug).toEqual(expect.arrayContaining(["primary.competency.self.read", "exam.document.self.read"]));
      expect(roles.get("directeur")?.permissions, slug).toContain("council.decision.record");
      expect(roles.get("directeur_etudes")?.permissions, slug).not.toContain("council.unlock.approve");
    }

    // les rôles personnalisés n'ont pas bougé
    const customAfter = await rolesOf(await db.admin.query<{ id: string }>("SELECT id FROM kernel.tenants WHERE slug = 'ecole-ancienne'").then((r) => r.rows[0]?.id as string));
    expect(customAfter.get("titulaire_cp")).toEqual(customBefore.get("titulaire_cp"));

    // second passage : rien ne change
    const again = await syncRbac(db.systemDb, manifests, { logger: spyLogger });
    expect(again.reconciled).toBe(false);
    expect(warnings).toEqual([]);
  });
});
