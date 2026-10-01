/**
 * Scénarios BTS / LMD de `tests/characterization` ré-exprimés par des ports mémoire : les résultats d'UE FINAL des
 * snapshots du legacy deviennent les lignes publiées par `results` (`UeResultLine`), la capitalisation les inscrit au
 * registre, et l'éligibilité au diplôme est évaluée par le RuleSet RÉEL (module rules).
 *
 * Les bogues legacy connus ne sont PAS reproduits : tout étudiant dont le résultat d'UE figure dans la portée d'un défaut
 * connu (`knownLegacyDefects[].scope`, ex. flottants `FLOAT_ECUE_VALIDATION_10`) est exclu de la comparaison — la
 * snapshot est fausse pour lui, ce n'est pas un étalon.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createRulesApi, createRulesDeps, ensureNationalCatalog, putBinding } from "../../../rules";
import { awardDiploma, recomputeDiploma } from "../../application/awards";
import { createHigherDeps } from "../../application/deps";
import { createDiplomaFromCurriculum, listDiplomaCandidates } from "../../application/diplomas";
import { capitalizePeriod, getCreditSummary, listAcquiredUe, listDebts } from "../../application/ledger";
import { RecordingAudit } from "../../application/ports";
import { createRulesAdapter } from "../../infrastructure/rules-adapter";
import { adminRows, createHigherTestDb, ctxFor, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../../tests/characterization/snapshots");

interface UeRow { ue_code: string; statut: "validee" | "echec" | "en_cours"; uv_acquises: number; ue_nb_uv: number }
interface Snapshot {
  knownLegacyDefects: Array<{ id: string; scope?: string[] }>;
  data: { observations: { final: { ueResults: Record<string, UeRow[]> } } };
}
const load = (name: string): Snapshot => JSON.parse(readFileSync(join(snapshotsDir, `${name}.snapshot.json`), "utf8")) as Snapshot;

/** Étudiants dont la snapshot est entachée d'un bogue legacy connu (portée `observations.final.ueResults.<étudiant>.**`). */
function studentsAffectedByDefects(s: Snapshot): Set<string> {
  const out = new Set<string>();
  for (const d of s.knownLegacyDefects) {
    for (const scope of d.scope ?? []) {
      const m = /^observations\.final\.ueResults\.([^.]+)\.\*\*$/.exec(scope);
      if (m) out.add(m[1] as string);
    }
  }
  return out;
}

describeIntegration("scénarios de caractérisation BTS / LMD ré-exprimés par ports mémoire (Postgres réel)", () => {
  let db: HigherTestDb;
  let rulesDeps: ReturnType<typeof createRulesDeps>;
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

  /** Monde de test avec les règles de PRODUCTION (RuleSet réel) ; programme = UE du scénario. */
  async function build(snap: Snapshot): Promise<{ w: TestWorld; s: School; keys: string[]; ueCodes: string[] }> {
    const rows = snap.data.observations.final.ueResults;
    const keys = Object.keys(rows).sort();
    const first = rows[keys[0] as string] as UeRow[];
    const base = makeWorld(db);
    (base.ports as { rules: unknown }).rules = createRulesAdapter(() => createRulesApi(rulesDeps));
    const w: TestWorld = { ...base, deps: createHigherDeps({ db: db.tenantDb, clock: base.clock, audit: new RecordingAudit(), ports: base.ports, newVerificationCode: base.deps.newVerificationCode }) };
    const s = await seedSchool(db, w, { students: keys.length, tenantId: tenant, ues: first.map((r) => ({ code: r.ue_code, credits: r.ue_nb_uv })) });
    return { w, s, keys, ueCodes: first.map((r) => r.ue_code) };
  }

  const linesOf = (s: School, keys: string[], rows: Record<string, UeRow[]>, skip: Set<string>) =>
    keys.flatMap((k, i) =>
      skip.has(k)
        ? []
        : (rows[k] as UeRow[])
            .filter((r) => r.statut !== "en_cours")
            .map((r) => {
              const ue = s.ues.find((u) => u.code === r.ue_code)!;
              return r.statut === "validee"
                ? ueLine(s, s.students[i]!, ue, { credits: r.uv_acquises })
                : ueLine(s, s.students[i]!, ue, { validated: false, ueState: "DEBT", sessionObtained: null, averageExact: null });
            }),
    );

  it("licence-rattrapage : le registre contient EXACTEMENT les UE validées du legacy, crédits figés ; les échecs deviennent des dettes", async () => {
    const snap = load("licence-rattrapage");
    const skip = studentsAffectedByDefects(snap);
    const { w, s, keys } = await build(snap);
    const rows = snap.data.observations.final.ueResults;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, linesOf(s, keys, rows, skip));
    const report = unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    const expectedAcquired = keys.filter((k) => !skip.has(k)).flatMap((k) => (rows[k] as UeRow[]).filter((r) => r.statut === "validee"));
    const expectedDebts = keys.filter((k) => !skip.has(k)).flatMap((k) => (rows[k] as UeRow[]).filter((r) => r.statut === "echec"));
    expect(report).toMatchObject({ acquired: expectedAcquired.length, debtsOpened: expectedDebts.length, rejected: 0 });

    for (const [i, k] of keys.entries()) {
      if (skip.has(k)) continue;
      const st = s.students[i]!;
      const acquired = unwrap(await listAcquiredUe(w.deps, s.admin.ctx, st.studentId));
      const expectedRows = (rows[k] as UeRow[]).filter((r) => r.statut === "validee");
      expect(acquired.map((e) => s.ues.find((u) => u.nodeId === e.ueNodeId)!.code).sort(), `UE acquises de ${k}`).toEqual(expectedRows.map((r) => r.ue_code).sort());
      const summary = unwrap(await getCreditSummary(w.deps, s.admin.ctx, st.studentId));
      expect(summary.totalCredits, `crédits de ${k}`).toBe(expectedRows.reduce((sum, r) => sum + r.uv_acquises, 0));
      const debts = unwrap(await listDebts(w.deps, s.admin.ctx, st.studentId));
      expect(debts.map((d) => s.ues.find((u) => u.nodeId === d.ueNodeId)!.code).sort(), `dettes de ${k}`).toEqual((rows[k] as UeRow[]).filter((r) => r.statut === "echec").map((r) => r.ue_code).sort());
    }
    // Décision métier 2026-10-01 : la session 2 REMPLACE la session 1 même plus faible (omar : UE504 en échec) — dette, jamais acquise.
    const omar = s.students[keys.indexOf("omar")]!;
    expect((await adminRows(db, "SELECT 1 FROM higher.credit_ledger WHERE student_id = $1 AND ue_node_id = $2", [omar.studentId, s.ues.find((u) => u.code === "UE504")!.nodeId]))).toHaveLength(0);
  });

  it("licence-rattrapage : diplôme de la licence (4 UE obligatoires, 24 UV) — éligibles = étudiants ayant validé TOUTES les UE, sans compensation", async () => {
    const snap = load("licence-rattrapage");
    const skip = studentsAffectedByDefects(snap);
    const { w, s, keys } = await build(snap);
    const rows = snap.data.observations.final.ueResults;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, linesOf(s, keys, rows, skip));
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "LICENCE", code: "LIC-GL" }));
    expect(def.definition.uvRequired).toBe(s.ues.reduce((sum, u) => sum + u.credits, 0)); // 24

    const candidates = unwrap(await listDiplomaCandidates(w.deps, s.admin.ctx, def.definition.id));
    const eligibleExpected = keys.filter((k) => !skip.has(k) && (rows[k] as UeRow[]).every((r) => r.statut === "validee")).map((k) => s.students[keys.indexOf(k)]!.studentId).sort();
    expect(candidates.filter((c) => c.eligible).map((c) => c.studentId).sort()).toEqual(eligibleExpected);
    expect(eligibleExpected.length).toBeGreaterThan(0);
    // Un étudiant à 18/24 UV avec une UE obligatoire manquante n'est pas éligible, même au-dessus d'un total « suffisant ».
    const marc = candidates.find((c) => c.studentId === s.students[keys.indexOf("marc")]!.studentId)!;
    expect(marc).toMatchObject({ eligible: false, uvValidated: 16, missingMandatory: 1 });

    // L'octroi automatique (cycle complet requis pour la mention) : les éligibles sont diplômés, références continues.
    for (const id of eligibleExpected) w.ports.cycleResults.set(id, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "12.5", credits: 24 }] });
    const report = unwrap(await recomputeDiploma(w.deps, s.admin.ctx, def.definition.id));
    expect(report.awarded).toBe(eligibleExpected.length);
    const refs = await adminRows<{ reference: string }>(db, "SELECT reference FROM higher.diploma_awards a WHERE tenant_id = $1 AND definition_id = $2 ORDER BY a.reference_seq", [s.tenantId, def.definition.id]);
    expect(refs.map((r) => r.reference)).toEqual(Array.from({ length: eligibleExpected.length }, (_, i) => `DIP-2026-${String(i + 1).padStart(6, "0")}`));
    // Un non-éligible ne peut pas être diplômé sans forçage motivé.
    const refused = await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: s.students[keys.indexOf("marc")]!.studentId, via: "MANUAL" });
    expect(!refused.ok && refused.error.code).toBe("higher.diploma_not_eligible");
  });

  it("bts-premiere-annee : capitalisation des 2 semestres (UE en cours ignorées, bogues flottants exclus) ; crédits = uv_acquises du legacy", async () => {
    const snap = load("bts-premiere-annee");
    const skip = studentsAffectedByDefects(snap);
    expect(skip.size).toBeGreaterThan(0); // fatou, ibrahim (flottants), bako, jade, kofi (règle des 20 crédits jamais appliquée)
    const { w, s, keys } = await build(snap);
    const rows = snap.data.observations.final.ueResults;
    // Une seule classe x période de test : les UE de S1 et de S2 sont portées par la même clôture simulée.
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, linesOf(s, keys, rows, skip));
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    for (const [i, k] of keys.entries()) {
      if (skip.has(k)) continue;
      const expected = (rows[k] as UeRow[]).filter((r) => r.statut === "validee");
      const summary = unwrap(await getCreditSummary(w.deps, s.admin.ctx, s.students[i]!.studentId));
      expect({ k, credits: summary.totalCredits, ue: summary.acquiredUeCount }).toEqual({ k, credits: expected.reduce((sum, r) => sum + r.uv_acquises, 0), ue: expected.length });
    }
    // amina (56 crédits, 7 UE) : seule étudiante de la snapshot à avoir tout validé sans bogue -> éligible au diplôme du BTS.
    const def = unwrap(await createDiplomaFromCurriculum(w.deps, s.admin.ctx, { curriculumNodeId: s.cycleNodeId, gradeCode: "BTS", code: "BTS-INFO" }));
    expect(def.definition.uvRequired).toBe(56);
    const candidates = unwrap(await listDiplomaCandidates(w.deps, s.admin.ctx, def.definition.id));
    const aminaId = s.students[keys.indexOf("amina")]!.studentId;
    expect(candidates.filter((c) => c.eligible).map((c) => c.studentId)).toEqual([aminaId]);
    expect(candidates.find((c) => c.studentId === aminaId)).toMatchObject({ uvValidated: 56, percent: 100 });
  });
});
