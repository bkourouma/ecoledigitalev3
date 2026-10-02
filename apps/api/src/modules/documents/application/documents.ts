/**
 * Lecture et cycle de vie des documents : liste paginée, détail, métadonnées, archivage / restauration, téléchargement par URL
 * signée courte, prévisualisation sûre, historique, compteurs, recherche de personnes.
 *
 * Chaque lecture / prévisualisation / téléchargement d'UN document écrit son historique et son audit (traçabilité de chaque
 * lecture) ; un document invisible est indiscernable d'un document inexistant (404).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  DocumentArchiveResultDto,
  DocumentDetailDto,
  DocumentGuardianListDto,
  DocumentHistoryPageDto,
  DocumentListQuery,
  DocumentPageDto,
  DocumentPersonDto,
  DocumentPersonQuery,
  DocumentSignedUrlDto,
  DocumentSummaryCountsDto,
  DocumentUpdateBody,
} from "@ecoledigitale/contracts/src/v2/documents";
import { DocumentsEvents } from "../domain/events";
import { buildSearchText, normalizeAlertDays, normalizeTags, renditionStorageKey } from "../domain/descriptors";
import { checkOwnerCoherence } from "../domain/descriptors";
import { DocumentsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { addDays, isValidCalendarDay } from "../domain/expiry";
import { previewKindOf, sha256Hex } from "../domain/file-policy";
import { resolveCreate } from "../domain/policy";
import type { ActorCaps, Uuid } from "../domain/types";
import * as docs from "../infrastructure/documents-repository";
import * as repo from "../infrastructure/settings-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { buildDetail } from "./uploads";
import { actorOf, categoryFactsOf, decodeCursor, encodeCursor, ensureDefaults, factsOf, iso, loadVisible, nameBook, summaryDto, todayOf } from "./support";
import { resolveAccess } from "../domain/policy";

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

export async function listDocuments(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; query: DocumentListQuery }): Promise<Result<DocumentPageDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const q = input.query;
  const status = q.status ?? "ACTIVE";
  if (status !== "ACTIVE" && actor.caps.manage !== true) return err(forbidden(DocumentsCode.FORBIDDEN, "Les documents archivés ne sont consultables que par la gestion."));
  const limit = Math.min(q.limit ?? deps.config.pageSizeDefault, 100);

  // La recherche par nom de PROPRIÉTAIRE passe par l'annuaire (séquentiel, avant la transaction de lecture).
  let ownerIds: Uuid[] = [];
  const text = q.q?.trim();
  if (text && text.length >= 2) {
    const students = await deps.ports.owners.searchOwners(ctx, "STUDENT", text, 25);
    const staff = await deps.ports.owners.searchOwners(ctx, "STAFF", text, 25);
    ownerIds = [...students, ...staff].map((p) => p.id);
  }

  const sort = q.sort ?? "updatedAt";
  const dir = q.dir ?? (sort === "title" || sort === "expiresOn" ? "asc" : "desc");
  const cursor = decodeCursor<{ v: string; id: string }>(q.cursor);
  const today = todayOf(deps);

  const loaded = await inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const rows = await docs.listDocuments(tx, ctx.tenantId, actor, deps.clock.now(), {
      q: text && text.length >= 1 ? text : undefined,
      ownerIdsMatchingQuery: ownerIds,
      categoryId: q.categoryId,
      kind: q.kind,
      ownerType: q.ownerType,
      ownerId: q.ownerId,
      status,
      expiry: q.expiry,
      withinDays: q.withinDays ?? 30,
      today,
      scope: q.scope,
      sort,
      dir,
      cursor: cursor ? { value: cursor.v, id: cursor.id } : undefined,
      limit,
    });
    return ok({ rows, settings });
  });
  if (!loaded.ok) return loaded;
  const { rows, settings } = loaded.value;
  const page = rows.slice(0, limit);
  const names = await nameBook(deps, ctx, page);
  const items = page.map((r) => summaryDto(r, resolveAccess(actor, factsOf(r)), names, settings, today));
  const last = page[page.length - 1];
  return ok({ items, nextCursor: rows.length > limit && last ? encodeCursor({ v: last.sortValue, id: last.id }) : null });
}

export async function expirationCounts(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; withinDays?: number | undefined }): Promise<Result<DocumentSummaryCountsDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const within = input.withinDays ?? 30;
  return inTx(deps, ctx, async (tx) => {
    await ensureDefaults(deps, tx, ctx);
    const c = await docs.countExpirations(tx, ctx.tenantId, actor, deps.clock.now(), todayOf(deps), within);
    const held = actor.caps.quarantineManage === true ? await sharesRepo.countHeldQuarantine(tx, ctx.tenantId) : null;
    return ok({ ...c, quarantineHeld: held, withinDays: within });
  });
}

// ---------------------------------------------------------------------------
// Détail (lecture auditée)
// ---------------------------------------------------------------------------

export async function getDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid }): Promise<Result<DocumentDetailDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  return inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const detail = await buildDetail(deps, tx, ctx, actor, input.documentId, settings);
    if (!detail.ok) return detail;
    const events = new EventBuffer(deps, ctx);
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: input.documentId, action: "VIEWED", actorId: actor.userId }, deps.clock.now());
    events.audit({
      action: "documents.document.read",
      resourceType: "document",
      resourceId: input.documentId,
      sensitive: detail.value.confidentiality === "CONFIDENTIAL",
      metadata: { categoryId: detail.value.categoryId, via: detail.value.access.via },
    });
    await events.flush(tx);
    return detail;
  });
}

// ---------------------------------------------------------------------------
// Métadonnées
// ---------------------------------------------------------------------------

export async function updateDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; body: DocumentUpdateBody }): Promise<Result<DocumentDetailDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const b = input.body;
  return inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const { row, access } = loaded.value;
    if (row.status === "ARCHIVED") return err(conflict(DocumentsCode.ARCHIVED, "Ce document est archivé."));
    if (!access.write) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit de modifier ce document."));

    let category: repo.CategoryRow | null = null;
    let newCategory: repo.CategoryRow | null = null;
    if (b.categoryId !== undefined && b.categoryId !== row.categoryId) {
      newCategory = await repo.getCategory(tx, ctx.tenantId, b.categoryId);
      if (!newCategory) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", b.categoryId));
      if (newCategory.status !== "ACTIVE") return err(conflict(DocumentsCode.CATEGORY_ARCHIVED, "Cette catégorie est archivée."));
      if (newCategory.kind !== row.kind) return err(validation(DocumentsCode.KIND_MISMATCH, "Un document ne peut changer que de catégorie du même type.", "categoryId"));
      const grant = await repo.getActiveGrantOfUser(tx, ctx.tenantId, newCategory.id, actor.userId, deps.clock.now());
      if (!resolveCreate(actor, categoryFactsOf(newCategory), { type: row.ownerType, id: row.ownerId }, grant?.level ?? null).allowed) {
        return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'êtes pas autorisé à classer ce document dans cette catégorie."));
      }
      if (!newCategory.allowedExtensions.includes(row.extension)) return err(validation(DocumentsCode.TYPE_NOT_ALLOWED, `Les fichiers « .${row.extension} » ne sont pas acceptés dans cette catégorie.`, "categoryId"));
      const maxBytes = Math.min(newCategory.maxBytes ?? settings.maxBytes, deps.config.hardMaxBytes);
      if (row.sizeBytes > maxBytes) return err(validation(DocumentsCode.FILE_TOO_LARGE, "Le fichier dépasse la taille maximale de cette catégorie.", "categoryId"));
      category = newCategory;
    } else {
      category = await repo.getCategory(tx, ctx.tenantId, row.categoryId);
    }
    if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", row.categoryId));

    const owner = checkOwnerCoherence(category.kind, row.ownerType, row.ownerId);
    if (!owner.ok) return err(validation(DocumentsCode.OWNER_REQUIRED, owner.message, "categoryId"));
    if (b.expiresOn !== undefined) {
      if (b.expiresOn !== null && !isValidCalendarDay(b.expiresOn)) return err(validation(DocumentsCode.INVALID_INPUT, "Date d'expiration invalide.", "expiresOn"));
      if (b.expiresOn === null && category.requiresExpiry) return err(validation(DocumentsCode.EXPIRY_REQUIRED, "Cette catégorie exige une date d'expiration.", "expiresOn"));
    }
    if (category.requiresExpiry && row.expiresOn === null && b.expiresOn === undefined && newCategory) {
      return err(validation(DocumentsCode.EXPIRY_REQUIRED, "La nouvelle catégorie exige une date d'expiration.", "expiresOn"));
    }

    const tags = b.tags !== undefined ? normalizeTags(b.tags) : row.tags;
    const description = b.description !== undefined ? (b.description?.trim() ? b.description.trim() : null) : row.description;
    const title = b.title !== undefined ? b.title.trim() : row.title;
    const metadata = b.metadata ?? row.metadata;
    const now = deps.clock.now();
    await docs.updateDocumentFields(
      tx,
      ctx.tenantId,
      row.id,
      {
        ...(b.title !== undefined ? { title } : {}),
        ...(b.description !== undefined ? { description } : {}),
        ...(b.tags !== undefined ? { tags } : {}),
        ...(b.metadata !== undefined ? { metadata } : {}),
        ...(newCategory ? { categoryId: newCategory.id } : {}),
        ...(b.visibility !== undefined ? { visibility: b.visibility } : {}),
        ...(b.expiresOn !== undefined ? { expiresOn: b.expiresOn } : {}),
        ...(b.alertDays !== undefined ? { alertDays: normalizeAlertDays(b.alertDays) } : {}),
        searchText: buildSearchText({ title, description, tags, fileName: row.fileName, metadata }),
      },
      actor.userId,
      now,
    );
    const changed = Object.keys(b);
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, action: "UPDATED", actorId: actor.userId, detail: { changed } }, now);
    const events = new EventBuffer(deps, ctx);
    events.add(
      DocumentsEvents.DOCUMENT_UPDATED,
      { v: 1, documentId: row.id, categoryId: newCategory?.id ?? row.categoryId, kind: row.kind, ownerType: row.ownerType, ownerId: row.ownerId, changed, updatedBy: actor.userId },
      { type: "document", id: row.id },
    );
    events.audit({
      action: "documents.document.updated",
      resourceType: "document",
      resourceId: row.id,
      sensitive: b.visibility !== undefined && b.visibility !== row.visibility,
      before: { visibility: row.visibility, categoryId: row.categoryId, expiresOn: row.expiresOn },
      after: { visibility: b.visibility ?? row.visibility, categoryId: newCategory?.id ?? row.categoryId, expiresOn: b.expiresOn === undefined ? row.expiresOn : b.expiresOn },
      metadata: { changed },
    });
    await events.flush(tx);
    return buildDetail(deps, tx, ctx, actor, row.id, settings);
  });
}

// ---------------------------------------------------------------------------
// Archivage (suppression logique) et restauration
// ---------------------------------------------------------------------------

export async function archiveDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; reason: string }): Promise<Result<DocumentArchiveResultDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  return inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const { row, access } = loaded.value;
    if (!access.archive) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit d'archiver ce document."));
    if (row.status === "ARCHIVED") return err(conflict(DocumentsCode.ARCHIVED, "Ce document est déjà archivé."));
    const now = deps.clock.now();
    const retention = row.categoryRetentionDays ?? settings.archiveRetentionDays;
    const purgeAfter = retention > 0 ? new Date(now.getTime() + retention * 86_400_000) : null;
    await docs.archiveDocument(tx, ctx.tenantId, row.id, actor.userId, input.reason.trim(), purgeAfter, now);
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, action: "ARCHIVED", actorId: actor.userId, detail: { purgeAfter: purgeAfter?.toISOString() ?? null } }, now);
    const events = new EventBuffer(deps, ctx);
    events.add(
      DocumentsEvents.DOCUMENT_ARCHIVED,
      { v: 1, documentId: row.id, categoryId: row.categoryId, kind: row.kind, ownerType: row.ownerType, ownerId: row.ownerId, archivedBy: actor.userId, purgeAfter: purgeAfter?.toISOString() ?? null },
      { type: "document", id: row.id },
    );
    events.audit({ action: "documents.document.archived", resourceType: "document", resourceId: row.id, sensitive: true, reason: input.reason.trim(), metadata: { categoryId: row.categoryId, purgeAfter: purgeAfter?.toISOString() ?? null } });
    await events.flush(tx);
    // Un archivé n'est plus visible hors gestion : l'archiveur reçoit un accusé minimal.
    return ok({ id: row.id, status: "ARCHIVED" as const, archivedAt: now.toISOString(), purgeAfter: purgeAfter?.toISOString() ?? null });
  });
}

export async function restoreDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid }): Promise<Result<DocumentDetailDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  return inTx(deps, ctx, async (tx) => {
    const settings = await ensureDefaults(deps, tx, ctx);
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const { row } = loaded.value;
    if (actor.caps.manage !== true) return err(forbidden(DocumentsCode.FORBIDDEN, "Seule la gestion restaure un document archivé."));
    if (row.status !== "ARCHIVED" || row.purgedAt) return err(conflict(DocumentsCode.NOT_ARCHIVED, row.purgedAt ? "Ce document a été purgé : il ne peut plus être restauré." : "Ce document n'est pas archivé."));
    const now = deps.clock.now();
    await docs.restoreDocument(tx, ctx.tenantId, row.id, actor.userId, now);
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, action: "RESTORED", actorId: actor.userId }, now);
    const events = new EventBuffer(deps, ctx);
    events.add(DocumentsEvents.DOCUMENT_RESTORED, { v: 1, documentId: row.id, categoryId: row.categoryId, kind: row.kind, ownerType: row.ownerType, ownerId: row.ownerId, restoredBy: actor.userId }, { type: "document", id: row.id });
    events.audit({ action: "documents.document.restored", resourceType: "document", resourceId: row.id, sensitive: true, metadata: { categoryId: row.categoryId } });
    await events.flush(tx);
    return buildDetail(deps, tx, ctx, actor, row.id, settings);
  });
}

// ---------------------------------------------------------------------------
// Téléchargement contrôlé (URL signée courte)
// ---------------------------------------------------------------------------

export async function getDownloadUrl(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; versionNo?: number | undefined }): Promise<Result<DocumentSignedUrlDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId);
    if (!loaded.ok) return loaded;
    const { row, access } = loaded.value;
    const version = await docs.getVersion(tx, ctx.tenantId, row.id, input.versionNo ?? row.currentVersionNo);
    if (!version) return err(notFound(DocumentsCode.VERSION_NOT_FOUND, "Version", String(input.versionNo ?? row.currentVersionNo)));
    if (version.state === "PURGED") return err(conflict(DocumentsCode.OBJECT_MISSING, "Le fichier de cette version a été purgé."));
    const signed = await deps.ports.storage.signedUrl(version.storageKey, { ttlSeconds: deps.config.signedUrlTtlSeconds, fileName: version.fileName, contentType: version.mime });
    const now = deps.clock.now();
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, versionNo: version.versionNo, action: "DOWNLOADED", actorId: actor.userId, detail: { via: access.via } }, now);
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "documents.document.downloaded",
      resourceType: "document",
      resourceId: row.id,
      sensitive: row.confidentiality === "CONFIDENTIAL",
      metadata: { versionNo: version.versionNo, categoryId: row.categoryId, sha256: version.sha256, via: access.via },
    });
    await events.flush(tx);
    return ok({ url: signed.url, expiresAt: iso(signed.expiresAt), fileName: version.fileName, mime: version.mime, versionNo: version.versionNo });
  });
}

// ---------------------------------------------------------------------------
// Prévisualisation sûre
// ---------------------------------------------------------------------------

export interface PreviewResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly kind: "IMAGE" | "PDF" | "TEXT";
  readonly truncated: boolean;
}

export async function getPreview(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; versionNo?: number | undefined; officeEnabled: boolean }): Promise<Result<PreviewResult, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;

  const prepared = await inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId);
      if (!loaded.ok) return loaded;
      const { row, access } = loaded.value;
      const version = await docs.getVersion(tx, ctx.tenantId, row.id, input.versionNo ?? row.currentVersionNo);
      if (!version) return err(notFound(DocumentsCode.VERSION_NOT_FOUND, "Version", String(input.versionNo ?? row.currentVersionNo)));
      if (version.state === "PURGED") return err(conflict(DocumentsCode.OBJECT_MISSING, "Le fichier de cette version a été purgé."));
      return ok({ row, access, version });
    },
    { readOnly: true },
  );
  if (!prepared.ok) return prepared;
  const { row, access, version } = prepared.value;
  const kind = previewKindOf(version.mime);
  if (kind === "NONE") return err(validation(DocumentsCode.PREVIEW_UNAVAILABLE, "Ce type de fichier ne peut pas être prévisualisé : téléchargez-le.", "version"));
  if (kind === "OFFICE" && !(input.officeEnabled && deps.ports.converter.enabled)) {
    return err(validation(DocumentsCode.PREVIEW_UNAVAILABLE, "La prévisualisation des documents Office n'est pas activée : téléchargez le fichier.", "version"));
  }

  const object = await deps.ports.storage.get(version.storageKey);
  if (!object) return err(conflict(DocumentsCode.OBJECT_MISSING, "Le fichier est introuvable dans le stockage."));
  // Intégrité : le contenu relu doit avoir l'empreinte enregistrée au dépôt.
  if (sha256Hex(object.bytes) !== version.sha256) {
    await inTx(deps, ctx, async (tx) => {
      const now = deps.clock.now();
      await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, versionNo: version.versionNo, action: "INTEGRITY_FAILED", actorId: actor.userId }, now);
      const events = new EventBuffer(deps, ctx);
      events.add(DocumentsEvents.INTEGRITY_MISMATCH, { v: 1, documentId: row.id, categoryId: row.categoryId, kind: row.kind, ownerType: row.ownerType, ownerId: row.ownerId, versionNo: version.versionNo }, { type: "document", id: row.id });
      events.audit({ action: "documents.integrity.mismatch", resourceType: "document", resourceId: row.id, sensitive: true, metadata: { versionNo: version.versionNo, expectedSha256: version.sha256 } });
      await events.flush(tx);
      return ok(true as const);
    });
    return err(conflict(DocumentsCode.INTEGRITY_FAILED, "L'empreinte du fichier ne correspond pas à celle enregistrée : lecture refusée."));
  }

  let result: PreviewResult;
  if (kind === "OFFICE") {
    const rendition = await officeRendition(deps, ctx, row.id, version, object.bytes);
    if (!rendition) return err(validation(DocumentsCode.PREVIEW_UNAVAILABLE, "La conversion du document en PDF a échoué : téléchargez le fichier.", "version"));
    result = { bytes: rendition, contentType: "application/pdf", fileName: `${version.fileName.replace(/\.[^.]+$/, "")}.pdf`, kind: "PDF", truncated: false };
  } else if (kind === "TEXT") {
    const max = deps.config.previewTextMaxBytes;
    const truncated = object.bytes.byteLength > max;
    result = { bytes: truncated ? object.bytes.subarray(0, max) : object.bytes, contentType: "text/plain; charset=utf-8", fileName: version.fileName, kind: "TEXT", truncated };
  } else {
    result = { bytes: object.bytes, contentType: version.mime, fileName: version.fileName, kind, truncated: false };
  }

  const recorded = await inTx(deps, ctx, async (tx) => {
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, versionNo: version.versionNo, action: "PREVIEWED", actorId: actor.userId, detail: { via: access.via } }, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "documents.document.previewed",
      resourceType: "document",
      resourceId: row.id,
      sensitive: row.confidentiality === "CONFIDENTIAL",
      metadata: { versionNo: version.versionNo, categoryId: row.categoryId, via: access.via },
    });
    await events.flush(tx);
    return ok(true as const);
  });
  if (!recorded.ok) return recorded;
  return ok(result);
}

/** PDF dérivé d'un document Office : calculé une fois, conservé (rendition jetable, hors quota). */
async function officeRendition(deps: DocumentsDeps, ctx: RequestContext, documentId: Uuid, version: docs.VersionRow, bytes: Uint8Array): Promise<Uint8Array | null> {
  if (version.renditionKey) {
    const cached = await deps.ports.storage.get(version.renditionKey);
    if (cached) return cached.bytes;
  }
  const pdf = await deps.ports.converter.toPdf(bytes, { extension: version.extension, mime: version.mime });
  if (!pdf || pdf.byteLength === 0) return null;
  const key = renditionStorageKey(ctx.tenantId, documentId, version.versionNo, version.sha256);
  await deps.ports.storage.put(key, pdf, { contentType: "application/pdf" });
  await inTx(deps, ctx, async (tx) => {
    await docs.setVersionRendition(tx, ctx.tenantId, version.id, key, deps.clock.now());
    return ok(true as const);
  });
  return pdf;
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export async function getHistory(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; cursor?: string | undefined; limit?: number | undefined }): Promise<Result<DocumentHistoryPageDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const limit = Math.min(input.limit ?? 50, 200);
  const cursor = decodeCursor<{ at: string; id: string }>(input.cursor);
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const found = await loadVisible(deps, tx, ctx, actor, input.documentId);
      if (!found.ok) return found;
      if (!found.value.access.history) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit de consulter l'historique de ce document."));
      return ok(await sharesRepo.listHistory(tx, ctx.tenantId, input.documentId, cursor, limit));
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const page = loaded.value.slice(0, limit);
  const actorIds = [...new Set(page.map((e) => e.actorId).filter((u): u is Uuid => Boolean(u)))];
  const names = actorIds.length > 0 ? await deps.ports.owners.userNames(ctx, actorIds) : new Map<Uuid, string>();
  const last = page[page.length - 1];
  return ok({
    items: page.map((e) => ({ id: e.id, action: e.action as DocumentHistoryAction, versionNo: e.versionNo, actorId: e.actorId, actorName: e.actorId ? (names.get(e.actorId) ?? null) : null, occurredAt: iso(e.occurredAt), detail: e.detail })),
    nextCursor: loaded.value.length > limit && last ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id }) : null,
  });
}

type DocumentHistoryAction = DocumentHistoryPageDto["items"][number]["action"];

// ---------------------------------------------------------------------------
// Personnes (sélecteurs de dépôt et de partage)
// ---------------------------------------------------------------------------

export async function searchPeople(deps: DocumentsDeps, ctx: RequestContext, input: { query: DocumentPersonQuery }): Promise<Result<DocumentPersonDto[], AppError>> {
  const limit = input.query.limit ?? 10;
  const q = input.query.q;
  const toDto = (kind: DocumentPersonDto["kind"]) => (p: { id: Uuid; displayName: string; detail: string | null }): DocumentPersonDto => ({ id: p.id, displayName: p.displayName, kind, detail: p.detail });
  if (input.query.kind === "USER") return ok((await deps.ports.owners.searchUsers(ctx, q, limit)).map(toDto("USER")));
  return ok((await deps.ports.owners.searchOwners(ctx, input.query.kind, q, limit)).map(toDto(input.query.kind)));
}

export async function listGuardianUsers(deps: DocumentsDeps, ctx: RequestContext, input: { studentId: Uuid }): Promise<Result<DocumentGuardianListDto, AppError>> {
  const found = await deps.ports.owners.existingOwners(ctx, "STUDENT", [input.studentId]);
  if (!found.has(input.studentId)) return err(notFound(DocumentsCode.OWNER_NOT_FOUND, "Élève", input.studentId));
  const guardians = await deps.ports.owners.guardianUsers(ctx, input.studentId);
  return ok({ items: guardians.map((p) => ({ id: p.id, displayName: p.displayName, kind: "USER" as const, detail: p.detail })) });
}

export { addDays };
