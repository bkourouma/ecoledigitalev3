/**
 * Envoi MANUEL (convocation, annonce, avis urgent) à une audience choisie par l'utilisateur habilité.
 *
 *  - seuls les gabarits marqués `manual` du catalogue sont utilisables ; les variables sont validées par type AVANT la mise en file
 *    (un message à trous n'est jamais créé) ;
 *  - une URGENCE (contourne heures calmes et préférences de catégorie) exige la permission sensible `notifications.send.urgent`,
 *    est auditée et publiée (`notifications.urgent.sent`) ; `urgent_notice` est toujours urgent ;
 *  - plafond de destinataires par envoi (`NOTIF_LIMITS.recipientsPerManualSend`) ; plafonds journaliers et par destinataire
 *    appliqués comme pour tout envoi ;
 *  - idempotence par `clientKey` : un réessai du client ne double pas l'envoi.
 * Rien n'est envoyé ici : la remise est mise en file, le worker l'envoie.
 */
import { err, ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { NOTIF_LIMITS, type NotifManualAudience, type NotifSendBody } from "@ecoledigitale/contracts/src/v2/notifications";
import { catalogEntry } from "../domain/catalog";
import { NotifCode, forbidden, notFound, validation } from "../domain/errors";
import { NotificationsEvents } from "../domain/events";
import type { Recipient } from "../domain/types";
import * as settingsRepo from "../infrastructure/settings-repository";
import { AudienceResolver } from "./audience";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";
import { enqueueInTx } from "./enqueue";
import { renderResolved, resolveTemplate } from "./rendering";

export interface SendCaps {
  readonly urgent: boolean;
}

export interface SendResult {
  readonly recipients: number;
  readonly deliveries: number;
  readonly skipped: number;
  readonly reused: boolean;
}

async function resolveManualAudience(resolver: AudienceResolver, audience: NotifManualAudience): Promise<{ recipients: Recipient[]; studentNameOf: Map<string, string> }> {
  const studentNameOf = new Map<string, string>();
  const recipients: Recipient[] = [];
  switch (audience.kind) {
    case "USERS":
      recipients.push(...(await resolver.deps.ports.directory.contactsOfUsers(resolver.ctx, audience.userIds)));
      break;
    case "STUDENT_GUARDIANS": {
      await resolver.preloadStudents(audience.studentIds);
      for (const id of audience.studentIds) {
        const s = await resolver.student(id);
        if (!s) continue;
        let guardians = s.guardians;
        if (audience.financialFirst) {
          const financial = guardians.filter((g) => g.flags?.financial);
          if (financial.length > 0) guardians = financial;
        }
        for (const g of guardians) {
          recipients.push(g);
          if (!studentNameOf.has(g.subjectKey)) studentNameOf.set(g.subjectKey, s.studentName);
        }
      }
      break;
    }
    case "CLASSROOM":
      for (const id of audience.classroomIds) recipients.push(...(await resolver.classroom(id, audience.include)).recipients);
      break;
    case "ROLES":
      recipients.push(...(await resolver.rolesHolders(audience.roleKeys)));
      break;
  }
  return { recipients, studentNameOf };
}

export async function sendManualNotification(deps: NotificationsDeps, ctx: RequestContext, body: NotifSendBody, caps: SendCaps): Promise<Result<SendResult, AppError>> {
  const entry = catalogEntry(body.templateCode);
  if (!entry) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", body.templateCode));
  if (!entry.manual) return err(validation(NotifCode.INVALID_INPUT, `Le gabarit « ${entry.label} » n'est pas utilisable en envoi manuel.`, "templateCode"));
  const urgent = body.urgent || body.templateCode === "urgent_notice";
  if (urgent && !caps.urgent) return err(forbidden(NotifCode.FORBIDDEN, "L'envoi urgent exige une autorisation spécifique."));
  const userId = ctx.userId;
  if (!userId) return err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
  return runSend(deps, ctx, body, { userId, urgent, source: "MANUAL" });
}

/**
 * Envoi AUTOMATIQUE (rappel planifié d'un module : job du worker, acteur système) : mêmes contrôles que l'envoi manuel (gabarit
 * `manual` du catalogue, variables validées avant la mise en file, audience résolue par l'annuaire, consentements, heures calmes,
 * plafonds et idempotence par `clientKey`) mais SANS utilisateur : source `EVENT`, jamais d'urgence, `createdBy` vide. Réservé aux
 * contextes `system` : un contexte utilisateur passe par `sendManualNotification` (permission `notifications.send`).
 */
export async function sendAutomaticNotification(deps: NotificationsDeps, ctx: RequestContext, body: NotifSendBody): Promise<Result<SendResult, AppError>> {
  if (ctx.userId) return err(forbidden(NotifCode.FORBIDDEN, "L'envoi automatique est réservé aux traitements planifiés."));
  const entry = catalogEntry(body.templateCode);
  if (!entry) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", body.templateCode));
  if (!entry.manual) return err(validation(NotifCode.INVALID_INPUT, `Le gabarit « ${entry.label} » n'est pas utilisable en envoi automatique.`, "templateCode"));
  if (body.urgent || body.templateCode === "urgent_notice") return err(forbidden(NotifCode.FORBIDDEN, "Un envoi automatique n'est jamais urgent."));
  if (!body.clientKey) return err(validation(NotifCode.INVALID_INPUT, "Un envoi automatique porte une clé d'idempotence.", "clientKey"));
  return runSend(deps, ctx, body, { userId: null, urgent: false, source: "EVENT" });
}

async function runSend(
  deps: NotificationsDeps,
  ctx: RequestContext,
  body: NotifSendBody,
  who: { userId: string | null; urgent: boolean; source: "MANUAL" | "EVENT" },
): Promise<Result<SendResult, AppError>> {
  const entry = catalogEntry(body.templateCode)!;
  const { userId, urgent } = who;
  return inTx(deps, ctx, async (tx) => {
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    // Validation des variables AVANT toute mise en file : un essai de rendu par le premier canal disposant d'un gabarit.
    for (const channel of body.channels) {
      const tpl = await resolveTemplate(tx, ctx.tenantId, body.templateCode, channel);
      if (!tpl) return err(notFound(NotifCode.TEMPLATE_NOT_FOUND, "Gabarit", `${body.templateCode}/${channel}`));
      const probe = { ...body.variables, ...(entry.variables.some((v) => v.name === "studentName") && body.audience.kind === "STUDENT_GUARDIANS" ? { studentName: "Élève" } : {}) };
      const r = renderResolved(entry, tpl, probe, settings, deps.config);
      if (r.errors.length > 0) return err(new ValidationError(r.errors[0]!.message, r.errors.map((e) => ({ path: ["variables", e.variable], message: e.message, code: NotifCode.TEMPLATE_VARIABLE_INVALID })), { code: NotifCode.TEMPLATE_VARIABLE_INVALID }));
    }
    const resolver = new AudienceResolver(deps, ctx);
    const { recipients, studentNameOf } = await resolveManualAudience(resolver, body.audience);
    if (recipients.length > NOTIF_LIMITS.recipientsPerManualSend) return err(validation(NotifCode.TOO_MANY_RECIPIENTS, `Plus de ${NOTIF_LIMITS.recipientsPerManualSend} destinataires : réduisez l'audience.`, "audience", { count: recipients.length }));
    if (recipients.length === 0) return err(validation(NotifCode.RECIPIENT_NOT_FOUND, "Aucun destinataire joignable pour cette audience.", "audience"));
    const events = new EventBuffer(deps, ctx);
    const base = `manual:${body.clientKey ?? deps.newId()}`;
    const wantsStudentName = entry.variables.some((v) => v.name === "studentName") && body.variables.studentName === undefined;
    const r = await enqueueInTx(deps, ctx, tx, {
      source: { kind: who.source },
      templateCode: body.templateCode,
      urgent,
      recipients,
      channels: body.channels,
      strategy: body.strategy,
      values: body.variables,
      valuesFor: wantsStudentName ? (rec) => (studentNameOf.has(rec.subjectKey) ? { studentName: studentNameOf.get(rec.subjectKey) } : {}) : undefined,
      dedupeBase: base,
      context: userId ? { sentBy: userId } : { automatic: "true" },
      linkPath: null,
      createdBy: userId,
    });
    if (urgent && userId) events.add(NotificationsEvents.URGENT_SENT, { v: 1, templateCode: body.templateCode, recipients: r.recipients, sentBy: userId }, { type: "send", id: base });
    events.audit({ action: urgent ? "notifications.urgent.send" : "notifications.send", entity: "send", entityId: base, after: { templateCode: body.templateCode, channels: body.channels, recipients: r.recipients, queued: r.queued, skipped: r.skipped, ...(userId ? {} : { automatic: true }) }, severity: urgent ? "warning" : "info" });
    await events.flush(tx);
    return ok({ recipients: r.recipients, deliveries: r.queued, skipped: r.skipped, reused: r.duplicates > 0 && r.queued === 0 && r.skipped === 0 });
  });
}
