/**
 * assess -> examinations : `AssessPort` — description d'une évaluation (classe, type, barème, publiée ?) et notes PUBLIÉES d'une
 * évaluation d'examen blanc (jamais un brouillon). Lecture seule, par l'API publique d'`assess` : `examinations` a déjà contrôlé la
 * permission `exam.mock.manage` ; l'accès d'enseignant d'`assess` est donc levé pour cette lecture (droits de gestion).
 */
import { getAssessmentView, listPublishedGrades, type AssessCaps, type AssessDeps } from "../../modules/assess";
import type { AssessPort } from "../../modules/examinations";

export function createExaminationsAssessPort(assess: AssessDeps): AssessPort {
  return {
    async getAssessment(ctx, assessmentId) {
      const caps: AssessCaps = { manage: true };
      const r = await getAssessmentView(assess, ctx, { assessmentId, caps });
      if (!r.ok) return null;
      const a = r.value;
      return { assessmentId: a.id, classroomId: a.classroomId, typeCode: a.typeCode, scaleMax: a.scaleMax, title: a.title, published: a.status === "PUBLISHED" };
    },
    async listPublishedGrades(ctx, input) {
      const r = await listPublishedGrades(assess, ctx, { classroomId: input.classroomId });
      if (!r.ok) throw r.error;
      return r.value
        .filter((g) => g.assessmentId === input.assessmentId)
        .map((g) => ({ studentId: g.studentId, enrollmentId: g.enrollmentId, assessmentId: g.assessmentId, score: g.score, entryStatus: g.entryStatus }));
    },
  };
}
