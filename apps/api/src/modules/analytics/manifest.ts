import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EVENT_TYPES, CONSUMED_EVENT_PATTERNS } from "./domain/events";

/**
 * Module `analytics` — read-models de direction et du propriétaire (spec v2/025) : effectifs, présences, résultats FINAL,
 * scolarité, trésorerie, paie, charge d'enseignement, avec fraîcheur (`asOf`) explicite. Il ne contient AUCUNE donnée
 * source ni formule : des instantanés dérivés des événements des autres modules (consommateurs `subscribers.ts` ->
 * file de rafraîchissement -> lecture des sources par des ports), reconstructibles à l'identique (`analytics.rebuild`).
 * Socle CORE (les permissions existent partout) ; la fonctionnalité vendable est `analytics.direction`.
 */
export default defineModule({
  key: "analytics",
  title: "Pilotage de direction et du propriétaire",
  packs: ["CORE"],
  dependsOn: [],
  permissions: [
    { key: "analytics.read", label: "Consulter la vue d'ensemble de la direction, les effectifs et les admissions" },
    { key: "analytics.pedagogy.read", label: "Consulter les résultats agrégés par classe, matière et période, et la charge d'enseignement" },
    { key: "analytics.attendance.read", label: "Consulter les présences et l'assiduité (élèves et personnel)" },
    { key: "analytics.finance.read", label: "Consulter la scolarité : facturé, encaissé, restant dû, créances par classe et par apprenant" },
    { key: "analytics.treasury.read", label: "Consulter la trésorerie : encaissements, créances âgées, écarts de caisse" },
    {
      key: "analytics.payroll.read",
      label: "Consulter la masse salariale par période",
      description: "Données de paie : exige l'authentification forte et chaque lecture est auditée.",
      sensitive: true,
    },
    { key: "analytics.charges.read", label: "Consulter les charges et le compte de résultat" },
    { key: "analytics.export", label: "Exporter les tableaux de bord en CSV", description: "S'ajoute à la permission du jeu de données exporté ; chaque export est audité." },
    { key: "analytics.settings.manage", label: "Régler les seuils de lecture et le délai de fraîcheur des tableaux de bord" },
    { key: "analytics.rebuild", label: "Demander la reconstruction des tableaux de bord depuis les sources" },
  ],
  features: [
    { key: "analytics.direction", label: "Tableaux de bord de la direction et du propriétaire", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
    { key: "analytics.payroll-insights", label: "Masse salariale dans les tableaux de bord", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] },
  ],
  menus: [
    { key: "analytics.dashboard", label: "Tableau de bord de la direction", href: "/v2/direction", permission: "analytics.read", feature: "analytics.direction", portal: "owner", icon: "layout-dashboard", order: 10 },
    { key: "analytics.enrollment", label: "Effectifs et présences", href: "/v2/direction/effectifs", permission: "analytics.read", feature: "analytics.direction", portal: "owner", icon: "users", order: 20 },
    { key: "analytics.pedagogy", label: "Pédagogie", href: "/v2/owner/pedagogie", permission: "analytics.pedagogy.read", feature: "analytics.direction", portal: "owner", icon: "graduation-cap", order: 30 },
    { key: "analytics.tuition", label: "Scolarité", href: "/v2/owner/scolarite", permission: "analytics.finance.read", feature: "analytics.direction", portal: "owner", icon: "receipt", order: 40 },
    { key: "analytics.treasury", label: "Trésorerie", href: "/v2/owner/tresorerie", permission: "analytics.treasury.read", feature: "analytics.direction", portal: "owner", icon: "wallet", order: 50 },
    { key: "analytics.payroll", label: "Masse salariale", href: "/v2/owner/paie", permission: "analytics.payroll.read", feature: "analytics.payroll-insights", portal: "owner", icon: "banknote", order: 60 },
    { key: "analytics.charges", label: "Charges et résultat", href: "/v2/owner/charges", permission: "analytics.charges.read", feature: "analytics.direction", portal: "owner", icon: "scale", order: 70 },
  ],
  events: {
    publishes: [...ALL_EVENT_TYPES],
    consumes: [...CONSUMED_EVENT_PATTERNS],
  },
});
