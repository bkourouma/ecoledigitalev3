/**
 * Utilitaires partagés des cas d'usage : chargement d'une évaluation, contrôle d'affectation, charges d'événements.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AssessCode, forbidden, notFound } from "../domain/errors";
import type { Assessment } from "../domain/types";
import { getAssessment, type RowLock } from "../infrastructure/assessments-repository";
import type { AssessCaps, AssessDeps } from "./deps";

export async function loadAssessment(tx: Tx, id: string, lock?: RowLock): Promise<Result<Assessment, AppError>> {
  const a = await getAssessment(tx, id, lock);
  return a ? ok(a) : err(notFound(AssessCode.ASSESSMENT_NOT_FOUND, "Évaluation", id));
}

/**
 * L'appelant peut-il agir comme ENSEIGNANT sur cette évaluation (saisir, soumettre, la modifier) ?
 *  - `assessment.manage` : oui (direction, responsable pédagogique) ;
 *  - sinon : l'enseignant de l'évaluation, ENCORE affecté à ce nœud dans cette classe (AC1.1 : `assess.not_assigned`).
 */
export async function ensureTeacherAccess(deps: AssessDeps, ctx: RequestContext, a: Assessment, caps: AssessCaps): Promise<Result<void, AppError>> {
  if (caps.manage) return ok(undefined);
  if (!ctx.userId) return err(forbidden(AssessCode.NOT_ASSIGNED, "Vous n'êtes pas affecté à cette évaluation."));
  const staffId = await deps.ports.teaching.staffIdForUser(ctx, ctx.userId);
  if (!staffId || staffId !== a.teacherId || !(await deps.ports.teaching.teaches(ctx, staffId, a.curriculumNodeId, a.classroomId))) {
    return err(forbidden(AssessCode.NOT_ASSIGNED, "Vous n'êtes pas affecté à cette matière dans cette classe.", { assessmentId: a.id }));
  }
  return ok(undefined);
}

/** Lecture d'une feuille : toute personne habilitée à lire tout, sinon l'enseignant concerné. */
export async function ensureReadAccess(deps: AssessDeps, ctx: RequestContext, a: Assessment, caps: AssessCaps): Promise<Result<void, AppError>> {
  if (caps.manage || caps.review || caps.validate || caps.publish || caps.reviseApprove) return ok(undefined);
  return ensureTeacherAccess(deps, ctx, a, caps);
}

/** Fragment commun des charges d'événements (aucune note). */
export function refOf(a: Assessment): { assessmentId: string; classroomId: string; academicPeriodId: string; curriculumNodeId: string; sessionNo: 1 | 2 } {
  return { assessmentId: a.id, classroomId: a.classroomId, academicPeriodId: a.academicPeriodId, curriculumNodeId: a.curriculumNodeId, sessionNo: a.sessionNo };
}

export const auditSnapshot = (a: Assessment): Record<string, unknown> => ({
  status: a.status,
  classroomId: a.classroomId,
  academicPeriodId: a.academicPeriodId,
  curriculumNodeId: a.curriculumNodeId,
  sessionNo: a.sessionNo,
  title: a.title,
  scaleMax: a.scaleMax,
  weight: a.weight,
});
