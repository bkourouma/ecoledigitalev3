/**
 * Rejeu de reproductibilité (AC4.3) : les résultats FINAL conservent le contexte exact de chaque appel de règle ; la source de rejeu de
 * `results` le restitue au module `rules`, qui rejoue sous la version et le hash ÉPINGLÉS et compare les empreintes (0 écart attendu).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { updateResultsSettings } from "../../application/governance";
import { closePeriod, lockPeriod } from "../../application/lifecycle";
import { computePeriod } from "../../application/compute";
import { explainResult, getEnrollmentResult, listMyResults } from "../../application/reads";
import { bindResultsRulesSources, createResultsReplaySource, createResultsSimulationSource } from "../../application/replay";
import type { EnrollmentRef } from "../../domain/types";
import { adminRows, createResultsTestDb, ctxFor, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, creditStructure, grade, makeWorld, period, type World } from "../support/world";

describeIntegration("rejeu de reproductibilité des résultats FINAL (Postgres réel + règles réelles)", () => {
  let db: ResultsTestDb;
  let w: World;
  const classroomId = newId();
  const p = period(newId());
  const built = creditStructure({ classroomId, yearId: newId(), period: p, ues: [{ code: "UE1", ecues: [{ code: "E1", credits: "4" }, { code: "E2", credits: "4" }] }] });
  const id = (c: string): string => built.ids.get(c) as string;
  let students: EnrollmentRef[];
  const ref = { classroomId, academicPeriodId: p.id };
  const sys = () => createSystemContext(w.tenantId);

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    w.curriculum.set(built.structure);
    students = Array.from({ length: 6 }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const s of students) w.roster.entries.push({ ...s, active: true, classroomId });
    const pair = (e: EnrollmentRef, node: string, dev: string, exam: string) => [grade(e.enrollmentId, id(node), dev), grade(e.enrollmentId, id(node), exam, { aggregationGroup: "EXAM" })];
    w.assess.grades = students.flatMap((s, i) => [...pair(s, "E1", String(8 + i * 2), String(9 + i * 2)), ...pair(s, "E2", String(14 - i), String(12 - i))]);
    unwrap(await updateResultsSettings(w.deps, w.director, { requireDeliberation: false }));
    unwrap(await computePeriod(w.deps, w.director, ref));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("un brouillon n'a pas de contexte conservé ; la clôture conserve le contexte de chaque appel (sauf le rang, dont le contexte est la cohorte)", async () => {
    const drafts = await adminRows<{ trace: unknown }>(db, "SELECT l.trace FROM results.line_results l JOIN results.period_results r ON r.id = l.period_result_id WHERE r.state_id IN (SELECT id FROM results.period_states WHERE classroom_id = $1) AND l.trace IS NOT NULL", [classroomId]);
    expect(drafts).toHaveLength(0);
    unwrap(await lockPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    unwrap(await closePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    const traces = await adminRows<{ trace: Array<{ ruleKey: string; variables?: unknown }> }>(db, "SELECT l.trace FROM results.line_results l JOIN results.period_results r ON r.id = l.period_result_id WHERE r.status = 'FINAL' AND r.classroom_id = $1", [classroomId]);
    const flat = traces.flatMap((t) => t.trace);
    expect(flat.length).toBeGreaterThan(50);
    expect(flat.filter((t) => t.ruleKey !== "rang").every((t) => t.variables !== undefined)).toBe(true);
    expect(flat.filter((t) => t.ruleKey === "rang").every((t) => t.variables === undefined)).toBe(true);
  });

  it("la source restitue des enregistrements rejouables : le module rules les rejoue sous la version ÉPINGLÉE avec 0 écart", async () => {
    const source = createResultsReplaySource(() => w.deps, "credit-semester@1");
    const records = await source.sample({ ctx: sys(), percent: 100 });
    expect(records.length).toBeGreaterThan(50);
    expect(new Set(records.map((r) => r.ruleKey)).has("rang")).toBe(false);
    expect(records.every((r) => /^[0-9a-f]{64}$/.test(r.definitionHash) && r.inputsHash.length === 64 && r.outputsHash.length === 64)).toBe(true);
    const report = unwrap(await w.rulesApi.replayEvaluations(sys(), records));
    expect(report.checked).toBe(records.length);
    expect(report.mismatches).toEqual([]);
    expect(report.inputsChanged).toEqual([]);
  });

  it("une donnée source altérée est DÉTECTÉE par le rejeu (entrées modifiées ⇒ empreinte d'entrée différente)", async () => {
    const source = createResultsReplaySource(() => w.deps, "credit-semester@1");
    const records = [...(await source.sample({ ctx: sys(), percent: 100 }))];
    const target = records.findIndex((r) => r.ruleKey === "note_ecue");
    const tampered = { ...records[target]!, context: { variables: { ...(records[target]!.context.variables as Record<string, unknown>), note_examen: "20" } } };
    records[target] = tampered;
    const report = unwrap(await w.rulesApi.replayEvaluations(sys(), records));
    expect(report.inputsChanged.length + report.mismatches.length).toBeGreaterThan(0);
  });

  it("échantillon : 0 % ⇒ rien ; un pourcentage partiel est un sous-ensemble STABLE du résultat complet dans la journée", async () => {
    const source = createResultsReplaySource(() => w.deps, "credit-semester@1");
    expect(await source.sample({ ctx: sys(), percent: 0 })).toEqual([]);
    const all = new Set((await source.sample({ ctx: sys(), percent: 100 })).map((r) => r.resultId));
    const half1 = (await source.sample({ ctx: sys(), percent: 50 })).map((r) => r.resultId);
    const half2 = (await source.sample({ ctx: sys(), percent: 50 })).map((r) => r.resultId);
    expect(half1).toEqual(half2);
    expect(half1.every((x) => all.has(x))).toBe(true);
    expect(half1.length).toBeLessThanOrEqual(all.size);
    // un autre contrat n'obtient aucun enregistrement de ce tenant
    expect(await createResultsReplaySource(() => w.deps, "coef-semester@1").sample({ ctx: sys(), percent: 100 })).toEqual([]);
  });

  it("simulation : cas construits sur les données RÉELLES (un groupe par règle, sans identité), filtrés par période et classe, échantillon déterministe, progression écrite", async () => {
    const source = createResultsSimulationSource(() => w.deps, "credit-semester@1");
    const steps: number[] = [];
    const request = (over: Record<string, unknown> = {}) => ({ ctx: sys(), contractId: "credit-semester@1", dataset: { periodIds: [p.id], ...over }, progress: async (n: number) => void steps.push(n) });
    const groups = await source.buildCaseGroups(request());
    expect(steps).toEqual([10, 80, 100]);
    expect(groups.length).toBeGreaterThan(5);
    expect(groups.every((g) => g.ruleKeys.length === 1 && g.cases.length > 0)).toBe(true);
    expect(groups.map((g) => g.ruleKeys[0])).not.toContain("rang");
    const note = groups.find((g) => g.ruleKeys[0] === "note_ecue");
    expect(note?.cases[0]?.context.variables).toHaveProperty("note_examen");
    const text = JSON.stringify(groups);
    for (const s of students) expect(text).not.toContain(s.enrollmentId);
    // les cas sont directement évaluables par rules : aucune erreur de contrat sur la version épinglée
    const replayable = groups.flatMap((g) => g.cases.map((c) => ({ ruleKey: g.ruleKeys[0] as string, c })));
    expect(replayable.length).toBeGreaterThan(50);
    // filtre : autre période ou autre classe ⇒ rien ; échantillon réduit ⇒ moins de cas, identique à chaque appel
    expect(await source.buildCaseGroups(request({ periodIds: [newId()] }))).toEqual([]);
    expect(await source.buildCaseGroups(request({ classroomIds: [newId()] }))).toEqual([]);
    const small1 = await source.buildCaseGroups(request({ sample: { size: 2, seed: 7 } }));
    const small2 = await source.buildCaseGroups(request({ sample: { size: 2, seed: 7 } }));
    expect(small1).toEqual(small2);
    expect(small1.flatMap((g) => g.cases).length).toBeLessThan(replayable.length);
    // un autre contrat : aucun cas
    expect(await source.buildCaseGroups({ ...request(), contractId: "coef-semester@1" })).toEqual([]);
  });

  it("branchement dans le registre du processus : les deux contrats pris en charge, une seule fois", () => {
    bindResultsRulesSources(w.deps);
    bindResultsRulesSources(w.deps);
    expect([...w.rulesApi.deps.replaySources.keys()].sort()).toEqual(["coef-semester@1", "credit-semester@1"]);
    expect([...w.rulesApi.deps.simulationSources.keys()].sort()).toEqual(["coef-semester@1", "credit-semester@1"]);
  });

  it("le contexte conservé ne sort que par `explain` (droit dédié) : jamais par la lecture famille", async () => {
    const header = unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: students[0]!.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL })).header;
    const ex = unwrap(await explainResult(w.deps, w.director, { resultId: header.id, caps: CAPS_ALL }));
    expect(ex.source).toBe("STORED");
    expect(JSON.stringify(ex.lines)).toContain("variables");
    expect(await explainResult(w.deps, w.director, { resultId: header.id, caps: { read: true } })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
    const pupilUser = newId();
    w.guardianship.studentByUser.set(pupilUser, students[0]!.studentId);
    const mine = unwrap(await listMyResults(w.deps, ctxFor(w.tenantId, pupilUser, ["eleve"], false)));
    expect(JSON.stringify(mine)).not.toMatch(/variables|trace|inputs/i);
  });
});
