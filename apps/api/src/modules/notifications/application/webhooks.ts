/**
 * Accusés des fournisseurs (route publique SIGNÉE, rattachée à un établissement) : remise confirmée, échec, rebond différé,
 * plainte. Le rebond différé et la plainte ajoutent l'adresse à la liste de suppression (par EMPREINTE : l'adresse a été
 * effacée du journal après l'envoi). Un accusé pour une remise inconnue est ignoré (idempotent, pas d'oracle).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { NotifDeliveryStatusWebhookBody } from "@ecoledigitale/contracts/src/v2/notifications";
import { NotificationsEvents } from "../domain/events";
import * as deliveriesRepo from "../infrastructure/deliveries-repository";
import * as prefsRepo from "../infrastructure/preferences-repository";
import { EventBuffer, inTx, type NotificationsDeps } from "./deps";

export async function applyDeliveryStatusWebhook(deps: NotificationsDeps, ctx: RequestContext, body: NotifDeliveryStatusWebhookBody): Promise<Result<{ matched: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const rows = await deliveriesRepo.findByProviderId(tx, ctx.tenantId, body.providerId);
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    for (const row of rows) {
      if (body.status === "DELIVERED") {
        if (row.status === "SENT") await deliveriesRepo.applyProviderStatus(tx, ctx.tenantId, row.id, { status: "DELIVERED", code: null, message: null, at: now });
        continue;
      }
      if (body.status === "FAILED") {
        await deliveriesRepo.applyProviderStatus(tx, ctx.tenantId, row.id, { status: "FAILED", code: "provider_failed", message: body.reason ?? null, at: now });
        continue;
      }
      // BOUNCED / COMPLAINT : rebond définitif ou plainte -> suppression de l'adresse.
      await deliveriesRepo.applyProviderStatus(tx, ctx.tenantId, row.id, { status: "BOUNCED", code: body.status === "COMPLAINT" ? "complaint" : "hard_bounce", message: body.reason ?? null, at: now });
      if (row.addressHash && (row.channel === "EMAIL" || row.channel === "SMS" || row.channel === "WHATSAPP")) {
        await prefsRepo.addSuppression(tx, ctx.tenantId, { channel: row.channel, hash: row.addressHash, masked: row.recipientMasked, reason: body.status === "COMPLAINT" ? "COMPLAINT" : "HARD_BOUNCE", deliveryId: row.id, at: now });
      }
      events.add(NotificationsEvents.DELIVERY_BOUNCED, { v: 1, deliveryId: row.id, channel: row.channel, reason: body.status === "COMPLAINT" ? "complaint" : "hard_bounce" }, { type: "delivery", id: row.id });
    }
    await events.flush(tx);
    return ok({ matched: rows.length });
  });
}
