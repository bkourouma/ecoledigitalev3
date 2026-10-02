/**
 * Notifications in-app, compteurs de la cloche et préférences par utilisateur (spec v2/016 §7).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { MessagingNotificationDto, MessagingPreferenceDto, MessagingUnreadDto } from "@ecoledigitale/contracts/src/v2/messaging";
import { MESSAGING_EXTERNAL_CHANNELS, MESSAGING_PREFERENCE_CATEGORIES } from "@ecoledigitale/contracts/src/v2/messaging";
import { forbidden, MessagingCode, notFound } from "../domain/errors";
import { decodeCursor, encodeCursor } from "../domain/text";
import * as annRepo from "../infrastructure/announcements-repository";
import * as convRepo from "../infrastructure/conversations-repository";
import * as repo from "../infrastructure/notifications-repository";
import { inTx, type MessagingDeps } from "./deps";
import { notificationView } from "./views";

const needUser = (ctx: RequestContext): string | null => ctx.userId;
const noUser = () => err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));

export async function listMyNotifications(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { unreadOnly?: boolean | undefined; cursor?: string | undefined; limit: number },
): Promise<Result<{ items: MessagingNotificationDto[]; nextCursor: string | null; unreadCount: number }, AppError>> {
  const me = needUser(ctx);
  if (!me) return noUser();
  const cursor = decodeCursor(input.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listNotifications(tx, ctx.tenantId, me, { unreadOnly: input.unreadOnly === true, cursor, limit: input.limit + 1 });
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return ok({
        items: page.map(notificationView),
        nextCursor: rows.length > input.limit && last ? encodeCursor({ t: last.updatedAt.toISOString(), id: last.id }) : null,
        unreadCount: await repo.countUnreadNotifications(tx, ctx.tenantId, me),
      });
    },
    { readOnly: true },
  );
}

export async function markNotificationRead(deps: MessagingDeps, ctx: RequestContext, input: { notificationId: string }): Promise<Result<{ unreadCount: number }, AppError>> {
  const me = needUser(ctx);
  if (!me) return noUser();
  return inTx(deps, ctx, async (tx) => {
    const found = await repo.markNotificationRead(tx, ctx.tenantId, me, input.notificationId, deps.clock.now());
    if (!found) return err(notFound(MessagingCode.NOTIFICATION_NOT_FOUND, "Notification", input.notificationId));
    return ok({ unreadCount: await repo.countUnreadNotifications(tx, ctx.tenantId, me) });
  });
}

export async function markAllNotificationsRead(deps: MessagingDeps, ctx: RequestContext): Promise<Result<{ markedRead: number }, AppError>> {
  const me = needUser(ctx);
  if (!me) return noUser();
  return inTx(deps, ctx, async (tx) => ok({ markedRead: await repo.markAllNotificationsRead(tx, ctx.tenantId, me, deps.clock.now()) }));
}

/** Pastilles de la cloche et de la boîte : fils non lus, annonces non lues, notifications non lues. Lecture seule. */
export async function getUnreadSummary(deps: MessagingDeps, ctx: RequestContext): Promise<Result<MessagingUnreadDto, AppError>> {
  const me = needUser(ctx);
  if (!me) return noUser();
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok({
        conversations: await convRepo.countUnreadConversations(tx, ctx.tenantId, me),
        announcements: await annRepo.countUnreadAnnouncements(tx, ctx.tenantId, me, deps.clock.now()),
        notifications: await repo.countUnreadNotifications(tx, ctx.tenantId, me),
      }),
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Préférences
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCE = (category: MessagingPreferenceDto["category"]): MessagingPreferenceDto => ({
  category,
  inApp: true,
  externalChannels: [...MESSAGING_EXTERNAL_CHANNELS],
  mutedUntil: null,
});

export async function getMyPreferences(deps: MessagingDeps, ctx: RequestContext): Promise<Result<{ items: MessagingPreferenceDto[] }, AppError>> {
  const me = needUser(ctx);
  if (!me) return noUser();
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = new Map((await repo.listPreferences(tx, ctx.tenantId, me)).map((r) => [r.category, r]));
      return ok({
        items: MESSAGING_PREFERENCE_CATEGORIES.map((category) => {
          const r = rows.get(category);
          return r ? { category, inApp: r.inApp, externalChannels: r.externalChannels as MessagingPreferenceDto["externalChannels"], mutedUntil: r.mutedUntil?.toISOString() ?? null } : DEFAULT_PREFERENCE(category);
        }),
      });
    },
    { readOnly: true },
  );
}

export async function updateMyPreferences(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { preferences: ReadonlyArray<{ category: MessagingPreferenceDto["category"]; inApp?: boolean | undefined; externalChannels?: readonly string[] | undefined; mutedUntil?: string | null | undefined }> },
): Promise<Result<{ items: MessagingPreferenceDto[] }, AppError>> {
  const me = needUser(ctx);
  if (!me) return noUser();
  const result = await inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const current = new Map((await repo.listPreferences(tx, ctx.tenantId, me)).map((r) => [r.category, r]));
    for (const p of input.preferences) {
      const base = current.get(p.category) ?? { category: p.category, inApp: true, externalChannels: [...MESSAGING_EXTERNAL_CHANNELS], mutedUntil: null };
      await repo.upsertPreference(
        tx,
        ctx.tenantId,
        me,
        {
          category: p.category,
          inApp: p.inApp ?? base.inApp,
          externalChannels: p.externalChannels ? [...new Set(p.externalChannels)] : base.externalChannels,
          mutedUntil: p.mutedUntil === undefined ? base.mutedUntil : p.mutedUntil === null ? null : new Date(p.mutedUntil),
        },
        now,
      );
    }
    return ok(true as const);
  });
  if (!result.ok) return result;
  return getMyPreferences(deps, ctx);
}

/** Purge des notifications LUES anciennes (job quotidien, par tenant). */
export async function purgeOldNotifications(deps: MessagingDeps, ctx: RequestContext, retentionDays: number): Promise<number> {
  const before = new Date(deps.clock.now().getTime() - retentionDays * 86_400_000);
  const r = await inTx(deps, ctx, async (tx) => ok(await repo.purgeReadNotifications(tx, ctx.tenantId, before)));
  return r.ok ? r.value : 0;
}
