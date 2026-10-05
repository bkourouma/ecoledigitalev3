/**
 * Catalogue des gabarits : pour chaque code, sa catégorie (granularité des préférences), ses variables TYPÉES
 * (nom, type, obligatoire, exemple pour l'aperçu) et s'il est utilisable en envoi manuel.
 *
 * Les TEXTES livrés sont dans `default-templates.ts` (données). Les variables intégrées `schoolName` et `appUrl`
 * sont fournies par la plateforme à chaque rendu (paramètres d'établissement, `V2_APP_BASE_URL`) : un gabarit peut les
 * utiliser sans qu'un événement ne les renseigne.
 */
import type { NotifCategory, NotifTemplateCode, NotifVariableDef } from "@ecoledigitale/contracts/src/v2/notifications";
import { NOTIF_TEMPLATE_CODES } from "@ecoledigitale/contracts/src/v2/notifications";

export interface CatalogEntry {
  readonly code: NotifTemplateCode;
  readonly label: string;
  readonly description: string;
  readonly category: NotifCategory;
  readonly variables: readonly NotifVariableDef[];
  readonly manual: boolean;
  /** Notification interne (alerte de personnel) : jamais adressée à une famille. */
  readonly staffFacing?: boolean;
}

const v = (name: string, label: string, type: NotifVariableDef["type"], sample: string, required = true): NotifVariableDef => ({ name, label, type, required, sample });

/** Variables fournies par la plateforme à tout gabarit. */
export const BUILTIN_VARIABLES: readonly NotifVariableDef[] = Object.freeze([
  v("schoolName", "Nom de l'établissement (paramètres de notification)", "string", "Groupe Scolaire Les Palmiers", false),
  v("appUrl", "Adresse de l'application", "url", "https://ecole.example.org", false),
]);

const studentName = v("studentName", "Nom de l'élève", "string", "Awa Koné");

export const TEMPLATE_CATALOG: readonly CatalogEntry[] = Object.freeze<CatalogEntry[]>([
  {
    code: "absence",
    label: "Absence d'un élève",
    description: "Informe les parents qu'une absence a été enregistrée.",
    category: "ATTENDANCE",
    variables: [studentName, v("date", "Date de l'absence", "date", "2026-10-02")],
    manual: false,
  },
  {
    code: "late",
    label: "Retard d'un élève",
    description: "Informe les parents d'un retard enregistré.",
    category: "ATTENDANCE",
    variables: [studentName, v("date", "Date du retard", "date", "2026-10-02"), v("minutesLate", "Minutes de retard", "number", "15", false)],
    manual: false,
  },
  {
    code: "absence_threshold",
    label: "Seuil d'absences atteint",
    description: "Alerte les parents lorsque le nombre d'absences franchit le seuil de l'établissement.",
    category: "ATTENDANCE",
    variables: [studentName, v("count", "Nombre d'absences", "number", "5")],
    manual: false,
  },
  {
    code: "payment_received",
    label: "Paiement reçu",
    description: "Confirme la réception d'un paiement (avec le numéro de reçu).",
    category: "FINANCE",
    variables: [studentName, v("amount", "Montant payé", "money", "25000 XOF"), v("receiptNumber", "Numéro du reçu", "string", "REC-2026-00042", false)],
    manual: false,
  },
  {
    code: "invoice_issued",
    label: "Facture émise",
    description: "Prévient la famille qu'une facture est disponible.",
    category: "FINANCE",
    variables: [studentName, v("invoiceNumber", "Numéro de facture", "string", "FAC-2026-00123"), v("amount", "Montant total", "money", "150000 XOF"), v("dueDate", "Date d'échéance", "date", "2026-10-31")],
    manual: false,
  },
  {
    code: "payment_reminder",
    label: "Relance d'impayé",
    description: "Relance de paiement (paliers J+7, J+21, J+45 configurables).",
    category: "FINANCE",
    variables: [
      studentName,
      v("invoiceNumber", "Numéro de facture", "string", "FAC-2026-00123"),
      v("amount", "Reste dû", "money", "75000 XOF"),
      v("dueDate", "Date d'échéance", "date", "2026-09-30"),
      v("daysOverdue", "Jours de retard", "number", "10"),
    ],
    manual: false,
  },
  {
    code: "overdue_staff_alert",
    label: "Alerte impayé (économat)",
    description: "Alerte interne : un retard de paiement atteint le seuil de l'établissement.",
    category: "ALERT",
    variables: [studentName, v("invoiceNumber", "Numéro de facture", "string", "FAC-2026-00123"), v("amount", "Reste dû", "money", "75000 XOF"), v("daysOverdue", "Jours de retard", "number", "20")],
    manual: false,
    staffFacing: true,
  },
  {
    code: "report_card_published",
    label: "Bulletin publié",
    description: "Informe la famille et l'élève que le bulletin est disponible.",
    category: "RESULTS",
    variables: [studentName],
    manual: false,
  },
  {
    code: "convocation",
    label: "Convocation",
    description: "Convoque un parent ou un élève (rendez-vous, entretien, conseil).",
    category: "ANNOUNCEMENT",
    variables: [
      v("subject", "Objet de la convocation", "string", "Entretien avec la direction"),
      v("date", "Date", "date", "2026-10-09"),
      v("time", "Heure", "string", "09:30"),
      v("place", "Lieu", "string", "Bureau de la direction"),
      v("studentName", "Élève concerné", "string", "Awa Koné", false),
      v("note", "Précision", "text", "Merci de vous munir du carnet de correspondance.", false),
    ],
    manual: true,
  },
  {
    code: "announcement",
    label: "Annonce",
    description: "Relaie une annonce de l'établissement sur les canaux externes.",
    category: "ANNOUNCEMENT",
    variables: [v("title", "Titre de l'annonce", "string", "Réunion des parents d'élèves"), v("summary", "Résumé", "text", "La réunion aura lieu samedi à 9 h.", false)],
    manual: true,
  },
  {
    code: "urgent_notice",
    label: "Avis urgent",
    description: "Message urgent (fermeture, incident, sécurité) : contourne les heures calmes.",
    category: "URGENT",
    variables: [v("title", "Objet", "string", "Fermeture exceptionnelle"), v("message", "Message", "text", "L'école est fermée demain en raison des intempéries.")],
    manual: true,
  },
  {
    code: "schedule_change",
    label: "Cours annulé ou déplacé",
    description: "Prévient du changement d'un cours de la classe.",
    category: "SCHEDULE",
    variables: [v("date", "Date du cours", "date", "2026-10-05"), v("time", "Heure du cours", "string", "08:00"), v("className", "Classe", "string", "6e A", false)],
    manual: false,
  },
  {
    code: "grade_drop_alert",
    label: "Baisse de résultats",
    description: "Alerte l'enseignant lorsque les résultats FINAL d'un élève baissent au-delà du seuil.",
    category: "ALERT",
    variables: [studentName, v("className", "Classe", "string", "6e A"), v("previous", "Résultat précédent", "number", "14.5"), v("current", "Résultat actuel", "number", "10.5"), v("drop", "Écart", "number", "4")],
    manual: false,
    staffFacing: true,
  },
  {
    code: "teaching_load_alert",
    label: "Charge d'enseignement élevée",
    description: "Alerte l'administration lorsque la charge d'un enseignant dépasse le seuil.",
    category: "ALERT",
    variables: [v("staffName", "Enseignant", "string", "Mme Traoré"), v("hours", "Heures planifiées (année)", "number", "840"), v("threshold", "Seuil", "number", "800")],
    manual: false,
    staffFacing: true,
  },
  {
    code: "document_expiring",
    label: "Document ou qualification arrivant à échéance",
    description: "Alerte le personnel et les ressources humaines avant l'expiration d'un document.",
    category: "ALERT",
    variables: [v("staffName", "Membre du personnel", "string", "M. Diallo"), v("expiresOn", "Date d'expiration", "date", "2026-11-15"), v("daysLeft", "Jours restants", "number", "30")],
    manual: false,
    staffFacing: true,
  },
  {
    code: "payslip_available",
    label: "Bulletin de paie disponible",
    description: "Informe un membre du personnel que son bulletin de paie est disponible.",
    category: "ALERT",
    variables: [v("amount", "Montant net", "money", "250000 XOF", false)],
    manual: false,
    staffFacing: true,
  },
  {
    code: "reconciliation_needed",
    label: "Paiement ou remboursement à rapprocher (économat)",
    description: "Alerte interne : un paiement ou un remboursement ne peut plus être rapproché automatiquement et demande une action humaine. Ni nom d'élève ni message du fournisseur.",
    category: "ALERT",
    variables: [
      v("subject", "Nature (paiement ou remboursement)", "string", "paiement"),
      v("amount", "Montant", "money", "25000 XOF"),
      v("provider", "Fournisseur de paiement", "string", "orange_money", false),
      v("reason", "Motif (libellé neutre)", "string", "vérifications automatiques épuisées", false),
    ],
    manual: false,
    staffFacing: true,
  },
  {
    code: "stateassign_alert",
    label: "Alerte élèves affectés par l'État (économat, direction)",
    description: "Alerte interne : écart de rapprochement, créance de l'État en retard, contrôle à effectuer ou anomalie de contrôle. Aucun nom, aucune référence d'acte.",
    category: "ALERT",
    variables: [
      v("alertLabel", "Nature de l'alerte", "string", "Créance de l'État en retard"),
      v("dueDate", "Date d'échéance", "date", "2026-10-31", false),
      v("daysOverdue", "Jours de retard", "number", "12", false),
      v("amount", "Reste à recevoir", "money", "300000 XOF", false),
    ],
    manual: false,
    staffFacing: true,
  },
  {
    code: "analytics_alert",
    label: "Alerte de direction (indicateur hors seuil)",
    description: "Alerte interne : un indicateur de pilotage a franchi un seuil fixé par l'établissement. Libellé de l'indicateur, valeur et seuil ; aucun nom, aucune donnée d'élève.",
    category: "ALERT",
    variables: [
      v("alertLabel", "Nature de l'alerte", "string", "Alerte critique : Taux de présence des élèves"),
      v("currentValue", "Valeur mesurée", "string", "62,5 %"),
      v("thresholdValue", "Seuil franchi", "string", "70 %"),
      v("directionLabel", "Sens du dépassement", "string", "sous le seuil"),
    ],
    manual: false,
    staffFacing: true,
  },
  {
    code: "schoollife_convocation",
    label: "Convocation (vie scolaire)",
    description: "Informe les tuteurs d'une convocation de leur enfant. Texte neutre : jamais le motif disciplinaire.",
    category: "ANNOUNCEMENT",
    variables: [
      v("studentName", "Élève concerné", "string", "Awa Koné"),
      v("date", "Date", "date", "2026-10-09"),
      v("time", "Heure", "string", "09:30"),
      v("place", "Lieu", "string", "Bureau de la vie scolaire", false),
      v("statusLabel", "Précision d'état (ex. annulée)", "string", "annulée", false),
    ],
    manual: true,
  },
  {
    code: "schoollife_measure_notified",
    label: "Décision de vie scolaire notifiée",
    description: "Informe les tuteurs qu'une décision de vie scolaire concernant leur enfant est disponible dans l'application. Texte neutre : ni la nature de la mesure ni son motif.",
    category: "ANNOUNCEMENT",
    variables: [v("studentName", "Élève concerné", "string", "Awa Koné")],
    manual: true,
  },
  {
    code: "admissions_application_received",
    label: "Candidature reçue (accusé de réception)",
    description: "Accuse réception d'un dossier de candidature auprès du responsable du dossier. Aucun nom.",
    category: "ANNOUNCEMENT",
    variables: [],
    manual: false,
  },
  {
    code: "admissions_offer_issued",
    label: "Offre d'admission disponible",
    description: "Informe le responsable du dossier qu'une offre d'admission est disponible. Aucun nom, aucun motif de décision.",
    category: "ANNOUNCEMENT",
    variables: [],
    manual: false,
  },
  {
    code: "channel_test",
    label: "Message d'essai",
    description: "Vérifie qu'un canal fonctionne (envoyé à soi-même depuis la page des canaux).",
    category: "ALERT",
    variables: [],
    manual: false,
    staffFacing: true,
  },
]);

const BY_CODE: ReadonlyMap<string, CatalogEntry> = new Map(TEMPLATE_CATALOG.map((e) => [e.code, e]));

export const catalogEntry = (code: string): CatalogEntry | undefined => BY_CODE.get(code);

/** Toutes les variables utilisables par un gabarit : celles du catalogue et les intégrées. */
export function allVariables(entry: CatalogEntry): readonly NotifVariableDef[] {
  return [...entry.variables, ...BUILTIN_VARIABLES];
}

/** Garde-fou : le catalogue couvre exactement les codes du contrat. */
export const CATALOG_COMPLETE = NOTIF_TEMPLATE_CODES.every((c) => BY_CODE.has(c)) && TEMPLATE_CATALOG.length === NOTIF_TEMPLATE_CODES.length;
