import { defineModule } from "@ecoledigitale/kernel";
import { ALL_NOTIFICATIONS_EVENT_TYPES, CONSUMED_EVENT_TYPES } from "./domain/events";

/**
 * Module `notifications` — canaux EXTERNES (e-mail SMTP, SMS par adaptateur HTTP générique, WhatsApp, Web Push) et in-app
 * (par `messaging`), gabarits par établissement versionnés, journal de CHAQUE envoi, préférences et consentement, règles
 * configurables, relances d'impayés et alertes (spec v2/016-communications, partie « canaux externes »).
 *
 * Il ne possède AUCUNE donnée métier : destinataires, factures, résultats arrivent par des PORTS (`apps/api/src/platform/
 * adapters/*-notifications.ts`) et par les événements des autres modules. Il dépend de `messaging` pour le canal in-app
 * (import par son `index.ts` uniquement).
 *
 * Conventions de portée : `notifications.own.manage` (personnel), `notifications.child.manage` (parent),
 * `notifications.self.manage` (élève) = gérer SES préférences et SES appareils ; les rôles système `parent` et `eleve` les
 * reçoivent par convention de nommage.
 */
export default defineModule({
  key: "notifications",
  title: "Notifications",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: ["messaging"],
  permissions: [
    { key: "notifications.read", label: "Consulter le journal des envois, les règles, l'état des canaux" },
    { key: "notifications.templates.manage", label: "Gérer les gabarits de notification (versions, aperçu, activation)" },
    { key: "notifications.rules.manage", label: "Gérer les règles de notification, les relances et les alertes" },
    { key: "notifications.settings.manage", label: "Gérer les paramètres des notifications et essayer un canal" },
    { key: "notifications.send", label: "Envoyer une convocation ou une annonce sur les canaux externes" },
    {
      key: "notifications.send.urgent",
      label: "Envoyer un avis urgent (contourne les heures calmes et les préférences de catégorie)",
      description: "Acte sensible : audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "notifications.consent.manage", label: "Enregistrer le consentement d'une personne et consulter sa preuve" },
    { key: "notifications.own.manage", label: "Gérer mes préférences de notification et mes appareils (personnel)" },
    { key: "notifications.child.manage", label: "Gérer mes préférences de notification et mes appareils (parent)" },
    { key: "notifications.self.manage", label: "Gérer mes préférences de notification et mes appareils (élève)" },
  ],
  features: [],
  menus: [
    { key: "notifications.journal", label: "Journal des notifications", href: "/v2/notifications", permission: "notifications.read", portal: "admin", icon: "bell", order: 740 },
    { key: "notifications.templates", label: "Gabarits de notification", href: "/v2/notifications/templates", permission: "notifications.templates.manage", portal: "admin", icon: "file-text", order: 741 },
    { key: "notifications.rules", label: "Règles et alertes", href: "/v2/notifications/rules", permission: "notifications.rules.manage", portal: "admin", icon: "sliders", order: 742 },
    { key: "notifications.channels", label: "Canaux d'envoi", href: "/v2/notifications/channels", permission: "notifications.read", portal: "admin", icon: "radio", order: 743 },
    { key: "notifications.account.admin", label: "Mes notifications", href: "/v2/account/notifications", permission: "notifications.own.manage", portal: "admin", icon: "bell", order: 790 },
    { key: "notifications.account.teacher", label: "Mes notifications", href: "/v2/account/notifications", permission: "notifications.own.manage", portal: "teacher", icon: "bell", order: 790 },
    { key: "notifications.account.parent", label: "Mes notifications", href: "/v2/account/notifications", permission: "notifications.child.manage", portal: "parent", icon: "bell", order: 790 },
    { key: "notifications.account.student", label: "Mes notifications", href: "/v2/account/notifications", permission: "notifications.self.manage", portal: "student", icon: "bell", order: 790 },
  ],
  events: {
    publishes: [...ALL_NOTIFICATIONS_EVENT_TYPES],
    consumes: [...CONSUMED_EVENT_TYPES],
  },
});
