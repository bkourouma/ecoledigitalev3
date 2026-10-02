/**
 * Pont vers le port `NotificationChannel` DÉCLARÉ par `messaging` (spec 016 §11) : un canal de ce module peut être consommé
 * là où le contrat de messagerie est attendu (`{ channel, deliver(OutboundNotification) }`).
 *
 * Le contrat de messagerie ne porte ni adresse ni clé d'idempotence : le pont RÉSOUT le contact du destinataire par l'annuaire
 * (`contactsOfUsers`) et dérive la clé de la clé de déduplication de la notification. Les issues sont ramenées à
 * `SENT | SKIPPED | FAILED` (une panne passagère est un `FAILED` : la reprise appartient au journal, pas à ce pont).
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import type { ChannelDelivery, NotificationChannel, OutboundNotification } from "../../messaging";
import type { ChannelAdapter, RecipientDirectory } from "../application/ports";
import { normalizeEmail, normalizePhone } from "../domain/addresses";

export function toMessagingChannel(adapter: ChannelAdapter & { readonly channel: "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" }, directory: Pick<RecipientDirectory, "contactsOfUsers">, options: { schoolName?: string; dialCode?: string } = {}): NotificationChannel {
  return {
    channel: adapter.channel,
    async deliver(n: OutboundNotification): Promise<ChannelDelivery> {
      const ctx = createSystemContext(n.tenantId);
      const [recipient] = await directory.contactsOfUsers(ctx, [n.userId]);
      if (!recipient) return { status: "SKIPPED", detail: "recipient_unknown" };
      const address = adapter.channel === "EMAIL" ? normalizeEmail(recipient.email) : adapter.channel === "PUSH" ? n.userId : normalizePhone(recipient.phone, options.dialCode ?? "225");
      if (!address) return { status: "SKIPPED", detail: "no_contact" };
      const outcome = await adapter.deliver({
        tenantId: n.tenantId,
        deliveryId: n.dedupeKey ?? `${n.tenantId}:${n.userId}:${n.title}`.slice(0, 100),
        channel: adapter.channel,
        address,
        userId: n.userId,
        subject: n.title,
        text: n.body ?? n.title,
        templateCode: "announcement",
        category: n.category === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : "ALERT",
        urgent: false,
        link: n.link,
        idempotencyKey: n.dedupeKey ?? `${n.tenantId}:${n.userId}`,
        schoolName: options.schoolName ?? "EcoleDigitale",
        senderName: options.schoolName ?? "EcoleDigitale",
        replyTo: null,
        legalFooter: null,
        unsubscribeUrl: null,
      });
      switch (outcome.status) {
        case "SENT":
        case "SIMULATED":
          return { status: "SENT" };
        case "SKIPPED":
          return { status: "SKIPPED", detail: outcome.reason };
        default:
          return { status: "FAILED", detail: outcome.code };
      }
    },
  };
}
