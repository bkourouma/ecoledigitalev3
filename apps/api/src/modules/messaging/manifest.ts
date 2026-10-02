import { defineModule } from "@ecoledigitale/kernel";
import { ALL_MESSAGING_EVENT_TYPES, ConsumedEvents } from "./domain/events";

/**
 * Module `messaging` — messagerie interne, annonces ciblées et notifications in-app (spec v2/016-communications).
 *
 * UNE messagerie pour tous les acteurs (parent ↔ enseignant / administration, enseignant ↔ classe, administration → tous,
 * élève ↔ enseignants selon la politique du tenant), des annonces ciblées avec accusés, des pièces jointes contrôlées, des
 * notifications in-app avec préférences, de la modération auditée et des messages système issus d'événements.
 *
 * L'autorisation « vis-à-vis de qui » combine une permission (RBAC) et un LIEN (tutelle, affectation, inscription) résolu
 * par des PORTS (`PeopleDirectory`, `AudienceDirectory`, `StoragePort`) que fournit la plateforme à partir de people,
 * academic et rbac : aucune FK inter-schémas, aucun import direct — d'où `dependsOn: []`. Les canaux externes (e-mail, SMS,
 * WhatsApp, push) sont un autre chantier : seul le port `NotificationChannel` est déclaré.
 *
 * Conventions de portée des données : `messaging.child.*` (parent), `messaging.self.*` (élève) — accordées automatiquement
 * aux rôles système `parent` et `eleve` ; le personnel reçoit `messaging.read` / `messaging.send` (voir README : modification
 * des modèles de rôles à faire dans le module rbac).
 */
export default defineModule({
  key: "messaging",
  title: "Messagerie et annonces",
  packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"],
  dependsOn: [],
  permissions: [
    { key: "messaging.read", label: "Lire sa boîte de messagerie, ses annonces et ses notifications (personnel)" },
    { key: "messaging.send", label: "Écrire au personnel, aux élèves et tuteurs de ses classes, à l'administration" },
    {
      key: "messaging.send.any",
      label: "Écrire à tout utilisateur, toute classe ou toute audience (administration)",
      description: "Diffusions administratives : toutes les classes, tous les niveaux, tous les rôles.",
    },
    { key: "messaging.child.read", label: "Lire la boîte, les annonces et les notifications de son espace parent" },
    { key: "messaging.child.send", label: "Écrire aux enseignants de ses enfants et à l'administration (parent)" },
    { key: "messaging.self.read", label: "Lire la boîte, les annonces et les notifications de son espace élève" },
    { key: "messaging.self.send", label: "Écrire à ses enseignants et à l'administration selon la politique de l'établissement (élève)" },
    { key: "messaging.announcement.publish", label: "Publier une annonce vers toute cible (établissement, campus, niveau, classe, rôle)" },
    { key: "messaging.announcement.publish_class", label: "Publier une annonce vers ses propres classes" },
    { key: "messaging.announcement.manage", label: "Modifier ou retirer toute annonce, consulter les accusés de lecture" },
    {
      key: "messaging.moderation.read",
      label: "Consulter les signalements et le contexte du message signalé",
      description: "Lit le contenu de messages d'autrui : chaque lecture est auditée.",
      sensitive: true,
    },
    {
      key: "messaging.moderation.manage",
      label: "Décider d'un signalement, retirer un message, restreindre l'envoi d'un utilisateur",
      description: "Acte sensible : motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    {
      key: "messaging.moderation.supervise",
      label: "Superviser les conversations de l'établissement (lecture motivée)",
      description: "Lecture du contenu d'un fil avec motif obligatoire, audité, authentification forte requise.",
      sensitive: true,
    },
    { key: "messaging.settings.manage", label: "Gérer les paramètres de la messagerie et les gabarits de messages système" },
  ],
  features: [],
  menus: [
    { key: "messaging.inbox", label: "Messages", href: "/v2/messages", permission: "messaging.read", portal: "admin", icon: "mail", order: 700 },
    { key: "messaging.announcements", label: "Annonces", href: "/v2/announcements", permission: "messaging.read", portal: "admin", icon: "megaphone", order: 710 },
    { key: "messaging.moderation", label: "Modération des messages", href: "/v2/messages/moderation", permission: "messaging.moderation.read", portal: "admin", icon: "shield", order: 720 },
    { key: "messaging.settings", label: "Paramètres de la messagerie", href: "/v2/messages/settings", permission: "messaging.settings.manage", portal: "admin", icon: "settings", order: 730 },
    { key: "messaging.inbox.teacher", label: "Messages", href: "/v2/messages", permission: "messaging.read", portal: "teacher", icon: "mail", order: 700 },
    { key: "messaging.announcements.teacher", label: "Annonces", href: "/v2/announcements", permission: "messaging.read", portal: "teacher", icon: "megaphone", order: 710 },
    { key: "messaging.inbox.parent", label: "Messages", href: "/v2/messages", permission: "messaging.child.read", portal: "parent", icon: "mail", order: 700 },
    { key: "messaging.announcements.parent", label: "Annonces", href: "/v2/announcements", permission: "messaging.child.read", portal: "parent", icon: "megaphone", order: 710 },
    { key: "messaging.inbox.student", label: "Messages", href: "/v2/messages", permission: "messaging.self.read", portal: "student", icon: "mail", order: 700 },
    { key: "messaging.announcements.student", label: "Annonces", href: "/v2/announcements", permission: "messaging.self.read", portal: "student", icon: "megaphone", order: 710 },
  ],
  events: {
    publishes: [...ALL_MESSAGING_EVENT_TYPES],
    consumes: [ConsumedEvents.ABSENCE_RECORDED, ConsumedEvents.LATE_RECORDED],
  },
});
