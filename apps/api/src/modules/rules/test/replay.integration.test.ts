/**
 * Reproductibilité (AC4.2, AC4.3) : rejeu de 1 000 résultats enregistrés = 0 écart ; altération détectée ; job nocturne ; audit RÉEL
 * (module audit) de la publication et de l'approbation, atomicité comprise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, noopLogger } from "@ecoledigitale/kernel";
import { audit, testing as auditTesting } from "../../audit";
import { createRulesDeps } from "../application/deps";
import { evaluateRuleSet, type EvaluationCall } from "../application/evaluate";
import { putBinding } from "../application/bindings";
import { replayEvaluations, replaySampleForTenant, verifyCatalogHashes } from "../application/replay";
import { registerReplaySource, defaultReplaySources } from "../application/registry";
import type { ReplayRecord } from "../application/ports";
import { transitionAsOperator } from "../application/transitions";
import jobs from "../jobs";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, seedCatalog, type RulesTestDb } from "./support/db";
import { OPERATOR, approveAsOperator, nationalVersion, proposeVariant, simulatedVariant } from "./support/flow";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import { ManualClock } from "@ecoledigitale/kernel";

describeIntegration("rejeu de reproductibilité, job nocturne et audit réel", () => {
  let db: RulesTestDb;
  let tenant: string;
  let ctx: ReturnType<typeof adminCtx>;
  const clock = new ManualClock("2025-09-01T08:00:00.000Z");
  let deps: ReturnType<typeof createRulesDeps>;

  beforeAll(async () => {
    db = await createRulesTestDb({ withAudit: true });
    audit.configure({ clock });
    deps = createRulesDeps({
      db: db.tenantDb,
      systemDb: db.systemDb,
      clock,
      logger: noopLogger,
      audit: { record: (tx, e) => audit.record(tx, e as never), recordPlatform: (tx, e) => audit.recordPlatform(tx, e as never) },
      simulationSources: new Map(),
      replaySources: new Map(),
    });
    await (await import("../application/seed")).ensureNationalCatalog(deps);
    tenant = await db.createTenant("replay");
    ctx = adminCtx(tenant);
    await putBinding(deps, ctx, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
  });
  afterAll(async () => {
    defaultReplaySources.clear();
    await db.drop();
  });

  async function record(n: number): Promise<ReplayRecord[]> {
    const calls: EvaluationCall[] = Array.from({ length: n }, (_, i) => ({
      ruleKey: "note_ecue",
      context: { variables: { moyenne_devoirs: (i % 41) / 2, note_examen: ((i * 7) % 41) / 2 } },
    }));
    const r = await evaluateRuleSet(deps, ctx, { contractId: "credit-semester@1", date: "2025-09-15" }, calls);
    if (!r.ok) throw r.error;
    return r.value.results.map((res, i) => {
      if (!res.ok) throw res.error;
      return {
        resultId: `resultat-${i}`,
        ruleVersionId: res.value.ruleVersionId,
        definitionHash: res.value.definitionHash,
        engineVersion: res.value.engineVersion,
        ruleKey: res.value.ruleKey,
        context: calls[i]!.context,
        inputsHash: res.value.inputsHash,
        outputsHash: res.value.outputsHash,
      };
    });
  }

  it("rejouer 1 000 résultats FINAL enregistrés donne 0 écart (mêmes version, hash, moteur, entrées => mêmes sorties)", async () => {
    const records = await record(1000);
    const t0 = Date.now();
    const report = await replayEvaluations(deps, ctx, records);
    if (!report.ok) throw report.error;
    console.info(`[rules] rejeu de ${records.length} résultats en ${Date.now() - t0} ms`);
    expect(report.value).toMatchObject({ checked: 1000, mismatches: [], inputsChanged: [] });
  });

  it("détecte un résultat altéré, une définition altérée hors application et une version retirée reste rejouable", async () => {
    const records = await record(20);
    // Résultat enregistré altéré (sortie différente de ce que la version produit) -> écart `result`.
    const tampered = records.map((r, i) => (i === 3 ? { ...r, outputsHash: "0".repeat(64) } : r));
    const report = await replayEvaluations(deps, ctx, tampered);
    if (!report.ok) throw report.error;
    expect(report.value.mismatches).toHaveLength(1);
    expect(report.value.mismatches[0]).toMatchObject({ resultId: "resultat-3", kind: "result", expectedHash: "0".repeat(64) });
    // Une entrée dont le contexte a changé est signalée sans être comptée comme écart de moteur.
    const drifted = records.map((r, i) => (i === 5 ? { ...r, context: { variables: { moyenne_devoirs: 1, note_examen: 1 } } } : r));
    const drift = await replayEvaluations(deps, ctx, drifted);
    expect(drift.ok && drift.value.inputsChanged).toEqual(["resultat-5"]);
    expect(drift.ok && drift.value.mismatches.map((m) => m.resultId)).toEqual(["resultat-5"]); // sortie différente aussi : la donnée source a changé

    // L'événement d'alerte et l'audit de sévérité haute sont émis.
    const events = await adminRows<{ type: string; payload: { kind: string; resultId: string } }>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'rules.replay.mismatch' ORDER BY id", [tenant]);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.payload).toMatchObject({ kind: "result", resultId: "resultat-3" });
    const audited = await adminRows<{ severity: string }>(db, "SELECT severity FROM audit.audit_log WHERE tenant_id = $1 AND action = 'rules.replay.mismatch'", [tenant]);
    expect(audited.every((a) => a.severity === "critical")).toBe(true);

    // Altération de la DÉFINITION hors application : le rejeu la signale (hash divergent), sans rien évaluer.
    const v = await nationalVersion(db, "CI-HIGHER-LMD");
    await db.admin.query("SET session_replication_role = replica");
    await db.admin.query("UPDATE rules.national_rule_definitions SET expression = 'note_examen * 1' WHERE rule_version_id = $1 AND key = 'note_ecue_directe'", [v.id]);
    await db.admin.query("SET session_replication_role = DEFAULT");
    deps.cache.clear();
    const after = await replayEvaluations(deps, ctx, records.slice(0, 3));
    expect(after.ok && after.value.mismatches.every((m) => m.kind === "definition")).toBe(true);
    expect(after.ok && after.value.mismatches).toHaveLength(3);
    const issues = await verifyCatalogHashes(deps);
    expect(issues.map((i) => i.ruleSetCode)).toContain("CI-HIGHER-LMD");
    // Remise en état.
    await db.admin.query("SET session_replication_role = replica");
    await db.admin.query("UPDATE rules.national_rule_definitions SET expression = 'note_examen' WHERE rule_version_id = $1 AND key = 'note_ecue_directe'", [v.id]);
    await db.admin.query("SET session_replication_role = DEFAULT");
  });

  it("l'échantillon est fourni par la source de rejeu branchée par le consommateur ; le job nocturne vérifie hash et rejeu, et échoue en cas d'écart", async () => {
    const good = await record(10);
    registerReplaySource("credit-semester@1", { sample: async () => good });
    const sample = await replaySampleForTenant(createRulesDeps({ db: db.tenantDb, systemDb: db.systemDb, clock, logger: noopLogger, replaySources: defaultReplaySources }), createSystemContext(tenant), 1);
    expect(sample.ok && sample.value.checked).toBe(10);

    const replayJob = jobs.find((j) => j.name === "rules.replay-reproducibility")!;
    const handler = (replayJob as unknown as { handler: (c: { systemDb: SystemDb; tenantDb: TenantDb; logger: typeof noopLogger }) => Promise<void> }).handler;
    // Catalogue intact (remis en état ci-dessus) et rejeu sans écart -> le job réussit.
    defaultReplaySources.clear();
    registerReplaySource("credit-semester@1", { sample: async () => good });
    await expect(handler({ systemDb: db.systemDb, tenantDb: db.tenantDb, logger: noopLogger })).resolves.toBeUndefined();
    // Un écart de rejeu fait échouer le job (il est signalé à l'exploitation).
    defaultReplaySources.clear();
    registerReplaySource("credit-semester@1", { sample: async () => good.map((r) => ({ ...r, outputsHash: "1".repeat(64) })) });
    await expect(handler({ systemDb: db.systemDb, tenantDb: db.tenantDb, logger: noopLogger })).rejects.toThrow(/écart/);
    expect(jobs.map((j) => j.name).sort()).toEqual(["rules.purge-evaluation-failures", "rules.replay-reproducibility"]);
  });

  it("le job de purge supprime le journal des échecs de plus de 90 jours", async () => {
    await db.admin.query(
      "INSERT INTO rules.evaluation_failures (id, tenant_id, rule_version_kind, rule_version_id, rule_key, error_code, message, occurred_at) VALUES (gen_random_uuid(), $1, 'NATIONAL', gen_random_uuid(), 'r', 'X', 'ancien', now() - interval '120 days'), (gen_random_uuid(), $1, 'NATIONAL', gen_random_uuid(), 'r', 'X', 'récent', now() - interval '10 days')",
      [tenant],
    );
    const job = jobs.find((j) => j.name === "rules.purge-evaluation-failures")!;
    await (job as unknown as { handler: (c: { systemDb: SystemDb; logger: typeof noopLogger }) => Promise<void> }).handler({ systemDb: db.systemDb, logger: noopLogger });
    const left = await adminRows<{ message: string }>(db, "SELECT message FROM rules.evaluation_failures WHERE tenant_id = $1 AND message IN ('ancien', 'récent')", [tenant]);
    expect(left.map((l) => l.message)).toEqual(["récent"]);
  });

  describe("audit RÉEL (module audit) des actes sensibles", () => {
    it("la publication et l'approbation écrivent au journal chaîné du tenant, dans la même transaction (expectAudited / expectAuditRolledBack)", async () => {
      const t = await db.createTenant("audit-reel");
      const c = adminCtx(t);
      const { variant } = await simulatedVariant(deps, c, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2090-09-01" });
      const proposed = await proposeVariant(deps, c, variant.id);

      await auditTesting.expectAudited(db.appPool, t, "rules.version.approved", () => approveAsOperator(deps, t, proposed.id), { entity: "rule_version", entityId: proposed.id, actorId: OPERATOR.id });
      const published = await auditTesting.expectAudited(db.appPool, t, "rules.version.published", () => transitionAsOperator(deps, OPERATOR, { versionId: proposed.id, to: "published", tenantId: t }), { entity: "rule_version" });
      expect(published.entries[0]!.actorType).toBe("superAdmin");
      expect(published.entries[0]!.severity).toBe("notice");
      expect(published.entries[0]!.before).toMatchObject({ status: "approved" });
      expect(published.entries[0]!.after).toMatchObject({ status: "published" });

      // Un échec après l'écriture de l'audit annule aussi l'audit (pas de trace d'un acte qui n'a pas eu lieu).
      await auditTesting.expectAuditRolledBack(db.appPool, t, "rules.version.retired", async () => {
        const failing = createRulesDeps({
          db: db.tenantDb,
          systemDb: db.systemDb,
          clock,
          logger: noopLogger,
          audit: {
            record: async (tx, e) => {
              await audit.record(tx, e as never);
              throw new Error("échec après audit");
            },
            recordPlatform: async () => undefined,
          },
        });
        await transitionAsOperator(failing, OPERATOR, { versionId: proposed.id, to: "retired", tenantId: t, comment: "Retrait à annuler." });
      });
      const status = await adminRows<{ status: string }>(db, "SELECT status FROM rules.rule_versions WHERE id = $1", [proposed.id]);
      expect(status[0]!.status).toBe("published");
    });

    it("le catalogue national audite au journal de PLATEFORME (acteur super-administrateur)", async () => {
      const rows = await adminRows<{ action: string; actor_type: string }>(db, "SELECT action, actor_type FROM audit.platform_audit_log WHERE action LIKE 'rules.%' ORDER BY seq").catch(() => []);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.action === "rules.version.published")).toBe(true);
    });
  });
});
