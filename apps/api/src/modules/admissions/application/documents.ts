/**
 * Pièces justificatives (US5). Les exigences sont des DONNÉES de l'établissement ; l'état de chaque pièce (`MISSING`, `SUBMITTED`,
 * `ACCEPTED`, `REJECTED`) vit ici ; le fichier passe par le port `DocumentStore` (type RÉEL contrôlé par les octets, taille,
 * empreinte SHA-256, antivirus). Une pièce déposée mais non relue reste « manquante » pour la règle de passage.
 *
 * Écriture en deux temps (comme `documents`) : décision lue, objet écrit HORS transaction, puis ligne écrite ; si l'écriture
 * échoue, l'objet est supprimé (compensation).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsApplicationDocumentDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as ref from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import type { StoredPiece } from "./ports";
import { requireUser } from "./support";

export interface UploadInput {
  readonly applicationId: string;
  readonly requirementId: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /** `FAMILY` : dépôt par code de suivi (une pièce déjà ACCEPTÉE ne se remplace pas) ; `STAFF` : secrétariat. */
  readonly by: "FAMILY" | "STAFF";
}

interface Prepared {
  readonly acceptsMime: readonly string[];
  readonly maxSizeBytes: number;
}

export async function uploadDocument(deps: AdmissionsDeps, ctx: RequestContext, input: UploadInput): Promise<Result<AdmissionsApplicationDocumentDto[], AppError>> {
  if (input.by === "STAFF") {
    const user = requireUser(ctx);
    if (!user.ok) return user;
  }
  if (input.bytes.byteLength === 0) return err(validation(AdmissionsCode.FILE_REJECTED, "Le fichier est vide.", "file"));

  // Temps 1 : décision (lecture).
  const prepared = await inTx<Prepared>(
    deps,
    ctx,
    async (tx) => {
      const app = await apps.getApplicationRow(tx, input.applicationId);
      if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", input.applicationId));
      if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
      if (app.stageIsTerminal) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Ce dossier est clos : aucune pièce ne peut plus être déposée."));
      const req = await ref.getRequirement(tx, input.requirementId);
      const applicable = req && req.active && req.institutionId === app.institutionId && (!req.gradeLevelCode || req.gradeLevelCode === app.desiredGradeLevelCode) && (!req.appliesToFunding || req.appliesToFunding === app.fundingTypeRequested);
      if (!req || !applicable) return err(notFound(AdmissionsCode.REQUIREMENT_NOT_FOUND, "Pièce exigée", input.requirementId));
      const current = await cases.getDocumentRow(tx, app.id, req.id);
      if (input.by === "FAMILY" && current?.status === "ACCEPTED") return err(conflict(AdmissionsCode.FILE_REJECTED, "Cette pièce a déjà été acceptée par l'établissement."));
      return ok({ acceptsMime: req.acceptsMime, maxSizeBytes: Math.min(req.maxSizeKb * 1024, deps.config.hardMaxFileBytes) });
    },
    { readOnly: true },
  );
  if (!prepared.ok) return prepared;

  // Temps 2 : contrôle du type réel, antivirus, écriture de l'objet (hors transaction).
  let piece: StoredPiece;
  try {
    piece = await deps.ports.documents.store(ctx, { applicationId: input.applicationId, requirementId: input.requirementId, fileName: input.fileName, bytes: input.bytes, acceptsMime: prepared.value.acceptsMime, maxSizeBytes: prepared.value.maxSizeBytes });
  } catch (e) {
    return err(e as AppError);
  }

  // Temps 3 : écriture de la ligne ; compensation (suppression de l'objet) si elle échoue.
  const written = await inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, input.applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", input.applicationId));
    const previous = await cases.getDocumentRow(tx, app.id, input.requirementId);
    await cases.upsertSubmittedDocument(tx, { id: deps.newId(), tenantId: ctx.tenantId, applicationId: app.id, requirementId: input.requirementId, documentRef: piece.documentRef, storageKey: piece.storageKey, contentType: piece.contentType, sizeBytes: piece.sizeBytes, sha256: piece.sha256 });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.document.upload", resourceType: "application", resourceId: app.id, metadata: { requirementId: input.requirementId, by: input.by, sha256: piece.sha256, sizeBytes: piece.sizeBytes, replaced: previous !== null } });
    await buffer.flush(tx);
    // L'ancien objet remplacé est supprimé APRÈS le commit.
    return ok({ list: await cases.listApplicationDocuments(tx, app.id), previous });
  });
  if (!written.ok) {
    await deps.ports.documents.remove(ctx, { storageKey: piece.storageKey, documentRef: piece.documentRef }).catch(() => undefined);
    return written;
  }
  const old = written.value.previous;
  if (old && old.storageKey && old.storageKey !== piece.storageKey) {
    await deps.ports.documents.remove(ctx, { storageKey: old.storageKey, documentRef: old.documentRef }).catch((e) => deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "admissions : ancienne pièce non supprimée"));
  }
  return ok(written.value.list);
}

export async function reviewDocument(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, requirementId: string, body: { decision: "ACCEPT" | "REJECT"; reason?: string | undefined }): Promise<Result<AdmissionsApplicationDocumentDto[], AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
    const done = await cases.reviewDocument(tx, applicationId, requirementId, { status: body.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED", reason: body.decision === "REJECT" ? (body.reason ?? null) : null, reviewerId: user.value });
    if (!done) return err(notFound(AdmissionsCode.DOCUMENT_NOT_FOUND, "Pièce déposée", requirementId));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.document.review", resourceType: "application", resourceId: applicationId, metadata: { requirementId, decision: body.decision } });
    await buffer.flush(tx);
    return ok(await cases.listApplicationDocuments(tx, applicationId));
  });
}

/** URL signée courte d'une pièce (lecture auditée : ce sont des données d'enfant). */
export async function getDocumentUrl(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, requirementId: string): Promise<Result<{ url: string; expiresAt: string }, AppError>> {
  const found = await inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId);
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    const row = await cases.getDocumentRow(tx, applicationId, requirementId);
    if (!row || (!row.storageKey && !row.documentRef)) return err(notFound(AdmissionsCode.DOCUMENT_NOT_FOUND, "Pièce déposée", requirementId));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.document.read", resourceType: "application", resourceId: applicationId, metadata: { requirementId } });
    await buffer.flush(tx);
    return ok(row);
  });
  if (!found.ok) return found;
  const signed = await deps.ports.documents.signedUrl(ctx, { storageKey: found.value.storageKey, documentRef: found.value.documentRef }, { ttlSeconds: 60, fileName: `piece-${requirementId.slice(0, 8)}`, contentType: found.value.contentType ?? "application/octet-stream" });
  return ok({ url: signed.url, expiresAt: signed.expiresAt.toISOString() });
}

export async function listDocuments(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string): Promise<Result<AdmissionsApplicationDocumentDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await apps.getApplicationRow(tx, applicationId))) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
      return ok(await cases.listApplicationDocuments(tx, applicationId));
    },
    { readOnly: true },
  );
}
