/**
 * PDF des documents officiels (diplômes, attestations) : scellement, rendu, téléchargement contrôlé, vérification publique.
 *
 *   snapshot immuable (`diploma/1`…)  ->  scellement (signature Ed25519 de l'empreinte, code inscrit dans l'index public)
 *                                     ->  PDF (gabarit de plateforme, dans le WORKER : Chromium) -> stockage objet
 *
 *  - le rendu part du SNAPSHOT SEUL (`buildDocumentContext`, fonction pure) : le même document donne le même PDF ;
 *  - un document RÉVOQUÉ n'est plus servi ; un duplicata remplace l'original (`SUPERSEDED`, toujours vérifiable) ;
 *  - le téléchargement passe par une URL SIGNÉE à durée courte, APRÈS le contrôle d'accès de la route ; chaque émission d'URL
 *    est auditée (`notice`) ; jamais de chemin de stockage dans une réponse ;
 *  - l'API ne rend rien : elle enregistre une demande (`higher.document.render_requested`) que le worker traite (3 tentatives,
 *    puis `FAILED` avec reprise explicite). `renderOfficialDocument` est idempotent : un document déjà rendu est renvoyé tel quel.
 */
import { createSystemContext, err, isUuid, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { buildDocumentContext, DOCUMENT_TEMPLATE_KEYS } from "../domain/document-context";
import { HigherCode, conflict, notFound } from "../domain/errors";
import { HigherEvents } from "../domain/events";
import { snapshotHash } from "../domain/snapshot";
import type { OfficialDocument, Uuid } from "../domain/types";
import * as repo from "../infrastructure/documents-repository";
import { EventBuffer, inTx, type HigherDeps } from "./deps";

const DOCUMENT_TITLES: Readonly<Record<string, string>> = { DIPLOMA: "Diplôme", ATTESTATION_SUCCESS: "Attestation de réussite", ATTESTATION_AUTHENTICITY: "Attestation d'authenticité" };

/** Lit `documentId` dans la charge d'un événement `higher.document.issued` / `render_requested` (exporté pour le test de contrat). */
export function parseDocumentEvent(payload: unknown): { documentId: Uuid } | null {
  const id = payload && typeof payload === "object" ? (payload as Record<string, unknown>).documentId : undefined;
  return typeof id === "string" && isUuid(id) ? { documentId: id } : null;
}

/** Nom de fichier proposé au téléchargement : la référence du document, nettoyée. */
export const pdfFileName = (doc: Pick<OfficialDocument, "reference">): string => `${doc.reference.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;

const MAX_RENDER_ATTEMPTS = 3;

/**
 * Enregistre (ou relance) la demande de PDF : `PENDING` + `higher.document.render_requested`. Sans effet pour un document
 * déjà rendu. Refusé pour un document révoqué.
 */
export async function requestDocumentRender(deps: HigherDeps, ctx: RequestContext, documentId: Uuid): Promise<Result<OfficialDocument, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const doc = await repo.getDocument(tx, documentId, true);
    if (!doc) return err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", documentId));
    if (doc.status === "REVOKED") return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document est révoqué : aucun PDF n'est produit."));
    if (doc.renderStatus === "RENDERED" && doc.objectKey) return ok(doc);
    const updated = doc.renderStatus === "FAILED" ? ((await repo.recordRender(tx, doc.id, { status: "PENDING" })) ?? doc) : doc;
    const events = new EventBuffer(deps, ctx);
    events.add(HigherEvents.DOCUMENT_RENDER_REQUESTED, { v: 1, documentId: doc.id, kind: doc.documentKind }, { type: "official_document", id: doc.id });
    events.audit({ action: "higher.document.render_requested", resourceType: "official_document", resourceId: doc.id, after: { kind: doc.documentKind, previous: doc.renderStatus } });
    await events.flush(tx);
    return ok(updated);
  });
}

export interface RenderOptions {
  /** Numéro de la tentative en cours (1 = première) et nombre maximal : à la dernière, l'échec est ENREGISTRÉ (`FAILED`). */
  attempt?: number;
  maxAttempts?: number;
}

/**
 * Scelle (une fois) puis rend le PDF d'un document et le range dans le stockage. Appelé par le worker ; idempotent.
 * Étape 1 (transaction) : verrou, statut `RENDERING`, scellement si nécessaire (signature + index de vérification publique)
 * ; étape 2 (hors transaction, Chromium) : PDF ; étape 3 : `RENDERED` (clé d'objet, empreinte du fichier) + audit.
 */
export async function renderOfficialDocument(deps: HigherDeps, ctx: RequestContext, documentId: Uuid, options: RenderOptions = {}): Promise<Result<OfficialDocument, AppError>> {
  const attempt = options.attempt ?? 1;
  const maxAttempts = options.maxAttempts ?? MAX_RENDER_ATTEMPTS;
  const fail = async (error: AppError): Promise<Result<never, AppError>> => {
    // Échec définitif avant même le rendu (ex. clé de signature absente) : le statut `FAILED` guide la reprise.
    if (attempt >= maxAttempts && error.kind !== "not_found" && error.code !== HigherCode.DOCUMENT_REVOKED) await markFailed(deps, ctx, documentId, error);
    return err(error);
  };
  // Le scellement exige l'enregistrement de la clé publique : accès SYSTÈME, donc HORS de toute transaction de tenant.
  const peek = await inTx(deps, ctx, async (tx) => ok(await repo.getDocument(tx, documentId)), { readOnly: true });
  if (peek.ok && peek.value && !peek.value.signature && peek.value.status !== "REVOKED") {
    const ready = await deps.ports.documents.prepareSeal(ctx);
    if (!ready.ok) return fail(ready.error);
  }
  const prepared = await inTx<{ doc: OfficialDocument; done: boolean }>(deps, ctx, async (tx) => {
    const doc = await repo.getDocument(tx, documentId, true);
    if (!doc) return err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", documentId));
    if (doc.status === "REVOKED") return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document est révoqué : aucun PDF n'est produit."));
    if (doc.renderStatus === "RENDERED" && doc.objectKey && doc.pdfHash && doc.signature) return ok({ doc, done: true });
    let current = doc;
    if (!doc.signature) {
      const sealed = await deps.ports.documents.seal(ctx, tx, { documentId: doc.id, kind: doc.documentKind, snapshotHash: doc.snapshotHash, verificationCode: doc.verificationCode, issuedAt: doc.issuedAt });
      if (!sealed.ok) return sealed;
      current = (await repo.recordSeal(tx, doc.id, { signingKeyId: sealed.value.signingKeyId, signature: sealed.value.signature, templateKey: DOCUMENT_TEMPLATE_KEYS[doc.documentKind], templateVersion: null, configVersion: null })) ?? doc;
    }
    current = (await repo.recordRender(tx, doc.id, { status: "RENDERING" })) ?? current;
    return ok({ doc: current, done: false });
  });
  if (!prepared.ok) return fail(prepared.error);
  if (prepared.value.done) return ok(prepared.value.doc);
  const doc = prepared.value.doc;

  const snapshotInstitution = (doc.snapshot.institution ?? {}) as { logoRef?: string | null };
  let rendered: Awaited<ReturnType<typeof deps.ports.documents.render>>;
  try {
    rendered = await deps.ports.documents.render(ctx, {
      documentId: doc.id,
      kind: doc.documentKind,
      templateKey: DOCUMENT_TEMPLATE_KEYS[doc.documentKind],
      title: `${DOCUMENT_TITLES[doc.documentKind] ?? "Document"} ${doc.reference}`,
      context: buildDocumentContext(doc),
      verificationCode: doc.verificationCode,
      issuedAt: doc.issuedAt,
      logoRef: snapshotInstitution.logoRef ?? null,
    });
  } catch (e) {
    rendered = err(e as AppError);
  }
  if (!rendered.ok) {
    if (attempt >= maxAttempts) await markFailed(deps, ctx, documentId, rendered.error);
    return rendered;
  }
  const file = rendered.value;
  return inTx(deps, ctx, async (tx) => {
    const updated = await repo.recordRender(tx, doc.id, { status: "RENDERED", objectKey: file.objectKey, pdfHash: file.pdfHash });
    if (!updated) return err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", documentId));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.document.rendered", resourceType: "official_document", resourceId: doc.id, after: { kind: doc.documentKind, pdfHash: file.pdfHash, pages: file.pages, template: `${file.templateKey}@${file.templateVersion}` } });
    await events.flush(tx);
    return ok(updated);
  });
}

async function markFailed(deps: HigherDeps, ctx: RequestContext, documentId: Uuid, error: AppError): Promise<void> {
  const r = await inTx(deps, ctx, async (tx) => {
    const updated = await repo.recordRender(tx, documentId, { status: "FAILED" });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.document.render_failed", resourceType: "official_document", resourceId: documentId, reason: error.code });
    await events.flush(tx);
    return ok(updated);
  });
  if (!r.ok) deps.logger.error({ documentId, code: r.error.code }, "higher : statut FAILED du rendu non enregistré");
}

export type DocumentDownload =
  | { status: "READY"; url: string; expiresInSec: number; fileName: string; contentType: "application/pdf"; pdfHash: string }
  | { status: "PENDING" | "RENDERING" | "FAILED" };

const DOWNLOAD_TTL_SEC = 120;

/**
 * Téléchargement d'un document : URL signée à durée courte si le PDF est prêt (émission AUDITÉE), sinon son état. Le contrôle
 * d'accès (personnel habilité, étudiant ou tuteur lié pour un document PUBLIÉ) est fait par la route AVANT cet appel.
 */
export async function getDocumentDownload(deps: HigherDeps, ctx: RequestContext, documentId: Uuid): Promise<Result<DocumentDownload, AppError>> {
  const found = await inTx(deps, ctx, async (tx) => {
    const doc = await repo.getDocument(tx, documentId);
    if (!doc) return err(notFound(HigherCode.DOCUMENT_NOT_FOUND, "Document", documentId));
    if (doc.status === "REVOKED") return err(conflict(HigherCode.DOCUMENT_REVOKED, "Ce document est révoqué : il ne peut plus être téléchargé."));
    if (doc.renderStatus === "RENDERED" && doc.objectKey && doc.pdfHash) {
      const events = new EventBuffer(deps, ctx);
      events.audit({ action: "higher.document.downloaded", resourceType: "official_document", resourceId: doc.id, sensitive: true, metadata: { kind: doc.documentKind, version: doc.version } });
      await events.flush(tx);
    }
    return ok(doc);
  });
  if (!found.ok) return found;
  const doc = found.value;
  if (doc.renderStatus !== "RENDERED" || !doc.objectKey || !doc.pdfHash) return ok({ status: doc.renderStatus === "RENDERED" ? "PENDING" : doc.renderStatus });
  const fileName = pdfFileName(doc);
  const url = await deps.ports.documents.signedUrl(ctx, doc.objectKey, { ttlSec: DOWNLOAD_TTL_SEC, fileName });
  return ok({ status: "READY", url, expiresInSec: DOWNLOAD_TTL_SEC, fileName, contentType: "application/pdf", pdfHash: doc.pdfHash });
}

/** Faits d'un document pour la vérification PUBLIQUE (aucune donnée personnelle) — fournis à reportcards par un adaptateur. */
export interface DocumentVerificationFacts {
  readonly status: "ISSUED" | "SUPERSEDED" | "REVOKED";
  readonly title: string;
  readonly institutionName: string | null;
  readonly issuedAt: Date;
  readonly supersededByIssuedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly verificationCode: string;
  readonly snapshotHash: string;
  readonly recomputedHash: string;
  readonly signingKeyId: string | null;
  readonly signature: string | null;
}

/**
 * Lecture pour la vérification publique : le document sous la RLS de son tenant (contexte système du tenant), l'empreinte du
 * snapshot RECALCULÉE (un snapshot altéré en base ne se laisserait pas vérifier).
 */
export async function describeDocumentForVerification(deps: HigherDeps, tenantId: string, documentId: Uuid): Promise<DocumentVerificationFacts | null> {
  const ctx = createSystemContext(tenantId);
  const read = await inTx(
    deps,
    ctx,
    async (tx) => {
      const doc = await repo.getDocument(tx, documentId);
      if (!doc) return ok(null);
      const superseding = doc.status === "SUPERSEDED" ? await repo.findSuperseding(tx, doc.id) : null;
      return ok({ doc, superseding });
    },
    { readOnly: true },
  );
  if (!read.ok || !read.value) return null;
  const { doc, superseding } = read.value;
  const institution = (doc.snapshot.institution ?? {}) as { name?: unknown };
  const diploma = (doc.snapshot.diploma ?? doc.snapshot.program ?? {}) as { label?: unknown };
  const label = typeof diploma.label === "string" && diploma.label.trim() ? ` — ${diploma.label}` : "";
  return {
    status: doc.status === "REVOKED" ? "REVOKED" : doc.status === "SUPERSEDED" ? "SUPERSEDED" : "ISSUED",
    title: `${DOCUMENT_TITLES[doc.documentKind] ?? "Document"}${label}`,
    institutionName: typeof institution.name === "string" ? institution.name : null,
    issuedAt: doc.issuedAt,
    supersededByIssuedAt: superseding?.issuedAt ?? null,
    revokedAt: doc.revokedAt,
    verificationCode: doc.verificationCode,
    snapshotHash: doc.snapshotHash,
    recomputedHash: snapshotHash(doc.snapshot),
    signingKeyId: doc.signingKeyId,
    signature: doc.signature,
  };
}
