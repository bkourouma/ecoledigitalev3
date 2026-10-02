"use client";

/**
 * Hooks typés du module `messaging` (`/api/v1/messaging/*`). Schémas Zod de `packages/contracts/src/v2/messaging.ts`.
 * AUCUNE règle d'autorisation côté client : qui peut écrire à qui, ce qu'une annonce cible, le calcul des non-lus, les
 * quotas sont décidés par l'API ; l'écran affiche ce qui revient (`/me/audience`, `/recipients`, `canReply`).
 */

import { z } from "zod";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  messagingAnnouncementDtoSchema,
  messagingAnnouncementPageDtoSchema,
  messagingAudiencePreviewDtoSchema,
  messagingConversationDetailDtoSchema,
  messagingConversationPageDtoSchema,
  messagingMessagesPageDtoSchema,
  messagingMyAudienceDtoSchema,
  messagingNotificationPageDtoSchema,
  messagingPreferenceListDtoSchema,
  messagingReceiptPageDtoSchema,
  messagingRecipientListDtoSchema,
  messagingReportContextDtoSchema,
  messagingReportDtoSchema,
  messagingReportPageDtoSchema,
  messagingRestrictionListDtoSchema,
  messagingSearchResultDtoSchema,
  messagingSendResultDtoSchema,
  messagingSettingsDtoSchema,
  messagingSignedUrlDtoSchema,
  messagingSuperviseMessagesDtoSchema,
  messagingConversationPageDtoSchema as superviseListSchema,
  messagingSystemTemplateDtoSchema,
  messagingSystemTemplateListDtoSchema,
  messagingUnreadDtoSchema,
  messagingAttachmentDtoSchema,
  messagingMessageDtoSchema,
  messagingConversationSummaryDtoSchema,
  type MessagingCreateAnnouncementBody,
  type MessagingCreateConversationBody,
  type MessagingDecideReportBody,
  type MessagingUpdateAnnouncementBody,
  type MessagingUpdateSettingsBody,
  type MessagingAudienceSelection,
} from "@ecoledigitale/contracts/v2/messaging";
import { useApiAction } from "./actions";
import { omit } from "./omit";

export const MESSAGING_BASE = "/api/v1/messaging";
const KEY = ["messaging"] as const;

type Query = Record<string, string | number | boolean | undefined>;

// ---------------------------------------------------------------------------
// Moi : profil d'audience, non-lus (cloche), préférences
// ---------------------------------------------------------------------------

export function useMyAudience(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "audience"], `${MESSAGING_BASE}/me/audience`, { schema: messagingMyAudienceDtoSchema, enabled, staleTime: 60_000, retry: false });
}

/** Pastilles (boîte, annonces, notifications) : relues toutes les 30 s tant que l'onglet est ouvert. */
export function useUnreadSummary(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "unread"], `${MESSAGING_BASE}/me/unread`, {
    schema: messagingUnreadDtoSchema,
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useMyPreferences() {
  return hooks.useApiQuery([...KEY, "me", "preferences"], `${MESSAGING_BASE}/me/preferences`, { schema: messagingPreferenceListDtoSchema, retry: false });
}

export function useUpdatePreferences() {
  return useApiAction({
    method: "PUT",
    path: `${MESSAGING_BASE}/me/preferences`,
    body: (v: { preferences: Array<{ category: "MESSAGE" | "ANNOUNCEMENT" | "SYSTEM"; inApp?: boolean; externalChannels?: Array<"EMAIL" | "SMS" | "WHATSAPP" | "PUSH">; mutedUntil?: string | null }> }) => v,
    schema: messagingPreferenceListDtoSchema,
    invalidate: [[...KEY, "me", "preferences"]],
  });
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationsQuery {
  folder: "inbox" | "archived" | "starred" | "sent";
  q?: string;
  unread?: boolean;
}

export function useConversationsInfinite(query: ConversationsQuery, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "conversations", "list"], `${MESSAGING_BASE}/conversations`, {
    query: { folder: query.folder, q: query.q || undefined, unread: query.unread ? "true" : undefined, limit: 30 } as Query,
    schema: messagingConversationPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

export function useSearchMessages(q: string, enabled = true) {
  return hooks.useApiQuery([...KEY, "search"], `${MESSAGING_BASE}/search`, { query: { q, limit: 30 }, schema: messagingSearchResultDtoSchema, enabled: enabled && q.trim().length >= 2, retry: false });
}

export function useConversation(id: string | null) {
  return hooks.useApiQuery([...KEY, "conversations", "one", id], `${MESSAGING_BASE}/conversations/${id}`, { schema: messagingConversationDetailDtoSchema, enabled: id !== null, retry: false });
}

/** Messages d'un fil : première page = les plus récents ; « précédents » remonte par `seq` (`before`). */
export function useConversationMessages(id: string | null) {
  return hooks.useApiInfiniteQuery([...KEY, "conversations", "messages", id], `${MESSAGING_BASE}/conversations/${id}/messages`, {
    query: { limit: 50 },
    cursorParam: "before",
    schema: messagingMessagesPageDtoSchema,
    getNextCursor: (p) => (p.nextBefore === null ? null : String(p.nextBefore)),
    enabled: id !== null,
    retry: false,
  });
}

const CONVERSATION_KEYS = [[...KEY, "conversations"], [...KEY, "me", "unread"], [...KEY, "notifications"], [...KEY, "search"]] as const;

export function useCreateConversation() {
  return useApiAction({
    path: `${MESSAGING_BASE}/conversations`,
    body: (v: MessagingCreateConversationBody) => v,
    schema: messagingSendResultDtoSchema,
    invalidate: CONVERSATION_KEYS,
  });
}

export function usePostMessage(conversationId: string) {
  return useApiAction({
    path: `${MESSAGING_BASE}/conversations/${conversationId}/messages`,
    body: (v: { body: string; attachmentIds: string[]; clientId?: string }) => v,
    schema: z.object({ message: messagingMessageDtoSchema, conversation: messagingConversationSummaryDtoSchema.nullable() }),
    invalidate: CONVERSATION_KEYS,
  });
}

export function useMarkConversationRead(conversationId: string) {
  return useApiAction({
    path: `${MESSAGING_BASE}/conversations/${conversationId}/read`,
    body: () => ({}),
    schema: z.object({ lastReadSeq: z.number().int(), unreadCount: z.number().int() }),
    invalidate: [[...KEY, "conversations", "list"], [...KEY, "me", "unread"], [...KEY, "notifications"]],
  });
}

export function useParticipantState(conversationId: string) {
  return useApiAction({
    method: "PATCH",
    path: `${MESSAGING_BASE}/conversations/${conversationId}/me`,
    body: (v: { archived?: boolean; muted?: boolean; starred?: boolean }) => v,
    schema: messagingConversationSummaryDtoSchema,
    invalidate: CONVERSATION_KEYS,
  });
}

export function useLeaveConversation(conversationId: string) {
  return useApiAction({ path: `${MESSAGING_BASE}/conversations/${conversationId}/leave`, invalidate: CONVERSATION_KEYS });
}

export function useRemoveMessage() {
  return useApiAction({ method: "DELETE", path: (v: { messageId: string }) => `${MESSAGING_BASE}/messages/${v.messageId}`, invalidate: CONVERSATION_KEYS });
}

export function useReportMessage() {
  return useApiAction({
    path: (v: { messageId: string }) => `${MESSAGING_BASE}/messages/${v.messageId}/report`,
    body: (v: { messageId: string; reason: "SPAM" | "HARASSMENT" | "INAPPROPRIATE" | "PRIVACY" | "OTHER"; details?: string }) => omit(v, "messageId"),
    schema: z.object({ reportId: z.string() }),
  });
}

// ---------------------------------------------------------------------------
// Destinataires autorisés et pièces jointes
// ---------------------------------------------------------------------------

export function useRecipients(query: { q?: string; classroomId?: string; kind?: "STUDENT" | "GUARDIAN" | "STAFF" }, enabled = true) {
  return hooks.useApiQuery([...KEY, "recipients"], `${MESSAGING_BASE}/recipients`, {
    query: { q: query.q || undefined, classroomId: query.classroomId, kind: query.kind, limit: 50 } as Query,
    schema: messagingRecipientListDtoSchema,
    select: (d) => d.items,
    enabled,
    keepPreviousData: true,
    retry: false,
  });
}

/** Lit un fichier du navigateur en base64 (sans préfixe `data:`). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function useUploadAttachment() {
  return useApiAction({
    path: `${MESSAGING_BASE}/attachments`,
    body: (v: { fileName: string; contentBase64: string }) => v,
    schema: messagingAttachmentDtoSchema,
  });
}

/** URL signée COURTE d'une pièce (demandée au clic : jamais conservée). */
export function fetchAttachmentUrl(id: string): Promise<z.infer<typeof messagingSignedUrlDtoSchema>> {
  return platformApi.get(`${MESSAGING_BASE}/attachments/${id}/url`, { schema: messagingSignedUrlDtoSchema });
}

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

export interface AnnouncementsQuery {
  scope: "inbox" | "managed";
  status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "WITHDRAWN";
  includeExpired?: boolean;
  unread?: boolean;
}

export function useAnnouncementsInfinite(query: AnnouncementsQuery, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "announcements", "list"], `${MESSAGING_BASE}/announcements`, {
    query: { scope: query.scope, status: query.status, includeExpired: query.includeExpired ? "true" : undefined, unread: query.unread ? "true" : undefined, limit: 30 } as Query,
    schema: messagingAnnouncementPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

export function useAnnouncement(id: string | null) {
  return hooks.useApiQuery([...KEY, "announcements", "one", id], `${MESSAGING_BASE}/announcements/${id}`, { schema: messagingAnnouncementDtoSchema, enabled: id !== null, retry: false });
}

const ANNOUNCEMENT_KEYS = [[...KEY, "announcements"], [...KEY, "me", "unread"], [...KEY, "notifications"]] as const;

export function useCreateAnnouncement() {
  return useApiAction({ path: `${MESSAGING_BASE}/announcements`, body: (v: MessagingCreateAnnouncementBody) => v, schema: messagingAnnouncementDtoSchema, invalidate: ANNOUNCEMENT_KEYS });
}

export function useUpdateAnnouncement() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string } & MessagingUpdateAnnouncementBody) => `${MESSAGING_BASE}/announcements/${v.id}`,
    body: (v: { id: string } & MessagingUpdateAnnouncementBody) => omit(v, "id"),
    schema: messagingAnnouncementDtoSchema,
    invalidate: ANNOUNCEMENT_KEYS,
  });
}

export function usePublishAnnouncement() {
  return useApiAction({
    path: (v: { id: string; publishAt?: string }) => `${MESSAGING_BASE}/announcements/${v.id}/publish`,
    body: (v: { id: string; publishAt?: string }) => omit(v, "id"),
    schema: messagingAnnouncementDtoSchema,
    invalidate: ANNOUNCEMENT_KEYS,
  });
}

export function useWithdrawAnnouncement() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${MESSAGING_BASE}/announcements/${v.id}/withdraw`,
    body: (v: { id: string; reason: string }) => omit(v, "id"),
    schema: messagingAnnouncementDtoSchema,
    invalidate: ANNOUNCEMENT_KEYS,
  });
}

export function useDeleteAnnouncementDraft() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${MESSAGING_BASE}/announcements/${v.id}`, invalidate: ANNOUNCEMENT_KEYS });
}

export function useMarkAnnouncementRead() {
  return useApiAction({
    path: (v: { id: string }) => `${MESSAGING_BASE}/announcements/${v.id}/read`,
    body: () => ({}),
    schema: z.object({ readAt: z.string() }),
    invalidate: [[...KEY, "announcements"], [...KEY, "me", "unread"], [...KEY, "notifications"]],
  });
}

export function useAcknowledgeAnnouncement() {
  return useApiAction({
    path: (v: { id: string }) => `${MESSAGING_BASE}/announcements/${v.id}/acknowledge`,
    body: () => ({}),
    schema: z.object({ acknowledgedAt: z.string() }),
    invalidate: [[...KEY, "announcements"], [...KEY, "me", "unread"], [...KEY, "notifications"]],
  });
}

export function useAnnouncementReceipts(id: string | null, state: "all" | "unread" | "read" | "acknowledged" | "pending_ack", enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "announcements", "receipts", id, state], `${MESSAGING_BASE}/announcements/${id}/receipts`, {
    query: { state, limit: 50 },
    schema: messagingReceiptPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled: enabled && id !== null,
    retry: false,
  });
}

export function useAudiencePreview() {
  return useApiAction({ path: `${MESSAGING_BASE}/announcements/audience-preview`, body: (v: MessagingAudienceSelection) => v, schema: messagingAudiencePreviewDtoSchema });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function useNotificationsInfinite(unreadOnly: boolean, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "notifications", "list", unreadOnly], `${MESSAGING_BASE}/notifications`, {
    query: { unread: unreadOnly ? "true" : undefined, limit: 30 } as Query,
    schema: messagingNotificationPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

/** Les cinq dernières notifications (menu de la cloche). */
export function useLatestNotifications(enabled: boolean) {
  return hooks.useApiQuery([...KEY, "notifications", "latest"], `${MESSAGING_BASE}/notifications`, { query: { limit: 5 }, schema: messagingNotificationPageDtoSchema, enabled, retry: false });
}

const NOTIFICATION_KEYS = [[...KEY, "notifications"], [...KEY, "me", "unread"]] as const;

export function useMarkNotificationRead() {
  return useApiAction({
    path: (v: { id: string }) => `${MESSAGING_BASE}/notifications/${v.id}/read`,
    body: () => ({}),
    schema: z.object({ unreadCount: z.number().int() }),
    invalidate: NOTIFICATION_KEYS,
  });
}

export function useMarkAllNotificationsRead() {
  return useApiAction({ path: `${MESSAGING_BASE}/notifications/read-all`, body: () => ({}), schema: z.object({ markedRead: z.number().int() }), invalidate: NOTIFICATION_KEYS });
}

// ---------------------------------------------------------------------------
// Modération et supervision
// ---------------------------------------------------------------------------

export function useReports(status: "OPEN" | "DISMISSED" | "ACTIONED" | undefined) {
  return hooks.useApiInfiniteQuery([...KEY, "moderation", "reports", status ?? "all"], `${MESSAGING_BASE}/moderation/reports`, {
    query: { status, limit: 30 } as Query,
    schema: messagingReportPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    retry: false,
  });
}

export function useReportContext(id: string | null) {
  return hooks.useApiQuery([...KEY, "moderation", "report", id], `${MESSAGING_BASE}/moderation/reports/${id}`, { schema: messagingReportContextDtoSchema, enabled: id !== null, retry: false, staleTime: 0, gcTime: 0 });
}

export function useDecideReport() {
  return useApiAction({
    path: (v: { id: string } & MessagingDecideReportBody) => `${MESSAGING_BASE}/moderation/reports/${v.id}/decide`,
    body: (v: { id: string } & MessagingDecideReportBody) => omit(v, "id"),
    schema: messagingReportDtoSchema,
    invalidate: [[...KEY, "moderation"]],
  });
}

export function useRestrictions() {
  return hooks.useApiQuery([...KEY, "moderation", "restrictions"], `${MESSAGING_BASE}/moderation/restrictions`, { schema: messagingRestrictionListDtoSchema, select: (d) => d.items, retry: false });
}

export function useLiftRestriction() {
  return useApiAction({ method: "DELETE", path: (v: { userId: string }) => `${MESSAGING_BASE}/moderation/restrictions/${v.userId}`, invalidate: [[...KEY, "moderation", "restrictions"]] });
}

export function useSuperviseConversations(q: string, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "moderation", "supervise", q], `${MESSAGING_BASE}/moderation/conversations`, {
    query: { q: q || undefined, limit: 30 } as Query,
    schema: superviseListSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

/** Lecture supervisée (requête immédiate) : renvoie le fil, la lecture est auditée. */
export function superviseRead(conversationId: string, reason: string): Promise<z.infer<typeof messagingSuperviseMessagesDtoSchema>> {
  return platformApi.get(`${MESSAGING_BASE}/moderation/conversations/${conversationId}/messages`, { query: { reason, limit: 100 }, schema: messagingSuperviseMessagesDtoSchema });
}

// ---------------------------------------------------------------------------
// Paramètres et gabarits
// ---------------------------------------------------------------------------

export function useMessagingSettings(enabled = true) {
  return hooks.useApiQuery([...KEY, "settings"], `${MESSAGING_BASE}/settings`, { schema: messagingSettingsDtoSchema, enabled, retry: false });
}

export function useUpdateMessagingSettings() {
  return useApiAction({ method: "PUT", path: `${MESSAGING_BASE}/settings`, body: (v: MessagingUpdateSettingsBody) => v, schema: messagingSettingsDtoSchema, invalidate: [[...KEY, "settings"], [...KEY, "me", "audience"]] });
}

export function useSystemTemplates() {
  return hooks.useApiQuery([...KEY, "templates"], `${MESSAGING_BASE}/templates`, { schema: messagingSystemTemplateListDtoSchema, select: (d) => d.items, retry: false });
}

export function useUpdateSystemTemplate() {
  return useApiAction({
    method: "PUT",
    path: (v: { code: string; title?: string; body?: string; enabled?: boolean }) => `${MESSAGING_BASE}/templates/${v.code}`,
    body: (v: { code: string; title?: string; body?: string; enabled?: boolean }) => omit(v, "code"),
    schema: messagingSystemTemplateDtoSchema,
    invalidate: [[...KEY, "templates"]],
  });
}
