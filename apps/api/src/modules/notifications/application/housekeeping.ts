/**
 * Entretien quotidien (un établissement à la fois) : purge du journal terminal au-delà de la rétention de l'établissement
 * (jamais une remise en attente), nettoyage des abonnements Web Push expirés ou en échec répété.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import type { NotificationsDeps } from "./deps";
import { purgeStalePushSubscriptions } from "./push";

export async function housekeepingTenant(deps: NotificationsDeps, ctx: RequestContext): Promise<{ deliveries: number; pushSubscriptions: number }> {
  const now = deps.clock.now();
  const deliveries = await deps.db.run(ctx, async (tx) => {
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    return deliveriesRepo.purgeTerminalBefore(tx, ctx.tenantId, new Date(now.getTime() - settings.journalRetentionDays * 86_400_000));
  });
  const pushSubscriptions = await purgeStalePushSubscriptions(deps, ctx);
  return { deliveries, pushSubscriptions };
}
