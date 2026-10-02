/**
 * Notes complètes puis résultats de période calculés par les jeux de règles de DÉMONSTRATION (`placeholder`) liés par le modèle
 * de pack : aucune règle officielle n'est inventée ; chaque document dérivé porte la mention « règles de démonstration ».
 *
 * Secondaire / Primaire / Supérieur : mêmes gestes (devoir et composition par matière, circuit de validation, verrouillage et
 * clôture de la première période par la direction) ; seuls les jeux de règles liés diffèrent selon le pack.
 */
import { at, waitFor, type DemoKit } from "./kit";

interface AssessmentType {
  id: string;
  code: string;
}

interface GradePlan {
  title: string;
  /** `first` : devoir ; `second` : composition (ou examen). */
  type: "first" | "second";
  /** Indices des matières évaluées. */
  nodes: number[];
  kind: number;
}

/** Note déterministe (0-20, une décimale au plus) : fonction de (matière, élève, rang du contrôle) seulement. */
export const scoreFor = (subject: number, student: number, kind: number, seed: number): string => {
  const raw = 6 + ((subject * 7 + student * 5 + kind * 3 + seed) % 13) + ((student * 3 + kind) % 2) * 0.5;
  return String(Math.min(19.5, raw));
};

/** Notes de la première période : « Premier contrôle » complété sur toutes les matières + une composition partout. */
export async function publishFullGrades(kit: DemoKit): Promise<void> {
  const subjects = kit.ctx.data.subjects.map((_, i) => i);
  await publishGrades(kit, 0, [
    { title: "Premier contrôle (suite)", type: "first", nodes: subjects.slice(2), kind: 0 },
    { title: "Composition", type: "second", nodes: subjects, kind: 1 },
  ]);
}

/** Notes de la seconde période (un devoir par matière), pour un conseil tenu sur une période verrouillée. */
export async function publishSecondPeriodGrades(kit: DemoKit): Promise<void> {
  const subjects = kit.ctx.data.subjects.map((_, i) => i);
  await publishGrades(kit, 1, [{ title: "Devoir de la période 2", type: "first", nodes: subjects, kind: 2 }]);
}

export async function lockPeriod(kit: DemoKit, periodIndex: number): Promise<void> {
  const { ctx } = kit;
  const locked = await ctx.directeur.post(`/api/v1/results/classrooms/${ctx.classroomId}/periods/${at(ctx.periodIds, periodIndex, "période")}/lock`, {});
  if (locked.body.status !== "GRADING_LOCKED") throw new Error(`Verrouillage inattendu : ${JSON.stringify(locked.body).slice(0, 300)}`);
}

async function publishGrades(kit: DemoKit, periodIndex: number, plans: GradePlan[]): Promise<void> {
  const { ctx } = kit;
  const { data, teacher, pedago, directeur } = ctx;
  const types = await waitFor(
    async () => {
      const r = await teacher.get("/api/v1/assess/assessment-types");
      const items = r.body.items as AssessmentType[];
      return items.length > 0 ? items : false;
    },
    { label: "types d'évaluation", timeoutMs: 60_000 },
  );
  const byCode = new Map(types.map((t) => [t.code, t.id] as const));
  const firstType = byCode.get("DEVOIR") ?? at(types, 0, "type d'évaluation").id;
  const secondType = byCode.get("COMPOSITION") ?? byCode.get("EXAMEN") ?? firstType;
  const periods = (await ctx.owner.get(`/api/v1/academic/years/${ctx.yearId}/periods`)).body.items as Array<{ id: string; startsOn: string }>;
  const period = periods.find((p) => p.id === at(ctx.periodIds, periodIndex, "période"));
  if (!period) throw new Error("Période introuvable.");
  const todayIso = new Date().toISOString().slice(0, 10);
  const candidate = new Date(Date.parse(`${period.startsOn}T00:00:00Z`) + 12 * 86_400_000).toISOString().slice(0, 10);
  const assessedOn = candidate > todayIso ? todayIso : candidate;

  const active = ctx.students.slice(0, data.paidCount);
  for (const plan of plans) {
    if (plan.nodes.length === 0) continue;
    const created = await teacher.post(
      "/api/v1/assess/assessments/bulk",
      {
        typeId: plan.type === "first" ? firstType : secondType,
        academicPeriodId: at(ctx.periodIds, periodIndex, "période"),
        title: plan.title,
        assessedOn,
        targets: plan.nodes.map((i) => ({ classroomId: ctx.classroomId, curriculumNodeId: at(ctx.teachable, i, "nœud évaluable") })),
      },
      201,
    );
    const items = created.body.items as Array<{ id: string }>;
    for (const [n, assessment] of items.entries()) {
      const subject = at(plan.nodes, n, "matière");
      const entries = active.map((s, i) => ({ enrollmentId: s.enrollmentId, score: scoreFor(subject, i, plan.kind, data.seed) }));
      await teacher.put(`/api/v1/assess/assessments/${assessment.id}/grades`, { entries }, 200, { "idempotency-key": `demo-${data.slug}-grades-${plan.kind}-${subject}` });
      await teacher.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "SUBMITTED" });
      await pedago.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "REVIEWED" });
      await pedago.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "APPROVED" });
      await directeur.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "PUBLISHED" });
      kit.count("assessments");
      kit.count("grades", entries.length);
    }
  }
}

/** Verrouille puis clôture la première période : le moteur de règles calcule les résultats FINAUX (jeu de démonstration). */
export async function closeFirstPeriod(kit: DemoKit): Promise<void> {
  const { ctx } = kit;
  await ctx.owner.put("/api/v1/results/settings", { requireDeliberation: false });
  await lockPeriod(kit, 0);
  const closed = await ctx.directeur.post(`/api/v1/results/classrooms/${ctx.classroomId}/periods/${at(ctx.periodIds, 0, "période")}/close`, {});
  if (closed.body.state?.status !== "CLOSED") throw new Error(`Clôture inattendue : ${JSON.stringify(closed.body).slice(0, 300)}`);
  kit.count("periodResults", Number(closed.body.resultsCount ?? 0));
  kit.note(`Résultats de la période 1 calculés par le jeu de règles de DÉMONSTRATION lié au pack (${Number(closed.body.resultsCount ?? 0)} élèves) : aucune règle officielle.`);
}
