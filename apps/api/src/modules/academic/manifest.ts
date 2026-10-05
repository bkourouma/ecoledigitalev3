import { defineModule } from "@ecoledigitale/kernel";
import { ALL_ACADEMIC_EVENT_TYPES, ALL_CONSUMED_EVENT_TYPES } from "./domain/events";

/**
 * Module `academic` — cœur académique unique des quatre packs : années académiques, périodes TYPÉES configurables,
 * programmes et séries, curriculum polymorphe versionné (nœuds SUBJECT, UE, ECUE… = données), classes et promotions,
 * inscriptions qui historisent (financement, affectation, mode classe ou à la carte, confirmation à deux niveaux),
 * offres de cours, registre d'inscriptions aux cours, registre des numéros d'inscription.
 *
 * `dependsOn: ["rbac", "tenancy"]` : routes protégées par `requirePermission` (rbac) ; l'établissement et le campus
 * viennent de tenancy. Le module ne dépend PAS de `people`, `finance`, `scheduling`, `assess` : ce sont des PORTS
 * (`application/ports.ts`) branchés au câblage et des événements.
 *
 * Aucune constante réglementaire : niveaux, types de périodes, grammaire du curriculum, types de financement et
 * issues d'année sont des DONNÉES instanciées depuis les modèles de pack (`templates/<système>/<pack>.json`).
 */
export default defineModule({
  key: "academic",
  title: "Cœur académique",
  packs: ["CORE"],
  dependsOn: ["rbac", "tenancy"],
  permissions: [
    { key: "academic.read", label: "Consulter les référentiels et la structure académique" },
    { key: "academic.year.read", label: "Consulter les années académiques" },
    { key: "academic.year.manage", label: "Gérer les années académiques", description: "Crée, modifie, ouvre et archive les années ; définit l'année courante." },
    {
      key: "academic.year.close",
      label: "Clôturer une année académique",
      description: "Fige l'année : périodes closes, curriculums verrouillés.",
      sensitive: true,
    },
    {
      key: "academic.year.rollover",
      label: "Reconduire une année vers la suivante",
      description: "Crée les classes et les inscriptions de l'année suivante depuis les issues de fin d'année.",
      sensitive: true,
    },
    { key: "academic.period.read", label: "Consulter les périodes" },
    { key: "academic.period.manage", label: "Gérer les périodes et appliquer un plan de périodes" },
    { key: "academic.period.close", label: "Clore les notes ou les résultats d'une période (ou d'une classe)" },
    {
      key: "academic.period.reopen",
      label: "Rouvrir une période close",
      description: "Retour d'un pas en arrière, motivé : les notes redeviennent modifiables.",
      sensitive: true,
    },
    { key: "academic.program.read", label: "Consulter les programmes et niveaux" },
    { key: "academic.program.manage", label: "Gérer les programmes et les niveaux couverts" },
    { key: "academic.classroom.read", label: "Consulter les classes et les offres" },
    { key: "academic.classroom.manage", label: "Gérer les classes et les offres de cours" },
    { key: "academic.settings.manage", label: "Gérer les paramètres académiques et les référentiels" },
    {
      key: "academic.template.apply",
      label: "Appliquer un modèle de pack",
      description: "Instancie les référentiels d'un établissement depuis le modèle de son pack.",
      sensitive: true,
    },
    { key: "curriculum.read", label: "Consulter les curriculums et le catalogue de matières" },
    { key: "curriculum.manage", label: "Éditer les curriculums et le catalogue de matières" },
    { key: "curriculum.publish", label: "Publier un curriculum" },
    {
      key: "curriculum.amend",
      label: "Amender un curriculum publié",
      description: "Coefficients, crédits, structure d'une version publiée : motif obligatoire, journalisé.",
      sensitive: true,
    },
    { key: "enrollment.read", label: "Consulter les inscriptions" },
    { key: "enrollment.create", label: "Inscrire un apprenant" },
    { key: "enrollment.update", label: "Confirmer, suspendre, transférer une inscription" },
    { key: "enrollment.cancel", label: "Retirer ou annuler une inscription" },
    {
      key: "enrollment.confirm.override",
      label: "Confirmer une inscription sans paiement (dérogation de la direction)",
      description: "Décision O-01 : une inscription est confirmée par le paiement des frais OU manuellement. Confirmer à la main une inscription dont la politique attend le paiement exige cette permission et un motif ; le tout est tracé (historique, événement, audit sensible).",
      sensitive: true,
    },
    {
      key: "enrollment.override",
      label: "Déroger à l'éligibilité d'une offre",
      description: "Fenêtre, période close ou prérequis : dérogation motivée. La capacité n'est jamais dépassable.",
      sensitive: true,
    },
    { key: "enrollment.self.create", label: "S'inscrire soi-même à une offre ouverte (libre-service)" },
    {
      key: "enrollment.funding.update",
      label: "Changer le financement d'une inscription",
      description: "Type de financement, référence d'affectation, financeur.",
      sensitive: true,
    },
    { key: "enrollment.outcome.record", label: "Enregistrer l'issue de fin d'année d'une inscription" },
    { key: "enrollment.course.manage", label: "Gérer les sélections de cours d'une inscription" },
    { key: "enrollment.self.read", label: "Consulter mes inscriptions" },
    { key: "enrollment.child.read", label: "Consulter les inscriptions de mes enfants" },
  ],
  features: [
    { key: "academic.a-la-carte", label: "Inscription à la carte (offres, prérequis, capacité)", packs: ["HIGHER"] },
    { key: "academic.state-assigned", label: "Élèves affectés par l'État (référence d'affectation)", packs: ["SECONDARY"] },
    { key: "academic.rollover", label: "Reconduction annuelle des inscriptions", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
  ],
  menus: [
    { key: "academic.years", label: "Années et périodes", href: "/admin/academique/annees", permission: "academic.year.read", portal: "admin", icon: "calendar", order: 100 },
    { key: "academic.programs", label: "Programmes et niveaux", href: "/admin/academique/programmes", permission: "academic.program.read", portal: "admin", icon: "graduation-cap", order: 110 },
    { key: "academic.curriculum", label: "Curriculum", href: "/admin/academique/curriculum", permission: "curriculum.read", portal: "admin", icon: "list-tree", order: 120 },
    { key: "academic.classrooms", label: "Classes", href: "/admin/academique/classes", permission: "academic.classroom.read", portal: "admin", icon: "users", order: 130 },
    { key: "academic.offerings", label: "Offres de cours", href: "/admin/academique/offres", permission: "academic.classroom.manage", feature: "academic.a-la-carte", portal: "admin", icon: "layers", order: 140 },
    { key: "academic.enrollments", label: "Inscriptions", href: "/admin/academique/inscriptions", permission: "enrollment.read", portal: "admin", icon: "user-plus", order: 150 },
    { key: "academic.rollover", label: "Reconduction annuelle", href: "/admin/academique/reconduction", permission: "academic.year.rollover", feature: "academic.rollover", portal: "admin", icon: "repeat", order: 160 },
    { key: "academic.settings", label: "Paramètres académiques", href: "/admin/academique/parametres", permission: "academic.settings.manage", portal: "admin", icon: "settings", order: 170 },
    { key: "academic.catalog", label: "Catalogue des cours", href: "/etudiant/catalogue", permission: "enrollment.self.create", feature: "academic.a-la-carte", portal: "student", icon: "book-open", order: 100 },
    { key: "academic.my-enrollments", label: "Mes inscriptions", href: "/etudiant/inscriptions", permission: "enrollment.self.read", portal: "student", icon: "clipboard-list", order: 110 },
    { key: "academic.children-enrollments", label: "Inscriptions de mon enfant", href: "/parent/inscriptions", permission: "enrollment.child.read", portal: "parent", icon: "clipboard-list", order: 100 },
  ],
  events: {
    publishes: [...ALL_ACADEMIC_EVENT_TYPES],
    consumes: [...ALL_CONSUMED_EVENT_TYPES],
  },
});
