/**
 * API PUBLIQUE du module `messaging` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`).
 *
 *   import { createMessagingDeps, postSystemMessages, registerMessagingPorts } from "../messaging";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les références
 * vers utilisateurs, élèves, classes, niveaux, campus sont des UUID résolus par les PORTS que fournit la plateforme
 * (`PeopleDirectory`, `AudienceDirectory`, `StoragePort`) : adaptateurs `platform/adapters/*-messaging.ts`.
 *
 * Consommateurs : les modules qui veulent notifier un utilisateur publient un ÉVÉNEMENT (jamais d'appel direct) ;
 * `postSystemMessages` est l'entrée de ceux qui ont déjà résolu leurs destinataires (spec 016 §9).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as messagingManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { messagingPlugin, registerMessagingPorts, setup as messagingSetup, type MessagingPluginOptions } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as MESSAGING_PERMISSIONS, type PermissionKit } from "./http/guards";
export { createMessagingPortRegistry, messagingWorkerPorts, resetMessagingWorkerPorts, setMessagingWorkerPorts, type MessagingPortRegistry } from "./application/port-registry";

// Dépendances et ports
export { createMessagingDeps, DEFAULT_MESSAGING_CONFIG, type MessagingConfig, type MessagingDeps, type MessagingDepsInput } from "./application/deps";
export type {
  AudienceDirectory,
  AudienceResolution,
  AuditEntry,
  AuditPort,
  ChannelDelivery,
  ClassroomContacts,
  ExternalChannel,
  MessagingPorts,
  NotificationChannel,
  OutboundNotification,
  PeopleDirectory,
  StoragePort,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { messagingAuditAdapter } from "./infrastructure/audit-adapter";
export { InMemoryDirectory, InMemoryStorage, inMemoryPorts, unavailablePorts, type WorldUser } from "./infrastructure/in-memory-ports";

// Domaine (types et règles pures, réutilisables par les adaptateurs et les tests)
export { DEFAULT_MESSAGING_SETTINGS, type ActorProfile, type CallerCaps, type DirectoryContact, type MessagingAudience, type MessagingSettings, type MessagingTarget } from "./domain/types";
export { applicableRules, canInitiate, canTargetClassroom, evaluateRecipient, replyBlock, type Decision, type DenyReason } from "./domain/policy";
export { ALL_MESSAGING_EVENT_TYPES, ConsumedEvents, MessagingEvents } from "./domain/events";
export { MessagingCode } from "./domain/errors";

// Cas d'usage — conversations
export {
  createConversation,
  getConversationDetail,
  leaveConversation,
  listConversationMessages,
  listConversations,
  markConversationRead,
  postMessage,
  postSystemMessages,
  removeOwnMessage,
  searchMyMessages,
  setParticipantState,
  type CreateConversationInput,
  type PostMessageInput,
  type SendResult,
  type SystemMessageInput,
} from "./application/conversations";
export { getMyAudience, listAllowedRecipients } from "./application/recipients";
export { getAttachmentUrl, purgeOrphanAttachments, uploadAttachment } from "./application/attachments";

// Cas d'usage — annonces
export {
  acknowledgeAnnouncement,
  createAnnouncement,
  deleteAnnouncementDraft,
  getAnnouncementDetail,
  listAnnouncementReceipts,
  listAnnouncements,
  markAnnouncementRead,
  previewAudience,
  publishAnnouncement,
  publishDueAnnouncements,
  updateAnnouncement,
  withdrawAnnouncement,
} from "./application/announcements";

// Cas d'usage — notifications, préférences
export {
  getMyPreferences,
  getUnreadSummary,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  purgeOldNotifications,
  updateMyPreferences,
} from "./application/notifications";

// Cas d'usage — modération, paramètres
export {
  decideReport,
  getReportContext,
  liftRestriction,
  listActiveRestrictions,
  listReports,
  reportMessage,
  restrictUser,
  superviseListConversations,
  superviseReadMessages,
} from "./application/moderation";
export { getMessagingSettings, listSystemTemplates, updateMessagingSettings, updateSystemTemplate } from "./application/settings";

// Consommateurs d'événements et jobs
export { formatDateFr, isBenignConsumerError, onAttendanceRecorded, readRecordedEvent } from "./application/consumers";

// Annonce publiée vue par les canaux externes (module notifications, 016) : lecture seule, contexte système
export { DELIVERY_FEED_MAX_RECIPIENTS, readAnnouncementForDelivery, type AnnouncementDeliveryView } from "./application/delivery-feed";
