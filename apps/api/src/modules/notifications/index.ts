/**
 * API PUBLIQUE du module `notifications` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`).
 *
 *   import { createNotificationsDeps, registerNotificationsPorts, setNotificationsWorkerPorts } from "../notifications";
 *
 * Consommateurs : les modules qui veulent notifier publient un ÉVÉNEMENT (jamais d'appel direct) ; les adaptateurs de
 * plateforme branchent les PORTS (annuaire des destinataires, échéances en retard, résultats, charge d'enseignement).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as notificationsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { notificationsPlugin, registerNotificationsPorts, setup as notificationsSetup, type NotificationsPluginOptions } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as NOTIFICATIONS_PERMISSIONS, type PermissionKit } from "./http/guards";
export { createNotificationsPortRegistry, notificationsWorkerPorts, resetNotificationsWorkerPorts, setNotificationsWorkerPorts, type NotificationsPortRegistry } from "./application/port-registry";

// Dépendances, configuration et ports
export { configFromEnv, createNotificationsDeps, DEFAULT_NOTIFICATIONS_CONFIG, type NotificationsConfig, type NotificationsDeps, type NotificationsDepsInput } from "./application/deps";
export type {
  AnnouncementFeed,
  AuditEntry,
  AuditPort,
  ChannelAdapter,
  ChannelConfigStatus,
  ChannelMessage,
  ChannelOutcome,
  ChannelRegistry,
  GradePair,
  GradeSource,
  NotificationsPorts,
  OverdueInstallment,
  OverdueSource,
  PushSubscriptionStore,
  RecipientDirectory,
  StudentContacts,
  TeachingLoad,
  TeachingLoadSource,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { createChannelRegistry, closeChannelRegistry, type ChannelRegistryOptions } from "./infrastructure/channels/registry";
export { InMemoryDirectory, inMemoryPorts, unavailablePorts, type InMemoryWorld } from "./infrastructure/in-memory-ports";
export { toMessagingChannel } from "./infrastructure/messaging-bridge";

// Domaine (types et règles pures, réutilisables par les adaptateurs et les tests)
export type { Recipient, RuleDef, TenantSettings } from "./domain/types";
export { DEFAULT_TENANT_SETTINGS, PLATFORM_DAILY_CAPS } from "./domain/types";
export { TEMPLATE_CATALOG, catalogEntry } from "./domain/catalog";
export { DEFAULT_RULES } from "./domain/default-rules";
export { normalizeEmail, normalizePhone, maskEmail, maskPhone } from "./domain/addresses";
export { NotificationsEvents, ConsumedEvents, ALL_NOTIFICATIONS_EVENT_TYPES } from "./domain/events";
export { NotifCode } from "./domain/errors";

// Cas d'usage
export { enqueueInTx, type EnqueueInput, type EnqueueResult } from "./application/enqueue";
export { onDomainEvent, onInvoicePaid } from "./application/events";
export { dispatchTenant, type DispatchReport } from "./application/dispatch";
export { runDunning, type DunningReport } from "./application/dunning";
export { evaluateAlerts, type AlertsReport } from "./application/alerts";
export { dispatchAllTenants, dunningAllTenants, alertsAllTenants, housekeepingAllTenants } from "./application/runners";
export { listCatalog, listTemplates, listTemplateVersions, publishTemplateVersion, activateTemplateVersion, setTemplateEnabled, previewTemplate } from "./application/templates";
export { listRules, saveRule, resetRule } from "./application/rules";
export { getNotificationSettings, updateNotificationSettings } from "./application/settings";
export { getMyNotificationPreferences, updateMyNotificationPreferences, setSubjectConsent, getConsentLog, applyUnsubscribe } from "./application/preferences";
export { listDeliveries, deliveryStats } from "./application/journal";
export { sendManualNotification } from "./application/send";
export { getChannelsHealth, sendChannelTest } from "./application/health";
export { applyDeliveryStatusWebhook } from "./application/webhooks";
