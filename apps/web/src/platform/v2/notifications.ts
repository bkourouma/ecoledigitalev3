"use client";

/**
 * Hooks typés du module `notifications` (`/api/v1/notifications/*`). Schémas Zod de `packages/contracts/src/v2/notifications.ts`.
 * AUCUNE règle côté client : qui est notifié, par quel canal, avec quels seuils, le consentement, les heures calmes, les
 * plafonds sont décidés par l'API ; l'écran affiche ce qui revient (et les erreurs `notifications.*` stables).
 * Le journal ne restitue jamais d'adresse complète ni de contenu : le destinataire est MASQUÉ.
 */

import {
  notifCatalogResponseSchema,
  notifChannelsResponseSchema,
  notifConsentLogResponseSchema,
  notifDeliveryListResponseSchema,
  notifDeliveryStatsResponseSchema,
  notifPreferencesSchema,
  notifPreviewResponseSchema,
  notifPushDevicesResponseSchema,
  notifRuleListResponseSchema,
  notifRuleViewSchema,
  notifSendResponseSchema,
  notifSettingsSchema,
  notifSupportedEventsResponseSchema,
  notifTemplateListResponseSchema,
  notifTemplateVersionsResponseSchema,
  notifUnsubscribeResponseSchema,
  notifVapidKeyResponseSchema,
  type NotifChannel,
  type NotifDeliveryListQuery,
  type NotifPushSubscribeBody,
  type NotifSaveRuleBody,
  type NotifSendBody,
  type NotifUpdatePreferencesBody,
  type NotifUpdateSettingsBody,
} from "@ecoledigitale/contracts/v2/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import type { ApiError } from "@/platform/api/errors";
import { useApiAction } from "./actions";

export const NOTIFICATIONS_BASE = "/api/v1/notifications";
const KEY = ["notifications"] as const;

type Query = Record<string, string | number | boolean | undefined>;

// ---------------------------------------------------------------------------
// Catalogue et déclencheurs
// ---------------------------------------------------------------------------

export function useNotifCatalog(enabled = true) {
  return hooks.useApiQuery([...KEY, "catalog"], `${NOTIFICATIONS_BASE}/catalog`, { schema: notifCatalogResponseSchema, enabled, staleTime: 300_000, retry: false });
}

export function useNotifTriggers(enabled = true) {
  return hooks.useApiQuery([...KEY, "triggers"], `${NOTIFICATIONS_BASE}/triggers`, { schema: notifSupportedEventsResponseSchema, enabled, staleTime: 300_000, retry: false });
}

// ---------------------------------------------------------------------------
// Gabarits (versionnés)
// ---------------------------------------------------------------------------

export function useNotifTemplates(enabled = true) {
  return hooks.useApiQuery([...KEY, "templates"], `${NOTIFICATIONS_BASE}/templates`, { schema: notifTemplateListResponseSchema, enabled, retry: false });
}

export function useTemplateVersions(code: string | null, channel: NotifChannel | null) {
  return hooks.useApiQuery([...KEY, "templates", "versions", code, channel], `${NOTIFICATIONS_BASE}/templates/${code}/versions`, {
    query: { channel: channel ?? undefined } as Query,
    schema: notifTemplateVersionsResponseSchema,
    enabled: code !== null && channel !== null,
    retry: false,
  });
}

export function usePublishTemplate() {
  return useApiAction({
    method: "POST",
    path: (v: { code: string; channel: NotifChannel; subject?: string; body: string; note?: string }) => `${NOTIFICATIONS_BASE}/templates/${v.code}`,
    body: (v) => ({ channel: v.channel, locale: "fr-CI", ...(v.subject ? { subject: v.subject } : {}), body: v.body, ...(v.note ? { note: v.note } : {}) }),
    schema: z.object({ version: z.number().int() }),
    invalidate: [[...KEY, "templates"]],
  });
}

export function useActivateTemplateVersion() {
  return useApiAction({
    method: "POST",
    path: (v: { code: string; channel: NotifChannel; version: number }) => `${NOTIFICATIONS_BASE}/templates/${v.code}/activate`,
    body: (v) => ({ channel: v.channel, locale: "fr-CI", version: v.version }),
    schema: z.object({ version: z.number().int() }),
    invalidate: [[...KEY, "templates"]],
  });
}

export function useEnableTemplate() {
  return useApiAction({
    method: "POST",
    path: (v: { code: string; channel: NotifChannel; enabled: boolean }) => `${NOTIFICATIONS_BASE}/templates/${v.code}/enable`,
    body: (v) => ({ channel: v.channel, locale: "fr-CI", enabled: v.enabled }),
    schema: z.object({ enabled: z.boolean() }),
    invalidate: [[...KEY, "templates"]],
  });
}

/** Aperçu (aucune écriture) : brouillon facultatif, valeurs d'essai facultatives. */
export function usePreviewTemplate() {
  return useApiAction({
    method: "POST",
    path: (v: { code: string; channel: NotifChannel; subject?: string; body?: string; variables?: Record<string, unknown> }) => `${NOTIFICATIONS_BASE}/templates/${v.code}/preview`,
    body: (v) => ({ channel: v.channel, locale: "fr-CI", ...(v.subject !== undefined ? { subject: v.subject } : {}), ...(v.body !== undefined ? { body: v.body } : {}), ...(v.variables ? { variables: v.variables } : {}) }),
    schema: notifPreviewResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

export function useNotifRules(enabled = true) {
  return hooks.useApiQuery([...KEY, "rules"], `${NOTIFICATIONS_BASE}/rules`, { schema: notifRuleListResponseSchema, enabled, retry: false });
}

export function useSaveRule() {
  return useApiAction({
    method: "PUT",
    path: (v: { key: string; body: NotifSaveRuleBody }) => `${NOTIFICATIONS_BASE}/rules/${v.key}`,
    body: (v) => v.body,
    schema: notifRuleViewSchema,
    invalidate: [[...KEY, "rules"]],
  });
}

export function useResetRule() {
  return useApiAction({
    method: "DELETE",
    path: (v: { key: string }) => `${NOTIFICATIONS_BASE}/rules/${v.key}`,
    invalidate: [[...KEY, "rules"]],
  });
}

// ---------------------------------------------------------------------------
// Paramètres, canaux et santé
// ---------------------------------------------------------------------------

export function useNotifSettings(enabled = true) {
  return hooks.useApiQuery([...KEY, "settings"], `${NOTIFICATIONS_BASE}/settings`, { schema: notifSettingsSchema, enabled, retry: false });
}

export function useUpdateNotifSettings() {
  return useApiAction({
    method: "PUT",
    path: `${NOTIFICATIONS_BASE}/settings`,
    body: (v: NotifUpdateSettingsBody) => v,
    schema: notifSettingsSchema,
    invalidate: [[...KEY, "settings"], [...KEY, "channels"]],
  });
}

/** État de santé : relu toutes les 30 s tant que l'onglet est ouvert. */
export function useNotifChannels(enabled = true) {
  return hooks.useApiQuery([...KEY, "channels"], `${NOTIFICATIONS_BASE}/channels`, { schema: notifChannelsResponseSchema, enabled, staleTime: 10_000, refetchInterval: 30_000, retry: false });
}

export function useChannelTest() {
  return useApiAction({
    method: "POST",
    path: `${NOTIFICATIONS_BASE}/channels/test`,
    body: (v: { channels: NotifChannel[] }) => v,
    schema: z.object({ queued: z.number().int(), skipped: z.number().int() }),
    invalidate: [[...KEY, "deliveries"], [...KEY, "channels"]],
  });
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export type DeliveryFilters = Partial<Pick<NotifDeliveryListQuery, "channel" | "status" | "category" | "templateCode" | "sourceKind" | "ruleKey" | "userId" | "from" | "to">>;

export function useDeliveriesInfinite(filters: DeliveryFilters, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "deliveries", "list", JSON.stringify(filters)], `${NOTIFICATIONS_BASE}/deliveries`, {
    query: { ...(filters as Query), limit: 30 },
    schema: notifDeliveryListResponseSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

export function useDeliveryStats(days = 7, enabled = true) {
  return hooks.useApiQuery([...KEY, "deliveries", "stats", days], `${NOTIFICATIONS_BASE}/deliveries/stats`, { query: { days }, schema: notifDeliveryStatsResponseSchema, enabled, retry: false });
}

// ---------------------------------------------------------------------------
// Envoi manuel
// ---------------------------------------------------------------------------

export function useSendNotification() {
  return useApiAction({
    method: "POST",
    path: `${NOTIFICATIONS_BASE}/send`,
    body: (v: NotifSendBody) => v,
    schema: notifSendResponseSchema,
    invalidate: [[...KEY, "deliveries"]],
  });
}

// ---------------------------------------------------------------------------
// Moi : préférences, heures calmes, appareils Web Push
// ---------------------------------------------------------------------------

export function useMyNotifPreferences(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "preferences"], `${NOTIFICATIONS_BASE}/me/preferences`, { schema: notifPreferencesSchema, enabled, retry: false });
}

export function useUpdateMyNotifPreferences() {
  return useApiAction({
    method: "PUT",
    path: `${NOTIFICATIONS_BASE}/me/preferences`,
    body: (v: NotifUpdatePreferencesBody) => v,
    schema: notifPreferencesSchema,
    invalidate: [[...KEY, "me"]],
  });
}

export function useVapidKey(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "vapid"], `${NOTIFICATIONS_BASE}/me/push/vapid-key`, { schema: notifVapidKeyResponseSchema, enabled, staleTime: 300_000, retry: false });
}

export function useMyPushDevices(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "devices"], `${NOTIFICATIONS_BASE}/me/push/devices`, { schema: notifPushDevicesResponseSchema, enabled, retry: false });
}

export function useSubscribePush() {
  return useApiAction({
    method: "POST",
    path: `${NOTIFICATIONS_BASE}/me/push/subscriptions`,
    body: (v: NotifPushSubscribeBody) => v,
    schema: z.object({ id: z.string() }),
    invalidate: [[...KEY, "me"]],
  });
}

export function useRemovePushDevice() {
  return useApiAction({
    method: "DELETE",
    path: (v: { id: string }) => `${NOTIFICATIONS_BASE}/me/push/devices/${v.id}`,
    invalidate: [[...KEY, "me"]],
  });
}

// ---------------------------------------------------------------------------
// Consentement (administration) et désinscription publique
// ---------------------------------------------------------------------------

export function useConsentLog(userId: string | null) {
  return hooks.useApiQuery([...KEY, "consent", userId], `${NOTIFICATIONS_BASE}/consent/log`, { query: { userId: userId ?? undefined, limit: 30 } as Query, schema: notifConsentLogResponseSchema, enabled: userId !== null, retry: false });
}

/**
 * Désinscription par lien signé : l'adresse `/v2/notifications/unsubscribe?t=…` appelle ces deux routes PUBLIQUES (appel anonyme :
 * aucun jeton, aucun en-tête d'établissement ; le jeton signé porte l'établissement, la personne et le canal). `GET` n'écrit rien.
 */
export function useUnsubscribeInfo(token: string | null) {
  return useQuery<z.infer<typeof notifUnsubscribeResponseSchema>, ApiError>({
    queryKey: ["notifications", "unsubscribe", token],
    queryFn: ({ signal }) => hooks.client.get(`${NOTIFICATIONS_BASE}/public/unsubscribe`, { anonymous: true, query: { t: token ?? "" }, schema: notifUnsubscribeResponseSchema, signal }),
    enabled: token !== null && token !== "",
    retry: false,
    staleTime: 0,
  });
}

export function useApplyUnsubscribe() {
  return useMutation<z.infer<typeof notifUnsubscribeResponseSchema>, ApiError, { token: string }>({
    mutationFn: (v) => hooks.client.request("POST", `${NOTIFICATIONS_BASE}/public/unsubscribe`, { anonymous: true, query: { t: v.token }, schema: notifUnsubscribeResponseSchema }) as Promise<z.infer<typeof notifUnsubscribeResponseSchema>>,
  });
}
