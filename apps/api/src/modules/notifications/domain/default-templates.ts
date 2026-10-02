/**
 * Gabarits LIVRÉS (fr-CI) : des DONNÉES, jamais de la logique. Un établissement les surcharge canal par canal (versions
 * en base, `template_versions`) ; tant qu'il ne l'a pas fait, ces textes servent de repli (version 0, source `SHIPPED`).
 *
 * Chaque code est décrit par trois textes :
 *  - `title`  objet de l'e-mail, titre de la notification (push, in-app) ;
 *  - `short`  texte court (SMS, WhatsApp, push, in-app) ;
 *  - `long`   corps de l'e-mail (texte brut ; le rendu HTML est produit par la plateforme, échappé, avec le pied de page de
 *             conformité : aucun HTML dans un gabarit).
 * Les gabarits par canal sont DÉRIVÉS de ces trois textes (`shippedTemplates()`), de sorte qu'un canal ne manque jamais.
 *
 * Syntaxe : `{{variable}}` ; `{{#variable}}…{{/variable}}` n'affiche le bloc que si la variable est renseignée.
 * Aucun montant, aucune date ni seuil réglementaire n'est écrit ici : tout vient des variables.
 */
import type { NotifChannel, NotifLocale, NotifTemplateCode } from "@ecoledigitale/contracts/src/v2/notifications";
import { NOTIF_DEFAULT_LOCALE } from "@ecoledigitale/contracts/src/v2/notifications";

interface ShippedText {
  readonly title: string;
  readonly short: string;
  readonly long: string;
}

const SIGN = "\n\nCordialement,\n{{schoolName}}";

export const SHIPPED_TEXTS: Readonly<Record<NotifTemplateCode, ShippedText>> = Object.freeze({
  absence: {
    title: "Absence de {{studentName}}",
    short: "{{studentName}} a été signalé(e) absent(e) le {{date}}. Pour justifier cette absence, rendez-vous dans votre espace parent.",
    long: "Bonjour,\n\nNous vous informons que {{studentName}} a été signalé(e) absent(e) le {{date}}.\n\nSi cette absence est justifiée, merci de transmettre le justificatif depuis votre espace parent : {{appUrl}}" + SIGN,
  },
  late: {
    title: "Retard de {{studentName}}",
    short: "{{studentName}} est arrivé(e) en retard le {{date}}{{#minutesLate}} ({{minutesLate}} min){{/minutesLate}}.",
    long: "Bonjour,\n\nNous vous informons que {{studentName}} est arrivé(e) en retard le {{date}}{{#minutesLate}} ({{minutesLate}} minutes){{/minutesLate}}.\n\nMerci de veiller à la ponctualité de votre enfant." + SIGN,
  },
  absence_threshold: {
    title: "Absences répétées de {{studentName}}",
    short: "{{studentName}} totalise {{count}} absences. Merci de prendre contact avec l'établissement.",
    long: "Bonjour,\n\n{{studentName}} totalise à ce jour {{count}} absences sur la période en cours.\n\nNous vous invitons à prendre contact avec l'établissement pour faire le point : {{appUrl}}" + SIGN,
  },
  payment_received: {
    title: "Paiement reçu pour {{studentName}}",
    short: "Nous avons bien reçu votre paiement de {{amount}} pour {{studentName}}.{{#receiptNumber}} Reçu n° {{receiptNumber}}.{{/receiptNumber}}",
    long: "Bonjour,\n\nNous avons bien reçu votre paiement de {{amount}} pour {{studentName}}.{{#receiptNumber}}\nNuméro de reçu : {{receiptNumber}}.{{/receiptNumber}}\n\nVous pouvez retrouver votre reçu dans votre espace : {{appUrl}}" + SIGN,
  },
  invoice_issued: {
    title: "Nouvelle facture pour {{studentName}}",
    short: "Facture {{invoiceNumber}} de {{amount}} pour {{studentName}}, à régler avant le {{dueDate}}.",
    long: "Bonjour,\n\nLa facture {{invoiceNumber}} d'un montant de {{amount}} a été émise pour {{studentName}}.\nDate limite de paiement : {{dueDate}}.\n\nVous pouvez la consulter et la régler depuis votre espace : {{appUrl}}" + SIGN,
  },
  payment_reminder: {
    title: "Rappel de paiement — {{studentName}}",
    short: "Rappel : {{amount}} restent dus pour {{studentName}} (facture {{invoiceNumber}}, échéance du {{dueDate}}, {{daysOverdue}} jours de retard).",
    long: "Bonjour,\n\nSauf erreur de notre part, il reste {{amount}} à régler pour {{studentName}} au titre de la facture {{invoiceNumber}}, échue depuis le {{dueDate}} ({{daysOverdue}} jours de retard).\n\nMerci de régulariser votre situation depuis votre espace : {{appUrl}}\nSi vous avez déjà payé, veuillez ignorer ce message." + SIGN,
  },
  overdue_staff_alert: {
    title: "Impayé : {{studentName}} ({{daysOverdue}} j)",
    short: "Impayé de {{amount}} pour {{studentName}} (facture {{invoiceNumber}}), {{daysOverdue}} jours de retard.",
    long: "Alerte économat.\n\n{{studentName}} : {{amount}} restent dus sur la facture {{invoiceNumber}}, avec {{daysOverdue}} jours de retard.\n\nSuivi dans {{appUrl}}" + SIGN,
  },
  report_card_published: {
    title: "Bulletin de {{studentName}} disponible",
    short: "Le bulletin de {{studentName}} est disponible dans votre espace.",
    long: "Bonjour,\n\nLe bulletin de {{studentName}} vient d'être publié. Vous pouvez le consulter et le télécharger depuis votre espace : {{appUrl}}" + SIGN,
  },
  convocation: {
    title: "Convocation : {{subject}}",
    short: "Convocation : {{subject}}, le {{date}} à {{time}} ({{place}}).{{#studentName}} Élève concerné : {{studentName}}.{{/studentName}}",
    long: "Bonjour,\n\nVous êtes convoqué(e) : {{subject}}.\nDate : {{date}} à {{time}}\nLieu : {{place}}{{#studentName}}\nÉlève concerné : {{studentName}}{{/studentName}}{{#note}}\n\n{{note}}{{/note}}\n\nMerci de confirmer votre présence auprès de l'établissement." + SIGN,
  },
  announcement: {
    title: "{{title}}",
    short: "{{title}}{{#summary}} — {{summary}}{{/summary}} Détails dans votre espace.",
    long: "Bonjour,\n\n{{title}}{{#summary}}\n\n{{summary}}{{/summary}}\n\nLire l'annonce complète : {{appUrl}}" + SIGN,
  },
  urgent_notice: {
    title: "URGENT : {{title}}",
    short: "URGENT — {{title}} : {{message}}",
    long: "Avis urgent.\n\n{{title}}\n\n{{message}}" + SIGN,
  },
  schedule_change: {
    title: "Cours annulé ou modifié le {{date}}",
    short: "Le cours du {{date}} à {{time}}{{#className}} ({{className}}){{/className}} est annulé ou modifié. Consultez l'emploi du temps.",
    long: "Bonjour,\n\nLe cours du {{date}} à {{time}}{{#className}} pour la classe {{className}}{{/className}} est annulé ou modifié.\n\nConsultez l'emploi du temps à jour dans votre espace : {{appUrl}}" + SIGN,
  },
  grade_drop_alert: {
    title: "Baisse de résultats : {{studentName}}",
    short: "{{studentName}} ({{className}}) : résultat passé de {{previous}} à {{current}} (écart {{drop}}).",
    long: "Alerte pédagogique.\n\n{{studentName}} ({{className}}) : le résultat FINAL est passé de {{previous}} à {{current}}, soit un écart de {{drop}}.\n\nSuivi dans {{appUrl}}" + SIGN,
  },
  teaching_load_alert: {
    title: "Charge d'enseignement : {{staffName}}",
    short: "{{staffName}} cumule {{hours}} h planifiées (seuil : {{threshold}} h).",
    long: "Alerte organisation.\n\n{{staffName}} cumule {{hours}} heures d'enseignement planifiées, au-dessus du seuil de {{threshold}} heures.\n\nVoir le détail : {{appUrl}}" + SIGN,
  },
  document_expiring: {
    title: "Échéance proche : {{staffName}}",
    short: "Document ou qualification de {{staffName}} : échéance le {{expiresOn}} ({{daysLeft}} jours).",
    long: "Bonjour,\n\nUn document ou une qualification de {{staffName}} arrive à échéance le {{expiresOn}} (dans {{daysLeft}} jours).\n\nMerci de le renouveler : {{appUrl}}" + SIGN,
  },
  payslip_available: {
    title: "Votre bulletin de paie est disponible",
    short: "Votre bulletin de paie est disponible dans votre espace.",
    long: "Bonjour,\n\nVotre bulletin de paie est disponible. Vous pouvez le consulter depuis votre espace : {{appUrl}}" + SIGN,
  },
  channel_test: {
    title: "Message d'essai",
    short: "Message d'essai de {{schoolName}} : ce canal fonctionne.",
    long: "Bonjour,\n\nCeci est un message d'essai envoyé par {{schoolName}} pour vérifier ce canal de notification." + SIGN,
  },
});

export interface ShippedTemplate {
  readonly code: NotifTemplateCode;
  readonly channel: NotifChannel;
  readonly locale: NotifLocale;
  readonly subject: string | null;
  readonly body: string;
}

function derive(code: NotifTemplateCode, channel: NotifChannel): ShippedTemplate {
  const t = SHIPPED_TEXTS[code];
  switch (channel) {
    case "EMAIL":
      return { code, channel, locale: NOTIF_DEFAULT_LOCALE, subject: t.title, body: t.long };
    case "SMS":
      return { code, channel, locale: NOTIF_DEFAULT_LOCALE, subject: null, body: `{{schoolName}} : ${t.short}` };
    case "WHATSAPP":
      return { code, channel, locale: NOTIF_DEFAULT_LOCALE, subject: null, body: `*${t.title}*\n${t.short}` };
    case "PUSH":
    case "IN_APP":
      return { code, channel, locale: NOTIF_DEFAULT_LOCALE, subject: t.title, body: t.short };
  }
}

const CHANNELS_ORDER: readonly NotifChannel[] = ["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"];

/** Tous les gabarits livrés : un par (code, canal) en fr-CI. */
export function shippedTemplates(): readonly ShippedTemplate[] {
  return (Object.keys(SHIPPED_TEXTS) as NotifTemplateCode[]).flatMap((code) => CHANNELS_ORDER.map((channel) => derive(code, channel)));
}

const INDEX: ReadonlyMap<string, ShippedTemplate> = new Map(shippedTemplates().map((t) => [`${t.code}|${t.channel}|${t.locale}`, t]));

/** Gabarit livré d'un (code, canal, langue) ; repli sur fr-CI. */
export function findShippedTemplate(code: string, channel: NotifChannel, locale: string = NOTIF_DEFAULT_LOCALE): ShippedTemplate | undefined {
  return INDEX.get(`${code}|${channel}|${locale}`) ?? INDEX.get(`${code}|${channel}|${NOTIF_DEFAULT_LOCALE}`);
}
