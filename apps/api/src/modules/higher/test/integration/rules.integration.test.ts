/**
 * Parité avec le RuleSet RÉEL (module rules, contrat `credit-semester@1`) : ce module ne contient aucune formule — il
 * construit un contexte et délègue. Ce test branche l'adaptateur de production sur la vraie API du module rules (catalogue
 * national chargé, liaison du tenant) et rejoue la table de vérité de `evaluateDiplomaEligibility` du legacy
 * (`professional-diplomas.service.ts:64-109`), les mentions de cycle (10/12/14/16/18) et la moyenne de cycle pondérée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createRulesApi, createRulesDeps, ensureNationalCatalog, putBinding, type RulesDeps } from "../../../rules";
import { awardDiploma, evaluateStudentDiplomas } from "../../application/awards";
import { createHigherDeps } from "../../application/deps";
import { createDiploma } from "../../application/diplomas";
import { capitalizePeriod } from "../../application/ledger";
import { resolveRequirementStates, toEligibilityContext } from "../../domain/diploma";
import type { DiplomaRequirement } from "../../domain/types";
import { createRulesAdapter } from "../../infrastructure/rules-adapter";
import { adminOne, adminRows, createHigherTestDb, ctxFor, describeIntegration, type HigherTestDb } from "../support/db";
import { RecordingAudit } from "../../application/ports";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { makeWorld, seedSchool, ueLine } from "../support/world";

/** Oracle : `evaluateDiplomaEligibility` du legacy (dédoublonnage par UE, l'obligatoire prime ; Σ UV des UE exigées validées). */
function legacyEligibility(reqs: Array<{ ue: string; uv: number; mandatory: boolean }>, uvRequired: number, validated: Set<string>): boolean {
  const byUe = new Map<string, { uv: number; mandatory: boolean }>();
  for (const r of reqs) {
    const e = byUe.get(r.ue);
    if (!e) byUe.set(r.ue, { uv: r.uv, mandatory: r.mandatory });
    else if (r.mandatory && !e.mandatory) byUe.set(r.ue, { ...e, mandatory: true });
  }
  let uv = 0;
  let mandatoryOk = true;
  for (const [ue, r] of byUe) {
    if (validated.has(ue)) uv += r.uv;
    else if (r.mandatory) mandatoryOk = false;
  }
  return mandatoryOk && uv >= uvRequired;
}

describeIntegration("règles réelles : diplome_eligible, moyenne_annuelle, mention_diplome (Postgres réel)", () => {
  let db: HigherTestDb;
  let rulesDeps: RulesDeps;
  let tenantA: string;
  let tenantNoRules: string;

  beforeAll(async () => {
    db = await createHigherTestDb(12, { withRules: true });
    rulesDeps = createRulesDeps({ db: db.tenantDb, systemDb: db.systemDb });
    await ensureNationalCatalog(rulesDeps);
    tenantA = await db.createTenant();
    tenantNoRules = await db.createTenant();
    const bound = await putBinding(rulesDeps, ctxFor(tenantA), { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
    if (!bound.ok) throw bound.error;
  });
  afterAll(async () => {
    await db.drop();
  });

  const adapter = () => createRulesAdapter(() => createRulesApi(rulesDeps)); // vérifié à la compilation : RulesApi satisfait RulesApiLike
  const scope = { onDate: "2026-10-01" };

  it("table de vérité (>= 30 cas) : l'éligibilité rendue par la règle égale celle de evaluateDiplomaEligibility du legacy", async () => {
    const rules = adapter();
    const ctx = ctxFor(tenantA);
    const credits = [6, 6, 3, 3];
    let cases = 0;
    for (const mandatoryPattern of [[true, true, true, true], [true, false, true, false]]) {
      for (const uvRequired of [12, 15, 18]) {
        for (let mask = 0; mask < 16; mask += 1) {
          const reqs = credits.map((uv, i) => ({ ue: `UE${i}`, uv, mandatory: mandatoryPattern[i] as boolean }));
          const validated = new Set(reqs.filter((_, i) => (mask >> i) & 1).map((r) => r.ue));
          const requirements: DiplomaRequirement[] = reqs.map((r, i) => ({ id: newId(), definitionId: "d", ueNodeId: r.ue, ueCode: r.ue, ueLabel: r.ue, credits: r.uv, mandatory: r.mandatory, position: i, removedFromCurriculum: false }));
          const entries = [...validated].map((ue) => ({ id: newId(), ueNodeId: ue, credits: reqs.find((r) => r.ue === ue)!.uv }));
          const exigences = toEligibilityContext(resolveRequirementStates(requirements, entries));
          const r = unwrap(await rules.evaluateEligibility(ctx, { exigences, uvRequises: uvRequired, scope }));
          expect(r.eligible, `masque ${mask.toString(2).padStart(4, "0")} obligatoires ${mandatoryPattern.join("/")} UV ${uvRequired}`).toBe(legacyEligibility(reqs, uvRequired, validated));
          expect(r.rule).toMatchObject({ ruleSetCode: "CI-HIGHER-LMD", versionNo: 1 });
          cases += 1;
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(30);
  });

  it("cas limites du legacy : UE exigée deux fois (comptée une fois, obligatoire prioritaire), exigences vides, crédits décimaux, UE à 0 crédit", async () => {
    const rules = adapter();
    const ctx = ctxFor(tenantA);
    const eval1 = async (reqs: Array<{ ue: string; uv: number; mandatory: boolean }>, uvRequired: number, validated: string[]) => {
      const requirements: DiplomaRequirement[] = reqs.map((r, i) => ({ id: newId(), definitionId: "d", ueNodeId: r.ue, ueCode: r.ue, ueLabel: r.ue, credits: r.uv, mandatory: r.mandatory, position: i, removedFromCurriculum: false }));
      const entries = validated.map((ue) => ({ id: newId(), ueNodeId: ue, credits: reqs.find((r) => r.ue === ue)!.uv }));
      const exigences = toEligibilityContext(resolveRequirementStates(requirements, entries));
      const r = unwrap(await rules.evaluateEligibility(ctx, { exigences, uvRequises: uvRequired, scope }));
      expect(r.eligible).toBe(legacyEligibility(reqs, uvRequired, new Set(validated)));
      return r.eligible;
    };
    // doublon : la même UE (6 UV) exigée deux fois n'est comptée qu'une fois -> 6 < 12
    expect(await eval1([{ ue: "A", uv: 6, mandatory: false }, { ue: "A", uv: 6, mandatory: false }], 12, ["A"])).toBe(false);
    // doublon facultatif + obligatoire non validée : l'obligatoire l'emporte
    expect(await eval1([{ ue: "A", uv: 6, mandatory: false }, { ue: "A", uv: 6, mandatory: true }, { ue: "B", uv: 6, mandatory: false }], 6, ["B"])).toBe(false);
    expect(await eval1([], 1, [])).toBe(false);
    expect(await eval1([{ ue: "A", uv: 2.5, mandatory: true }, { ue: "B", uv: 3.5, mandatory: true }], 6, ["A", "B"])).toBe(true);
    expect(await eval1([{ ue: "A", uv: 2.5, mandatory: true }, { ue: "B", uv: 3.5, mandatory: true }], 6.01, ["A", "B"])).toBe(false);
    expect(await eval1([{ ue: "A", uv: 0, mandatory: true }, { ue: "B", uv: 6, mandatory: true }], 6, ["A", "B"])).toBe(true); // conduite à 0 crédit
    expect(await eval1([{ ue: "A", uv: 0, mandatory: true }, { ue: "B", uv: 6, mandatory: true }], 6, ["B"])).toBe(false); // obligatoire à 0 crédit non validée
  });

  it("mention de cycle : seuils 10/12/14/16/18 du RuleSet (jamais dans le module), valeur absente = PENDING", async () => {
    const rules = adapter();
    const ctx = ctxFor(tenantA);
    const table: Array<[string | null, string]> = [
      [null, "PENDING"], ["0", "INSUFFICIENT"], ["9.999", "INSUFFICIENT"], ["10", "PASSABLE"], ["11.999", "PASSABLE"], ["12", "FAIRLY_GOOD"],
      ["13.5", "FAIRLY_GOOD"], ["14", "GOOD"], ["15.999", "GOOD"], ["16", "VERY_GOOD"], ["17.999", "VERY_GOOD"], ["18", "EXCELLENT"], ["20", "EXCELLENT"],
    ];
    for (const [average, code] of table) {
      const r = unwrap(await rules.evaluateCycle(ctx, { semestres: average === null ? [] : [{ moyenne: average, credits: 30 }], scope }));
      expect(r.mentionCode, `moyenne ${average}`).toBe(code);
    }
    // Moyenne de cycle pondérée par les crédits de semestre, exacte : (10 x 10 + 16 x 20) / 30 = 14
    const weighted = unwrap(await rules.evaluateCycle(ctx, { semestres: [{ moyenne: "10", credits: 10 }, { moyenne: "16", credits: 20 }], scope }));
    expect(Number(weighted.average)).toBe(14);
    expect(weighted.mentionCode).toBe("GOOD");
    expect(weighted.rule.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sans jeu de règles applicable : décision REFUSÉE (rules.no_active_ruleset), aucune valeur implicite, rien n'est écrit", async () => {
    const rules = adapter();
    const refused = await rules.evaluateEligibility(ctxFor(tenantNoRules), { exigences: [{ valide: true, obligatoire: true, uv: 6 }], uvRequises: 6, scope });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("rules.no_active_ruleset");
    // Avant la date d'effet de la liaison : refusé aussi.
    const early = await rules.evaluateEligibility(ctxFor(tenantA), { exigences: [{ valide: true, obligatoire: true, uv: 6 }], uvRequises: 6, scope: { onDate: "2020-01-01" } });
    expect(early.ok).toBe(false);

    // Octroi de bout en bout sur un tenant sans règles : refus, ni octroi ni numéro consommé.
    const w = makeWorldWithRules();
    const s = await seedSchool(db, w, { students: 1, tenantId: tenantNoRules });
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, s.students[0]!, s.ues[0]!)]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    const def = unwrap(await createDiploma(w.deps, s.admin.ctx, { code: "NR", label: "Sans règles", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
    const r = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: s.students[0]!.studentId, via: "MANUAL" });
    expect(!r.ok && r.error.code).toBe("rules.no_active_ruleset");
    expect(await adminRows(db, "SELECT 1 FROM higher.diploma_awards WHERE tenant_id = $1", [tenantNoRules])).toHaveLength(0);
    expect(await adminRows(db, "SELECT 1 FROM higher.number_counters WHERE tenant_id = $1", [tenantNoRules])).toHaveLength(0);
  });

  it("octroi de bout en bout avec les règles RÉELLES : version de règle, empreintes et mention figées dans l'octroi", async () => {
    const w = makeWorldWithRules();
    const s = await seedSchool(db, w, { students: 2, tenantId: tenantA });
    const [ok, short] = s.students;
    const def = unwrap(await createDiploma(w.deps, s.admin.ctx, { code: "REAL", label: "Licence réelle", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 18 }));
    // Exigences = les 3 UE du cycle.
    const { replaceRequirements } = await import("../../application/diplomas");
    unwrap(await replaceRequirements(w.deps, s.admin.ctx, { definitionId: def.definition.id, requirements: s.ues.map((u) => ({ ueNodeId: u.nodeId })) }));
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [...s.ues.map((u) => ueLine(s, ok!, u)), ueLine(s, short!, s.ues[0]!)]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    w.ports.cycleResults.set(ok!.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "11.9999", credits: 15 }, { academicPeriodId: s.period2Id, academicYearId: s.yearId, average: "12.0001", credits: 15 }] });

    const refused = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: short!.studentId, via: "MANUAL" });
    expect(!refused.ok && refused.error.code).toBe("higher.diploma_not_eligible");
    expect(unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: short!.studentId, ueNodeId: s.ues[0]!.nodeId }))).toMatchObject({ awarded: 0 });

    const r = unwrap(await evaluateStudentDiplomas(w.deps, s.admin.ctx, { studentId: ok!.studentId, ueNodeId: s.ues[2]!.nodeId }));
    expect(r.awarded).toBe(1);
    const row = await adminOne<{ rule_set_code: string; rule_version_no: number; definition_hash: string; mention_code: string; cycle_average: string; eligibility: any }>(
      db, "SELECT rule_set_code, rule_version_no, definition_hash, mention_code, cycle_average::text AS cycle_average, eligibility FROM higher.diploma_awards WHERE tenant_id = $1", [tenantA]);
    expect(row).toMatchObject({ rule_set_code: "CI-HIGHER-LMD", rule_version_no: 1, mention_code: "FAIRLY_GOOD" });
    expect(Number(row.cycle_average)).toBe(12); // moyenne pondérée exacte (11.9999 + 12.0001) / 2, jamais arrondie avant le seuil de mention
    const stored = await adminOne<{ id: string; definition_hash: string }>(db, "SELECT v.id, v.definition_hash FROM rules.national_rule_versions v JOIN rules.national_rule_sets s ON s.id = v.rule_set_id WHERE s.code = 'CI-HIGHER-LMD'");
    expect(row.eligibility.rule.definitionHash).toBe(stored.definition_hash); // empreinte de la version de règle appliquée
    expect(row.eligibility.rule.ruleVersionId).toBe(stored.id);
    expect(row.definition_hash).toMatch(/^[0-9a-f]{64}$/); // empreinte de la définition de diplôme (indépendante)
    expect(row.definition_hash).not.toBe(stored.definition_hash);
    expect(row.eligibility).toMatchObject({ eligible: true, rule: { ruleSetCode: "CI-HIGHER-LMD" }, cycle: { mentionCode: "FAIRLY_GOOD" } });
    expect(row.eligibility.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.eligibility.outputsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  function makeWorldWithRules() {
    const world = makeWorld(db);
    // Port des règles de PRODUCTION (adaptateur sur l'API réelle du module rules).
    (world.ports as { rules: unknown }).rules = createRulesAdapter(() => createRulesApi(rulesDeps));
    const deps = createHigherDeps({ db: db.tenantDb, clock: world.clock, audit: new RecordingAudit(), ports: world.ports, newVerificationCode: world.deps.newVerificationCode });
    return { ...world, deps, ports: world.ports as ReturnType<typeof inMemoryPorts> };
  }
});
