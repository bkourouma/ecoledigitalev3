/**
 * Abonnements Web Push (VAPID) : un par appareil. L'abonnement appartient à l'utilisateur qui le crée ; un appareil réabonné
 * met à jour ses clés. Les abonnements expirés (404 / 410 du service push) sont supprimés à l'envoi ; un nettoyage périodique
 * retire les abonnements en échec répété ou inutilisés.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { NotifPushSubscribeBody } from "@ecoledigitale/contracts/src/v2/notifications";
import { NotifCode, conflict, forbidden } from "../domain/errors";
import * as pushRepo from "../infrastructure/push-repository";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";
import type { PushSubscriptionStore } from "./ports";

export function vapidPublicKey(deps: NotificationsDeps): { publicKey: string | null; configured: boolean } {
  const configured = deps.channels.get("PUSH").status().configured;
  return { publicKey: configured ? deps.config.vapidPublicKey : null, configured };
}

export async function subscribePush(deps: NotificationsDeps, ctx: RequestContext, body: NotifPushSubscribeBody): Promise<Result<{ id: string }, AppError>> {
  if (!ctx.userId) return err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
  const userId = ctx.userId;
  if (!deps.channels.get("PUSH").status().configured) return err(conflict(NotifCode.PUSH_NOT_CONFIGURED, "Les notifications push ne sont pas configurées sur ce serveur."));
  return inTx(deps, ctx, async (tx) => {
    const id = await pushRepo.upsertSubscription(tx, ctx.tenantId, {
      id: deps.newId(),
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      deviceLabel: body.deviceLabel ?? null,
      userAgent: body.userAgent ? body.userAgent.slice(0, 300) : null,
      at: deps.clock.now(),
    });
    return ok({ id });
  });
}

export async function unsubscribePush(deps: NotificationsDeps, ctx: RequestContext, endpoint: string): Promise<Result<{ removed: boolean }, AppError>> {
  if (!ctx.userId) return err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
  const userId = ctx.userId;
  return inTx(deps, ctx, async (tx) => ok({ removed: await pushRepo.removeByEndpoint(tx, ctx.tenantId, userId, endpoint) }));
}

export async function listMyPushDevices(deps: NotificationsDeps, ctx: RequestContext) {
  if (!ctx.userId) return err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
  const userId = ctx.userId;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await pushRepo.listForUser(tx, ctx.tenantId, userId);
      return ok({ items: rows.map((r) => ({ id: r.id, deviceLabel: r.deviceLabel, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null })) });
    },
    { readOnly: true },
  );
}

/** Retire un appareil par son identifiant (l'utilisateur ne retire que les siens). */
export async function removeMyPushDevice(deps: NotificationsDeps, ctx: RequestContext, deviceId: string): Promise<Result<{ removed: boolean }, AppError>> {
  if (!ctx.userId) return err(forbidden(NotifCode.FORBIDDEN, "Utilisateur identifié requis."));
  const userId = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const own = (await pushRepo.listForUser(tx, ctx.tenantId, userId)).find((r) => r.id === deviceId);
    if (!own) return ok<{ removed: boolean }>({ removed: false });
    await pushRepo.removeById(tx, ctx.tenantId, deviceId);
    return ok<{ removed: boolean }>({ removed: true });
  });
}

/** Magasin d'abonnements du canal push (lecture, nettoyage des expirés, compteur d'échecs), adossé à la base. */
export function createPushStore(deps: Pick<NotificationsDeps, "db" | "clock">, systemCtx: (tenantId: string) => RequestContext): PushSubscriptionStore {
  return {
    async listForUser(tenantId, userId) {
      return deps.db.run(systemCtx(tenantId), async (tx) => (await pushRepo.listForUser(tx, tenantId, userId)).map((r) => ({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth })), { readOnly: true });
    },
    async remove(tenantId, subscriptionId) {
      await deps.db.run(systemCtx(tenantId), (tx) => pushRepo.removeById(tx, tenantId, subscriptionId));
    },
    async touch(tenantId, subscriptionId, at) {
      await deps.db.run(systemCtx(tenantId), (tx) => pushRepo.touch(tx, tenantId, subscriptionId, at));
    },
    async recordFailure(tenantId, subscriptionId) {
      await deps.db.run(systemCtx(tenantId), (tx) => pushRepo.recordFailure(tx, tenantId, subscriptionId).then(() => undefined));
    },
  };
}

/** Nettoyage : abonnements en échec répété ou inutilisés depuis longtemps. */
export async function purgeStalePushSubscriptions(deps: NotificationsDeps, ctx: RequestContext): Promise<number> {
  return deps.db.run(ctx, (tx) => pushRepo.purgeStale(tx, ctx.tenantId, { maxFailures: 5, unusedBefore: new Date(deps.clock.now().getTime() - 120 * 86_400_000) }));
}

export { EventBuffer };
