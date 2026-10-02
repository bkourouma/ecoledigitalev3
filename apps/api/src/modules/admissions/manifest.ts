import { defineModule } from "@ecoledigitale/kernel";
import { ALL_ADMISSIONS_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `admissions` — du prospect à l'élève inscrit (spec v2/007-admissions, PRD §9).
 *
 * Il possède le DOSSIER de candidature et ses DÉCISIONS, et orchestre — par des ports et des événements, jamais par le schéma SQL
 * d'un autre module — `people` (élève INACTIF, tuteurs, doublons), `academic` (inscription PENDING, confirmée par ELLE après paiement),
 * `finance` (facture des frais d'inscription), `documents` (pièces) et le canal de notification (échec fermé sans canal).
 *
 * Workflow PERSONNALISABLE par établissement : des ÉTAPES (donnée) rattachées aux HUIT statuts canoniques (contrat stable des
 * événements et statistiques) ; statut dérivé de l'étape ; workflow validé à la publication puis FIGÉ. Décision formelle
 * journalisée dans la même transaction que le changement d'étape (ajout seul). Capacités par niveau (verrou de ligne : une seule
 * admission sur la dernière place), liste d'attente prioritaire, formulaire public protégé (seule table globale :
 * `public_form_index`), doublons, anonymisation des dossiers clos sans inscription.
 *
 * Aucune règle réglementaire n'est codée : capacités, priorités, durée d'une offre, pièces exigées, délai de paiement, durée de
 * conservation, âge d'entrée sont des DONNÉES ou politiques d'établissement (valeurs vides = aucune règle).
 *
 * `dependsOn: []` : aucun import direct d'un autre module ; le câblage est dans `platform/adapters/admissions-*.ts`.
 */
export default defineModule({
  key: "admissions",
  title: "Admissions",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: [],
  permissions: [
    { key: "admission.read", label: "Consulter les candidatures, le tableau d'admission et les rapports de son périmètre" },
    { key: "admission.create", label: "Créer une candidature (secrétariat) et la soumettre" },
    { key: "admission.update", label: "Modifier un dossier, demander des pièces, faire avancer l'étude" },
    { key: "admission.decide", label: "Décider d'une candidature : admis, refusé, liste d'attente, retrait" },
    {
      key: "admission.capacity.override",
      label: "Admettre au-delà de la capacité d'un niveau (politique SOFT, motif obligatoire)",
      description: "Acte tracé : motif d'au moins 10 caractères, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "admission.workflow.manage", label: "Éditer un brouillon de workflow d'admission (étapes, transitions)" },
    {
      key: "admission.workflow.publish",
      label: "Publier un workflow d'admission (il devient figé)",
      description: "Une version publiée ne se modifie plus : acte audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "admission.campaign.manage", label: "Gérer les campagnes d'admission, leur ouverture et leurs capacités" },
    { key: "admission.settings.manage", label: "Gérer les paramètres, le lien public, les motifs, les pièces exigées et les textes de consentement" },
    { key: "admission.prospect.manage", label: "Gérer les prospects et les convertir en candidatures" },
    { key: "admission.document.upload", label: "Déposer une pièce justificative au nom de la famille" },
    { key: "admission.document.review", label: "Relire, accepter ou rejeter une pièce justificative (lecture auditée)" },
    {
      key: "admission.document.attach",
      label: "Rattacher les pièces d'un dossier inscrit au dossier permanent de l'élève (GED)",
      description: "Exige aussi le droit de dépôt de la GED (documents.upload) : la personne qui confirme devient le déposant dans l'historique de la GED.",
    },
    { key: "admission.interview.manage", label: "Planifier un test ou un entretien et saisir son résultat" },
    { key: "admission.offer.manage", label: "Émettre, retirer une offre d'admission ; accepter au nom de la famille (pièce justificative)" },
    { key: "admission.duplicate.resolve", label: "Trancher les rapprochements de doublons" },
    { key: "admission.waitlist.manage", label: "Consulter la liste d'attente et proposer une place libérée" },
    { key: "admission.enroll", label: "Franchir l'étape qui crée l'inscription (acceptation de l'offre)" },
    {
      key: "admission.anonymize",
      label: "Anonymiser un dossier clos sans inscription (droit à l'effacement)",
      description: "Irréversible : motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "admission.export", label: "Exporter le dossier d'un candidat (droit d'accès)" },
    { key: "admission.report.read", label: "Consulter les tableaux de bord de recrutement" },
  ],
  features: [
    { key: "admissions.core", label: "Admissions : candidatures, workflow, décisions, offres, inscription", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "admissions.public-form", label: "Formulaire public de candidature par établissement", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "admissions.waitlist", label: "Liste d'attente avec priorités et promotion", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "admissions.interviews", label: "Tests et entretiens d'admission", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
  ],
  menus: [
    { key: "admissions.pipeline", label: "Admissions", href: "/v2/admissions", permission: "admission.read", feature: "admissions.core", portal: "admin", icon: "user-plus", order: 700 },
    { key: "admissions.list", label: "Candidatures", href: "/v2/admissions/applications", permission: "admission.read", feature: "admissions.core", portal: "admin", icon: "list", order: 710 },
    { key: "admissions.prospects", label: "Prospects", href: "/v2/admissions/prospects", permission: "admission.prospect.manage", feature: "admissions.core", portal: "admin", icon: "users", order: 720 },
    { key: "admissions.waitlist", label: "Listes d'attente", href: "/v2/admissions/waitlist", permission: "admission.waitlist.manage", feature: "admissions.waitlist", portal: "admin", icon: "clock", order: 730 },
    { key: "admissions.campaigns", label: "Campagnes d'admission", href: "/v2/admissions/campaigns", permission: "admission.campaign.manage", feature: "admissions.core", portal: "admin", icon: "calendar", order: 740 },
    { key: "admissions.workflow", label: "Parcours d'admission", href: "/v2/admissions/workflow", permission: "admission.workflow.manage", feature: "admissions.core", portal: "admin", icon: "workflow", order: 750 },
    { key: "admissions.reports", label: "Recrutement : tableaux de bord", href: "/v2/admissions/reports", permission: "admission.report.read", feature: "admissions.core", portal: "admin", icon: "chart", order: 760 },
    { key: "admissions.settings", label: "Paramètres des admissions", href: "/v2/admissions/settings", permission: "admission.settings.manage", feature: "admissions.core", portal: "admin", icon: "settings", order: 770 },
  ],
  events: {
    publishes: [...ALL_ADMISSIONS_EVENT_TYPES],
    consumes: [ConsumedEvents.ENROLLMENT_CONFIRMED, ConsumedEvents.ENROLLMENT_CANCELLED, ConsumedEvents.ENROLLMENT_WITHDRAWN, ConsumedEvents.INSTITUTION_CREATED],
  },
});
