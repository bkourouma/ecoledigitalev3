/**
 * Briques communes des cas d'usage : profil de l'acteur, restriction, quotas, pièces jointes liées, notifications d'un message.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { conflict, forbidden, MessagingCode, RateLimitedError, validation } from "../domain/errors";
import { previewOf } from "../domain/text";
import type { ActorProfile, MessagingSettings, Uuid } from "../domain/types";
import * as conv from "../infrastructure/conversations-repository";
import * as notif from "../infrastructure/notifications-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import type { MessagingDeps } from "./deps";

export const UNKNOWN_NAME = "Utilisateur";

/** Profil de l'utilisateur courant ; un compte sans fiche (administrateur, propriétaire) a un profil vide. */
export async function loadActor(deps: MessagingDeps, ctx: RequestContext, userId: Uuid): Promise<ActorProfile> {
  const profiles = await deps.ports.directory.getProfiles(ctx, [userId]);
  return (
    profiles.get(userId) ?? {
      userId,
      displayName: null,
      studentId: null,
      studentClassroomIds: [],
      childStudentIds: [],
      childClassroomIds: [],
      staffId: null,
      teachingClassroomIds: [],
    }
  );
}

/** Nom d'affichage d'un acteur : profil, sinon annuaire, sinon « Utilisateur ». */
export async function actorDisplayName(deps: MessagingDeps, ctx: RequestContext, actor: ActorProfile): Promise<string> {
  if (actor.displayName) return actor.displayName;
  const names = await deps.ports.directory.getDisplayNames(ctx, [actor.userId]);
  return names.get(actor.userId) ?? UNKNOWN_NAME;
}

/** Restriction d'envoi active ⇒ refus (`messaging.sender_restricted`). */
export async function assertNotRestricted(tx: Tx, deps: MessagingDeps, ctx: RequestContext, userId: Uuid): Promise<Result<true, AppError>> {
  const r = await settingsRepo.getActiveRestriction(tx, ctx.tenantId, userId, deps.clock.now());
  if (!r) return ok(true);
  return err(forbidden(MessagingCode.SENDER_RESTRICTED, "Votre envoi de messages est temporairement restreint.", { restrictedUntil: r.restrictedUntil?.toISOString() ?? null }));
}

/**
 * Quotas anti-spam (spec §4.4), comptés en base : envois par heure, nouvelles conversations par jour. `newConversations` :
 * nombre de conversations que l'opération va ouvrir (une diffusion = 1).
 */
export async function enforceQuotas(
  tx: Tx,
  deps: MessagingDeps,
  ctx: RequestContext,
  userId: Uuid,
  settings: MessagingSettings,
  opening: { newConversation: boolean },
): Promise<Result<true, AppError>> {
  const now = deps.clock.now();
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const sends = await conv.countRecentSends(tx, ctx.tenantId, userId, hourAgo);
  if (sends >= settings.maxMessagesPerHour) {
    const oldest = await conv.oldestSendSince(tx, ctx.tenantId, userId, hourAgo);
    const retry = oldest ? Math.max(1, Math.ceil((oldest.getTime() + 3_600_000 - now.getTime()) / 1000)) : 60;
    return err(new RateLimitedError("Trop de messages envoyés : réessayez plus tard.", retry, { limit: settings.maxMessagesPerHour, window: "hour" }));
  }
  if (opening.newConversation) {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const opened = await conv.countRecentConversations(tx, ctx.tenantId, userId, dayAgo);
    if (opened >= settings.maxNewConversationsPerDay) {
      return err(new RateLimitedError("Trop de nouvelles conversations aujourd'hui : réessayez plus tard.", 3600, { limit: settings.maxNewConversationsPerDay, window: "day" }));
    }
  }
  return ok(true);
}

/** Longueur du message selon les paramètres d'établissement. */
export function checkBodyLength(body: string, settings: MessagingSettings): Result<string, AppError> {
  const trimmed = body.trim();
  if (trimmed.length === 0) return err(validation(MessagingCode.INVALID_INPUT, "Le message est vide.", "body"));
  if (trimmed.length > settings.messageMaxLength) {
    return err(validation(MessagingCode.MESSAGE_TOO_LONG, `Le message dépasse ${settings.messageMaxLength} caractères.`, "body", { max: settings.messageMaxLength }));
  }
  return ok(trimmed);
}

/** Les pièces annoncées appartiennent à l'expéditeur, ne sont pas déjà liées, et respectent les paramètres. */
export async function validateAttachmentIds(tx: Tx, ctx: RequestContext, settings: MessagingSettings, uploader: Uuid, ids: readonly Uuid[]): Promise<Result<conv.AttachmentRow[], AppError>> {
  if (ids.length === 0) return ok([]);
  const unique = [...new Set(ids)];
  if (!settings.attachmentsEnabled) return err(conflict(MessagingCode.ATTACHMENTS_DISABLED, "Les pièces jointes ne sont pas activées pour cet établissement."));
  if (unique.length > settings.attachmentMaxPerItem) {
    return err(validation(MessagingCode.TOO_MANY_ATTACHMENTS, `Au plus ${settings.attachmentMaxPerItem} pièces jointes.`, "attachmentIds", { max: settings.attachmentMaxPerItem }));
  }
  const rows = await conv.getAttachments(tx, ctx.tenantId, unique);
  const ok_ = rows.length === unique.length && rows.every((r) => r.uploadedBy === uploader && r.boundAt === null);
  if (!ok_) return err(validation(MessagingCode.ATTACHMENT_NOT_FOUND, "Pièce jointe introuvable ou déjà utilisée.", "attachmentIds"));
  return ok(rows);
}

export interface MessageNotifyInput {
  readonly conversationId: Uuid;
  /** Destinataires (hors expéditeur) à notifier, avec l'identifiant de notification à créer. */
  readonly recipients: ReadonlyArray<{ userId: Uuid; notificationId: Uuid }>;
  readonly senderName: string;
  readonly subject: string | null;
  readonly kind: "USER" | "SYSTEM";
  readonly title?: string;
}

/** Diffusion : une notification par fil privé, en UNE requête. */
export async function notifyNewMessages(
  tx: Tx,
  ctx: RequestContext,
  now: Date,
  input: { senderName: string; subject: string | null; rows: ReadonlyArray<{ userId: Uuid; notificationId: Uuid; conversationId: Uuid }> },
): Promise<void> {
  if (input.rows.length === 0) return;
  await notif.insertNotifications(tx, {
    tenantId: ctx.tenantId,
    category: "MESSAGE",
    entityType: "conversation",
    bypassPrefs: false,
    now,
    rows: input.rows.map((r) => ({
      id: r.notificationId,
      userId: r.userId,
      title: `Nouveau message de ${input.senderName}`,
      body: input.subject ? previewOf(input.subject) : null,
      link: `/v2/messages/${r.conversationId}`,
      entityId: r.conversationId,
      dedupeKey: `msg:${r.conversationId}`,
    })),
  });
}

/** Notifications in-app d'un nouveau message : une notification NON LUE par fil (compteur d'occurrences). */
export async function notifyNewMessage(tx: Tx, ctx: RequestContext, now: Date, input: MessageNotifyInput): Promise<void> {
  if (input.recipients.length === 0) return;
  const title = input.title ?? `Nouveau message de ${input.senderName}`;
  await notif.insertNotifications(tx, {
    tenantId: ctx.tenantId,
    category: input.kind === "SYSTEM" ? "SYSTEM" : "MESSAGE",
    entityType: "conversation",
    bypassPrefs: false,
    now,
    rows: input.recipients.map((r) => ({
      id: r.notificationId,
      userId: r.userId,
      title,
      body: input.subject ? previewOf(input.subject) : null,
      link: `/v2/messages/${input.conversationId}`,
      entityId: input.conversationId,
      dedupeKey: `msg:${input.conversationId}`,
    })),
  });
}
