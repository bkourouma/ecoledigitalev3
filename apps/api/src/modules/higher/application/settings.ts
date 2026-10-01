/** Réglages du module (par tenant) : durée de validité des crédits capitalisés (Q-25). */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { HigherCode, validation } from "../domain/errors";
import type { HigherSettings } from "../domain/types";
import * as repo from "../infrastructure/ledger-repository";
import { EventBuffer, inTx, type HigherDeps } from "./deps";

export async function getHigherSettings(deps: HigherDeps, ctx: RequestContext): Promise<Result<HigherSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.getSettings(tx)), { readOnly: true });
}

export async function updateHigherSettings(deps: HigherDeps, ctx: RequestContext, input: { creditValidityMonths: number | null }): Promise<Result<HigherSettings, AppError>> {
  const months = input.creditValidityMonths;
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 1200)) {
    return err(validation(HigherCode.INVALID_INPUT, "La durée de validité est un nombre entier de mois compris entre 1 et 1200 (ou vide pour « sans limite »).", "creditValidityMonths"));
  }
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getSettings(tx);
    await repo.upsertSettings(tx, ctx.tenantId, { creditValidityMonths: months }, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.settings.updated", resourceType: "higher_settings", resourceId: ctx.tenantId, before, after: { creditValidityMonths: months } });
    await events.flush(tx);
    return ok({ creditValidityMonths: months });
  });
}
