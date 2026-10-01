/**
 * Défense en profondeur en base (migrations 1001-1003) : catalogue national en lecture seule pour `app_user`, immuabilité des
 * versions figées (R-RUL-02), miroir SQL des transitions, séparation des tâches, journaux append-only, jamais de DELETE,
 * clés étrangères composites, exclusion des chevauchements. Les altérations « hors application » sont tentées en SQL direct.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId } from "@ecoledigitale/kernel";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { OPERATOR, approveAsOperator, nationalVersion, proposeVariant, simulatedVariant } from "./support/flow";

describeIntegration("gardes SQL du module rules", () => {
  let db: RulesTestDb;
  let world: TestWorld;
  let tenantA: string;
  let tenantB: string;
  let lmdId: string;

  beforeAll(async () => {
    db = await createRulesTestDb();
    world = makeWorld(db);
    await seedCatalog(world);
    tenantA = await db.createTenant("etab-a");
    tenantB = await db.createTenant("etab-b");
    lmdId = (await nationalVersion(db, "CI-HIGHER-LMD")).id;
  });
  afterAll(async () => {
    await db.drop();
  });

  const asSystem = <T>(fn: (tx: import("@ecoledigitale/database").Tx) => Promise<T>) => db.systemDb.run("test-gardes", fn);

  describe("catalogue national : lecture ouverte, écriture réservée à l'acteur système", () => {
    it("un tenant LIT le catalogue national", async () => {
      const rows = await db.tenantDb.run(adminCtx(tenantA), (tx) => tx.many("SELECT code FROM rules.national_rule_sets ORDER BY code"));
      expect(rows.map((r: { code: string }) => r.code)).toEqual(["CI-CLASSIC-SEMESTRE", "CI-HIGHER-BTS", "CI-HIGHER-LMD"]);
    });

    it("un tenant ne peut ni INSÉRER ni MODIFIER ni SUPPRIMER dans les tables nationales (RLS)", async () => {
      const ctx = adminCtx(tenantA);
      await expect(
        db.tenantDb.run(ctx, (tx) => tx.query("INSERT INTO rules.national_rule_sets (id, code, name, country_code) VALUES ($1, 'CI-PIRATE', 'Pirate', 'CI')", [newId()])),
      ).rejects.toMatchObject({ code: "42501" });
      const updated = await db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.national_rule_sets SET name = 'Piraté' WHERE code = 'CI-HIGHER-LMD'"));
      expect(updated.rowCount).toBe(0);
      const deleted = await db.tenantDb.run(ctx, async (tx) => {
        try {
          return (await tx.query("DELETE FROM rules.national_rule_definitions WHERE rule_version_id = $1", [lmdId])).rowCount;
        } catch (e) {
          return (e as { code?: string }).code;
        }
      });
      expect(deleted === 0 || deleted === "42501").toBe(true);
      const settings = await db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.platform_settings SET value = '0'::jsonb"));
      expect(settings.rowCount).toBe(0);
      const [row] = await adminRows<{ name: string }>(db, "SELECT name FROM rules.national_rule_sets WHERE code = 'CI-HIGHER-LMD'");
      expect(row!.name).not.toBe("Piraté");
    });

    it("pas non plus sous une identité super-administrateur de tenant : seul `system` (SystemDb) écrit le national", async () => {
      const ctx = createRequestContext({ tenantId: tenantA, userId: newId(), actor: "superAdmin" });
      await expect(
        db.tenantDb.run(ctx, (tx) => tx.query("INSERT INTO rules.national_rule_sets (id, code, name, country_code) VALUES ($1, 'CI-PIRATE2', 'Pirate', 'CI')", [newId()])),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("`app_user` n'a aucun DELETE sur les jeux et les versions (droits)", async () => {
      const rows = await adminRows<{ table_name: string; privilege_type: string }>(
        db,
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_user' AND table_schema = 'rules' AND privilege_type = 'DELETE' ORDER BY table_name`,
      );
      expect(rows.map((r) => r.table_name)).toEqual(["evaluation_failures", "national_rule_definitions", "rule_bindings", "rule_definitions"]);
    });
  });

  describe("immuabilité d'une version figée (R-RUL-02)", () => {
    it("UPDATE d'une règle d'une version publiée : refusé par le déclencheur, même sous l'acteur système", async () => {
      await expect(asSystem((tx) => tx.query("UPDATE rules.national_rule_definitions SET expression = 'note_examen' WHERE rule_version_id = $1 AND key = 'note_ecue_directe'", [lmdId]))).rejects.toThrow(/rules\.version_immutable/);
      await expect(asSystem((tx) => tx.query("DELETE FROM rules.national_rule_definitions WHERE rule_version_id = $1", [lmdId]))).rejects.toThrow(/rules\.version_immutable/);
      await expect(
        asSystem((tx) =>
          tx.query(
            "INSERT INTO rules.national_rule_definitions (id, rule_version_id, key, type, position, expression) VALUES ($1, $2, 'regle_ajoutee', 'rounding', 999, '1')",
            [newId(), lmdId],
          ),
        ),
      ).rejects.toThrow(/rules\.version_immutable/);
      // Y compris en superuser (les déclencheurs s'appliquent aussi au propriétaire et au superutilisateur).
      await expect(db.admin.query("UPDATE rules.national_rule_definitions SET parameters = '{}'::jsonb WHERE rule_version_id = $1", [lmdId])).rejects.toThrow(/rules\.version_immutable/);
    });

    it("contenu de la version figé : dates d'effet, source, hash ; la période ne peut qu'être clôturée", async () => {
      for (const sql of [
        "UPDATE rules.national_rule_versions SET effective_from = '2000-01-01' WHERE id = $1",
        "UPDATE rules.national_rule_versions SET source_reference = 'autre' WHERE id = $1",
        "UPDATE rules.national_rule_versions SET definition_hash = repeat('a', 64) WHERE id = $1",
        "UPDATE rules.national_rule_versions SET approved_by = gen_random_uuid() WHERE id = $1",
        "UPDATE rules.national_rule_versions SET contract_id = 'coef-semester@1' WHERE id = $1",
      ]) {
        await expect(asSystem((tx) => tx.query(sql, [lmdId])), sql).rejects.toThrow(/rules\.version_immutable/);
      }
      // Clôturer est permis ; rouvrir (NULL) ou prolonger ne l'est pas.
      await asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET effective_to = '2099-12-31' WHERE id = $1", [lmdId]));
      await expect(asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET effective_to = NULL WHERE id = $1", [lmdId]))).rejects.toThrow(/rules\.version_immutable/);
      await expect(asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET effective_to = '2100-12-31' WHERE id = $1", [lmdId]))).rejects.toThrow(/rules\.version_immutable/);
      await asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET effective_to = NULL WHERE false"));
    });

    it("le hash détecte une altération faite HORS application (déclencheurs désactivés par un superuser)", async () => {
      const fresh = await createRulesTestDb();
      try {
        const w = makeWorld(fresh);
        await seedCatalog(w);
        const v = await nationalVersion(fresh, "CI-CLASSIC-SEMESTRE");
        await fresh.admin.query("SET session_replication_role = replica"); // désactive les déclencheurs (superuser uniquement)
        await fresh.admin.query("UPDATE rules.national_rule_definitions SET expression = 'moyenne' WHERE rule_version_id = $1 AND key = 'rang'", [v.id]);
        await fresh.admin.query("SET session_replication_role = DEFAULT");
        const { loadVersion } = await import("../application/resolve");
        const loaded = await loadVersion(w.deps, adminCtx(await fresh.createTenant()), v.id);
        expect(loaded.ok).toBe(false);
        expect(!loaded.ok && loaded.error.code).toBe("rules.hash_mismatch");
        expect(!loaded.ok && loaded.error.httpStatus).toBe(409);
        const { verifyCatalogHashes } = await import("../application/replay");
        const issues = await verifyCatalogHashes(w.deps);
        expect(issues.map((i) => `${i.kind}:${i.ruleSetCode}`)).toEqual(["NATIONAL:CI-CLASSIC-SEMESTRE"]);
      } finally {
        await fresh.drop();
      }
    });
  });

  describe("transitions et acteurs (miroir de canTransition)", () => {
    it("toute transition illégale est refusée en SQL, y compris depuis l'acteur système", async () => {
      for (const to of ["draft", "simulated", "proposed", "approved"]) {
        await expect(asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET status = $2 WHERE id = $1", [lmdId, to])), `published -> ${to}`).rejects.toThrow(/rules\.transition_forbidden/);
      }
    });

    it("une version naît en brouillon (INSERT avec un autre statut refusé, même pour les données de départ)", async () => {
      const setId = (await adminRows<{ id: string }>(db, "SELECT id FROM rules.national_rule_sets WHERE code = 'CI-HIGHER-LMD'"))[0]!.id;
      await expect(
        asSystem((tx) =>
          tx.query(
            `INSERT INTO rules.national_rule_versions (id, rule_set_id, version, status, contract_id, effective_from, source_kind, definition_hash, approved_by)
             VALUES ($1, $2, 99, 'published', 'credit-semester@1', '2090-01-01', 'platform', repeat('a', 64), gen_random_uuid())`,
            [newId(), setId],
          ),
        ),
      ).rejects.toThrow(/rules\.transition_forbidden/);
    });

    it("un administrateur d'établissement (acteur `user`) ne peut pas poser approved/published/retired en SQL (AC3.2)", async () => {
      const ctx = adminCtx(tenantA);
      const { variant } = await simulatedVariant(world.deps, ctx, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2060-09-01" });
      const proposed = await proposeVariant(world.deps, ctx, variant.id);
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [proposed.id, ctx.userId]))).rejects.toThrow(/rules\.transition_forbidden/);
      // Même avec le contexte `system` du tenant (SystemDb.runForTenant) : seul `superAdmin` approuve une variante.
      await expect(db.systemDb.runForTenant("test-system", tenantA, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [proposed.id, newId()]))).rejects.toThrow(/rules\.transition_forbidden/);
      // Le super-administrateur le peut.
      const approved = await approveAsOperator(world.deps, tenantA, proposed.id);
      expect(approved.status).toBe("approved");
    });

    it("séparation des tâches du catalogue national en base : l'auteur n'approuve pas sa version (AC3.4)", async () => {
      const setId = newId();
      const id = newId();
      const author = newId();
      await asSystem(async (tx) => {
        await tx.query("INSERT INTO rules.national_rule_sets (id, code, name, country_code) VALUES ($1, 'CI-FOUR-EYES', 'Jeu de test', 'CI')", [setId]);
        await tx.query(
          "INSERT INTO rules.national_rule_versions (id, rule_set_id, version, status, contract_id, effective_from, source_kind, created_by) VALUES ($1, $2, 50, 'draft', 'coef-semester@1', '2070-01-01', 'platform', $3)",
          [id, setId, author],
        );
        await tx.query("UPDATE rules.national_rule_versions SET status = 'simulated' WHERE id = $1", [id]);
        await tx.query("UPDATE rules.national_rule_versions SET status = 'proposed', definition_hash = repeat('b', 64) WHERE id = $1", [id]);
      });
      await expect(asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [id, author]))).rejects.toThrow(/rules\.four_eyes/);
      await asSystem((tx) => tx.query("UPDATE rules.national_rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [id, newId()]));
    });

    it("la base impose le hash dès la proposition et une simulation pour toute variante proposée", async () => {
      const ctx = adminCtx(tenantB);
      const base = await nationalVersion(db, "CI-HIGHER-LMD");
      const { derive } = await import("./support/flow");
      const v = await derive(world.deps, ctx, base, { effectiveFrom: "2061-09-01" });
      await db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'simulated' WHERE id = $1", [v.id]));
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'proposed' WHERE id = $1", [v.id]))).rejects.toMatchObject({ code: "23514" });
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'proposed', definition_hash = repeat('c', 64) WHERE id = $1", [v.id]))).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("journaux, suppressions, clés étrangères, chevauchements", () => {
    it("l'historique de gouvernance est append-only (UPDATE et DELETE refusés, même au superuser)", async () => {
      await expect(db.admin.query("UPDATE rules.national_version_events SET comment = 'réécrit'")).rejects.toThrow(/rules\.immutable/);
      await expect(db.admin.query("DELETE FROM rules.national_version_events")).rejects.toThrow(/rules\.immutable/);
      const ctx = adminCtx(tenantA);
      await expect(db.tenantDb.run(ctx, (tx) => tx.query("UPDATE rules.version_events SET comment = 'réécrit'"))).rejects.toMatchObject({ code: "42501" });
      await expect(db.admin.query("DELETE FROM rules.version_events")).rejects.toThrow(/rules\.immutable/);
    });

    it("jamais de suppression d'un jeu ni d'une version (AC4.5), même au superuser", async () => {
      await expect(db.admin.query("DELETE FROM rules.national_rule_versions")).rejects.toThrow(/rules\.immutable/);
      await expect(db.admin.query("DELETE FROM rules.national_rule_sets")).rejects.toThrow(/rules\.immutable/);
      await expect(db.admin.query("DELETE FROM rules.rule_versions")).rejects.toThrow(/rules\.immutable/);
      await expect(db.admin.query("DELETE FROM rules.rule_sets")).rejects.toThrow(/rules\.immutable/);
    });

    it("une clé étrangère composite interdit de rattacher une règle d'un tenant à la version d'un autre", async () => {
      const ctxB = adminCtx(tenantB);
      const { derive } = await import("./support/flow");
      const vB = await derive(world.deps, ctxB, await nationalVersion(db, "CI-HIGHER-BTS"), { effectiveFrom: "2062-09-01" });
      await expect(
        db.admin.query(
          "INSERT INTO rules.rule_definitions (id, tenant_id, rule_version_id, key, type, position, expression) VALUES ($1, $2, $3, 'intrus', 'rounding', 500, '1')",
          [newId(), tenantA, vB.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("deux versions ACTIVES se chevauchant sont refusées par la contrainte d'exclusion, même si l'application ne contrôlait pas (AC3.3)", async () => {
      const tenant = await db.createTenant();
      const ctx = adminCtx(tenant);
      const base = await nationalVersion(db, "CI-CLASSIC-SEMESTRE");
      const { derive, simulateVersion } = await import("./support/flow");
      const mk = async (from: string) => {
        const v = await derive(world.deps, ctx, base, { effectiveFrom: from });
        await simulateVersion(world.deps, ctx, v.id, [{ ruleKeys: ["mention"], cases: [{ id: "c", context: { variables: { moyenne: 12 } } }] }]);
        const { transitionTenantVersion } = await import("../application/transitions");
        await transitionTenantVersion(world.deps, ctx, { versionId: v.id, to: "simulated" });
        return proposeVariant(world.deps, ctx, v.id, false);
      };
      const a = await mk("2063-01-01");
      const b = await mk("2063-06-01");
      const superCtx = createRequestContext({ tenantId: tenant, userId: OPERATOR.id, actor: "superAdmin" });
      await db.tenantDb.run(superCtx, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [a.id, OPERATOR.id]));
      await expect(
        db.tenantDb.run(superCtx, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [b.id, OPERATOR.id])),
      ).rejects.toMatchObject({ code: "23P01" });
    });

    it("les liaisons de même périmètre ne se chevauchent pas (contrainte d'exclusion)", async () => {
      const ctx = adminCtx(tenantA);
      const insert = (from: string, to: string | null) =>
        db.tenantDb.run(ctx, (tx) =>
          tx.query(
            "INSERT INTO rules.rule_bindings (id, tenant_id, contract_id, rule_set_code, effective_from, effective_to) VALUES ($1, $2, 'credit-semester@1', 'CI-HIGHER-LMD', $3, $4)",
            [newId(), tenantA, from, to],
          ),
        );
      await insert("2080-01-01", "2080-12-31");
      await expect(insert("2080-06-01", null)).rejects.toMatchObject({ code: "23P01" });
      await insert("2081-01-01", null);
    });
  });
});
