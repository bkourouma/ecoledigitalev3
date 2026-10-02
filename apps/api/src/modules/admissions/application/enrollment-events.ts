/**
 * Consommateurs d'événements d'`academic` (abonnés idempotents, voir `subscribers.ts`).
 *
 *  - `academic.enrollment.confirmed` : DÉCISION MÉTIER (2026-10-01) — la confirmation d'une inscription suit le paiement des frais
 *    d'inscription (ou est immédiate si aucun frais n'est dû) ; elle appartient à `academic`. Ce module DÉRIVE `ENROLLED` : pose
 *    `enrollment_confirmed_at`, déplace le dossier vers l'étape `ENROLLED` (acteur SYSTÈME), active l'élève (`people`), rattache
 *    les pièces à son dossier (`documents`). Un événement reçu en double ou tardif ne produit qu'UN passage à `ENROLLED`.
 *  - `academic.enrollment.cancelled` / `.withdrawn` : l'inscription d'un dossier en attente de paiement disparaît (autre acteur) —
 *    le dossier est clos « retiré » et la place libérée ; sans effet si le dossier n'est plus à l'étape de création d'inscription.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AdmissionsCode, conflict } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { promoteOnFreedSeat } from "./decisions";
import { closeApplication } from "./offers";
import { nowIso } from "./support";
import { applicationRef, moveStage } from "./transitions";

export interface ConfirmedReport {
  readonly ignored: boolean;
  readonly alreadyEnrolled: boolean;
  readonly applicationId: string | null;
  readonly documentsLinked: number;
}

export async function handleEnrollmentConfirmed(deps: AdmissionsDeps, ctx: RequestContext, payload: { enrollmentId: string; studentId?: string | undefined }): Promise<Result<ConfirmedReport, AppError>> {
  return inTx<ConfirmedReport>(deps, ctx, async (tx, scope) => {
    const app = await apps.getApplicationByEnrollment(tx, payload.enrollmentId, { forUpdate: true });
    if (!app) return ok({ ignored: true, alreadyEnrolled: false, applicationId: null, documentsLinked: 0 });
    if (app.status === "ENROLLED") return ok({ ignored: false, alreadyEnrolled: true, applicationId: app.id, documentsLinked: 0 });
    if (!app.stageCreatesEnrollment || !app.studentId) return ok({ ignored: true, alreadyEnrolled: false, applicationId: app.id, documentsLinked: 0 });

    const enrolled = (await apps.listTransitionsFrom(tx, app.workflowId, app.stageId)).find((t) => t.toStatus === "ENROLLED");
    if (!enrolled) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Le workflow n'offre aucune étape ENROLLED depuis l'étape de création d'inscription."));

    // L'élève devient actif à la confirmation de son inscription (port people ; échec = l'événement sera rejoué).
    await deps.ports.students.changeStudentStatus(ctx, app.studentId, "ACTIVE", "Inscription confirmée (admissions)");

    await apps.setEnrollmentConfirmed(tx, app.id, nowIso(deps));
    const events = new EventBuffer(deps, ctx);
    const moved = await moveStage(deps, ctx, tx, scope, events, app, enrolled.toStageId);
    events.add(AdmissionsEvents.APPLICATION_ENROLLED, { v: 1, ...applicationRef(moved.after), studentId: app.studentId, enrollmentId: payload.enrollmentId }, { type: "application", id: app.id });
    events.audit({ action: "admissions.application.enrolled", resourceType: "application", resourceId: app.id, metadata: { studentId: app.studentId, enrollmentId: payload.enrollmentId } });

    // Rattachement des pièces au dossier permanent de l'élève (aucune copie hors du port).
    let linked = 0;
    let awaiting = 0;
    for (const f of await cases.listDocumentFiles(tx, app.id)) {
      try {
        const r = await deps.ports.documents.link(ctx, { storageKey: f.storageKey, documentRef: f.documentRef }, { type: "STUDENT", id: app.studentId });
        if (r.linked) linked += 1;
        else if (!f.documentRef) awaiting += 1;
      } catch (e) {
        deps.logger.warn({ applicationId: app.id, err: e instanceof Error ? e.message : String(e) }, "admissions : pièce non rattachée au dossier de l'élève");
      }
    }
    // Le rattachement à la GED exige un déposant humain (`documents.createDocument`) : l'abonné système ne le fait pas. Il laisse la
    // trace du nombre de pièces en attente ; une personne habilitée les rattache (`attachDocumentsToStudentFile`).
    if (awaiting > 0) events.audit({ action: "admissions.document.attach_pending", resourceType: "application", resourceId: app.id, metadata: { pieces: awaiting } });
    await events.flush(tx);
    return ok({ ignored: false, alreadyEnrolled: false, applicationId: app.id, documentsLinked: linked });
  });
}

export async function handleEnrollmentEnded(deps: AdmissionsDeps, ctx: RequestContext, payload: { enrollmentId: string }): Promise<Result<{ closed: boolean }, AppError>> {
  return inTx(deps, ctx, async (tx, scope) => {
    const app = await apps.getApplicationByEnrollment(tx, payload.enrollmentId, { forUpdate: true });
    if (!app || !app.stageCreatesEnrollment || app.enrollmentConfirmedAt) return ok({ closed: false });
    const events = new EventBuffer(deps, ctx);
    const closed = await closeApplication(deps, ctx, tx, scope, events, app, "WITHDRAWN_BY_FAMILY");
    await events.flush(tx);
    void promoteOnFreedSeat;
    return ok({ closed });
  });
}
