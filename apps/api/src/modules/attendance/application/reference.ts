/**
 * Paramétrage : statuts, motifs de justification, types de congé, politiques d'appel, paramètres d'établissement
 * (pièces acceptées, règles d'alerte) et amorçage depuis un modèle de pack.
 *
 * Tout est DONNÉE modifiable par l'établissement (permission `attendance.settings.manage`), jamais constante de code.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { parseAlertRules, type AlertRule } from "../domain/alerts";
import { AttendanceCode, validation } from "../domain/errors";
import { DEFAULT_ATTENDANCE_PACK, validatePackTemplate, type AttendancePackTemplate } from "../domain/reference-pack";
import { resolveStatusUpsert, type StatusUpsertInput } from "../domain/status";
import type { AttachmentType, CallPolicy, CallScope, StatusDefinition, SubjectKind, Uuid } from "../domain/types";
import {
  getSettings,
  hasReferenceData,
  listCallPolicies,
  listLeaveTypes,
  listReasons,
  listStatuses,
  seedFromPack,
  upsertCallPolicy as repoUpsertCallPolicy,
  upsertLeaveType as repoUpsertLeaveType,
  upsertReason as repoUpsertReason,
  upsertSettings,
  upsertStatus,
  type AttendanceSettings,
  type JustificationReason,
  type LeaveType,
} from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type AttendanceDeps } from "./deps";

/** Amorçage paresseux : un tenant sans aucun référentiel reçoit le modèle de pack par défaut (idempotent). */
export async function ensureReferenceData(deps: AttendanceDeps, ctx: RequestContext, tx: Tx, institutionIds: readonly Uuid[] = []): Promise<void> {
  if (await hasReferenceData(tx)) return;
  await seedFromPack(tx, ctx.tenantId, DEFAULT_ATTENDANCE_PACK, deps.newId, institutionIds);
}

export interface SeedReport {
  statuses: number;
  reasons: number;
  leaveTypes: number;
  policies: number;
}

/**
 * Instancie un modèle de pack (section `attendance`) pour le tenant du contexte : idempotent et non destructif
 * (ce que l'établissement a modifié n'est jamais écrasé). `institutionIds` : établissements recevant les politiques
 * d'appel du modèle (les politiques sont par établissement).
 */
export async function instantiateAttendancePack(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { pack?: unknown; institutionIds?: readonly Uuid[] } = {},
): Promise<Result<SeedReport, AppError>> {
  let pack: AttendancePackTemplate = DEFAULT_ATTENDANCE_PACK;
  if (input.pack !== undefined) {
    const checked = validatePackTemplate(input.pack);
    if (!checked.ok) return checked;
    pack = checked.value;
  }
  return inTx(deps, ctx, async (tx) => ok(await seedFromPack(tx, ctx.tenantId, pack, deps.newId, input.institutionIds ?? [])));
}

// --- lectures ---------------------------------------------------------------

export const listStatusDefinitions = (deps: AttendanceDeps, ctx: RequestContext, kind?: SubjectKind): Promise<Result<StatusDefinition[], AppError>> =>
  inTx(deps, ctx, async (tx) => ok(await listStatuses(tx, kind)), { readOnly: true });
export const listJustificationReasons = (deps: AttendanceDeps, ctx: RequestContext): Promise<Result<JustificationReason[], AppError>> =>
  inTx(deps, ctx, async (tx) => ok(await listReasons(tx)), { readOnly: true });
export const listLeaveTypeDefinitions = (deps: AttendanceDeps, ctx: RequestContext): Promise<Result<LeaveType[], AppError>> =>
  inTx(deps, ctx, async (tx) => ok(await listLeaveTypes(tx)), { readOnly: true });
export const listCallPolicyDefinitions = (deps: AttendanceDeps, ctx: RequestContext): Promise<Result<CallPolicy[], AppError>> =>
  inTx(deps, ctx, async (tx) => ok(await listCallPolicies(tx)), { readOnly: true });
export const getAttendanceSettings = (deps: AttendanceDeps, ctx: RequestContext): Promise<Result<AttendanceSettings, AppError>> =>
  inTx(deps, ctx, async (tx) => ok(await getSettings(tx)), { readOnly: true });

// --- écritures --------------------------------------------------------------

/** Crée ou modifie un statut. Les statuts système sont verrouillés (sémantique et activation). */
export async function upsertStatusDefinition(deps: AttendanceDeps, ctx: RequestContext, input: StatusUpsertInput): Promise<Result<StatusDefinition, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const existing = (await listStatuses(tx, input.subjectKind)).find((s) => s.code === input.code);
    const next = resolveStatusUpsert(existing, input);
    if (!next.ok) return next;
    await upsertStatus(tx, ctx.tenantId, deps.newId(), next.value);
    events.audit({
      action: existing ? "attendance.status.updated" : "attendance.status.created",
      resourceType: "status_definition",
      resourceId: `${next.value.subjectKind}:${next.value.code}`,
      before: existing ?? null,
      after: next.value,
    });
    await events.flush(tx);
    return ok(next.value);
  });
}

const validCode = (code: string): boolean => /^[A-Z][A-Z0-9_]{0,39}$/.test(code);

export async function upsertJustificationReason(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { code: string; label: string; requiresAttachment?: boolean; sortOrder?: number; active?: boolean },
): Promise<Result<JustificationReason, AppError>> {
  if (!validCode(input.code) || input.label.trim() === "") return err(validation(AttendanceCode.INVALID_INPUT, "Code ou libellé de motif invalide.", "code"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const reason = await repoUpsertReason(tx, ctx.tenantId, deps.newId(), {
      code: input.code, label: input.label.trim(), requiresAttachment: input.requiresAttachment ?? false, sortOrder: input.sortOrder ?? 0, active: input.active ?? true,
    });
    events.audit({ action: "attendance.justification_reason.upserted", resourceType: "justification_reason", resourceId: reason.code, after: reason });
    await events.flush(tx);
    return ok(reason);
  });
}

export async function upsertLeaveTypeDefinition(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { code: string; label: string; isPaid?: boolean; requiresApproval?: boolean; requiresAttachment?: boolean; active?: boolean },
): Promise<Result<LeaveType, AppError>> {
  if (!validCode(input.code) || input.label.trim() === "") return err(validation(AttendanceCode.INVALID_INPUT, "Code ou libellé de type de congé invalide.", "code"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const type = await repoUpsertLeaveType(tx, ctx.tenantId, deps.newId(), {
      code: input.code, label: input.label.trim(), isPaid: input.isPaid ?? true, requiresApproval: input.requiresApproval ?? true,
      requiresAttachment: input.requiresAttachment ?? false, active: input.active ?? true,
    });
    events.audit({ action: "attendance.leave_type.upserted", resourceType: "leave_type", resourceId: type.code, after: type });
    await events.flush(tx);
    return ok(type);
  });
}

export async function upsertCallPolicy(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { institutionId: Uuid; educationLevelCode: string; callScope: CallScope; editWindowMinutes?: number | null; lateRequiresMinutes?: boolean; dailyMinutes?: number | null },
): Promise<Result<CallPolicy, AppError>> {
  if (input.educationLevelCode.trim() === "") return err(validation(AttendanceCode.INVALID_INPUT, "Niveau d'enseignement obligatoire ('*' = défaut).", "educationLevelCode"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const policy = await repoUpsertCallPolicy(tx, ctx.tenantId, {
      institutionId: input.institutionId,
      educationLevelCode: input.educationLevelCode.trim(),
      callScope: input.callScope,
      editWindowMinutes: input.editWindowMinutes ?? null,
      lateRequiresMinutes: input.lateRequiresMinutes ?? false,
      dailyMinutes: input.dailyMinutes ?? null,
    });
    events.audit({ action: "attendance.call_policy.upserted", resourceType: "call_policy", resourceId: `${policy.institutionId}:${policy.educationLevelCode}`, after: policy });
    await events.flush(tx);
    return ok(policy);
  });
}

export interface UpsertSettingsInput {
  readonly attachmentMaxBytes?: number | null | undefined;
  readonly allowedAttachmentTypes?: readonly AttachmentType[] | null | undefined;
  readonly allowFutureJustifications?: boolean | undefined;
  readonly alertRules?: readonly unknown[] | undefined;
}

/**
 * Paramètres d'établissement : pièces acceptées (taille, types), justificatifs futurs et RÈGLES D'ALERTE (seuils
 * fournis par l'établissement ou son modèle de pack — jamais par le module). Seuls les champs fournis changent.
 */
export async function upsertAttendanceSettings(deps: AttendanceDeps, ctx: RequestContext, input: UpsertSettingsInput): Promise<Result<AttendanceSettings, AppError>> {
  let rules: AlertRule[] | undefined;
  if (input.alertRules !== undefined) {
    const parsed = parseAlertRules(input.alertRules);
    if (!parsed.ok) return parsed;
    rules = parsed.value;
  }
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const before = await getSettings(tx);
    const next: AttendanceSettings = {
      attachmentMaxBytes: input.attachmentMaxBytes === undefined ? before.attachmentMaxBytes : input.attachmentMaxBytes,
      allowedAttachmentTypes: input.allowedAttachmentTypes === undefined ? before.allowedAttachmentTypes : input.allowedAttachmentTypes,
      allowFutureJustifications: input.allowFutureJustifications ?? before.allowFutureJustifications,
      alertRules: rules ?? before.alertRules,
    };
    await upsertSettings(tx, ctx.tenantId, next);
    events.audit({ action: "attendance.settings.updated", resourceType: "settings", resourceId: ctx.tenantId, sensitive: true, before, after: next });
    await events.flush(tx);
    return ok(next);
  });
}
