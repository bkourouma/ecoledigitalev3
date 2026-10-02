/**
 * Tableaux de bord de recrutement (US15) : entonnoir par statut canonique, taux de passage, délais, capacité, SLA, canaux,
 * motifs de refus. Aucun nom. Les chiffres du legacy (`owner-recrutement`) y sont reproduits : reçues, traitées, délai moyen,
 * séries hebdomadaires, tranches `< 24 h`, `1-3 j`, `3-7 j`, `> 7 j`, principaux motifs de refus, répartition par niveau.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionStatus, AdmissionsFunnelDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, notFound } from "../domain/errors";
import * as reports from "../infrastructure/reports-repository";
import * as wf from "../infrastructure/workflow-repository";
import { inTx, type AdmissionsDeps } from "./deps";
import { nowIso } from "./support";

/** Transitions entre statuts canoniques suivies dans l'entonnoir (taux de passage). */
const FUNNEL_STEPS: ReadonlyArray<[AdmissionStatus, AdmissionStatus]> = [
  ["SUBMITTED", "UNDER_REVIEW"],
  ["UNDER_REVIEW", "ACCEPTED"],
  ["ACCEPTED", "ENROLLED"],
];

async function withCampaign<T>(deps: AdmissionsDeps, ctx: RequestContext, campaignId: string, fn: (tx: Parameters<typeof wf.getCampaignRow>[0]) => Promise<T>): Promise<Result<T, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await wf.getCampaignRow(tx, campaignId))) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", campaignId));
      return ok(await fn(tx));
    },
    { readOnly: true },
  );
}

export function funnel(deps: AdmissionsDeps, ctx: RequestContext, campaignId: string, grade?: string): Promise<Result<AdmissionsFunnelDto, AppError>> {
  return withCampaign(deps, ctx, campaignId, async (tx) => {
    const byStatus = await reports.statusCounts(tx, campaignId, grade);
    const reached = await reports.reachedCounts(tx, campaignId, grade);
    const processing = await reports.processingStats(tx, campaignId, grade);
    return {
      campaignId,
      byStatus,
      byGrade: await reports.gradeStatusCounts(tx, campaignId),
      conversion: FUNNEL_STEPS.map(([from, to]) => {
        const f = reached.get(from) ?? 0;
        const t = reached.get(to) ?? 0;
        return { from, to, count: t, rate: f === 0 ? null : Math.round((t / f) * 1000) / 1000 };
      }),
      received: processing.received,
      processed: processing.processed,
      averageProcessingHours: processing.averageHours,
      processingBuckets: processing.buckets,
      weekly: (await reports.weeklyReceived(tx, campaignId, grade)).map((w) => ({ weekStart: w.weekStart, received: w.received })),
    };
  });
}

export const capacityReport = (deps: AdmissionsDeps, ctx: RequestContext, campaignId: string) => withCampaign(deps, ctx, campaignId, async (tx) => ({ campaignId, rows: await reports.capacityRows(tx, campaignId) }));
export const slaReport = (deps: AdmissionsDeps, ctx: RequestContext, campaignId: string) => withCampaign(deps, ctx, campaignId, async (tx) => ({ campaignId, rows: await reports.slaRows(tx, campaignId, nowIso(deps)) }));
export const sourcesReport = (deps: AdmissionsDeps, ctx: RequestContext, campaignId: string) => withCampaign(deps, ctx, campaignId, async (tx) => ({ campaignId, rows: await reports.sourceRows(tx, campaignId) }));
export const rejectionsReport = (deps: AdmissionsDeps, ctx: RequestContext, campaignId: string) => withCampaign(deps, ctx, campaignId, async (tx) => ({ campaignId, rows: await reports.rejectionRows(tx, campaignId) }));
