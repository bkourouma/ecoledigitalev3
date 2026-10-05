import { defineModule } from "@ecoledigitale/kernel";
import { ALL_PRIMARY_EVENT_TYPES, ConsumedEvents, PrimaryEvents } from "./domain/events";

/**
 * Module `primary_school` — pack Primary (spec v2/005) : évaluation par compétences (maternelle sans note, primaire), banque
 * d'appréciations, conseil des maîtres (dossier et présence, sur `results.deliberations` / `decisions`), bilan annuel SCELLÉ et versionné,
 * archive d'année gelable, états du primaire.
 *
 * Le pack Primary est une COMPOSITION des modules existants (academic, assess, results, rules, reportcards, attendance, finance, people) :
 * `primary_school` ne calcule ni moyenne, ni rang, ni décision de passage ; il porte des DONNÉES pédagogiques (compétences, appréciations),
 * des JOURNAUX (révisions, présence au conseil) et des INSTANTANÉS (bilan, archive). Aucune règle réglementaire n'y figure : le RuleSet
 * primaire est le jeu FICTIF `CI-PRIMARY-PLACEHOLDER` (`source_kind = placeholder`, filigrane « règles de démonstration »).
 *
 * Les références vers classes, périodes, inscriptions, élèves, personnel, délibérations, décisions et documents sont des UUID sans clé
 * étrangère, vérifiés par des PORTS (`registerPrimarySchoolPorts`) : d'où `dependsOn: ["rbac"]` seulement (garde de permission).
 */
export default defineModule({
  key: "primary_school",
  title: "Pack Primaire",
  packs: ["PRIMARY"],
  dependsOn: ["rbac"],
  permissions: [
    { key: "primary.settings.manage", label: "Gérer les paramètres du primaire (titulaire exigé, conseil exigé, conservation)" },
    { key: "primary.scale.manage", label: "Gérer les échelles d'appréciation (niveaux de maîtrise)" },
    { key: "primary.framework.read", label: "Consulter les référentiels de compétences" },
    { key: "primary.framework.manage", label: "Créer et modifier les référentiels de compétences (brouillons)" },
    { key: "primary.framework.publish", label: "Publier un référentiel de compétences ou créer sa version suivante", description: "Un référentiel publié devient immuable : la publication est un acte durable." },
    { key: "primary.competency.read", label: "Consulter les grilles de compétences des classes dont on a la charge" },
    { key: "primary.competency.record", label: "Saisir les niveaux de maîtrise des élèves (maternelle et primaire)" },
    { key: "primary.competency.validate", label: "Valider la grille de compétences d'une classe pour une période, la marquer « prête » pour les familles (Q-P18) ou retirer ce marquage" },
    {
      key: "primary.competency.revise",
      label: "Réviser une appréciation de compétence validée",
      description: "Acte sensible : motif obligatoire (10 caractères au moins), trace conservée dans la même transaction ; authentification forte requise.",
      sensitive: true,
    },
    { key: "primary.competency.child.read", label: "Consulter les compétences de ses enfants (parent), une fois la période prête, validée ou le bulletin publié (Q-P18)" },
    { key: "primary.competency.self.read", label: "Consulter ses propres compétences (élève), une fois la période prête, validée ou le bulletin publié (Q-P18)" },
    { key: "primary.phrase.read", label: "Consulter la banque d'appréciations" },
    { key: "primary.phrase.manage", label: "Gérer la banque d'appréciations" },
    { key: "primary.council.read", label: "Consulter les dossiers du conseil des maîtres" },
    { key: "primary.council.prepare", label: "Préparer les dossiers du conseil de sa classe (propositions, notes)" },
    { key: "primary.council.manage", label: "Présider le conseil : présence, décisions, procès-verbal" },
    { key: "primary.bilan.read", label: "Consulter les bilans annuels" },
    { key: "primary.bilan.prepare", label: "Préparer les brouillons de bilan annuel d'une classe" },
    {
      key: "primary.bilan.seal",
      label: "Sceller un bilan annuel",
      description: "Acte sensible : le bilan devient immuable (empreinte, décision, compétences) ; authentification forte requise.",
      sensitive: true,
    },
    {
      key: "primary.bilan.reissue",
      label: "Réémettre un bilan annuel scellé (version suivante)",
      description: "Acte sensible : motif obligatoire ; l'ancienne version est remplacée.",
      sensitive: true,
    },
    { key: "primary.bilan.child.read", label: "Consulter le bilan annuel de ses enfants (parent), scellé et publié" },
    { key: "primary.bilan.self.read", label: "Consulter son propre bilan annuel (élève), scellé et publié" },
    { key: "primary.archive.prepare", label: "Préparer l'archive d'une année (manifeste, bilans)" },
    {
      key: "primary.archive.freeze",
      label: "Geler l'archive d'une année",
      description: "Acte sensible et IRRÉVERSIBLE : plus aucun bilan de l'année ne peut être écrit.",
      sensitive: true,
    },
    { key: "primary.report.read", label: "Consulter les états et rapports du primaire" },
    {
      key: "primary.template.apply",
      label: "(Ré)instancier le modèle de pack Primaire",
      description: "Acte sensible : crée les échelles, référentiels de démonstration et phrases de l'établissement (jamais d'écrasement).",
      sensitive: true,
    },
    { key: "primary.class.read_all", label: "Accéder à toutes les classes du primaire (direction, secrétariat)", description: "Sans cette permission, un instituteur n'accède qu'aux classes auxquelles il est affecté." },
  ],
  features: [
    { key: "primary.competencies", label: "Évaluation par compétences", packs: ["PRIMARY"] },
    { key: "primary.council", label: "Conseil des maîtres", packs: ["PRIMARY"] },
    { key: "primary.annual-review", label: "Bilan annuel scellé", packs: ["PRIMARY"] },
    { key: "primary.year-archive", label: "Archive d'année", packs: ["PRIMARY"] },
    { key: "primary.reports", label: "États et rapports du primaire", packs: ["PRIMARY"] },
  ],
  menus: [
    { key: "primary.my-class", label: "Ma classe", href: "/v2/primary/classe", permission: "primary.competency.record", feature: "primary.competencies", portal: "teacher", icon: "users", order: 300 },
    { key: "primary.competencies", label: "Compétences", href: "/v2/primary/competences", permission: "primary.competency.record", feature: "primary.competencies", portal: "teacher", icon: "check-square", order: 310 },
    { key: "primary.phrases", label: "Appréciations", href: "/v2/primary/appreciations", permission: "primary.phrase.read", feature: "primary.competencies", portal: "teacher", icon: "message-square", order: 320 },
    { key: "primary.council-teacher", label: "Conseil des maîtres", href: "/v2/primary/conseil", permission: "primary.council.prepare", feature: "primary.council", portal: "teacher", icon: "gavel", order: 330 },
    { key: "primary.direction", label: "Pack Primaire", href: "/v2/primary/direction", permission: "primary.class.read_all", feature: "primary.competencies", portal: "admin", icon: "school", order: 300 },
    { key: "primary.council-admin", label: "Conseil des maîtres", href: "/v2/primary/conseil", permission: "primary.council.manage", feature: "primary.council", portal: "admin", icon: "gavel", order: 310 },
    { key: "primary.reviews", label: "Bilans annuels", href: "/v2/primary/bilans", permission: "primary.bilan.read", feature: "primary.annual-review", portal: "admin", icon: "file-badge", order: 320 },
    { key: "primary.archives", label: "Archives d'année", href: "/v2/primary/archives", permission: "primary.archive.prepare", feature: "primary.year-archive", portal: "admin", icon: "archive", order: 330 },
    { key: "primary.reports", label: "États du primaire", href: "/v2/primary/etats", permission: "primary.report.read", feature: "primary.reports", portal: "admin", icon: "bar-chart", order: 340 },
    { key: "primary.child", label: "Bulletin et compétences de mon enfant", href: "/v2/primary/mon-enfant", permission: "primary.bilan.child.read", feature: "primary.annual-review", portal: "parent", icon: "award", order: 300 },
  ],
  events: {
    publishes: [...ALL_PRIMARY_EVENT_TYPES],
    consumes: [
      ConsumedEvents.INSTITUTION_CREATED,
      ConsumedEvents.CLASSROOM_PERIOD_GRADING_CLOSED,
      ConsumedEvents.CLASSROOM_PERIOD_CLOSED,
      ConsumedEvents.CLASSROOM_PERIOD_REOPENED,
      ConsumedEvents.DECISION_CONFIRMED,
      ConsumedEvents.OFFICIAL_DOCUMENT_RENDERED,
      // Abonné du module à son propre événement : le PDF du bilan est demandé hors de la transaction de scellement.
      PrimaryEvents.ANNUAL_REVIEW_SEALED,
    ],
  },
});
