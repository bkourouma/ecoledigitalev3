/**
 * Gouvernance sur base réelle : dériver → paramétrer → simuler → proposer → approuver → publier → retirer, avec les droits
 * (administrateur d'établissement vs super-administrateur), les portes métier (simulation obligatoire, confirmation d'impact,
 * hash, chevauchement, séparation des tâches), l'historique, l'audit et les événements outbox.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId } from "@ecoledigitale/kernel";
import { deriveVariant, editExpression, editParameters, validateVersion } from "../application/variants";
import { getVersionDetail, listApprovalQueue, listTenantCatalog } from "../application/catalog";
import { closeVersionPeriod, transitionAsOperator, transitionTenantVersion } from "../application/transitions";
import { createNationalRuleSet, createNationalVersion, replaceNationalDraftRules, updatePlatformSettings } from "../application/national";
import { requestSimulation, recordSimulationCases } from "../application/simulations";
import { creditSemesterContract } from "../contracts";
import { computeDefinitionHash } from "../domain/definition";
import { getRules, listVersionEvents } from "../infrastructure/catalog-repository";
import { SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { OPERATOR, OTHER_OPERATOR, approveAsOperator, derive, ecueGroup, nationalVersion, proposeVariant, simulateVersion, simulatedVariant } from "./support/flow";

describeIntegration("gouvernance des versions", () => {
  let db: RulesTestDb;
  let world: TestWorld;
  let tenantA: string;
  let tenantB: string;
  let ctxA: ReturnType<typeof adminCtx>;
  let ctxB: ReturnType<typeof adminCtx>;

  beforeAll(async () => {
    db = await createRulesTestDb({ withAudit: false });
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

  it("dériver une variante crée un brouillon COPIE de la version nationale (pas un héritage), historisé et audité", async () => {
    const base = await nationalVersion(db, "CI-HIGHER-LMD");
    world.audit.clear();
    const v = await derive(world.deps, ctxA, base);
    expect(v).toMatchObject({ kind: "TENANT", status: "draft", versionNo: 1, contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", basedOnVersionId: base.id, createdBy: ctxA.userId, effectiveFrom: "2025-09-01" });
    expect(v.rules).toHaveLength(seedVersionRecords(SEED_RULE_SETS[0]!.versions[0]!).length);
    expect(v.definitionHash).toBeNull(); // le hash n'existe qu'à partir de la proposition

    // Copie : modifier la variante ne touche pas le national.
    const edited = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_devoirs", value: 0.5 }, { ruleKey: "note_ecue", parameter: "poids_examen", value: 0.5 }] });
    expect(edited.ok).toBe(true);
    const national = await adminRows<{ parameters: Record<string, { default: number }> }>(db, "SELECT parameters FROM rules.national_rule_definitions WHERE rule_version_id = $1 AND key = 'note_ecue'", [base.id]);
    expect(national[0]!.parameters.poids_devoirs!.default).toBe(0.4);

    const events = await db.tenantDb.run(ctxA, (tx) => listVersionEvents(tx, "TENANT", v.id));
    expect(events.map((e) => `${e.fromStatus ?? "-"}>${e.toStatus}`)).toEqual(["->draft"]);
    expect(events[0]).toMatchObject({ actorKind: "tenant_admin", actorId: ctxA.userId });
    expect(world.audit.actions()).toEqual(expect.arrayContaining(["rules.version.created", "rules.version.parameters_edited"]));
  });

  it("une variante n'est visible que de son établissement (RLS) ; le national n'expose que publié/retiré", async () => {
    const base = await nationalVersion(db, "CI-HIGHER-BTS");
    const v = await derive(world.deps, ctxA, base);
    expect((await getVersionDetail(world.deps, ctxA, v.id)).ok).toBe(true);
    const other = await getVersionDetail(world.deps, ctxB, v.id);
    expect(other.ok).toBe(false);
    expect(!other.ok && other.error.code).toBe("rules.version_not_found");
    const catalogB = await listTenantCatalog(world.deps, ctxB);
    expect(catalogB.ok && catalogB.value.every((s) => s.set.kind === "NATIONAL" || s.set.tenantId === tenantB)).toBe(true);
    expect(catalogB.ok && catalogB.value.flatMap((s) => s.versions).every((x) => x.kind === "TENANT" || ["published", "retired"].includes(x.status))).toBe(true);
  });

  it("refuse de dériver depuis une version nationale non publiée, ou d'un autre jeu", async () => {
    const created = await createNationalRuleSet(world.deps, OPERATOR, { code: "CI-TEST-DRAFT", name: "Jeu de test", countryCode: "CI", educationSystem: "HIGHER" });
    expect(created.ok).toBe(true);
    const lmd = SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!.versions[0]!;
    const draft = await createNationalVersion(world.deps, OPERATOR, {
      ruleSetCode: "CI-TEST-DRAFT",
      contractId: lmd.contractId,
      effectiveFrom: "2030-09-01",
      source: { kind: "platform", description: "brouillon de test" },
      rules: lmd.rules.map((r) => ({ key: r.key, type: r.type, expression: r.expression, description: r.description, parameters: r.parameters, labelMap: r.labelMap })),
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const tryDerive = await deriveVariant(world.deps, ctxA, { ruleSetCode: "CI-TEST-DRAFT", baseVersionId: draft.value.id, effectiveFrom: "2030-09-01" });
    expect(tryDerive.ok).toBe(false); // invisible d'un établissement (brouillon national)
    const base = await nationalVersion(db, "CI-HIGHER-LMD");
    const wrongSet = await deriveVariant(world.deps, ctxA, { ruleSetCode: "CI-HIGHER-BTS", baseVersionId: base.id, effectiveFrom: "2025-09-01" });
    expect(!wrongSet.ok && wrongSet.error.code).toBe("rules.invalid_input");
    const badDates = await deriveVariant(world.deps, ctxA, { ruleSetCode: "CI-HIGHER-LMD", baseVersionId: base.id, effectiveFrom: "2025-09-31" });
    expect(!badDates.ok && badDates.error.code).toBe("rules.invalid_input");
  });

  describe("édition (AC1.2, AC1.3, verrou optimiste)", () => {
    it("paramètre hors bornes : message du moteur ; type erroné ; mode hors énumération ; règle ou paramètre inconnus", async () => {
      const v = await derive(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
      const outOfRange = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_devoirs", value: 1.5 }] });
      expect(!outOfRange.ok && outOfRange.error.message).toMatch(/hors de l'intervalle autorisé/);
      expect(!outOfRange.ok && outOfRange.error.code).toBe("rules.parameter_out_of_range");
      const wrongType = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_devoirs", value: "beaucoup" }] });
      expect(!wrongType.ok && wrongType.error.code).toBe("rules.invalid_input");
      const badMode = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "note_examen_retenue", parameter: "mode_session2", value: "MOYENNE" }] });
      expect(!badMode.ok && badMode.error.code).toBe("rules.invalid_input");
      const unknownRule = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "fantome", parameter: "x", value: 1 }] });
      expect(!unknownRule.ok && unknownRule.error.code).toBe("rules.rule_not_found");
      const unknownParam = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "note_ecue", parameter: "fantome", value: 1 }] });
      expect(!unknownParam.ok && unknownParam.error.code).toBe("rules.rule_not_found");
      // Atomique : aucune des modifications d'une requête refusée n'est appliquée.
      const both = await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_examen", value: 0.7 }, { ruleKey: "note_ecue", parameter: "poids_devoirs", value: 2 }] });
      expect(both.ok).toBe(false);
      const rules = await db.tenantDb.run(ctxA, (tx) => getRules(tx, "TENANT", v.id));
      expect(rules.find((r) => r.key === "note_ecue")!.parameters.poids_examen!.default).toBe(0.6);
    });

    it("verrou optimiste : une édition sur une version modifiée entre-temps reçoit 409 rules.stale_version", async () => {
      const v = await derive(world.deps, ctxA, await nationalVersion(db, "CI-CLASSIC-SEMESTRE"));
      const first = await editParameters(world.deps, ctxA, { versionId: v.id, expectedRowVersion: v.rowVersion, changes: [{ ruleKey: "mention", parameter: "passable", value: 9 }] });
      expect(first.ok).toBe(true);
      const stale = await editParameters(world.deps, ctxA, { versionId: v.id, expectedRowVersion: v.rowVersion, changes: [{ ruleKey: "mention", parameter: "passable", value: 7 }] });
      expect(!stale.ok && stale.error.code).toBe("rules.stale_version");
      expect(!stale.ok && stale.error.httpStatus).toBe(409);
      // Deux éditions concurrentes sur la même ligne se sérialisent (FOR UPDATE) : la seconde voit la version incrémentée.
      const results = await Promise.all([
        editParameters(world.deps, ctxA, { versionId: v.id, expectedRowVersion: (first.ok ? first.value.rowVersion : 0), changes: [{ ruleKey: "mention", parameter: "bien", value: 11 }] }),
        editParameters(world.deps, ctxA, { versionId: v.id, expectedRowVersion: (first.ok ? first.value.rowVersion : 0), changes: [{ ruleKey: "mention", parameter: "bien", value: 12 }] }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.error.code === "rules.stale_version")).toHaveLength(1);
    });

    it("expression invalide : diagnostics français avec position ; expression valide acceptée ; type de résultat du contrat respecté", async () => {
      const v = await derive(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
      const bad = await editExpression(world.deps, ctxA, { versionId: v.id, ruleKey: "ecue_eliminee", expression: "note < params.seuil_inconnu" });
      expect(bad.ok).toBe(false);
      expect(!bad.ok && (bad.error.details as { diagnostics: Array<{ message: string }> }).diagnostics[0]!.message.length).toBeGreaterThan(5);
      const wrongType = await editExpression(world.deps, ctxA, { versionId: v.id, ruleKey: "credits_ue", expression: '"beaucoup"' });
      expect(wrongType.ok).toBe(false);
      const good = await editExpression(world.deps, ctxA, { versionId: v.id, ruleKey: "ecue_eliminee", expression: "!is_null(note) && note <= params.seuil_eliminatoire" });
      expect(good.ok).toBe(true);
      const rules = await db.tenantDb.run(ctxA, (tx) => getRules(tx, "TENANT", v.id));
      expect(rules.find((r) => r.key === "ecue_eliminee")!.expression).toContain("<=");
      const report = await validateVersion(world.deps, ctxA, v.id);
      expect(report.ok && report.value.ok).toBe(true);
    });
  });

  describe("simulation obligatoire et invalidation (AC2.1)", () => {
    it("draft -> simulated est impossible sans simulation TERMINÉE sur le contenu courant", async () => {
      const v = await derive(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
      await editParameters(world.deps, ctxA, { versionId: v.id, changes: [{ ruleKey: "ecue_validee", parameter: "seuil_validation", value: 11 }] });
      const none = await transitionTenantVersion(world.deps, ctxA, { versionId: v.id, to: "simulated" });
      expect(!none.ok && none.error.code).toBe("rules.simulation_required");

      // Simulation demandée mais pas terminée (PENDING) : toujours refusé.
      const requested = await requestSimulation(world.deps, ctxA, { versionId: v.id, dataset: { periodIds: [newId()] } });
      expect(requested.ok).toBe(true);
      const pending = await transitionTenantVersion(world.deps, ctxA, { versionId: v.id, to: "simulated" });
      expect(!pending.ok && pending.error.code).toBe("rules.simulation_required");
      if (!requested.ok) return;
      const done = await recordSimulationCases(world.deps, ctxA, requested.value.id, [ecueGroup()]);
      expect(done.ok && done.value.status).toBe("COMPLETED");

      const ok = await transitionTenantVersion(world.deps, ctxA, { versionId: v.id, to: "simulated" });
      expect(ok.ok && ok.value.version.status).toBe("simulated");
      expect(ok.ok && ok.value.version.lastSimulationId).toBe(requested.value.id);
    });

    it("toute modification après simulation repasse la version en brouillon et invalide le rapport", async () => {
      const { variant } = await simulatedVariant(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
      expect(variant.status).toBe("simulated");
      const edit = await editParameters(world.deps, ctxA, { versionId: variant.id, changes: [{ ruleKey: "ecue_eliminee", parameter: "seuil_eliminatoire", value: 4 }] });
      expect(edit.ok && edit.value.status).toBe("draft");
      expect(edit.ok && edit.value.lastSimulationId).toBeNull();
      const events = await db.tenantDb.run(ctxA, (tx) => listVersionEvents(tx, "TENANT", variant.id));
      expect(events.map((e) => `${e.fromStatus ?? "-"}>${e.toStatus}`).slice(-2)).toEqual(["draft>simulated", "simulated>draft"]);
      // Sans nouvelle simulation, on ne peut plus avancer ; l'ancienne simulation ne correspond plus au hash.
      const again = await transitionTenantVersion(world.deps, ctxA, { versionId: variant.id, to: "simulated" });
      expect(!again.ok && again.error.code).toBe("rules.simulation_required");
    });

    it("une simulation compare TOUJOURS à une version précédente active (jamais à vide) et refuse un contrat différent", async () => {
      const base = await nationalVersion(db, "CI-HIGHER-LMD");
      const v = await derive(world.deps, ctxA, base);
      const same = await requestSimulation(world.deps, ctxA, { versionId: v.id, baseVersionId: v.id, dataset: { periodIds: [newId()] } });
      expect(!same.ok && same.error.code).toBe("rules.invalid_input");
      const otherContract = await nationalVersion(db, "CI-CLASSIC-SEMESTRE");
      const crossed = await requestSimulation(world.deps, ctxA, { versionId: v.id, baseVersionId: otherContract.id, dataset: { periodIds: [newId()] } });
      expect(!crossed.ok && crossed.error.code).toBe("rules.invalid_input");
      // La version de référence par défaut est la version nationale copiée.
      const sim = await simulateVersion(world.deps, ctxA, v.id);
      expect(sim.baseVersionId).toBe(base.id);
      expect(sim.targetDefinitionHash).toBe(computeDefinitionHash(v.contractId, v.rules));
    });
  });

  describe("proposition et confirmation d'impact (AC2.5)", () => {
    it("exige une confirmation explicite au-delà du seuil de décisions modifiées, tracée", async () => {
      const { variant, simulation } = await simulatedVariant(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"), 11);
      expect(Number(simulation.decisionChangedPercent)).toBeGreaterThan(5);
      const refused = await transitionTenantVersion(world.deps, ctxA, { versionId: variant.id, to: "proposed" });
      expect(!refused.ok && refused.error.code).toBe("rules.decision_impact_confirmation_required");
      expect(!refused.ok && (refused.error.details as { thresholdPercent: number }).thresholdPercent).toBe(5);
      world.audit.clear();
      const proposed = await proposeVariant(world.deps, ctxA, variant.id);
      expect(proposed).toMatchObject({ status: "proposed", decisionImpactConfirmedBy: ctxA.userId });
      expect(proposed.definitionHash).toMatch(/^[0-9a-f]{64}$/);
      const audit = world.audit.entries.find((e) => e.action === "rules.version.proposed")!;
      expect(audit.metadata).toMatchObject({ decisionImpactConfirmed: true, decisionChangedPercent: simulation.decisionChangedPercent });
    });

    it("sans impact notable, aucune confirmation n'est demandée ; le seuil est réglable par le super-administrateur", async () => {
      const base = await nationalVersion(db, "CI-HIGHER-LMD");
      // Variante identique : 0 % de décisions modifiées.
      const v = await derive(world.deps, ctxA, base);
      await simulateVersion(world.deps, ctxA, v.id);
      await transitionTenantVersion(world.deps, ctxA, { versionId: v.id, to: "simulated" });
      const proposed = await transitionTenantVersion(world.deps, ctxA, { versionId: v.id, to: "proposed" });
      expect(proposed.ok && proposed.value.version.decisionImpactConfirmedBy).toBeNull();

      // Seuil relevé à 100 % : plus de confirmation même pour la variante à fort impact.
      const settings = await updatePlatformSettings(world.deps, OPERATOR, { decisionImpactConfirmPercent: 100 });
      expect(settings.ok && settings.value.decisionImpactConfirmPercent).toBe(100);
      const { variant } = await simulatedVariant(world.deps, ctxA, base, 11, { effectiveFrom: "2026-09-01" });
      const noConfirm = await transitionTenantVersion(world.deps, ctxA, { versionId: variant.id, to: "proposed" });
      expect(noConfirm.ok).toBe(true);
      await updatePlatformSettings(world.deps, OPERATOR, { decisionImpactConfirmPercent: 5 });
    });
  });

  describe("droits : administrateur d'établissement vs super-administrateur (AC3.1, AC3.2)", () => {
    it("un administrateur d'établissement ne peut ni approuver, ni publier, ni retirer (403), même sur sa variante", async () => {
      const { variant } = await simulatedVariant(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
      const proposed = await proposeVariant(world.deps, ctxA, variant.id);
      const selfApprove = await transitionTenantVersion(world.deps, ctxA, { versionId: proposed.id, to: "approved", comment: "Je m'auto-approuve." });
      expect(selfApprove.ok).toBe(false);
      expect(!selfApprove.ok && selfApprove.error.httpStatus).toBe(403);
      expect(!selfApprove.ok && selfApprove.error.code).toBe("rules.transition_forbidden");
      // Une transition qui n'existe pas depuis ce statut : 409 (et non 403).
      const illegal = await transitionTenantVersion(world.deps, ctxA, { versionId: proposed.id, to: "simulated" });
      expect(!illegal.ok && illegal.error.httpStatus).toBe(409);
      const skipped = await transitionTenantVersion(world.deps, ctxA, { versionId: proposed.id, to: "published", comment: "Saut d'étapes." });
      expect(!skipped.ok && skipped.error.httpStatus).toBe(409);
      // L'administrateur peut retirer SA proposition (proposed -> draft), sans commentaire obligatoire.
      const withdrawn = await transitionTenantVersion(world.deps, ctxA, { versionId: proposed.id, to: "draft" });
      expect(withdrawn.ok && withdrawn.value.version).toMatchObject({ status: "draft", definitionHash: null, lastSimulationId: null });

      // Une fois approuvée par le super-administrateur : publier et retirer lui restent interdits.
      const tenantC = await db.createTenant();
      const ctxC = adminCtx(tenantC);
      const second = await simulatedVariant(world.deps, ctxC, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2034-09-01" });
      const approved = await approveAsOperator(world.deps, tenantC, (await proposeVariant(world.deps, ctxC, second.variant.id)).id);
      for (const to of ["published", "retired"] as const) {
        const r = await transitionTenantVersion(world.deps, ctxC, { versionId: approved.id, to, comment: "Tentative." });
        expect(!r.ok && r.error.httpStatus, to).toBe(403);
      }
    });

    it("l'administrateur d'un AUTRE établissement ne peut rien sur cette variante (404, RLS)", async () => {
      const { variant } = await simulatedVariant(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
      const r = await transitionTenantVersion(world.deps, ctxB, { versionId: variant.id, to: "proposed" });
      expect(!r.ok && r.error.code).toBe("rules.version_not_found");
      const e = await editParameters(world.deps, ctxB, { versionId: variant.id, changes: [{ ruleKey: "note_ecue", parameter: "poids_devoirs", value: 0.3 }] });
      expect(!e.ok && e.error.code).toBe("rules.version_not_found");
    });

    it("approbation par le super-administrateur : commentaire obligatoire, hash vérifié, signée, historisée, auditée, événement outbox", async () => {
      const { variant } = await simulatedVariant(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2027-09-01" });
      const proposed = await proposeVariant(world.deps, ctxA, variant.id);

      const queue = await listApprovalQueue(world.deps);
      expect(queue.some((q) => q.tenantId === tenantA && q.version.id === proposed.id && q.decisionImpactConfirmed)).toBe(true);
      expect(queue.some((q) => q.tenantId === tenantB && q.version.id === proposed.id)).toBe(false);

      const noComment = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "approved", tenantId: tenantA });
      expect(!noComment.ok && noComment.error.code).toBe("rules.comment_required");

      world.audit.clear();
      const approved = await approveAsOperator(world.deps, tenantA, proposed.id);
      expect(approved).toMatchObject({ status: "approved", approvedBy: OPERATOR.id, definitionHash: proposed.definitionHash });

      const events = await db.tenantDb.run(ctxA, (tx) => listVersionEvents(tx, "TENANT", proposed.id));
      const last = events[events.length - 1]!;
      expect(last).toMatchObject({ fromStatus: "proposed", toStatus: "approved", actorKind: "super_admin", actorId: OPERATOR.id, comment: expect.stringContaining("conforme") });

      const audit = world.audit.entries.find((e) => e.action === "rules.version.approved")!;
      expect(audit).toMatchObject({ entity: "rule_version", entityId: proposed.id, severity: "notice", reason: expect.stringContaining("conforme") });
      expect(audit.before).toMatchObject({ status: "proposed" });
      expect(audit.after).toMatchObject({ status: "approved", definitionHash: proposed.definitionHash });

      const outbox = await adminRows<{ type: string; payload: { ruleVersionId: string; v: number; origin: string } }>(
        db,
        "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY id",
        [tenantA, proposed.id],
      );
      expect(outbox.map((o) => o.type)).toEqual(["rules.version.proposed", "rules.version.approved"]);
      expect(outbox[1]!.payload).toMatchObject({ v: 1, ruleVersionId: proposed.id, origin: "tenant" });
    });

    it("rejet par le super-administrateur : commentaire obligatoire, la variante repart en brouillon sans hash ni simulation", async () => {
      const { variant } = await simulatedVariant(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2028-09-01" });
      const proposed = await proposeVariant(world.deps, ctxA, variant.id);
      const noComment = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "draft", tenantId: tenantA });
      expect(!noComment.ok && noComment.error.code).toBe("rules.comment_required");
      const rejected = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "draft", tenantId: tenantA, comment: "Seuil incompatible avec le règlement intérieur." });
      expect(rejected.ok && rejected.value.version).toMatchObject({ status: "draft", definitionHash: null, lastSimulationId: null });
      const outbox = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY id", [tenantA, proposed.id]);
      expect(outbox.map((o) => o.type)).toContain("rules.version.rejected");
    });
  });

  describe("chevauchement des périodes d'effet (AC3.3) et cycle de vie complet", () => {
    it("refuse d'approuver une variante dont la période chevauche une autre version active du même jeu", async () => {
      const base = await nationalVersion(db, "CI-CLASSIC-SEMESTRE");
      const tenant = await db.createTenant();
      const ctx = adminCtx(tenant);
      // Contrat classique : on varie un seuil de mention (le seuil « validation » n'existe que dans le contrat à crédits).
      const mk = async (from: string, to: string | null) => {
        const v = await derive(world.deps, ctx, base, { effectiveFrom: from, effectiveTo: to });
        await editParameters(world.deps, ctx, { versionId: v.id, changes: [{ ruleKey: "mention", parameter: "passable", value: 9 }] });
        await simulateVersion(world.deps, ctx, v.id, [{ ruleKeys: ["mention"], cases: Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, context: { variables: { moyenne: i } } })) }]);
        await transitionTenantVersion(world.deps, ctx, { versionId: v.id, to: "simulated" });
        return proposeVariant(world.deps, ctx, v.id, false);
      };
      const a = await mk("2030-01-01", "2030-12-31");
      const b = await mk("2030-06-01", null);
      const okA = await approveAsOperator(world.deps, tenant, a.id);
      expect(okA.status).toBe("approved");
      const overlap = await transitionAsOperator(world.deps, OPERATOR, { versionId: b.id, to: "approved", tenantId: tenant, comment: "Tentative de chevauchement." });
      expect(overlap.ok).toBe(false);
      expect(!overlap.ok && overlap.error.code).toBe("rules.overlap");
      expect(!overlap.ok && (overlap.error.details as { conflictingVersions: Array<{ id: string }> }).conflictingVersions[0]!.id).toBe(a.id);

      // Clôturer la période de la première puis approuver la seconde : possible (période non chevauchante).
      const closed = await closeVersionPeriod(world.deps, OPERATOR, { versionId: a.id, effectiveTo: "2030-05-31", tenantId: tenant, comment: "Remplacement par la version suivante." });
      expect(closed.ok && closed.value.effectiveTo).toBe("2030-05-31");
      const okB = await transitionAsOperator(world.deps, OPERATOR, { versionId: b.id, to: "approved", tenantId: tenant, comment: "Période désormais disjointe." });
      expect(okB.ok).toBe(true);

      // La période ne peut qu'être raccourcie.
      const extend = await closeVersionPeriod(world.deps, OPERATOR, { versionId: a.id, effectiveTo: "2030-08-31", tenantId: tenant });
      expect(!extend.ok && extend.error.code).toBe("rules.invalid_input");
    });

    it("approved -> published -> retired, chaque acte commenté, audité (sévérité notice) et publié dans l'outbox", async () => {
      const tenant = await db.createTenant();
      const ctx = adminCtx(tenant);
      const { variant } = await simulatedVariant(world.deps, ctx, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2031-09-01" });
      const proposed = await proposeVariant(world.deps, ctx, variant.id);
      await approveAsOperator(world.deps, tenant, proposed.id);
      world.audit.clear();
      const published = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "published", tenantId: tenant });
      expect(published.ok && published.value.version.status).toBe("published");
      const noComment = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "retired", tenantId: tenant });
      expect(!noComment.ok && noComment.error.code).toBe("rules.comment_required");
      const retired = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "retired", tenantId: tenant, comment: "Remplacée par la version 2." });
      expect(retired.ok && retired.value.version.status).toBe("retired");
      const finished = await transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "draft", tenantId: tenant, comment: "Impossible." });
      expect(!finished.ok && finished.error.httpStatus).toBe(409);

      expect(world.audit.actions()).toEqual(["rules.version.published", "rules.version.retired"]);
      expect(world.audit.entries.every((e) => e.severity === "notice")).toBe(true);
      const types = (await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY id", [tenant, proposed.id])).map((r) => r.type);
      expect(types).toEqual(["rules.version.proposed", "rules.version.approved", "rules.version.published", "rules.version.retired"]);
    });

    it("ATOMICITÉ : si l'audit échoue, la transition est annulée (ni statut, ni historique, ni événement)", async () => {
      const tenant = await db.createTenant();
      const ctx = adminCtx(tenant);
      const { variant } = await simulatedVariant(world.deps, ctx, await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2032-09-01" });
      const proposed = await proposeVariant(world.deps, ctx, variant.id);
      const before = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM rules.version_events WHERE rule_version_id = $1", [proposed.id]);
      const outboxBefore = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE tenant_id = $1", [tenant]);
      world.audit.failWith = new Error("audit indisponible");
      await expect(transitionAsOperator(world.deps, OPERATOR, { versionId: proposed.id, to: "approved", tenantId: tenant, comment: "Approbation à annuler." })).rejects.toThrow("audit indisponible");
      world.audit.failWith = null;
      const after = await adminRows<{ status: string; approved_by: string | null }>(db, "SELECT status, approved_by FROM rules.rule_versions WHERE id = $1", [proposed.id]);
      expect(after[0]).toEqual({ status: "proposed", approved_by: null });
      expect((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM rules.version_events WHERE rule_version_id = $1", [proposed.id]))[0]!.n).toBe(before[0]!.n);
      expect((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE tenant_id = $1", [tenant]))[0]!.n).toBe(outboxBefore[0]!.n);
    });
  });

  describe("catalogue national (console du super-administrateur)", () => {
    const lmd = SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!.versions[0]!;
    const asInputs = () => lmd.rules.map((r) => ({ key: r.key, type: r.type, expression: r.expression, description: r.description, parameters: r.parameters, labelMap: r.labelMap }));

    it("cycle complet d'une version nationale : brouillon -> validée -> proposée -> approuvée (autre opérateur) -> publiée, puis diffusion aux établissements", async () => {
      expect((await createNationalRuleSet(world.deps, OPERATOR, { code: "CI-NAT-FLOW", name: "Jeu national de test", countryCode: "CI", educationSystem: "HIGHER" })).ok).toBe(true);
      const dup = await createNationalRuleSet(world.deps, OPERATOR, { code: "CI-NAT-FLOW", name: "Doublon", countryCode: "CI" });
      expect(!dup.ok && dup.error.code).toBe("rules.duplicate");

      const created = await createNationalVersion(world.deps, OPERATOR, { ruleSetCode: "CI-NAT-FLOW", contractId: lmd.contractId, effectiveFrom: "2040-09-01", source: { kind: "regulation", reference: "Texte de test (fictif)" }, rules: asInputs() });
      if (!created.ok) throw created.error;
      const id = created.value.id;
      expect(created.value).toMatchObject({ kind: "NATIONAL", status: "draft", createdBy: OPERATOR.id });

      // Une règle cassée bloque draft -> simulated (compilation + contrat, AC1.4).
      const broken = await replaceNationalDraftRules(world.deps, OPERATOR, id, [...asInputs().filter((r) => r.key !== "rang"), { key: "rang", type: "ranking", expression: "rank(moyenne, cohorte, 4) + ", parameters: undefined, labelMap: undefined, description: undefined }]);
      expect(broken.ok).toBe(true);
      const blocked = await transitionAsOperator(world.deps, OPERATOR, { versionId: id, to: "simulated" });
      expect(!blocked.ok && blocked.error.code).toBe("rules.contract_violation");
      const missing = await replaceNationalDraftRules(world.deps, OPERATOR, id, asInputs().filter((r) => r.key !== "rang"));
      expect(missing.ok).toBe(true);
      const blocked2 = await transitionAsOperator(world.deps, OPERATOR, { versionId: id, to: "simulated" });
      expect(!blocked2.ok && blocked2.error.message).toContain("rang");
      expect((await replaceNationalDraftRules(world.deps, OPERATOR, id, asInputs())).ok).toBe(true);

      for (const to of ["simulated", "proposed"] as const) {
        const step = await transitionAsOperator(world.deps, OPERATOR, { versionId: id, to });
        expect(step.ok, to).toBe(true);
      }
      // Séparation des tâches : l'auteur ne peut pas approuver (AC3.4) ; un autre opérateur le peut.
      const self = await transitionAsOperator(world.deps, OPERATOR, { versionId: id, to: "approved", comment: "Auto-approbation." });
      expect(!self.ok && self.error.code).toBe("rules.four_eyes");
      const approved = await transitionAsOperator(world.deps, OTHER_OPERATOR, { versionId: id, to: "approved", comment: "Relu par un second opérateur." });
      expect(approved.ok && approved.value.version.approvedBy).toBe(OTHER_OPERATOR.id);

      world.audit.clear();
      const published = await transitionAsOperator(world.deps, OTHER_OPERATOR, { versionId: id, to: "published" });
      expect(published.ok && published.value.version.status).toBe("published");
      expect(world.audit.platformActions()).toEqual(["rules.version.published"]);
      expect(world.audit.platformEntries[0]!.actor).toEqual({ type: "superAdmin", id: OTHER_OPERATOR.id });

      // Diffusion APRÈS commit : un événement par établissement actif (cache, alerte « périodes en retard de version »).
      for (const tenant of [tenantA, tenantB]) {
        const rows = await adminRows<{ type: string; payload: { ruleSetCode: string; origin: string } }>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY id", [tenant, id]);
        expect(rows.map((r) => r.type)).toEqual(["rules.version.approved", "rules.version.published"]);
        expect(rows[1]!.payload).toMatchObject({ ruleSetCode: "CI-NAT-FLOW", origin: "national" });
      }
      // Version publiée désormais visible des établissements.
      const detail = await getVersionDetail(world.deps, ctxA, id);
      expect(detail.ok && detail.value.version.status).toBe("published");
    });

    it("un brouillon national n'est pas lisible par un établissement", async () => {
      const created = await createNationalVersion(world.deps, OPERATOR, { ruleSetCode: "CI-NAT-FLOW", contractId: lmd.contractId, effectiveFrom: "2050-09-01", source: { kind: "platform" }, rules: asInputs() });
      if (!created.ok) throw created.error;
      const r = await getVersionDetail(world.deps, ctxA, created.value.id);
      expect(!r.ok && r.error.code).toBe("rules.version_not_found");
    });

    it("une version nationale figée ne se modifie plus (immuabilité applicative)", async () => {
      const published = await nationalVersion(db, "CI-HIGHER-LMD");
      const r = await replaceNationalDraftRules(world.deps, OPERATOR, published.id, asInputs());
      expect(!r.ok && r.error.code).toBe("rules.version_immutable");
    });
  });

  it("le contexte d'un super-administrateur ne peut pas être forgé par un utilisateur : seul `superAdmin` approuve (déclencheur SQL)", async () => {
    const { variant } = await simulatedVariant(world.deps, adminCtx(tenantA), await nationalVersion(db, "CI-HIGHER-LMD"), 11, { effectiveFrom: "2033-09-01" });
    const proposed = await proposeVariant(world.deps, adminCtx(tenantA), variant.id);
    // Tentative directe en SQL sous l'identité d'un utilisateur ordinaire du tenant : le trigger refuse.
    const forged = createRequestContext({ tenantId: tenantA, userId: newId(), actor: "user", roles: ["owner"], mfa: true });
    await expect(
      db.tenantDb.run(forged, (tx) => tx.query("UPDATE rules.rule_versions SET status = 'approved', approved_by = $2 WHERE id = $1", [proposed.id, newId()])),
    ).rejects.toThrow(/rules\.transition_forbidden/);
  });
});
