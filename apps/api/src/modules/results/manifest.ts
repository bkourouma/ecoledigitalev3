import { defineModule } from "@ecoledigitale/kernel";
import { ALL_RESULTS_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `results` — résultats calculés, décisions, délibérations, clôture de période (spec v2/011).
 *
 * Les moyennes, crédits, rangs, mentions et décisions sont CALCULÉS par le module `rules` (contrats `credit-semester@1`
 * et `coef-semester@1`) à partir des seules notes PUBLIÉES du module `assess` : ce module orchestre (contexte typé,
 * chaînage des règles, version de règle ÉPINGLÉE, empreintes d'entrées / sorties, trace d'explicabilité) et ne contient
 * AUCUNE formule ni AUCUN seuil. Les résultats FINAL sont immuables (application ET déclencheurs) ; une correction
 * passe par une réouverture motivée et crée une version supérieure. Références au cœur par UUID sans clé étrangère,
 * via des PORTS (`CurriculumPort`, `RosterPort`, `GuardianshipPort`) fournis par academic et people.
 */
export default defineModule({
  key: "results",
  title: "Résultats et clôture de période",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: ["assess", "rules"],
  permissions: [
    { key: "result.read", label: "Consulter les résultats calculés" },
    { key: "result.explain", label: "Consulter la trace d'explicabilité d'un résultat", description: "Montre les valeurs intermédiaires de chaque règle appliquée." },
    { key: "result.recompute", label: "Relancer le calcul des résultats d'une classe" },
    { key: "result.override.request", label: "Demander la surcharge justifiée d'une valeur calculée ou d'une validation" },
    { key: "result.override.approve", label: "Approuver, rejeter ou révoquer une surcharge", description: "Modifie un résultat sans modifier les notes : acte sensible, audité.", sensitive: true },
    { key: "result.settings.manage", label: "Gérer les réglages des résultats (délibération obligatoire, temporisation)", sensitive: true },
    { key: "period.lock", label: "Verrouiller les notes d'une période", description: "Plus aucune note ne peut être saisie ni publiée pour la classe et la période.", sensitive: true },
    { key: "period.close", label: "Clôturer une période", description: "Produit les résultats finaux immuables : acte sensible.", sensitive: true },
    { key: "period.repin", label: "Changer la version de règle d'une période ouverte", sensitive: true },
    { key: "period.reopen", label: "Rouvrir une période clôturée", description: "Crée une nouvelle version des résultats : acte sensible, motif obligatoire.", sensitive: true },
    { key: "decision.record", label: "Enregistrer les délibérations et confirmer les décisions proposées" },
    { key: "decision.approve", label: "Modifier une décision proposée par la règle", description: "Une décision différente de la proposition exige une justification.", sensitive: true },
    { key: "appreciation.write", label: "Rédiger les appréciations de matière et du conseil" },
    { key: "result.self.read", label: "Consulter ses propres résultats finalisés (élève)" },
    { key: "result.child.read", label: "Consulter les résultats finalisés de ses enfants (parent)" },
  ],
  features: [
    { key: "results.deliberation", label: "Délibérations de conseil de classe et de jury", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "results.public-visibility", label: "Résultats visibles des familles après clôture", packs: ["PRIMARY", "SECONDARY", "HIGHER"] },
  ],
  menus: [
    { key: "results.class", label: "Résultats de classe", href: "/admin/resultats", permission: "result.read", portal: "admin", icon: "table", order: 440 },
    { key: "results.periods", label: "Périodes : verrouillage et clôture", href: "/admin/periodes", permission: "period.lock", portal: "admin", icon: "lock", order: 450 },
    { key: "results.deliberations", label: "Délibérations", href: "/admin/deliberations", permission: "decision.record", feature: "results.deliberation", portal: "admin", icon: "gavel", order: 460 },
    { key: "results.child", label: "Résultats de mes enfants", href: "/parent/resultats", permission: "result.child.read", feature: "results.public-visibility", portal: "parent", icon: "award", order: 410 },
    { key: "results.self", label: "Mes résultats", href: "/student/resultats", permission: "result.self.read", feature: "results.public-visibility", portal: "student", icon: "award", order: 410 },
  ],
  events: {
    publishes: [...ALL_RESULTS_EVENT_TYPES],
    consumes: [ConsumedEvents.GRADE_PUBLISHED, ConsumedEvents.GRADE_REVISED, ConsumedEvents.ASSESSMENT_CANCELLED, ConsumedEvents.ENROLLMENT_CREATED, ConsumedEvents.ENROLLMENT_TRANSFERRED, ConsumedEvents.ENROLLMENT_WITHDRAWN, ConsumedEvents.RULES_BINDING_CHANGED],
  },
});
