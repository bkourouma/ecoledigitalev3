/**
 * Paramètres d'établissement et gabarits de messages système.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { MessagingSettingsDto, MessagingSystemTemplateDto, MessagingUpdateSettingsBody } from "@ecoledigitale/contracts/src/v2/messaging";
import { MessagingCode, notFound, validation } from "../domain/errors";
import { DEFAULT_SYSTEM_TEMPLATES, findDefaultTemplate } from "../domain/system-templates";
import { templateVariables } from "../domain/text";
import type { MessagingSettings } from "../domain/types";
import * as repo from "../infrastructure/settings-repository";
import { EventBuffer, inTx, type MessagingDeps } from "./deps";

export const settingsView = (s: MessagingSettings): MessagingSettingsDto => ({
  studentPolicy: s.studentPolicy,
  adminContactRoles: [...s.adminContactRoles],
  attachmentsEnabled: s.attachmentsEnabled,
  attachmentMaxBytes: s.attachmentMaxBytes,
  attachmentMaxPerItem: s.attachmentMaxPerItem,
  allowedAttachmentTypes: [...s.allowedAttachmentTypes] as MessagingSettingsDto["allowedAttachmentTypes"],
  maxMessagesPerHour: s.maxMessagesPerHour,
  maxNewConversationsPerDay: s.maxNewConversationsPerDay,
  maxGroupParticipants: s.maxGroupParticipants,
  maxBroadcastParticipants: s.maxBroadcastParticipants,
  messageMaxLength: s.messageMaxLength,
  notificationRetentionDays: s.notificationRetentionDays,
  previousYearWindowDays: s.previousYearWindowDays,
});

export async function getMessagingSettings(deps: MessagingDeps, ctx: RequestContext): Promise<Result<MessagingSettingsDto, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(settingsView(await repo.getSettings(tx, ctx.tenantId))), { readOnly: true });
}

export async function updateMessagingSettings(deps: MessagingDeps, ctx: RequestContext, patch: MessagingUpdateSettingsBody): Promise<Result<MessagingSettingsDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getSettings(tx, ctx.tenantId);
    const next: MessagingSettings = {
      ...before,
      ...(patch.studentPolicy !== undefined ? { studentPolicy: patch.studentPolicy } : {}),
      ...(patch.adminContactRoles !== undefined ? { adminContactRoles: [...new Set(patch.adminContactRoles)] } : {}),
      ...(patch.attachmentsEnabled !== undefined ? { attachmentsEnabled: patch.attachmentsEnabled } : {}),
      ...(patch.attachmentMaxBytes !== undefined ? { attachmentMaxBytes: patch.attachmentMaxBytes } : {}),
      ...(patch.attachmentMaxPerItem !== undefined ? { attachmentMaxPerItem: patch.attachmentMaxPerItem } : {}),
      ...(patch.allowedAttachmentTypes !== undefined ? { allowedAttachmentTypes: [...new Set(patch.allowedAttachmentTypes)] } : {}),
      ...(patch.maxMessagesPerHour !== undefined ? { maxMessagesPerHour: patch.maxMessagesPerHour } : {}),
      ...(patch.maxNewConversationsPerDay !== undefined ? { maxNewConversationsPerDay: patch.maxNewConversationsPerDay } : {}),
      ...(patch.maxGroupParticipants !== undefined ? { maxGroupParticipants: patch.maxGroupParticipants } : {}),
      ...(patch.maxBroadcastParticipants !== undefined ? { maxBroadcastParticipants: patch.maxBroadcastParticipants } : {}),
      ...(patch.messageMaxLength !== undefined ? { messageMaxLength: patch.messageMaxLength } : {}),
      ...(patch.notificationRetentionDays !== undefined ? { notificationRetentionDays: patch.notificationRetentionDays } : {}),
      ...(patch.previousYearWindowDays !== undefined ? { previousYearWindowDays: patch.previousYearWindowDays } : {}),
    };
    if (next.maxGroupParticipants > next.maxBroadcastParticipants) {
      return err(validation(MessagingCode.INVALID_INPUT, "Le plafond d'un groupe ne peut pas dépasser celui d'une diffusion.", "maxGroupParticipants"));
    }
    await repo.upsertSettings(tx, ctx.tenantId, next, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "messaging.settings.updated", resourceType: "settings", resourceId: ctx.tenantId, sensitive: true, before: settingsView(before), after: settingsView(next) });
    await events.flush(tx);
    return ok(settingsView(next));
  });
}

// ---------------------------------------------------------------------------
// Gabarits de messages système
// ---------------------------------------------------------------------------

export async function listSystemTemplates(deps: MessagingDeps, ctx: RequestContext): Promise<Result<{ items: MessagingSystemTemplateDto[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const overrides = new Map((await repo.listTemplateOverrides(tx, ctx.tenantId)).map((t) => [t.code, t]));
      return ok({
        items: DEFAULT_SYSTEM_TEMPLATES.map((d) => {
          const o = overrides.get(d.code);
          return { code: d.code, title: o?.title ?? d.title, body: o?.body ?? d.body, enabled: o ? o.enabled : d.enabledByDefault, variables: [...d.variables], customized: o !== undefined };
        }),
      });
    },
    { readOnly: true },
  );
}

export async function updateSystemTemplate(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { code: string; title?: string | undefined; body?: string | undefined; enabled?: boolean | undefined },
): Promise<Result<MessagingSystemTemplateDto, AppError>> {
  const def = findDefaultTemplate(input.code);
  if (!def) return err(notFound(MessagingCode.TEMPLATE_NOT_FOUND, "Gabarit", input.code));
  for (const [field, text] of [["title", input.title], ["body", input.body]] as const) {
    const unknown = text ? templateVariables(text).filter((v) => !def.variables.includes(v)) : [];
    if (unknown.length > 0) return err(validation(MessagingCode.INVALID_INPUT, `Variable(s) inconnue(s) : ${unknown.join(", ")}. Disponibles : ${def.variables.join(", ")}.`, field));
  }
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getTemplateOverride(tx, ctx.tenantId, def.code);
    const next = { code: def.code, title: input.title ?? current?.title ?? def.title, body: input.body ?? current?.body ?? def.body, enabled: input.enabled ?? current?.enabled ?? def.enabledByDefault };
    await repo.upsertTemplate(tx, ctx.tenantId, next, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "messaging.template.updated", resourceType: "system_template", resourceId: def.code, before: current ?? null, after: next });
    await events.flush(tx);
    return ok({ ...next, variables: [...def.variables], customized: true });
  });
}
