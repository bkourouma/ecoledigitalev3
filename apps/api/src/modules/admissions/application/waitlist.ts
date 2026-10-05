/**
 * Liste d'attente (US8) : ordre = DÉCISION MANUELLE de la direction (Q-A03), jamais calculé par ancienneté. Le rang est défini et
 * réordonné par `reorderWaitlist` (trace : `waitlist_rank_changes` + audit + événement) ; un dossier entré en liste sans rang est
 * « à classer » (affiché après les dossiers classés, jamais promu d'office). L'ancienneté et la classe de priorité restent affichées.
 * Plafond facultatif par niveau (`waitlist_limit`, refusé par le déclencheur : `admissions.waitlist_full`).
 * Promotion MANUELLE (« proposer la place ») ; la promotion AUTOMATIQUE est déclenchée par `promoteOnFreedSeat` (decisions.ts).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsWaitlistDto, AdmissionsWaitlistReorderBody } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsEvents } from "../domain/events";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import * as apps from "../infrastructure/application-repository";
import * as ref from "../infrastructure/reference-repository";
import * as reports from "../infrastructure/reports-repository";
import * as wf from "../infrastructure/workflow-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { promoteHead } from "./decisions";

const WAITLIST_CHANGES_LIMIT = 30;

export async function getWaitlist(deps: AdmissionsDeps, ctx: RequestContext, query: { campaignId: string; grade: string }): Promise<Result<AdmissionsWaitlistDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const campaign = await wf.getCampaignRow(tx, query.campaignId);
      if (!campaign) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", query.campaignId));
      const cap = await wf.getCapacityLimit(tx, query.campaignId, query.grade, null);
      const classes = new Map((await ref.listPriorityClasses(tx, campaign.institutionId)).map((c) => [c.code, c]));
      const rows = await reports.waitlistEntries(tx, query.campaignId, query.grade);
      const entries: AdmissionsWaitlistDto["entries"] = [];
      for (const r of rows) {
        const app = await apps.getApplicationRow(tx, r.applicationId);
        if (!app) continue;
        const klass = app.priorityClassCode ? classes.get(app.priorityClassCode) : undefined;
        entries.push({
          queuePosition: r.queuePosition,
          applicationId: app.id,
          applicationNumber: app.applicationNumber,
          applicantFirstName: app.applicantFirstName,
          applicantLastName: app.applicantLastName,
          priorityClassCode: app.priorityClassCode,
          priorityLabel: klass?.label ?? null,
          priorityRank: r.priorityRank,
          waitlistEnteredAt: r.waitlistEnteredAt,
          manualRank: r.manualRank,
        });
      }
      const changes = await reports.listWaitlistRankChanges(tx, query.campaignId, query.grade, WAITLIST_CHANGES_LIMIT);
      return ok({ campaignId: query.campaignId, grade: query.grade, seatsLeft: await wf.seatsLeft(tx, query.campaignId, query.grade, null), waitlistLimit: cap?.waitlistLimit ?? null, entries, changes });
    },
    { readOnly: true },
  );
}

/**
 * Décision de la direction : classe / réordonne la liste d'attente d'un niveau. `orderedApplicationIds` doit contenir EXACTEMENT les
 * dossiers actuellement en liste (sinon `admissions.waitlist_order_stale` : un dossier est entré ou sorti entre-temps, l'écran
 * recharge). Les rangs deviennent 1..n ; chaque rang modifié est tracé (ancien rang, nouveau rang, acteur, motif).
 */
export async function reorderWaitlist(deps: AdmissionsDeps, ctx: RequestContext, input: AdmissionsWaitlistReorderBody): Promise<Result<{ count: number; changed: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const campaign = await wf.getCampaignRow(tx, input.campaignId);
    if (!campaign) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", input.campaignId));
    const settings = await ref.ensureSettingsRow(tx, ctx.tenantId, campaign.institutionId);
    if (!settings.waitlistEnabled) return err(conflict(AdmissionsCode.WAITLIST_DISABLED, "La liste d'attente est désactivée pour cet établissement."));
    if (new Set(input.orderedApplicationIds).size !== input.orderedApplicationIds.length) {
      return err(validation(AdmissionsCode.INVALID_INPUT, "Un dossier ne peut figurer qu'une fois dans l'ordre.", "orderedApplicationIds"));
    }
    const current = await reports.lockWaitlist(tx, input.campaignId, input.grade);
    const byId = new Map(current.map((c) => [c.applicationId, c.manualRank]));
    const sameSet = current.length === input.orderedApplicationIds.length && input.orderedApplicationIds.every((id) => byId.has(id));
    if (!sameSet) {
      return err(conflict(AdmissionsCode.WAITLIST_ORDER_STALE, "La liste d'attente a changé : rechargez-la avant de la réordonner.", { expected: current.length, received: input.orderedApplicationIds.length }));
    }
    let changed = 0;
    for (const [index, applicationId] of input.orderedApplicationIds.entries()) {
      const rank = index + 1;
      const before = byId.get(applicationId) ?? null;
      if (before === rank) continue;
      await reports.setWaitlistRank(tx, applicationId, rank);
      await reports.insertWaitlistRankChange(tx, {
        id: deps.newId(),
        tenantId: ctx.tenantId,
        applicationId,
        campaignId: input.campaignId,
        grade: input.grade,
        kind: before === null ? "RANKED" : "MOVED",
        fromRank: before,
        toRank: rank,
        reason: input.reason ?? null,
        actorId: ctx.userId,
      });
      changed += 1;
    }
    const buffer = new EventBuffer(deps, ctx);
    if (changed > 0) {
      buffer.add(
        AdmissionsEvents.WAITLIST_REORDERED,
        { v: 1, campaignId: input.campaignId, institutionId: campaign.institutionId, gradeLevelCode: input.grade, count: input.orderedApplicationIds.length, changed },
        { type: "campaign", id: input.campaignId },
      );
      buffer.audit({ action: "admissions.waitlist.reorder", resourceType: "campaign", resourceId: input.campaignId, metadata: { grade: input.grade, count: input.orderedApplicationIds.length, changed, reason: input.reason ?? null } });
    }
    await buffer.flush(tx);
    return ok({ count: input.orderedApplicationIds.length, changed });
  });
}

/** « Proposer la place » : promotion MANUELLE du premier de la liste (ou du dossier désigné). */
export async function promoteManually(deps: AdmissionsDeps, ctx: RequestContext, input: { campaignId: string; grade: string; classroomId?: string | undefined; applicationId?: string | undefined }): Promise<Result<ManualPromotionResult, AppError>> {
  return inTx(deps, ctx, async (tx, scope) => {
    const campaign = await wf.getCampaignRow(tx, input.campaignId);
    if (!campaign) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", input.campaignId));
    const settings = await ref.ensureSettingsRow(tx, ctx.tenantId, campaign.institutionId);
    if (!settings.waitlistEnabled) return err(conflict(AdmissionsCode.WAITLIST_DISABLED, "La liste d'attente est désactivée pour cet établissement."));
    const result = await promoteHead(deps, ctx, tx, scope, { campaignId: input.campaignId, grade: input.grade, applicationId: input.applicationId ?? null, classroomId: input.classroomId ?? null, auto: false });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.waitlist.promote_request", resourceType: "campaign", resourceId: input.campaignId, metadata: { grade: input.grade, promoted: result.promoted, reason: result.reason, applicationId: result.applicationId } });
    await buffer.flush(tx);
    // Le lien de réponse est montré UNE fois au personnel (seule l'empreinte est conservée) : sans canal de notification, le
    // secrétariat contacte la famille par téléphone et lui transmet le lien.
    return ok({ promoted: result.promoted, applicationId: result.applicationId, reason: result.reason, offerId: result.offer?.offer.id ?? null, responseToken: result.offer?.responseToken ?? null });
  });
}

export interface ManualPromotionResult {
  readonly promoted: boolean;
  readonly applicationId: string | null;
  readonly reason: string | null;
  readonly offerId: string | null;
  readonly responseToken: string | null;
}
