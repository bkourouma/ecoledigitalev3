/**
 * Jeux FICTIFS (`source_kind = 'placeholder'`) — specs 005, 006 et 018 :
 *   - les jeux de démonstration sont publiés au catalogue national, marqués `placeholder`, jamais `regulation` ;
 *   - `resolve` expose la provenance (`sourceKind`) pour le filigrane des résultats et des documents ;
 *   - en PRODUCTION, la liaison d'un jeu fictif est REFUSÉE sans accusé explicite et motivé (`rules.placeholder_requires_ack`) ;
 *     l'accusé est tracé (audit « warning », colonnes dédiées, événement) ; hors production il reste facultatif ;
 *   - un jeu qui n'est pas fictif ne demande jamais d'accusé ;
 *   - une variante d'un jeu fictif reste fictive ;
 *   - la base refuse une version `regulation` sans référence de texte et accepte `placeholder` (nationale et tenant).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { putBinding } from "../application/bindings";
import { loadVersion, resolve } from "../application/resolve";
import { createRulesDeps } from "../application/deps";
import { isProductionEnvironment } from "../domain/environment";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { derive, nationalVersion } from "./support/flow";

describe("environnement (fonction pure)", () => {
  it("défaut SÛR : production, sauf développement / test / démonstration explicites", () => {
    expect(isProductionEnvironment({})).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: "inconnu" })).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionEnvironment({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionEnvironment({ NODE_ENV: "production", RULES_ENV: "demo" })).toBe(false);
    expect(isProductionEnvironment({ NODE_ENV: "development", RULES_ENV: "production" })).toBe(true);
  });
});

describeIntegration("jeux de règles fictifs (placeholder)", () => {
  let db: RulesTestDb;
  let world: TestWorld;
  let prod: TestWorld;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    db = await createRulesTestDb();
    world = makeWorld(db);
    prod = makeWorld(db, { config: { productionMode: true } });
    await seedCatalog(world);
    tenantA = await db.createTenant("etab-a");
    tenantB = await db.createTenant("etab-b");
  });
  afterAll(async () => {
    await db.drop();
  });

  it("createRulesDeps dérive le mode de l'environnement, surchargeable", () => {
    expect(world.deps.config.productionMode).toBe(false);
    expect(createRulesDeps({ db: db.tenantDb, systemDb: db.systemDb, config: { productionMode: true } }).config.productionMode).toBe(true);
  });

  it("les jeux fictifs sont publiés, marqués `placeholder`, jamais `regulation`", async () => {
    const rows = await adminRows<{ code: string; source_kind: string; status: string }>(
      db,
      "SELECT s.code, v.source_kind, v.status FROM rules.national_rule_versions v JOIN rules.national_rule_sets s ON s.id = v.rule_set_id WHERE s.code LIKE '%-PLACEHOLDER'",
    );
    expect(rows.length).toBe(5);
    for (const r of rows) expect([r.source_kind, r.status]).toEqual(["placeholder", "published"]);
  });

  it("resolve expose la provenance de la version (`placeholder` / `platform`)", async () => {
    const ctx = adminCtx(tenantA);
    const a = await putBinding(world.deps, ctx, { contractId: "coef-period@1", ruleSetCode: "CI-PRIMARY-PLACEHOLDER", levelCode: "PRIMARY", effectiveFrom: "2026-09-01" });
    expect(a.ok).toBe(true); // hors production : liaison libre
    const b = await putBinding(world.deps, ctx, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
    expect(b.ok).toBe(true);
    const placeholder = await resolve(world.deps, ctx, { contractId: "coef-period@1", levelCode: "PRIMARY", date: "2026-10-01" });
    expect(placeholder.ok && placeholder.value.resolved?.sourceKind).toBe("placeholder");
    expect(placeholder.ok && placeholder.value.resolved?.ruleSetCode).toBe("CI-PRIMARY-PLACEHOLDER");
    const platform = await resolve(world.deps, ctx, { contractId: "credit-semester@1", date: "2025-09-15" });
    expect(platform.ok && platform.value.resolved?.sourceKind).toBe("platform");
    // la version chargée porte la même provenance (lue par les consommateurs pour le filigrane)
    const loaded = await loadVersion(world.deps, ctx, placeholder.ok ? (placeholder.value.resolved as { ruleVersionId: string }).ruleVersionId : "");
    expect(loaded.ok && loaded.value.version.source.kind).toBe("placeholder");
  });

  describe("en production", () => {
    const base = { contractId: "coef-period@1", ruleSetCode: "CI-PRIMARY-PLACEHOLDER", levelCode: "PRIMARY", effectiveFrom: "2026-09-01" };

    it("refuse la liaison d'un jeu fictif sans accusé (`rules.placeholder_requires_ack`), rien n'est écrit", async () => {
      prod.audit.clear();
      const ctx = adminCtx(tenantB);
      const r = await putBinding(prod.deps, ctx, base);
      expect(!r.ok && r.error.code).toBe("rules.placeholder_requires_ack");
      expect(!r.ok && r.error.httpStatus).toBe(400);
      expect((await adminRows(db, "SELECT 1 FROM rules.rule_bindings WHERE tenant_id = $1", [tenantB])).length).toBe(0);
      expect(prod.audit.actions()).toEqual([]);
    });

    it("refuse un accusé non motivé", async () => {
      const r = await putBinding(prod.deps, adminCtx(tenantB), { ...base, placeholderAck: { reason: "ok" } });
      expect(!r.ok && r.error.code).toBe("rules.placeholder_requires_ack");
    });

    it("accepte un accusé motivé : tracé (audit warning, colonnes, événement) et conservé", async () => {
      prod.audit.clear();
      const ctx = adminCtx(tenantB);
      const r = await putBinding(prod.deps, ctx, { ...base, placeholderAck: { reason: "Démonstration devant l'inspection, sans valeur officielle." } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.placeholderAck).toMatchObject({ by: ctx.userId, reason: "Démonstration devant l'inspection, sans valeur officielle." });
      expect(prod.audit.actions()).toEqual(["rules.binding.created", "rules.binding.placeholder_acknowledged"]);
      const ack = prod.audit.entries.find((e) => e.action === "rules.binding.placeholder_acknowledged");
      expect(ack?.severity).toBe("warning");
      expect(ack?.reason).toMatch(/Démonstration/);
      const rows = await adminRows<{ placeholder_ack_by: string; placeholder_ack_at: Date; placeholder_ack_reason: string }>(db, "SELECT placeholder_ack_by, placeholder_ack_at, placeholder_ack_reason FROM rules.rule_bindings WHERE id = $1", [r.value.id]);
      expect(rows[0]?.placeholder_ack_by).toBe(ctx.userId);
      expect(rows[0]?.placeholder_ack_at).toBeInstanceOf(Date);
      const events = await adminRows<{ payload: { placeholderAcknowledged?: boolean; v: number } }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'rules.binding.changed' AND tenant_id = $1", [tenantB]);
      expect(events.some((e) => e.payload.placeholderAcknowledged === true && e.payload.v === 1)).toBe(true);
    });

    it("un jeu qui n'est pas fictif ne demande jamais d'accusé", async () => {
      const r = await putBinding(prod.deps, adminCtx(tenantB), { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
      expect(r.ok && r.value.placeholderAck).toBeNull();
    });

    it("la base refuse un accusé incomplet (garde-fou indépendant de l'application)", async () => {
      const ctx = adminCtx(tenantB);
      const incomplete = await db.admin
        .query(
          "INSERT INTO rules.rule_bindings (id, tenant_id, contract_id, rule_set_code, effective_from, placeholder_ack_by) VALUES (gen_random_uuid(), $1, 'coef-period@1', 'CI-PRIMARY-PLACEHOLDER', '2030-01-01', $2)",
          [tenantB, ctx.userId],
        )
        .then(() => "ok")
        .catch((e: { message: string }) => e.message);
      expect(incomplete).toMatch(/rule_bindings_placeholder_ack_ck/);
    });
  });

  it("une variante d'un jeu fictif reste fictive", async () => {
    const ctx = adminCtx(tenantA);
    const base = await nationalVersion(db, "CI-SECONDARY-PLACEHOLDER");
    const variant = await derive(world.deps, ctx, base);
    expect(variant.source.kind).toBe("placeholder");
    expect(variant.source.reference).toMatch(/CI-SECONDARY-PLACEHOLDER/);
  });

  describe("garde-fous SQL", () => {
    const insertNational = (kind: string, reference: string | null) =>
      db.admin
        .query(
          `INSERT INTO rules.national_rule_versions (id, rule_set_id, version, status, contract_id, effective_from, source_kind, source_reference)
           SELECT gen_random_uuid(), id, (SELECT coalesce(max(version), 0) + 1 FROM rules.national_rule_versions v WHERE v.rule_set_id = rules.national_rule_sets.id), 'draft', 'coef-semester@1', '2075-01-01', $1, $2 FROM rules.national_rule_sets WHERE code = 'CI-EXAM-PLACEHOLDER'`,
          [kind, reference],
        )
        .then(() => "ok")
        .catch((e: { message: string }) => e.message);

    it("une version `regulation` cite son texte ; `placeholder` est admis", async () => {
      expect(await insertNational("regulation", null)).toMatch(/regulation_ref_ck/);
      expect(await insertNational("regulation", "   ")).toMatch(/regulation_ref_ck/);
      expect(await insertNational("regulation", "Arrêté n° 000 (exemple)")).toBe("ok");
      expect(await insertNational("placeholder", null)).toBe("ok");
      expect(await insertNational("inconnue", null)).toMatch(/source_kind_check/);
    });

    it("la provenance d'une version publiée est immuable (un jeu fictif ne devient pas un règlement)", async () => {
      const r = await db.admin
        .query("UPDATE rules.national_rule_versions SET source_kind = 'regulation', source_reference = 'Texte' WHERE status = 'published' AND source_kind = 'placeholder'")
        .then(() => "ok")
        .catch((e: { message: string }) => e.message);
      expect(r).toMatch(/version_immutable/);
    });
  });
});
