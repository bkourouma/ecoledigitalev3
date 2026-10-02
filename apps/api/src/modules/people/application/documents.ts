/**
 * Pièces de l'élève (spec 008 AC7.1-7.2) : dépôt, consultation, remplacement, retrait, expiration.
 *
 *  - le FICHIER est écrit dans le stockage objet (`StoragePort`) ; sans stockage, tout dépôt est refusé (`people.storage_unavailable`) ;
 *  - type RÉEL par octets magiques (PDF, JPEG, PNG, WebP), taille plafonnée par `config.documentMaxBytes` : le reste est refusé ;
 *  - lecture = URL SIGNÉE à durée courte APRÈS contrôle de permission (jamais un chemin disque) ; CHAQUE lecture (liste comme
 *    URL) est auditée `notice` ; le nom du fichier et le titre ne vont jamais dans l'audit (données personnelles possibles) ;
 *  - une pièce ne se modifie pas : remplacer crée une VERSION (l'ancienne reste lisible dans l'historique), retirer est motivé ;
 *  - l'expiration est une donnée : l'état « bientôt / expirée » se dérive à la lecture ; un job publie
 *    `people.student_document.expiring` une fois par franchissement de seuil.
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  PeopleListStudentDocumentsQuery,
  PeopleRemoveStudentDocumentBody,
  PeopleReplaceStudentDocumentQuery,
  PeopleStudentDocumentDto,
  PeopleStudentDocumentUrlDto,
  PeopleUpdateStudentDocumentBody,
  PeopleUploadStudentDocumentQuery,
} from "@ecoledigitale/contracts/src/v2/people";
import { PEOPLE_EVENTS } from "@ecoledigitale/contracts/src/v2/people";
import { PeopleErrors } from "../domain/errors";
import { documentExpiryState, safeDocumentFileName, sniffDocument, studentDocumentKey } from "../domain/files";
import * as repo from "../infrastructure/documents-repo";
import * as studentsRepo from "../infrastructure/students-repo";
import { actorId, EventBuffer, inTx, todayOf, type PeopleDeps } from "./deps";
import { loadSettings } from "./support";

export type PeopleListStudentDocumentsInput = { includeHistory?: boolean | undefined; expiry?: "EXPIRING" | "EXPIRED" | undefined };

function view(row: repo.DocumentRow, today: string, warnDays: number | null): PeopleStudentDocumentDto {
  const expiry = row.status === "ACTIVE" ? documentExpiryState(row.expiresOn, today, warnDays) : { state: row.expiresOn === null ? ("NO_EXPIRY" as const) : ("VALID" as const), daysLeft: null };
  return {
    id: row.id,
    studentId: row.studentId,
    typeCode: row.typeCode as PeopleStudentDocumentDto["typeCode"],
    title: row.title,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    version: row.version,
    supersedesId: row.supersedesId,
    status: row.status,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    expiryState: expiry.state,
    daysLeft: expiry.daysLeft,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
    replacedAt: row.replacedAt,
    removedAt: row.removedAt,
    removedReason: row.removedReason,
  };
}

/** Liste les pièces de l'élève (lecture AUDITÉE `notice`). `includeHistory` : versions remplacées et pièces retirées. */
export async function listStudentDocuments(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  query: PeopleListStudentDocumentsInput | PeopleListStudentDocumentsQuery = {},
): Promise<Result<PeopleStudentDocumentDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await studentsRepo.getStudentRow(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
    const settings = await loadSettings(deps, tx, ctx, { write: false });
    const today = todayOf(deps);
    let items = (await repo.listDocuments(tx, ctx.tenantId, studentId, { includeHistory: query.includeHistory === true })).map((r) => view(r, today, settings.expiryAlertDays));
    if (query.expiry) items = items.filter((d) => (query.expiry === "EXPIRED" ? d.expiryState === "EXPIRED" : d.expiryState === "EXPIRING" || d.expiryState === "EXPIRED"));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.documents_read", entity: "student", entityId: studentId, severity: "notice", metadata: { count: items.length, includeHistory: query.includeHistory === true } });
    await buffer.flush(tx);
    return ok(items);
  });
}

interface Checked {
  bytes: Uint8Array;
  kind: NonNullable<ReturnType<typeof sniffDocument>>;
  sha256: string;
}

function checkFile(deps: PeopleDeps, bytes: Uint8Array): Result<Checked, AppError> {
  if (!deps.storage) return err(PeopleErrors.storageUnavailable());
  if (bytes.byteLength === 0) return err(PeopleErrors.invalidDocument("Fichier vide."));
  if (bytes.byteLength > deps.config.documentMaxBytes) return err(PeopleErrors.invalidDocument(`Fichier trop volumineux (maximum ${Math.floor(deps.config.documentMaxBytes / (1024 * 1024))} Mo).`));
  const kind = sniffDocument(bytes);
  if (!kind) return err(PeopleErrors.invalidDocument("Format non reconnu : PDF, JPEG, PNG ou WebP attendu."));
  return ok({ bytes, kind, sha256: createHash("sha256").update(bytes).digest("hex") });
}

async function discard(deps: PeopleDeps, key: string | null): Promise<void> {
  if (!deps.storage || !key) return;
  await deps.storage.delete(key).catch((e: unknown) => deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "people : suppression d'une pièce en échec"));
}

/** Dépose une pièce (corps binaire). Une pièce ACTIVE du même type (hors `OTHER`) doit être REMPLACÉE, pas doublée. */
export async function uploadStudentDocument(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  bytes: Uint8Array,
  meta: PeopleUploadStudentDocumentQuery,
): Promise<Result<PeopleStudentDocumentDto, AppError>> {
  const checked = checkFile(deps, bytes);
  if (!checked.ok) return checked;
  const { kind, sha256 } = checked.value;
  const storage = deps.storage as NonNullable<PeopleDeps["storage"]>;
  const id = deps.newId();
  const key = studentDocumentKey(ctx.tenantId, studentId, id);
  let written = false;
  try {
    const result = await inTx(deps, ctx, async (tx) => {
      const locked = await studentsRepo.lockStudent(tx, ctx.tenantId, studentId);
      if (!locked) return err(PeopleErrors.studentNotFound(studentId));
      const student = await studentsRepo.getStudentRow(tx, ctx.tenantId, studentId);
      if (student?.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
      if (meta.typeCode !== "OTHER" && (await repo.findActiveOfType(tx, ctx.tenantId, studentId, meta.typeCode))) return err(PeopleErrors.documentExists(meta.typeCode));
      await storage.put(key, bytes, { contentType: kind });
      written = true;
      const now = deps.clock.now();
      const row = await repo.insertDocument(tx, ctx.tenantId, {
        id,
        studentId,
        typeCode: meta.typeCode,
        title: meta.title ?? null,
        fileName: safeDocumentFileName(meta.fileName, kind),
        contentType: kind,
        sizeBytes: bytes.byteLength,
        sha256,
        objectKey: key,
        version: 1,
        supersedesId: null,
        issuedOn: meta.issuedOn ?? null,
        expiresOn: meta.expiresOn ?? null,
        uploadedBy: actorId(ctx),
        uploadedAt: now,
      });
      const settings = await loadSettings(deps, tx, ctx, { write: false });
      const buffer = new EventBuffer(deps, ctx);
      buffer.audit({ action: "people.student.document_uploaded", entity: "student", entityId: studentId, severity: "notice", metadata: { documentId: id, typeCode: meta.typeCode, contentType: kind, bytes: bytes.byteLength, version: 1 } });
      await buffer.flush(tx);
      return ok(view(row, todayOf(deps), settings.expiryAlertDays));
    });
    if (!result.ok && written) await discard(deps, key);
    return result;
  } catch (e) {
    if (written) await discard(deps, key);
    throw e;
  }
}

/** Remplace une pièce ACTIVE : nouvelle version (même type), l'ancienne passe `REPLACED` et reste dans l'historique. */
export async function replaceStudentDocument(
  deps: PeopleDeps,
  ctx: RequestContext,
  studentId: string,
  documentId: string,
  bytes: Uint8Array,
  meta: PeopleReplaceStudentDocumentQuery,
): Promise<Result<PeopleStudentDocumentDto, AppError>> {
  const checked = checkFile(deps, bytes);
  if (!checked.ok) return checked;
  const { kind, sha256 } = checked.value;
  const storage = deps.storage as NonNullable<PeopleDeps["storage"]>;
  const id = deps.newId();
  const key = studentDocumentKey(ctx.tenantId, studentId, id);
  let written = false;
  try {
    const result = await inTx(deps, ctx, async (tx) => {
      const locked = await studentsRepo.lockStudent(tx, ctx.tenantId, studentId);
      if (!locked) return err(PeopleErrors.studentNotFound(studentId));
      const previous = await repo.getDocument(tx, ctx.tenantId, studentId, documentId, { forUpdate: true });
      if (!previous) return err(PeopleErrors.documentNotFound(documentId));
      if (previous.status !== "ACTIVE") return err(PeopleErrors.documentNotActive());
      await storage.put(key, bytes, { contentType: kind });
      written = true;
      const now = deps.clock.now();
      await repo.markReplaced(tx, ctx.tenantId, previous.id, now);
      const row = await repo.insertDocument(tx, ctx.tenantId, {
        id,
        studentId,
        typeCode: previous.typeCode,
        title: meta.title ?? previous.title,
        fileName: safeDocumentFileName(meta.fileName, kind),
        contentType: kind,
        sizeBytes: bytes.byteLength,
        sha256,
        objectKey: key,
        version: previous.version + 1,
        supersedesId: previous.id,
        issuedOn: meta.issuedOn ?? null,
        expiresOn: meta.expiresOn ?? null,
        uploadedBy: actorId(ctx),
        uploadedAt: now,
      });
      const settings = await loadSettings(deps, tx, ctx, { write: false });
      const buffer = new EventBuffer(deps, ctx);
      buffer.audit({ action: "people.student.document_replaced", entity: "student", entityId: studentId, severity: "notice", metadata: { documentId: id, replacedDocumentId: previous.id, typeCode: previous.typeCode, version: row.version, bytes: bytes.byteLength } });
      await buffer.flush(tx);
      return ok(view(row, todayOf(deps), settings.expiryAlertDays));
    });
    if (!result.ok && written) await discard(deps, key);
    return result;
  } catch (e) {
    if (written) await discard(deps, key);
    throw e;
  }
}

/** Corrige les métadonnées d'une pièce ACTIVE (titre, dates). Le contenu ne change jamais : on remplace. */
export async function updateStudentDocument(deps: PeopleDeps, ctx: RequestContext, studentId: string, documentId: string, patch: PeopleUpdateStudentDocumentBody): Promise<Result<PeopleStudentDocumentDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await studentsRepo.lockStudent(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
    const current = await repo.getDocument(tx, ctx.tenantId, studentId, documentId, { forUpdate: true });
    if (!current) return err(PeopleErrors.documentNotFound(documentId));
    if (current.status !== "ACTIVE") return err(PeopleErrors.documentNotActive());
    const issuedOn = patch.issuedOn === undefined ? current.issuedOn : patch.issuedOn;
    const expiresOn = patch.expiresOn === undefined ? current.expiresOn : patch.expiresOn;
    if (issuedOn && expiresOn && expiresOn < issuedOn) return err(PeopleErrors.invalidDocument("L'expiration précède la date d'émission."));
    const row = await repo.updateMetadata(tx, ctx.tenantId, documentId, patch);
    const settings = await loadSettings(deps, tx, ctx, { write: false });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.document_updated", entity: "student", entityId: studentId, severity: "notice", metadata: { documentId, fields: Object.keys(patch) } });
    await buffer.flush(tx);
    return ok(view(row, todayOf(deps), settings.expiryAlertDays));
  });
}

/** Retire une pièce (motif obligatoire) : la ligne reste (`REMOVED`), le fichier est supprimé du stockage après validation. */
export async function removeStudentDocument(deps: PeopleDeps, ctx: RequestContext, studentId: string, documentId: string, input: PeopleRemoveStudentDocumentBody): Promise<Result<{ removed: true }, AppError>> {
  const result = await inTx(deps, ctx, async (tx) => {
    if (!(await studentsRepo.lockStudent(tx, ctx.tenantId, studentId))) return err(PeopleErrors.studentNotFound(studentId));
    const current = await repo.getDocument(tx, ctx.tenantId, studentId, documentId, { forUpdate: true });
    if (!current) return err(PeopleErrors.documentNotFound(documentId));
    if (current.status === "REMOVED") return err(PeopleErrors.documentNotActive());
    await repo.markRemoved(tx, ctx.tenantId, documentId, input.reason, deps.clock.now());
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.document_removed", entity: "student", entityId: studentId, severity: "notice", reason: input.reason, metadata: { documentId, typeCode: current.typeCode, version: current.version } });
    await buffer.flush(tx);
    return ok(current.objectKey);
  });
  if (!result.ok) return result;
  await discard(deps, result.value);
  return ok({ removed: true as const });
}

/** URL SIGNÉE à durée courte d'une pièce (permission contrôlée par la route ; l'émission est auditée `notice`). */
export async function getStudentDocumentUrl(deps: PeopleDeps, ctx: RequestContext, studentId: string, documentId: string): Promise<Result<PeopleStudentDocumentUrlDto, AppError>> {
  if (!deps.storage) return err(PeopleErrors.storageUnavailable());
  const storage = deps.storage;
  const found = await inTx(deps, ctx, async (tx) => {
    const row = await repo.getDocument(tx, ctx.tenantId, studentId, documentId);
    if (!row || row.status === "REMOVED") return err(PeopleErrors.documentNotFound(documentId));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.student.document_read", entity: "student", entityId: studentId, severity: "notice", metadata: { documentId, typeCode: row.typeCode, version: row.version } });
    await buffer.flush(tx);
    return ok(row);
  });
  if (!found.ok) return found;
  const ttlSec = deps.config.signedUrlTtlSec;
  return ok({ url: await storage.signedUrl(found.value.objectKey, { ttlSec }), expiresInSec: ttlSec, fileName: found.value.fileName, contentType: found.value.contentType });
}

/**
 * Job quotidien (par tenant) : publie `people.student_document.expiring` UNE fois par franchissement de seuil (idempotent :
 * `expiry_alerted_for` mémorise l'échéance déjà signalée ; une nouvelle échéance rouvre le droit à une alerte). Sans préavis
 * configuré (`settings.expiry_alert_days`), aucune alerte.
 */
export async function emitExpiringStudentDocuments(deps: PeopleDeps, ctx: RequestContext, options: { asOf?: string | undefined } = {}): Promise<Result<{ emitted: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const settings = await loadSettings(deps, tx, ctx, { write: false });
    if (settings.expiryAlertDays === null) return ok({ emitted: 0 });
    const asOf = options.asOf ?? todayOf(deps);
    const rows = await repo.lockUnalertedExpiring(tx, ctx.tenantId, asOf, settings.expiryAlertDays);
    const buffer = new EventBuffer(deps, ctx);
    for (const r of rows) {
      buffer.add(PEOPLE_EVENTS.studentDocumentExpiring, { v: 1, studentId: r.studentId, documentId: r.documentId, typeCode: r.typeCode, expiresOn: r.expiresOn, daysLeft: r.daysLeft }, { type: "student_document", id: r.documentId });
      await repo.markAlerted(tx, ctx.tenantId, r.documentId, r.expiresOn);
    }
    await buffer.flush(tx);
    return ok({ emitted: rows.length });
  });
}
