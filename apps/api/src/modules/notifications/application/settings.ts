/**
 * Paramètres de notification de l'établissement : lecture, mise à jour fusionnée et validée, audit.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { NotifSettings, NotifUpdateSettingsBody } from "@ecoledigitale/contracts/src/v2/notifications";
import { isValidTimeZone } from "../domain/consent";
import { NotifCode, validation } from "../domain/errors";
import type { TenantSettings } from "../domain/types";
import * as settingsRepo from "../infrastructure/settings-repository";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";

export function settingsView(s: TenantSettings): NotifSettings {
  return {
    enabledChannels: [...s.enabledChannels],
    senderName: s.senderName,
    replyTo: s.replyTo,
    timezone: s.timezone,
    defaultDialCode: s.defaultDialCode,
    quietHoursEnabled: s.quietHoursEnabled,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    dailyCaps: { ...s.dailyCaps },
    perRecipientDailyCap: s.perRecipientDailyCap,
    consentModels: { ...s.consentModels },
    urgentBypassesRevocations: s.urgentBypassesRevocations,
    maxAttempts: s.maxAttempts,
    journalRetentionDays: s.journalRetentionDays,
    legalFooter: s.legalFooter,
    updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
  };
}

export async function getNotificationSettings(deps: NotificationsDeps, ctx: RequestContext): Promise<Result<NotifSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(settingsView(await settingsRepo.getSettings(tx, ctx.tenantId))), { readOnly: true });
}

export async function updateNotificationSettings(deps: NotificationsDeps, ctx: RequestContext, patch: NotifUpdateSettingsBody): Promise<Result<NotifSettings, AppError>> {
  if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone)) return err(validation(NotifCode.INVALID_INPUT, "Fuseau horaire inconnu.", "timezone"));
  return inTx(deps, ctx, async (tx) => {
    const current = await settingsRepo.getSettings(tx, ctx.tenantId);
    const next: TenantSettings = {
      enabledChannels: patch.enabledChannels ?? current.enabledChannels,
      senderName: patch.senderName === undefined ? current.senderName : patch.senderName,
      replyTo: patch.replyTo === undefined ? current.replyTo : patch.replyTo,
      timezone: patch.timezone ?? current.timezone,
      defaultDialCode: patch.defaultDialCode ?? current.defaultDialCode,
      quietHoursEnabled: patch.quietHoursEnabled ?? current.quietHoursEnabled,
      quietStart: patch.quietStart ?? current.quietStart,
      quietEnd: patch.quietEnd ?? current.quietEnd,
      dailyCaps: patch.dailyCaps ? { ...current.dailyCaps, ...patch.dailyCaps } : current.dailyCaps,
      perRecipientDailyCap: patch.perRecipientDailyCap ?? current.perRecipientDailyCap,
      consentModels: patch.consentModels ? { ...current.consentModels, ...patch.consentModels } : current.consentModels,
      urgentBypassesRevocations: patch.urgentBypassesRevocations ?? current.urgentBypassesRevocations,
      maxAttempts: patch.maxAttempts ?? current.maxAttempts,
      journalRetentionDays: patch.journalRetentionDays ?? current.journalRetentionDays,
      legalFooter: patch.legalFooter === undefined ? current.legalFooter : patch.legalFooter,
      updatedAt: null,
    };
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    await settingsRepo.putSettings(tx, ctx.tenantId, next, ctx.userId, now);
    events.audit({
      action: "notifications.settings.update",
      entity: "settings",
      entityId: ctx.tenantId,
      before: settingsView(current),
      after: settingsView({ ...next, updatedAt: now }),
      severity: patch.urgentBypassesRevocations !== undefined || patch.consentModels !== undefined ? "notice" : "info",
    });
    await events.flush(tx);
    return ok(settingsView({ ...next, updatedAt: now }));
  });
}
