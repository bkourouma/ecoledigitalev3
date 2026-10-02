/**
 * Pièces du dossier : des RÉFÉRENCES vers la GED (`documents`), jamais le fichier. L'existence et la lisibilité du document pour
 * l'appelant sont vérifiées par le port `documents` ; le retrait est motivé et conserve la ligne (historique).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AssignmentDocumentDto } from "@ecoledigitale/contracts/src/v2/stateassign";
import { StateassignCode, conflict, notFound } from "../domain/errors";
import type { AssignmentDocumentKind, IsoDate, Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import { EventBuffer, inTx, requireHuman, type StateassignDeps } from "./deps";
import { documentDto } from "./presenters";
import type { DocumentReadCaps } from "./ports";
import { inScope, loadAssignmentInScope, reasonOf, reasonRequired } from "./support";

export async function addAssignmentDocument(
  deps: StateassignDeps,
  ctx: RequestContext,
  assignmentId: Uuid,
  body: { kind: AssignmentDocumentKind; documentRef: Uuid; label?: string | null | undefined; receivedOn?: IsoDate | null | undefined },
  caps: DocumentReadCaps,
): Promise<Result<AssignmentDocumentDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, assignmentId, true);
    if (!loaded.ok) return loaded;
    if (loaded.value.status === "REJECTED" || loaded.value.status === "SUPERSEDED") {
      return err(conflict(StateassignCode.TRANSITION_INVALID, `Le dossier est ${loaded.value.status} : on ne lui rattache plus de pièce (voir la version courante).`));
    }
    if (!(await deps.ports.documents.exists(ctx, body.documentRef, caps))) {
      return err(notFound(StateassignCode.DOCUMENT_REF_NOT_FOUND, "Document", body.documentRef));
    }
    const created = await repo.insertDocument(tx, ctx.tenantId, {
      id: deps.newId(),
      assignmentId,
      kind: body.kind,
      documentRef: body.documentRef,
      label: body.label?.trim() || null,
      receivedOn: body.receivedOn ?? null,
      addedBy: h.value,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "stateassign.document.added", resourceType: "assignment_document", resourceId: created.id, after: { kind: created.kind }, metadata: { assignmentId, documentRef: body.documentRef } });
    await events.flush(tx);
    return ok(documentDto(created));
  });
}

export async function withdrawAssignmentDocument(deps: StateassignDeps, ctx: RequestContext, documentId: Uuid, body: { reason: string }): Promise<Result<AssignmentDocumentDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const reason = reasonOf(body.reason);
  if (!reason) return err(reasonRequired());
  return inTx(deps, ctx, async (tx) => {
    const doc = await repo.getDocumentRow(tx, documentId, { forUpdate: true });
    if (!doc) return err(notFound(StateassignCode.DOCUMENT_NOT_FOUND, "Pièce du dossier", documentId));
    const a = await repo.getAssignment(tx, doc.assignmentId);
    if (!a || !inScope(ctx, a.institutionId)) return err(notFound(StateassignCode.DOCUMENT_NOT_FOUND, "Pièce du dossier", documentId));
    if (doc.status === "WITHDRAWN") return err(conflict(StateassignCode.TRANSITION_INVALID, "La pièce est déjà retirée."));
    const updated = await repo.withdrawDocument(tx, documentId, reason);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "stateassign.document.withdrawn", resourceType: "assignment_document", resourceId: documentId, reason, after: { status: "WITHDRAWN" }, metadata: { assignmentId: doc.assignmentId } });
    await events.flush(tx);
    return ok(documentDto(updated));
  });
}
