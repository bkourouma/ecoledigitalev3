import { defineModule } from "@ecoledigitale/kernel";
import { ALL_HIGHER_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `higher` — enseignement supérieur à crédits (spec v2/019) : registre de crédits (capitalisation alimentée par les
 * résultats FINAL), prérequis entre UE, rattrapage (session 2), définitions de diplômes rattachées à un nœud de cycle,
 * octrois (automatique, manuel, forcé, révocation), documents officiels (snapshots immuables + empreinte), signataires à
 * emplacements DATÉS, compteurs de numérotation sans trou, dettes d'UE.
 *
 * Aucune formule ni seuil réglementaire : l'éligibilité au diplôme, la moyenne de cycle, la mention et l'état d'UE sont des
 * RuleSets (module rules, contrat `credit-semester@1`). Les références vers curriculum, inscriptions, étudiants, résultats
 * et signataires sont des UUID sans clé étrangère, vérifiés par des PORTS que fournissent academic, people, results et
 * reportcards (`registerHigherPorts`).
 *
 * `dependsOn: ["rbac", "rules"]` : `requirePermission` (rbac) et l'API d'évaluation de règles `app.rules` (rules). Les
 * autres voisins (academic, people, results, reportcards) passent par des ports, d'où aucune dépendance de manifeste
 * (pas de cycle).
 */
export default defineModule({
  key: "higher",
  title: "Enseignement supérieur",
  packs: ["HIGHER"],
  dependsOn: ["rbac", "rules"],
  permissions: [
    { key: "higher.diploma.read", label: "Consulter les définitions de diplômes, les candidats et la progression" },
    { key: "higher.diploma.manage", label: "Gérer les définitions de diplômes et leurs exigences" },
    { key: "higher.award.read", label: "Consulter les octrois de diplômes" },
    {
      key: "higher.award.create",
      label: "Octroyer un diplôme à un étudiant éligible, relancer l'évaluation",
      description: "Acte sensible : le diplôme est une donnée personnelle durable et un titre officiel.",
      sensitive: true,
    },
    {
      key: "higher.award.force",
      label: "Octroyer un diplôme à un étudiant non éligible, ou ré-octroyer un diplôme révoqué",
      description: "Acte sensible : motif obligatoire (20 caractères au moins), conservé sur l'octroi et audité ; authentification forte requise.",
      sensitive: true,
    },
    {
      key: "higher.award.revoke",
      label: "Révoquer un diplôme ou un document officiel",
      description: "Acte sensible et terminal : motif obligatoire, les documents émis passent « révoqué ».",
      sensitive: true,
    },
    { key: "higher.document.issue", label: "Émettre diplômes et attestations", description: "Acte sensible : document officiel signé.", sensitive: true },
    { key: "higher.document.read", label: "Consulter les documents officiels" },
    { key: "higher.credits.read", label: "Consulter le registre de crédits, les dettes et les prérequis d'un étudiant" },
    { key: "higher.prerequisite.manage", label: "Gérer les prérequis entre UE" },
    { key: "higher.resit.manage", label: "Gérer les fenêtres et les candidats de rattrapage" },
    {
      key: "higher.slot.manage",
      label: "Affecter les signataires des documents officiels",
      description: "Acte sensible : le signataire en vigueur figure sur chaque document émis.",
      sensitive: true,
    },
    { key: "higher.settings.manage", label: "Gérer les réglages (durée de validité des crédits)" },
    { key: "higher.self.read", label: "Consulter son propre parcours, ses diplômes et ses documents publiés (étudiant)" },
    { key: "higher.child.read", label: "Consulter le parcours et les diplômes de ses enfants (parent)" },
  ],
  features: [
    { key: "higher.diplomas", label: "Diplômes et documents officiels", packs: ["HIGHER"] },
    { key: "higher.session2", label: "Rattrapage (session 2)", packs: ["HIGHER"] },
    { key: "higher.prerequisites", label: "Prérequis entre UE", packs: ["HIGHER"] },
    { key: "higher.attestations", label: "Attestations de réussite", packs: ["HIGHER"] },
  ],
  menus: [
    { key: "higher.diplomas", label: "Diplômes", href: "/admin/higher/diplomes", permission: "higher.diploma.read", feature: "higher.diplomas", portal: "admin", icon: "graduation-cap", order: 400 },
    { key: "higher.documents", label: "Documents officiels", href: "/admin/higher/documents", permission: "higher.document.read", feature: "higher.diplomas", portal: "admin", icon: "file-badge", order: 410 },
    { key: "higher.resit", label: "Rattrapages", href: "/admin/higher/rattrapages", permission: "higher.resit.manage", feature: "higher.session2", portal: "admin", icon: "repeat", order: 420 },
    { key: "higher.prerequisites", label: "Prérequis", href: "/admin/higher/prerequis", permission: "higher.prerequisite.manage", feature: "higher.prerequisites", portal: "admin", icon: "git-branch", order: 430 },
    { key: "higher.signatories", label: "Signataires", href: "/admin/higher/signataires", permission: "higher.slot.manage", feature: "higher.diplomas", portal: "admin", icon: "pen-line", order: 440 },
    { key: "higher.pathway", label: "Mon parcours", href: "/student/higher", permission: "higher.self.read", portal: "student", icon: "route", order: 400 },
    { key: "higher.child", label: "Parcours de mon enfant", href: "/parent/higher", permission: "higher.child.read", portal: "parent", icon: "route", order: 400 },
  ],
  events: {
    publishes: [...ALL_HIGHER_EVENT_TYPES],
    consumes: [ConsumedEvents.RESULTS_PERIOD_CLOSED, ConsumedEvents.CREDITS_CAPITALIZED],
  },
});
