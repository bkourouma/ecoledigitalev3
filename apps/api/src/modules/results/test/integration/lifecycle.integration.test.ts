/**
 * Cycle de vie d'une période : verrouiller, délibérer, clôturer, rouvrir ; immuabilité des résultats FINAL (application ET
 * déclencheurs, même pour un superuser) ; hash de clôture ; versions n+1 après réouverture ; rattrapage (session 2).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { computePeriod } from "../../application/compute";
import { createDeliberation, listDecisionsView, updateDeliberationUseCase, updateResultsSettings } from "../../application/governance";
import { closePeriod, deliberatePeriod, lockPeriod, reopenPeriod, repinPeriod } from "../../application/lifecycle";
import { processDueRecomputes, requestRecompute } from "../../application/recompute";
import { explainResult, getEnrollmentResult, getFinalResult, getPeriodView, listFinalLines, listResitCandidates } from "../../application/reads";
import { closureHashOf } from "../../domain/hash";
import type { EnrollmentRef } from "../../domain/types";
import { adminOne, adminRows, createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, creditStructure, grade, makeWorld, period, type World } from "../support/world";

describeIntegration("cycle de vie d'une période et immuabilité des résultats finaux (Postgres réel)", () => {
  let db: ResultsTestDb;
  let w: World;
  const classroomId = newId();
  const yearId = newId();
  const p = period(newId());
  const built = creditStructure({ classroomId, yearId, period: p, ues: [{ code: "UE1", ecues: [{ code: "E1A", credits: "5" }, { code: "E1B", credits: "3" }] }, { code: "UE2", ecues: [{ code: "E2", credits: "6" }] }] });
  const id = (c: string): string => built.ids.get(c) as string;
  let students: EnrollmentRef[];
  const ref = { classroomId, academicPeriodId: p.id };

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    w.curriculum.set(built.structure);
    students = Array.from({ length: 3 }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const s of students) w.roster.entries.push({ ...s, active: true, classroomId });
    const [a, b, c] = students as [EnrollmentRef, EnrollmentRef, EnrollmentRef];
    const both = (e: EnrollmentRef, node: string, dev: string, exam: string) => [grade(e.enrollmentId, id(node), dev), grade(e.enrollmentId, id(node), exam, { aggregationGroup: "EXAM" })];
    w.assess.grades = [
      ...both(a, "E1A", "12", "14"), ...both(a, "E1B", "10", "10"), ...both(a, "E2", "14", "14"),
      ...both(b, "E1A", "12", "12"), ...both(b, "E1B", "12", "12"), ...both(b, "E2", "6", "6"),
      ...both(c, "E1A", "9", "9"), ...both(c, "E1B", "9", "9"), ...both(c, "E2", "9", "9"),
    ];
    unwrap(await computePeriod(w.deps, w.director, ref));
  });
  afterAll(async () => {
    await db.drop();
  });

  const attempt = (sql: string, params: unknown[] = []): Promise<string> => db.admin.query(sql, params).then(() => "ok", (e: Error) => e.message);
  const stateRow = () => adminOne<{ status: string; results_version: number; reopen_count: number }>(db, "SELECT status, results_version, reopen_count FROM results.period_states WHERE academic_period_id = $1", [p.id]);

  it("verrouiller refuse tant que des évaluations ne sont pas publiées (liste renvoyée) ; forçage motivé ; droits contextuels", async () => {
    w.assess.pending = [{ id: newId(), title: "Devoir non publié", status: "REVIEWED", sessionNo: 1, curriculumNodeId: id("E1A") }];
    expect(await lockPeriod(w.deps, w.director, { ...ref, caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
    const refused = await lockPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL });
    expect(refused).toMatchObject({ ok: false, error: { code: "results.pending_assessments" } });
    expect((refused as any).error.details.pending).toHaveLength(1);
    expect(await lockPeriod(w.deps, w.director, { ...ref, force: true, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.justification_required" } });
    expect((await stateRow()).status).toBe("OPEN");

    const locked = unwrap(await lockPeriod(w.deps, w.director, { ...ref, force: true, reason: "L'enseignant est absent, on verrouille sans cette feuille.", caps: CAPS_ALL }));
    expect(locked).toMatchObject({ status: "GRADING_LOCKED" });
    expect(w.assess.locks.get(`${classroomId}:${p.id}`)).toEqual([1, 2]);
    // idempotent
    expect(unwrap(await lockPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL })).status).toBe("GRADING_LOCKED");
    const events = await adminRows<{ type: string; payload: any }>(db, "SELECT type, payload FROM kernel.domain_events WHERE type = 'results.period.locked'");
    expect(events).toHaveLength(1);
    expect(w.audit.entries.find((e) => e.action === "results.period.locked")).toMatchObject({ severity: "warning" });
  });

  it("la clôture exige une délibération TENUE (sauf réglage contraire) ; la délibération confirme les décisions proposées", async () => {
    expect(await closePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.deliberation_required" } });
    expect(await deliberatePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.deliberation_required" } });

    const state = unwrap(await getPeriodView(w.deps, w.director, { ...ref, caps: CAPS_ALL })).state;
    const d = unwrap(await createDeliberation(w.deps, w.director, { stateId: state.id, kind: "COUNCIL", caps: CAPS_ALL }));
    expect(d.status).toBe("PLANNED");
    expect(await deliberatePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.deliberation_required" } });
    expect(await updateDeliberationUseCase(w.deps, w.director, { deliberationId: d.id, status: "HELD", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.invalid_input" } });
    unwrap(await updateDeliberationUseCase(w.deps, w.director, { deliberationId: d.id, status: "HELD", heldOn: "2026-02-20", caps: CAPS_ALL }));

    const delib = unwrap(await deliberatePeriod(w.deps, w.director, { ...ref, confirmProposed: true, caps: CAPS_ALL }));
    expect(delib.status).toBe("DELIBERATED");
    const decisions = unwrap(await listDecisionsView(w.deps, w.director, { stateId: state.id, caps: CAPS_ALL }));
    expect(decisions).toHaveLength(3);
    expect(decisions.every((x) => x.status === "CONFIRMED" && x.finalCode === x.proposedCode && x.deliberationId === d.id)).toBe(true);
    const ev = await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'results.decision.confirmed'");
    expect(ev).toHaveLength(3);
  });

  let closure: { closureHash: string; resultsVersion: number; closureId: string };

  it("clôture : résultats FINAL de tous les inscrits, hash de clôture = agrégat des outputs_hash, version 1, événement, audit critique", async () => {
    w.audit.clear();
    const out = unwrap(await closePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    closure = out;
    expect(out).toMatchObject({ resultsVersion: 1, resultsCount: 3, withoutDeliberation: false, excluded: [] });
    expect(out.state).toMatchObject({ status: "CLOSED", resultsVersion: 1 });
    expect(out.closureHash).toMatch(/^[0-9a-f]{64}$/);

    const finals = await adminRows<{ outputs_hash: string; status: string; inputs: any; line_count: number; closure_id: string; finalized_at: string }>(
      db,
      "SELECT outputs_hash, status, inputs, line_count, closure_id, finalized_at FROM results.period_results WHERE academic_period_id = $1 AND status = 'FINAL'",
      [p.id],
    );
    expect(finals).toHaveLength(3);
    expect(closureHashOf(finals.map((f) => f.outputs_hash))).toBe(out.closureHash);
    for (const f of finals) {
      expect(f.closure_id).toBe(out.closureId);
      expect(f.inputs).not.toBeNull();
      expect(JSON.stringify(f.inputs)).not.toContain(students[0]!.studentId);
    }
    const lines = await adminOne<{ n: string; traced: string }>(db, "SELECT count(*)::text AS n, count(trace)::text AS traced FROM results.line_results l JOIN results.period_results r ON r.id = l.period_result_id WHERE r.status = 'FINAL'");
    expect(Number(lines.traced)).toBeGreaterThan(0);
    // les brouillons sont remplacés par les résultats finaux
    expect(await adminRows(db, "SELECT 1 FROM results.period_results WHERE academic_period_id = $1 AND status IN ('DRAFT','ERROR')", [p.id])).toEqual([]);
    expect(w.audit.actions()).toEqual(["results.period.closed"]);
    expect(w.audit.entries[0]).toMatchObject({ severity: "critical" });
    const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'results.period.closed'");
    expect(ev[0]!.payload).toMatchObject({ v: 1, closureHash: out.closureHash, resultsVersion: 1, withoutDeliberation: false });
  });

  it("IMMUABILITÉ : modifier, supprimer ou compléter un résultat FINAL est refusé par la base, même pour un SUPERUSER", async () => {
    const final = await adminOne<{ id: string }>(db, "SELECT id FROM results.period_results WHERE academic_period_id = $1 AND status = 'FINAL' LIMIT 1", [p.id]);
    expect(await attempt("UPDATE results.period_results SET average = 20 WHERE id = $1", [final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("UPDATE results.period_results SET rank = 1, decision_code = 'ADMITTED' WHERE id = $1", [final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("UPDATE results.period_results SET status = 'DRAFT' WHERE id = $1", [final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("DELETE FROM results.period_results WHERE id = $1", [final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("UPDATE results.line_results SET value = 20 WHERE period_result_id = $1", [final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("DELETE FROM results.line_results WHERE period_result_id = $1", [final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("INSERT INTO results.line_results (id, tenant_id, period_result_id, level) VALUES ($1,$2,$3,'PERIOD')", [newId(), w.tenantId, final.id])).toMatch(/results\.final_immutable/);
    expect(await attempt("UPDATE results.closures SET closure_hash = $1", ["0".repeat(64)])).toMatch(/results\.immutable/);
    expect(await attempt("DELETE FROM results.closures")).toMatch(/results\.immutable/);
    expect(await attempt("UPDATE results.period_states SET results_version = 5")).toMatch(/results\.state_closed|results\.version_requires_closure/);
    expect(await attempt("DELETE FROM results.period_states")).toMatch(/results\.immutable/);
    // rôle applicatif : mêmes refus
    await expect(db.tenantDb.run(w.director, (tx) => tx.query("UPDATE results.period_results SET average = 20 WHERE id = $1", [final.id]))).rejects.toThrow(/results\.final_immutable/);
    // un faux FINAL sans clôture ne s'insère pas
    expect(
      await attempt(
        `INSERT INTO results.period_results (id, tenant_id, state_id, enrollment_id, student_id, classroom_id, academic_period_id, academic_year_id, scope, version, status, contract_id, rule_version_kind, rule_version_id,
            rule_set_code, rule_version_no, definition_hash, engine_version, inputs_hash, outputs_hash, inputs, finalized_at, line_count)
         SELECT $1, tenant_id, state_id, $2, $2, classroom_id, academic_period_id, academic_year_id, scope, 99, 'FINAL', contract_id, rule_version_kind, rule_version_id, rule_set_code, rule_version_no, definition_hash, 'x',
            inputs_hash, outputs_hash, '{}'::jsonb, now(), 0 FROM results.period_results WHERE id = $3`,
        [newId(), newId(), final.id],
      ),
    ).toMatch(/results\.(final_requires_closure|state_closed)|violates check constraint/);
    expect((await adminOne<{ average: string | null }>(db, "SELECT average::text FROM results.period_results WHERE id = $1", [final.id])).average).not.toBe("20");
  });

  it("une période clôturée refuse recalcul, surcharge, appréciation et nouvelle délibération ; le recalcul en file est BLOQUÉ et signalé", async () => {
    expect(await computePeriod(w.deps, w.director, ref)).toMatchObject({ ok: false, error: { code: "results.state_closed" } });
    const queued = unwrap(await requestRecompute(w.deps, w.director, { ...ref, cause: { event: "assess.grade.published", id: newId() }, immediate: true }));
    expect(queued.status).toBe("PENDING");
    w.clock.advance(1000);
    const report = unwrap(await processDueRecomputes(w.deps, w.director));
    expect(report).toMatchObject({ claimed: 1, blocked: 1, done: 0 });
    const req = await adminOne<{ status: string; blocked_reason: string }>(db, "SELECT status, blocked_reason FROM results.recompute_requests WHERE id = $1", [queued.id]);
    expect(req).toEqual({ status: "BLOCKED", blocked_reason: "results.state_closed" });
    expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'results.recompute.blocked'")).toHaveLength(1);
    // aucune nouvelle version
    expect((await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM results.period_results WHERE academic_period_id = $1 AND status = 'FINAL'", [p.id])).n).toBe("3");
  });

  it("explicabilité : la trace d'un FINAL est stockée (chaque règle appelée, empreintes, valeurs intermédiaires)", async () => {
    const r = unwrap(await getFinalResult(w.deps, w.director, { enrollmentId: students[0]!.enrollmentId, academicPeriodId: p.id }));
    expect(r).not.toBeNull();
    const ex = unwrap(await explainResult(w.deps, w.director, { resultId: r!.id, caps: CAPS_ALL }));
    expect(ex.source).toBe("STORED");
    const ecue = ex.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E1A"))!;
    const records = ecue.trace as Array<{ ruleKey: string; value: unknown; inputsHash: string; outputsHash: string }>;
    expect(records.map((x) => x.ruleKey)).toEqual(expect.arrayContaining(["moyenne_devoirs", "note_examen_retenue", "note_ecue", "ecue_validee"]));
    expect(records.find((x) => x.ruleKey === "note_ecue")).toMatchObject({ value: "13.2" });
    expect(records.every((x) => /^[0-9a-f]{64}$/.test(x.inputsHash) && /^[0-9a-f]{64}$/.test(x.outputsHash))).toBe(true);
    expect(await explainResult(w.deps, w.director, { resultId: r!.id, caps: {} })).toMatchObject({ ok: false });
  });

  it("API publique : résultat FINAL, lignes finales, candidats au rattrapage (règle `eligible_rattrapage`)", async () => {
    const state = unwrap(await getPeriodView(w.deps, w.director, { ...ref, caps: CAPS_ALL })).state;
    const lines = unwrap(await listFinalLines(w.deps, w.director, { stateId: state.id, level: "ECUE" }));
    expect(lines).toHaveLength(9);
    const cand = unwrap(await listResitCandidates(w.deps, w.director, ref));
    // b (E2 = 6) et c (E1A, E1B, E2 = 9) sont éligibles ; a ne l'est pas
    expect(cand.filter((x) => x.enrollmentId === students[1]!.enrollmentId).map((x) => x.curriculumNodeId)).toEqual([id("E2")]);
    expect(cand.filter((x) => x.enrollmentId === students[2]!.enrollmentId)).toHaveLength(3);
    expect(cand.some((x) => x.enrollmentId === students[0]!.enrollmentId)).toBe(false);
  });

  it("réouverture : droit sensible, motif obligatoire ; libère le verrou des notes ; compteur et nature tracés ; événement et audit", async () => {
    expect(await reopenPeriod(w.deps, w.director, { ...ref, kind: "CORRECTION", reason: "Erreur de saisie.", caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
    expect(await reopenPeriod(w.deps, w.director, { ...ref, kind: "CORRECTION", reason: "court", caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.reopen_requires_reason" } });
    w.audit.clear();
    const s = unwrap(await reopenPeriod(w.deps, w.director, { ...ref, kind: "CORRECTION", reason: "Une note de E2 de l'étudiant b était erronée après vérification.", caps: CAPS_ALL }));
    expect(s).toMatchObject({ status: "OPEN", reopenCount: 1, lastReopenKind: "CORRECTION", resultsVersion: 1 });
    expect(w.assess.locks.has(`${classroomId}:${p.id}`)).toBe(false);
    expect(w.audit.entries[0]).toMatchObject({ action: "results.period.reopened", severity: "critical" });
    const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'results.period.reopened'");
    expect(ev[0]!.payload).toMatchObject({ reopenKind: "CORRECTION", resultsVersion: 1 });
    // une période rouverte est mise en file de recalcul
    expect((await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM results.recompute_requests WHERE status = 'PENDING'")).n).toBe("1");
    // les anciens FINAL restent la référence consultable tant que la période n'est pas reclôturée
    expect((await getFinalResult(w.deps, w.director, { enrollmentId: students[1]!.enrollmentId, academicPeriodId: p.id }) as any).value.version).toBeGreaterThan(0);
  });

  it("reclôture après correction : version n+1, les anciens FINAL passent SUPERSEDED (consultables), un nouveau hash de clôture", async () => {
    // la feuille non publiée est désormais publiée ; la note corrigée : b passe de 6 à 11 à E2
    w.assess.pending = [];
    w.assess.grades = w.assess.grades.map((g) => (g.enrollmentId === students[1]!.enrollmentId && g.curriculumNodeId === id("E2") ? { ...g, score: "11.000" } : g));
    unwrap(await computePeriod(w.deps, w.director, ref));
    unwrap(await lockPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    unwrap(await updateResultsSettings(w.deps, w.director, { requireDeliberation: false }));
    w.audit.clear();
    const out = unwrap(await closePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    expect(out).toMatchObject({ resultsVersion: 2, withoutDeliberation: true });
    expect(out.closureHash).not.toBe(closure.closureHash);
    const rows = await adminRows<{ status: string; n: string }>(db, "SELECT status, count(*)::text AS n FROM results.period_results WHERE academic_period_id = $1 GROUP BY status ORDER BY status", [p.id]);
    expect(rows.find((r) => r.status === "FINAL")?.n).toBe("3");
    expect(rows.some((r) => r.status === "DRAFT" || r.status === "ERROR")).toBe(false);
    expect(Number(rows.find((r) => r.status === "SUPERSEDED")?.n)).toBeGreaterThanOrEqual(3);
    const b = unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: students[1]!.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL }));
    expect(b.header).toMatchObject({ status: "FINAL", decisionCode: "ADMITTED", validated: true });
    expect(b.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E2"))).toMatchObject({ value: "11" });
    const history = await adminRows<{ version: number; status: string; finalized_at: Date | null }>(db, "SELECT version, status, finalized_at FROM results.period_results WHERE enrollment_id = $1 AND status IN ('FINAL','SUPERSEDED') AND finalized_at IS NOT NULL ORDER BY version", [students[1]!.enrollmentId]);
    expect(history.map((h) => h.status)).toEqual(["SUPERSEDED", "FINAL"]);
    expect(history[0]!.finalized_at).not.toBeNull();
    expect(await attempt("UPDATE results.period_results SET status = 'FINAL' WHERE status = 'SUPERSEDED'")).toMatch(/results\.final_immutable/);
    // sans délibération : les décisions proposées ont été confirmées par la clôture elle-même
    const decisions = await adminRows<{ status: string }>(db, "SELECT DISTINCT status FROM results.decisions ORDER BY status");
    expect(decisions.map((x) => x.status)).toEqual(["CONFIRMED", "WITHDRAWN"]);
  });

  it("rattrapage : la réouverture RESIT_SESSION ne libère que la session 2 (les notes de session 1 restent verrouillées)", async () => {
    const s = unwrap(await reopenPeriod(w.deps, w.director, { ...ref, kind: "RESIT_SESSION", reason: "Ouverture de la fenêtre de rattrapage du semestre.", caps: CAPS_ALL }));
    expect(s).toMatchObject({ status: "OPEN", reopenCount: 2, lastReopenKind: "RESIT_SESSION" });
    expect(w.assess.calls).toContain("releaseSession2");
    expect((await stateRow()).reopen_count).toBe(2);
  });

  it("re-pin : réservé à une période ouverte ; sans changement de version il ne fait rien", async () => {
    const r = unwrap(await repinPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    expect(r.changed).toBe(false);
    expect(await repinPeriod(w.deps, w.director, { ...ref, caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
  });
});
