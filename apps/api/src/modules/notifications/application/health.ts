/**
 * Canaux et état de santé : configuration (variables manquantes, jamais leurs valeurs), activation par l'établissement,
 * 24 dernières heures (envoyés / échecs / rebonds / ignorés), file d'attente, plafond journalier, dernière erreur.
 * L'essai d'un canal passe par le circuit normal (journal) : un message d'essai envoyé à soi-même.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { NOTIF_CHANNELS, type NotifChannel, type NotifChannelHealth } from "@ecoledigitale/contracts/src/v2/notifications";
import { NotifCode, forbidden, validation } from "../domain/errors";
import { PLATFORM_DAILY_CAPS } from "../domain/types";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { AudienceResolver } from "./audience";
import { inTx, type NotificationsDeps } from "./deps";
import { enqueueInTx } from "./enqueue";

/** Une file qui ne se vide pas depuis cette durée fait passer le canal en « dégradé ». */
const STALE_QUEUE_MS = 15 * 60_000;

export async function getChannelsHealth(deps: NotificationsDeps, ctx: RequestContext): Promise<Result<{ items: NotifChannelHealth[]; simulation: boolean }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const now = deps.clock.now();
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const stats = new Map((await deliveriesRepo.channelStats(tx, ctx.tenantId, now)).map((s) => [s.channel, s]));
      const used = await deliveriesRepo.usedLast24h(tx, ctx.tenantId, now);
      const items: NotifChannelHealth[] = NOTIF_CHANNELS.map((channel) => {
        const adapter = deps.channels.get(channel);
        const status = adapter.status();
        const s = stats.get(channel);
        const enabled = settings.enabledChannels.includes(channel);
        const stale = s?.oldestPendingAt ? now.getTime() - s.oldestPendingAt.getTime() > STALE_QUEUE_MS : false;
        const failing = s ? s.failed + s.bounced > 0 && s.failed + s.bounced >= s.sent : false;
        const state: NotifChannelHealth["state"] = !enabled ? "DISABLED" : !status.configured && !deps.channels.simulation ? "NOT_CONFIGURED" : stale || failing ? "DEGRADED" : "OK";
        return {
          channel,
          provider: status.configured ? adapter.provider : null,
          configured: status.configured,
          enabled,
          state,
          missing: [...status.missing],
          last24h: { sent: s?.sent ?? 0, failed: s?.failed ?? 0, bounced: s?.bounced ?? 0, skipped: s?.skipped ?? 0 },
          pending: s?.pending ?? 0,
          oldestPendingAt: s?.oldestPendingAt ? s.oldestPendingAt.toISOString() : null,
          lastErrorCode: s?.lastErrorCode ?? null,
          lastErrorAt: s?.lastErrorAt ? s.lastErrorAt.toISOString() : null,
          dailyCap: settings.dailyCaps[channel] ?? PLATFORM_DAILY_CAPS[channel],
          sentToday: used[channel] ?? 0,
        };
      });
      return ok({ items, simulation: deps.channels.simulation });
    },
    { readOnly: true },
  );
}

/** Envoie un message d'essai (gabarit `channel_test`) à l'appelant, par les canaux demandés. Passe par le journal. */
export async function sendChannelTest(deps: NotificationsDeps, ctx: RequestContext, input: { channels: readonly NotifChannel[] }): Promise<Result<{ queued: number; skipped: number }, AppError>> {
  const userId = ctx.userId;
  if (!userId) return err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const resolver = new AudienceResolver(deps, ctx);
    const me = await resolver.deps.ports.directory.contactsOfUsers(ctx, [userId]);
    if (me.length === 0) return err(validation(NotifCode.RECIPIENT_NOT_FOUND, "Votre compte n'a pas de coordonnées joignables.", "channels"));
    const r = await enqueueInTx(deps, ctx, tx, {
      source: { kind: "TEST" },
      templateCode: "channel_test",
      // Un essai n'attend pas la fin des heures calmes (il est demandé par l'utilisateur, maintenant).
      urgent: true,
      recipients: me,
      channels: input.channels,
      strategy: "ALL",
      values: {},
      dedupeBase: `test:${deps.newId()}`,
      context: { requestedBy: userId },
      createdBy: userId,
    });
    return ok({ queued: r.queued, skipped: r.skipped });
  });
}
