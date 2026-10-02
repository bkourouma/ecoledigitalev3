/**
 * Dépôt d'un document et d'une nouvelle version (spec 024 §5 et §7) : contrôles dans l'ordre (autorisation, descripteurs,
 * taille, nom, type réel, extension, quota, doublon), analyse antivirus HORS transaction, écriture atomique, quarantaine.
 *
 * Trois temps : (1) lecture et décision dans une transaction ; (2) analyse antivirus (réseau, hors transaction) ; (3) objet
 * puis lignes / historique / événements / audit dans UNE transaction, l'objet étant supprimé si elle échoue (compensation).
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { DocumentsEvents } from "../domain/events";
import type { DocumentCreateFields, DocumentDetailDto, DocumentVersionFields } from "@ecoledigitale/contracts/src/v2/documents";
import { buildSearchText, checkOwnerCoherence, normalizeAlertDays, normalizeTags, quarantineStorageKey, versionStorageKey } from "../domain/descriptors";
import { DocumentsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { isValidCalendarDay } from "../domain/expiry";
import { checkFile, type FileCheckOk } from "../domain/file-policy";
import { resolveCreate, type AccessVia } from "../domain/policy";
import type { Actor, ActorCaps, Uuid } from "../domain/types";
import * as docs from "../infrastructure/documents-repository";
import * as repo from "../infrastructure/settings-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { actorOf, categoryFactsOf, detailDto, effectiveQuota, ensureDefaults, loadVisible, nameBook, todayOf } from "./support";

export interface UploadedFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

const FILE_ERROR_CODES: Readonly<Record<string, (typeof DocumentsCode)[keyof typeof DocumentsCode]>> = {
  file_empty: DocumentsCode.FILE_EMPTY,
  file_too_large: DocumentsCode.FILE_TOO_LARGE,
  file_name_rejected: DocumentsCode.FILE_NAME_REJECTED,
  type_undetected: DocumentsCode.TYPE_UNDETECTED,
  type_mismatch: DocumentsCode.TYPE_MISMATCH,
  type_not_allowed: DocumentsCode.TYPE_NOT_ALLOWED,
  macro_content: DocumentsCode.MACRO_CONTENT,
};

/** Contrôle d'un fichier contre les limites effectives de la catégorie. */
export function inspectFile(deps: DocumentsDeps, file: UploadedFile, category: repo.CategoryRow, settings: repo.SettingsRow): Result<FileCheckOk, AppError> {
  const maxBytes = Math.min(category.maxBytes ?? settings.maxBytes, deps.config.hardMaxBytes);
  const check = checkFile({ fileName: file.fileName, bytes: file.bytes }, { maxBytes, allowedExtensions: category.allowedExtensions });
  if (check.ok) return ok(check);
  return err(validation(FILE_ERROR_CODES[check.code] ?? DocumentsCode.INVALID_INPUT, check.message, "file", { maxBytes, allowedExtensions: category.allowedExtensions }));
}

// ---------------------------------------------------------------------------
// Antivirus
// ---------------------------------------------------------------------------

type ScanOutcome =
  | { kind: "stored"; scanStatus: "CLEAN" | "UNSCANNED"; engine: string | null }
  | { kind: "infected"; signature: string; engine: string }
  | { kind: "refused"; error: AppError };

async function scanFile(deps: DocumentsDeps, check: FileCheckOk, bytes: Uint8Array): Promise<ScanOutcome> {
  const policy = deps.ports.scan;
  if (!policy.scanner) return { kind: "stored", scanStatus: "UNSCANNED", engine: null };
  const verdict = await policy.scanner.scan(bytes, { fileName: check.fileName, mime: check.mime });
  if (verdict.status === "CLEAN") return { kind: "stored", scanStatus: "CLEAN", engine: policy.scanner.engine };
  if (verdict.status === "INFECTED") return { kind: "infected", signature: verdict.signature, engine: policy.scanner.engine };
  deps.logger.warn({ engine: policy.scanner.engine, reason: verdict.reason }, "documents : analyse antivirus indisponible");
  if (policy.failClosed) {
    return { kind: "refused", error: validation(DocumentsCode.SCAN_UNAVAILABLE, "L'analyse antivirus est momentanément indisponible : le fichier n'a pas été enregistré. Réessayez dans un instant.", "file") };
  }
  return { kind: "stored", scanStatus: "UNSCANNED", engine: policy.scanner.engine };
}

/** Quarantaine d'un fichier détecté infectieux : objet isolé + ligne + événement + audit, PUIS refus du dépôt. */
async function quarantineUpload(
  deps: DocumentsDeps,
  ctx: RequestContext,
  input: { uploaderId: Uuid; check: FileCheckOk; bytes: Uint8Array; intent: sharesRepo.QuarantineIntent; signature: string; engine: string; categoryId: Uuid | null; documentId: Uuid | null },
): Promise<AppError> {
  const id = deps.newId();
  const key = quarantineStorageKey(ctx.tenantId, id);
  // Le contenu est conservé pour l'examen, sous un type neutre : il n'est JAMAIS servi par une URL de lecture.
  await deps.ports.storage.put(key, input.bytes, { contentType: "application/octet-stream" });
  const stored = await inTx(deps, ctx, async (tx) => {
    await sharesRepo.insertQuarantine(
      tx,
      ctx.tenantId,
      { id, storageKey: key, fileName: input.check.fileName, extension: input.check.extension, mime: input.check.mime, sizeBytes: input.check.size, sha256: input.check.sha256, signature: input.signature, engine: input.engine, intent: input.intent, uploadedBy: input.uploaderId },
      deps.clock.now(),
    );
    const events = new EventBuffer(deps, ctx);
    events.add(DocumentsEvents.UPLOAD_QUARANTINED, { v: 1, quarantineId: id, categoryId: input.categoryId, documentId: input.documentId, uploadedBy: input.uploaderId, signature: input.signature, engine: input.engine, sizeBytes: input.check.size }, { type: "quarantine", id });
    events.audit({ action: "documents.upload.quarantined", resourceType: "document_quarantine", resourceId: id, sensitive: true, metadata: { signature: input.signature, engine: input.engine, sizeBytes: input.check.size, sha256: input.check.sha256, categoryId: input.categoryId, documentId: input.documentId } });
    await events.flush(tx);
    return ok(id);
  });
  if (!stored.ok) {
    await deps.ports.storage.delete(key).catch(() => undefined);
    return stored.error;
  }
  return conflictMalware(stored.value);
}

const conflictMalware = (quarantineId: Uuid): AppError =>
  validation(DocumentsCode.MALWARE_DETECTED, "Le fichier a été détecté comme malveillant : il n'a pas été enregistré et a été placé en quarantaine.", "file", { quarantineId });

// ---------------------------------------------------------------------------
// Écritures partagées (dépôt direct et libération de quarantaine)
// ---------------------------------------------------------------------------

export interface NewDocumentArgs {
  id: Uuid;
  category: repo.CategoryRow;
  fields: DocumentCreateFields;
  check: FileCheckOk;
  storageKey: string;
  scanStatus: "CLEAN" | "UNSCANNED";
  scanEngine: string | null;
  uploaderId: Uuid;
  actorId: Uuid;
  via: AccessVia | "QUARANTINE_RELEASE";
}

/** Insère document + version 1 + historique + événement + audit ; renvoie l'usage de stockage après écriture. */
export async function persistNewDocument(deps: DocumentsDeps, ctx: RequestContext, tx: Tx, a: NewDocumentArgs): Promise<{ usedBytes: number }> {
  const now = deps.clock.now();
  const f = a.fields;
  const tags = normalizeTags(f.tags);
  const description = f.description?.trim() ? f.description.trim() : null;
  const ownerType = f.ownerType;
  const ownerId = ownerType === "NONE" ? null : (f.ownerId ?? null);
  await docs.insertDocument(
    tx,
    ctx.tenantId,
    {
      id: a.id, kind: a.category.kind, categoryId: a.category.id, title: f.title.trim(), description, tags, metadata: f.metadata, ownerType, ownerId, visibility: f.visibility,
      fileName: a.check.fileName, extension: a.check.extension, mime: a.check.mime, sizeBytes: a.check.size, expiresOn: f.expiresOn ?? null, alertDays: normalizeAlertDays(f.alertDays),
      createdBy: a.uploaderId, searchText: buildSearchText({ title: f.title, description, tags, fileName: a.check.fileName, metadata: f.metadata }),
    },
    now,
  );
  await docs.insertVersion(
    tx,
    ctx.tenantId,
    { id: deps.newId(), documentId: a.id, versionNo: 1, storageKey: a.storageKey, fileName: a.check.fileName, extension: a.check.extension, mime: a.check.mime, sizeBytes: a.check.size, sha256: a.check.sha256, scanStatus: a.scanStatus, scanEngine: a.scanEngine, note: f.note ?? null, uploadedBy: a.uploaderId },
    now,
  );
  await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: a.id, versionNo: 1, action: "CREATED", actorId: a.actorId, detail: { via: a.via, sizeBytes: a.check.size, mime: a.check.mime, scanStatus: a.scanStatus } }, now);
  const events = new EventBuffer(deps, ctx);
  events.add(
    DocumentsEvents.DOCUMENT_CREATED,
    { v: 1, documentId: a.id, categoryId: a.category.id, kind: a.category.kind, ownerType, ownerId, versionNo: 1, createdBy: a.uploaderId },
    { type: "document", id: a.id },
  );
  events.audit({
    action: "documents.document.created",
    resourceType: "document",
    resourceId: a.id,
    sensitive: a.category.confidentiality === "CONFIDENTIAL",
    metadata: { categoryId: a.category.id, categoryCode: a.category.code, kind: a.category.kind, ownerType, ownerId, sizeBytes: a.check.size, mime: a.check.mime, sha256: a.check.sha256, scanStatus: a.scanStatus, via: a.via },
  });
  await events.flush(tx);
  return { usedBytes: (await docs.usageCounts(tx, ctx.tenantId)).usedBytes };
}

export interface NewVersionArgs {
  row: docs.DocumentRow;
  check: FileCheckOk;
  storageKey: string;
  versionNo: number;
  scanStatus: "CLEAN" | "UNSCANNED";
  scanEngine: string | null;
  uploaderId: Uuid;
  actorId: Uuid;
  note: string | null;
  /** `undefined` : l'échéance ne change pas ; `null` : retirée ; chaîne : nouvelle échéance (réarme les alertes). */
  expiresOn: string | null | undefined;
  via: AccessVia | "QUARANTINE_RELEASE";
}

export async function persistNewVersion(deps: DocumentsDeps, ctx: RequestContext, tx: Tx, a: NewVersionArgs): Promise<{ usedBytes: number }> {
  const now = deps.clock.now();
  await docs.insertVersion(
    tx,
    ctx.tenantId,
    { id: deps.newId(), documentId: a.row.id, versionNo: a.versionNo, storageKey: a.storageKey, fileName: a.check.fileName, extension: a.check.extension, mime: a.check.mime, sizeBytes: a.check.size, sha256: a.check.sha256, scanStatus: a.scanStatus, scanEngine: a.scanEngine, note: a.note, uploadedBy: a.uploaderId },
    now,
  );
  await docs.updateDocumentHead(
    tx,
    ctx.tenantId,
    a.row.id,
    {
      versionNo: a.versionNo, fileName: a.check.fileName, extension: a.check.extension, mime: a.check.mime, sizeBytes: a.check.size, updatedBy: a.actorId, expiresOn: a.expiresOn,
      searchText: buildSearchText({ title: a.row.title, description: a.row.description, tags: a.row.tags, fileName: a.check.fileName, metadata: a.row.metadata }),
    },
    now,
  );
  await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: a.row.id, versionNo: a.versionNo, action: "VERSION_ADDED", actorId: a.actorId, detail: { via: a.via, sizeBytes: a.check.size, mime: a.check.mime, scanStatus: a.scanStatus, expiresOnChanged: a.expiresOn !== undefined } }, now);
  const events = new EventBuffer(deps, ctx);
  events.add(
    DocumentsEvents.DOCUMENT_VERSION_ADDED,
    { v: 1, documentId: a.row.id, categoryId: a.row.categoryId, kind: a.row.kind, ownerType: a.row.ownerType, ownerId: a.row.ownerId, versionNo: a.versionNo, uploadedBy: a.uploaderId },
    { type: "document", id: a.row.id },
  );
  events.audit({
    action: "documents.document.version_added",
    resourceType: "document",
    resourceId: a.row.id,
    sensitive: a.row.confidentiality === "CONFIDENTIAL",
    metadata: { versionNo: a.versionNo, categoryId: a.row.categoryId, sizeBytes: a.check.size, mime: a.check.mime, sha256: a.check.sha256, scanStatus: a.scanStatus, via: a.via },
  });
  await events.flush(tx);
  return { usedBytes: (await docs.usageCounts(tx, ctx.tenantId)).usedBytes };
}

/** Détail d'un document tel que le voit l'appelant (après écriture, dans la même transaction). */
export async function buildDetail(deps: DocumentsDeps, tx: Tx, ctx: RequestContext, actor: Actor, documentId: Uuid, settings: repo.SettingsRow): Promise<Result<DocumentDetailDto, AppError>> {
  const loaded = await loadVisible(deps, tx, ctx, actor, documentId);
  if (!loaded.ok) return loaded;
  const { row, access } = loaded.value;
  const versions = await docs.listVersions(tx, ctx.tenantId, documentId);
  const shares = access.share || actor.caps.manage === true ? await sharesRepo.listShares(tx, ctx.tenantId, documentId) : null;
  const names = await nameBook(deps, ctx, [row], [...versions.map((v) => v.uploadedBy), ...(shares ?? []).flatMap((s) => [s.userId, s.createdBy])]);
  return ok(detailDto(row, access, names, settings, todayOf(deps), versions, shares, deps.clock.now()));
}

export async function reportUsage(deps: DocumentsDeps, ctx: RequestContext, usedBytes: number): Promise<void> {
  try {
    await deps.ports.usage.reportStorageBytes(ctx, usedBytes);
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "documents : mesure d'usage non transmise");
  }
}

/** Écrit l'objet, exécute `fn` ; supprime l'objet si la transaction échoue (Err ou exception). */
export async function withObject<T>(deps: DocumentsDeps, key: string, bytes: Uint8Array, contentType: string, fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
  try {
    await deps.ports.storage.put(key, bytes, { contentType });
  } catch (e) {
    if (isAppError(e)) return err(e);
    throw e;
  }
  try {
    const result = await fn();
    if (!result.ok) await deps.ports.storage.delete(key).catch(() => undefined);
    return result;
  } catch (e) {
    await deps.ports.storage.delete(key).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Création d'un document
// ---------------------------------------------------------------------------

export async function createDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; fields: DocumentCreateFields; file: UploadedFile }): Promise<Result<DocumentDetailDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const f = input.fields;

  // ---- Temps 1 : décision
  const prepared = await inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const category = await repo.getCategory(tx, ctx.tenantId, f.categoryId);
    if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", f.categoryId));
    if (category.status !== "ACTIVE") return err(conflict(DocumentsCode.CATEGORY_ARCHIVED, "Cette catégorie est archivée : plus aucun dépôt n'y est possible."));
    const coherence = checkOwnerCoherence(category.kind, f.ownerType, f.ownerId);
    if (!coherence.ok) return err(validation(coherence.code === "owner_required" ? DocumentsCode.OWNER_REQUIRED : DocumentsCode.OWNER_NOT_ALLOWED, coherence.message, "ownerId"));
    const grant = await repo.getActiveGrantOfUser(tx, ctx.tenantId, category.id, actor.userId, deps.clock.now());
    const decision = resolveCreate(actor, categoryFactsOf(category), { type: f.ownerType, id: f.ownerId ?? null }, grant?.level ?? null);
    if (!decision.allowed) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'êtes pas autorisé à déposer un document dans cette catégorie pour cette personne."));
    if (f.ownerType !== "NONE" && f.ownerId) {
      const found = await deps.ports.owners.existingOwners(ctx, f.ownerType, [f.ownerId]);
      if (!found.has(f.ownerId)) return err(validation(DocumentsCode.OWNER_NOT_FOUND, f.ownerType === "STUDENT" ? "Élève introuvable." : "Membre du personnel introuvable.", "ownerId"));
    }
    if (f.expiresOn && !isValidCalendarDay(f.expiresOn)) return err(validation(DocumentsCode.INVALID_INPUT, "Date d'expiration invalide.", "expiresOn"));
    if (category.requiresExpiry && !f.expiresOn) return err(validation(DocumentsCode.EXPIRY_REQUIRED, "Cette catégorie exige une date d'expiration.", "expiresOn"));
    const checked = inspectFile(deps, input.file, category, settings);
    if (!checked.ok) return checked;
    const plan = await deps.ports.planQuota(ctx);
    const usage = await docs.usageCounts(tx, ctx.tenantId);
    if (usage.usedBytes + checked.value.size > effectiveQuota(plan, settings)) return err(validation(DocumentsCode.QUOTA_EXCEEDED, "Le quota de stockage de l'établissement est atteint.", "file", { quotaBytes: effectiveQuota(plan, settings), usedBytes: usage.usedBytes }));
    const duplicate = await docs.findVisibleDuplicate(tx, ctx.tenantId, actor, deps.clock.now(), { sha256: checked.value.sha256, categoryId: category.id, ownerType: f.ownerType, ownerId: f.ownerId ?? null });
    if (duplicate) return err(conflict(DocumentsCode.DUPLICATE, "Ce fichier existe déjà dans cette catégorie pour cette personne.", { documentId: duplicate }));
    return ok({ category, check: checked.value, via: decision.via as AccessVia });
  });
  if (!prepared.ok) return prepared;
  const { category, check, via } = prepared.value;

  // ---- Temps 2 : antivirus (hors transaction)
  const scan = await scanFile(deps, check, input.file.bytes);
  if (scan.kind === "refused") return err(scan.error);
  if (scan.kind === "infected") {
    return err(
      await quarantineUpload(deps, ctx, {
        uploaderId: actor.userId, check, bytes: input.file.bytes, signature: scan.signature, engine: scan.engine, categoryId: category.id, documentId: null,
        intent: { mode: "CREATE", fields: { ...f, ownerId: f.ownerId ?? null } },
      }),
    );
  }

  // ---- Temps 3 : écriture atomique
  const id = deps.newId();
  const key = versionStorageKey(ctx.tenantId, id, 1, check.sha256);
  let used = 0;
  const written = await withObject(deps, key, input.file.bytes, check.mime, () =>
    inTx(deps, ctx, async (tx) => {
      const settings = await ensureDefaults(deps, tx, ctx);
      const plan = await deps.ports.planQuota(ctx);
      const usage = await docs.usageCounts(tx, ctx.tenantId);
      if (usage.usedBytes + check.size > effectiveQuota(plan, settings)) return err(validation(DocumentsCode.QUOTA_EXCEEDED, "Le quota de stockage de l'établissement est atteint.", "file"));
      const persisted = await persistNewDocument(deps, ctx, tx, { id, category, fields: f, check, storageKey: key, scanStatus: scan.scanStatus, scanEngine: scan.engine, uploaderId: actor.userId, actorId: actor.userId, via });
      used = persisted.usedBytes;
      return buildDetail(deps, tx, ctx, actor, id, settings);
    }),
  );
  if (!written.ok) return written;
  await reportUsage(deps, ctx, used);
  return written;
}

// ---------------------------------------------------------------------------
// Nouvelle version
// ---------------------------------------------------------------------------

export async function addVersion(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; fields: DocumentVersionFields; file: UploadedFile }): Promise<Result<DocumentDetailDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const f = input.fields;

  const prepared = await inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId);
    if (!loaded.ok) return loaded;
    const { row, access } = loaded.value;
    if (row.status === "ARCHIVED") return err(conflict(DocumentsCode.ARCHIVED, "Ce document est archivé : restaurez-le avant d'y déposer une version."));
    if (!access.write) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit de déposer une version de ce document."));
    if (f.baseVersion !== undefined && f.baseVersion !== row.currentVersionNo) return err(conflict(DocumentsCode.VERSION_CONFLICT, "Une autre version a été déposée entre-temps : rechargez le document.", { currentVersionNo: row.currentVersionNo }));
    if (row.versionCount >= settings.maxVersions) return err(conflict(DocumentsCode.TOO_MANY_VERSIONS, `Ce document a atteint le nombre maximal de versions (${settings.maxVersions}).`));
    const category = await repo.getCategory(tx, ctx.tenantId, row.categoryId);
    if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", row.categoryId));
    if (f.expiresOn && !isValidCalendarDay(f.expiresOn)) return err(validation(DocumentsCode.INVALID_INPUT, "Date d'expiration invalide.", "expiresOn"));
    const today = todayOf(deps);
    const expiredOrUnknown = row.expiresOn === null || row.expiresOn < today;
    if (category.requiresExpiry && f.expiresOn === undefined && expiredOrUnknown) return err(validation(DocumentsCode.EXPIRY_REQUIRED, "Cette catégorie exige une nouvelle date d'expiration pour cette version.", "expiresOn"));
    if (category.requiresExpiry && f.expiresOn === null) return err(validation(DocumentsCode.EXPIRY_REQUIRED, "Cette catégorie exige une date d'expiration.", "expiresOn"));
    const checked = inspectFile(deps, input.file, category, settings);
    if (!checked.ok) return checked;
    const current = await docs.getVersion(tx, ctx.tenantId, row.id, row.currentVersionNo);
    if (current && current.sha256 === checked.value.sha256) return err(conflict(DocumentsCode.VERSION_IDENTICAL, "Ce fichier est identique à la version actuelle.", { versionNo: row.currentVersionNo }));
    const plan = await deps.ports.planQuota(ctx);
    const usage = await docs.usageCounts(tx, ctx.tenantId);
    if (usage.usedBytes + checked.value.size > effectiveQuota(plan, settings)) return err(validation(DocumentsCode.QUOTA_EXCEEDED, "Le quota de stockage de l'établissement est atteint.", "file", { quotaBytes: effectiveQuota(plan, settings), usedBytes: usage.usedBytes }));
    return ok({ row, check: checked.value, via: (access.via[0] ?? "LEVEL") as AccessVia });
  });
  if (!prepared.ok) return prepared;
  const { row: seen, check, via } = prepared.value;

  const scan = await scanFile(deps, check, input.file.bytes);
  if (scan.kind === "refused") return err(scan.error);
  if (scan.kind === "infected") {
    return err(
      await quarantineUpload(deps, ctx, {
        uploaderId: actor.userId, check, bytes: input.file.bytes, signature: scan.signature, engine: scan.engine, categoryId: seen.categoryId, documentId: seen.id,
        intent: { mode: "VERSION", documentId: seen.id, fields: { note: f.note ?? null, expiresOn: f.expiresOn ?? null, expiresOnProvided: f.expiresOn !== undefined } },
      }),
    );
  }

  const versionNo = seen.currentVersionNo + 1;
  const key = versionStorageKey(ctx.tenantId, seen.id, versionNo, check.sha256);
  let used = 0;
  const written = await withObject(deps, key, input.file.bytes, check.mime, () =>
    inTx(deps, ctx, async (tx) => {
      const settings = await ensureDefaults(deps, tx, ctx);
      const locked = await loadVisible(deps, tx, ctx, actor, seen.id, { forUpdate: true });
      if (!locked.ok) return locked;
      if (locked.value.row.currentVersionNo !== seen.currentVersionNo || locked.value.row.status !== "ACTIVE") {
        return err(conflict(DocumentsCode.VERSION_CONFLICT, "Une autre version a été déposée entre-temps : rechargez le document.", { currentVersionNo: locked.value.row.currentVersionNo }));
      }
      const plan = await deps.ports.planQuota(ctx);
      const usage = await docs.usageCounts(tx, ctx.tenantId);
      if (usage.usedBytes + check.size > effectiveQuota(plan, settings)) return err(validation(DocumentsCode.QUOTA_EXCEEDED, "Le quota de stockage de l'établissement est atteint.", "file"));
      const persisted = await persistNewVersion(deps, ctx, tx, { row: locked.value.row, check, storageKey: key, versionNo, scanStatus: scan.scanStatus, scanEngine: scan.engine, uploaderId: actor.userId, actorId: actor.userId, note: f.note ?? null, expiresOn: f.expiresOn, via });
      used = persisted.usedBytes;
      return buildDetail(deps, tx, ctx, actor, seen.id, settings);
    }),
  );
  if (!written.ok) return written;
  await reportUsage(deps, ctx, used);
  return written;
}

