/**
 * Cas d'usage des annonces : brouillon, programmation, publication (destinataires figés), retrait, accusés de lecture et de
 * réception, statistiques. Voir spec v2/016 §6. Aucun `GET` n'écrit : la lecture est un `POST /read` explicite.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  MessagingAnnouncementDto,
  MessagingAudience,
  MessagingAudienceSelection,
  MessagingPriority,
  MessagingTarget,
} from "@ecoledigitale/contracts/src/v2/messaging";
import {
  canPublishTo,
  isContentEditable,
  normalizeAudiences,
  normalizeTargets,
  publicationOutcome,
  visibleToRecipient,
  type StoredTarget,
} from "../domain/announcements";
import { conflict, forbidden, MessagingCode, notFound, validation } from "../domain/errors";
import { MessagingEvents } from "../domain/events";
import { decodeCursor, encodeCursor } from "../domain/text";
import type { CallerCaps, MessagingSettings, Uuid } from "../domain/types";
import * as repo from "../infrastructure/announcements-repository";
import * as convRepo from "../infrastructure/conversations-repository";
import * as notif from "../infrastructure/notifications-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { EventBuffer, inTx, type MessagingDeps } from "./deps";
import { actorDisplayName, loadActor, validateAttachmentIds } from "./support";
import { announcementView } from "./views";

const toTargets = (stored: readonly StoredTarget[]): MessagingTarget[] => stored.map((t) => (t.kind === "TENANT" ? { kind: t.kind } : { kind: t.kind, ref: t.ref }));

async function viewOf(tx: Tx, deps: MessagingDeps, ctx: RequestContext, rows: readonly repo.AnnouncementRow[], viewer: { userId: Uuid; wantsStats: (a: repo.AnnouncementRow) => boolean }): Promise<MessagingAnnouncementDto[]> {
  const ids = rows.map((r) => r.id);
  const targets = await repo.listTargets(tx, ctx.tenantId, ids);
  const atts = await convRepo.listAttachmentsOfAnnouncements(tx, ctx.tenantId, ids);
  const mine = new Map((await repo.listRecipientStates(tx, ctx.tenantId, viewer.userId, ids)).map((s) => [s.announcementId, s]));
  const statsRows = await repo.announcementStats(tx, ctx.tenantId, rows.filter((r) => viewer.wantsStats(r)).map((r) => r.id));
  const stats = new Map(statsRows.map((s) => [s.announcementId, s]));
  const now = deps.clock.now();
  return rows.map((a) =>
    announcementView(a, {
      targets: targets.filter((t) => t.announcementId === a.id).map((t) => ({ kind: t.kind, ref: t.ref })),
      attachments: atts.filter((x) => x.announcementId === a.id),
      now,
      mine: mine.get(a.id) ?? null,
      stats: viewer.wantsStats(a) ? (stats.get(a.id) ?? { recipients: 0, read: 0, acknowledged: 0 }) : null,
    }),
  );
}

const canManage = (caps: CallerCaps, a: { authorId: Uuid }, me: Uuid): boolean =>
  caps.announcementManage === true || (a.authorId === me && (caps.announcementPublish === true || caps.announcementPublishClass === true));

// ---------------------------------------------------------------------------
// Création et publication
// ---------------------------------------------------------------------------

export interface CreateAnnouncementInput {
  readonly title: string;
  readonly body: string;
  readonly priority: MessagingPriority;
  readonly audience: MessagingAudienceSelection;
  readonly requireAck: boolean;
  readonly pinned: boolean;
  readonly publishAt?: string | undefined;
  readonly expiresAt?: string | undefined;
  readonly attachmentIds: readonly Uuid[];
  readonly publish: boolean;
  readonly caps?: CallerCaps | undefined;
}

async function checkPublishRights(deps: MessagingDeps, ctx: RequestContext, me: Uuid, caps: CallerCaps, targets: readonly StoredTarget[], audiences: readonly MessagingAudience[]): Promise<Result<true, AppError>> {
  let teaching: readonly Uuid[] = [];
  if (!caps.announcementPublish && !caps.announcementManage) teaching = (await loadActor(deps, ctx, me)).teachingClassroomIds;
  const decision = canPublishTo(caps, teaching, targets, audiences);
  if (decision.ok) {
    const unknown = await deps.ports.audience.firstUnknownTarget(ctx, toTargets(targets));
    return unknown ? err(notFound(MessagingCode.TARGET_NOT_FOUND, "Cible", unknown.ref ?? unknown.kind)) : ok(true);
  }
  return err(
    forbidden(
      decision.reason === "NO_PERMISSION" ? MessagingCode.FORBIDDEN : MessagingCode.TARGET_NOT_ALLOWED,
      decision.reason === "NO_PERMISSION" ? "Vous n'avez pas le droit de publier des annonces." : decision.reason === "AUDIENCE_NOT_ALLOWED" ? "Vous ne pouvez viser que les élèves et les tuteurs de vos classes." : "Vous ne pouvez publier que vers vos classes.",
      { reason: decision.reason },
    ),
  );
}

export async function createAnnouncement(deps: MessagingDeps, ctx: RequestContext, input: CreateAnnouncementInput): Promise<Result<MessagingAnnouncementDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Une annonce est publiée par un utilisateur identifié."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const targets = normalizeTargets(input.audience.targets);
    const audiences = normalizeAudiences(input.audience.audiences);
    const rights = await checkPublishRights(deps, ctx, me, caps, targets, audiences);
    if (!rights.ok) return rights;
    const publishAt = input.publishAt ? new Date(input.publishAt) : null;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) return err(validation(MessagingCode.INVALID_INPUT, "L'expiration est déjà passée.", "expiresAt"));
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const attachments = await validateAttachmentIds(tx, ctx, settings, me, input.attachmentIds);
    if (!attachments.ok) return attachments;

    const actor = await loadActor(deps, ctx, me);
    const authorName = await actorDisplayName(deps, ctx, actor);
    const id = deps.newId();
    await repo.insertAnnouncement(tx, ctx.tenantId, {
      id, title: input.title.trim(), body: input.body.trim(), priority: input.priority, authorId: me, authorName, audiences, requireAck: input.requireAck, pinned: input.pinned, publishAt, expiresAt, createdAt: now,
    });
    await repo.replaceTargets(tx, ctx.tenantId, id, targets);
    if (attachments.value.length > 0) {
      const bound = await convRepo.bindAttachments(tx, ctx.tenantId, attachments.value.map((a) => a.id), { announcementId: id }, me, now);
      if (bound !== attachments.value.length) return err(validation(MessagingCode.ATTACHMENT_NOT_FOUND, "Pièce jointe introuvable ou déjà utilisée.", "attachmentIds"));
    }
    const events = new EventBuffer(deps, ctx);
    if (input.publish) {
      const published = await publishCore(deps, ctx, tx, events, settings, (await repo.getAnnouncement(tx, ctx.tenantId, id, { forUpdate: true }))!, targets, publishAt);
      if (!published.ok) return published;
    }
    await events.flush(tx);
    const row = (await repo.getAnnouncement(tx, ctx.tenantId, id))!;
    return ok((await viewOf(tx, deps, ctx, [row], { userId: me, wantsStats: () => true }))[0]!);
  });
}

/**
 * Résout l'audience, fige les destinataires, passe l'annonce à `PUBLISHED` (notifie, événement, audit) ou `SCHEDULED`
 * (la notification est émise à l'échéance par le job). Zéro destinataire : refus (`messaging.audience_empty`).
 */
async function publishCore(
  deps: MessagingDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  settings: MessagingSettings,
  a: repo.AnnouncementRow,
  targets: readonly StoredTarget[],
  publishAt: Date | null,
): Promise<Result<{ status: "PUBLISHED" | "SCHEDULED"; recipientCount: number }, AppError>> {
  const now = deps.clock.now();
  const outcome = publicationOutcome(publishAt, now);
  const limit = settings.maxBroadcastParticipants;
  const resolution = await deps.ports.audience.resolveAudience(ctx, { targets: toTargets(targets), audiences: a.audiences, limit: limit + 1 });
  const userIds = resolution.userIds.slice(0, limit);
  const truncated = resolution.truncated || resolution.userIds.length > limit;
  if (userIds.length === 0) return err(validation(MessagingCode.AUDIENCE_EMPTY, "Aucun destinataire joignable pour ce ciblage.", "audience"));
  await repo.clearRecipients(tx, ctx.tenantId, a.id);
  await repo.insertRecipients(tx, ctx.tenantId, a.id, userIds, now);
  if (outcome === "SCHEDULED") {
    await repo.setAnnouncementStatus(tx, ctx.tenantId, a.id, { status: "SCHEDULED", publishAt, recipientCount: userIds.length, truncated }, now);
    return ok({ status: "SCHEDULED", recipientCount: userIds.length });
  }
  await repo.setAnnouncementStatus(tx, ctx.tenantId, a.id, { status: "PUBLISHED", publishedAt: now, publishAt: publishAt ?? undefined, recipientCount: userIds.length, truncated }, now);
  await announceToRecipients(deps, ctx, tx, events, { ...a, status: "PUBLISHED" }, userIds, now);
  return ok({ status: "PUBLISHED", recipientCount: userIds.length });
}

/** Notifications, événement et audit d'une annonce qui devient visible. */
async function announceToRecipients(deps: MessagingDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, a: repo.AnnouncementRow, userIds: readonly Uuid[], now: Date): Promise<void> {
  await notif.insertNotifications(tx, {
    tenantId: ctx.tenantId,
    category: "ANNOUNCEMENT",
    entityType: "announcement",
    bypassPrefs: a.priority === "URGENT",
    now,
    rows: userIds
      .filter((u) => u !== a.authorId)
      .map((userId) => ({ id: deps.newId(), userId, title: a.title, body: null, link: `/v2/announcements/${a.id}`, entityId: a.id, dedupeKey: `ann:${a.id}` })),
  });
  events.add(
    MessagingEvents.ANNOUNCEMENT_PUBLISHED,
    { v: 1, announcementId: a.id, priority: a.priority, authorId: a.authorId, recipientCount: userIds.length, requireAck: a.requireAck },
    { type: "announcement", id: a.id },
  );
  events.audit({ action: "messaging.announcement.published", resourceType: "announcement", resourceId: a.id, metadata: { recipientCount: userIds.length, priority: a.priority, requireAck: a.requireAck } });
}

export async function publishAnnouncement(deps: MessagingDeps, ctx: RequestContext, input: { announcementId: Uuid; publishAt?: string | undefined; caps?: CallerCaps | undefined }): Promise<Result<MessagingAnnouncementDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId, { forUpdate: true });
    if (!a || !canManage(caps, a, me)) return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
    if (a.status !== "DRAFT" && a.status !== "SCHEDULED") return err(conflict(MessagingCode.ANNOUNCEMENT_INVALID_STATE, "Cette annonce est déjà publiée ou retirée.", { status: a.status }));
    const targets = (await repo.listTargets(tx, ctx.tenantId, [a.id])).map((t) => ({ kind: t.kind, ref: t.ref }));
    const rights = await checkPublishRights(deps, ctx, me, caps, targets, a.audiences);
    if (!rights.ok) return rights;
    const now = deps.clock.now();
    const publishAt = input.publishAt ? new Date(input.publishAt) : null;
    if (a.expiresAt && a.expiresAt.getTime() <= Math.max(now.getTime(), publishAt?.getTime() ?? 0)) return err(validation(MessagingCode.INVALID_INPUT, "L'expiration précède la publication.", "expiresAt"));
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const events = new EventBuffer(deps, ctx);
    // Sans date explicite : un brouillon garde la date qu'il porte (programmation), une annonce déjà programmée est publiée MAINTENANT.
    const r = await publishCore(deps, ctx, tx, events, settings, a, targets, publishAt ?? (a.status === "DRAFT" ? a.publishAt : null));
    if (!r.ok) return r;
    await events.flush(tx);
    const row = (await repo.getAnnouncement(tx, ctx.tenantId, a.id))!;
    return ok((await viewOf(tx, deps, ctx, [row], { userId: me, wantsStats: () => true }))[0]!);
  });
}

export interface UpdateAnnouncementInput {
  readonly announcementId: Uuid;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly priority?: MessagingPriority | undefined;
  readonly audience?: MessagingAudienceSelection | undefined;
  readonly requireAck?: boolean | undefined;
  readonly pinned?: boolean | undefined;
  readonly publishAt?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly attachmentIds?: readonly Uuid[] | undefined;
  readonly caps?: CallerCaps | undefined;
}

export async function updateAnnouncement(deps: MessagingDeps, ctx: RequestContext, input: UpdateAnnouncementInput): Promise<Result<MessagingAnnouncementDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId, { forUpdate: true });
    if (!a || !canManage(caps, a, me)) return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
    const now = deps.clock.now();
    const contentChange = input.title !== undefined || input.body !== undefined || input.priority !== undefined || input.audience !== undefined || input.requireAck !== undefined || input.publishAt !== undefined || input.attachmentIds !== undefined;
    if (a.status === "WITHDRAWN") return err(conflict(MessagingCode.ANNOUNCEMENT_NOT_EDITABLE, "Une annonce retirée ne se modifie plus.", { status: a.status }));
    if (a.status === "PUBLISHED" && contentChange) {
      return err(conflict(MessagingCode.ANNOUNCEMENT_NOT_EDITABLE, "Une annonce publiée ne change plus de contenu : seuls l'expiration et l'épinglage sont modifiables. Retirez-la et publiez-en une nouvelle.", { status: a.status }));
    }
    const expiresAt = input.expiresAt === undefined ? undefined : input.expiresAt === null ? null : new Date(input.expiresAt);
    const publishAt = input.publishAt === undefined ? undefined : input.publishAt === null ? null : new Date(input.publishAt);
    if (a.status === "SCHEDULED" && publishAt === null) return err(conflict(MessagingCode.ANNOUNCEMENT_INVALID_STATE, "Une annonce programmée garde une date de publication : publiez-la maintenant ou retirez-la."));
    const effectivePublish = publishAt === undefined ? a.publishAt : publishAt;
    const effectiveExpiry = expiresAt === undefined ? a.expiresAt : expiresAt;
    if (effectiveExpiry && effectiveExpiry.getTime() <= Math.max(now.getTime(), effectivePublish?.getTime() ?? 0)) return err(validation(MessagingCode.INVALID_INPUT, "L'expiration doit suivre la publication et le moment présent.", "expiresAt"));

    let audiences: MessagingAudience[] | undefined;
    let targets: StoredTarget[] | undefined;
    if (input.audience) {
      targets = normalizeTargets(input.audience.targets);
      audiences = normalizeAudiences(input.audience.audiences);
      const rights = await checkPublishRights(deps, ctx, me, caps, targets, audiences);
      if (!rights.ok) return rights;
    }
    await repo.patchAnnouncement(tx, ctx.tenantId, a.id, {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(audiences ? { audiences } : {}),
      ...(input.requireAck !== undefined ? { requireAck: input.requireAck } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(publishAt !== undefined ? { publishAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    }, now);
    if (targets) await repo.replaceTargets(tx, ctx.tenantId, a.id, targets);
    if (input.attachmentIds) {
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const keep = new Set(input.attachmentIds);
      const existing = (await convRepo.listAttachmentsOfAnnouncements(tx, ctx.tenantId, [a.id])).map((x) => x.id);
      const fresh = input.attachmentIds.filter((x) => !existing.includes(x));
      const valid = await validateAttachmentIds(tx, ctx, settings, me, fresh);
      if (!valid.ok) return valid;
      if (existing.filter((x) => keep.has(x)).length + fresh.length > settings.attachmentMaxPerItem) return err(validation(MessagingCode.TOO_MANY_ATTACHMENTS, `Au plus ${settings.attachmentMaxPerItem} pièces jointes.`, "attachmentIds"));
      const removed = await convRepo.unbindAnnouncementAttachments(tx, ctx.tenantId, a.id, input.attachmentIds);
      await convRepo.bindAttachments(tx, ctx.tenantId, fresh, { announcementId: a.id }, me, now);
      for (const r of removed) await deps.ports.storage.delete(r.storageKey).catch(() => undefined);
    }
    // Annonce programmée dont l'audience ou l'échéance change : les destinataires sont RÉSOLUS à nouveau.
    const events = new EventBuffer(deps, ctx);
    if (a.status === "SCHEDULED" && (input.audience !== undefined || publishAt !== undefined)) {
      const fresh = (await repo.getAnnouncement(tx, ctx.tenantId, a.id, { forUpdate: true }))!;
      const storedTargets = targets ?? (await repo.listTargets(tx, ctx.tenantId, [a.id])).map((t) => ({ kind: t.kind, ref: t.ref }));
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const r = await publishCore(deps, ctx, tx, events, settings, fresh, storedTargets, fresh.publishAt);
      if (!r.ok) return r;
    }
    events.audit({ action: "messaging.announcement.updated", resourceType: "announcement", resourceId: a.id, metadata: { status: a.status, fields: Object.keys(input).filter((k) => !["announcementId", "caps"].includes(k)) } });
    await events.flush(tx);
    const row = (await repo.getAnnouncement(tx, ctx.tenantId, a.id))!;
    return ok((await viewOf(tx, deps, ctx, [row], { userId: me, wantsStats: () => true }))[0]!);
  });
}

export async function withdrawAnnouncement(deps: MessagingDeps, ctx: RequestContext, input: { announcementId: Uuid; reason: string; caps?: CallerCaps | undefined }): Promise<Result<MessagingAnnouncementDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId, { forUpdate: true });
    if (!a || !canManage(caps, a, me)) return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
    if (a.status !== "PUBLISHED" && a.status !== "SCHEDULED") return err(conflict(MessagingCode.ANNOUNCEMENT_INVALID_STATE, "Seule une annonce publiée ou programmée peut être retirée.", { status: a.status }));
    const now = deps.clock.now();
    await repo.setAnnouncementStatus(tx, ctx.tenantId, a.id, { status: "WITHDRAWN", withdrawnAt: now, withdrawnBy: me, withdrawalReason: input.reason.trim() }, now);
    const events = new EventBuffer(deps, ctx);
    events.add(MessagingEvents.ANNOUNCEMENT_WITHDRAWN, { v: 1, announcementId: a.id, withdrawnBy: me }, { type: "announcement", id: a.id });
    events.audit({ action: "messaging.announcement.withdrawn", resourceType: "announcement", resourceId: a.id, sensitive: a.status === "PUBLISHED", reason: input.reason.trim(), metadata: { previousStatus: a.status } });
    await events.flush(tx);
    const row = (await repo.getAnnouncement(tx, ctx.tenantId, a.id))!;
    return ok((await viewOf(tx, deps, ctx, [row], { userId: me, wantsStats: () => true }))[0]!);
  });
}

/** Supprime un BROUILLON (une annonce qui a été visible se retire, elle ne s'efface pas). */
export async function deleteAnnouncementDraft(deps: MessagingDeps, ctx: RequestContext, input: { announcementId: Uuid; caps?: CallerCaps | undefined }): Promise<Result<true, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  const removedKeys: string[] = [];
  const result = await inTx(deps, ctx, async (tx) => {
    const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId, { forUpdate: true });
    if (!a || !canManage(caps, a, me)) return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
    if (a.status !== "DRAFT") return err(conflict(MessagingCode.ANNOUNCEMENT_INVALID_STATE, "Seul un brouillon peut être supprimé : retirez une annonce publiée.", { status: a.status }));
    const removed = await convRepo.unbindAnnouncementAttachments(tx, ctx.tenantId, a.id, []);
    removedKeys.push(...removed.map((r) => r.storageKey));
    await repo.deleteAnnouncement(tx, ctx.tenantId, a.id);
    return ok(true as const);
  });
  if (result.ok) for (const key of removedKeys) await deps.ports.storage.delete(key).catch(() => undefined);
  return result;
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export interface ListAnnouncementsInput {
  readonly scope: "inbox" | "managed";
  readonly status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "WITHDRAWN" | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly unreadOnly?: boolean | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly caps?: CallerCaps | undefined;
}

export async function listAnnouncements(deps: MessagingDeps, ctx: RequestContext, input: ListAnnouncementsInput): Promise<Result<{ items: MessagingAnnouncementDto[]; nextCursor: string | null }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  const cursor = decodeCursor(input.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const now = deps.clock.now();
      if (input.scope === "managed") {
        const manager = caps.announcementManage === true;
        if (!manager && !caps.announcementPublish && !caps.announcementPublishClass) return err(forbidden(MessagingCode.FORBIDDEN, "Vous ne gérez pas d'annonces."));
        const rows = await repo.listManagedAnnouncements(tx, ctx.tenantId, { authorId: manager ? null : me, status: input.status, cursor, limit: input.limit + 1 });
        const page = rows.slice(0, input.limit);
        const last = page[page.length - 1];
        return ok({
          items: await viewOf(tx, deps, ctx, page, { userId: me, wantsStats: () => true }),
          nextCursor: rows.length > input.limit && last ? encodeCursor({ t: (last.publishedAt ?? last.createdAt).toISOString(), id: last.id }) : null,
        });
      }
      const pinnedCursor = input.cursor ? decodeCursor(input.cursor) : null;
      const rows = await repo.listInboxAnnouncements(tx, ctx.tenantId, me, {
        includeExpired: input.includeExpired === true,
        unreadOnly: input.unreadOnly === true,
        cursor: pinnedCursor ? { t: pinnedCursor.t, id: pinnedCursor.id, p: pinnedCursor.p ?? false } : null,
        limit: input.limit + 1,
        now,
      });
      const page = rows.slice(0, input.limit).filter((a) => visibleToRecipient(a, now, input.includeExpired === true));
      const last = rows.slice(0, input.limit)[input.limit - 1];
      return ok({
        items: await viewOf(tx, deps, ctx, page, { userId: me, wantsStats: (a) => canManage(caps, a, me) }),
        nextCursor: rows.length > input.limit && last?.publishedAt ? encodeCursor({ t: last.publishedAt.toISOString(), id: last.id, p: last.pinned }) : null,
      });
    },
    { readOnly: true },
  );
}

export async function getAnnouncementDetail(deps: MessagingDeps, ctx: RequestContext, input: { announcementId: Uuid; caps?: CallerCaps | undefined }): Promise<Result<MessagingAnnouncementDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId);
      const missing = notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId);
      if (!a) return err(missing);
      const manager = canManage(caps, a, me);
      const recipient = await repo.getRecipientState(tx, ctx.tenantId, a.id, me);
      // Destinataire : seulement une annonce publiée (expirée comprise : l'historique reste lisible).
      if (!manager && !(recipient && a.status === "PUBLISHED")) return err(missing);
      return ok((await viewOf(tx, deps, ctx, [a], { userId: me, wantsStats: () => manager }))[0]!);
    },
    { readOnly: true },
  );
}

export async function markAnnouncementRead(deps: MessagingDeps, ctx: RequestContext, input: { announcementId: Uuid }): Promise<Result<{ readAt: string }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId);
    const state = a ? await repo.getRecipientState(tx, ctx.tenantId, a.id, me, { forUpdate: true }) : null;
    if (!a || !state || a.status !== "PUBLISHED") return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
    const now = deps.clock.now();
    await repo.markRecipientRead(tx, ctx.tenantId, a.id, me, now);
    await notif.markNotificationReadByKey(tx, ctx.tenantId, me, `ann:${a.id}`, now);
    return ok({ readAt: (state.readAt ?? now).toISOString() });
  });
}

export async function acknowledgeAnnouncement(deps: MessagingDeps, ctx: RequestContext, input: { announcementId: Uuid }): Promise<Result<{ acknowledgedAt: string }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId);
    const state = a ? await repo.getRecipientState(tx, ctx.tenantId, a.id, me, { forUpdate: true }) : null;
    if (!a || !state || a.status !== "PUBLISHED") return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
    if (!a.requireAck) return err(conflict(MessagingCode.ANNOUNCEMENT_INVALID_STATE, "Cette annonce ne demande pas d'accusé de réception."));
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    if (!state.acknowledgedAt) {
      await repo.markRecipientAcknowledged(tx, ctx.tenantId, a.id, me, now);
      await notif.markNotificationReadByKey(tx, ctx.tenantId, me, `ann:${a.id}`, now);
      events.add(MessagingEvents.ANNOUNCEMENT_ACKNOWLEDGED, { v: 1, announcementId: a.id, userId: me }, { type: "announcement", id: a.id });
    }
    await events.flush(tx);
    return ok({ acknowledgedAt: (state.acknowledgedAt ?? now).toISOString() });
  });
}

export async function listAnnouncementReceipts(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { announcementId: Uuid; state: "all" | "unread" | "read" | "acknowledged" | "pending_ack"; cursor?: string | undefined; limit: number; caps?: CallerCaps | undefined },
) {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  const cursor = decodeCursor(input.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await repo.getAnnouncement(tx, ctx.tenantId, input.announcementId);
      if (!a || !canManage(caps, a, me)) return err(notFound(MessagingCode.ANNOUNCEMENT_NOT_FOUND, "Annonce", input.announcementId));
      const rows = await repo.listReceipts(tx, ctx.tenantId, a.id, { state: input.state, cursor, limit: input.limit + 1 });
      const page = rows.slice(0, input.limit);
      const names = await deps.ports.directory.getDisplayNames(ctx, page.map((r) => r.userId));
      const last = page[page.length - 1];
      return ok({
        items: page.map((r) => ({
          userId: r.userId,
          displayName: names.get(r.userId) ?? null,
          deliveredAt: r.deliveredAt.toISOString(),
          readAt: r.readAt?.toISOString() ?? null,
          acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        })),
        nextCursor: rows.length > input.limit && last ? encodeCursor({ t: "", id: last.userId }) : null,
      });
    },
    { readOnly: true },
  );
}

export async function previewAudience(deps: MessagingDeps, ctx: RequestContext, input: { audience: MessagingAudienceSelection; caps?: CallerCaps | undefined }): Promise<Result<{ count: number; truncated: boolean }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const targets = normalizeTargets(input.audience.targets);
      const audiences = normalizeAudiences(input.audience.audiences);
      const rights = await checkPublishRights(deps, ctx, me, caps, targets, audiences);
      if (!rights.ok) return rights;
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const r = await deps.ports.audience.resolveAudience(ctx, { targets: toTargets(targets), audiences, limit: settings.maxBroadcastParticipants + 1 });
      const count = Math.min(r.userIds.length, settings.maxBroadcastParticipants);
      return ok({ count, truncated: r.truncated || r.userIds.length > settings.maxBroadcastParticipants });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Job : publication des annonces programmées arrivées à échéance
// ---------------------------------------------------------------------------

/**
 * Publie, pour le tenant du contexte, les annonces `SCHEDULED` dont `publish_at` est atteint. Les destinataires ont été
 * figés à la programmation : aucune résolution ici (le worker n'a besoin d'aucun port). Idempotent (verrou de ligne).
 */
export async function publishDueAnnouncements(deps: MessagingDeps, ctx: RequestContext): Promise<number> {
  const result = await inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const due = await repo.listDueScheduled(tx, ctx.tenantId, now, 50);
    const events = new EventBuffer(deps, ctx);
    let n = 0;
    for (const a of due) {
      if (a.expiresAt && a.expiresAt.getTime() <= now.getTime()) {
        // Échéance dépassée avant la publication : elle ne sera jamais visible, on la retire proprement.
        await repo.setAnnouncementStatus(tx, ctx.tenantId, a.id, { status: "WITHDRAWN", withdrawnAt: now, withdrawnBy: a.authorId, withdrawalReason: "Expirée avant sa publication programmée." }, now);
        continue;
      }
      const userIds = await repo.listRecipientIds(tx, ctx.tenantId, a.id);
      await repo.setAnnouncementStatus(tx, ctx.tenantId, a.id, { status: "PUBLISHED", publishedAt: now, recipientCount: userIds.length }, now);
      await announceToRecipients(deps, ctx, tx, events, { ...a, status: "PUBLISHED" }, userIds, now);
      n += 1;
    }
    await events.flush(tx);
    return ok(n);
  });
  return result.ok ? result.value : 0;
}
