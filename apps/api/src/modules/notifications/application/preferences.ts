/**
 * Préférences et consentement par personne et par canal : lecture et modification par la personne elle-même (`SELF`), par le
 * personnel habilité (`ADMIN`, demande orale ou papier) et par le lien de désinscription signé (`UNSUBSCRIBE_LINK`).
 * Chaque changement est consigné au journal de consentement (preuve : qui, quand, comment) et publié (`consent.changed`).
 * Une personne n'agit que sur SA clé (`user:<identité>`) : jamais sur celle d'autrui par les routes « moi ».
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  NOTIF_ALL_CATEGORIES,
  NOTIF_CATEGORIES,
  NOTIF_CHANNELS,
  type NotifCategory,
  type NotifChannel,
  type NotifPreferences,
  type NotifUpdatePreferencesBody,
} from "@ecoledigitale/contracts/src/v2/notifications";
import { consentModelOf, effectiveQuietWindow } from "../domain/consent";
import { NotifCode, forbidden, validation } from "../domain/errors";
import { NotificationsEvents } from "../domain/events";
import { verifyUnsubscribeToken } from "../domain/tokens";
import * as prefsRepo from "../infrastructure/preferences-repository";
import * as pushRepo from "../infrastructure/push-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";
import type { ConsentSource } from "../infrastructure/preferences-repository";

export const subjectKeyOfUser = (userId: string): string => `user:${userId}`;

function requireUser(ctx: RequestContext): Result<string, AppError> {
  return ctx.userId ? ok(ctx.userId) : err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
}

async function buildPreferences(deps: NotificationsDeps, ctx: RequestContext, tx: Parameters<typeof settingsRepo.getSettings>[0], userId: string): Promise<NotifPreferences> {
  const key = subjectKeyOfUser(userId);
  const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
  const prefs = await prefsRepo.listPreferences(tx, ctx.tenantId, [key]);
  const subj = (await prefsRepo.getSubjectPreferences(tx, ctx.tenantId, [key])).get(key) ?? null;
  const devices = (await pushRepo.listForUser(tx, ctx.tenantId, userId)).length;
  const window = effectiveQuietWindow(settings, subj);
  const channels = NOTIF_CHANNELS.map((channel) => {
    const rows = prefs.filter((p) => p.channel === channel);
    const channelLevel = rows.find((p) => p.category === NOTIF_ALL_CATEGORIES);
    const model = consentModelOf(settings, channel);
    let available = settings.enabledChannels.includes(channel);
    if (available && channel !== "IN_APP") available = deps.channels.get(channel).status().configured;
    return {
      channel,
      available,
      enabled: channelLevel ? channelLevel.enabled : model === "IMPLIED",
      consentModel: model,
      categories: Object.fromEntries(rows.filter((p) => p.category !== NOTIF_ALL_CATEGORIES).map((p) => [p.category, p.enabled])) as Partial<Record<NotifCategory, boolean>>,
    };
  });
  return {
    channels: channels as NotifPreferences["channels"],
    quietHours: { enabled: window.enabled, start: window.start, end: window.end, inherited: subj === null || (subj.enabled === null && subj.start === null && subj.end === null) },
    urgentBypassesQuietHours: true,
    pushDevices: devices,
  };
}

export async function getMyNotificationPreferences(deps: NotificationsDeps, ctx: RequestContext): Promise<Result<NotifPreferences, AppError>> {
  const me = requireUser(ctx);
  if (!me.ok) return me;
  return inTx(deps, ctx, async (tx) => ok(await buildPreferences(deps, ctx, tx, me.value)), { readOnly: true });
}

async function applyChannelPreferences(
  deps: NotificationsDeps,
  ctx: RequestContext,
  tx: Parameters<typeof settingsRepo.getSettings>[0],
  events: EventBuffer,
  input: { subjectKey: string; userId: string | null; changes: ReadonlyArray<{ channel: NotifChannel; category: string; enabled: boolean }>; source: ConsentSource; actorUserId: string | null; note: string | null },
): Promise<void> {
  const now = deps.clock.now();
  const current = await prefsRepo.listPreferences(tx, ctx.tenantId, [input.subjectKey]);
  for (const c of input.changes) {
    const existing = current.find((p) => p.channel === c.channel && p.category === c.category);
    if (existing && existing.enabled === c.enabled) continue; // aucun changement : pas de ligne de preuve inutile
    await prefsRepo.putPreference(tx, ctx.tenantId, { subjectKey: input.subjectKey, channel: c.channel, category: c.category, enabled: c.enabled, at: now });
    await prefsRepo.insertConsentLog(tx, ctx.tenantId, { id: deps.newId(), at: now, subjectKey: input.subjectKey, userId: input.userId, channel: c.channel, category: c.category, enabled: c.enabled, source: input.source, actorUserId: input.actorUserId, note: input.note });
    events.add(NotificationsEvents.CONSENT_CHANGED, { v: 1, subjectKey: input.subjectKey, channel: c.channel, category: c.category, enabled: c.enabled, source: input.source }, { type: "consent", id: input.subjectKey });
  }
}

export async function updateMyNotificationPreferences(deps: NotificationsDeps, ctx: RequestContext, body: NotifUpdatePreferencesBody): Promise<Result<NotifPreferences, AppError>> {
  const me = requireUser(ctx);
  if (!me.ok) return me;
  if (body.quietHours?.start !== undefined && body.quietHours.end !== undefined && body.quietHours.start === body.quietHours.end && body.quietHours.enabled !== false) {
    return err(validation(NotifCode.INVALID_INPUT, "L'heure de début et l'heure de fin des heures calmes doivent différer.", "quietHours"));
  }
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const key = subjectKeyOfUser(me.value);
    if (body.channels) await applyChannelPreferences(deps, ctx, tx, events, { subjectKey: key, userId: me.value, changes: body.channels, source: "SELF", actorUserId: me.value, note: null });
    if (body.quietHours) {
      const q = body.quietHours;
      const existing = (await prefsRepo.getSubjectPreferences(tx, ctx.tenantId, [key])).get(key);
      if (q.inherit) await prefsRepo.putQuietHours(tx, ctx.tenantId, { subjectKey: key, enabled: null, start: null, end: null, at: deps.clock.now() });
      else await prefsRepo.putQuietHours(tx, ctx.tenantId, { subjectKey: key, enabled: q.enabled ?? existing?.enabled ?? null, start: q.start ?? existing?.start ?? null, end: q.end ?? existing?.end ?? null, at: deps.clock.now() });
    }
    await events.flush(tx);
    return ok(await buildPreferences(deps, ctx, tx, me.value));
  });
}

/** Administration : enregistre le consentement d'une personne (demande reçue par téléphone, papier…). */
export async function setSubjectConsent(deps: NotificationsDeps, ctx: RequestContext, input: { userId: string; channel: NotifChannel; category: string; enabled: boolean; note?: string | undefined }): Promise<Result<NotifPreferences, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    await applyChannelPreferences(deps, ctx, tx, events, {
      subjectKey: subjectKeyOfUser(input.userId),
      userId: input.userId,
      changes: [{ channel: input.channel, category: input.category, enabled: input.enabled }],
      source: "ADMIN",
      actorUserId: ctx.userId,
      note: input.note ?? null,
    });
    events.audit({ action: "notifications.consent.set", entity: "consent", entityId: input.userId, after: { channel: input.channel, category: input.category, enabled: input.enabled }, severity: "notice", reason: input.note ?? null });
    await events.flush(tx);
    return ok(await buildPreferences(deps, ctx, tx, input.userId));
  });
}

export async function getConsentLog(deps: NotificationsDeps, ctx: RequestContext, input: { userId: string; limit: number }) {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await prefsRepo.listConsentLog(tx, ctx.tenantId, [subjectKeyOfUser(input.userId)], input.limit);
      return ok({ items: rows.map((r) => ({ at: r.at.toISOString(), channel: r.channel, category: r.category, enabled: r.enabled, source: r.source, actorUserId: r.actorUserId })) });
    },
    { readOnly: true },
  );
}

/**
 * Désinscription par lien signé (route PUBLIQUE, sans session) : coupe le canal pour la personne visée. Idempotent.
 * Le jeton vaut preuve d'identité pour cette seule action (le lien a été remis par e-mail ou message).
 */
export async function applyUnsubscribe(deps: NotificationsDeps, ctx: RequestContext, token: string): Promise<Result<{ channel: NotifChannel; applied: boolean }, AppError>> {
  const secret = deps.config.unsubscribeSecret;
  if (!secret) return err(forbidden(NotifCode.TOKEN_INVALID, "Désinscription indisponible."));
  const claims = verifyUnsubscribeToken(token, secret);
  if (!claims || claims.tenantId !== ctx.tenantId) return err(forbidden(NotifCode.TOKEN_INVALID, "Lien de désinscription invalide."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const before = (await prefsRepo.listPreferences(tx, ctx.tenantId, [claims.subjectKey])).find((p) => p.channel === claims.channel && p.category === NOTIF_ALL_CATEGORIES);
    const userId = claims.subjectKey.startsWith("user:") ? claims.subjectKey.slice(5) : null;
    await applyChannelPreferences(deps, ctx, tx, events, {
      subjectKey: claims.subjectKey,
      userId,
      changes: [{ channel: claims.channel, category: NOTIF_ALL_CATEGORIES, enabled: false }],
      source: "UNSUBSCRIBE_LINK",
      actorUserId: null,
      note: null,
    });
    await events.flush(tx);
    return ok({ channel: claims.channel, applied: !(before && before.enabled === false) });
  });
}

export { NOTIF_CATEGORIES };
