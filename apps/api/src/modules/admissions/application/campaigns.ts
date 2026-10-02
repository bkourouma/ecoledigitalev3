/**
 * Campagnes d'admission et capacités par niveau. Une campagne ne s'ouvre qu'avec un workflow PUBLIÉ et ne change plus de
 * workflow après (déclencheur `campaigns_guard`). L'absence de ligne de capacité signifie « pas de plafond configuré ».
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsCampaignDto, AdmissionsCreateCampaignBody, AdmissionsReplaceCapacitiesBody } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, notFound, validation } from "../domain/errors";
import * as wf from "../infrastructure/workflow-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { resolveInstitution } from "./support";
import type { Tx } from "@ecoledigitale/database";

export async function campaignDto(tx: Tx, campaignId: string): Promise<AdmissionsCampaignDto | null> {
  const row = await wf.getCampaignRow(tx, campaignId);
  if (!row) return null;
  return { ...row, capacities: await wf.listCapacities(tx, campaignId) };
}

export async function listCampaigns(deps: AdmissionsDeps, ctx: RequestContext, query: { institutionId?: string | undefined; status?: string | undefined }): Promise<Result<AdmissionsCampaignDto[], AppError>> {
  const inst = await resolveInstitution(deps, ctx, query.institutionId);
  if (!inst.ok) return inst;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await wf.listCampaignRows(tx, inst.value, query.status);
      const out: AdmissionsCampaignDto[] = [];
      for (const row of rows) out.push({ ...row, capacities: await wf.listCapacities(tx, row.id) });
      return ok(out);
    },
    { readOnly: true },
  );
}

export async function getCampaign(deps: AdmissionsDeps, ctx: RequestContext, campaignId: string): Promise<Result<AdmissionsCampaignDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const dto = await campaignDto(tx, campaignId);
      return dto ? ok(dto) : err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", campaignId));
    },
    { readOnly: true },
  );
}

export async function createCampaign(deps: AdmissionsDeps, ctx: RequestContext, body: AdmissionsCreateCampaignBody): Promise<Result<AdmissionsCampaignDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  if (Date.parse(body.closesAt) <= Date.parse(body.opensAt)) return err(validation(AdmissionsCode.INVALID_INPUT, "La clôture doit suivre l'ouverture.", "closesAt"));
  return inTx(deps, ctx, async (tx) => {
    const workflow = await wf.getWorkflowHeader(tx, body.workflowId);
    if (!workflow || workflow.institutionId !== inst.value) return err(notFound(AdmissionsCode.WORKFLOW_NOT_FOUND, "Workflow", body.workflowId));
    const id = deps.newId();
    await wf.insertCampaign(tx, { id, tenantId: ctx.tenantId, institutionId: inst.value, academicYearId: body.academicYearId, code: body.code, label: body.label, workflowId: body.workflowId, opensAt: body.opensAt, closesAt: body.closesAt });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.campaign.create", resourceType: "campaign", resourceId: id, metadata: { code: body.code, workflowId: body.workflowId } });
    await buffer.flush(tx);
    return ok((await campaignDto(tx, id)) as AdmissionsCampaignDto);
  });
}

export async function updateCampaign(deps: AdmissionsDeps, ctx: RequestContext, campaignId: string, patch: { label?: string | undefined; workflowId?: string | undefined; opensAt?: string | undefined; closesAt?: string | undefined }): Promise<Result<AdmissionsCampaignDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const row = await wf.getCampaignRow(tx, campaignId, { forUpdate: true });
    if (!row) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", campaignId));
    if (patch.workflowId) {
      const workflow = await wf.getWorkflowHeader(tx, patch.workflowId);
      if (!workflow || workflow.institutionId !== row.institutionId) return err(notFound(AdmissionsCode.WORKFLOW_NOT_FOUND, "Workflow", patch.workflowId));
    }
    const opens = patch.opensAt ?? row.opensAt;
    const closes = patch.closesAt ?? row.closesAt;
    if (Date.parse(closes) <= Date.parse(opens)) return err(validation(AdmissionsCode.INVALID_INPUT, "La clôture doit suivre l'ouverture.", "closesAt"));
    await wf.updateCampaignRow(tx, campaignId, patch);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.campaign.update", resourceType: "campaign", resourceId: campaignId });
    await buffer.flush(tx);
    return ok((await campaignDto(tx, campaignId)) as AdmissionsCampaignDto);
  });
}

async function transitionCampaign(deps: AdmissionsDeps, ctx: RequestContext, campaignId: string, to: "OPEN" | "CLOSED", action: string): Promise<Result<AdmissionsCampaignDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const row = await wf.getCampaignRow(tx, campaignId, { forUpdate: true });
    if (!row) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", campaignId));
    if (row.status === to) return ok((await campaignDto(tx, campaignId)) as AdmissionsCampaignDto);
    await wf.setCampaignStatus(tx, campaignId, to);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action, resourceType: "campaign", resourceId: campaignId, metadata: { from: row.status, to } });
    await buffer.flush(tx);
    return ok((await campaignDto(tx, campaignId)) as AdmissionsCampaignDto);
  });
}

export const openCampaign = (deps: AdmissionsDeps, ctx: RequestContext, campaignId: string): Promise<Result<AdmissionsCampaignDto, AppError>> => transitionCampaign(deps, ctx, campaignId, "OPEN", "admissions.campaign.open");
export const closeCampaign = (deps: AdmissionsDeps, ctx: RequestContext, campaignId: string): Promise<Result<AdmissionsCampaignDto, AppError>> => transitionCampaign(deps, ctx, campaignId, "CLOSED", "admissions.campaign.close");

/** Mise à jour des capacités par niveau (les lignes non citées sont conservées : aucun `DELETE` n'est accordé en base). */
export async function upsertCapacities(deps: AdmissionsDeps, ctx: RequestContext, campaignId: string, body: AdmissionsReplaceCapacitiesBody): Promise<Result<AdmissionsCampaignDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const row = await wf.getCampaignRow(tx, campaignId, { forUpdate: true });
    if (!row) return err(notFound(AdmissionsCode.CAMPAIGN_NOT_FOUND, "Campagne", campaignId));
    let known: ReadonlyArray<{ code: string }> = [];
    try {
      known = await deps.ports.catalog.gradeLevels(ctx, row.institutionId);
    } catch {
      known = []; // catalogue indisponible : on n'invente pas de refus ; la base reste l'autorité sur le format
    }
    if (known.length > 0) {
      const codes = new Set(known.map((g) => g.code));
      const unknown = body.capacities.find((c) => !codes.has(c.gradeLevelCode));
      if (unknown) return err(validation(AdmissionsCode.INVALID_INPUT, `Niveau inconnu : ${unknown.gradeLevelCode}.`, "capacities"));
    }
    for (const c of body.capacities) {
      await wf.upsertCapacity(tx, { id: deps.newId(), tenantId: ctx.tenantId, campaignId, gradeLevelCode: c.gradeLevelCode, programId: c.programId ?? null, seats: c.seats, waitlistLimit: c.waitlistLimit ?? null });
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.campaign.capacities_update", resourceType: "campaign", resourceId: campaignId, metadata: { lines: body.capacities.length } });
    await buffer.flush(tx);
    return ok((await campaignDto(tx, campaignId)) as AdmissionsCampaignDto);
  });
}
