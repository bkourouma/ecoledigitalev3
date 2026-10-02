/**
 * admissions -> notifications : `ApplicantNotifier` (messages aux familles : candidature reçue, pièces manquantes, offre,
 * inscription confirmée). Le module `notifications` (canaux e-mail / SMS / WhatsApp) est un chantier distinct : tant qu'il n'est
 * pas câblé, le port ÉCHOUE FERMÉ (`admissions.channel_unavailable`) et admissions consigne `SKIPPED` / `CHANNEL_UNAVAILABLE`
 * (« à contacter par téléphone ») — AUCUNE simulation d'envoi (plan §3.11).
 *
 * Interface attendue du module `notifications` (voir README d'admissions) :
 *
 *   send(ctx, { templateCode, to: { email?, phone? }, variables, idempotencyKey })
 *     -> Promise<{ channel: "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP"; status: "SENT" | "QUEUED"; providerRef?: string | null }>
 *
 * Câblage prévu : `createAdmissionsApplicantNotifier(notificationsSender)` dans `buildPlatformPorts` quand le module existe.
 *
 * NB : `notifications` consomme aussi `admissions.application.submitted` et `admissions.offer.issued` (règles livrées
 * `admissions.*.applicant`, DÉSACTIVÉES par défaut, coordonnées lues par `notifications-admissions.ts`). Ne pas activer ces
 * règles en même temps que ce canal : le message partirait deux fois (arbitrage du propriétaire d'admissions).
 */
import { InternalError, type RequestContext } from "@ecoledigitale/kernel";
import type { ApplicantNotifier, DeliveryReceipt, NotificationChannel } from "../../modules/admissions";

export interface NotificationSender {
  send(
    ctx: RequestContext,
    message: { templateCode: string; to: { email?: string | null; phone?: string | null }; variables: Readonly<Record<string, string | readonly string[]>>; idempotencyKey: string },
  ): Promise<{ channel: NotificationChannel; status: "SENT" | "QUEUED"; providerRef?: string | null }>;
}

const channelUnavailable = (): InternalError => new InternalError("Aucun canal de notification n'est disponible.", { code: "admissions.channel_unavailable" });

export function createAdmissionsApplicantNotifier(sender: NotificationSender | null): ApplicantNotifier {
  return {
    async send(ctx, message): Promise<DeliveryReceipt> {
      if (!sender) throw channelUnavailable();
      if (!message.recipient.email && !message.recipient.phone) throw channelUnavailable();
      const receipt = await sender.send(ctx, {
        templateCode: message.templateCode,
        to: { email: message.recipient.email, phone: message.recipient.phone },
        variables: { firstName: message.recipient.firstName, ...message.data },
        idempotencyKey: message.dedupeKey,
      });
      return { channel: receipt.channel, status: receipt.status, providerRef: receipt.providerRef ?? null };
    },
  };
}
