/**
 * O-11 — parité avec le RuleSet RÉEL (`CI-HIGHER-LMD`, contrat `credit-semester@1`) : le résultat commun d'une UE annuelle est
 * décidé par les règles EXISTANTES (`moyenne_annuelle`, `credits_ue`, `ue_validee`, `etat_ue`, `session_validation_ue`) et leurs
 * paramètres (seuils du RuleSet de démonstration) ; ce module ne contient aucune formule ni aucun seuil.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createRulesApi, createRulesDeps, ensureNationalCatalog, putBinding, type RulesDeps } from "../../../rules";
import { declareAnnualUe } from "../../application/annual-ue";
import { createHigherDeps } from "../../application/deps";
import { capitalizePeriod } from "../../application/ledger";
import { RecordingAudit } from "../../application/ports";
import { createRulesAdapter } from "../../infrastructure/rules-adapter";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { adminRows, createHigherTestDb, ctxFor, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, seedSchool, ueLine } from "../support/world";

describeIntegration("O-11 : UE annuelle avec les règles RÉELLES (Postgres réel)", () => {
  let db: HigherTestDb;
  let rulesDeps: RulesDeps;
  let tenant: string;

  beforeAll(async () => {
    db = await createHigherTestDb(12, { withRules: true });
    rulesDeps = createRulesDeps({ db: db.tenantDb, systemDb: db.systemDb });
    await ensureNationalCatalog(rulesDeps);
    tenant = await db.createTenant();
    const bound = await putBinding(rulesDeps, ctxFor(tenant), { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
    if (!bound.ok) throw bound.error;
  });
  afterAll(async () => {
    await db.drop();
  });

  const adapter = () => createRulesAdapter(() => createRulesApi(rulesDeps));
  const scope = { onDate: "2026-10-01" };
  const part = (moyenne: string | null, credits = 6, extra: { session?: number | null; validationManuelle?: boolean } = {}) => ({
    moyenne,
    credits,
    validationManuelle: extra.validationManuelle ?? false,
    session: extra.session === undefined ? 1 : extra.session,
  });

  it("moyenne commune pondérée par les crédits des semestres (règle moyenne_annuelle), crédits = somme (credits_ue), validée au seuil du RuleSet", async () => {
    const r = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("10"), part("16")], session2Tentee: true, validationParJury: false, scope }));
    expect(Number(r.average)).toBe(13);
    expect(r).toMatchObject({ credits: 12, validated: true, state: "VALIDATED", sessionObtained: 1 });
    expect(r.rule).toMatchObject({ ruleSetCode: "CI-HIGHER-LMD", versionNo: 1 });
    expect(r.rule.definitionHash).toMatch(/^[0-9a-f]{64}$/);
    // pondération par crédits : (10 x 9 + 16 x 3) / 12 = 11.5
    const weighted = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("10", 9), part("16", 3)], session2Tentee: true, validationParJury: false, scope }));
    expect(Number(weighted.average)).toBe(11.5);
    expect(weighted.credits).toBe(12);
  });

  it("le seuil de validation est celui du RuleSet (valeur non arrondie) : 9.9999 ne valide pas, 10 valide", async () => {
    const below = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("9.9999"), part("9.9999")], session2Tentee: false, validationParJury: false, scope }));
    expect(below).toMatchObject({ validated: false, state: "RESIT", sessionObtained: null });
    const at = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("10"), part("10")], session2Tentee: false, validationParJury: false, scope }));
    expect(at).toMatchObject({ validated: true, state: "VALIDATED" });
  });

  it("état LMD : non validée avec rattrapage épuisé = DETTE ; session d'obtention = la plus élevée des parties", async () => {
    const debt = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("8", 6, { session: null }), part("9", 6, { session: null })], session2Tentee: true, validationParJury: false, scope }));
    expect(debt).toMatchObject({ validated: false, state: "DEBT", sessionObtained: null });
    const resit = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("12", 6, { session: 1 }), part("11", 6, { session: 2 })], session2Tentee: true, validationParJury: false, scope }));
    expect(resit).toMatchObject({ validated: true, state: "VALIDATED", sessionObtained: 2 });
  });

  it("la décision du jury prime : chaque partie validée par le jury valide l'UE annuelle sans réévaluer ue_validee", async () => {
    const r = unwrap(await adapter().evaluateAnnualUe(ctxFor(tenant), { parts: [part("6", 6, { validationManuelle: true }), part("7", 6, { validationManuelle: true })], session2Tentee: true, validationParJury: true, scope }));
    expect(r).toMatchObject({ validated: true, state: "VALIDATED" });
  });

  it("sans jeu de règles applicable : refusé (aucune valeur implicite)", async () => {
    const other = await db.createTenant();
    const refused = await adapter().evaluateAnnualUe(ctxFor(other), { parts: [part("12"), part("12")], session2Tentee: true, validationParJury: false, scope });
    expect(!refused.ok && refused.error.code).toBe("rules.no_active_ruleset");
  });

  it("de bout en bout : deux clôtures de semestre -> UNE écriture au registre, décidée par le RuleSet réel", async () => {
    const world = makeWorld(db);
    (world.ports as { rules: unknown }).rules = adapter();
    const deps = createHigherDeps({ db: db.tenantDb, clock: world.clock, audit: new RecordingAudit(), ports: world.ports, newVerificationCode: world.deps.newVerificationCode });
    const s = await seedSchool(db, world, { students: 1, tenantId: tenant });
    const st = s.students[0]!;
    unwrap(await declareAnnualUe(deps, s.admin.ctx, { ueNodeId: s.ues[0]!.nodeId, memberNodeIds: [s.ues[1]!.nodeId], reason: "UE annuelle de démonstration" }));
    (world.ports as ReturnType<typeof inMemoryPorts>).credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { averageExact: "9" })]);
    (world.ports as ReturnType<typeof inMemoryPorts>).credits.setFinalLines(s.classroomId, s.period2Id, [ueLine(s, st, s.ues[1]!, { academicPeriodId: s.period2Id, averageExact: "14" })]);
    // le semestre 1 est à 9 (< seuil) mais la moyenne COMMUNE (11.5) valide l'UE annuelle : c'est tout l'intérêt d'un résultat commun
    expect(unwrap(await capitalizePeriod(deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId })).annual).toEqual({ pending: 1, evaluated: 0 });
    expect(unwrap(await capitalizePeriod(deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.period2Id })).annual).toEqual({ pending: 0, evaluated: 1 });
    const rows = await adminRows<{ ue_node_id: string; credits: string; average_exact: string; status: string }>(db, "SELECT ue_node_id, credits::text, average_exact::text, status FROM higher.credit_ledger WHERE tenant_id = $1", [tenant]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ue_node_id: s.ues[0]!.nodeId, credits: "12.00", status: "ACQUIRED" });
    expect(Number(rows[0]!.average_exact)).toBeCloseTo(11.5, 6);
  });
});
