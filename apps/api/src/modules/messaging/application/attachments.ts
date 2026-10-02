/**
 * Pièces jointes : dépôt (type RÉEL contrôlé sur les octets, taille et types selon les paramètres), URL signée courte,
 * purge des pièces jamais liées. Stockage objet uniquement (`StoragePort`), jamais le disque local.
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { MessagingAttachmentDto } from "@ecoledigitale/contracts/src/v2/messaging";
import { conflict, forbidden, MessagingCode, notFound, validation } from "../domain/errors";
import { detectMimeType, extensionFor, sanitizeFileName } from "../domain/magic-bytes";
import type { CallerCaps, Uuid } from "../domain/types";
import * as annRepo from "../infrastructure/announcements-repository";
import * as repo from "../infrastructure/conversations-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { EventBuffer, inTx, type MessagingDeps } from "./deps";
import { attachmentView } from "./views";

export interface UploadInput {
  readonly fileName: string;
  readonly content: Uint8Array;
}

export async function uploadAttachment(deps: MessagingDeps, ctx: RequestContext, input: UploadInput): Promise<Result<MessagingAttachmentDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Une pièce est déposée par un utilisateur identifié."));
  return inTx(deps, ctx, async (tx) => {
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    if (!settings.attachmentsEnabled) return err(conflict(MessagingCode.ATTACHMENTS_DISABLED, "Les pièces jointes ne sont pas activées pour cet établissement."));
    if (input.content.byteLength === 0) return err(validation(MessagingCode.INVALID_INPUT, "Le fichier est vide.", "contentBase64"));
    if (input.content.byteLength > settings.attachmentMaxBytes) {
      return err(validation(MessagingCode.ATTACHMENT_TOO_LARGE, `Le fichier dépasse la taille maximale autorisée (${settings.attachmentMaxBytes} octets).`, "contentBase64", { maxBytes: settings.attachmentMaxBytes }));
    }
    const mime = detectMimeType(input.content);
    if (!mime || !settings.allowedAttachmentTypes.includes(mime)) {
      return err(validation(MessagingCode.ATTACHMENT_TYPE_REJECTED, "Type de fichier non accepté (contrôlé sur le contenu réel du fichier).", "contentBase64", { allowed: [...settings.allowedAttachmentTypes] }));
    }
    const id = deps.newId();
    const key = `messaging/${ctx.tenantId}/${id}.${extensionFor(mime)}`;
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    await deps.ports.storage.put(key, input.content, { contentType: mime });
    try {
      const row = await repo.insertAttachment(tx, ctx.tenantId, {
        id, uploadedBy: me, storageKey: key, fileName: sanitizeFileName(input.fileName), detectedMime: mime, sizeBytes: input.content.byteLength, sha256, uploadedAt: deps.clock.now(),
      });
      return ok(attachmentView(row));
    } catch (e) {
      await deps.ports.storage.delete(key).catch(() => undefined);
      throw e;
    }
  });
}

/**
 * URL signée courte d'une pièce. Lecture réservée : déposant (pièce non liée), participant du fil, destinataire ou
 * gestionnaire de l'annonce ; la modération lit avec sa permission et la lecture est AUDITÉE.
 */
export async function getAttachmentUrl(deps: MessagingDeps, ctx: RequestContext, input: { attachmentId: Uuid; caps?: CallerCaps | undefined }): Promise<Result<{ url: string; expiresAt: string }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const a = await repo.getAttachment(tx, ctx.tenantId, input.attachmentId);
    const missing = notFound(MessagingCode.ATTACHMENT_NOT_FOUND, "Pièce jointe", input.attachmentId);
    if (!a) return err(missing);
    let allowed = false;
    let moderation = false;
    if (a.messageId) {
      const msg = await repo.getMessage(tx, ctx.tenantId, a.messageId);
      const participant = msg ? await repo.getParticipant(tx, ctx.tenantId, msg.conversationId, me) : null;
      allowed = participant !== null && participant.leftAt === null && msg?.removedAt === null;
      if (!allowed && (caps.moderationRead || caps.moderationSupervise)) {
        allowed = true;
        moderation = true;
      }
    } else if (a.announcementId) {
      const ann = await annRepo.getAnnouncement(tx, ctx.tenantId, a.announcementId);
      const recipient = ann ? await annRepo.getRecipientState(tx, ctx.tenantId, ann.id, me) : null;
      allowed = ann !== null && (ann.authorId === me || caps.announcementManage === true || (recipient !== null && ann.status === "PUBLISHED"));
    } else {
      allowed = a.uploadedBy === me;
    }
    if (!allowed) return err(missing);
    const events = new EventBuffer(deps, ctx);
    if (moderation) {
      events.audit({ action: "messaging.attachment.read_moderation", resourceType: "attachment", resourceId: a.id, sensitive: true, metadata: { messageId: a.messageId, detectedMime: a.detectedMime } });
    }
    const signed = await deps.ports.storage.signedUrl(a.storageKey, deps.config.signedUrlTtlSeconds);
    await events.flush(tx);
    return ok({ url: signed.url, expiresAt: signed.expiresAt.toISOString() });
  });
}

/** Purge des pièces déposées mais jamais liées (job). Les objets de stockage sont supprimés APRÈS la validation. */
export async function purgeOrphanAttachments(deps: MessagingDeps, ctx: RequestContext): Promise<number> {
  const before = new Date(deps.clock.now().getTime() - deps.config.orphanAttachmentTtlHours * 3_600_000);
  const result = await inTx(deps, ctx, async (tx) => {
    const orphans = await repo.listOrphanAttachments(tx, ctx.tenantId, before, 500);
    await repo.deleteAttachments(tx, ctx.tenantId, orphans.map((o) => o.id));
    return ok(orphans);
  });
  if (!result.ok) return 0;
  for (const o of result.value) await deps.ports.storage.delete(o.storageKey).catch((e: unknown) => deps.logger.warn({ key: o.storageKey, err: e instanceof Error ? e.message : String(e) }, "messaging : suppression d'une pièce orpheline impossible"));
  return result.value.length;
}
