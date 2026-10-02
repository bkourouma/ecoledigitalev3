/**
 * PIÈCES du candidat : exigences par type d'examen (données), dépôt par référence à un document de `documents` (jamais de fichier
 * recopié ici), relecture (acceptée ou refusée avec motif). L'inscription d'une session OFFICIELLE exige que toutes les pièces
 * obligatoires soient ACCEPTÉES (garde de la base, qui cite les manques).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamPieceActionBody, ExamPieceDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import * as cand from "../infrastructure/candidates-repo";
import { toPieceDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";

export async function listPieces(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string): Promise<Result<{ pieces: ExamPieceDto[]; missing: string[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const c = await cand.getCandidate(tx, candidateId);
      if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
      return ok({ pieces: (await cand.listPieces(tx, candidateId)).map(toPieceDto), missing: await cand.missingRequiredPieces(tx, candidateId) });
    },
    { readOnly: true },
  );
}

export async function actOnPiece(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, requirementId: string, body: ExamPieceActionBody): Promise<Result<{ pieces: ExamPieceDto[]; missing: string[] }, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const probe = await inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    return ok(c);
  }, { readOnly: true });
  if (!probe.ok) return probe;
  const candidate = probe.value;
  if (candidate.registrationStatus === "WITHDRAWN") return err(conflict(ExamCode.CANDIDATE_WITHDRAWN, "Un candidat retiré ne change plus."));
  // La pièce déposée doit exister dans `documents` et appartenir à l'élève (lecture avant la transaction d'écriture).
  if (body.action === "SUBMIT") {
    const known = await deps.ports.pieces.verify(ctx, { documentId: body.documentRef, studentId: candidate.studentId });
    if (!known) return err(validation(ExamCode.PIECE_DOCUMENT_UNKNOWN, "Le document désigné est introuvable ou n'appartient pas à cet élève.", "documentRef"));
  }
  return inTx(deps, ctx, async (tx) => {
    const pieces = await cand.listPieces(tx, candidateId);
    const piece = pieces.find((p) => p.requirementId === requirementId);
    if (!piece) return err(notFound(ExamCode.REQUIREMENT_NOT_FOUND, "Pièce exigée", requirementId));
    const events = new EventBuffer(deps, ctx);
    if (body.action === "SUBMIT") {
      await cand.submitPiece(tx, ctx.tenantId, { id: deps.newId(), candidateId, requirementId, documentRef: body.documentRef });
    } else {
      if (piece.status !== "SUBMITTED") return err(conflict(ExamCode.PIECE_REVIEW_INVALID, "Seule une pièce déposée se relit (acceptée ou refusée)."));
      await cand.reviewPiece(tx, candidateId, requirementId, { status: body.action === "ACCEPT" ? "ACCEPTED" : "REJECTED", rejectionReason: body.action === "REJECT" ? body.rejectionReason.trim() : null, reviewedBy: actor });
    }
    events.audit({ action: `examinations.piece.${body.action.toLowerCase()}`, resourceType: "candidate", resourceId: candidateId, metadata: { requirement: piece.requirementCode, ...(body.action === "REJECT" ? { rejected: true } : {}) } });
    await events.flush(tx);
    return ok({ pieces: (await cand.listPieces(tx, candidateId)).map(toPieceDto), missing: await cand.missingRequiredPieces(tx, candidateId) });
  });
}
