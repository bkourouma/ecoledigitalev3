/**
 * Types d'évaluation configurables par tenant, réglages d'établissement, amorçage par pack.
 *  - Un type utilisé ne se supprime pas (il se désactive) ; les types « système » (modèles de pack) gardent leur code
 *    mais leur libellé et leurs valeurs par défaut restent modifiables (R-ASS-06).
 *  - Aucune écriture sans audit : la configuration des types change la lecture des règles par `results`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import type { AssessTypeCreateBody } from "@ecoledigitale/contracts/src/v2/assess";
import { AssessCode, conflict, notFound, validation } from "../domain/errors";
import { PACK_TYPE_TEMPLATES, templateKeyForPack } from "../domain/pack";
import type { AssessSettings, AssessmentType } from "../domain/types";
import { getSettingsRow, getType, insertType, insertTypeIfAbsent, listTypes, updateType, upsertSettings, type TypePatch } from "../infrastructure/assessments-repository";
import { guarded } from "../infrastructure/db-errors";
import { EventBuffer, inTx, type AssessCaps, type AssessDeps } from "./deps";

export async function listAssessmentTypes(deps: AssessDeps, ctx: RequestContext, input: { includeInactive?: boolean } = {}): Promise<Result<AssessmentType[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listTypes(tx, input.includeInactive ? { includeInactive: true } : {})), { readOnly: true });
}

export async function createAssessmentType(deps: AssessDeps, ctx: RequestContext, input: AssessTypeCreateBody & { caps?: AssessCaps }): Promise<Result<AssessmentType, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    let created: AssessmentType;
    try {
      created = await tx.transaction((sp) =>
        insertType(sp, {
          id: deps.newId(),
          tenantId: ctx.tenantId,
          code: input.code,
          label: input.label,
          aggregationGroup: input.aggregationGroup,
          defaultScaleMax: input.defaultScaleMax ?? "20",
          defaultWeight: input.defaultWeight ?? "1",
          publicationMode: input.publicationMode ?? "MANUAL",
          visibleToStudents: input.visibleToStudents ?? true,
          allowsSession2: input.allowsSession2 ?? false,
          isSystem: false,
          templateKey: null,
          position: input.position ?? 0,
          now: deps.clock.now(),
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(AssessCode.TYPE_DUPLICATE, `Le code « ${input.code} » est déjà utilisé par un type d'évaluation.`, { code: input.code }));
      throw e;
    }
    events.audit({ action: "assess.type.created", entity: "assessment_type", entityId: created.id, after: created, severity: "notice" });
    await events.flush(tx);
    return ok(created);
  });
}

export async function updateAssessmentType(
  deps: AssessDeps,
  ctx: RequestContext,
  input: { typeId: string; patch: TypePatch; caps?: AssessCaps },
): Promise<Result<AssessmentType, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const before = await getType(tx, input.typeId);
    if (!before) return err(notFound(AssessCode.TYPE_NOT_FOUND, "Type d'évaluation", input.typeId));
    const after = await guarded(() => updateType(tx, input.typeId, input.patch, deps.clock.now()));
    if (!after) return err(notFound(AssessCode.TYPE_NOT_FOUND, "Type d'évaluation", input.typeId));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "assess.type.updated", entity: "assessment_type", entityId: after.id, before, after, severity: "notice" });
    await events.flush(tx);
    return ok(after);
  });
}

export async function getAssessSettings(deps: AssessDeps, ctx: RequestContext): Promise<Result<AssessSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await getSettingsRow(tx)), { readOnly: true });
}

export async function updateAssessSettings(
  deps: AssessDeps,
  ctx: RequestContext,
  input: { requireSeparateReviewer?: boolean | undefined; requireSeparateApprover?: boolean | undefined; maxScoreDecimals?: number | undefined },
): Promise<Result<AssessSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (input.maxScoreDecimals !== undefined && (input.maxScoreDecimals < 0 || input.maxScoreDecimals > 3)) {
      return err(validation(AssessCode.INVALID_ENTRY, "Le nombre de décimales d'une note est compris entre 0 et 3.", "maxScoreDecimals"));
    }
    const before = await getSettingsRow(tx);
    const after = await upsertSettings(tx, ctx.tenantId, input, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    // Relâcher la séparation des tâches affaiblit un contrôle : acte audité en avertissement.
    const relaxed = (before.requireSeparateReviewer && !after.requireSeparateReviewer) || (before.requireSeparateApprover && !after.requireSeparateApprover);
    events.audit({ action: "assess.settings.updated", entity: "assess_settings", entityId: ctx.tenantId, before, after, severity: relaxed ? "warning" : "notice" });
    await events.flush(tx);
    return ok(after);
  });
}

/**
 * Amorçage des types d'évaluation du modèle de pack (appelé au provisioning, `tenancy.tenant.provisioned`).
 * Idempotent et NON destructif : un type existant n'est jamais écrasé.
 */
export async function instantiateAssessPack(deps: AssessDeps, ctx: RequestContext, input: { pack?: string | null | undefined } = {}): Promise<Result<{ created: number; existing: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const key = templateKeyForPack(input.pack);
    const now = deps.clock.now();
    let created = 0;
    let existing = 0;
    for (const t of PACK_TYPE_TEMPLATES[key]) {
      const inserted = await insertTypeIfAbsent(tx, {
        id: deps.newId(),
        tenantId: ctx.tenantId,
        code: t.code,
        label: t.label,
        aggregationGroup: t.aggregationGroup,
        defaultScaleMax: t.defaultScaleMax,
        defaultWeight: t.defaultWeight,
        publicationMode: t.publicationMode,
        visibleToStudents: t.visibleToStudents,
        allowsSession2: t.allowsSession2,
        isSystem: true,
        templateKey: key,
        position: t.position,
        now,
      });
      if (inserted) created += 1;
      else existing += 1;
    }
    if (created > 0) {
      const events = new EventBuffer(deps, ctx);
      events.audit({ action: "assess.pack.instantiated", entity: "assessment_type", entityId: ctx.tenantId, metadata: { template: key, created }, severity: "info" });
      await events.flush(tx);
    }
    return ok({ created, existing });
  });
}
