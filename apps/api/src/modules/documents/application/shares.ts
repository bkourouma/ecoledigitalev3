/**
 * Partages explicites d'un document (personne, niveau, durée). Réservés à qui peut partager : permission `documents.share`
 * ET droit d'écriture sur le document ; la gestion partage tout. Un partage retiré reste en base (traçabilité).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { DocumentShareBody, DocumentShareDto } from "@ecoledigitale/contracts/src/v2/documents";
import { DocumentsEvents } from "../domain/events";
import { DocumentsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import type { ActorCaps, Uuid } from "../domain/types";
import * as sharesRepo from "../infrastructure/shares-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { actorOf, loadVisible, shareDto } from "./support";

export async function listShares(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid }): Promise<Result<DocumentShareDto[], AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const found = await loadVisible(deps, tx, ctx, actor, input.documentId);
      if (!found.ok) return found;
      if (!found.value.access.share) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit de consulter les partages de ce document."));
      return ok(await sharesRepo.listShares(tx, ctx.tenantId, input.documentId));
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const ids = [...new Set(loaded.value.flatMap((s) => [s.userId, s.createdBy]))];
  const names = ids.length > 0 ? await deps.ports.owners.userNames(ctx, ids) : new Map<Uuid, string>();
  const now = deps.clock.now();
  return ok(loaded.value.map((s) => shareDto(s, names, now)));
}

export async function shareDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; body: DocumentShareBody }): Promise<Result<DocumentShareDto, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  const b = input.body;
  const now = deps.clock.now();
  if (b.userId === actor.userId) return err(validation(DocumentsCode.SHARE_INVALID, "Vous ne pouvez pas partager un document avec vous-même.", "userId"));
  const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return err(validation(DocumentsCode.SHARE_INVALID, "La date de fin du partage doit être dans le futur.", "expiresAt"));
  const known = await deps.ports.owners.userNames(ctx, [b.userId]);
  if (!known.has(b.userId)) return err(validation(DocumentsCode.SHARE_INVALID, "Personne inconnue de l'établissement.", "userId"));

  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const { row, access } = loaded.value;
    if (row.status === "ARCHIVED") return err(conflict(DocumentsCode.ARCHIVED, "Un document archivé ne se partage pas."));
    if (!access.share) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit de partager ce document."));
    await sharesRepo.revokeStaleShares(tx, ctx.tenantId, row.id, b.userId, actor.userId, now);
    // Un partage actif est REMPLACÉ (niveau / durée mis à jour) : jamais deux partages actifs pour la même personne.
    const active = await sharesRepo.getActiveShareOfUser(tx, ctx.tenantId, row.id, b.userId, now);
    if (active) await sharesRepo.revokeShare(tx, ctx.tenantId, active.id, actor.userId, now);
    const id = deps.newId();
    await sharesRepo.insertShare(tx, ctx.tenantId, { id, documentId: row.id, userId: b.userId, level: b.level, expiresAt, note: b.note ?? null, createdBy: actor.userId }, now);
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, action: "SHARED", actorId: actor.userId, detail: { userId: b.userId, level: b.level, expiresAt: expiresAt?.toISOString() ?? null } }, now);
    const events = new EventBuffer(deps, ctx);
    events.add(
      DocumentsEvents.DOCUMENT_SHARED,
      { v: 1, documentId: row.id, categoryId: row.categoryId, kind: row.kind, ownerType: row.ownerType, ownerId: row.ownerId, shareId: id, userId: b.userId, level: b.level, sharedBy: actor.userId },
      { type: "document", id: row.id },
    );
    events.audit({ action: "documents.document.shared", resourceType: "document", resourceId: row.id, sensitive: true, after: { userId: b.userId, level: b.level, expiresAt: expiresAt?.toISOString() ?? null }, metadata: { categoryId: row.categoryId } });
    await events.flush(tx);
    const created = (await sharesRepo.listShares(tx, ctx.tenantId, row.id)).find((s) => s.id === id);
    if (!created) return err(notFound(DocumentsCode.SHARE_NOT_FOUND, "Partage", id));
    return ok(shareDto(created, known, now));
  });
}

export async function unshareDocument(deps: DocumentsDeps, ctx: RequestContext, input: { caps?: ActorCaps; documentId: Uuid; shareId: Uuid }): Promise<Result<true, AppError>> {
  const actorR = await actorOf(deps, ctx, input.caps);
  if (!actorR.ok) return actorR;
  const actor = actorR.value;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadVisible(deps, tx, ctx, actor, input.documentId, { forUpdate: true });
    if (!loaded.ok) return loaded;
    const { row, access } = loaded.value;
    if (!access.share) return err(forbidden(DocumentsCode.FORBIDDEN, "Vous n'avez pas le droit de retirer un partage de ce document."));
    const share = await sharesRepo.getShare(tx, ctx.tenantId, row.id, input.shareId);
    if (!share) return err(notFound(DocumentsCode.SHARE_NOT_FOUND, "Partage", input.shareId));
    if (share.revokedAt !== null) return ok(true as const);
    const now = deps.clock.now();
    await sharesRepo.revokeShare(tx, ctx.tenantId, share.id, actor.userId, now);
    await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: row.id, action: "UNSHARED", actorId: actor.userId, detail: { userId: share.userId } }, now);
    const events = new EventBuffer(deps, ctx);
    events.add(
      DocumentsEvents.DOCUMENT_UNSHARED,
      { v: 1, documentId: row.id, categoryId: row.categoryId, kind: row.kind, ownerType: row.ownerType, ownerId: row.ownerId, shareId: share.id, userId: share.userId, revokedBy: actor.userId },
      { type: "document", id: row.id },
    );
    events.audit({ action: "documents.document.unshared", resourceType: "document", resourceId: row.id, sensitive: true, before: { userId: share.userId, level: share.level } });
    await events.flush(tx);
    return ok(true as const);
  });
}
