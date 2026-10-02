import { defineModule } from "@ecoledigitale/kernel";
import { ALL_RULES_EVENT_TYPES } from "./domain/events";

/**
 * Module `rules` — catalogue national des règles académiques (RuleSet / RuleVersion / Rule), variantes d'établissement,
 * gouvernance (draft → simulated → proposed → approved → published → retired), épinglage de version par période,
 * simulation, évaluation reproductible (hash des entrées et des sorties) et contrats de chaînage versionnés en code
 * (`credit-semester@1`, `coef-semester@1`).
 *
 * SEUL module qui importe `@ecoledigitale/rules-engine` (règle dependency-cruiser `rules-engine-only-in-rules-module`).
 * Aucune constante réglementaire ou de seuil académique dans les autres modules : elle appartient à un RuleSet d'ici.
 * Socle CORE : toujours actif ; les fonctions payantes sont des features (variantes, éditeur d'expressions, simulation).
 *
 * `dependsOn: ["rbac"]` : les routes sont protégées par `requirePermission` du module rbac. Le catalogue national est
 * administré par le super-administrateur (JWT séparé, `SuperAdminAuthorizer` du runtime) sous `/api/v1/rules/platform/*`.
 */
export default defineModule({
  key: "rules",
  title: "Règles académiques",
  packs: ["CORE"],
  dependsOn: ["rbac", "audit"],
  permissions: [
    { key: "rules.ruleset.read", label: "Consulter les règles actives, leur historique et les contrats" },
    { key: "rules.version.create", label: "Créer une variante d'établissement à partir d'un jeu de règles national" },
    { key: "rules.version.edit", label: "Modifier les paramètres d'une variante en brouillon, la valider et tester une règle" },
    {
      key: "rules.version.edit_expression",
      label: "Modifier les expressions de calcul d'une variante",
      description: "Une expression modifiée change la façon dont les moyennes et les décisions sont calculées.",
      sensitive: true,
    },
    { key: "rules.version.simulate", label: "Lancer et consulter une simulation sur les données de l'établissement" },
    {
      key: "rules.version.propose",
      label: "Faire avancer une variante (simulation validée) et la proposer au super-administrateur",
      description: "Une variante proposée peut changer des décisions de passage : elle est toujours auditée.",
      sensitive: true,
    },
    {
      key: "rules.binding.manage",
      label: "Choisir le jeu de règles d'un programme, d'un niveau ou d'un établissement",
      description: "Détermine les règles appliquées aux périodes à venir.",
      sensitive: true,
    },
    {
      key: "rules.binding.accept_placeholder",
      label: "Accuser l'usage d'un jeu de règles de démonstration (fictif) en production",
      description: "Un jeu de démonstration n'a aucune valeur officielle : tout résultat, bulletin et PV qui en dérive porte le filigrane « règles de démonstration ».",
      sensitive: true,
    },
    {
      key: "rules.platform.manage",
      label: "Console plateforme : catalogue national, approbation, publication et retrait des règles",
      description: "Réservé aux opérateurs de la plateforme (authentification super-administrateur).",
      sensitive: true,
    },
  ],
  features: [
    { key: "rules.variants", label: "Variantes de règles par établissement", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "rules.expression-editor", label: "Éditeur d'expressions de calcul", packs: ["HIGHER"] },
    { key: "rules.simulation", label: "Simulation de l'impact d'une règle sur les données réelles", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
  ],
  menus: [
    { key: "rules.catalog", label: "Règles de calcul", href: "/admin/regles", permission: "rules.ruleset.read", portal: "admin", icon: "scale", order: 700 },
  ],
  events: {
    publishes: [...ALL_RULES_EVENT_TYPES],
    consumes: [],
  },
});
