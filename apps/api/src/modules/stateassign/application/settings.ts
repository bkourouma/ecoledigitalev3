/**
 * Réglages d'établissement : séparation des tâches de vérification, tolérance de rapprochement, contrôles exigés, délai de grâce
 * des créances. Aucune valeur officielle n'est livrée : sans ligne enregistrée, valeurs prudentes (tolérance 0, aucun contrôle,
 * aucune planification, grâce 0). Modifier un réglage est un acte humain, sensible et audité.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { StateassignSettingsDto, StateassignUpdateSettingsBody } from "@ecoledigitale/contracts/src/v2/stateassign";
import { StateassignCode, notFound } from "../domain/errors";
import type { Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import { EventBuffer, inTx, requireHuman, type StateassignDeps } from "./deps";
import { settingsDto } from "./presenters";
import { inScope } from "./support";

export async function getInstitutionSettings(deps: StateassignDeps, ctx: RequestContext, institutionId: Uuid): Promise<Result<StateassignSettingsDto, AppError>> {
  if (!inScope(ctx, institutionId)) return err(notFound(StateassignCode.INSTITUTION_NOT_FOUND, "Établissement", institutionId));
  return inTx(deps, ctx, async (tx) => ok(settingsDto(await repo.getSettings(tx, institutionId))), { readOnly: true });
}

export async function updateInstitutionSettings(deps: StateassignDeps, ctx: RequestContext, institutionId: Uuid, body: StateassignUpdateSettingsBody): Promise<Result<StateassignSettingsDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  if (!inScope(ctx, institutionId)) return err(notFound(StateassignCode.INSTITUTION_NOT_FOUND, "Établissement", institutionId));
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getSettings(tx, institutionId);
    const saved = await repo.upsertSettings(tx, ctx.tenantId, institutionId, {
      requireSeparateVerifier: body.requireSeparateVerifier,
      reconciliationTolerance: body.reconciliationTolerance,
      requiredControlKinds: [...new Set(body.requiredControlKinds)],
      controlDueOffsetDays: body.controlDueOffsetDays,
      receivableGraceDays: body.receivableGraceDays,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "stateassign.settings.updated",
      resourceType: "settings",
      resourceId: institutionId,
      sensitive: true,
      before: { requireSeparateVerifier: before.requireSeparateVerifier, tolerance: before.reconciliationTolerance, controls: before.requiredControlKinds, offset: before.controlDueOffsetDays, grace: before.receivableGraceDays },
      after: { requireSeparateVerifier: saved.requireSeparateVerifier, tolerance: saved.reconciliationTolerance, controls: saved.requiredControlKinds, offset: saved.controlDueOffsetDays, grace: saved.receivableGraceDays },
    });
    await events.flush(tx);
    return ok(settingsDto(saved));
  });
}
