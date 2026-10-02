/**
 * Modération (spec v2/016 §8) : signalement par un participant, décision tracée, restrictions d'envoi, supervision motivée.
 * Chaque lecture de contenu d'autrui par la modération est AUDITÉE (permissions sensibles, MFA exigée par le garde RBAC).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  MessagingConversationSummaryDto,
  MessagingDecideReportBody,
  MessagingReportDto,
  MessagingReportReason,
} from "@ecoledigitale/contracts/src/v2/messaging";
import { conflict, forbidden, MessagingCode, notFound, validation } from "../domain/errors";
import { MessagingEvents } from "../domain/events";
import { decodeCursor, encodeCursor } from "../domain/text";
import type { Uuid } from "../domain/types";
import * as repo from "../infrastructure/conversations-repository";
import * as modRepo from "../infrastructure/moderation-repository";
import * as notif from "../infrastructure/notifications-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { refreshPreview } from "./conversations";
import { EventBuffer, inTx, type MessagingDeps } from "./deps";
import { participantView, rawMessageView, reportView } from "./views";

const noUser = () => err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));

/** Contexte de lecture d'un signalement : le message et ses voisins (radius). */
export const REPORT_CONTEXT_RADIUS = 5;

// ---------------------------------------------------------------------------
// Signalement (tout participant)
// ---------------------------------------------------------------------------

export async function reportMessage(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { messageId: Uuid; reason: MessagingReportReason; details?: string | undefined },
): Promise<Result<{ reportId: Uuid }, AppError>> {
  const me = ctx.userId;
  if (!me) return noUser();
  return inTx(deps, ctx, async (tx) => {
    const msg = await repo.getMessage(tx, ctx.tenantId, input.messageId);
    const participant = msg ? await repo.getParticipant(tx, ctx.tenantId, msg.conversationId, me) : null;
    if (!msg || !participant || participant.leftAt) return err(notFound(MessagingCode.MESSAGE_NOT_FOUND, "Message", input.messageId));
    if (msg.kind === "SYSTEM") return err(validation(MessagingCode.INVALID_INPUT, "Un message système ne se signale pas.", "messageId"));
    if (msg.senderId === me) return err(validation(MessagingCode.INVALID_INPUT, "Vous ne pouvez pas signaler votre propre message.", "messageId"));
    const id = deps.newId();
    const inserted = await modRepo.insertReport(tx, ctx.tenantId, { id, messageId: msg.id, conversationId: msg.conversationId, reporterId: me, reason: input.reason, details: input.details?.trim() ?? null, createdAt: deps.clock.now() });
    if (!inserted) return err(conflict(MessagingCode.ALREADY_REPORTED, "Vous avez déjà signalé ce message."));
    const events = new EventBuffer(deps, ctx);
    events.add(MessagingEvents.MESSAGE_REPORTED, { v: 1, reportId: id, messageId: msg.id, conversationId: msg.conversationId, reason: input.reason }, { type: "report", id });
    events.audit({ action: "messaging.message.reported", resourceType: "report", resourceId: id, metadata: { messageId: msg.id, reason: input.reason } });
    await events.flush(tx);
    return ok({ reportId: id });
  });
}

// ---------------------------------------------------------------------------
// Modérateur
// ---------------------------------------------------------------------------

export async function listReports(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { status?: "OPEN" | "DISMISSED" | "ACTIONED" | undefined; cursor?: string | undefined; limit: number },
): Promise<Result<{ items: MessagingReportDto[]; nextCursor: string | null }, AppError>> {
  const cursor = decodeCursor(input.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await modRepo.listReports(tx, ctx.tenantId, { status: input.status, cursor, limit: input.limit + 1 });
      const page = rows.slice(0, input.limit);
      const names = await deps.ports.directory.getDisplayNames(ctx, page.map((r) => r.reporterId));
      const last = page[page.length - 1];
      return ok({
        items: page.map((r) => reportView(r, names.get(r.reporterId) ?? null)),
        nextCursor: rows.length > input.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
      });
    },
    { readOnly: true },
  );
}

/** Le message signalé et ses voisins, avec corps réel (même retiré). Lecture AUDITÉE. */
export async function getReportContext(deps: MessagingDeps, ctx: RequestContext, input: { reportId: Uuid }) {
  const me = ctx.userId;
  if (!me) return noUser();
  return inTx(deps, ctx, async (tx) => {
    const report = await modRepo.getReport(tx, ctx.tenantId, input.reportId);
    if (!report) return err(notFound(MessagingCode.REPORT_NOT_FOUND, "Signalement", input.reportId));
    const msg = await repo.getMessage(tx, ctx.tenantId, report.messageId);
    const conv = await repo.getConversation(tx, ctx.tenantId, report.conversationId);
    if (!msg || !conv) return err(notFound(MessagingCode.MESSAGE_NOT_FOUND, "Message", report.messageId));
    const around = await repo.listMessagesAround(tx, ctx.tenantId, conv.id, msg.seq, REPORT_CONTEXT_RADIUS);
    const atts = await repo.listAttachmentsOfMessages(tx, ctx.tenantId, around.map((m) => m.id));
    const participants = await repo.listParticipants(tx, ctx.tenantId, conv.id);
    const names = await deps.ports.directory.getDisplayNames(ctx, [report.reporterId]);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "messaging.report.context_read", resourceType: "report", resourceId: report.id, sensitive: true, metadata: { messageId: msg.id, conversationId: conv.id } });
    await events.flush(tx);
    return ok({
      report: reportView(report, names.get(report.reporterId) ?? null),
      subject: conv.subject,
      participants: participants.map((p) => participantView({ userId: p.userId, displayName: p.displayName, role: p.role, left: p.leftAt !== null })),
      messages: around.map((m) => rawMessageView(m, null, atts)),
    });
  });
}

export async function decideReport(deps: MessagingDeps, ctx: RequestContext, input: { reportId: Uuid } & MessagingDecideReportBody): Promise<Result<MessagingReportDto, AppError>> {
  const me = ctx.userId;
  if (!me) return noUser();
  return inTx(deps, ctx, async (tx) => {
    const report = await modRepo.getReport(tx, ctx.tenantId, input.reportId, { forUpdate: true });
    if (!report) return err(notFound(MessagingCode.REPORT_NOT_FOUND, "Signalement", input.reportId));
    if (report.status !== "OPEN") return err(conflict(MessagingCode.REPORT_ALREADY_DECIDED, "Ce signalement a déjà été traité.", { status: report.status }));
    const msg = await repo.getMessage(tx, ctx.tenantId, report.messageId);
    if (!msg) return err(notFound(MessagingCode.MESSAGE_NOT_FOUND, "Message", report.messageId));
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    const status = input.decision === "DISMISS" ? ("DISMISSED" as const) : ("ACTIONED" as const);
    let messageRemoved = false;
    let senderRestricted = false;

    if (input.decision === "ACTION") {
      if (input.removeMessage && (await repo.markMessageRemoved(tx, ctx.tenantId, msg.id, { by: me, kind: "MODERATOR", reason: input.note.trim(), at: now }))) {
        messageRemoved = true;
        await refreshPreview(tx, ctx, msg.conversationId);
        events.add(MessagingEvents.MESSAGE_REMOVED, { v: 1, conversationId: msg.conversationId, messageId: msg.id, removedBy: me, removalKind: "MODERATOR" }, { type: "conversation", id: msg.conversationId });
      }
      if (input.restrictSender && msg.senderId) {
        const until = input.restrictSender.untilDays === null ? null : new Date(now.getTime() + input.restrictSender.untilDays * 86_400_000);
        await settingsRepo.upsertRestriction(tx, ctx.tenantId, { userId: msg.senderId, restrictedUntil: until, reason: input.note.trim(), setBy: me, setAt: now, reportId: report.id });
        senderRestricted = true;
        events.add(MessagingEvents.USER_RESTRICTED, { v: 1, userId: msg.senderId, restrictedUntil: until ? until.toISOString() : null, setBy: me }, { type: "user", id: msg.senderId });
      }
      if (msg.senderId && (messageRemoved || senderRestricted)) {
        await notif.insertNotifications(tx, {
          tenantId: ctx.tenantId,
          category: "MODERATION",
          entityType: "message",
          bypassPrefs: true,
          now,
          rows: [
            {
              id: deps.newId(),
              userId: msg.senderId,
              title: senderRestricted ? "Votre envoi de messages a été restreint" : "Un de vos messages a été retiré",
              body: "Décision de la modération de l'établissement.",
              link: null,
              entityId: msg.id,
              dedupeKey: null,
            },
          ],
        });
      }
    }
    // Une décision vaut pour tous les signalements ouverts du même message.
    await modRepo.decideReport(tx, ctx.tenantId, report.id, { status, by: me, at: now, note: input.note.trim() });
    const siblings = await modRepo.decideOpenReportsOfMessage(tx, ctx.tenantId, msg.id, { status, by: me, at: now, note: input.note.trim() });
    events.add(MessagingEvents.REPORT_DECIDED, { v: 1, reportId: report.id, messageId: msg.id, status, messageRemoved, senderRestricted }, { type: "report", id: report.id });
    events.audit({
      action: "messaging.report.decided",
      resourceType: "report",
      resourceId: report.id,
      sensitive: true,
      reason: input.note.trim(),
      metadata: { messageId: msg.id, decision: input.decision, messageRemoved, senderRestricted, alsoClosed: siblings.length },
    });
    await events.flush(tx);
    const fresh = (await modRepo.getReport(tx, ctx.tenantId, report.id))!;
    return ok(reportView(fresh, null));
  });
}

// ---------------------------------------------------------------------------
// Restrictions
// ---------------------------------------------------------------------------

export async function listActiveRestrictions(deps: MessagingDeps, ctx: RequestContext) {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await settingsRepo.listRestrictions(tx, ctx.tenantId, deps.clock.now());
      const names = await deps.ports.directory.getDisplayNames(ctx, rows.map((r) => r.userId));
      return ok({
        items: rows.map((r) => ({ userId: r.userId, displayName: names.get(r.userId) ?? null, restrictedUntil: r.restrictedUntil?.toISOString() ?? null, reason: r.reason, setBy: r.setBy, setAt: r.setAt.toISOString() })),
      });
    },
    { readOnly: true },
  );
}

export async function restrictUser(deps: MessagingDeps, ctx: RequestContext, input: { userId: Uuid; reason: string; untilDays: number | null }): Promise<Result<true, AppError>> {
  const me = ctx.userId;
  if (!me) return noUser();
  if (input.userId === me) return err(validation(MessagingCode.INVALID_INPUT, "Vous ne pouvez pas vous restreindre vous-même.", "userId"));
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const until = input.untilDays === null ? null : new Date(now.getTime() + input.untilDays * 86_400_000);
    await settingsRepo.upsertRestriction(tx, ctx.tenantId, { userId: input.userId, restrictedUntil: until, reason: input.reason.trim(), setBy: me, setAt: now, reportId: null });
    const events = new EventBuffer(deps, ctx);
    events.add(MessagingEvents.USER_RESTRICTED, { v: 1, userId: input.userId, restrictedUntil: until ? until.toISOString() : null, setBy: me }, { type: "user", id: input.userId });
    events.audit({ action: "messaging.restriction.set", resourceType: "user", resourceId: input.userId, sensitive: true, reason: input.reason.trim(), metadata: { until: until?.toISOString() ?? null } });
    await events.flush(tx);
    return ok(true as const);
  });
}

export async function liftRestriction(deps: MessagingDeps, ctx: RequestContext, input: { userId: Uuid }): Promise<Result<true, AppError>> {
  const me = ctx.userId;
  if (!me) return noUser();
  return inTx(deps, ctx, async (tx) => {
    if (!(await settingsRepo.deleteRestriction(tx, ctx.tenantId, input.userId))) return err(notFound(MessagingCode.RESTRICTION_NOT_FOUND, "Restriction", input.userId));
    const events = new EventBuffer(deps, ctx);
    events.add(MessagingEvents.USER_UNRESTRICTED, { v: 1, userId: input.userId, liftedBy: me }, { type: "user", id: input.userId });
    events.audit({ action: "messaging.restriction.lifted", resourceType: "user", resourceId: input.userId, sensitive: true });
    await events.flush(tx);
    return ok(true as const);
  });
}

// ---------------------------------------------------------------------------
// Supervision (parité legacy « vue admin ») : métadonnées sans motif, contenu avec motif OBLIGATOIRE et audité
// ---------------------------------------------------------------------------

export async function superviseListConversations(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { q?: string | undefined; cursor?: string | undefined; limit: number },
): Promise<Result<{ items: MessagingConversationSummaryDto[]; nextCursor: string | null }, AppError>> {
  const cursor = decodeCursor(input.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await modRepo.listConversationsForSupervision(tx, ctx.tenantId, { q: input.q, cursor, limit: input.limit + 1 });
      const page = rows.slice(0, input.limit);
      const briefs = await repo.listParticipantBriefs(tx, ctx.tenantId, page.map((r) => r.id), "00000000-0000-0000-0000-000000000000");
      const last = page[page.length - 1];
      return ok({
        items: page.map((r) => {
          const others = briefs.filter((b) => b.conversationId === r.id);
          return {
            id: r.id, kind: r.kind, subject: r.subject, priority: r.priority, aboutStudentId: r.aboutStudentId, classroomId: r.classroomId, broadcastCount: null,
            participantCount: others[0]?.total ?? 0,
            participants: others.map((b) => participantView({ userId: b.userId, displayName: b.displayName, role: b.role, left: b.left })),
            lastMessageAt: r.lastMessageAt?.toISOString() ?? null, lastPreview: null, unreadCount: 0, archived: false, muted: false, starred: false, allowReplies: r.allowReplies, closed: r.closedAt !== null,
          };
        }),
        nextCursor: rows.length > input.limit && last ? encodeCursor({ t: (last.lastMessageAt ?? last.createdAt).toISOString(), id: last.id }) : null,
      });
    },
    { readOnly: true },
  );
}

export async function superviseReadMessages(deps: MessagingDeps, ctx: RequestContext, input: { conversationId: Uuid; reason: string; before?: number | undefined; limit: number }) {
  const me = ctx.userId;
  if (!me) return noUser();
  const reason = input.reason.trim();
  if (reason.length < 3) return err(validation(MessagingCode.INVALID_INPUT, "Un motif est obligatoire pour lire une conversation.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const conv = await repo.getConversation(tx, ctx.tenantId, input.conversationId);
    if (!conv || conv.kind === "SYSTEM") return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
    const rows = await repo.listMessages(tx, ctx.tenantId, conv.id, { before: input.before, limit: input.limit + 1 });
    const page = rows.slice(0, input.limit);
    const atts = await repo.listAttachmentsOfMessages(tx, ctx.tenantId, page.map((m) => m.id));
    const participants = await repo.listParticipants(tx, ctx.tenantId, conv.id);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "messaging.supervision.read", resourceType: "conversation", resourceId: conv.id, sensitive: true, reason, metadata: { messages: page.length, before: input.before ?? null } });
    await events.flush(tx);
    const oldest = page[page.length - 1];
    return ok({
      conversation: {
        id: conv.id, kind: conv.kind, subject: conv.subject, priority: conv.priority, aboutStudentId: conv.aboutStudentId, classroomId: conv.classroomId, broadcastCount: null,
        participantCount: participants.filter((p) => p.leftAt === null).length, participants: [], lastMessageAt: conv.lastMessageAt?.toISOString() ?? null, lastPreview: null,
        unreadCount: 0, archived: false, muted: false, starred: false, allowReplies: conv.allowReplies, closed: conv.closedAt !== null,
      } satisfies MessagingConversationSummaryDto,
      participants: participants.map((p) => participantView({ userId: p.userId, displayName: p.displayName, role: p.role, left: p.leftAt !== null })),
      items: page.reverse().map((m) => rawMessageView(m, null, atts)),
      nextBefore: rows.length > input.limit && oldest ? oldest.seq : null,
    });
  });
}
