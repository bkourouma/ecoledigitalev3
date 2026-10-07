/**
 * Quarantaine (spec 024 §7) : liste, libération motivée (décision humaine tracée), destruction. Un fichier en quarantaine
 * n'est JAMAIS servi : il n'a ni version ni URL de lecture.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { documentCreateFieldsSchema, type DocumentDetailDto, type DocumentQuarantineDto } from "@ecoledigitale/contracts/src/v2/documents";
import { checkOwnerCoherence, versionStorageKey } from "../domain/descriptors";
import { DocumentsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { DocumentsEvents } from "../domain/events";
import { checkFile, sha256Hex, type FileCheckOk } from "../domain/file-policy";
import type { ActorCaps, Uuid } from "../domain/types";
import * as docs from "../infrastructure/documents-repository";
import * as repo from "../infrastructure/settings-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { actorOf, decodeCursor, effectiveQuota, encodeCursor, ensureDefaults, iso } from "./support";
import { buildDetail, persistNewDocument, persistNewVersion, reportUsage, withObject } from "./uploads";

function quarantineDto(q: sharesRepo.QuarantineRow, names: ReadonlyMap<Uuid, string>): DocumentQuarantineDto {
  const fields = q.intent.fields as { categoryId?: string };
  return {
    id: q.id,
    status: q.status,
    fileName: q.fileName,
    extension: q.extension,
    mime: q.mime,
    sizeBytes: q.sizeBytes,
    sha256: q.sha256,
    signature: q.signature,
    engine: q.engine,
    uploadedBy: q.uploadedBy,
    uploadedByName: names.get(q.uploadedBy) ?? null,
    createdAt: iso(q.createdAt),
    intentKind: q.intent.mode === "CREATE" ? "CREATE" : "VERSION",
    categoryId: q.intent.mode === "CREATE" && typeof fields.categoryId === "string" ? fields.categoryId : null,
    documentId: q.intent.mode === "VERSION" ? q.intent.documentId : null,
    decidedBy: q.decidedBy,
    decidedAt: q.decidedAt ? iso(q.decidedAt) : null,
    decisionNote: q.decisionNote,
    releasedDocumentId: q.releasedDocumentId,
  };
}

export async function listQuarantine(deps: DocumentsDeps, ctx: RequestContext, input: { status?: string | undefined; cursor?: string | undefined; limit?: number | undefined }): Promise<Result<{ items: DocumentQuarantineDto[]; nextCursor: string | null }, AppError>> {
  const limit = Math.min(input.limit ?? 30, 100);
  const cursor = decodeCursor<{ at: string; id: string }>(input.cursor);
  const loaded = await inTx(deps, ctx, async (tx) => ok(await sharesRepo.listQuarantine(tx, ctx.tenantId, input.status ?? null, cursor, limit)), { readOnly: true });
  if (!loaded.ok) return loaded;
  const page = loaded.value.slice(0, limit);
  const ids = [...new Set(page.map((q) => q.uploadedBy))];
  const names = ids.length > 0 ? await deps.ports.owners.userNames(ctx, ids) : new Map<Uuid, string>();
  const last = page[page.length - 1];
  return ok({ items: page.map((q) => quarantineDto(q, names)), nextCursor: loaded.value.length > limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null });
}

/** Libération d'un faux positif : rejoue le dépôt demandé, sans nouvelle analyse, sur décision motivée du responsable. */
export async function releaseQuarantine(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; id: Uuid; note: string }): Promise<Result<DocumentDetailDto, AppError>> {
  // Calculé AVANT toute transaction : la lecture des fonctionnalités du plan ouvre sa propre session (identité système) et serait refusée à l'intérieur d'une transaction de tenant (TX_IDENTITY_SWITCH, rapport QA C-04-02).
  const plan = await deps.ports.planQuota(ctx);
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  // La décision et ses effets sont ceux d'un RESPONSABLE de la quarantaine : lecture du document créé avec ses droits de gestion.
  const manager = { ...actor, caps: { ...actor.caps, manage: true } };

  const q0 = await inTx(deps, ctx, async (tx) => {
    const q = await sharesRepo.getQuarantine(tx, ctx.tenantId, input.id);
    if (!q || q.status !== "HELD") return err(notFound(DocumentsCode.QUARANTINE_NOT_FOUND, "Fichier en quarantaine", input.id));
    return ok(q);
  });
  if (!q0.ok) return q0;
  const q = q0.value;
  const object = await deps.ports.storage.get(q.storageKey);
  if (!object) return err(conflict(DocumentsCode.OBJECT_MISSING, "Le fichier en quarantaine est introuvable dans le stockage."));
  if (sha256Hex(object.bytes) !== q.sha256) return err(conflict(DocumentsCode.INTEGRITY_FAILED, "L'empreinte du fichier en quarantaine ne correspond plus : libération refusée."));

  let used = 0;
  let result: Result<DocumentDetailDto, AppError>;
  let pendingKey = "";
  const intent = q.intent;

  if (intent.mode === "CREATE") {
    const parsed = documentCreateFieldsSchema.safeParse(intent.fields);
    if (!parsed.success) return err(validation(DocumentsCode.INVALID_INPUT, "Les informations du dépôt d'origine sont illisibles : détruisez ce fichier.", "intent"));
    const fields = parsed.data;
    const prep = await inTx(deps, ctx, async (tx) => {
      const settings = await ensureDefaults(deps, tx, ctx);
      const category = await repo.getCategory(tx, ctx.tenantId, fields.categoryId);
      if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", fields.categoryId));
      if (category.status !== "ACTIVE") return err(conflict(DocumentsCode.CATEGORY_ARCHIVED, "La catégorie demandée est archivée."));
      const coherence = checkOwnerCoherence(category.kind, fields.ownerType, fields.ownerId);
      if (!coherence.ok) return err(validation(DocumentsCode.OWNER_REQUIRED, coherence.message, "ownerId"));
      if (fields.ownerType !== "NONE" && fields.ownerId) {
        const found = await deps.ports.owners.existingOwners(ctx, fields.ownerType, [fields.ownerId]);
        if (!found.has(fields.ownerId)) return err(validation(DocumentsCode.OWNER_NOT_FOUND, "Le propriétaire du document n'existe plus.", "ownerId"));
      }
      const check = checkFile({ fileName: q.fileName, bytes: object.bytes }, { maxBytes: Math.min(category.maxBytes ?? settings.maxBytes, deps.config.hardMaxBytes), allowedExtensions: category.allowedExtensions });
      if (!check.ok) return err(validation(DocumentsCode.TYPE_NOT_ALLOWED, check.message, "file"));
      return ok({ category, check });
    });
    if (!prep.ok) return prep;
    const { category, check } = prep.value;
    const id = deps.newId();
    pendingKey = versionStorageKey(ctx.tenantId, id, 1, check.sha256);
    result = await withObject(deps, pendingKey, object.bytes, check.mime, () =>
      inTx(deps, ctx, async (tx) => {
        const settings = await ensureDefaults(deps, tx, ctx);
        const locked = await sharesRepo.getQuarantine(tx, ctx.tenantId, q.id, { forUpdate: true });
        if (!locked || locked.status !== "HELD") return err(conflict(DocumentsCode.QUARANTINE_NOT_FOUND, "Ce fichier a déjà fait l'objet d'une décision."));
        const usage = await docs.usageCounts(tx, ctx.tenantId);
        if (usage.usedBytes + check.size > effectiveQuota(plan, settings)) return err(validation(DocumentsCode.QUOTA_EXCEEDED, "Le quota de stockage de l'établissement est atteint.", "file"));
        const persisted = await persistNewDocument(deps, ctx, tx, { id, category, fields, check, storageKey: pendingKey, scanStatus: "UNSCANNED", scanEngine: null, uploaderId: q.uploadedBy, actorId: actor.userId, via: "QUARANTINE_RELEASE" });
        used = persisted.usedBytes;
        await decide(deps, ctx, tx, q, actor.userId, id, input.note);
        return buildDetail(deps, tx, ctx, manager, id, settings);
      }),
    );
  } else {
    const fields = intent.fields as { note?: string | null; expiresOn?: string | null; expiresOnProvided?: boolean };
    const prep = await inTx(deps, ctx, async (tx) => {
      const settings = await ensureDefaults(deps, tx, ctx);
      const row = await docs.getDocument(tx, ctx.tenantId, intent.documentId, actor.userId, deps.clock.now());
      if (!row) return err(notFound(DocumentsCode.DOCUMENT_NOT_FOUND, "Document", intent.documentId));
      if (row.status === "ARCHIVED") return err(conflict(DocumentsCode.ARCHIVED, "Le document visé est archivé."));
      const category = await repo.getCategory(tx, ctx.tenantId, row.categoryId);
      if (!category) return err(notFound(DocumentsCode.CATEGORY_NOT_FOUND, "Catégorie", row.categoryId));
      if (row.versionCount >= settings.maxVersions) return err(conflict(DocumentsCode.TOO_MANY_VERSIONS, "Le document a atteint le nombre maximal de versions."));
      const check = checkFile({ fileName: q.fileName, bytes: object.bytes }, { maxBytes: Math.min(category.maxBytes ?? settings.maxBytes, deps.config.hardMaxBytes), allowedExtensions: category.allowedExtensions });
      if (!check.ok) return err(validation(DocumentsCode.TYPE_NOT_ALLOWED, check.message, "file"));
      return ok({ row, check: check as FileCheckOk });
    });
    if (!prep.ok) return prep;
    const { check } = prep.value;
    const versionNo = prep.value.row.currentVersionNo + 1;
    pendingKey = versionStorageKey(ctx.tenantId, prep.value.row.id, versionNo, check.sha256);
    result = await withObject(deps, pendingKey, object.bytes, check.mime, () =>
      inTx(deps, ctx, async (tx) => {
        const settings = await ensureDefaults(deps, tx, ctx);
        const locked = await sharesRepo.getQuarantine(tx, ctx.tenantId, q.id, { forUpdate: true });
        if (!locked || locked.status !== "HELD") return err(conflict(DocumentsCode.QUARANTINE_NOT_FOUND, "Ce fichier a déjà fait l'objet d'une décision."));
        const row = await docs.getDocument(tx, ctx.tenantId, intent.documentId, actor.userId, deps.clock.now(), { forUpdate: true });
        if (!row || row.currentVersionNo + 1 !== versionNo || row.status !== "ACTIVE") return err(conflict(DocumentsCode.VERSION_CONFLICT, "Le document a changé depuis le dépôt : détruisez ce fichier ou redéposez-le."));
        const usage = await docs.usageCounts(tx, ctx.tenantId);
        if (usage.usedBytes + check.size > effectiveQuota(plan, settings)) return err(validation(DocumentsCode.QUOTA_EXCEEDED, "Le quota de stockage de l'établissement est atteint.", "file"));
        const persisted = await persistNewVersion(deps, ctx, tx, {
          row, check, storageKey: pendingKey, versionNo, scanStatus: "UNSCANNED", scanEngine: null, uploaderId: q.uploadedBy, actorId: actor.userId, note: fields.note ?? null,
          expiresOn: fields.expiresOnProvided ? (fields.expiresOn ?? null) : undefined, via: "QUARANTINE_RELEASE",
        });
        used = persisted.usedBytes;
        await decide(deps, ctx, tx, q, actor.userId, row.id, input.note);
        return buildDetail(deps, tx, ctx, manager, row.id, settings);
      }),
    );
  }
  if (!result.ok) return result;
  await deps.ports.storage.delete(q.storageKey).catch((e: unknown) => deps.logger.warn({ key: q.storageKey, err: e instanceof Error ? e.message : String(e) }, "documents : objet de quarantaine non supprimé après libération"));
  await reportUsage(deps, ctx, used);
  return result;
}

async function decide(deps: DocumentsDeps, ctx: RequestContext, tx: import("@ecoledigitale/database").Tx, q: sharesRepo.QuarantineRow, by: Uuid, documentId: Uuid, note: string): Promise<void> {
  await sharesRepo.decideQuarantine(tx, ctx.tenantId, q.id, { status: "RELEASED", by, note: note.trim(), releasedDocumentId: documentId }, deps.clock.now());
  const events = new EventBuffer(deps, ctx);
  events.add(DocumentsEvents.QUARANTINE_RELEASED, { v: 1, quarantineId: q.id, documentId, releasedBy: by }, { type: "quarantine", id: q.id });
  events.audit({ action: "documents.quarantine.released", resourceType: "document_quarantine", resourceId: q.id, sensitive: true, reason: note.trim(), metadata: { signature: q.signature, engine: q.engine, sha256: q.sha256, documentId } });
  await events.flush(tx);
}

/** Destruction d'un fichier en quarantaine : l'objet est supprimé D'ABORD ; la ligne ne change que si le stockage a répondu. */
export async function deleteQuarantine(deps: DocumentsDeps, ctx: RequestContext, input: { id: Uuid; note: string; automatic?: boolean }): Promise<Result<true, AppError>> {
  const by = ctx.userId;
  if (!by && !input.automatic) return err(forbidden(DocumentsCode.FORBIDDEN, "Utilisateur identifié requis."));
  const q0 = await inTx(deps, ctx, async (tx) => {
    const q = await sharesRepo.getQuarantine(tx, ctx.tenantId, input.id);
    if (!q || q.status !== "HELD") return err(notFound(DocumentsCode.QUARANTINE_NOT_FOUND, "Fichier en quarantaine", input.id));
    return ok(q);
  });
  if (!q0.ok) return q0;
  await deps.ports.storage.delete(q0.value.storageKey);
  return inTx(deps, ctx, async (tx) => {
    const q = await sharesRepo.getQuarantine(tx, ctx.tenantId, input.id, { forUpdate: true });
    if (!q || q.status !== "HELD") return ok(true as const);
    await sharesRepo.decideQuarantine(tx, ctx.tenantId, q.id, { status: "DELETED", by: by ?? null, note: input.note.trim() }, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "documents.quarantine.deleted", resourceType: "document_quarantine", resourceId: q.id, sensitive: true, reason: input.note.trim(), metadata: { signature: q.signature, sha256: q.sha256, automatic: input.automatic === true } });
    await events.flush(tx);
    return ok(true as const);
  });
}
