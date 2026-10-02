import { defineModule } from "@ecoledigitale/kernel";
import { ALL_STATEASSIGN_EVENT_TYPES } from "./domain/events";

/**
 * Module `stateassign` — élèves affectés par l'État (`STATE_ASSIGNED`, spec v2/006-secondary US10, PRD §20).
 *
 * Dossier d'affectation VERSIONNÉ par inscription (un avenant remplace puis crée la version n+1), VÉRIFIÉ par un humain (jamais
 * automatiquement : imposé par la base), montants déclarés État / parent en entiers (jamais de flottant), statut de rapprochement
 * CALCULÉ par la base, créances sur l'État (échéances, retards, rapprochement des paiements reçus chez `finance`), contrôles
 * (faits de présence fournis par `attendance`), pièces (références vers `documents`), exports pour l'administration (formats en
 * données) et passerelle future vers une plateforme publique derrière le port `StateGateway` (adaptateur `NotConfigured` :
 * aucun appel externe en V1).
 *
 * Aucune règle officielle, aucun barème : tolérance de rapprochement, délai de grâce, contrôles exigés sont des réglages
 * d'établissement, vides ou à zéro par défaut (`specs/v2/006-secondary/open-questions.md`, section stateassign).
 *
 * Élèves, inscriptions, factures, paiements, présences et documents sont des UUID sans clé étrangère, lus par des PORTS que fournit
 * la plateforme (`platform/adapters`) : d'où `dependsOn: []`. Le module échoue FERMÉ (`stateassign.port_unavailable`) tant qu'un
 * port requis manque.
 */
export default defineModule({
  key: "stateassign",
  title: "Élèves affectés par l'État",
  packs: ["SECONDARY"],
  dependsOn: [],
  permissions: [
    { key: "stateassign.read", label: "Consulter les dossiers d'affectation, les créances et les contrôles" },
    { key: "stateassign.record", label: "Enregistrer et corriger un dossier d'affectation (avant vérification)" },
    {
      key: "stateassign.verify",
      label: "Vérifier ou rejeter un dossier d'affectation",
      description: "Acte humain : la vérification fixe la référence d'affectation de l'inscription. Authentification forte requise.",
      sensitive: true,
    },
    {
      key: "stateassign.manage",
      label: "Activer, suspendre, reprendre, terminer ou transférer un dossier d'affectation",
      description: "Acte humain, audité. Authentification forte requise.",
      sensitive: true,
    },
    {
      key: "stateassign.amend",
      label: "Amender un dossier d'affectation (nouvelle version)",
      description: "Remplace la version courante par une version n+1 à vérifier. Authentification forte requise.",
      sensitive: true,
    },
    { key: "stateassign.reconcile", label: "Rapprocher un dossier avec la facturation et les versements de l'État" },
    { key: "stateassign.receivable.manage", label: "Planifier, reporter ou annuler une échéance de créance sur l'État" },
    { key: "stateassign.control.perform", label: "Planifier et réaliser un contrôle d'un dossier d'affectation" },
    { key: "stateassign.document.manage", label: "Rattacher ou retirer une pièce d'un dossier d'affectation" },
    { key: "stateassign.export", label: "Exporter les dossiers, créances et contrôles pour l'administration" },
    {
      key: "stateassign.settings.manage",
      label: "Gérer les réglages : séparation des tâches, tolérance, contrôles exigés, délai de grâce, formats d'export",
      description: "Acte humain, audité. Authentification forte requise.",
      sensitive: true,
    },
    { key: "stateassign.child.read", label: "Voir le statut de l'affectation de son enfant (parent)" },
  ],
  features: [
    { key: "stateassign.core", label: "Élèves affectés par l'État : dossiers, vérification, rapprochement, créances, contrôles", packs: ["SECONDARY"] },
    { key: "stateassign.gateway", label: "Passerelle vers une plateforme publique d'affectation (réservée, non disponible en V1)", packs: [] },
  ],
  menus: [
    { key: "stateassign.assignments", label: "Élèves affectés", href: "/v2/stateassign", permission: "stateassign.read", feature: "stateassign.core", portal: "admin", icon: "landmark", order: 700 },
    { key: "stateassign.verification", label: "Vérification des affectations", href: "/v2/stateassign/verification", permission: "stateassign.verify", feature: "stateassign.core", portal: "admin", icon: "badge-check", order: 710 },
    { key: "stateassign.reconciliation", label: "Rapprochement des affectations", href: "/v2/stateassign/reconciliation", permission: "stateassign.reconcile", feature: "stateassign.core", portal: "admin", icon: "scale", order: 720 },
    { key: "stateassign.receivables", label: "Créances sur l'État", href: "/v2/stateassign/receivables", permission: "stateassign.read", feature: "stateassign.core", portal: "admin", icon: "hand-coins", order: 730 },
    { key: "stateassign.reports", label: "États des affectations", href: "/v2/stateassign/reports", permission: "stateassign.read", feature: "stateassign.core", portal: "admin", icon: "file-spreadsheet", order: 740 },
    { key: "stateassign.settings", label: "Paramètres des affectations", href: "/v2/stateassign/settings", permission: "stateassign.settings.manage", feature: "stateassign.core", portal: "admin", icon: "settings", order: 750 },
    { key: "stateassign.family", label: "Affectation de mon enfant", href: "/v2/stateassign/family", permission: "stateassign.child.read", feature: "stateassign.core", portal: "parent", icon: "landmark", order: 700 },
  ],
  events: {
    publishes: [...ALL_STATEASSIGN_EVENT_TYPES],
    consumes: ["finance.payment.completed", "finance.invoice.issued"],
  },
});
