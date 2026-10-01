/**
 * Résultat d'ANNÉE : dérivé des résultats FINAL des périodes, par les règles de l'étape « année » (contrat à crédits) ou par la ligne
 * `YEAR` du dernier semestre (contrat à coefficients). Tant qu'une période n'est pas clôturée : `complete: false`, jamais de moyenne partielle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { updateResultsSettings } from "../../application/governance";
import { closePeriod, lockPeriod, reopenPeriod } from "../../application/lifecycle";
import { getYearResult } from "../../application/year";
import type { ClassStructure, EnrollmentRef } from "../../domain/types";
import { createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, coefStructure, creditStructure, grade, makeWorld, period, type World } from "../support/world";

describeIntegration("résultat d'année (Postgres réel + règles réelles)", () => {
  let db: ResultsTestDb;
  let w: World;

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    await bind(w, "coef-semester@1", "CI-CLASSIC-SEMESTRE");
    unwrap(await updateResultsSettings(w.deps, w.director, { requireDeliberation: false }));
  });
  afterAll(async () => {
    await db.drop();
  });

  const enroll = (classroomId: string, n: number): EnrollmentRef[] => {
    const list = Array.from({ length: n }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const e of list) w.roster.entries.push({ ...e, active: true, classroomId });
    return list;
  };
  const close = async (classroomId: string, periodId: string) => {
    const ref = { classroomId, academicPeriodId: periodId };
    unwrap(await lockPeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
    return unwrap(await closePeriod(w.deps, w.director, { ...ref, caps: CAPS_ALL }));
  };
  const yearOf = async (e: EnrollmentRef, yearId: string) => unwrap(await getYearResult(w.deps, w.director, { enrollmentId: e.enrollmentId, academicYearId: yearId, caps: CAPS_ALL }));

  describe("contrat à crédits (CI-HIGHER-LMD)", () => {
    const classroomId = newId();
    const yearId = newId();
    const p1 = period(newId(), { rankInYear: 1, startsOn: "2025-09-15", endsOn: "2026-01-31" });
    const p2 = period(newId(), { rankInYear: 2, isSecondSemester: true, startsOn: "2026-02-01", endsOn: "2026-06-30" });
    let students: EnrollmentRef[];
    let s1: ReturnType<typeof creditStructure>;
    let s2: ReturnType<typeof creditStructure>;

    beforeAll(() => {
      s1 = creditStructure({ classroomId, yearId, period: p1, ues: [{ code: "UE1", ecues: [{ code: "E1", credits: "4" }] }] });
      s2 = creditStructure({ classroomId, yearId, period: p2, ues: [{ code: "UE2", ecues: [{ code: "E2", credits: "6" }] }] });
      const yearPeriods = [p1, p2];
      w.curriculum.set({ ...s1.structure, yearPeriods } as ClassStructure);
      w.curriculum.set({ ...s2.structure, yearPeriods } as ClassStructure);
      students = enroll(classroomId, 3);
    });

    const publish = (periodGrades: Array<[EnrollmentRef, string, string | null, string | null]>, ids: Map<string, string>) =>
      periodGrades.flatMap(([e, code, dev, exam]) => [
        ...(dev === null ? [] : [grade(e.enrollmentId, ids.get(code) as string, dev)]),
        ...(exam === null ? [] : [grade(e.enrollmentId, ids.get(code) as string, exam, { aggregationGroup: "EXAM" })]),
      ]);

    it("aucune période clôturée : année incomplète, périodes manquantes listées, aucune moyenne partielle", async () => {
      w.assess.grades = publish([[students[0]!, "E1", "14", "14"], [students[1]!, "E1", "8", "8"], [students[2]!, "E1", "12", "12"]], s1.ids);
      const { computePeriod } = await import("../../application/compute");
      unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p1.id }));
      const y = await yearOf(students[0]!, yearId);
      expect(y).toMatchObject({ complete: false, average: null, rank: null, validated: null, contractId: "credit-semester@1" });
      expect(y.missingPeriodIds).toEqual([p1.id, p2.id]);
    });

    it("S1 clôturé, S2 non : toujours incomplète (seule S2 manque), les valeurs de S1 sont rappelées", async () => {
      await close(classroomId, p1.id);
      const y = await yearOf(students[0]!, yearId);
      expect(y.complete).toBe(false);
      expect(y.missingPeriodIds).toEqual([p2.id]);
      expect(y.periods[0]).toMatchObject({ final: true, average: "14", validated: true });
      expect(y.periods[1]).toMatchObject({ final: false, average: null });
    });

    it("S2 clôturé : moyenne annuelle pondérée par les crédits de semestre, validation d'année (toutes les UE), mention du cycle, rang sur la classe", async () => {
      w.assess.grades = [
        ...publish([[students[0]!, "E1", "14", "14"], [students[1]!, "E1", "8", "8"], [students[2]!, "E1", "12", "12"]], s1.ids),
        // C absent à l'examen de S2 : pas de moyenne de semestre, jamais 0
        ...publish([[students[0]!, "E2", "13", "13"], [students[1]!, "E2", "15", "15"], [students[2]!, "E2", "13", null]], s2.ids),
      ];
      const { computePeriod } = await import("../../application/compute");
      unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p2.id }));
      await close(classroomId, p2.id);

      const a = await yearOf(students[0]!, yearId);
      expect(a).toMatchObject({ complete: true, missingPeriodIds: [], average: "13.4", validated: true, rank: 1, cohortSize: 3, mentionCode: "FAIRLY_GOOD", ruleSetCode: "CI-HIGHER-LMD" });
      // décimaux exacts en chaînes (la mise en forme des zéros terminaux n'est pas contractuelle : on compare les valeurs)
      expect(Number(a.averageDisplay)).toBe(13.4);
      expect([Number(a.creditsAcquired), Number(a.creditsRequired)]).toEqual([10, 10]);
      expect(a.definitionHash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.inputsHash).toMatch(/^[0-9a-f]{64}$/);
      // B : (8×4 + 15×6)/10 = 12,2 ; S1 non validé ⇒ année non validée (aucune compensation entre UE)
      const b = await yearOf(students[1]!, yearId);
      expect(b).toMatchObject({ average: "12.2", validated: false, rank: 2 });
      expect([Number(b.creditsAcquired), Number(b.creditsRequired)]).toEqual([6, 10]);
      // C : S2 sans moyenne ⇒ la moyenne annuelle ne porte que sur S1 (12), pas de zéro ; année non validée
      const c = await yearOf(students[2]!, yearId);
      expect(c).toMatchObject({ average: "12", validated: false, rank: 3 });
      expect(c.periods[1]).toMatchObject({ final: true, average: null });
    });

    it("reproductible : même résultat tant que les FINAL ne changent pas ; une période réouverte garde son FINAL officiel jusqu'à son remplacement", async () => {
      const before = await yearOf(students[0]!, yearId);
      const again = await yearOf(students[0]!, yearId);
      expect(again).toEqual(before);
      unwrap(await reopenPeriod(w.deps, w.director, { classroomId, academicPeriodId: p2.id, kind: "CORRECTION", reason: "Erreur de saisie constatée en conseil.", caps: CAPS_ALL }));
      // le FINAL de S2 reste le résultat officiel tant qu'il n'est pas remplacé : l'année reste calculable
      expect((await yearOf(students[0]!, yearId)).complete).toBe(true);
    });

    it("droit de lecture requis ; inscription sans résultat ⇒ 404", async () => {
      expect(await getYearResult(w.deps, w.director, { enrollmentId: students[0]!.enrollmentId, academicYearId: yearId, caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
      expect(await getYearResult(w.deps, w.director, { enrollmentId: newId(), academicYearId: yearId, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.result_not_found" } });
    });
  });

  describe("contrat à coefficients (CI-CLASSIC-SEMESTRE)", () => {
    const classroomId = newId();
    const yearId = newId();
    const p1 = period(newId(), { rankInYear: 1, startsOn: "2025-09-15", endsOn: "2026-01-31" });
    const p2 = period(newId(), { rankInYear: 2, isSecondSemester: true, startsOn: "2026-02-01", endsOn: "2026-06-30" });
    let students: EnrollmentRef[];

    it("l'année vient de la ligne YEAR du 2ᵉ semestre : (S1 + 2·S2)/3, décision de fin d'année, rang annuel", async () => {
      const a = coefStructure({ classroomId, yearId, period: p1, subjects: [{ code: "MATH", coef: "3" }] });
      const b = coefStructure({ classroomId, yearId, period: { ...p2 }, subjects: [{ code: "MATH", coef: "3" }], firstPeriodId: p1.id });
      b.structure = { ...b.structure, nodes: a.structure.nodes } as ClassStructure;
      const yearPeriods = [p1, p2];
      w.curriculum.set({ ...a.structure, yearPeriods } as ClassStructure);
      w.curriculum.set({ ...b.structure, yearPeriods } as ClassStructure);
      students = enroll(classroomId, 2);
      const math = a.ids.get("MATH") as string;
      const { computePeriod } = await import("../../application/compute");

      w.assess.grades = [grade(students[0]!.enrollmentId, math, "11"), grade(students[1]!.enrollmentId, math, "7")];
      unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p1.id }));
      await close(classroomId, p1.id);
      w.assess.grades = [grade(students[0]!.enrollmentId, math, "20"), grade(students[1]!.enrollmentId, math, "8")];
      unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p2.id }));
      expect((await yearOf(students[0]!, yearId)).complete).toBe(false);
      await close(classroomId, p2.id);

      const y0 = await yearOf(students[0]!, yearId);
      expect(y0).toMatchObject({ complete: true, contractId: "coef-semester@1", average: "17", yearDecisionCode: "PROMOTED", rank: 1 });
      const y1 = await yearOf(students[1]!, yearId);
      expect(y1.average).toMatch(/^7\.666666/); // (7 + 2×8)/3
      expect(y1).toMatchObject({ yearDecisionCode: "REPEAT", rank: 2 });
    });
  });
});
