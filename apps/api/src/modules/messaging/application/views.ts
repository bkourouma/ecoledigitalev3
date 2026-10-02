/**
 * Vues (DTO de `packages/contracts/src/v2/messaging.ts`) construites depuis les lignes SQL. Dates en ISO 8601 UTC.
 * Un message retiré n'expose JAMAIS son corps aux participants (`body: null`).
 */
import type {
  MessagingAnnouncementDto,
  MessagingAttachmentDto,
  MessagingConversationSummaryDto,
  MessagingMessageDto,
  MessagingNotificationDto,
  MessagingParticipantDto,
  MessagingReportDto,
} from "@ecoledigitale/contracts/src/v2/messaging";
import { isExpired, type StoredTarget } from "../domain/announcements";
import type { AnnouncementRow } from "../infrastructure/announcements-repository";
import type { AttachmentRow, InboxRow, MessageRow, ParticipantBrief, ParticipantRow } from "../infrastructure/conversations-repository";
import type { ReportRow } from "../infrastructure/moderation-repository";
import type { NotificationRow } from "../infrastructure/notifications-repository";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const attachmentView = (a: AttachmentRow): MessagingAttachmentDto => ({ id: a.id, fileName: a.fileName, mimeType: a.detectedMime, sizeBytes: a.sizeBytes });

export const participantView = (p: Pick<ParticipantRow, "userId" | "displayName" | "role"> & { left: boolean }): MessagingParticipantDto => ({
  userId: p.userId,
  displayName: p.displayName,
  role: p.role,
  left: p.left,
});

export function messageView(m: MessageRow, viewerId: string | null, attachments: readonly AttachmentRow[]): MessagingMessageDto {
  const removed = m.removedAt !== null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq,
    kind: m.kind,
    senderId: m.senderId,
    senderName: m.senderName,
    body: removed ? null : m.body,
    removed,
    removalKind: m.removalKind,
    mine: viewerId !== null && m.senderId === viewerId,
    systemCode: m.systemCode,
    attachments: removed ? [] : attachments.filter((a) => a.messageId === m.id).map(attachmentView),
    createdAt: m.createdAt.toISOString(),
  };
}

/** Vue de supervision / modération : corps réel même pour un message retiré (lecture auditée). */
export const rawMessageView = (m: MessageRow, viewerId: string | null, attachments: readonly AttachmentRow[]): MessagingMessageDto & { rawBody: string } => ({
  ...messageView(m, viewerId, attachments),
  attachments: attachments.filter((a) => a.messageId === m.id).map(attachmentView),
  rawBody: m.body,
});

export function conversationSummary(row: InboxRow, briefs: readonly ParticipantBrief[]): MessagingConversationSummaryDto {
  const others = briefs.filter((b) => b.conversationId === row.id);
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    priority: row.priority,
    aboutStudentId: row.aboutStudentId,
    classroomId: row.classroomId,
    broadcastCount: row.broadcastCount,
    participantCount: (others[0]?.total ?? 0) + 1,
    participants: others.map((b) => participantView({ userId: b.userId, displayName: b.displayName, role: b.role, left: b.left })),
    lastMessageAt: iso(row.lastMessageAt),
    lastPreview: row.lastPreview,
    unreadCount: Math.max(0, row.lastSeq - row.lastReadSeq),
    archived: row.archivedAt !== null,
    muted: row.muted,
    starred: row.starred,
    allowReplies: row.allowReplies,
    closed: row.closedAt !== null,
  };
}

export function announcementView(
  a: AnnouncementRow,
  extra: {
    targets: readonly StoredTarget[];
    attachments: readonly AttachmentRow[];
    now: Date;
    mine: { readAt: Date | null; acknowledgedAt: Date | null } | null;
    stats: { recipients: number; read: number; acknowledged: number } | null;
  },
): MessagingAnnouncementDto {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    status: a.status,
    authorId: a.authorId,
    authorName: a.authorName,
    audiences: a.audiences,
    targets: extra.targets.map((t) => ({ kind: t.kind, ref: t.ref === "" ? null : t.ref })),
    requireAck: a.requireAck,
    pinned: a.pinned,
    publishAt: iso(a.publishAt),
    expiresAt: iso(a.expiresAt),
    publishedAt: iso(a.publishedAt),
    withdrawnAt: iso(a.withdrawnAt),
    expired: isExpired(a.expiresAt, extra.now),
    attachments: extra.attachments.map(attachmentView),
    myReadAt: iso(extra.mine?.readAt ?? null),
    myAcknowledgedAt: iso(extra.mine?.acknowledgedAt ?? null),
    stats: extra.stats ? { ...extra.stats, truncated: a.recipientsTruncated } : null,
  };
}

export const notificationView = (n: NotificationRow): MessagingNotificationDto => ({
  id: n.id,
  category: n.category,
  title: n.title,
  body: n.body,
  link: n.link,
  occurrences: n.occurrences,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
  readAt: iso(n.readAt),
});

export const reportView = (r: ReportRow, reporterName: string | null): MessagingReportDto => ({
  id: r.id,
  messageId: r.messageId,
  conversationId: r.conversationId,
  reporterId: r.reporterId,
  reporterName,
  reason: r.reason,
  details: r.details,
  status: r.status,
  decidedBy: r.decidedBy,
  decidedAt: iso(r.decidedAt),
  decisionNote: r.decisionNote,
  createdAt: r.createdAt.toISOString(),
});
