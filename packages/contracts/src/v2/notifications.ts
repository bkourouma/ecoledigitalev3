/**
 * Contrats du module `notifications` (routes `/api/v1/notifications/*`, événements `notifications.*`) — spec
 * v2/016-communications, partie CANAUX EXTERNES (e-mail, SMS, WhatsApp, Web Push, in-app via `messaging`), gabarits,
 * journal d'envoi, préférences et consentement, règles, relances d'impayés et alertes.
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. Les utilisateurs sont des identités IAM (`ctx.userId`) ; élèves, classes, factures, échéances sont
 *    des références SANS clé étrangère (ports vers people, academic, finance…).
 *  - INSTANTS : ISO 8601 avec fuseau. Dates calendaires : `YYYY-MM-DD`.
 *  - AUCUN contenu de message ni adresse complète dans un événement ou dans le journal restitué : destinataire MASQUÉ.
 *  - Messages utilisateur en français (fr-CI) ; codes d'erreur stables `notifications.*`.
 *  - Autorisation décidée par l'API (permissions RBAC) ; les routes « moi » n'agissent que sur l'appelant.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const notifUuidSchema = z.string().uuid();
export const notifInstantSchema = z.string().datetime({ offset: true });
export const notifDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue : AAAA-MM-JJ.");

/** Canaux de remise. `IN_APP` délègue au module `messaging` (fil d'alertes + cloche). */
export const NOTIF_CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"] as const;
export const notifChannelSchema = z.enum(NOTIF_CHANNELS);
export type NotifChannel = z.infer<typeof notifChannelSchema>;

/** Catégories de notification : granularité des préférences d'une personne. */
export const NOTIF_CATEGORIES = ["ATTENDANCE", "FINANCE", "RESULTS", "SCHEDULE", "ANNOUNCEMENT", "ALERT", "URGENT"] as const;
export const notifCategorySchema = z.enum(NOTIF_CATEGORIES);
export type NotifCategory = z.infer<typeof notifCategorySchema>;

/** Valeur spéciale de catégorie dans une préférence : « toutes les catégories » du canal. */
export const NOTIF_ALL_CATEGORIES = "*" as const;

export const NOTIF_DELIVERY_STATUSES = ["PENDING", "SENDING", "SENT", "DELIVERED", "FAILED", "BOUNCED", "SKIPPED", "CANCELLED", "SIMULATED"] as const;
export const notifDeliveryStatusSchema = z.enum(NOTIF_DELIVERY_STATUSES);
export type NotifDeliveryStatus = z.infer<typeof notifDeliveryStatusSchema>;

/** Raisons d'une remise ignorée (`SKIPPED`) ou annulée (`CANCELLED`). */
export const NOTIF_SKIP_REASONS = [
  "consent_revoked",
  "category_opt_out",
  "no_contact",
  "suppressed",
  "channel_disabled",
  "recipient_cap",
  "backlog_limit",
  "fallback_not_needed",
  "paid",
  "cancelled_by_admin",
  "no_subscription",
] as const;
export const notifSkipReasonSchema = z.enum(NOTIF_SKIP_REASONS);
export type NotifSkipReason = z.infer<typeof notifSkipReasonSchema>;

export const NOTIF_SOURCE_KINDS = ["EVENT", "ALERT", "DUNNING", "MANUAL", "TEST"] as const;
export const notifSourceKindSchema = z.enum(NOTIF_SOURCE_KINDS);
export type NotifSourceKind = z.infer<typeof notifSourceKindSchema>;

/** Gabarits livrés (et personnalisables par établissement). */
export const NOTIF_TEMPLATE_CODES = [
  "absence",
  "late",
  "absence_threshold",
  "payment_received",
  "invoice_issued",
  "payment_reminder",
  "overdue_staff_alert",
  "report_card_published",
  "convocation",
  "announcement",
  "urgent_notice",
  "schedule_change",
  "grade_drop_alert",
  "teaching_load_alert",
  "document_expiring",
  "payslip_available",
  "channel_test",
] as const;
export const notifTemplateCodeSchema = z.enum(NOTIF_TEMPLATE_CODES);
export type NotifTemplateCode = z.infer<typeof notifTemplateCodeSchema>;

export const NOTIF_VARIABLE_TYPES = ["string", "text", "number", "date", "money", "url"] as const;
export const notifVariableTypeSchema = z.enum(NOTIF_VARIABLE_TYPES);
export type NotifVariableType = z.infer<typeof notifVariableTypeSchema>;

export const NOTIF_LOCALES = ["fr-CI"] as const;
export const notifLocaleSchema = z.enum(NOTIF_LOCALES);
export type NotifLocale = z.infer<typeof notifLocaleSchema>;
export const NOTIF_DEFAULT_LOCALE: NotifLocale = "fr-CI";

export const NOTIF_RULE_KINDS = ["EVENT", "ALERT", "DUNNING"] as const;
export const notifRuleKindSchema = z.enum(NOTIF_RULE_KINDS);
export type NotifRuleKind = z.infer<typeof notifRuleKindSchema>;

/** `ALL` : un envoi par canal choisi. `FIRST_REACHABLE` : le premier canal joignable et consenti (économise le SMS). */
export const NOTIF_STRATEGIES = ["ALL", "FIRST_REACHABLE"] as const;
export const notifStrategySchema = z.enum(NOTIF_STRATEGIES);
export type NotifStrategy = z.infer<typeof notifStrategySchema>;

/** Alertes évaluées par un job (hors événements). */
export const NOTIF_ALERT_METRICS = ["OVERDUE_DAYS", "GRADE_DROP", "TEACHING_LOAD"] as const;
export const notifAlertMetricSchema = z.enum(NOTIF_ALERT_METRICS);
export type NotifAlertMetric = z.infer<typeof notifAlertMetricSchema>;

export const NOTIF_CONSENT_MODELS = ["IMPLIED", "EXPLICIT"] as const;
export const notifConsentModelSchema = z.enum(NOTIF_CONSENT_MODELS);
export type NotifConsentModel = z.infer<typeof notifConsentModelSchema>;

/** Plafonds structurels (les plafonds d'exploitation sont des paramètres d'établissement). */
export const NOTIF_LIMITS = Object.freeze({
  subjectMax: 200,
  bodyMax: 4000,
  smsBodyMax: 1000,
  pageSize: 100,
  recipientsPerManualSend: 2000,
  stagesMax: 6,
  roleKeysMax: 10,
  noteMax: 300,
});

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min <= 1 ? "Ce champ est obligatoire." : `${min} caractères au moins.`)
    .max(max, `${max} caractères au plus.`);

const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Clé de rôle attendue : minuscules, chiffres et _.");

// ---------------------------------------------------------------------------
// Catalogue de gabarits (variables typées)
// ---------------------------------------------------------------------------

export const notifVariableDefSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/),
    label: z.string(),
    type: notifVariableTypeSchema,
    required: z.boolean(),
    sample: z.string(),
  })
  .strict();
export type NotifVariableDef = z.infer<typeof notifVariableDefSchema>;

export const notifCatalogEntrySchema = z
  .object({
    code: notifTemplateCodeSchema,
    label: z.string(),
    description: z.string(),
    category: notifCategorySchema,
    variables: z.array(notifVariableDefSchema),
    /** Canaux pour lesquels un gabarit livré existe. */
    channels: z.array(notifChannelSchema),
    /** Utilisable par l'envoi manuel (`POST /send`). */
    manual: z.boolean(),
  })
  .strict();
export type NotifCatalogEntry = z.infer<typeof notifCatalogEntrySchema>;
export const notifCatalogResponseSchema = z.object({ items: z.array(notifCatalogEntrySchema) }).strict();

// ---------------------------------------------------------------------------
// Gabarits par établissement (versionnés)
// ---------------------------------------------------------------------------

export const NOTIF_TEMPLATE_SOURCES = ["SHIPPED", "TENANT"] as const;

export const notifTemplateViewSchema = z
  .object({
    code: notifTemplateCodeSchema,
    channel: notifChannelSchema,
    locale: notifLocaleSchema,
    /** `SHIPPED` : gabarit livré (aucune version propre à l'établissement active). */
    source: z.enum(NOTIF_TEMPLATE_SOURCES),
    /** Version active ; 0 pour le gabarit livré. */
    version: z.number().int().min(0),
    enabled: z.boolean(),
    subject: z.string().nullable(),
    body: z.string(),
    variables: z.array(z.string()),
    updatedAt: notifInstantSchema.nullable(),
  })
  .strict();
export type NotifTemplateView = z.infer<typeof notifTemplateViewSchema>;
export const notifTemplateListResponseSchema = z.object({ items: z.array(notifTemplateViewSchema) }).strict();

export const notifTemplateVersionSchema = z
  .object({
    version: z.number().int().min(1),
    subject: z.string().nullable(),
    body: z.string(),
    note: z.string().nullable(),
    createdBy: notifUuidSchema.nullable(),
    createdAt: notifInstantSchema,
    active: z.boolean(),
  })
  .strict();
export type NotifTemplateVersion = z.infer<typeof notifTemplateVersionSchema>;
export const notifTemplateVersionsResponseSchema = z.object({ items: z.array(notifTemplateVersionSchema) }).strict();

export const notifTemplateKeyParamsSchema = z.object({ code: notifTemplateCodeSchema }).strict();
export const notifTemplateKeyQuerySchema = z.object({ channel: notifChannelSchema, locale: notifLocaleSchema.optional() }).strict();

export const notifSaveTemplateBodySchema = z
  .object({
    channel: notifChannelSchema,
    locale: notifLocaleSchema.default(NOTIF_DEFAULT_LOCALE),
    subject: text(1, NOTIF_LIMITS.subjectMax).optional(),
    body: text(1, NOTIF_LIMITS.bodyMax),
    note: text(1, NOTIF_LIMITS.noteMax).optional(),
  })
  .strict();
export type NotifSaveTemplateBody = z.infer<typeof notifSaveTemplateBodySchema>;

export const notifActivateVersionBodySchema = z
  .object({ channel: notifChannelSchema, locale: notifLocaleSchema.default(NOTIF_DEFAULT_LOCALE), version: z.number().int().min(0) })
  .strict();

export const notifEnableTemplateBodySchema = z
  .object({ channel: notifChannelSchema, locale: notifLocaleSchema.default(NOTIF_DEFAULT_LOCALE), enabled: z.boolean() })
  .strict();

export const notifPreviewBodySchema = z
  .object({
    channel: notifChannelSchema,
    locale: notifLocaleSchema.default(NOTIF_DEFAULT_LOCALE),
    /** Brouillon à prévisualiser ; absent : gabarit actif. */
    subject: z.string().max(NOTIF_LIMITS.subjectMax).optional(),
    body: z.string().max(NOTIF_LIMITS.bodyMax).optional(),
    /** Valeurs d'essai ; absentes : exemples du catalogue. */
    variables: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const notifPreviewResponseSchema = z
  .object({
    subject: z.string().nullable(),
    text: z.string(),
    /** E-mail uniquement : rendu HTML (échappé) avec pied de page de conformité. */
    html: z.string().nullable(),
    /** SMS : nombre de segments estimés. */
    segments: z.number().int().nullable(),
    warnings: z.array(z.string()),
  })
  .strict();
export type NotifPreviewResponse = z.infer<typeof notifPreviewResponseSchema>;

// ---------------------------------------------------------------------------
// Règles (qui est notifié, par quel canal, avec quel gabarit, seuils)
// ---------------------------------------------------------------------------

export const NOTIF_AUDIENCE_KINDS = ["STUDENT_GUARDIANS", "STUDENT", "STAFF_SUBJECT", "ROLES", "CLASSROOM", "ANNOUNCEMENT_RECIPIENTS", "PAYSLIP_HOLDER"] as const;

export const notifAudienceSchema = z.discriminatedUnion("kind", [
  /** Tuteurs de l'élève visé ; `financialFirst` : les responsables financiers d'abord ; `fallbackToStudent` : l'élève si aucun tuteur joignable. */
  z.object({ kind: z.literal("STUDENT_GUARDIANS"), financialFirst: z.boolean().default(false), fallbackToStudent: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal("STUDENT") }).strict(),
  /** Le membre du personnel désigné par l'événement. */
  z.object({ kind: z.literal("STAFF_SUBJECT") }).strict(),
  z.object({ kind: z.literal("ROLES"), roleKeys: z.array(roleKeySchema).min(1).max(NOTIF_LIMITS.roleKeysMax) }).strict(),
  /** Classe visée par l'événement : tuteurs, élèves, enseignants. */
  z
    .object({ kind: z.literal("CLASSROOM"), include: z.array(z.enum(["GUARDIANS", "STUDENTS", "TEACHERS"])).min(1).max(3) })
    .strict(),
  z.object({ kind: z.literal("ANNOUNCEMENT_RECIPIENTS") }).strict(),
  z.object({ kind: z.literal("PAYSLIP_HOLDER") }).strict(),
]);
export type NotifAudience = z.infer<typeof notifAudienceSchema>;

/** Seuils et filtres d'une règle (tous facultatifs ; leur sens dépend du déclencheur). */
export const notifRuleConditionsSchema = z
  .object({
    /** Alerte d'absences : valeur minimale de l'indicateur d'attendance (`attendance.alert.triggered`). */
    minValue: z.number().int().min(0).max(100000).optional(),
    /** Indicateurs d'attendance retenus (ex. `ABSENT_COUNT`). */
    metrics: z.array(z.string().min(1).max(40)).max(10).optional(),
    /** Priorités d'annonce retenues. */
    priorities: z.array(z.enum(["LOW", "NORMAL", "HIGH", "URGENT"])).max(4).optional(),
    /** Alerte de retard de paiement : jours de retard minimum. */
    minDaysOverdue: z.number().int().min(1).max(3650).optional(),
    /** Baisse de note : écart minimal entre deux résultats FINAL consécutifs (unité de la moyenne). */
    minDrop: z.number().min(0.01).max(1000).optional(),
    /** Charge d'enseignement : heures planifiées au-delà desquelles on alerte. */
    maxHours: z.number().min(1).max(10000).optional(),
    /** Relances : paliers en jours de retard (J+3, J+10, J+30…), strictement croissants. */
    stages: z.array(z.number().int().min(1).max(3650)).min(1).max(NOTIF_LIMITS.stagesMax).optional(),
    /** Document expirant : préavis en jours (l'événement du producteur est filtré sur ce préavis). */
    daysBefore: z.number().int().min(1).max(3650).optional(),
  })
  .strict();
export type NotifRuleConditions = z.infer<typeof notifRuleConditionsSchema>;

const ruleKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,59}$/, "Clé de règle invalide (minuscules, chiffres, . _ -).");

const ruleCore = {
  enabled: z.boolean(),
  templateCode: notifTemplateCodeSchema,
  audience: notifAudienceSchema,
  channels: z.array(notifChannelSchema).min(1).max(NOTIF_CHANNELS.length),
  strategy: notifStrategySchema,
  /** Une règle urgente contourne les heures calmes et les préférences de catégorie. */
  urgent: z.boolean(),
  conditions: notifRuleConditionsSchema,
};

export const notifRuleViewSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    kind: notifRuleKindSchema,
    /** Type d'événement, indicateur d'alerte ou `dunning`. */
    trigger: z.string(),
    /** `SHIPPED` : règle livrée non modifiée ; `TENANT` : surchargée ou créée par l'établissement. */
    source: z.enum(NOTIF_TEMPLATE_SOURCES),
    custom: z.boolean(),
    ...ruleCore,
    updatedAt: notifInstantSchema.nullable(),
  })
  .strict();
export type NotifRuleView = z.infer<typeof notifRuleViewSchema>;
export const notifRuleListResponseSchema = z.object({ items: z.array(notifRuleViewSchema) }).strict();

export const notifRuleKeyParamsSchema = z.object({ key: ruleKeySchema }).strict();

export const notifSaveRuleBodySchema = z
  .object({
    label: text(1, 120).optional(),
    ...ruleCore,
    /** Obligatoire pour une règle personnalisée (clé `custom.*`) : événement déclencheur. */
    trigger: z.string().min(3).max(80).optional(),
  })
  .strict();
export type NotifSaveRuleBody = z.infer<typeof notifSaveRuleBodySchema>;

export const notifSupportedEventsResponseSchema = z.object({ items: z.array(z.object({ eventType: z.string(), label: z.string(), audiences: z.array(z.enum(NOTIF_AUDIENCE_KINDS)) }).strict()) }).strict();

// ---------------------------------------------------------------------------
// Paramètres d'établissement, canaux et santé
// ---------------------------------------------------------------------------

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue : HH:MM.");

export const notifSettingsSchema = z
  .object({
    enabledChannels: z.array(notifChannelSchema),
    senderName: z.string().nullable(),
    replyTo: z.string().nullable(),
    timezone: z.string(),
    defaultDialCode: z.string(),
    quietHoursEnabled: z.boolean(),
    quietStart: timeOfDaySchema,
    quietEnd: timeOfDaySchema,
    /** Plafond journalier d'envois par canal ; canal absent = plafond par défaut de la plateforme. */
    dailyCaps: z.record(notifChannelSchema, z.number().int().min(0).max(1_000_000)),
    perRecipientDailyCap: z.number().int().min(1).max(500),
    consentModels: z.record(notifChannelSchema, notifConsentModelSchema),
    urgentBypassesRevocations: z.boolean(),
    maxAttempts: z.number().int().min(1).max(10),
    journalRetentionDays: z.number().int().min(7).max(3650),
    legalFooter: z.string().nullable(),
    updatedAt: notifInstantSchema.nullable(),
  })
  .strict();
export type NotifSettings = z.infer<typeof notifSettingsSchema>;

export const notifUpdateSettingsBodySchema = z
  .object({
    enabledChannels: z.array(notifChannelSchema).max(NOTIF_CHANNELS.length).optional(),
    senderName: text(1, 80).nullable().optional(),
    replyTo: z.string().trim().email().max(200).nullable().optional(),
    timezone: z.string().min(3).max(60).optional(),
    defaultDialCode: z.string().regex(/^\d{1,4}$/, "Indicatif attendu : 1 à 4 chiffres, sans +.").optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietStart: timeOfDaySchema.optional(),
    quietEnd: timeOfDaySchema.optional(),
    dailyCaps: z.record(notifChannelSchema, z.number().int().min(0).max(1_000_000)).optional(),
    perRecipientDailyCap: z.number().int().min(1).max(500).optional(),
    consentModels: z.record(notifChannelSchema, notifConsentModelSchema).optional(),
    urgentBypassesRevocations: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    journalRetentionDays: z.number().int().min(7).max(3650).optional(),
    legalFooter: text(1, 500).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucun changement demandé.");
export type NotifUpdateSettingsBody = z.infer<typeof notifUpdateSettingsBodySchema>;

export const NOTIF_CHANNEL_STATES = ["OK", "DEGRADED", "NOT_CONFIGURED", "DISABLED"] as const;

export const notifChannelHealthSchema = z
  .object({
    channel: notifChannelSchema,
    /** Fournisseur branché (`smtp`, `http-sms`, `wasender`, `webpush`, `messaging`) ; `null` si non configuré. */
    provider: z.string().nullable(),
    configured: z.boolean(),
    enabled: z.boolean(),
    state: z.enum(NOTIF_CHANNEL_STATES),
    /** Variables d'environnement manquantes (jamais leurs valeurs). */
    missing: z.array(z.string()),
    last24h: z.object({ sent: z.number().int(), failed: z.number().int(), bounced: z.number().int(), skipped: z.number().int() }).strict(),
    pending: z.number().int(),
    oldestPendingAt: notifInstantSchema.nullable(),
    lastErrorCode: z.string().nullable(),
    lastErrorAt: notifInstantSchema.nullable(),
    dailyCap: z.number().int(),
    sentToday: z.number().int(),
  })
  .strict();
export type NotifChannelHealth = z.infer<typeof notifChannelHealthSchema>;
export const notifChannelsResponseSchema = z.object({ items: z.array(notifChannelHealthSchema), simulation: z.boolean() }).strict();

export const notifChannelTestBodySchema = z.object({ channels: z.array(notifChannelSchema).min(1).max(NOTIF_CHANNELS.length) }).strict();

// ---------------------------------------------------------------------------
// Journal des envois
// ---------------------------------------------------------------------------

export const notifDeliveryViewSchema = z
  .object({
    id: notifUuidSchema,
    createdAt: notifInstantSchema,
    channel: notifChannelSchema,
    category: notifCategorySchema,
    templateCode: z.string(),
    templateVersion: z.number().int(),
    sourceKind: notifSourceKindSchema,
    ruleKey: z.string().nullable(),
    status: notifDeliveryStatusSchema,
    skipReason: z.string().nullable(),
    urgent: z.boolean(),
    /** Adresse MASQUÉE (`a***@gmail.com`, `+225 ** ** ** 34`) ; jamais complète. */
    recipient: z.string(),
    recipientUserId: notifUuidSchema.nullable(),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    availableAt: notifInstantSchema,
    sentAt: notifInstantSchema.nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    providerId: z.string().nullable(),
    cost: z.object({ amount: z.number().int(), currency: z.string() }).strict().nullable(),
    eventId: notifUuidSchema.nullable(),
  })
  .strict();
export type NotifDeliveryView = z.infer<typeof notifDeliveryViewSchema>;

export const notifDeliveryListQuerySchema = z
  .object({
    channel: notifChannelSchema.optional(),
    status: notifDeliveryStatusSchema.optional(),
    category: notifCategorySchema.optional(),
    templateCode: z.string().max(60).optional(),
    sourceKind: notifSourceKindSchema.optional(),
    ruleKey: z.string().max(60).optional(),
    userId: notifUuidSchema.optional(),
    from: notifInstantSchema.optional(),
    to: notifInstantSchema.optional(),
    cursor: z.string().min(1).max(300).optional(),
    limit: z.coerce.number().int().min(1).max(NOTIF_LIMITS.pageSize).default(30),
  })
  .strict();
export type NotifDeliveryListQuery = z.infer<typeof notifDeliveryListQuerySchema>;

export const notifDeliveryListResponseSchema = z.object({ items: z.array(notifDeliveryViewSchema), nextCursor: z.string().nullable() }).strict();

export const notifDeliveryStatsResponseSchema = z
  .object({
    since: notifInstantSchema,
    byStatus: z.record(notifDeliveryStatusSchema, z.number().int()),
    byChannel: z.record(notifChannelSchema, z.number().int()),
  })
  .strict();

export const notifIdParamsSchema = z.object({ id: notifUuidSchema }).strict();

// ---------------------------------------------------------------------------
// Préférences et consentement
// ---------------------------------------------------------------------------

export const notifChannelPreferenceSchema = z
  .object({
    channel: notifChannelSchema,
    /** `*` : toutes les catégories du canal. */
    category: z.union([notifCategorySchema, z.literal(NOTIF_ALL_CATEGORIES)]),
    enabled: z.boolean(),
  })
  .strict();
export type NotifChannelPreference = z.infer<typeof notifChannelPreferenceSchema>;

export const notifPreferencesSchema = z
  .object({
    channels: z.array(
      z
        .object({
          channel: notifChannelSchema,
          /** Le canal est utilisable pour cet établissement (activé et configuré). */
          available: z.boolean(),
          /** Consentement effectif au niveau du canal (préférence `*`, sinon modèle de l'établissement). */
          enabled: z.boolean(),
          consentModel: notifConsentModelSchema,
          /** Catégories explicitement refusées ou acceptées sur ce canal. */
          categories: z.record(notifCategorySchema, z.boolean()),
        })
        .strict(),
    ),
    quietHours: z.object({ enabled: z.boolean(), start: timeOfDaySchema, end: timeOfDaySchema, inherited: z.boolean() }).strict(),
    /** Mention de conformité : les alertes urgentes peuvent contourner les heures calmes. */
    urgentBypassesQuietHours: z.boolean(),
    pushDevices: z.number().int(),
  })
  .strict();
export type NotifPreferences = z.infer<typeof notifPreferencesSchema>;

export const notifUpdatePreferencesBodySchema = z
  .object({
    channels: z.array(notifChannelPreferenceSchema).max(NOTIF_CHANNELS.length * (NOTIF_CATEGORIES.length + 1)).optional(),
    quietHours: z
      .object({ enabled: z.boolean().optional(), start: timeOfDaySchema.optional(), end: timeOfDaySchema.optional(), inherit: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => b.channels !== undefined || b.quietHours !== undefined, "Aucun changement demandé.");
export type NotifUpdatePreferencesBody = z.infer<typeof notifUpdatePreferencesBodySchema>;

/** Administration : consentement d'une personne enregistré par le personnel (demande téléphonique, papier…). */
export const notifSubjectConsentBodySchema = z
  .object({
    userId: notifUuidSchema,
    channel: notifChannelSchema,
    category: z.union([notifCategorySchema, z.literal(NOTIF_ALL_CATEGORIES)]).default(NOTIF_ALL_CATEGORIES),
    enabled: z.boolean(),
    note: text(1, NOTIF_LIMITS.noteMax).optional(),
  })
  .strict();

export const notifConsentLogQuerySchema = z.object({ userId: notifUuidSchema, limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
export const notifConsentLogResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          at: notifInstantSchema,
          channel: notifChannelSchema,
          category: z.string(),
          enabled: z.boolean(),
          source: z.enum(["SELF", "ADMIN", "UNSUBSCRIBE_LINK", "BOUNCE", "IMPORT"]),
          actorUserId: notifUuidSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

export const notifPushSubscribeBodySchema = z
  .object({
    endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Le point d'accès Web Push doit être en HTTPS."),
    keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }).strict(),
    deviceLabel: text(1, 80).optional(),
    userAgent: z.string().max(300).optional(),
  })
  .strict();
export type NotifPushSubscribeBody = z.infer<typeof notifPushSubscribeBodySchema>;

export const notifPushUnsubscribeBodySchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

export const notifPushDeviceSchema = z
  .object({ id: notifUuidSchema, deviceLabel: z.string().nullable(), createdAt: notifInstantSchema, lastUsedAt: notifInstantSchema.nullable() })
  .strict();
export const notifPushDevicesResponseSchema = z.object({ items: z.array(notifPushDeviceSchema) }).strict();

export const notifVapidKeyResponseSchema = z.object({ publicKey: z.string().nullable(), configured: z.boolean() }).strict();

// ---------------------------------------------------------------------------
// Envoi manuel (convocation, annonce, urgence)
// ---------------------------------------------------------------------------

export const notifManualAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("USERS"), userIds: z.array(notifUuidSchema).min(1).max(NOTIF_LIMITS.recipientsPerManualSend) }).strict(),
  z.object({ kind: z.literal("STUDENT_GUARDIANS"), studentIds: z.array(notifUuidSchema).min(1).max(500), financialFirst: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal("CLASSROOM"), classroomIds: z.array(notifUuidSchema).min(1).max(20), include: z.array(z.enum(["GUARDIANS", "STUDENTS", "TEACHERS"])).min(1).max(3) }).strict(),
  z.object({ kind: z.literal("ROLES"), roleKeys: z.array(roleKeySchema).min(1).max(NOTIF_LIMITS.roleKeysMax) }).strict(),
]);
export type NotifManualAudience = z.infer<typeof notifManualAudienceSchema>;

export const notifSendBodySchema = z
  .object({
    templateCode: notifTemplateCodeSchema,
    audience: notifManualAudienceSchema,
    variables: z.record(z.string(), z.unknown()).default({}),
    channels: z.array(notifChannelSchema).min(1).max(NOTIF_CHANNELS.length),
    strategy: notifStrategySchema.default("ALL"),
    /** Urgence : contourne les heures calmes et les préférences de catégorie (permission sensible). */
    urgent: z.boolean().default(false),
    /** Clé d'idempotence fournie par le client (un réessai ne double pas l'envoi). */
    clientKey: z.string().min(8).max(80).optional(),
  })
  .strict();
export type NotifSendBody = z.infer<typeof notifSendBodySchema>;

export const notifSendResponseSchema = z
  .object({ recipients: z.number().int(), deliveries: z.number().int(), skipped: z.number().int(), reused: z.boolean() })
  .strict();

// ---------------------------------------------------------------------------
// Désinscription (route publique signée) et accusés des fournisseurs
// ---------------------------------------------------------------------------

export const notifUnsubscribeQuerySchema = z.object({ t: z.string().min(20).max(600) }).strict();
export const notifUnsubscribeResponseSchema = z.object({ channel: notifChannelSchema, applied: z.boolean(), organization: z.string().nullable() }).strict();

export const notifDeliveryStatusWebhookBodySchema = z
  .object({
    providerId: z.string().min(1).max(200),
    status: z.enum(["DELIVERED", "FAILED", "BOUNCED", "COMPLAINT"]),
    reason: z.string().max(300).optional(),
  })
  .strict();
export type NotifDeliveryStatusWebhookBody = z.infer<typeof notifDeliveryStatusWebhookBodySchema>;

// ---------------------------------------------------------------------------
// Codes d'erreur stables
// ---------------------------------------------------------------------------

export const NOTIF_ERROR_CODES = [
  "notifications.invalid_input",
  "notifications.forbidden",
  "notifications.port_unavailable",
  "notifications.template_not_found",
  "notifications.template_invalid",
  "notifications.template_variable_unknown",
  "notifications.template_variable_invalid",
  "notifications.version_not_found",
  "notifications.rule_not_found",
  "notifications.rule_invalid",
  "notifications.channel_not_configured",
  "notifications.channel_disabled",
  "notifications.delivery_not_found",
  "notifications.recipient_not_found",
  "notifications.too_many_recipients",
  "notifications.quota_exceeded",
  "notifications.signature_invalid",
  "notifications.token_invalid",
  "notifications.push_not_configured",
  "notifications.rate_limited",
] as const;
export type NotifErrorCode = (typeof NOTIF_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Événements (outbox, payload `{ v: 1, … }`) — jamais de contenu ni d'adresse
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });

export const notificationsEventPayloadSchemas = {
  "notifications.delivery.failed": ev({
    deliveryId: notifUuidSchema,
    channel: notifChannelSchema,
    category: notifCategorySchema,
    templateCode: z.string(),
    sourceKind: notifSourceKindSchema,
    attempts: z.number().int(),
    errorCode: z.string(),
  }),
  "notifications.delivery.bounced": ev({
    deliveryId: notifUuidSchema,
    channel: notifChannelSchema,
    reason: z.string(),
  }),
  "notifications.consent.changed": ev({
    subjectKey: z.string(),
    channel: notifChannelSchema,
    category: z.string(),
    enabled: z.boolean(),
    source: z.enum(["SELF", "ADMIN", "UNSUBSCRIBE_LINK", "BOUNCE", "IMPORT"]),
  }),
  "notifications.template.published": ev({
    code: notifTemplateCodeSchema,
    channel: notifChannelSchema,
    locale: notifLocaleSchema,
    version: z.number().int(),
    publishedBy: notifUuidSchema.nullable(),
  }),
  "notifications.rule.updated": ev({ ruleKey: z.string(), enabled: z.boolean(), updatedBy: notifUuidSchema.nullable() }),
  "notifications.urgent.sent": ev({ templateCode: z.string(), recipients: z.number().int(), sentBy: notifUuidSchema }),
} as const;
export type NotificationsEventType = keyof typeof notificationsEventPayloadSchemas;
export const NOTIFICATIONS_EVENT_TYPES = Object.keys(notificationsEventPayloadSchemas) as NotificationsEventType[];
