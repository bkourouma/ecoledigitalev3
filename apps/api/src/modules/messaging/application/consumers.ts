/**
 * Consommateurs d'événements (messages système) et jobs. Appelés par `subscribers.ts` / `jobs.ts` ; idempotents.
 * Les formes de payload sont celles des PRODUCTEURS (`attendance.absence.recorded`, `attendance.late.recorded`) ; les
 * lecteurs `read*` sont éprouvés par `apps/api/test/events-contracts/messaging.contracts.ts`.
 */
import { createSystemContext, isUuid, ok, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { findDefaultTemplate, SYSTEM_ABSENCE, SYSTEM_LATE } from "../domain/system-templates";
import { renderTemplate } from "../domain/text";
import * as settingsRepo from "../infrastructure/settings-repository";
import { purgeOrphanAttachments } from "./attachments";
import { postSystemMessages } from "./conversations";
import { inTx, type MessagingDeps } from "./deps";
import { publishDueAnnouncements } from "./announcements";
import { purgeOldNotifications } from "./notifications";

export interface RecordedEvent {
  readonly studentId: string;
  readonly date: string;
  readonly excused: boolean;
  readonly correction: boolean;
  readonly recordId: string | null;
}

/** `attendance.absence.recorded` / `attendance.late.recorded` : l'élève, la date, l'excuse, la correction. `null` si illisible. */
export function readRecordedEvent(payload: unknown): RecordedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.studentId !== "string" || !isUuid(p.studentId)) return null;
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return null;
  return {
    studentId: p.studentId,
    date: p.date,
    excused: p.excused === true,
    correction: p.correction === true,
    recordId: typeof p.recordId === "string" && isUuid(p.recordId) ? p.recordId : null,
  };
}

/** « 2026-10-02 » -> « 02/10/2026 ». */
export const formatDateFr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Message système aux TOUS les tuteurs joignables de l'élève (lien vivant, accès portail, compte actif). Rien n'est
 * envoyé pour une absence déjà excusée ou une correction, ni si le gabarit du tenant est désactivé, ni si l'élève est
 * inconnu (événement bénin : signalé, non rejoué).
 */
export async function onAttendanceRecorded(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { eventId: string; kind: "ABSENCE" | "LATE"; payload: unknown },
): Promise<Result<{ delivered: number; skipped: string | null }, AppError>> {
  const event = readRecordedEvent(input.payload);
  if (!event) return ok({ delivered: 0, skipped: "payload_unreadable" });
  if (event.excused || event.correction) return ok({ delivered: 0, skipped: event.excused ? "excused" : "correction" });
  const code = input.kind === "ABSENCE" ? SYSTEM_ABSENCE : SYSTEM_LATE;
  const def = findDefaultTemplate(code)!;
  const template = await inTx(deps, ctx, async (tx) => ok(await settingsRepo.getTemplateOverride(tx, ctx.tenantId, code)), { readOnly: true });
  if (!template.ok) return template;
  const enabled = template.value ? template.value.enabled : def.enabledByDefault;
  if (!enabled) return ok({ delivered: 0, skipped: "template_disabled" });
  const guardians = await deps.ports.directory.getGuardianContactsOfStudent(ctx, event.studentId);
  if (!guardians) return ok({ delivered: 0, skipped: "student_unknown" });
  if (guardians.contacts.length === 0) return ok({ delivered: 0, skipped: "no_reachable_guardian" });
  const vars = { studentName: guardians.studentName, date: formatDateFr(event.date) };
  const r = await postSystemMessages(deps, ctx, {
    userIds: guardians.contacts.map((c) => c.userId),
    code,
    title: renderTemplate(template.value?.title ?? def.title, vars),
    body: renderTemplate(template.value?.body ?? def.body, vars),
    payload: { studentId: event.studentId, date: event.date, recordId: event.recordId },
    dedupeKey: `evt:${input.eventId}`,
  });
  return r.ok ? ok({ delivered: r.value.delivered, skipped: null }) : r;
}

/** Erreur sans intérêt à rejouer (le worker consigne et passe). */
export const isBenignConsumerError = (e: AppError): boolean => e.kind === "not_found" || e.kind === "validation";

// ---------------------------------------------------------------------------
// Jobs (un tenant à la fois ; un tenant en échec n'arrête pas les autres)
// ---------------------------------------------------------------------------

export async function publishDueAllTenants(deps: MessagingDeps, systemDb: SystemDb): Promise<ForEachTenantReport<number>> {
  return systemDb.forEachTenant("messaging-publish-scheduled", async (_tx, tenant) => publishDueAnnouncements(deps, createSystemContext(tenant.id)));
}

export async function housekeepingAllTenants(deps: MessagingDeps, systemDb: SystemDb): Promise<ForEachTenantReport<{ notifications: number; attachments: number }>> {
  return systemDb.forEachTenant("messaging-housekeeping", async (_tx, tenant) => {
    const ctx = createSystemContext(tenant.id);
    const settings = unwrap(await inTx(deps, ctx, async (tx) => ok(await settingsRepo.getSettings(tx, ctx.tenantId)), { readOnly: true }));
    return {
      notifications: await purgeOldNotifications(deps, ctx, settings.notificationRetentionDays),
      attachments: await purgeOrphanAttachments(deps, ctx),
    };
  });
}
