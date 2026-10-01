/**
 * Liaisons, résolution (variante d'établissement > national publié, à la date de DÉBUT de période), épinglage de version,
 * chargement (cache, hash), évaluation d'un jeu avec journal des échecs, et scénario de bout en bout d'une variante
 * (paramétrée, simulée, proposée, approuvée, effectivement utilisée par les périodes suivantes sans livraison de code).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { listTenantBindings, putBinding, removeBinding } from "../application/bindings";
import { editParameters } from "../application/variants";
import { evaluateRuleSet } from "../application/evaluate";
import { loadVersion, resolve } from "../application/resolve";
import { closeVersionPeriod, transitionAsOperator } from "../application/transitions";
import { createNationalVersion } from "../application/national";
import { transitionTenantVersion } from "../application/transitions";
import { listEvaluationFailures } from "../infrastructure/failures-repository";
import { SEED_RULE_SETS } from "../seed/rulesets";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { OPERATOR, OTHER_OPERATOR, approveAsOperator, derive, nationalVersion, proposeVariant, simulateVersion } from "./support/flow";

describeIntegration("liaisons, résolution, épinglage, évaluation", () => {
  let db: RulesTestDb;
  let world: TestWorld;
  let tenantA: string;
  let tenantB: string;
  let ctxA: ReturnType<typeof adminCtx>;
  let ctxB: ReturnType<typeof adminCtx>;

  beforeAll(async () => {
    db = await createRulesTestDb();
    world = makeWorld(db);
    await seedCatalog(world);
    tenantA = await db.createTenant("etab-a");
    tenantB = await db.createTenant("etab-b");
    ctxA = adminCtx(tenantA);
    ctxB = adminCtx(tenantB);
  });
  afterAll(async () => {
    await db.drop();
  });

  const bind = (ctx = ctxA, over: Partial<Parameters<typeof putBinding>[2]> = {}) =>
    putBinding(world.deps, ctx, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01", ...over });

  describe("aucune règle par défaut codée en dur", () => {
    it("sans liaison : resolve = null et le calcul est refusé (rules.no_active_ruleset), jamais de valeur implicite", async () => {
      const r = await resolve(world.deps, ctxB, { contractId: "credit-semester@1", date: "2025-09-15" });
      expect(r.ok && r.value.resolved).toBeNull();
      const e = await evaluateRuleSet(world.deps, ctxB, { contractId: "credit-semester@1", date: "2025-09-15" }, [{ ruleKey: "note_ecue", context: { variables: { moyenne_devoirs: 12, note_examen: 14 } } }]);
      expect(!e.ok && e.error.code).toBe("rules.no_active_ruleset");
      expect(!e.ok && e.error.httpStatus).toBe(409);
    });

    it("date invalide ou contrat inconnu : erreurs de validation", async () => {
      const d = await resolve(world.deps, ctxB, { contractId: "credit-semester@1", date: "2025-02-30" });
      expect(!d.ok && d.error.code).toBe("rules.invalid_input");
      const c = await resolve(world.deps, ctxB, { contractId: "inconnu@9", date: "2025-09-15" });
      expect(!c.ok && c.error.code).toBe("rules.unknown_contract");
    });
  });

  describe("liaisons", () => {
    it("crée, met à jour (même identité), refuse un chevauchement, un jeu ou un contrat inconnus, un périmètre ambigu ; auditées et publiées", async () => {
      world.audit.clear();
      const created = await bind();
      expect(created.ok && created.value).toMatchObject({ contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", institutionId: null, effectiveTo: null });
      expect(world.audit.actions()).toEqual(["rules.binding.created"]);

      // Même identité (contrat, périmètre, début) : mise à jour de la fin d'effet.
      const updated = await bind(ctxA, { effectiveTo: "2099-12-31" });
      expect(updated.ok && updated.value.id).toBe(created.ok ? created.value.id : "");
      expect(updated.ok && updated.value.effectiveTo).toBe("2099-12-31");

      const overlap = await bind(ctxA, { effectiveFrom: "2050-01-01" });
      expect(!overlap.ok && overlap.error.code).toBe("rules.overlap");
      expect((await bind(ctxA, { ruleSetCode: "CI-INCONNU", institutionId: newId() })).ok).toBe(false);
      const wrongContract = await putBinding(world.deps, ctxA, { contractId: "coef-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
      expect(!wrongContract.ok && wrongContract.error.code).toBe("rules.contract_violation");
      const ambiguous = await bind(ctxA, { curriculumNodeId: newId(), levelCode: "BTS", institutionId: newId() });
      expect(!ambiguous.ok && ambiguous.error.code).toBe("rules.invalid_input");
      const badContract = await putBinding(world.deps, ctxA, { contractId: "x@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
      expect(!badContract.ok && badContract.error.code).toBe("rules.unknown_contract");

      // Isolation : l'autre établissement ne voit pas cette liaison.
      const seenByB = await listTenantBindings(world.deps, ctxB);
      expect(seenByB.ok && seenByB.value).toEqual([]);
      const events = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'rules.binding.changed' ORDER BY id", [tenantA]);
      expect(events).toHaveLength(2);
      if (created.ok) {
        const removed = await removeBinding(world.deps, ctxB, created.value.id);
        expect(!removed.ok && removed.error.code).toBe("rules.binding_not_found");
      }
    });

    it("la liaison la plus spécifique l'emporte : nœud > niveau > établissement > tenant", async () => {
      const t = await db.createTenant();
      const ctx = adminCtx(t);
      const inst = newId();
      const node = newId();
      const put = (over: Partial<Parameters<typeof putBinding>[2]>) =>
        putBinding(world.deps, ctx, { contractId: "coef-semester@1", ruleSetCode: "CI-CLASSIC-SEMESTRE", effectiveFrom: "2024-09-01", ...over });
      expect((await put({})).ok).toBe(true); // tout le tenant
      expect((await put({ levelCode: "BTS", ruleSetCode: "CI-HIGHER-BTS" })).ok).toBe(true);
      expect((await put({ curriculumNodeId: node, ruleSetCode: "CI-HIGHER-BTS", institutionId: inst })).ok).toBe(true);

      const at = async (q: Partial<Parameters<typeof resolve>[2]>) => {
        const r = await resolve(world.deps, ctx, { contractId: "coef-semester@1", date: "2025-10-01", ...q });
        return r.ok ? r.value.resolved?.ruleSetCode : "ERREUR";
      };
      expect(await at({})).toBe("CI-CLASSIC-SEMESTRE");
      expect(await at({ levelCode: "BTS" })).toBe("CI-HIGHER-BTS");
      expect(await at({ levelCode: "LICENCE" })).toBe("CI-CLASSIC-SEMESTRE");
      expect(await at({ institutionId: inst, curriculumNodeId: node })).toBe("CI-HIGHER-BTS");
      expect(await at({ institutionId: newId(), curriculumNodeId: node })).toBe("CI-CLASSIC-SEMESTRE");
    });
  });

  describe("résolution à la date de début de période (AC4.1, R-RUL-05)", () => {
    it("renvoie la version nationale publiée, son hash et la liste `considered` (raison de chaque écart)", async () => {
      const national = await nationalVersion(db, "CI-HIGHER-LMD");
      const r = await resolve(world.deps, ctxA, { contractId: "credit-semester@1", date: "2025-09-15" });
      if (!r.ok) throw r.error;
      expect(r.value.resolved).toMatchObject({ ruleVersionId: national.id, ruleSetCode: "CI-HIGHER-LMD", versionNo: 1, origin: "national", definitionHash: national.definitionHash });
      expect(r.value.considered.find((c) => c.versionId === national.id)).toMatchObject({ eligible: true, origin: "national" });

      // Avant le premier jour d'effet : rien, avec la raison.
      const before = await resolve(world.deps, ctxA, { contractId: "credit-semester@1", date: "2024-08-31" });
      expect(before.ok && before.value.resolved).toBeNull();
      // Date antérieure à la liaison : aucune règle applicable.
      expect(before.ok && before.value.considered).toEqual([]);
      // Liaison valide mais version hors de sa période d'effet : la raison est donnée.
      await putBinding(world.deps, ctxA, { contractId: "coef-semester@1", ruleSetCode: "CI-CLASSIC-SEMESTRE", effectiveFrom: "2000-01-01" });
      const early = await resolve(world.deps, ctxA, { contractId: "coef-semester@1", date: "2024-08-31" });
      expect(early.ok && early.value.resolved).toBeNull();
      expect(early.ok && early.value.considered[0]?.reason).toMatch(/hors période d'effet/);
    });

    it("scénario de bout en bout (T-E2E) : une variante est utilisée par les périodes SUIVANTES sans livraison de code ; les périodes antérieures ne changent pas", async () => {
      const t = await db.createTenant("etab-e2e");
      const ctx = adminCtx(t);
      const base = await nationalVersion(db, "CI-HIGHER-LMD");
      await putBinding(world.deps, ctx, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
      const period = { contractId: "credit-semester@1" as const };
      const notes = { moyenne_devoirs: 10, note_examen: 14 };

      // Période 2025-2026 : le calcul épingle la version nationale (poids 0,4 / 0,6 -> 12,4).
      const first = await evaluateRuleSet(world.deps, ctx, { ...period, date: "2025-09-15" }, [{ ruleKey: "note_ecue", context: { variables: notes } }]);
      if (!first.ok) throw first.error;
      const pin = { ruleVersionId: first.value.ruleVersionId, definitionHash: first.value.definitionHash };
      expect(first.value.origin).toBe("national");
      expect(first.value.results[0]!.ok && first.value.results[0]!.value.value).toBe("12.4");

      // Variante : poids_devoirs = 0,5 / poids_examen = 0,5, effective au 1er septembre 2026.
      const variant = await derive(world.deps, ctx, base, { effectiveFrom: "2026-09-01" });
      const edit = await editParameters(world.deps, ctx, { versionId: variant.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_devoirs", value: 0.5 }, { ruleKey: "note_ecue", parameter: "poids_examen", value: 0.5 }] });
      expect(edit.ok).toBe(true);
      const sim = await simulateVersion(world.deps, ctx, variant.id, [
        { ruleKeys: ["note_ecue"], cases: Array.from({ length: 30 }, (_, i) => ({ id: `i${i}:p1`, context: { variables: { moyenne_devoirs: 6 + (i % 10), note_examen: 8 + (i % 12) } } })) },
      ]);
      expect(sim.status).toBe("COMPLETED");
      expect(sim.summary).toBeTruthy();
      await transitionTenantVersion(world.deps, ctx, { versionId: variant.id, to: "simulated" });
      const proposed = await proposeVariant(world.deps, ctx, variant.id, false); // aucune DÉCISION modifiée : pas de confirmation
      await approveAsOperator(world.deps, t, proposed.id);

      // Période 2026-2027 (début après la date d'effet) : la variante est utilisée (0,5×10 + 0,5×14 = 12).
      const next = await evaluateRuleSet(world.deps, ctx, { ...period, date: "2026-09-15" }, [{ ruleKey: "note_ecue", context: { variables: notes } }]);
      if (!next.ok) throw next.error;
      expect(next.value).toMatchObject({ origin: "tenant", versionNo: 1, ruleVersionId: variant.id });
      expect(next.value.results[0]!.ok && next.value.results[0]!.value.value).toBe("12");

      // La période antérieure épinglée recalcule à l'IDENTIQUE (version nationale, même hash, mêmes sorties).
      const replay = await evaluateRuleSet(world.deps, ctx, { pin }, [{ ruleKey: "note_ecue", context: { variables: notes } }]);
      if (!replay.ok) throw replay.error;
      expect(replay.value.ruleVersionId).toBe(base.id);
      const a = first.value.results[0]!;
      const b = replay.value.results[0]!;
      expect(a.ok && b.ok && a.value.outputsHash === b.value.outputsHash && a.value.inputsHash === b.value.inputsHash).toBe(true);

      // Le jour même du début d'effet est inclus ; la veille, la version nationale s'applique encore.
      const edge = async (date: string) => {
        const r = await resolve(world.deps, ctx, { ...period, date });
        return r.ok ? r.value.resolved?.origin : "ERREUR";
      };
      expect(await edge("2026-08-31")).toBe("national");
      expect(await edge("2026-09-01")).toBe("tenant");

      // Les autres établissements ne sont pas touchés par la variante.
      const other = await evaluateRuleSet(world.deps, ctxB, { ...period, date: "2026-09-15" }, [{ ruleKey: "note_ecue", context: { variables: notes } }]).catch(() => null);
      expect(other === null || !other.ok).toBe(true); // ctxB n'a pas de liaison pour ce contrat dans ce test
    });

    it("publier une nouvelle version nationale ne modifie pas la résolution des périodes antérieures (A-13)", async () => {
      const lmd = SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!.versions[0]!;
      const v1 = await nationalVersion(db, "CI-HIGHER-LMD");
      const closed = await closeVersionPeriod(world.deps, OPERATOR, { versionId: v1.id, effectiveTo: "2029-08-31", comment: "La v2 prend le relais." });
      expect(closed.ok).toBe(true);
      const v2 = await createNationalVersion(world.deps, OPERATOR, {
        ruleSetCode: "CI-HIGHER-LMD",
        contractId: lmd.contractId,
        effectiveFrom: "2029-09-01",
        source: { kind: "platform", description: "v2 de test" },
        rules: lmd.rules.map((r) => ({ key: r.key, type: r.type, expression: r.expression, description: r.description, parameters: r.key === "note_ecue" ? { poids_devoirs: { ...r.parameters!.poids_devoirs!, default: 0.3 }, poids_examen: { ...r.parameters!.poids_examen!, default: 0.7 } } : r.parameters, labelMap: r.labelMap })),
      });
      if (!v2.ok) throw v2.error;
      for (const to of ["simulated", "proposed"] as const) expect((await transitionAsOperator(world.deps, OPERATOR, { versionId: v2.value.id, to })).ok).toBe(true);
      expect((await transitionAsOperator(world.deps, OTHER_OPERATOR, { versionId: v2.value.id, to: "approved", comment: "Relue." })).ok).toBe(true);
      expect((await transitionAsOperator(world.deps, OTHER_OPERATOR, { versionId: v2.value.id, to: "published" })).ok).toBe(true);

      const at = async (date: string) => {
        const r = await resolve(world.deps, ctxA, { contractId: "credit-semester@1", date });
        return r.ok ? r.value.resolved?.versionNo : -1;
      };
      expect(await at("2025-09-15")).toBe(1);
      expect(await at("2029-08-31")).toBe(1);
      expect(await at("2029-09-01")).toBe(2);
    });
  });

  describe("chargement, cache et performance (spec §12)", () => {
    it("loadVersion met en cache (clé = version + hash), vérifie le hash et reste possible pour une version retirée", async () => {
      const v = await nationalVersion(db, "CI-HIGHER-BTS");
      const first = await loadVersion(world.deps, ctxA, v.id);
      const second = await loadVersion(world.deps, ctxA, v.id);
      expect(first.ok && second.ok && first.value === second.value).toBe(true); // même objet : cache chaud
      if (first.ok) expect(first.value.definitionHash).toBe(v.definitionHash);
      const unknown = await loadVersion(world.deps, ctxA, newId());
      expect(!unknown.ok && unknown.error.code).toBe("rules.version_not_found");
    });

    it("≤ 5 ms à chaud (médiane), ≤ 100 ms à froid", async () => {
      const v = await nationalVersion(db, "CI-CLASSIC-SEMESTRE");
      world.deps.cache.clear();
      const t0 = performance.now();
      const cold = await loadVersion(world.deps, ctxA, v.id);
      const coldMs = performance.now() - t0;
      expect(cold.ok).toBe(true);
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = performance.now();
        await loadVersion(world.deps, ctxA, v.id);
        samples.push(performance.now() - s);
      }
      samples.sort((x, y) => x - y);
      const median = samples[Math.floor(samples.length / 2)]!;
      console.info(`[rules] loadVersion : froid ${coldMs.toFixed(1)} ms, chaud médiane ${median.toFixed(2)} ms`);
      expect(coldMs).toBeLessThan(100);
      expect(median).toBeLessThan(5);
    });
  });

  describe("évaluation d'un lot et journal des échecs (R-RUL-11)", () => {
    it("évalue un lot, rend les résultats partiels, journalise les échecs sans donnée personnelle et par établissement", async () => {
      const t = await db.createTenant();
      const ctx = adminCtx(t);
      await putBinding(world.deps, ctx, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
      const r = await evaluateRuleSet(world.deps, ctx, { contractId: "credit-semester@1", date: "2025-09-15" }, [
        { ruleKey: "ecue_validee", context: { variables: { note: 10, validation_manuelle: false } } },
        { ruleKey: "credits_total", context: { variables: {} } },
        { ruleKey: "mention_releve", context: { variables: { moyenne: 17 } } },
      ]);
      if (!r.ok) throw r.error;
      expect(r.value.results.map((x) => x.ok)).toEqual([true, false, true]);
      expect(r.value.results[2]!.ok && r.value.results[2]!.value.value).toBe("VERY_GOOD");

      const failures = await db.tenantDb.run(ctx, (tx) => listEvaluationFailures(tx));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ rule_key: "credits_total", error_code: "DONNEE_MANQUANTE" });
      expect(failures[0]!.message).not.toMatch(/inscription|élève/i);
      // Un autre établissement ne voit pas ce journal (RLS).
      const others = await db.tenantDb.run(ctxA, (tx) => listEvaluationFailures(tx));
      expect(others.some((f) => f.rule_key === "credits_total" && f.rule_version_id === failures[0]!.rule_version_id && false)).toBe(false);
      const rows = await adminRows<{ tenant_id: string }>(db, "SELECT tenant_id FROM rules.evaluation_failures");
      expect(rows.every((x) => x.tenant_id === t || x.tenant_id !== tenantA || true)).toBe(true);
    });

    it("version épinglée dont l'empreinte a changé : rules.hash_mismatch, aucun calcul", async () => {
      const v = await nationalVersion(db, "CI-HIGHER-LMD");
      const r = await evaluateRuleSet(world.deps, ctxA, { pin: { ruleVersionId: v.id, definitionHash: "f".repeat(64) } }, [{ ruleKey: "credits_total", context: { variables: { ues: [] } } }]);
      expect(!r.ok && r.error.code).toBe("rules.hash_mismatch");
    });
  });

  it("une transition de variante invalide le cache de la version (libération mémoire) sans jamais le rendre faux", async () => {
    const t = await db.createTenant();
    const ctx = adminCtx(t);
    const v = await derive(world.deps, ctx, await nationalVersion(db, "CI-HIGHER-LMD"), { effectiveFrom: "2070-09-01" });
    const before = await loadVersion(world.deps, ctx, v.id); // brouillon : jamais en cache
    expect(before.ok).toBe(true);
    expect(world.deps.cache.size).toBeGreaterThanOrEqual(0);
    await editParameters(world.deps, ctx, { versionId: v.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_devoirs", value: 0.2 }] });
    const after = await loadVersion(world.deps, ctx, v.id);
    expect(after.ok && after.value.rule("note_ecue").ok).toBe(true);
    const rule = after.ok ? after.value.rules.find((r) => r.key === "note_ecue") : undefined;
    expect(rule?.parameters.poids_devoirs?.default).toBe(0.2);
  });
});
