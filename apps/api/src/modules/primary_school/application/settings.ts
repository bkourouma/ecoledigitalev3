/** Paramètres de l'établissement : politiques (titulaire exigé, conseil exigé pour le bilan, banque de phrases, conservation). Aucune règle réglementaire. */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryUpdateSettingsBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import { DEFAULT_SETTINGS, type Settings, type Uuid } from "../domain/types";
import { PrimaryCode, notFound } from "../domain/errors";
import { getScaleRow, getSettingsRow, upsertSettingsRow } from "../infrastructure/reference-repository";
import { resolveInstitution } from "./access";
import { EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";

export async function getSettings(deps: PrimarySchoolDeps, ctx: RequestContext, input: { institutionId?: Uuid | undefined } = {}): Promise<Result<Settings, AppError>> {
  const institution = await resolveInstitution(deps, ctx, input.institutionId);
  if (!institution.ok) return institution;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await getSettingsRow(tx, institution.value);
      return ok(row ?? { institutionId: institution.value, ...DEFAULT_SETTINGS });
    },
    { readOnly: true },
  );
}

/** Paramètres lus par d'autres cas d'usage (scellement, garde d'activation) : défauts si aucune ligne. */
export async function settingsOf(tx: Parameters<typeof getSettingsRow>[0], institutionId: Uuid): Promise<Settings> {
  return (await getSettingsRow(tx, institutionId)) ?? { institutionId, ...DEFAULT_SETTINGS };
}

export async function updateSettings(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryUpdateSettingsBody): Promise<Result<Settings, AppError>> {
  const institution = await resolveInstitution(deps, ctx, input.institutionId);
  if (!institution.ok) return institution;
  return inTx(deps, ctx, async (tx) => {
    const current = (await getSettingsRow(tx, institution.value)) ?? { institutionId: institution.value, ...DEFAULT_SETTINGS };
    if (input.defaultRatingScaleId) {
      const scale = await getScaleRow(tx, input.defaultRatingScaleId);
      if (!scale) return err(notFound(PrimaryCode.SCALE_NOT_FOUND, "Échelle d'appréciation", input.defaultRatingScaleId));
    }
    const next: Settings = {
      institutionId: institution.value,
      requireHomeroomForActivation: input.requireHomeroomForActivation ?? current.requireHomeroomForActivation,
      councilRequiredForBilan: input.councilRequiredForBilan ?? current.councilRequiredForBilan,
      phraseBankEnabled: input.phraseBankEnabled ?? current.phraseBankEnabled,
      defaultRatingScaleId: input.defaultRatingScaleId === undefined ? current.defaultRatingScaleId : input.defaultRatingScaleId,
      archiveRetentionYears: input.archiveRetentionYears === undefined ? current.archiveRetentionYears : input.archiveRetentionYears,
    };
    const saved = await upsertSettingsRow(tx, ctx.tenantId, next);
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "primary_school.settings.updated",
      resourceType: "settings",
      resourceId: institution.value,
      before: { requireHomeroomForActivation: current.requireHomeroomForActivation, councilRequiredForBilan: current.councilRequiredForBilan, archiveRetentionYears: current.archiveRetentionYears },
      after: { requireHomeroomForActivation: saved.requireHomeroomForActivation, councilRequiredForBilan: saved.councilRequiredForBilan, archiveRetentionYears: saved.archiveRetentionYears },
      // Désactiver une garde est un acte assumé : il est audité à un niveau supérieur.
      sensitive: current.requireHomeroomForActivation && !saved.requireHomeroomForActivation,
    });
    await events.flush(tx);
    return ok(saved);
  });
}
