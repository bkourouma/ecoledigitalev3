/**
 * Examens (pack Secondary) : type d'examen de DÉMONSTRATION (donnée marquée `placeholder` : BEPC / BAC ne sont PAS livrés),
 * session officielle (candidats depuis la classe, éligibilité évaluée par les faits d'`academic` et la règle liée) et session
 * d'examen BLANC calculée par la règle de démonstration à partir d'une évaluation publiée (jamais de document officiel).
 */
import type { Actor } from "../actors";
import { at, type DemoKit } from "./kit";

export async function seedExams(kit: DemoKit, input: { examens: Actor; examLevel: string; gradeLevelCode: string }): Promise<void> {
  const { ctx } = kit;
  const { owner, teacher, pedago, directeur } = ctx;
  const ex = input.examens;
  const t = await ex.post(
    "/api/v1/examinations/exam-types",
    { code: "EXAM_DEMO", label: `Examen de démonstration (${input.gradeLevelCode})`, educationLevelCode: input.examLevel, gradeLevelCode: input.gradeLevelCode, sourceKind: "placeholder" },
    201,
  );
  const typeId = t.body.id as string;
  await ex.post(`/api/v1/examinations/exam-types/${typeId}/papers`, { code: "EP1", label: "Épreuve 1 (démonstration)", coefficient: "1", scaleMax: "20", ordinal: 1, sourceKind: "placeholder" }, 201);
  const year = Number(ctx.data.yearStart.slice(0, 4)) + 1;
  const mk = async (code: string, body: Record<string, unknown>): Promise<string> => {
    const s = await ex.post("/api/v1/examinations/sessions", { examTypeId: typeId, institutionId: ctx.institutionId, code, label: `Session ${code}`, sessionYear: year, ...body }, 201);
    await ex.post(`/api/v1/examinations/sessions/${s.body.id}/instantiate`, {});
    await ex.post(`/api/v1/examinations/sessions/${s.body.id}/transition`, { to: "REGISTRATION_OPEN" });
    return s.body.id as string;
  };
  const officialId = await mk("OFF-DEMO", { sessionKind: "OFFICIAL" });
  const mockId = await mk("BLANC-DEMO", { sessionKind: "MOCK", mockOfSessionId: officialId });

  const from = await ex.post(`/api/v1/examinations/sessions/${officialId}/candidates/from-classroom`, { classroomId: ctx.classroomId }, [200, 201]);
  const evaluated = await ex.post(`/api/v1/examinations/sessions/${officialId}/eligibility/evaluate-all`, {}, [200, 201]);
  if ((evaluated.body.failed ?? []).length > 0) throw new Error(`Éligibilité en échec : ${JSON.stringify(evaluated.body).slice(0, 300)}`);
  kit.count("examCandidates", Number(from.body.created ?? 0));

  // Examen blanc : évaluation EXAMEN_BLANC publiée (période 2, ouverte pour l'occasion), importée puis calculée.
  const detail = await ex.get(`/api/v1/examinations/sessions/${mockId}`);
  const paperId = at((detail.body.papers ?? []) as Array<{ code: string; id: string }>, 0, "épreuve").id;
  const types = await teacher.get("/api/v1/assess/assessment-types");
  const blancType = (types.body.items as Array<{ id: string; code: string }>).find((x) => x.code === "EXAMEN_BLANC");
  if (!blancType) throw new Error("Type d'évaluation EXAMEN_BLANC absent du modèle de pack.");
  const p2 = at(ctx.periodIds, 1, "seconde période");
  await owner.post(`/api/v1/academic/periods/${p2}/open`, {}, [200, 201, 409]);
  const periods = (await owner.get(`/api/v1/academic/years/${ctx.yearId}/periods`)).body.items as Array<{ id: string; startsOn: string }>;
  const second = periods.find((x) => x.id === p2);
  if (!second) throw new Error("Seconde période introuvable.");
  const assessedOn = second.startsOn > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : second.startsOn;
  const a = await teacher.post(
    "/api/v1/assess/assessments",
    { typeId: blancType.id, academicPeriodId: p2, classroomId: ctx.classroomId, curriculumNodeId: at(ctx.teachable, 0, "matière"), title: "Examen blanc (démonstration)", assessedOn },
    201,
  );
  const assessmentId = (a.body.id ?? a.body.assessment?.id) as string;
  const active = ctx.students.slice(0, ctx.data.paidCount);
  await teacher.put(`/api/v1/assess/assessments/${assessmentId}/grades`, { entries: active.map((s, i) => ({ enrollmentId: s.enrollmentId, score: String(5 + ((i * 3) % 14)) })) }, 200);
  await teacher.post(`/api/v1/assess/assessments/${assessmentId}/transitions`, { to: "SUBMITTED" });
  await pedago.post(`/api/v1/assess/assessments/${assessmentId}/transitions`, { to: "REVIEWED" });
  await pedago.post(`/api/v1/assess/assessments/${assessmentId}/transitions`, { to: "APPROVED" });
  await directeur.post(`/api/v1/assess/assessments/${assessmentId}/transitions`, { to: "PUBLISHED" });

  await ex.post(`/api/v1/examinations/sessions/${mockId}/candidates/from-classroom`, { classroomId: ctx.classroomId }, [200, 201]);
  const cands = await ex.get(`/api/v1/examinations/sessions/${mockId}/candidates`);
  const ids = (cands.body.items as Array<{ id: string }>).map((c) => c.id);
  await ex.post(`/api/v1/examinations/sessions/${mockId}/candidates/register-batch`, { candidateIds: ids }, [200, 201]);
  await ex.post(`/api/v1/examinations/sessions/${mockId}/mock/link`, { paperId, classroomId: ctx.classroomId, assessmentId }, [200, 201]);
  await ex.post(`/api/v1/examinations/sessions/${mockId}/transition`, { to: "REGISTRATION_CLOSED" });
  await ex.post(`/api/v1/examinations/sessions/${mockId}/transition`, { to: "IN_PROGRESS" });
  await ex.post(`/api/v1/examinations/sessions/${mockId}/mock/import-from-assess`, {}, [200, 201]);
  const computed = await ex.post(`/api/v1/examinations/sessions/${mockId}/mock/compute`, {}, [200, 201]);
  if ((computed.body.failed ?? []).length > 0) throw new Error(`Calcul de l'examen blanc en échec : ${JSON.stringify(computed.body).slice(0, 300)}`);
  kit.count("mockExamResults", Number(computed.body.computed ?? 0));
  kit.note("Examens : type de démonstration (BEPC/BAC non livrés), session officielle (candidats, éligibilité) et session d'examen BLANC calculée par la règle de démonstration.");
}
