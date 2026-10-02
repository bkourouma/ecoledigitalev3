/**
 * Données de départ : base vide + migrations ⇒ les RuleSets de départ `published` (3 portages du legacy + 3 jeux fictifs de la
 * Phase 4-5, `source_kind = placeholder`), chaque règle compile, le hash stocké égale celui des
 * données ; le chargement est idempotent, concurrent-safe, et une altération de la v1 est refusée (R-RUL-12).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContract } from "../contracts";
import { checkConformity } from "../domain/conformity";
import { computeDefinitionHash } from "../domain/definition";
import { newId } from "@ecoledigitale/kernel";
import { ensureNationalCatalog } from "../application/seed";
import { closeVersionPeriod } from "../application/transitions";
import { getRules, listVersions, listVersionEvents, listRuleSets } from "../infrastructure/catalog-repository";
import { SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";
import { adminRows, createRulesTestDb, describeIntegration, makeWorld, type RulesTestDb, type TestWorld } from "./support/db";

/** « CODE vN » de chaque version de départ (portages du legacy et jeux fictifs). */
const SEED_LABELS = SEED_RULE_SETS.flatMap((s) => s.versions.map((v) => `${s.code} v${v.versionNo}`)).sort();
const SEED_VERSION_COUNT = SEED_LABELS.length;

describeIntegration("données de départ du catalogue national", () => {
  let db: RulesTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createRulesTestDb();
    world = makeWorld(db);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("charge les RuleSets de départ (portages du legacy et jeux fictifs), publiés, signés de leur hash", async () => {
    const report = await ensureNationalCatalog(world.deps);
    expect(report.created.sort()).toEqual(SEED_LABELS);

    const rows = await adminRows<{ code: string; version: number; status: string; definition_hash: string; contract_id: string; effective_from: string; approved_by: string; source_kind: string; rules: string }>(
      db,
      `SELECT s.code, v.version, v.status, v.definition_hash, v.contract_id, to_char(v.effective_from, 'YYYY-MM-DD') AS effective_from, v.approved_by, v.source_kind,
              (SELECT count(*) FROM rules.national_rule_definitions d WHERE d.rule_version_id = v.id)::text AS rules
         FROM rules.national_rule_versions v JOIN rules.national_rule_sets s ON s.id = v.rule_set_id ORDER BY s.code, v.version`,
    );
    expect(rows.map((r) => [r.code, Number(r.version), r.status, r.contract_id, r.effective_from, r.source_kind])).toEqual([
      ["CI-CLASSIC-SEMESTRE", 1, "published", "coef-semester@1", "2024-09-01", "platform"],
      ["CI-EXAM-PLACEHOLDER", 1, "published", "exam-national@1", "2026-09-01", "placeholder"],
      ["CI-HIGHER-BTS", 1, "published", "coef-semester@1", "2024-09-01", "platform"],
      ["CI-HIGHER-LMD", 1, "published", "credit-semester@1", "2024-09-01", "platform"],
      ["CI-PRIMARY-PLACEHOLDER", 1, "published", "coef-period@1", "2026-09-01", "placeholder"],
      ["CI-PRIMARY-PLACEHOLDER", 2, "published", "competency-period@1", "2026-09-01", "placeholder"],
      ["CI-SECONDARY-PLACEHOLDER", 1, "published", "coef-semester@1", "2026-09-01", "placeholder"],
      ["CI-SECONDARY-PLACEHOLDER", 2, "published", "secondary-annual@1", "2026-09-01", "placeholder"],
    ]);
    for (const row of rows) {
      const seed = SEED_RULE_SETS.find((s) => s.code === row.code)!.versions.find((v) => v.versionNo === Number(row.version))!;
      expect(row.definition_hash).toBe(computeDefinitionHash(seed.contractId, seedVersionRecords(seed)));
      expect(Number(row.rules)).toBe(seed.rules.length);
      expect(row.approved_by).not.toBeNull();
    }
  });

  it("chaque règle stockée compile et satisfait son contrat", async () => {
    await db.systemDb.run("test-read", async (tx) => {
      for (const set of await listRuleSets(tx, "NATIONAL")) {
        for (const version of await listVersions(tx, "NATIONAL", { ruleSetId: set.id })) {
          const report = checkConformity(getContract(version.contractId)!, await getRules(tx, "NATIONAL", version.id));
          expect(report.violations, `${set.code}`).toEqual([]);
          expect(report.rules.filter((r) => !r.ok), `${set.code}`).toEqual([]);
        }
      }
    });
  });

  it("a parcouru la machine d'états (historique complet, acteur système figé)", async () => {
    await db.systemDb.run("test-read", async (tx) => {
      const [lmd] = await listVersions(tx, "NATIONAL", { ruleSetCode: "CI-HIGHER-LMD" });
      const events = await listVersionEvents(tx, "NATIONAL", lmd!.id);
      expect(events.map((e) => `${e.fromStatus ?? "-"}>${e.toStatus}`)).toEqual(["-" + ">draft", "draft>simulated", "simulated>proposed", "proposed>approved", "approved>published"]);
      expect(new Set(events.map((e) => e.actorName)).size).toBe(1);
    });
    expect(world.audit.platformActions()).toEqual(expect.arrayContaining(["rules.version.simulated", "rules.version.published"]));
  });

  it("est idempotent : un second chargement ne crée rien et vérifie les hash", async () => {
    const again = await ensureNationalCatalog(world.deps);
    expect(again.created).toEqual([]);
    expect(again.verified.sort()).toEqual(SEED_LABELS);
  });

  it("supporte des démarrages concurrents (verrou consultatif)", async () => {
    const fresh = await createRulesTestDb();
    try {
      const w = makeWorld(fresh);
      const reports = await Promise.all([ensureNationalCatalog(w.deps), ensureNationalCatalog(w.deps), ensureNationalCatalog(w.deps)]);
      expect(reports.reduce((n, r) => n + r.created.length, 0)).toBe(SEED_VERSION_COUNT);
      const rows = await adminRows<{ n: string }>(fresh, "SELECT count(*)::text AS n FROM rules.national_rule_versions");
      expect(rows[0]?.n).toBe(String(SEED_VERSION_COUNT));
    } finally {
      await fresh.drop();
    }
  });

  it("refuse une altération des données de la v1 (R-RUL-12 : nouvelle version, jamais de modification)", async () => {
    const tampered = SEED_RULE_SETS.map((s) =>
      s.code === "CI-HIGHER-LMD"
        ? { ...s, versions: [{ ...s.versions[0]!, rules: s.versions[0]!.rules.map((r) => (r.key === "note_ecue" ? { ...r, parameters: { ...r.parameters, poids_examen: { ...r.parameters!.poids_examen!, default: 0.7 } } } : r)) }] }
        : s,
    );
    await expect(ensureNationalCatalog(world.deps, tampered)).rejects.toMatchObject({ code: "rules.hash_mismatch" });
  });

  it("ajoute une version 2 aux données sans toucher à la v1", async () => {
    const lmd = SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!;
    const v2 = {
      ...lmd.versions[0]!,
      versionNo: 2,
      effectiveFrom: "2030-09-01",
      rules: lmd.versions[0]!.rules.map((r) => (r.key === "note_ecue" ? { ...r, parameters: { ...r.parameters, poids_devoirs: { ...r.parameters!.poids_devoirs!, default: 0.5 }, poids_examen: { ...r.parameters!.poids_examen!, default: 0.5 } } } : r)),
    };
    // La v1 n'a pas de fin : sans clôture de sa période, la v2 chevaucherait (AC3.3).
    const [v1] = await db.systemDb.run("test-read", (tx) => listVersions(tx, "NATIONAL", { ruleSetCode: "CI-HIGHER-LMD" }));
    await expect(ensureNationalCatalog(world.deps, [{ ...lmd, versions: [lmd.versions[0]!, v2] }])).rejects.toMatchObject({ code: "rules.overlap" });
    const closed = await closeVersionPeriod(world.deps, { id: newId() }, { versionId: v1!.id, effectiveTo: "2030-08-31", comment: "Préparation de la v2." });
    expect(closed.ok).toBe(true);

    const report = await ensureNationalCatalog(world.deps, [{ ...lmd, versions: [lmd.versions[0]!, v2] }]);
    expect(report.created).toEqual(["CI-HIGHER-LMD v2"]);
    expect(report.verified).toEqual(["CI-HIGHER-LMD v1"]);
    // La v1 reste intacte (hash et contenu) : seule sa fin d'effet a été clôturée.
    const [after] = await adminRows<{ definition_hash: string; effective_to: string }>(db, "SELECT definition_hash, to_char(effective_to, 'YYYY-MM-DD') AS effective_to FROM rules.national_rule_versions WHERE id = $1", [v1!.id]);
    expect(after!.definition_hash).toBe(v1!.definitionHash);
    expect(after!.effective_to).toBe("2030-08-31");
  });
});
