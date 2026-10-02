/**
 * Paramètres et données d'établissement : réglages, lien public, classes de priorité, motifs de décision, textes de consentement
 * versionnés, pièces exigées. Aucune de ces valeurs n'est une constante de la plateforme : ce sont des DONNÉES de l'établissement.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AdmissionsConsentTextDto,
  AdmissionsDecisionReasonDto,
  AdmissionsDocumentRequirementDto,
  AdmissionsPriorityClassDto,
  AdmissionsSettingsDto,
  AdmissionsUpdateSettingsBody,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import { isValidNumberPattern } from "../domain/number";
import { newPublicSlug } from "../domain/tokens";
import * as ref from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { resolveInstitution } from "./support";

void AdmissionsEvents;

async function settingsDto(tx: Parameters<typeof ref.getSettingsRow>[0], tenantId: string, institutionId: string): Promise<AdmissionsSettingsDto> {
  const row = await ref.ensureSettingsRow(tx, tenantId, institutionId);
  const index = await ref.getIndexOfInstitution(tx, institutionId);
  return { ...row, publicFormSlug: index?.slug ?? null, publicFormLinkEnabled: index?.enabled ?? false };
}

export async function getSettings(deps: AdmissionsDeps, ctx: RequestContext, institutionId?: string): Promise<Result<AdmissionsSettingsDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => ok(await settingsDto(tx, ctx.tenantId, inst.value)));
}

export async function updateSettings(deps: AdmissionsDeps, ctx: RequestContext, body: AdmissionsUpdateSettingsBody): Promise<Result<AdmissionsSettingsDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  if (body.applicationNumberPattern !== undefined && !isValidNumberPattern(body.applicationNumberPattern)) {
    return err(validation(AdmissionsCode.INVALID_INPUT, "Le motif de numéro doit contenir {SEQ} (ex. {YEAR}-{SEQ:5}).", "applicationNumberPattern"));
  }
  return inTx(deps, ctx, async (tx) => {
    const before = await ref.ensureSettingsRow(tx, ctx.tenantId, inst.value);
    const { institutionId: _ignored, ...patch } = body;
    void _ignored;
    // Un texte de consentement désigné doit exister, être en vigueur et du bon type.
    if (patch.consentTextVersion !== undefined && patch.consentTextVersion !== null) {
      const text = await ref.getConsentText(tx, inst.value, "DATA_PROCESSING", patch.consentTextVersion);
      if (!text || text.retiredAt) return err(validation(AdmissionsCode.CONSENT_TEXT_MISSING, "Cette version du texte de consentement est inconnue ou retirée.", "consentTextVersion"));
    }
    const nextEnabled = patch.publicFormEnabled ?? before.publicFormEnabled;
    const nextRequired = patch.consentRequired ?? before.consentRequired;
    const nextVersion = patch.consentTextVersion === undefined ? before.consentTextVersion : patch.consentTextVersion;
    if (nextEnabled && nextRequired && !nextVersion) {
      return err(validation(AdmissionsCode.CONSENT_TEXT_MISSING, "Publiez et désignez un texte de consentement avant d'ouvrir le formulaire public.", "consentTextVersion"));
    }
    await ref.updateSettingsRow(tx, inst.value, patch);
    const index = await ref.getIndexOfInstitution(tx, inst.value);
    if (patch.publicFormEnabled === false && index?.enabled) await ref.setIndexEnabled(tx, inst.value, false);
    const after = await settingsDto(tx, ctx.tenantId, inst.value);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.settings.update", resourceType: "settings", resourceId: inst.value, before, after: { ...after } });
    await buffer.flush(tx);
    return ok(after);
  });
}

/** Crée, fait tourner, active ou désactive le lien public de l'établissement (slug opaque de 96 bits au moins). */
export async function managePublicLink(deps: AdmissionsDeps, ctx: RequestContext, input: { institutionId?: string | undefined; enabled?: boolean | undefined; rotate?: boolean | undefined }): Promise<Result<AdmissionsSettingsDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, input.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    await ref.ensureSettingsRow(tx, ctx.tenantId, inst.value);
    const index = await ref.getIndexOfInstitution(tx, inst.value);
    const enabled = input.enabled ?? index?.enabled ?? true;
    if (!index) {
      await ref.insertIndex(tx, { slug: newPublicSlug(), tenantId: ctx.tenantId, institutionId: inst.value, enabled });
    } else if (input.rotate) {
      await ref.replaceIndexSlug(tx, inst.value, newPublicSlug(), enabled);
    } else if (input.enabled !== undefined) {
      await ref.setIndexEnabled(tx, inst.value, enabled);
    }
    const dto = await settingsDto(tx, ctx.tenantId, inst.value);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.public_link.update", resourceType: "settings", resourceId: inst.value, metadata: { rotated: input.rotate === true, enabled: dto.publicFormLinkEnabled } });
    await buffer.flush(tx);
    return ok(dto);
  });
}

// ---------------------------------------------------------------------------
// Classes de priorité
// ---------------------------------------------------------------------------

export async function listPriorityClasses(deps: AdmissionsDeps, ctx: RequestContext, institutionId?: string): Promise<Result<AdmissionsPriorityClassDto[], AppError>> {
  const inst = await resolveInstitution(deps, ctx, institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => ok(await ref.listPriorityClasses(tx, inst.value)), { readOnly: true });
}

export async function upsertPriorityClass(deps: AdmissionsDeps, ctx: RequestContext, body: { institutionId?: string | undefined; code: string; label: string; rank: number; active?: boolean | undefined }): Promise<Result<AdmissionsPriorityClassDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    const row = await ref.upsertPriorityClass(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId: inst.value, code: body.code, label: body.label, rank: body.rank, active: body.active ?? true });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.priority_class.upsert", resourceType: "priority_class", resourceId: row.id, metadata: { code: body.code, rank: body.rank } });
    await buffer.flush(tx);
    return ok(row);
  });
}

// ---------------------------------------------------------------------------
// Motifs de décision
// ---------------------------------------------------------------------------

export async function listDecisionReasons(deps: AdmissionsDeps, ctx: RequestContext, institutionId?: string): Promise<Result<AdmissionsDecisionReasonDto[], AppError>> {
  const inst = await resolveInstitution(deps, ctx, institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => ok(await ref.listDecisionReasons(tx, inst.value)), { readOnly: true });
}

export async function upsertDecisionReason(deps: AdmissionsDeps, ctx: RequestContext, body: { institutionId?: string | undefined; code: string; kind: string; label: string; active?: boolean | undefined }): Promise<Result<AdmissionsDecisionReasonDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    const row = await ref.upsertDecisionReason(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId: inst.value, code: body.code, kind: body.kind, label: body.label, active: body.active ?? true });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.decision_reason.upsert", resourceType: "decision_reason", resourceId: row.id, metadata: { code: body.code, kind: body.kind } });
    await buffer.flush(tx);
    return ok(row);
  });
}

// ---------------------------------------------------------------------------
// Textes de consentement (versionnés)
// ---------------------------------------------------------------------------

export async function listConsentTexts(deps: AdmissionsDeps, ctx: RequestContext, institutionId?: string): Promise<Result<AdmissionsConsentTextDto[], AppError>> {
  const inst = await resolveInstitution(deps, ctx, institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => ok(await ref.listConsentTexts(tx, inst.value)), { readOnly: true });
}

/** Publie une NOUVELLE version : le corps d'une version publiée ne change jamais (déclencheur SQL). */
export async function publishConsentText(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  body: { institutionId?: string | undefined; kind: string; version: string; language: string; body: string },
  options: { designate?: boolean } = {},
): Promise<Result<AdmissionsConsentTextDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    await ref.ensureSettingsRow(tx, ctx.tenantId, inst.value);
    if (await ref.getConsentText(tx, inst.value, body.kind, body.version)) {
      return err(conflict(AdmissionsCode.REFERENCE_CODE_TAKEN, "Cette version du texte existe déjà : publiez une nouvelle version."));
    }
    const row = await ref.insertConsentText(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId: inst.value, kind: body.kind, version: body.version, language: body.language, body: body.body, publishedBy: ctx.userId });
    if (options.designate && body.kind === "DATA_PROCESSING") await ref.updateSettingsRow(tx, inst.value, { consentTextVersion: body.version });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.consent_text.publish", resourceType: "consent_text", resourceId: row.id, metadata: { kind: body.kind, version: body.version, designated: options.designate === true } });
    await buffer.flush(tx);
    return ok(row);
  });
}

export async function retireConsentText(deps: AdmissionsDeps, ctx: RequestContext, input: { institutionId?: string | undefined; kind: string; version: string }): Promise<Result<AdmissionsConsentTextDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, input.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    const settings = await ref.ensureSettingsRow(tx, ctx.tenantId, inst.value);
    if (settings.consentTextVersion === input.version && input.kind === "DATA_PROCESSING" && settings.publicFormEnabled) {
      return err(conflict(AdmissionsCode.CONSENT_TEXT_MISSING, "Ce texte est celui du formulaire public ouvert : désignez une autre version ou fermez le formulaire avant de le retirer."));
    }
    const done = await ref.retireConsentText(tx, inst.value, input.kind, input.version);
    if (!done) return err(notFound(AdmissionsCode.NOT_FOUND, "Texte de consentement", input.version));
    const row = (await ref.getConsentText(tx, inst.value, input.kind, input.version)) as AdmissionsConsentTextDto;
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.consent_text.retire", resourceType: "consent_text", resourceId: row.id, metadata: { kind: input.kind, version: input.version } });
    await buffer.flush(tx);
    return ok(row);
  });
}

// ---------------------------------------------------------------------------
// Pièces exigées
// ---------------------------------------------------------------------------

export async function listRequirements(deps: AdmissionsDeps, ctx: RequestContext, institutionId?: string): Promise<Result<AdmissionsDocumentRequirementDto[], AppError>> {
  const inst = await resolveInstitution(deps, ctx, institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => ok(await ref.listRequirements(tx, inst.value)), { readOnly: true });
}

export async function upsertRequirement(
  deps: AdmissionsDeps,
  ctx: RequestContext,
  body: {
    institutionId?: string | undefined;
    code: string;
    label: string;
    gradeLevelCode?: string | null | undefined;
    appliesToFunding?: string | null | undefined;
    required?: boolean | undefined;
    acceptsMime?: string[] | undefined;
    maxSizeKb?: number | undefined;
    sortOrder?: number | undefined;
    active?: boolean | undefined;
  },
): Promise<Result<AdmissionsDocumentRequirementDto, AppError>> {
  const inst = await resolveInstitution(deps, ctx, body.institutionId);
  if (!inst.ok) return inst;
  return inTx(deps, ctx, async (tx) => {
    const row = await ref.upsertRequirement(tx, {
      id: deps.newId(),
      tenantId: ctx.tenantId,
      institutionId: inst.value,
      code: body.code,
      label: body.label,
      gradeLevelCode: body.gradeLevelCode ?? null,
      appliesToFunding: body.appliesToFunding ?? null,
      required: body.required ?? true,
      acceptsMime: body.acceptsMime ?? ["application/pdf", "image/jpeg", "image/png"],
      maxSizeKb: body.maxSizeKb ?? 5120,
      sortOrder: body.sortOrder ?? 0,
      active: body.active ?? true,
    });
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.document_requirement.upsert", resourceType: "document_requirement", resourceId: row.id, metadata: { code: body.code, required: row.required } });
    await buffer.flush(tx);
    return ok(row);
  });
}
