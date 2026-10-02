/**
 * admissions -> notifications : `ApplicantNotifier` (messages aux familles : candidature reçue, pièces manquantes, offre,
 * inscription confirmée) par le module `notifications` (e-mail, SMS, WhatsApp ; mise en file, le worker envoie).
 *
 *  - Le destinataire est un CANDIDAT (tuteur d'un dossier), sans compte ni fiche `people` : on construit un `Recipient` à partir de
 *    ses coordonnées de la candidature (clé de personne `person:<tuteur>`), les consentements et la liste de suppression de
 *    `notifications` s'appliquent comme pour tout envoi ;
 *  - le catalogue de gabarits de `notifications` est FERMÉ : les codes d'admissions sont rendus par le gabarit livré `announcement`
 *    (titre + résumé) avec un texte NEUTRE (aucune décision détaillée, aucun motif de refus : jamais dans un SMS ou un e-mail) ;
 *  - canaux essayés dans l'ordre E-MAIL, SMS, WHATSAPP, parmi ceux pour lesquels le tuteur a une coordonnée : le premier qui met
 *    une remise EN FILE gagne. Aucun canal joignable (aucune coordonnée, consentement refusé, canal désactivé) : échec FERMÉ
 *    `admissions.channel_unavailable` — admissions consigne `SKIPPED` / `CHANNEL_UNAVAILABLE` (« à contacter par téléphone ») ;
 *  - AUCUNE simulation d'envoi. Le lien de réponse à une offre est un secret : il figure dans le message de l'offre (c'est son
 *    objet) et donc dans le contenu mis en file du journal de `notifications`, purgé par le ménage de ce module.
 *
 *
 * NB : `notifications` consomme aussi `admissions.application.submitted` et `admissions.offer.issued` (règles livrées
 * `admissions.*.applicant`, DÉSACTIVÉES par défaut, coordonnées lues par `notifications-admissions.ts`). Ne pas activer ces
 * règles en même temps que ce canal : le message partirait deux fois (arbitrage du propriétaire d'admissions).
 */
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import { InternalError, type RequestContext } from "@ecoledigitale/kernel";
import type { ApplicantNotifier, DeliveryReceipt, NotificationChannel } from "../../modules/admissions";
import { enqueueInTx, type NotificationsDeps, type Recipient } from "../../modules/notifications";

export interface NotificationSender {
  send(
    ctx: RequestContext,
    message: {
      templateCode: string;
      to: { email?: string | null; phone?: string | null };
      variables: Readonly<Record<string, string | readonly string[]>>;
      idempotencyKey: string;
      /** Identifiant stable du destinataire (tuteur du dossier) : clé de consentement. */
      subjectId?: string;
    },
  ): Promise<{ channel: NotificationChannel; status: "SENT" | "QUEUED"; providerRef?: string | null }>;
}

const channelUnavailable = (): InternalError => new InternalError("Aucun canal de notification n'est disponible.", { code: "admissions.channel_unavailable" });

const list = (v: string | readonly string[] | undefined): string => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");

/** Texte neutre par code de gabarit d'admissions (titre, résumé). Un code inconnu (étape personnalisée) : message générique. */
export function admissionsMessageText(templateCode: string, firstName: string, data: Readonly<Record<string, string | readonly string[]>>): { title: string; summary: string } {
  const hello = firstName ? `Bonjour ${firstName}, ` : "";
  switch (templateCode) {
    case "APPLICATION_RECEIVED":
      return { title: "Candidature reçue", summary: `${hello}nous avons bien reçu votre dossier de candidature. Nous vous écrirons à chaque étape.` };
    case "DOCUMENTS_MISSING": {
      const missing = list(data["missingDocuments"]);
      return { title: "Pièces manquantes à votre dossier", summary: `${hello}il manque des pièces à votre dossier${missing ? ` : ${missing}` : ""}. Merci de les transmettre à l'établissement.` };
    }
    case "APPLICATION_WAITLISTED":
      return { title: "Candidature en liste d'attente", summary: `${hello}votre dossier est en liste d'attente. Nous vous contacterons si une place se libère.` };
    case "APPLICATION_REJECTED":
      return { title: "Réponse à votre candidature", summary: `${hello}une réponse à votre candidature est disponible. Contactez l'établissement pour en savoir plus.` };
    case "OFFER_ISSUED": {
      const link = list(data["link"]);
      return { title: "Offre d'admission", summary: `${hello}une place vous est proposée.${link ? ` Répondez à l'offre avant son expiration : ${link}` : " Contactez l'établissement pour répondre à l'offre."}` };
    }
    case "OFFER_ACCEPTED":
      return { title: "Offre acceptée", summary: `${hello}nous avons bien enregistré l'acceptation de l'offre.${list(data["invoiceIssued"]) === "true" ? " Les frais d'inscription sont à régler pour confirmer l'inscription." : ""}` };
    case "ENROLLMENT_CONFIRMED":
      return { title: "Inscription confirmée", summary: `${hello}l'inscription est confirmée. Bienvenue !` };
    default:
      return { title: "Information sur votre candidature", summary: `${hello}une information concernant votre candidature est disponible. Contactez l'établissement.` };
  }
}

const CHANNEL_ORDER: ReadonlyArray<{ channel: Extract<NotifChannel, NotificationChannel>; needs: "email" | "phone" }> = [
  { channel: "EMAIL", needs: "email" },
  { channel: "SMS", needs: "phone" },
  { channel: "WHATSAPP", needs: "phone" },
];

/** `NotificationSender` bâti sur `notifications` : mise en file dans une transaction du tenant (le worker envoie). */
export function createAdmissionsNotificationSender(notifications: NotificationsDeps): NotificationSender {
  return {
    async send(ctx, message) {
      const email = message.to.email?.trim() || null;
      const phone = message.to.phone?.trim() || null;
      const firstName = typeof message.variables["firstName"] === "string" ? message.variables["firstName"] : "";
      const subject = message.subjectId ?? message.idempotencyKey;
      const recipient: Recipient = {
        subjectKey: `person:${subject}`,
        aliasKeys: [],
        userId: null,
        displayName: firstName || "Candidat",
        email,
        phone,
        kind: "GUARDIAN",
        flags: { primary: true },
      };
      const { title, summary } = admissionsMessageText(message.templateCode, firstName, message.variables);
      for (const { channel, needs } of CHANNEL_ORDER) {
        if (needs === "email" ? !email : !phone) continue;
        const r = await notifications.db.run(ctx, (tx) =>
          enqueueInTx(notifications, ctx, tx, {
            source: { kind: "MANUAL" },
            templateCode: "announcement",
            urgent: false,
            recipients: [recipient],
            channels: [channel],
            strategy: "FIRST_REACHABLE",
            values: { title, summary },
            dedupeBase: `admissions:${message.idempotencyKey}`,
            context: { origin: "admissions", templateCode: message.templateCode },
            linkPath: null,
            createdBy: ctx.userId,
          }),
        );
        if (r.queued > 0) return { channel, status: "QUEUED" as const, providerRef: null };
        // une remise déjà présente (rejeu) vaut « déjà mise en file »
        if (r.duplicates > 0) return { channel, status: "QUEUED" as const, providerRef: null };
      }
      throw channelUnavailable();
    },
  };
}

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
        subjectId: message.guardianId,
      });
      return { channel: receipt.channel, status: receipt.status, providerRef: receipt.providerRef ?? null };
    },
  };
}
