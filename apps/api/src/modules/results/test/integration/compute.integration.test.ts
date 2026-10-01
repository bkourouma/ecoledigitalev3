/**
 * Calcul des résultats par les VRAIES règles du catalogue national (CI-HIGHER-LMD, CI-CLASSIC-SEMESTRE) : valeurs exactes,
 * absence ≠ 0, session 2 qui remplace, rang avec ex æquo, idempotence, versions, erreurs isolées, version épinglée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { computePeriod } from "../../application/compute";
import { getClassMatrix, getEnrollmentResult } from "../../application/reads";
import type { EnrollmentRef } from "../../domain/types";
import { adminOne, adminRows, createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, coefStructure, creditStructure, grade, makeWorld, period, type World } from "../support/world";

describeIntegration("calcul des résultats par les règles (Postgres réel)", () => {
  let db: ResultsTestDb;
  let w: World;

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    await bind(w, "coef-semester@1", "CI-CLASSIC-SEMESTRE");
  });
  afterAll(async () => {
    await db.drop();
  });

  const enroll = (classroomId: string, n: number): EnrollmentRef[] => {
    const list = Array.from({ length: n }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const e of list) w.roster.entries.push({ ...e, active: true, classroomId });
    return list;
  };

  describe("contrat à crédits (CI-HIGHER-LMD)", () => {
    const classroomId = newId();
    const yearId = newId();
    const p = period(newId());
    const built = creditStructure({ classroomId, yearId, period: p, ues: [{ code: "UE1", ecues: [{ code: "E1A", credits: "5" }, { code: "E1B", credits: "3" }] }, { code: "UE2", ecues: [{ code: "E2", credits: "6" }] }] });
    let students: EnrollmentRef[];
    const id = (c: string): string => built.ids.get(c) as string;
    const compute = () => computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p.id });
    const result = async (e: EnrollmentRef) => unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: e.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL }));

    beforeAll(() => {
      w.curriculum.set(built.structure);
      students = enroll(classroomId, 4);
      const [a, b, c] = students as [EnrollmentRef, EnrollmentRef, EnrollmentRef];
      w.assess.grades = [
        // A : tout validé. E1A = 12×0,4 + 14×0,6 = 13,2 ; E1B = 10 ; UE1 = (13,2×5 + 10×3)/8 = 12 ; E2 = 14
        grade(a.enrollmentId, id("E1A"), "12"), grade(a.enrollmentId, id("E1A"), "14", { aggregationGroup: "EXAM" }),
        grade(a.enrollmentId, id("E1B"), "10"), grade(a.enrollmentId, id("E1B"), "10", { aggregationGroup: "EXAM" }),
        grade(a.enrollmentId, id("E2"), "14"), grade(a.enrollmentId, id("E2"), "14", { aggregationGroup: "EXAM" }),
        // B : E2 à 6 → UE2 non validée, session 2 non tentée → à repasser
        grade(b.enrollmentId, id("E1A"), "12"), grade(b.enrollmentId, id("E1A"), "12", { aggregationGroup: "EXAM" }),
        grade(b.enrollmentId, id("E1B"), "12"), grade(b.enrollmentId, id("E1B"), "12", { aggregationGroup: "EXAM" }),
        grade(b.enrollmentId, id("E2"), "6"), grade(b.enrollmentId, id("E2"), "6", { aggregationGroup: "EXAM" }),
        // C : absent à l'examen de E1A (pas de zéro !) ; E1B et E2 notés
        grade(c.enrollmentId, id("E1A"), "15"), grade(c.enrollmentId, id("E1A"), null, { aggregationGroup: "EXAM" }),
        grade(c.enrollmentId, id("E1B"), "13"), grade(c.enrollmentId, id("E1B"), "13", { aggregationGroup: "EXAM" }),
        grade(c.enrollmentId, id("E2"), "11"), grade(c.enrollmentId, id("E2"), "11", { aggregationGroup: "EXAM" }),
        // D : aucune note
      ];
    });

    it("calcule la classe : valeurs exactes décimales, statuts par code, décision par règle", async () => {
      const report = unwrap(await compute());
      expect(report).toMatchObject({ computed: 4, created: 4, unchanged: 0, errors: 0, contractId: "credit-semester@1", status: "OPEN" });

      const a = await result(students[0]!);
      expect(a.header).toMatchObject({ status: "DRAFT", version: 1, contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", decisionCode: "ADMITTED", decisionOutcome: "ADMITTED", mentionCode: "FAIRLY_GOOD", validated: true, creditsAcquired: "14.00", creditsRequired: "14.00", rank: 1, cohortSize: 3 });
      expect(a.header.average).toMatch(/^12\.857142/);
      expect(a.header.averageDisplay).toBe("12.86");
      const e1a = a.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E1A"))!;
      expect(e1a).toMatchObject({ value: "13.2", displayValue: "13.20", validated: true, statusCode: "VALIDATED", sessionObtained: 1, resitEligible: false });
      const ue1 = a.lines.find((l) => l.level === "UE" && l.curriculumNodeId === id("UE1"))!;
      expect(ue1).toMatchObject({ value: "12", validated: true, statusCode: "VALIDATED", credits: "8.00", sessionObtained: 1 });

      const b = await result(students[1]!);
      expect(b.header).toMatchObject({ decisionCode: "RESIT", decisionOutcome: "RESIT", validated: false, creditsAcquired: "8.00", creditsRequired: "14.00" });
      expect(b.lines.find((l) => l.level === "UE" && l.curriculumNodeId === id("UE2"))).toMatchObject({ validated: false, statusCode: "RESIT" });
      expect(b.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E2"))).toMatchObject({ value: "6", validated: false, statusCode: "INSUFFICIENT", resitEligible: true });
    });

    it("une absence n'est PAS un zéro : sans note d'examen, l'ECUE n'a pas de note et l'UE n'est pas validée ; sans aucune note, pas de moyenne", async () => {
      const c = await result(students[2]!);
      const e1a = c.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E1A"))!;
      expect(e1a.value).toBeNull();
      expect(e1a.statusCode).toBe("PENDING");
      expect(c.lines.find((l) => l.level === "UE" && l.curriculumNodeId === id("UE1"))).toMatchObject({ validated: false });
      expect(c.header.decisionCode).toBe("RESIT");

      const d = await result(students[3]!);
      expect(d.header).toMatchObject({ average: null, averageDisplay: null, rank: null, mentionCode: "PENDING", decisionCode: null, decisionOutcome: "PENDING", validated: null });
      expect(d.header.summary).toMatchObject({ pending: true });
    });

    it("le rang ne porte que sur les valeurs non nulles de la classe (D n'est pas classé)", async () => {
      const m = unwrap(await getClassMatrix(w.deps, w.director, { classroomId, academicPeriodId: p.id, caps: CAPS_ALL }));
      const ranks = new Map(m.rows.map((r) => [r.header.enrollmentId, [r.header.rank, r.header.cohortSize]]));
      expect(ranks.get(students[3]!.enrollmentId)).toEqual([null, null]);
      expect([...ranks.values()].filter(([r]) => r !== null)).toHaveLength(3);
      expect(m.rows.every((r) => r.header.cohortSize === null || r.header.cohortSize === 3)).toBe(true);
      expect(m.decisions.map((d) => d.kind)).toEqual(expect.arrayContaining(["SEMESTER_STATUS"]));
      expect(m.decisions.every((d) => d.status === "PROPOSED")).toBe(true);
    });

    it("la version de règle est ÉPINGLÉE sur l'état de la période (jeu, version, empreinte)", async () => {
      const m = unwrap(await getClassMatrix(w.deps, w.director, { classroomId, academicPeriodId: p.id, caps: CAPS_ALL }));
      expect(m.state).toMatchObject({ status: "OPEN", contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1, scope: "PERIOD" });
      expect(m.state.definitionHash).toMatch(/^[0-9a-f]{64}$/);
      for (const r of m.rows) expect(r.header).toMatchObject({ ruleVersionId: m.state.ruleVersionId, definitionHash: m.state.definitionHash });
    });

    it("recalcul IDEMPOTENT : sans changement d'entrée, aucune nouvelle version (AC8.2)", async () => {
      const again = unwrap(await compute());
      expect(again).toMatchObject({ created: 0, unchanged: 4, rankUpdated: 0 });
      expect((await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM results.period_results WHERE academic_period_id = $1", [p.id])).n).toBe("4");
    });

    it("une note publiée de plus ⇒ nouvelle version DRAFT (l'ancienne est SUPERSEDED) ; seul l'élève concerné change, un classement est mis à jour en place", async () => {
      const before = await result(students[1]!);
      // B repasse E2 : la session 2 REMPLACE la session 1 (12 au lieu de 6) → UE2 validée
      w.assess.grades.push(grade(students[1]!.enrollmentId, id("E2"), "12", { aggregationGroup: "EXAM", sessionNo: 2 }));
      const report = unwrap(await compute());
      expect(report.created).toBe(1);
      expect(report.unchanged + report.rankUpdated).toBe(3);
      const after = await result(students[1]!);
      expect(after.header.version).toBe(before.header.version + 1);
      expect(after.header).toMatchObject({ status: "DRAFT", decisionCode: "ADJOURNED", decisionOutcome: "ADJOURNED", validated: false });
      expect(after.lines.find((l) => l.level === "UE" && l.curriculumNodeId === id("UE2"))).toMatchObject({ validated: false, statusCode: "DEBT" });
      expect(after.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === id("E2"))).toMatchObject({ value: "9.6", validated: false, sessionObtained: null, resitEligible: false });
      const rows = await adminRows<{ version: number; status: string }>(db, "SELECT version, status FROM results.period_results WHERE enrollment_id = $1 ORDER BY version", [students[1]!.enrollmentId]);
      expect(rows).toEqual([{ version: 1, status: "SUPERSEDED" }, { version: 2, status: "DRAFT" }]);
    });

    it("événements `results.period_result.computed` : un par nouvelle version, sans aucune note", async () => {
      const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'results.period_result.computed'");
      expect(ev.length).toBe(5);
      expect(JSON.stringify(ev)).not.toMatch(/average|score|"12|13\.2/);
      expect(ev[0]!.payload).toMatchObject({ v: 1, academicPeriodId: p.id });
    });

    it("aucun contexte ne contient d'identité d'élève : les entrées conservées sont anonymes et déterministes", async () => {
      const row = await adminOne<{ inputs_hash: string }>(db, "SELECT inputs_hash FROM results.period_results WHERE enrollment_id = $1 AND status = 'DRAFT'", [students[0]!.enrollmentId]);
      expect(row.inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("contrat à coefficients (CI-CLASSIC-SEMESTRE)", () => {
    const classroomId = newId();
    const yearId = newId();
    const p1 = period(newId(), { rankInYear: 1 });
    const built = coefStructure({ classroomId, yearId, period: p1, subjects: [{ code: "MATH", coef: "3", section: "SCI" }, { code: "FRAN", coef: "2", section: "LET" }, { code: "SPORT", coef: "1", section: "LET", counts: false }] });
    let students: EnrollmentRef[];
    const id = (c: string): string => built.ids.get(c) as string;

    beforeAll(() => {
      w.curriculum.set(built.structure);
      students = enroll(classroomId, 3);
      w.assess.grades = [
        // X : MATH = moyenne de 10 et 16 (poids 1) = 13 ; FRAN = 11 → (13×3 + 11×2)/5 = 12,2
        grade(students[0]!.enrollmentId, id("MATH"), "10"), grade(students[0]!.enrollmentId, id("MATH"), "16"), grade(students[0]!.enrollmentId, id("FRAN"), "11"),
        // Y : mêmes moyennes → ex æquo avec X
        grade(students[1]!.enrollmentId, id("MATH"), "13"), grade(students[1]!.enrollmentId, id("FRAN"), "11"),
        // Z : MATH 8 ; FRAN absent (pas de zéro) → moyenne = MATH seul = 8
        grade(students[2]!.enrollmentId, id("MATH"), "8"), grade(students[2]!.enrollmentId, id("FRAN"), null),
      ];
    });

    it("moyenne de matière, moyenne pondérée, sections, mention, décision, ex æquo au rang (compétition)", async () => {
      unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p1.id }));
      const x = unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: students[0]!.enrollmentId, academicPeriodId: p1.id, caps: CAPS_ALL }));
      expect(x.header).toMatchObject({ average: "12.2", averageDisplay: "12.20", mentionCode: "GOOD", decisionCode: "PERIOD_VALIDATED", decisionOutcome: "ADMITTED", rank: 1, cohortSize: 3 });
      expect(x.lines.find((l) => l.level === "SUBJECT" && l.curriculumNodeId === id("MATH"))).toMatchObject({ value: "13", coefficient: "3.000", rank: 1 });
      const y = unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: students[1]!.enrollmentId, academicPeriodId: p1.id, caps: CAPS_ALL }));
      expect(y.header.rank).toBe(1); // ex æquo : le même rang
      const z = unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: students[2]!.enrollmentId, academicPeriodId: p1.id, caps: CAPS_ALL }));
      expect(z.header).toMatchObject({ average: "8", rank: 3, decisionCode: "REINFORCEMENT_ADVISED", decisionOutcome: "OTHER", mentionCode: "PASSABLE" });
      expect(z.lines.find((l) => l.level === "SUBJECT" && l.curriculumNodeId === id("FRAN"))?.value).toBeNull();
      // une matière non comptée dans la moyenne apparaît mais n'y entre pas
      expect(z.lines.find((l) => l.level === "SUBJECT" && l.curriculumNodeId === id("SPORT"))).toMatchObject({ value: null });
      const period = x.lines.find((l) => l.level === "PERIOD")!;
      expect((period.outputs as any).sections.SCI).toMatchObject({ value: "13", rank: 1 });
    });

    it("un coefficient absent bloque le calcul de toute la classe (jamais `coef || 1`)", async () => {
      const room = newId();
      const bad = coefStructure({ classroomId: room, yearId, period: period(newId()), subjects: [{ code: "X", coef: null }] });
      w.curriculum.set(bad.structure);
      w.roster.entries.push({ enrollmentId: newId(), studentId: newId(), active: true, classroomId: room });
      const r = await computePeriod(w.deps, w.director, { classroomId: room, academicPeriodId: bad.structure.period.id });
      expect(r).toMatchObject({ ok: false, error: { code: "results.curriculum_incomplete" } });
    });

    it("aucune règle liée ⇒ calcul refusé avec un diagnostic (jamais de valeur par défaut)", async () => {
      const other = await makeWorld(db, { seedRules: false });
      const room = newId();
      const s = coefStructure({ classroomId: room, yearId, period: period(newId()), subjects: [{ code: "M", coef: "1" }] });
      other.curriculum.set(s.structure);
      other.roster.entries.push({ enrollmentId: newId(), studentId: newId(), active: true, classroomId: room });
      const r = await computePeriod(other.deps, other.director, { classroomId: room, academicPeriodId: s.structure.period.id });
      expect(r).toMatchObject({ ok: false, error: { code: "results.no_active_ruleset" } });
      expect((r as any).error.details).toMatchObject({ contractId: "coef-semester@1" });
    });
  });
});
