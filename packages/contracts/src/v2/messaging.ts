/**
 * Contrats du module `messaging` (routes `/api/v1/messaging/*`, événements `messaging.*`) — spec v2/016-communications,
 * partie MESSAGERIE INTERNE ET ANNONCES (les canaux externes e-mail / SMS / WhatsApp / push sont un autre chantier).
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. Les utilisateurs sont des identités IAM (`ctx.userId`) ; élèves, classes, niveaux, campus,
 *    établissements sont des références SANS clé étrangère, vérifiées par des ports (people, academic, rbac).
 *  - INSTANTS : ISO 8601 avec fuseau. Aucune date « calendaire » dans ce module.
 *  - AUCUN contenu de message ni d'annonce dans un événement : identifiants, comptes et catégories seulement.
 *  - Messages utilisateur en français ; codes d'erreur stables `messaging.*`.
 *  - Autorisation : décidée par l'API (permissions RBAC + liens de tutelle / d'affectation). Le client ne déduit rien :
 *    il affiche ce qui revient (`GET /me/audience`, `GET /recipients`, `canReply`).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const messagingUuidSchema = z.string().uuid();
export const messagingInstantSchema = z.string().datetime({ offset: true });

export const MESSAGING_CONVERSATION_KINDS = ["DIRECT", "GROUP", "SYSTEM"] as const;
export const messagingConversationKindSchema = z.enum(MESSAGING_CONVERSATION_KINDS);
export type MessagingConversationKind = z.infer<typeof messagingConversationKindSchema>;

export const MESSAGING_PARTICIPANT_ROLES = ["OWNER", "MEMBER"] as const;
export const messagingParticipantRoleSchema = z.enum(MESSAGING_PARTICIPANT_ROLES);

/** Qui est visé, dans une classe ou une annonce : élèves, tuteurs, personnel. */
export const MESSAGING_AUDIENCES = ["STUDENTS", "GUARDIANS", "STAFF"] as const;
export const messagingAudienceSchema = z.enum(MESSAGING_AUDIENCES);
export type MessagingAudience = z.infer<typeof messagingAudienceSchema>;

/** Qui est visé dans une classe, pour un message de groupe : élèves, tuteurs, enseignants de la classe. */
export const MESSAGING_CLASS_INCLUDES = ["STUDENTS", "GUARDIANS", "TEACHERS"] as const;
export const messagingClassIncludeSchema = z.enum(MESSAGING_CLASS_INCLUDES);
export type MessagingClassInclude = z.infer<typeof messagingClassIncludeSchema>;

/** Rôle d'un destinataire proposé dans le sélecteur. */
export const MESSAGING_RECIPIENT_KINDS = ["STUDENT", "GUARDIAN", "STAFF"] as const;
export const messagingRecipientKindSchema = z.enum(MESSAGING_RECIPIENT_KINDS);
export type MessagingRecipientKind = z.infer<typeof messagingRecipientKindSchema>;

export const MESSAGING_TARGET_KINDS = ["TENANT", "INSTITUTION", "CAMPUS", "LEVEL", "CLASSROOM", "ROLE"] as const;
export const messagingTargetKindSchema = z.enum(MESSAGING_TARGET_KINDS);
export type MessagingTargetKind = z.infer<typeof messagingTargetKindSchema>;

export const MESSAGING_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const messagingPrioritySchema = z.enum(MESSAGING_PRIORITIES);
export type MessagingPriority = z.infer<typeof messagingPrioritySchema>;

export const MESSAGING_ANNOUNCEMENT_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "WITHDRAWN"] as const;
export const messagingAnnouncementStatusSchema = z.enum(MESSAGING_ANNOUNCEMENT_STATUSES);
export type MessagingAnnouncementStatus = z.infer<typeof messagingAnnouncementStatusSchema>;

export const MESSAGING_STUDENT_POLICIES = ["DISABLED", "REPLY_ONLY", "TEACHERS", "TEACHERS_AND_ADMIN"] as const;
export const messagingStudentPolicySchema = z.enum(MESSAGING_STUDENT_POLICIES);
export type MessagingStudentPolicy = z.infer<typeof messagingStudentPolicySchema>;

export const MESSAGING_NOTIFICATION_CATEGORIES = ["MESSAGE", "ANNOUNCEMENT", "SYSTEM", "MODERATION"] as const;
export const messagingNotificationCategorySchema = z.enum(MESSAGING_NOTIFICATION_CATEGORIES);
export type MessagingNotificationCategory = z.infer<typeof messagingNotificationCategorySchema>;
/** Catégories pour lesquelles un utilisateur règle ses préférences (la modération est toujours notifiée). */
export const MESSAGING_PREFERENCE_CATEGORIES = ["MESSAGE", "ANNOUNCEMENT", "SYSTEM"] as const;
export const messagingPreferenceCategorySchema = z.enum(MESSAGING_PREFERENCE_CATEGORIES);

export const MESSAGING_EXTERNAL_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "PUSH"] as const;
export const messagingExternalChannelSchema = z.enum(MESSAGING_EXTERNAL_CHANNELS);
export type MessagingExternalChannel = z.infer<typeof messagingExternalChannelSchema>;

export const MESSAGING_REPORT_REASONS = ["SPAM", "HARASSMENT", "INAPPROPRIATE", "PRIVACY", "OTHER"] as const;
export const messagingReportReasonSchema = z.enum(MESSAGING_REPORT_REASONS);
export type MessagingReportReason = z.infer<typeof messagingReportReasonSchema>;
export const MESSAGING_REPORT_STATUSES = ["OPEN", "DISMISSED", "ACTIONED"] as const;
export const messagingReportStatusSchema = z.enum(MESSAGING_REPORT_STATUSES);

export const MESSAGING_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const messagingAttachmentTypeSchema = z.enum(MESSAGING_ATTACHMENT_TYPES);

export const MESSAGING_FOLDERS = ["inbox", "archived", "starred", "sent"] as const;
export const messagingFolderSchema = z.enum(MESSAGING_FOLDERS);

/** Plafonds structurels (les plafonds d'exploitation sont des paramètres d'établissement, `settings`). */
export const MESSAGING_LIMITS = Object.freeze({
  explicitRecipients: 50,
  classroomsPerMessage: 10,
  attachmentsPerItem: 20,
  targetsPerAnnouncement: 50,
  pageSize: 100,
  bodyMax: 20000,
});

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min <= 1 ? "Ce champ est obligatoire." : `${min} caractères au moins.`)
    .max(max, `${max} caractères au plus.`);
export const messagingBodySchema = text(1, MESSAGING_LIMITS.bodyMax);

// ---------------------------------------------------------------------------
// Cibles d'annonce et destinataires de groupe
// ---------------------------------------------------------------------------

const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Clé de rôle attendue : minuscules, chiffres et _.");

export const messagingTargetSchema = z
  .object({
    kind: messagingTargetKindSchema,
    /** UUID (établissement, campus, niveau, classe), clé de rôle (ROLE) ; absent pour TENANT. */
    ref: z.string().max(100).optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.kind === "TENANT") {
      if (t.ref) ctx.addIssue({ code: "custom", path: ["ref"], message: "Une cible « tout l'établissement » n'a pas de référence." });
      return;
    }
    if (!t.ref) {
      ctx.addIssue({ code: "custom", path: ["ref"], message: "La référence de la cible est obligatoire." });
      return;
    }
    const ok = t.kind === "ROLE" ? roleKeySchema.safeParse(t.ref).success : messagingUuidSchema.safeParse(t.ref).success;
    if (!ok) ctx.addIssue({ code: "custom", path: ["ref"], message: t.kind === "ROLE" ? "Clé de rôle invalide." : "Identifiant invalide." });
  });
export type MessagingTarget = z.infer<typeof messagingTargetSchema>;

export const messagingClassRecipientSchema = z
  .object({
    classroomId: messagingUuidSchema,
    include: z.array(messagingClassIncludeSchema).min(1).max(3),
  })
  .strict();
export type MessagingClassRecipient = z.infer<typeof messagingClassRecipientSchema>;

export const messagingAudienceSelectionSchema = z
  .object({
    targets: z.array(messagingTargetSchema).min(1, "Choisissez au moins une cible.").max(MESSAGING_LIMITS.targetsPerAnnouncement),
    audiences: z.array(messagingAudienceSchema).min(1, "Choisissez au moins une audience.").max(3).default(["STUDENTS", "GUARDIANS", "STAFF"]),
  })
  .strict();
export type MessagingAudienceSelection = z.infer<typeof messagingAudienceSelectionSchema>;

// ---------------------------------------------------------------------------
// Conversations et messages — entrées
// ---------------------------------------------------------------------------

export const messagingRecipientsSchema = z
  .object({
    userIds: z.array(messagingUuidSchema).max(MESSAGING_LIMITS.explicitRecipients).default([]),
    classrooms: z.array(messagingClassRecipientSchema).max(MESSAGING_LIMITS.classroomsPerMessage).default([]),
    /** Réservé à la diffusion administrative (permission `messaging.send.any`). */
    audience: messagingAudienceSelectionSchema.optional(),
    /** « Écrire à l'administration » : les contacts de l'administration (paramètre d'établissement, 30 au plus). */
    toAdministration: z.boolean().default(false),
  })
  .strict();
export type MessagingRecipients = z.infer<typeof messagingRecipientsSchema>;

export const messagingCreateConversationBodySchema = z
  .object({
    /** DIRECT : un destinataire ; GROUP : fil partagé ; BROADCAST : un fil PRIVÉ par destinataire (publipostage). */
    kind: z.enum(["DIRECT", "GROUP", "BROADCAST"]),
    subject: text(1, 200).optional(),
    priority: messagingPrioritySchema.default("NORMAL"),
    body: messagingBodySchema,
    recipients: messagingRecipientsSchema,
    /** Élève concerné (message parent <-> enseignant) : exige un lien avec l'élève pour un parent. */
    aboutStudentId: messagingUuidSchema.optional(),
    allowReplies: z.boolean().optional(),
    attachmentIds: z.array(messagingUuidSchema).max(MESSAGING_LIMITS.attachmentsPerItem).default([]),
    clientId: messagingUuidSchema.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const r = b.recipients;
    const count = r.userIds.length + r.classrooms.length + (r.audience ? 1 : 0) + (r.toAdministration ? 1 : 0);
    if (count === 0) ctx.addIssue({ code: "custom", path: ["recipients"], message: "Choisissez au moins un destinataire." });
    if (b.kind === "DIRECT" && !(r.userIds.length === 1 && r.classrooms.length === 0 && !r.audience && !r.toAdministration)) {
      ctx.addIssue({ code: "custom", path: ["recipients"], message: "Une conversation directe a exactement un destinataire." });
    }
    if (b.kind !== "DIRECT" && !b.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "Un message de groupe ou de diffusion a un objet." });
    if (b.kind === "BROADCAST" && r.toAdministration) {
      ctx.addIssue({ code: "custom", path: ["recipients", "toAdministration"], message: "Écrire à l'administration se fait dans un fil de groupe." });
    }
  });
export type MessagingCreateConversationBody = z.infer<typeof messagingCreateConversationBodySchema>;

export const messagingPostMessageBodySchema = z
  .object({
    body: messagingBodySchema,
    attachmentIds: z.array(messagingUuidSchema).max(MESSAGING_LIMITS.attachmentsPerItem).default([]),
    clientId: messagingUuidSchema.optional(),
  })
  .strict();
export type MessagingPostMessageBody = z.infer<typeof messagingPostMessageBodySchema>;

export const messagingMarkReadBodySchema = z.object({ upToSeq: z.number().int().min(0).optional() }).strict();

export const messagingParticipantStateBodySchema = z
  .object({ archived: z.boolean().optional(), muted: z.boolean().optional(), starred: z.boolean().optional() })
  .strict()
  .refine((b) => b.archived !== undefined || b.muted !== undefined || b.starred !== undefined, "Aucun changement demandé.");

export const messagingUploadAttachmentBodySchema = z
  .object({
    fileName: text(1, 255),
    /** Contenu en base64 (le type RÉEL est détecté sur les octets, jamais celui que déclare le client). */
    contentBase64: z.string().min(4).max(40 * 1024 * 1024),
  })
  .strict();

export const messagingReportBodySchema = z
  .object({ reason: messagingReportReasonSchema, details: text(1, 1000).optional() })
  .strict();

export const messagingConversationListQuerySchema = z
  .object({
    folder: messagingFolderSchema.default("inbox"),
    q: text(1, 100).optional(),
    unread: z.enum(["true", "false"]).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(30),
  })
  .strict();

export const messagingMessagesQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(50),
  })
  .strict();

export const messagingSearchQuerySchema = z.object({ q: text(2, 100), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();

export const messagingRecipientsQuerySchema = z
  .object({
    q: text(1, 100).optional(),
    classroomId: messagingUuidSchema.optional(),
    kind: messagingRecipientKindSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// Conversations et messages — sorties
// ---------------------------------------------------------------------------

export const messagingParticipantDtoSchema = z.object({
  userId: messagingUuidSchema,
  displayName: z.string(),
  role: messagingParticipantRoleSchema,
  left: z.boolean(),
});
export type MessagingParticipantDto = z.infer<typeof messagingParticipantDtoSchema>;

export const messagingAttachmentDtoSchema = z.object({
  id: messagingUuidSchema,
  fileName: z.string(),
  mimeType: messagingAttachmentTypeSchema,
  sizeBytes: z.number().int(),
});
export type MessagingAttachmentDto = z.infer<typeof messagingAttachmentDtoSchema>;

export const messagingMessageDtoSchema = z.object({
  id: messagingUuidSchema,
  conversationId: messagingUuidSchema,
  seq: z.number().int(),
  kind: z.enum(["USER", "SYSTEM"]),
  senderId: messagingUuidSchema.nullable(),
  senderName: z.string().nullable(),
  /** `null` si le message a été retiré (par son auteur ou la modération). */
  body: z.string().nullable(),
  removed: z.boolean(),
  removalKind: z.enum(["SENDER", "MODERATOR"]).nullable(),
  mine: z.boolean(),
  systemCode: z.string().nullable(),
  attachments: z.array(messagingAttachmentDtoSchema),
  createdAt: messagingInstantSchema,
});
export type MessagingMessageDto = z.infer<typeof messagingMessageDtoSchema>;

export const messagingConversationSummaryDtoSchema = z.object({
  id: messagingUuidSchema,
  kind: messagingConversationKindSchema,
  subject: z.string().nullable(),
  priority: messagingPrioritySchema,
  aboutStudentId: messagingUuidSchema.nullable(),
  classroomId: messagingUuidSchema.nullable(),
  /** Diffusion : nombre de fils privés issus du même envoi (dossier « envoyés » : une ligne par diffusion). */
  broadcastCount: z.number().int().nullable(),
  participantCount: z.number().int(),
  /** Autres participants (6 au plus) pour l'affichage de la liste. */
  participants: z.array(messagingParticipantDtoSchema),
  lastMessageAt: messagingInstantSchema.nullable(),
  lastPreview: z.string().nullable(),
  unreadCount: z.number().int(),
  archived: z.boolean(),
  muted: z.boolean(),
  starred: z.boolean(),
  allowReplies: z.boolean(),
  closed: z.boolean(),
});
export type MessagingConversationSummaryDto = z.infer<typeof messagingConversationSummaryDtoSchema>;

export const messagingConversationPageDtoSchema = z.object({
  items: z.array(messagingConversationSummaryDtoSchema),
  nextCursor: z.string().nullable(),
});

export const messagingConversationDetailDtoSchema = z.object({
  conversation: messagingConversationSummaryDtoSchema,
  participants: z.array(messagingParticipantDtoSchema),
  /** Faux si l'utilisateur ne peut pas répondre (fil fermé, réponses désactivées, restriction, politique élève). */
  canReply: z.boolean(),
  replyBlockedReason: z.string().nullable(),
});
export type MessagingConversationDetailDto = z.infer<typeof messagingConversationDetailDtoSchema>;

export const messagingMessagesPageDtoSchema = z.object({
  items: z.array(messagingMessageDtoSchema),
  /** `seq` à passer en `before` pour la page précédente ; `null` = début du fil. */
  nextBefore: z.number().int().nullable(),
});

export const messagingSendResultDtoSchema = z.object({
  /** `null` pour une diffusion (autant de fils que de destinataires : voir `broadcastId`). */
  conversation: messagingConversationSummaryDtoSchema.nullable(),
  message: messagingMessageDtoSchema.nullable(),
  broadcastId: messagingUuidSchema.nullable(),
  /** Vrai si le message a rejoint un fil direct existant (même paire, élève et objet). */
  reused: z.boolean(),
  recipientCount: z.number().int(),
});
export type MessagingSendResultDto = z.infer<typeof messagingSendResultDtoSchema>;

export const messagingSearchHitDtoSchema = z.object({
  conversationId: messagingUuidSchema,
  messageId: messagingUuidSchema,
  seq: z.number().int(),
  subject: z.string().nullable(),
  senderName: z.string().nullable(),
  snippet: z.string(),
  createdAt: messagingInstantSchema,
});
export const messagingSearchResultDtoSchema = z.object({ items: z.array(messagingSearchHitDtoSchema) });

export const messagingSignedUrlDtoSchema = z.object({ url: z.string().url(), expiresAt: messagingInstantSchema });

// ---------------------------------------------------------------------------
// Destinataires autorisés et profil d'audience de l'utilisateur
// ---------------------------------------------------------------------------

export const messagingRecipientDtoSchema = z.object({
  userId: messagingUuidSchema,
  displayName: z.string(),
  kind: messagingRecipientKindSchema,
  /** Libellé du lien (« Enseignant de 6ème A », « Parent de Awa Koné »…). */
  relation: z.string(),
  classroomId: messagingUuidSchema.nullable(),
  studentId: messagingUuidSchema.nullable(),
});
export type MessagingRecipientDto = z.infer<typeof messagingRecipientDtoSchema>;
export const messagingRecipientListDtoSchema = z.object({ items: z.array(messagingRecipientDtoSchema) });

export const messagingMyAudienceDtoSchema = z.object({
  userId: messagingUuidSchema,
  canSend: z.boolean(),
  canSendAny: z.boolean(),
  canPublishAnnouncements: z.boolean(),
  canManageAnnouncements: z.boolean(),
  canModerate: z.boolean(),
  /** Classes (nom, id) que l'utilisateur peut écrire en bloc : classes affectées (enseignant) ou classes de ses enfants (parent, lecture). */
  classrooms: z.array(z.object({ id: messagingUuidSchema, name: z.string() })),
  studentPolicy: messagingStudentPolicySchema,
  isStudent: z.boolean(),
  isGuardian: z.boolean(),
  isStaff: z.boolean(),
  restrictedUntil: messagingInstantSchema.nullable(),
  restricted: z.boolean(),
});
export type MessagingMyAudienceDto = z.infer<typeof messagingMyAudienceDtoSchema>;

export const messagingUnreadDtoSchema = z.object({
  conversations: z.number().int(),
  announcements: z.number().int(),
  notifications: z.number().int(),
});
export type MessagingUnreadDto = z.infer<typeof messagingUnreadDtoSchema>;

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

export const messagingCreateAnnouncementBodySchema = z
  .object({
    title: text(1, 200),
    body: messagingBodySchema,
    priority: messagingPrioritySchema.default("NORMAL"),
    audience: messagingAudienceSelectionSchema,
    requireAck: z.boolean().default(false),
    pinned: z.boolean().default(false),
    publishAt: messagingInstantSchema.optional(),
    expiresAt: messagingInstantSchema.optional(),
    attachmentIds: z.array(messagingUuidSchema).max(MESSAGING_LIMITS.attachmentsPerItem).default([]),
    /** `true` : publie (ou programme si `publishAt` est futur) ; sinon brouillon. */
    publish: z.boolean().default(false),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.publishAt && b.expiresAt && Date.parse(b.expiresAt) <= Date.parse(b.publishAt)) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "L'expiration doit suivre la publication." });
    }
  });
export type MessagingCreateAnnouncementBody = z.infer<typeof messagingCreateAnnouncementBodySchema>;

export const messagingUpdateAnnouncementBodySchema = z
  .object({
    title: text(1, 200).optional(),
    body: messagingBodySchema.optional(),
    priority: messagingPrioritySchema.optional(),
    audience: messagingAudienceSelectionSchema.optional(),
    requireAck: z.boolean().optional(),
    pinned: z.boolean().optional(),
    publishAt: messagingInstantSchema.nullable().optional(),
    expiresAt: messagingInstantSchema.nullable().optional(),
    attachmentIds: z.array(messagingUuidSchema).max(MESSAGING_LIMITS.attachmentsPerItem).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucun changement demandé.");
export type MessagingUpdateAnnouncementBody = z.infer<typeof messagingUpdateAnnouncementBodySchema>;

export const messagingPublishAnnouncementBodySchema = z.object({ publishAt: messagingInstantSchema.optional() }).strict();
export const messagingWithdrawAnnouncementBodySchema = z.object({ reason: text(3, 500) }).strict();

export const messagingAnnouncementListQuerySchema = z
  .object({
    scope: z.enum(["inbox", "managed"]).default("inbox"),
    status: messagingAnnouncementStatusSchema.optional(),
    includeExpired: z.enum(["true", "false"]).optional(),
    unread: z.enum(["true", "false"]).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(30),
  })
  .strict();

export const messagingReceiptsQuerySchema = z
  .object({
    state: z.enum(["all", "unread", "read", "acknowledged", "pending_ack"]).default("all"),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const messagingAudiencePreviewBodySchema = messagingAudienceSelectionSchema;

export const messagingAnnouncementTargetDtoSchema = z.object({ kind: messagingTargetKindSchema, ref: z.string().nullable() });

export const messagingAnnouncementDtoSchema = z.object({
  id: messagingUuidSchema,
  title: z.string(),
  body: z.string(),
  priority: messagingPrioritySchema,
  status: messagingAnnouncementStatusSchema,
  authorId: messagingUuidSchema,
  authorName: z.string(),
  audiences: z.array(messagingAudienceSchema),
  targets: z.array(messagingAnnouncementTargetDtoSchema),
  requireAck: z.boolean(),
  pinned: z.boolean(),
  publishAt: messagingInstantSchema.nullable(),
  expiresAt: messagingInstantSchema.nullable(),
  publishedAt: messagingInstantSchema.nullable(),
  withdrawnAt: messagingInstantSchema.nullable(),
  /** Vrai si l'annonce a dépassé son expiration (elle reste lisible dans l'historique). */
  expired: z.boolean(),
  attachments: z.array(messagingAttachmentDtoSchema),
  /** L'utilisateur courant est-il destinataire de l'annonce (sinon il la voit comme auteur ou gestionnaire) ? */
  isRecipient: z.boolean(),
  /** État de lecture de l'utilisateur courant (null si l'utilisateur n'est pas destinataire). */
  myReadAt: messagingInstantSchema.nullable(),
  myAcknowledgedAt: messagingInstantSchema.nullable(),
  /** Statistiques : réservées aux gestionnaires, sinon `null`. */
  stats: z
    .object({ recipients: z.number().int(), read: z.number().int(), acknowledged: z.number().int(), truncated: z.boolean() })
    .nullable(),
});
export type MessagingAnnouncementDto = z.infer<typeof messagingAnnouncementDtoSchema>;

export const messagingAnnouncementPageDtoSchema = z.object({
  items: z.array(messagingAnnouncementDtoSchema),
  nextCursor: z.string().nullable(),
});

export const messagingReceiptDtoSchema = z.object({
  userId: messagingUuidSchema,
  displayName: z.string().nullable(),
  deliveredAt: messagingInstantSchema,
  readAt: messagingInstantSchema.nullable(),
  acknowledgedAt: messagingInstantSchema.nullable(),
});
export const messagingReceiptPageDtoSchema = z.object({ items: z.array(messagingReceiptDtoSchema), nextCursor: z.string().nullable() });

export const messagingAudiencePreviewDtoSchema = z.object({ count: z.number().int(), truncated: z.boolean() });

// ---------------------------------------------------------------------------
// Notifications in-app et préférences
// ---------------------------------------------------------------------------

export const messagingNotificationDtoSchema = z.object({
  id: messagingUuidSchema,
  category: messagingNotificationCategorySchema,
  title: z.string(),
  body: z.string().nullable(),
  /** Chemin interne (`/v2/messages/<id>`), jamais une URL externe. */
  link: z.string().nullable(),
  occurrences: z.number().int(),
  createdAt: messagingInstantSchema,
  updatedAt: messagingInstantSchema,
  readAt: messagingInstantSchema.nullable(),
});
export type MessagingNotificationDto = z.infer<typeof messagingNotificationDtoSchema>;

export const messagingNotificationListQuerySchema = z
  .object({
    unread: z.enum(["true", "false"]).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(30),
  })
  .strict();

export const messagingNotificationPageDtoSchema = z.object({
  items: z.array(messagingNotificationDtoSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int(),
});

export const messagingPreferenceDtoSchema = z.object({
  category: messagingPreferenceCategorySchema,
  inApp: z.boolean(),
  externalChannels: z.array(messagingExternalChannelSchema),
  mutedUntil: messagingInstantSchema.nullable(),
});
export type MessagingPreferenceDto = z.infer<typeof messagingPreferenceDtoSchema>;
export const messagingPreferenceListDtoSchema = z.object({ items: z.array(messagingPreferenceDtoSchema) });

export const messagingUpdatePreferencesBodySchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            category: messagingPreferenceCategorySchema,
            inApp: z.boolean().optional(),
            externalChannels: z.array(messagingExternalChannelSchema).max(4).optional(),
            mutedUntil: messagingInstantSchema.nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

// ---------------------------------------------------------------------------
// Modération
// ---------------------------------------------------------------------------

export const messagingReportDtoSchema = z.object({
  id: messagingUuidSchema,
  messageId: messagingUuidSchema,
  conversationId: messagingUuidSchema,
  reporterId: messagingUuidSchema,
  reporterName: z.string().nullable(),
  reason: messagingReportReasonSchema,
  details: z.string().nullable(),
  status: messagingReportStatusSchema,
  decidedBy: messagingUuidSchema.nullable(),
  decidedAt: messagingInstantSchema.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: messagingInstantSchema,
});
export type MessagingReportDto = z.infer<typeof messagingReportDtoSchema>;
export const messagingReportPageDtoSchema = z.object({ items: z.array(messagingReportDtoSchema), nextCursor: z.string().nullable() });

export const messagingReportQuerySchema = z
  .object({
    status: messagingReportStatusSchema.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(30),
  })
  .strict();

/** Contexte d'un signalement : le message signalé et quelques messages voisins (lecture AUDITÉE, permission sensible). */
export const messagingReportContextDtoSchema = z.object({
  report: messagingReportDtoSchema,
  subject: z.string().nullable(),
  participants: z.array(messagingParticipantDtoSchema),
  messages: z.array(messagingMessageDtoSchema.extend({ rawBody: z.string() })),
});

export const messagingDecideReportBodySchema = z
  .object({
    decision: z.enum(["DISMISS", "ACTION"]),
    note: text(3, 1000),
    removeMessage: z.boolean().default(false),
    restrictSender: z.object({ untilDays: z.number().int().min(1).max(365).nullable() }).strict().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.decision === "DISMISS" && (b.removeMessage || b.restrictSender)) {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "Un rejet n'entraîne ni retrait ni restriction." });
    }
    if (b.decision === "ACTION" && !b.removeMessage && !b.restrictSender) {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "Précisez l'action : retirer le message et/ou restreindre l'auteur." });
    }
  });
export type MessagingDecideReportBody = z.infer<typeof messagingDecideReportBodySchema>;

export const messagingRestrictionDtoSchema = z.object({
  userId: messagingUuidSchema,
  displayName: z.string().nullable(),
  restrictedUntil: messagingInstantSchema.nullable(),
  reason: z.string(),
  setBy: messagingUuidSchema,
  setAt: messagingInstantSchema,
});
export const messagingRestrictionListDtoSchema = z.object({ items: z.array(messagingRestrictionDtoSchema) });

/** Supervision (parité legacy « vue admin des messages enseignants ») : métadonnées sans motif, contenu avec motif OBLIGATOIRE et audité. */
export const messagingSuperviseListQuerySchema = z
  .object({ q: text(1, 100).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(30) })
  .strict();
export const messagingSuperviseMessagesQuerySchema = z
  .object({ reason: text(3, 500), before: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(MESSAGING_LIMITS.pageSize).default(50) })
  .strict();
export const messagingSuperviseMessagesDtoSchema = z.object({
  conversation: messagingConversationSummaryDtoSchema,
  participants: z.array(messagingParticipantDtoSchema),
  items: z.array(messagingMessageDtoSchema.extend({ rawBody: z.string() })),
  nextBefore: z.number().int().nullable(),
});

export const messagingSetRestrictionBodySchema = z
  .object({ userId: messagingUuidSchema, reason: text(3, 1000), untilDays: z.number().int().min(1).max(365).nullable().default(null) })
  .strict();

// ---------------------------------------------------------------------------
// Paramètres et modèles de messages système
// ---------------------------------------------------------------------------

export const messagingSettingsDtoSchema = z.object({
  studentPolicy: messagingStudentPolicySchema,
  adminContactRoles: z.array(roleKeySchema),
  attachmentsEnabled: z.boolean(),
  attachmentMaxBytes: z.number().int(),
  attachmentMaxPerItem: z.number().int(),
  allowedAttachmentTypes: z.array(messagingAttachmentTypeSchema),
  maxMessagesPerHour: z.number().int(),
  maxNewConversationsPerDay: z.number().int(),
  maxGroupParticipants: z.number().int(),
  maxBroadcastParticipants: z.number().int(),
  messageMaxLength: z.number().int(),
  notificationRetentionDays: z.number().int(),
});
export type MessagingSettingsDto = z.infer<typeof messagingSettingsDtoSchema>;

export const messagingUpdateSettingsBodySchema = z
  .object({
    studentPolicy: messagingStudentPolicySchema.optional(),
    adminContactRoles: z.array(roleKeySchema).max(20).optional(),
    attachmentsEnabled: z.boolean().optional(),
    attachmentMaxBytes: z.number().int().min(1).max(25 * 1024 * 1024).optional(),
    attachmentMaxPerItem: z.number().int().min(1).max(20).optional(),
    allowedAttachmentTypes: z.array(messagingAttachmentTypeSchema).min(1).optional(),
    maxMessagesPerHour: z.number().int().min(1).max(10000).optional(),
    maxNewConversationsPerDay: z.number().int().min(1).max(10000).optional(),
    maxGroupParticipants: z.number().int().min(2).max(5000).optional(),
    maxBroadcastParticipants: z.number().int().min(2).max(20000).optional(),
    messageMaxLength: z.number().int().min(100).max(20000).optional(),
    notificationRetentionDays: z.number().int().min(7).max(3650).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucun changement demandé.");
export type MessagingUpdateSettingsBody = z.infer<typeof messagingUpdateSettingsBodySchema>;

export const messagingSystemTemplateDtoSchema = z.object({
  code: z.string(),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  /** Variables disponibles dans le texte (`{{studentName}}`…). */
  variables: z.array(z.string()),
  customized: z.boolean(),
});
export type MessagingSystemTemplateDto = z.infer<typeof messagingSystemTemplateDtoSchema>;
export const messagingSystemTemplateListDtoSchema = z.object({ items: z.array(messagingSystemTemplateDtoSchema) });
export const messagingUpdateTemplateBodySchema = z
  .object({ title: text(1, 200).optional(), body: text(1, 2000).optional(), enabled: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucun changement demandé.");

// ---------------------------------------------------------------------------
// Codes d'erreur stables
// ---------------------------------------------------------------------------

export const MESSAGING_ERROR_CODES = [
  "messaging.invalid_input",
  "messaging.forbidden",
  "messaging.port_unavailable",
  "messaging.recipient_not_allowed",
  "messaging.recipient_not_found",
  "messaging.too_many_recipients",
  "messaging.conversation_not_found",
  "messaging.conversation_closed",
  "messaging.replies_disabled",
  "messaging.not_a_participant",
  "messaging.message_not_found",
  "messaging.message_too_long",
  "messaging.student_messaging_disabled",
  "messaging.sender_restricted",
  "messaging.rate_limited",
  "messaging.attachments_disabled",
  "messaging.attachment_too_large",
  "messaging.attachment_type_rejected",
  "messaging.attachment_not_found",
  "messaging.too_many_attachments",
  "messaging.announcement_not_found",
  "messaging.announcement_not_editable",
  "messaging.announcement_invalid_state",
  "messaging.audience_empty",
  "messaging.target_not_allowed",
  "messaging.target_not_found",
  "messaging.report_not_found",
  "messaging.report_already_decided",
  "messaging.already_reported",
  "messaging.template_not_found",
  "messaging.notification_not_found",
  "messaging.restriction_not_found",
] as const;
export type MessagingErrorCode = (typeof MESSAGING_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Événements (outbox, payload `{ v: 1, … }`) — jamais de texte de message ni d'annonce
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });

export const messagingEventPayloadSchemas = {
  "messaging.conversation.created": ev({
    conversationId: messagingUuidSchema,
    kind: messagingConversationKindSchema,
    createdBy: messagingUuidSchema.nullable(),
    participantCount: z.number().int(),
    classroomId: messagingUuidSchema.nullable(),
    aboutStudentId: messagingUuidSchema.nullable(),
  }),
  "messaging.message.sent": ev({
    conversationId: messagingUuidSchema,
    messageId: messagingUuidSchema,
    senderId: messagingUuidSchema.nullable(),
    kind: z.enum(["USER", "SYSTEM"]),
    recipientCount: z.number().int(),
    attachmentCount: z.number().int(),
    systemCode: z.string().nullable(),
  }),
  "messaging.message.removed": ev({
    conversationId: messagingUuidSchema,
    messageId: messagingUuidSchema,
    removedBy: messagingUuidSchema,
    removalKind: z.enum(["SENDER", "MODERATOR"]),
  }),
  "messaging.message.reported": ev({
    reportId: messagingUuidSchema,
    messageId: messagingUuidSchema,
    conversationId: messagingUuidSchema,
    reason: messagingReportReasonSchema,
  }),
  "messaging.report.decided": ev({
    reportId: messagingUuidSchema,
    messageId: messagingUuidSchema,
    status: z.enum(["DISMISSED", "ACTIONED"]),
    messageRemoved: z.boolean(),
    senderRestricted: z.boolean(),
  }),
  "messaging.user.restricted": ev({ userId: messagingUuidSchema, restrictedUntil: messagingInstantSchema.nullable(), setBy: messagingUuidSchema }),
  "messaging.user.unrestricted": ev({ userId: messagingUuidSchema, liftedBy: messagingUuidSchema }),
  "messaging.announcement.published": ev({
    announcementId: messagingUuidSchema,
    priority: messagingPrioritySchema,
    authorId: messagingUuidSchema,
    recipientCount: z.number().int(),
    requireAck: z.boolean(),
  }),
  "messaging.announcement.withdrawn": ev({ announcementId: messagingUuidSchema, withdrawnBy: messagingUuidSchema }),
  "messaging.announcement.acknowledged": ev({ announcementId: messagingUuidSchema, userId: messagingUuidSchema }),
} as const;
export type MessagingEventType = keyof typeof messagingEventPayloadSchemas;
export const MESSAGING_EVENT_TYPES = Object.keys(messagingEventPayloadSchemas) as MessagingEventType[];
