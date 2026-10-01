import type { FastifyInstance } from "fastify";
import { semesterAveragesRoutes } from "../../../apps/api/src/routes/semester-averages";
import type { ClassicSetup, ClassicStep, Scenario } from "../scenarios/types";
import { buildLegacyApp, call, type TestAuth } from "./app";
import type { ScenarioDatabase } from "./db";
import { DefectCollector } from "./defects";
import { detectClassicDefects } from "./oracle-classic";
import { createNormalizer } from "./normalize";
import { pdfSink } from "./pdf-sink";
import { seedBase, seedClassic, type SeedContext } from "./seeder";

/**
 * Exécution d'un scénario de la pile CLASSIQUE sur le VRAI plugin `routes/semester-averages.ts`
 * (montée par `inject`, auth de test) : saisie des moyennes (PUT /matrix), lecture (GET /matrix) et bulletins
 * (POST /report-cards/pdf). Voir pdf-sink.ts pour le seul élément remplacé (le rendu PDF).
 */
export interface ClassicRun {
  data: unknown;
  defects: DefectCollector;
}

export async function runClassicScenario(db: ScenarioDatabase, scenario: Scenario): Promise<ClassicRun> {
  if (!scenario.classic) throw new Error(`Le scénario ${scenario.meta.name} n'a pas de partie « classic »`);
  const { setup, steps } = scenario.classic;
  const ctx = await seedBase(db.pool, scenario);
  await seedClassic(ctx, setup);
  return runClassicSteps(db, ctx, setup, steps, scenario);
}

export async function runClassicSteps(
  db: ScenarioDatabase,
  ctx: SeedContext,
  setup: ClassicSetup,
  steps: ClassicStep[],
  scenario: Scenario,
): Promise<ClassicRun> {
  const app: FastifyInstance = await buildLegacyApp(db.pool, async (a) => {
    await a.register(semesterAveragesRoutes, { prefix: "/api/v1/semester-averages" });
  });
  const auth: TestAuth = { tenantId: ctx.tenantId, userId: ctx.adminUserId, roles: ["admin"] };
  const defects = new DefectCollector();
  const out: Record<string, unknown> = {};
  let n = 0;
  try {
    for (const step of steps) {
      n++;
      const label = `${String(n).padStart(2, "0")}-${step.label}`;
      out[label] = await performStep(app, auth, ctx, setup, scenario, step, label, defects, db);
    }
  } finally {
    await app.close();
  }
  const { normalize } = createNormalizer(ctx.ids);
  return { data: normalize({ steps: out }), defects };
}

async function performStep(
  app: FastifyInstance,
  auth: TestAuth,
  ctx: SeedContext,
  setup: ClassicSetup,
  scenario: Scenario,
  step: ClassicStep,
  label: string,
  defects: DefectCollector,
  db: ScenarioDatabase,
): Promise<unknown> {
  const { ids } = ctx;
  switch (step.do) {
    case "matrix": {
      const r = await call(app, auth, "GET", `/api/v1/semester-averages/matrix?classId=${ids.id("class", step.class)}&periodId=${ids.id("period", step.period)}`);
      return r;
    }
    case "put-matrix": {
      const r = await call(app, auth, "PUT", "/api/v1/semester-averages/matrix", {
        classId: ids.id("class", step.class),
        periodId: ids.id("period", step.period),
        cells: step.cells.map((c) => ({ studentId: ids.id("student", c.student), courseId: ids.id("course", c.course), average: c.value })),
        attendance: (step.absences ?? []).map((a) => ({
          studentId: ids.id("student", a.student),
          absenceHours: a.absenceHours,
          justifiedHours: a.justifiedHours,
        })),
      });
      return r;
    }
    case "report": {
      pdfSink.reportCards.length = 0;
      const r = await call(app, auth, "POST", "/api/v1/semester-averages/report-cards/pdf", {
        classId: ids.id("class", step.class),
        periodId: ids.id("period", step.period),
        ...(step.student ? { studentId: ids.id("student", step.student) } : {}),
      });
      const docs = pdfSink.reportCards.pop() as any[] | undefined;
      if (!docs) return { status: r.status, error: r.body };
      const documents: Record<string, unknown> = {};
      for (const d of docs) documents[ids.key(d.student.studentId) ?? d.student.studentId] = d;
      const result = { status: r.status, documentCount: docs.length, documents };

      // Oracle : moyennes saisies relues en base (ENTRÉES, pas des résultats du legacy).
      const inputs = await db.pool.query(
        `SELECT student_id, course_id, academic_year_period_id AS period_id, average::text AS average
         FROM student_period_course_averages WHERE tenant_id = $1 AND class_id = $2`,
        [ctx.tenantId, ids.id("class", step.class)],
      );
      detectClassicDefects(defects, {
        ctx,
        setup,
        classKey: step.class,
        periodKey: step.period,
        stepPath: `steps.${label}`,
        documents,
        inputs: inputs.rows.map((row) => ({
          student: ids.key(row.student_id)!,
          course: ids.key(row.course_id)!,
          period: ids.key(row.period_id)!,
          value: row.average as string,
        })),
      });
      return result;
    }
  }
}
