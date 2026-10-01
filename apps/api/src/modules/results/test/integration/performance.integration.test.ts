/**
 * Performance du calcul (AC4.5) : 60 étudiants × 12 matières ≤ 5 s (phase individuelle + rang + persistance, VRAIES règles, Postgres
 * réel) ; 1 000 étudiants sans erreur. Les chronos sont affichés pour le rapport.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { computePeriod } from "../../application/compute";
import { closePeriod, lockPeriod } from "../../application/lifecycle";
import { updateResultsSettings } from "../../application/governance";
import type { EnrollmentRef, GradeFact } from "../../domain/types";
import { createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, creditStructure, grade, makeWorld, period, type World } from "../support/world";

describeIntegration("performance du calcul des résultats (règles réelles, Postgres réel)", () => {
  let db: ResultsTestDb;
  let w: World;

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    unwrap(await updateResultsSettings(w.deps, w.director, { requireDeliberation: false }));
  });
  afterAll(async () => {
    await db.drop();
  });

  /** Classe de `n` étudiants, 4 UE × 3 ECUE (12 matières), 2 devoirs + 1 examen par matière. */
  function seedClass(n: number) {
    const classroomId = newId();
    const p = period(newId());
    const ues = Array.from({ length: 4 }, (_, u) => ({ code: `UE${u + 1}`, ecues: Array.from({ length: 3 }, (_, e) => ({ code: `E${u + 1}${e + 1}`, credits: String(2 + ((u + e) % 3)) })) }));
    const built = creditStructure({ classroomId, yearId: newId(), period: p, ues });
    w.curriculum.set(built.structure);
    const students: EnrollmentRef[] = Array.from({ length: n }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const s of students) w.roster.entries.push({ ...s, active: true, classroomId });
    const grades: GradeFact[] = [];
    students.forEach((s, i) => {
      for (const ue of ues) {
        for (const e of ue.ecues) {
          const base = 6 + ((i * 7 + e.code.charCodeAt(1) * 3 + e.code.charCodeAt(2)) % 13); // notes variées entre 6 et 18
          const node = built.ids.get(e.code) as string;
          grades.push(grade(s.enrollmentId, node, String(base)), grade(s.enrollmentId, node, String(base + 1), { assessedOn: "2025-12-05" }), grade(s.enrollmentId, node, String(Math.min(20, base + 2)), { aggregationGroup: "EXAM" }));
        }
      }
    });
    return { classroomId, p, students, grades };
  }

  it("AC4.5 : 60 étudiants × 12 matières calculés, classés et persistés en ≤ 5 s ; recalcul sans changement quasi instantané", async () => {
    const { classroomId, p, grades, students } = seedClass(60);
    w.assess.grades = grades;
    const t0 = performance.now();
    const report = unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p.id }));
    const first = performance.now() - t0;
    expect(report).toMatchObject({ computed: 60, created: 60, errors: 0 });
    expect(first).toBeLessThan(5000);

    const t1 = performance.now();
    const again = unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p.id }));
    const second = performance.now() - t1;
    expect(again).toMatchObject({ created: 0, unchanged: 60 });

    // clôture : recalcul complet AVEC trace d'explicabilité + persistance des lignes FINAL
    unwrap(await lockPeriod(w.deps, w.director, { classroomId, academicPeriodId: p.id, caps: CAPS_ALL }));
    const t2 = performance.now();
    const closed = unwrap(await closePeriod(w.deps, w.director, { classroomId, academicPeriodId: p.id, caps: CAPS_ALL }));
    const closing = performance.now() - t2;
    expect(closed.resultsCount).toBe(60);
    expect(closing).toBeLessThan(15_000);
    console.log(`[perf] 60 × 12 : calcul ${first.toFixed(0)} ms, recalcul sans changement ${second.toFixed(0)} ms, clôture FINAL avec trace ${closing.toFixed(0)} ms (${students.length} étudiants, ${grades.length} notes)`);
  });

  it("1 000 étudiants × 12 matières : aucune erreur, rangs cohérents (cohorte de 1 000)", async () => {
    const { classroomId, p, grades } = seedClass(1000);
    w.assess.grades = grades;
    const t0 = performance.now();
    const report = unwrap(await computePeriod(w.deps, w.director, { classroomId, academicPeriodId: p.id }));
    const elapsed = performance.now() - t0;
    expect(report).toMatchObject({ computed: 1000, created: 1000, errors: 0 });
    const ranked = await db.admin.query("SELECT count(*)::int AS n, max(cohort_size)::int AS c, min(rank)::int AS r FROM results.period_results WHERE classroom_id = $1 AND status = 'DRAFT'", [classroomId]);
    expect(ranked.rows[0]).toMatchObject({ n: 1000, c: 1000, r: 1 });
    expect(elapsed).toBeLessThan(120_000);
    console.log(`[perf] 1 000 × 12 : calcul ${elapsed.toFixed(0)} ms (${grades.length} notes)`);
  });
});
