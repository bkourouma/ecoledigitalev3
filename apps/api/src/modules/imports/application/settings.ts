/**
 * Paramètres du module par tenant (plafonds, quotas, rétention) : lecture avec défauts, mise à jour bornée par les
 * plafonds ABSOLUS du produit (`ImportsConfig.hard*`), audit.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ImportSettingsDto, ImportUpdateSettingsBody } from "@ecoledigitale/contracts/src/v2/imports";
import { validation } from "../domain/errors";
import type { SettingsRecord } from "../domain/records";
import { getSettings, upsertSettings } from "../infrastructure/jobs-repository";
import { EventBuffer, inTx, type ImportsDeps } from "./deps";
import { toSettingsDto } from "./views";

export async function getImportSettings(deps: ImportsDeps, ctx: RequestContext): Promise<Result<ImportSettingsDto, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(toSettingsDto(await getSettings(tx), deps.config)), { readOnly: true });
}

export async function updateImportSettings(deps: ImportsDeps, ctx: RequestContext, patch: ImportUpdateSettingsBody): Promise<Result<ImportSettingsDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await getSettings(tx);
    const next: SettingsRecord = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    if (next.maxRows > deps.config.hardMaxRows) return err(validation("imports.options_invalid", `Le plafond de lignes ne peut dépasser ${deps.config.hardMaxRows}.`, "maxRows"));
    if (next.maxColumns > deps.config.hardMaxColumns) return err(validation("imports.options_invalid", `Le plafond de colonnes ne peut dépasser ${deps.config.hardMaxColumns}.`, "maxColumns"));
    if (next.maxFileBytes > deps.config.hardMaxFileBytes) return err(validation("imports.options_invalid", "Le plafond de taille de fichier dépasse la limite du produit.", "maxFileBytes"));
    if (next.allOrNothingMaxRows > next.maxRows) return err(validation("imports.options_invalid", "Le plafond du mode « tout ou rien » ne peut dépasser le plafond de lignes.", "allOrNothingMaxRows"));
    await upsertSettings(tx, ctx.tenantId, next, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "imports.settings.update", entity: "settings", entityId: ctx.tenantId, before: current, after: next, severity: "notice" });
    await events.flush(tx);
    return ok(toSettingsDto(next, deps.config));
  });
}
