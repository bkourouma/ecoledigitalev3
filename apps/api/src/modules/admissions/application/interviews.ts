/**
 * Tests et entretiens (US6) : facultatifs, étape du workflow. Aucun seuil de réussite n'est calculé : le résultat (`PASSED`,
 * `FAILED`, `NOT_APPLICABLE`) est SAISI par l'examinateur. Une étape qui exige un entretien terminé refuse l'entrée sans lui.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsInterviewDto, AdmissionsUpdateInterviewBody } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";

export async function createInterview(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, body: { kind: string; scheduledAt: string; venue?: string | null | undefined; conductedByStaffId?: string | null | undefined }): Promise<Result<AdmissionsInterviewDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt || app.stageIsTerminal) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Ce dossier est clos : aucun entretien ne peut être planifié."));
    const id = deps.newId();
    await cases.insertInterview(tx, { id, tenantId: ctx.tenantId, applicationId, kind: body.kind, scheduledAt: body.scheduledAt, venue: body.venue ?? null, conductedByStaffId: body.conductedByStaffId ?? null });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.interview.create", resourceType: "application", resourceId: applicationId, metadata: { interviewId: id, kind: body.kind } });
    await buffer.flush(tx);
    return ok(await cases.listInterviews(tx, applicationId));
  });
}

export async function updateInterview(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, interviewId: string, body: AdmissionsUpdateInterviewBody): Promise<Result<AdmissionsInterviewDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
    const current = await cases.getInterview(tx, applicationId, interviewId);
    if (!current) return err(notFound(AdmissionsCode.INTERVIEW_NOT_FOUND, "Entretien", interviewId));
    const status = body.status ?? current.status;
    const result = body.resultCode === undefined ? current.resultCode : body.resultCode;
    if (status === "DONE" && !result) return err(validation(AdmissionsCode.INVALID_INPUT, "Un entretien terminé porte son résultat (réussi, échoué, sans objet).", "resultCode"));
    const score = body.score === undefined ? (current.score === null ? null : Number(current.score)) : body.score;
    const scaleMax = body.scaleMax === undefined ? (current.scaleMax === null ? null : Number(current.scaleMax)) : body.scaleMax;
    if (score !== null && (scaleMax === null || score > scaleMax)) return err(validation(AdmissionsCode.INVALID_INPUT, "La note exige une échelle et ne la dépasse pas.", "score"));
    await cases.updateInterview(tx, applicationId, interviewId, body);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.interview.update", resourceType: "application", resourceId: applicationId, metadata: { interviewId, status, resultCode: result } });
    await buffer.flush(tx);
    return ok(await cases.listInterviews(tx, applicationId));
  });
}
