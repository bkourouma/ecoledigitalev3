/**
 * Liste d'attente (US8) : ordre = rang de la classe de priorité (donnée de l'établissement), puis date d'entrée, puis
 * identifiant. Plafond facultatif par niveau (`waitlist_limit`, refusé par le déclencheur : `admissions.waitlist_full`).
 * Promotion MANUELLE (« proposer la place ») ; la promotion AUTOMATIQUE est déclenchée par `promoteOnFreedSeat` (decisions.ts).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsWaitlistDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound } from "../domain/errors";
import * as apps from "../infrastructure/application-repository";
import * as ref from "../infrastructure/reference-repository";
import * as reports from "../infrastructure/reports-repository";
import * as wf from "../infrastructure/workflow-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { promoteHead } from "./decisions";

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
        });
      }
      return ok({ campaignId: query.campaignId, grade: query.grade, seatsLeft: await wf.seatsLeft(tx, query.campaignId, query.grade, null), waitlistLimit: cap?.waitlistLimit ?? null, entries });
    },
    { readOnly: true },
  );
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
