/**
 * Mentions du primaire (décision Q-P05, 2026-10-05) sur base réelle, RLS A/B : chaque établissement règle SES seuils de mention (et peut
 * désactiver les mentions) dans une variante PRIVÉE du jeu fictif `CI-PRIMARY-PLACEHOLDER` ; le jeu national et les autres établissements
 * ne bougent pas. Valeurs de départ fictives (`placeholder`), seuils bornés 0..20, aucune mention officielle inventée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getVersionDetail } from "../application/catalog";
import { createCompiledVersion } from "../application/compiled";
import { evaluate } from "../application/evaluate";
import { editParameters } from "../application/variants";
import { computeDefinitionHash } from "../domain/definition";
import { getRules, listVersions } from "../infrastructure/catalog-repository";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { derive } from "./support/flow";

describeIntegration("mentions du primaire : seuils réglables par établissement (variantes privées, RLS A/B)", () => {
  let db: RulesTestDb;
  let world: TestWorld;
  let ctxA: ReturnType<typeof adminCtx>;
  let ctxB: ReturnType<typeof adminCtx>;

  beforeAll(async () => {
    db = await createRulesTestDb({ withAudit: false });
    world = makeWorld(db);
    await seedCatalog(world);
    ctxA = adminCtx(await db.createTenant("ecole-a"));
    ctxB = adminCtx(await db.createTenant("ecole-b"));
  });
  afterAll(async () => {
    await db.drop();
  });

  const nationalCoef = async () => {
    const all = await db.systemDb.run("test-national", (tx) => listVersions(tx, "NATIONAL", { ruleSetCode: "CI-PRIMARY-PLACEHOLDER", contractId: "coef-period@1" }));
    return all;
  };

  /** Mention produite par la version `versionId` (variante de l'établissement) pour une moyenne donnée. */
  async function mentionOf(ctx: ReturnType<typeof adminCtx>, versionId: string, moyenne: number | null): Promise<string | null> {
    const detail = await getVersionDetail(world.deps, ctx, versionId);
    if (!detail.ok) throw detail.error;
    const { version: record, rules } = detail.value;
    const compiled = createCompiledVersion(record, rules, computeDefinitionHash(record.contractId, rules));
    const out = evaluate(compiled, { ruleKey: "mention_periode", context: { variables: { moyenne } }, trace: false });
    if (!out.ok) throw out.error;
    return typeof out.value.value === "string" ? out.value.value : null;
  }

  it("le catalogue ne propose que la version 3 (la version 1, remplacée, est retirée) ; elle porte la règle de mention et reste fictive", async () => {
    const versions = await nationalCoef();
    expect(versions.map((v) => [v.versionNo, v.status, v.source.kind])).toEqual(expect.arrayContaining([[1, "retired", "placeholder"], [3, "published", "placeholder"]]));
    const v3 = versions.find((v) => v.versionNo === 3)!;
    const rules = await db.systemDb.run("test-rules", (tx) => getRules(tx, "NATIONAL", v3.id));
    const mention = rules.find((r) => r.key === "mention_periode")!;
    expect(mention.isOptional).toBe(true);
    expect(Object.fromEntries(Object.entries(mention.parameters).map(([k, v]) => [k, (v as { default: number }).default]))).toEqual({ actif: 1, passable: 10, assez_bien: 12, bien: 14, tres_bien: 16, excellent: 18 });
  });

  it("l'établissement A règle ses seuils dans sa variante (bornes 0..20 imposées) ; le national et l'établissement B ne bougent pas", async () => {
    const v3 = (await nationalCoef()).find((v) => v.versionNo === 3)!;
    const variantA = await derive(world.deps, ctxA, v3, { effectiveFrom: "2026-09-01" });
    expect(await mentionOf(ctxA, variantA.id, 13)).toBe("FAIRLY_GOOD"); // seuils de départ : « Bien » à partir de 14

    const edited = await editParameters(world.deps, ctxA, {
      versionId: variantA.id,
      changes: [
        { ruleKey: "mention_periode", parameter: "bien", value: 13 },
        { ruleKey: "mention_periode", parameter: "assez_bien", value: 11 },
      ],
    });
    expect(edited.ok).toBe(true);
    expect(await mentionOf(ctxA, variantA.id, 13)).toBe("GOOD");
    expect(await mentionOf(ctxA, variantA.id, 11.5)).toBe("FAIRLY_GOOD");

    // Bornes : un seuil hors de 0..20 est refusé (jamais écrit).
    const tooHigh = await editParameters(world.deps, ctxA, { versionId: variantA.id, changes: [{ ruleKey: "mention_periode", parameter: "excellent", value: 25 }] });
    expect(tooHigh.ok).toBe(false);
    expect(!tooHigh.ok && tooHigh.error.code).toBe("rules.parameter_out_of_range");
    expect(await mentionOf(ctxA, variantA.id, 19)).toBe("EXCELLENT");

    // Le jeu national est inchangé ; l'établissement B ne voit pas la variante de A (RLS) et obtient les seuils de départ.
    const national = await adminRows<{ parameters: Record<string, { default: number }> }>(
      db,
      "SELECT d.parameters FROM rules.national_rule_definitions d JOIN rules.national_rule_versions v ON v.id = d.rule_version_id JOIN rules.national_rule_sets s ON s.id = v.rule_set_id WHERE s.code = 'CI-PRIMARY-PLACEHOLDER' AND v.version = 3 AND d.key = 'mention_periode'",
    );
    expect(national[0]!.parameters.bien!.default).toBe(14);
    const seenByB = await getVersionDetail(world.deps, ctxB, variantA.id);
    expect(seenByB.ok).toBe(false);
    expect(!seenByB.ok && seenByB.error.code).toBe("rules.version_not_found");
    const rowsB = await db.tenantDb.run(ctxB, (tx) => tx.many("SELECT id FROM rules.rule_versions WHERE id = $1", [variantA.id]));
    expect(rowsB).toEqual([]);

    const variantB = await derive(world.deps, ctxB, v3, { effectiveFrom: "2026-09-01" });
    expect(await mentionOf(ctxB, variantB.id, 13)).toBe("FAIRLY_GOOD");
  });

  it("l'établissement désactive les mentions (actif = 0) : aucune mention produite, sans toucher aux seuils", async () => {
    const v3 = (await nationalCoef()).find((v) => v.versionNo === 3)!;
    const variant = await derive(world.deps, ctxA, v3, { effectiveFrom: "2027-09-01" });
    expect(await mentionOf(ctxA, variant.id, 17)).toBe("VERY_GOOD");
    expect((await editParameters(world.deps, ctxA, { versionId: variant.id, changes: [{ ruleKey: "mention_periode", parameter: "actif", value: 0 }] })).ok).toBe(true);
    expect(await mentionOf(ctxA, variant.id, 17)).toBe("PENDING");
    // Seule la valeur 0 ou 1 est permise.
    const bad = await editParameters(world.deps, ctxA, { versionId: variant.id, changes: [{ ruleKey: "mention_periode", parameter: "actif", value: 2 }] });
    expect(bad.ok).toBe(false);
  });
});

void describe;
