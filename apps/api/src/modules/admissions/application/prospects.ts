/**
 * Prospects (US3) : contacts avant candidature. Un seul prospect actif par e-mail (insensible à la casse) ; `CONVERTED` exige la
 * candidature créée, `LOST` exige un motif. La conversion crée la candidature pré-remplie, conserve le canal et marque le
 * prospect `CONVERTED` dans la MÊME transaction.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsCreateProspectBody, AdmissionsProspectDto, AdmissionsUpdateProspectBody } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import * as apps from "../infrastructure/application-repository";
import { createApplicationInTx } from "./applications";
import { detectDuplicates } from "./duplicates";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { resolveInstitution, type Page } from "./support";

export async function createProspect(deps: AdmissionsDeps, ctx: RequestContext, body: AdmissionsCreateProspectBody): Promise<Result<AdmissionsProspectDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    const id = deps.newId();
    await apps.insertProspect(tx, { id, tenantId: ctx.tenantId, institutionId: inst.value, firstName: body.firstName, lastName: body.lastName, contactPhone: body.contactPhone ?? null, contactEmail: body.contactEmail ?? null, gradeLevelCode: body.interestedGradeLevelCode ?? null, sourceChannel: body.sourceChannel, referrerLabel: body.referrerLabel ?? null, notes: body.notes ?? null, assignedTo: body.assignedTo ?? null });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.prospect.create", resourceType: "prospect", resourceId: id, metadata: { sourceChannel: body.sourceChannel } });
    await buffer.flush(tx);
    return ok((await apps.getProspect(tx, id)) as AdmissionsProspectDto);
  });
}

export async function listProspects(deps: AdmissionsDeps, ctx: RequestContext, query: { institutionId?: string | undefined; status?: string | undefined; q?: string | undefined; page: number; pageSize: number }): Promise<Result<Page<AdmissionsProspectDto>, AppError>> {
  const inst = await resolveInstitution(deps, ctx, query.institutionId);
  if (!inst.ok) return inst;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await apps.listProspects(tx, { institutionId: inst.value, status: query.status, q: query.q, limit: query.pageSize, offset: (query.page - 1) * query.pageSize });
      return ok({ items: r.items, total: r.total, page: query.page, pageSize: query.pageSize });
    },
    { readOnly: true },
  );
}

export async function updateProspect(deps: AdmissionsDeps, ctx: RequestContext, id: string, body: AdmissionsUpdateProspectBody): Promise<Result<AdmissionsProspectDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await apps.getProspect(tx, id, { forUpdate: true });
    if (!current) return err(notFound(AdmissionsCode.PROSPECT_NOT_FOUND, "Prospect", id));
    if (current.status === "CONVERTED") return err(conflict(AdmissionsCode.INVALID_INPUT, "Un prospect converti ne se modifie plus."));
    if (body.status === "LOST" && !(body.lostReason ?? "").trim()) return err(validation(AdmissionsCode.REASON_REQUIRED, "Un prospect perdu exige un motif.", "lostReason"));
    if (body.status === "CONTACTED" || body.status === "NEW") await apps.updateProspect(tx, id, { ...body, lostReason: null });
    else await apps.updateProspect(tx, id, body);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.prospect.update", resourceType: "prospect", resourceId: id, metadata: { fields: Object.keys(body), status: body.status ?? current.status } });
    await buffer.flush(tx);
    return ok((await apps.getProspect(tx, id)) as AdmissionsProspectDto);
  });
}

/** Conversion : la candidature naît pré-remplie (contact du prospect comme tuteur principal, canal conservé). */
export async function convertProspect(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  prospectId: string,
  body: { campaignId: string; birthDate: string; desiredGradeLevelCode: string; applicantFirstName: string; applicantLastName?: string | undefined; guardianRelationshipCode: string },
): Promise<Result<{ applicationId: string; applicationNumber: string }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const prospect = await apps.getProspect(tx, prospectId, { forUpdate: true });
    if (!prospect) return err(notFound(AdmissionsCode.PROSPECT_NOT_FOUND, "Prospect", prospectId));
    if (prospect.status === "CONVERTED") return err(conflict(AdmissionsCode.INVALID_INPUT, "Ce prospect est déjà converti."));
    if (prospect.status === "LOST") return err(conflict(AdmissionsCode.INVALID_INPUT, "Ce prospect est marqué perdu : rouvrez-le avant de le convertir."));
    const created = await createApplicationInTx(
      deps,
      ctx,
      tx,
      {
        campaignId: body.campaignId,
        prospectId,
        applicantFirstName: body.applicantFirstName,
        applicantLastName: body.applicantLastName ?? prospect.lastName,
        applicantBirthDate: body.birthDate,
        desiredGradeLevelCode: body.desiredGradeLevelCode,
        sourceChannel: prospect.sourceChannel,
        referrerLabel: prospect.referrerLabel,
        guardians: [{ relationshipCode: body.guardianRelationshipCode, firstName: prospect.firstName, lastName: prospect.lastName, phone: prospect.contactPhone, email: prospect.contactEmail, isPrimary: true, isFinancialResponsible: false, canConsent: true, profession: null }],
      },
      { via: "PROSPECT", requireOpenCampaign: false },
    );
    if (!created.ok) return created;
    if (created.value.institutionId !== prospect.institutionId) return err(validation(AdmissionsCode.INVALID_INPUT, "La campagne appartient à un autre établissement.", "campaignId"));
    await apps.markProspectConverted(tx, prospectId, created.value.id);
    const app = (await apps.getApplicationRow(tx, created.value.id)) as apps.ApplicationRow;
    await detectDuplicates(deps, ctx, tx, app);
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(AdmissionsEvents.PROSPECT_CONVERTED, { v: 1, prospectId, applicationId: app.id, institutionId: app.institutionId }, { type: "prospect", id: prospectId });
    buffer.audit({ action: "admissions.prospect.convert", resourceType: "prospect", resourceId: prospectId, metadata: { applicationId: app.id } });
    await buffer.flush(tx);
    return ok({ applicationId: app.id, applicationNumber: app.applicationNumber });
  });
}
