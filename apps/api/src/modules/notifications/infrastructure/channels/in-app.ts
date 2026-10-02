/**
 * Canal IN_APP : délègue au module `messaging` (fil d'alertes de l'utilisateur + cloche), par son `index.ts` uniquement.
 *
 * La remise devient un message système dans le fil « Alertes » du destinataire ; la clé de déduplication
 * (`notif:<remise>`) rend l'envoi idempotent (une reprise ne crée pas un second message). Le texte vient du gabarit rendu.
 */
import { createSystemContext, noopLogger, systemClock, type Clock, type Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { createMessagingDeps, postSystemMessages } from "../../../messaging";
import type { ChannelAdapter, ChannelMessage, ChannelOutcome } from "../../application/ports";

export interface InAppOptions {
  readonly db: TenantDb;
  readonly clock?: Clock;
  readonly logger?: Logger;
}

export function createInAppChannel(options: InAppOptions): ChannelAdapter {
  const deps = createMessagingDeps({ db: options.db, clock: options.clock ?? systemClock, logger: options.logger ?? noopLogger });
  return {
    channel: "IN_APP",
    provider: "messaging",
    status: () => ({ configured: true, missing: [] }),
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      const userId = m.userId ?? m.address;
      const r = await postSystemMessages(deps, createSystemContext(m.tenantId), {
        userIds: [userId],
        code: `notifications.${m.templateCode}`,
        title: m.subject ?? m.schoolName,
        body: m.text,
        payload: { deliveryId: m.deliveryId, category: m.category, ...(m.link ? { link: m.link } : {}) },
        dedupeKey: `notif:${m.deliveryId}`,
      });
      if (!r.ok) return { status: "RETRY", code: "in_app_error", message: r.error.message.slice(0, 200) };
      return { status: "SENT", providerId: `messaging:${m.deliveryId}` };
    },
  };
}
