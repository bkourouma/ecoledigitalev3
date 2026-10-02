/**
 * Rattachement des pièces d'un dossier INSCRIT au dossier permanent de l'élève (GED, module `documents`) — rattachement
 * DIFFÉRÉ, CONFIRMÉ PAR UN HUMAIN.
 *
 * Pourquoi pas dans l'abonné `admissions.derive-enrolled` : `documents.createDocument` exige un déposant humain (`created_by`
 * NOT NULL, droits de dépôt relus à chaque appel) alors que cet abonné agit en système. Plutôt que d'inventer un « acteur
 * système » dans la GED (un faux déposant dans l'historique, des droits de dépôt contournés), l'abonné se contente de
 * COMPTER les pièces en attente (audit) et une personne habilitée (`admission.document.attach` ET `documents.upload`, gardes de
 * la route) déclenche le rattachement, sous sa propre identité : la GED applique alors ses règles habituelles (catégorie,
 * propriétaire = l'élève, quota, antivirus, doublons) et le déposant est cette personne.
 *
 * Garanties : réservé aux dossiers ENROLLED (élève connu) ; seules les pièces ACCEPTÉES sont reprises ; IDEMPOTENT (une pièce
 * déjà rattachée porte `document_ref` et n'est pas reprise ; un doublon détecté par la GED est reconnu et lié) ; un échec sur
 * une pièce n'arrête pas les autres et n'est jamais silencieux (code stable dans le compte rendu) ; la copie d'admissions n'est
 * pas supprimée ici (rétention propre au module). Audité.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsAttachToStudentFileResultDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import type { DocumentCaps } from "./ports";
import { requireUser } from "./support";

export async function attachDocumentsToStudentFile(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  applicationId: string,
  input: { categoryId: string; caps: DocumentCaps },
): Promise<Result<AdmissionsAttachToStudentFileResultDto, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const attach = deps.ports.documents.attachToStudentFile;
  if (!attach) return err(conflict(AdmissionsCode.PORT_UNAVAILABLE, "Le rattachement à la GED n'est pas disponible.", { port: "documents" }));

  const pending = await inTx(
    deps,
    ctx,
    async (tx) => {
      const app = await apps.getApplicationRow(tx, applicationId);
      if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
      if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
      if (app.status !== "ENROLLED" || !app.studentId) {
        return err(validation(AdmissionsCode.INVALID_INPUT, "Seules les pièces d'un dossier inscrit peuvent être rattachées au dossier de l'élève.", "applicationId"));
      }
      return ok({ studentId: app.studentId, files: await cases.listAttachableFiles(tx, applicationId) });
    },
    { readOnly: true },
  );
  if (!pending.ok) return pending;

  const items: AdmissionsAttachToStudentFileResultDto["items"] = [];
  for (const f of pending.value.files) {
    try {
      const r = await attach(
        ctx,
        { storageKey: f.storageKey, contentType: f.contentType, fileName: `${f.requirementCode.toLowerCase()}`, title: f.requirementLabel },
        { type: "STUDENT", id: pending.value.studentId, categoryId: input.categoryId },
        input.caps,
      );
      const saved = await inTx(deps, ctx, async (tx) => {
        await cases.setDocumentRef(tx, applicationId, f.requirementId, r.documentRef);
        return ok(true);
      });
      if (!saved.ok) throw saved.error;
      items.push({ requirementId: f.requirementId, outcome: r.alreadyPresent ? "ALREADY_PRESENT" : "ATTACHED", documentRef: r.documentRef, code: null });
    } catch (e) {
      const code = isAppError(e) ? e.code : "admissions.attach_failed";
      deps.logger.warn({ applicationId, requirementId: f.requirementId, code }, "admissions : pièce non rattachée au dossier de l'élève");
      items.push({ requirementId: f.requirementId, outcome: "FAILED", documentRef: null, code: String(code).slice(0, 80) });
    }
  }

  const summary = {
    attached: items.filter((i) => i.outcome === "ATTACHED" || i.outcome === "ALREADY_PRESENT").length,
    failed: items.filter((i) => i.outcome === "FAILED").length,
  };
  const audited = await inTx(deps, ctx, async (tx) => {
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({
      action: "admissions.document.attach_to_student_file",
      resourceType: "application",
      resourceId: applicationId,
      metadata: { categoryId: input.categoryId, attached: summary.attached, failed: summary.failed },
    });
    await buffer.flush(tx);
    return ok(true);
  });
  if (!audited.ok) return audited;
  return ok({ ...summary, items });
}
