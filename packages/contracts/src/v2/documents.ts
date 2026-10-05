/**
 * Contrats du module `documents` (routes `/api/v1/documents/*`, événements `documents.*`) — spec v2/024-documents :
 * GED légère multi-tenant (catégories configurables, versions immuables, expiration, permissions fines, stockage objet,
 * URL signées, prévisualisation, contrôle des uploads, quarantaine, audit).
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. Les utilisateurs sont des identités IAM ; élèves et membres du personnel sont des références
 *    SANS clé étrangère, vérifiées par le port `OwnerDirectory` (people).
 *  - INSTANTS : ISO 8601 avec fuseau ; ÉCHÉANCES d'expiration : date calendaire `YYYY-MM-DD`.
 *  - AUCUN titre ni nom de fichier dans un événement : identifiants, comptes, seuils seulement.
 *  - Messages utilisateur en français ; codes d'erreur stables `documents.*`.
 *  - Autorisation : décidée par l'API (permissions RBAC + niveau de catégorie + propriétaire + tuteur lié + partages). Le client
 *    ne déduit rien : il affiche ce qui revient (`GET /me/context`, `access` de chaque document, `canUpload` des catégories).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const documentsUuidSchema = z.string().uuid();
export const documentsInstantSchema = z.string().datetime({ offset: true });
/** Date calendaire `YYYY-MM-DD` (échéance d'un document). */
export const documentsDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date attendue au format AAAA-MM-JJ.");

/** Les cinq types du PRD §39 : StudentDocument, TeacherDocument, InstitutionDocument, AcademicDocument, FinancialDocument. */
export const DOCUMENT_KINDS = ["STUDENT", "TEACHER", "INSTITUTION", "ACADEMIC", "FINANCIAL"] as const;
export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof documentKindSchema>;

/** Niveau de confidentialité d'une catégorie = permission de lecture exigée (`read` < `read.restricted` < `read.confidential`). */
export const DOCUMENT_CONFIDENTIALITIES = ["INTERNAL", "RESTRICTED", "CONFIDENTIAL"] as const;
export const documentConfidentialitySchema = z.enum(DOCUMENT_CONFIDENTIALITIES);
export type DocumentConfidentiality = z.infer<typeof documentConfidentialitySchema>;

export const DOCUMENT_OWNER_TYPES = ["STUDENT", "STAFF", "NONE"] as const;
export const documentOwnerTypeSchema = z.enum(DOCUMENT_OWNER_TYPES);
export type DocumentOwnerType = z.infer<typeof documentOwnerTypeSchema>;

export const DOCUMENT_VISIBILITIES = ["INHERIT", "STAFF_ONLY", "PRIVATE"] as const;
export const documentVisibilitySchema = z.enum(DOCUMENT_VISIBILITIES);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

export const DOCUMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const DOCUMENT_SHARE_LEVELS = ["READ", "WRITE"] as const;
export const documentShareLevelSchema = z.enum(DOCUMENT_SHARE_LEVELS);
export type DocumentShareLevel = z.infer<typeof documentShareLevelSchema>;

export const DOCUMENT_CATEGORY_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const documentCategoryStatusSchema = z.enum(DOCUMENT_CATEGORY_STATUSES);

export const DOCUMENT_SCAN_STATUSES = ["CLEAN", "UNSCANNED"] as const;
export const documentScanStatusSchema = z.enum(DOCUMENT_SCAN_STATUSES);

export const DOCUMENT_VERSION_STATES = ["ACTIVE", "PURGED"] as const;
export const documentVersionStateSchema = z.enum(DOCUMENT_VERSION_STATES);

export const DOCUMENT_QUARANTINE_STATUSES = ["HELD", "RELEASED", "DELETED"] as const;
export const documentQuarantineStatusSchema = z.enum(DOCUMENT_QUARANTINE_STATUSES);

export const DOCUMENT_PREVIEW_KINDS = ["IMAGE", "PDF", "TEXT", "OFFICE", "NONE"] as const;
export const documentPreviewKindSchema = z.enum(DOCUMENT_PREVIEW_KINDS);
export type DocumentPreviewKind = z.infer<typeof documentPreviewKindSchema>;

export const DOCUMENT_EXPIRY_STATES = ["NONE", "VALID", "EXPIRING", "EXPIRED"] as const;
export const documentExpiryStateSchema = z.enum(DOCUMENT_EXPIRY_STATES);
export type DocumentExpiryState = z.infer<typeof documentExpiryStateSchema>;

/** Portée d'une liste : tout ce que je vois, mes dépôts, partagés avec moi, mes enfants, moi-même, mes documents de personnel. */
export const DOCUMENT_LIST_SCOPES = ["all", "mine", "shared", "child", "self", "own"] as const;
export const documentListScopeSchema = z.enum(DOCUMENT_LIST_SCOPES);

export const DOCUMENT_HISTORY_ACTIONS = [
  "CREATED",
  "VERSION_ADDED",
  "UPDATED",
  "VIEWED",
  "PREVIEWED",
  "DOWNLOADED",
  "SHARED",
  "UNSHARED",
  "ARCHIVED",
  "RESTORED",
  "EXPIRY_ALERTED",
  "EXPIRED",
  "PURGED",
  "INTEGRITY_FAILED",
] as const;
export const documentHistoryActionSchema = z.enum(DOCUMENT_HISTORY_ACTIONS);
export type DocumentHistoryAction = z.infer<typeof documentHistoryActionSchema>;

/**
 * Extensions que la plateforme sait VÉRIFIER par octets magiques (liste fermée). Une catégorie ne peut autoriser que des
 * extensions de cette liste ; le type déclaré par le client n'est jamais cru.
 */
export const DOCUMENT_SUPPORTED_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "tif",
  "tiff",
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
  "txt",
  "csv",
] as const;
export const documentExtensionSchema = z.enum(DOCUMENT_SUPPORTED_EXTENSIONS);
export type DocumentExtension = z.infer<typeof documentExtensionSchema>;

/** Limites de bon sens (aussi portées par les CHECK SQL). */
export const DOCUMENT_LIMITS = Object.freeze({
  titleMax: 200,
  descriptionMax: 2000,
  noteMax: 500,
  tagsMax: 20,
  tagMax: 40,
  metadataKeysMax: 20,
  metadataValueMax: 500,
  categoryLabelMax: 120,
  fileNameMax: 120,
  alertDaysMax: 10,
  /** Plafond absolu d'un fichier, quelle que soit la configuration (le plafond de plateforme est ≤ ce chiffre). */
  absoluteMaxBytes: 104_857_600,
  defaultMaxBytes: 15_728_640,
  pageSizeMax: 100,
});

// ---------------------------------------------------------------------------
// Descripteurs
// ---------------------------------------------------------------------------

const titleSchema = z.string().trim().min(1, "Titre obligatoire.").max(DOCUMENT_LIMITS.titleMax);
const descriptionSchema = z.string().trim().max(DOCUMENT_LIMITS.descriptionMax);
const noteSchema = z.string().trim().max(DOCUMENT_LIMITS.noteMax);

export const documentTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(DOCUMENT_LIMITS.tagMax)
  // eslint-disable-next-line no-control-regex
  .refine((t) => !/[\u0000-\u001f\u007f,]/.test(t), "Étiquette invalide.");
export const documentTagsSchema = z.array(documentTagSchema).max(DOCUMENT_LIMITS.tagsMax);

export const documentMetadataKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, "Clé de métadonnée invalide.");
export const documentMetadataValueSchema = z.union([z.string().max(DOCUMENT_LIMITS.metadataValueMax), z.number().finite(), z.boolean()]);
/** Objet PLAT de métadonnées libres (au plus 20 clés). */
export const documentMetadataSchema = z
  .record(documentMetadataKeySchema, documentMetadataValueSchema)
  .refine((o) => Object.keys(o).length <= DOCUMENT_LIMITS.metadataKeysMax, `Au plus ${DOCUMENT_LIMITS.metadataKeysMax} métadonnées.`);
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

/** Seuils d'alerte d'expiration, en jours avant l'échéance (décroissants ou non : le domaine les ordonne). */
export const documentAlertDaysSchema = z.array(z.number().int().min(0).max(365)).min(1).max(DOCUMENT_LIMITS.alertDaysMax);

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export const documentCategoryCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Code : majuscules, chiffres et _ (2 à 40 caractères).");

export const documentCategoryDtoSchema = z.object({
  id: documentsUuidSchema,
  code: documentCategoryCodeSchema,
  label: z.string(),
  description: z.string().nullable(),
  kind: documentKindSchema,
  confidentiality: documentConfidentialitySchema,
  allowedExtensions: z.array(documentExtensionSchema),
  maxBytes: z.number().int().positive().nullable(),
  audienceOwner: z.boolean(),
  audienceGuardians: z.boolean(),
  ownerUpload: z.boolean(),
  requiresExpiry: z.boolean(),
  alertDays: documentAlertDaysSchema.nullable(),
  retentionDays: z.number().int().min(0).nullable(),
  status: documentCategoryStatusSchema,
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  /** L'appelant peut-il déposer dans cette catégorie (au moins pour certains propriétaires) ? Contrôlé à nouveau par l'API. */
  canUpload: z.boolean(),
  documentCount: z.number().int().min(0).nullable(),
});
export type DocumentCategoryDto = z.infer<typeof documentCategoryDtoSchema>;
export const documentCategoryListDtoSchema = z.object({ items: z.array(documentCategoryDtoSchema) });

const categoryFields = {
  label: z.string().trim().min(1).max(DOCUMENT_LIMITS.categoryLabelMax),
  description: z.string().trim().max(DOCUMENT_LIMITS.descriptionMax).nullable(),
  confidentiality: documentConfidentialitySchema,
  allowedExtensions: z.array(documentExtensionSchema).min(1).max(DOCUMENT_SUPPORTED_EXTENSIONS.length),
  maxBytes: z.number().int().min(1).max(DOCUMENT_LIMITS.absoluteMaxBytes).nullable(),
  audienceOwner: z.boolean(),
  audienceGuardians: z.boolean(),
  ownerUpload: z.boolean(),
  requiresExpiry: z.boolean(),
  alertDays: documentAlertDaysSchema.nullable(),
  retentionDays: z.number().int().min(0).max(3650).nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
};

export const documentCreateCategoryBodySchema = z.object({
  code: documentCategoryCodeSchema,
  kind: documentKindSchema,
  label: categoryFields.label,
  description: categoryFields.description.optional(),
  confidentiality: categoryFields.confidentiality.default("RESTRICTED"),
  allowedExtensions: categoryFields.allowedExtensions.default(["pdf", "jpg", "jpeg", "png"]),
  maxBytes: categoryFields.maxBytes.optional(),
  audienceOwner: categoryFields.audienceOwner.default(false),
  audienceGuardians: categoryFields.audienceGuardians.default(false),
  ownerUpload: categoryFields.ownerUpload.default(false),
  requiresExpiry: categoryFields.requiresExpiry.default(false),
  alertDays: categoryFields.alertDays.optional(),
  retentionDays: categoryFields.retentionDays.optional(),
  sortOrder: categoryFields.sortOrder.default(100),
});
export type DocumentCreateCategoryBody = z.infer<typeof documentCreateCategoryBodySchema>;

/** Le type (`kind`) et le code ne changent jamais. */
export const documentUpdateCategoryBodySchema = z.object(categoryFields).partial().refine((o) => Object.keys(o).length > 0, "Aucune modification.");
export type DocumentUpdateCategoryBody = z.infer<typeof documentUpdateCategoryBodySchema>;

export const documentCategoryListQuerySchema = z.object({
  kind: documentKindSchema.optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

// Droits de catégorie par personne
export const documentCategoryGrantDtoSchema = z.object({
  id: documentsUuidSchema,
  categoryId: documentsUuidSchema,
  userId: documentsUuidSchema,
  userName: z.string().nullable(),
  level: documentShareLevelSchema,
  expiresAt: documentsInstantSchema.nullable(),
  note: z.string().nullable(),
  createdBy: documentsUuidSchema,
  createdAt: documentsInstantSchema,
  revokedAt: documentsInstantSchema.nullable(),
  active: z.boolean(),
});
export type DocumentCategoryGrantDto = z.infer<typeof documentCategoryGrantDtoSchema>;
export const documentCategoryGrantListDtoSchema = z.object({ items: z.array(documentCategoryGrantDtoSchema) });

export const documentGrantBodySchema = z.object({
  userId: documentsUuidSchema,
  level: documentShareLevelSchema,
  expiresAt: documentsInstantSchema.nullable().optional(),
  note: noteSchema.nullable().optional(),
});
export type DocumentGrantBody = z.infer<typeof documentGrantBodySchema>;

// ---------------------------------------------------------------------------
// Paramètres d'établissement et usage
// ---------------------------------------------------------------------------

export const documentSettingsDtoSchema = z.object({
  maxBytes: z.number().int().positive(),
  storageQuotaBytes: z.number().int().positive().nullable(),
  defaultAlertDays: documentAlertDaysSchema,
  archiveRetentionDays: z.number().int().min(0),
  quarantineRetentionDays: z.number().int().min(1),
  maxVersions: z.number().int().min(1),
  updatedAt: documentsInstantSchema.nullable(),
});
export type DocumentSettingsDto = z.infer<typeof documentSettingsDtoSchema>;

export const documentUpdateSettingsBodySchema = z
  .object({
    maxBytes: z.number().int().min(1).max(DOCUMENT_LIMITS.absoluteMaxBytes),
    storageQuotaBytes: z.number().int().min(1).nullable(),
    defaultAlertDays: documentAlertDaysSchema,
    archiveRetentionDays: z.number().int().min(0).max(3650),
    quarantineRetentionDays: z.number().int().min(1).max(365),
    maxVersions: z.number().int().min(1).max(500),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Aucune modification.");
export type DocumentUpdateSettingsBody = z.infer<typeof documentUpdateSettingsBodySchema>;

export const documentUsageDtoSchema = z.object({
  usedBytes: z.number().int().min(0),
  /** Quota effectif = min(plan, réglage de l'établissement). */
  quotaBytes: z.number().int().positive(),
  planQuotaBytes: z.number().int().positive(),
  documentCount: z.number().int().min(0),
  versionCount: z.number().int().min(0),
  quarantineHeldCount: z.number().int().min(0),
  archivedCount: z.number().int().min(0),
});
export type DocumentUsageDto = z.infer<typeof documentUsageDtoSchema>;

// ---------------------------------------------------------------------------
// Moi : capacités, liens, politique d'upload
// ---------------------------------------------------------------------------

export const documentMyContextDtoSchema = z.object({
  caps: z.object({
    read: z.boolean(),
    readRestricted: z.boolean(),
    readConfidential: z.boolean(),
    upload: z.boolean(),
    share: z.boolean(),
    archive: z.boolean(),
    manage: z.boolean(),
    historyRead: z.boolean(),
    categoryManage: z.boolean(),
    settingsManage: z.boolean(),
    quarantineManage: z.boolean(),
    childRead: z.boolean(),
    childUpload: z.boolean(),
    selfRead: z.boolean(),
    selfUpload: z.boolean(),
    ownRead: z.boolean(),
    ownUpload: z.boolean(),
  }),
  links: z.object({
    studentId: documentsUuidSchema.nullable(),
    studentName: z.string().nullable(),
    childStudentIds: z.array(documentsUuidSchema),
    /** Enfants liés (pour le sélecteur de dépôt d'un parent). */
    children: z.array(z.object({ id: documentsUuidSchema, displayName: z.string() })),
    staffId: documentsUuidSchema.nullable(),
    staffName: z.string().nullable(),
  }),
  upload: z.object({
    defaultMaxBytes: z.number().int().positive(),
    hardMaxBytes: z.number().int().positive(),
    supportedExtensions: z.array(documentExtensionSchema),
  }),
  scanner: z.object({ enabled: z.boolean(), failClosed: z.boolean() }),
  officePreview: z.boolean(),
});
export type DocumentMyContextDto = z.infer<typeof documentMyContextDtoSchema>;

// ---------------------------------------------------------------------------
// Documents et versions
// ---------------------------------------------------------------------------

export const documentVersionDtoSchema = z.object({
  versionNo: z.number().int().min(1),
  current: z.boolean(),
  fileName: z.string(),
  extension: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  scanStatus: documentScanStatusSchema,
  note: z.string().nullable(),
  uploadedBy: documentsUuidSchema,
  uploadedByName: z.string().nullable(),
  createdAt: documentsInstantSchema,
  state: documentVersionStateSchema,
  previewKind: documentPreviewKindSchema,
});
export type DocumentVersionDto = z.infer<typeof documentVersionDtoSchema>;

export const documentAccessDtoSchema = z.object({
  write: z.boolean(),
  share: z.boolean(),
  archive: z.boolean(),
  history: z.boolean(),
  /** Pourquoi je vois ce document : `MANAGER`, `UPLOADER`, `SHARE`, `CATEGORY_GRANT`, `LEVEL`, `OWNER`, `GUARDIAN`. */
  via: z.array(z.string()),
});
export type DocumentAccessDto = z.infer<typeof documentAccessDtoSchema>;

export const documentSummaryDtoSchema = z.object({
  id: documentsUuidSchema,
  kind: documentKindSchema,
  categoryId: documentsUuidSchema,
  categoryCode: z.string(),
  categoryLabel: z.string(),
  confidentiality: documentConfidentialitySchema,
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  ownerType: documentOwnerTypeSchema,
  ownerId: documentsUuidSchema.nullable(),
  ownerName: z.string().nullable(),
  visibility: documentVisibilitySchema,
  status: documentStatusSchema,
  currentVersionNo: z.number().int().min(1),
  versionCount: z.number().int().min(1),
  fileName: z.string(),
  extension: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().min(0),
  previewKind: documentPreviewKindSchema,
  expiresOn: documentsDateSchema.nullable(),
  expiryState: documentExpiryStateSchema,
  daysToExpiry: z.number().int().nullable(),
  createdBy: documentsUuidSchema,
  createdByName: z.string().nullable(),
  createdAt: documentsInstantSchema,
  updatedAt: documentsInstantSchema,
  access: documentAccessDtoSchema,
});
export type DocumentSummaryDto = z.infer<typeof documentSummaryDtoSchema>;

export const documentShareDtoSchema = z.object({
  id: documentsUuidSchema,
  userId: documentsUuidSchema,
  userName: z.string().nullable(),
  level: documentShareLevelSchema,
  expiresAt: documentsInstantSchema.nullable(),
  note: z.string().nullable(),
  createdBy: documentsUuidSchema,
  createdAt: documentsInstantSchema,
  revokedAt: documentsInstantSchema.nullable(),
  active: z.boolean(),
});
export type DocumentShareDto = z.infer<typeof documentShareDtoSchema>;
export const documentShareListDtoSchema = z.object({ items: z.array(documentShareDtoSchema) });

// ---------------------------------------------------------------------------
// Recherche dans le TEXTE des PDF (Q-14) : texte extrait par un job du worker (processus isolé), jamais d'OCR
// ---------------------------------------------------------------------------

/**
 * État d'indexation du texte de la version courante d'un PDF : `PENDING` (en attente du worker), `INDEXED` (cherchable),
 * `NO_TEXT` (PDF sans couche de texte, typiquement un scan : il n'y a pas d'OCR), `FAILED` (illisible : chiffré, corrompu, trop
 * gros, délai dépassé…).
 */
export const DOCUMENT_TEXT_INDEX_STATUSES = ["PENDING", "INDEXED", "NO_TEXT", "FAILED"] as const;
export const documentTextIndexStatusSchema = z.enum(DOCUMENT_TEXT_INDEX_STATUSES);
export type DocumentTextIndexStatus = z.infer<typeof documentTextIndexStatusSchema>;

/** Codes d'échec d'indexation (stables, affichés traduits côté client). */
export const DOCUMENT_TEXT_INDEX_ERRORS = ["corrupt", "encrypted", "too_large", "timeout", "memory", "crashed", "unavailable", "object_missing", "index_error"] as const;

export const documentTextIndexDtoSchema = z.object({
  status: documentTextIndexStatusSchema,
  versionNo: z.number().int().min(1),
  pageCount: z.number().int().min(0).nullable(),
  pagesIndexed: z.number().int().min(0).nullable(),
  /** Vrai si les limites de pages ou de caractères ont coupé la lecture : la fin du document n'est pas cherchable. */
  truncated: z.boolean(),
  indexedAt: documentsInstantSchema.nullable(),
  errorCode: z.string().nullable(),
});
export type DocumentTextIndexDto = z.infer<typeof documentTextIndexDtoSchema>;

export const DOCUMENT_TEXT_SEARCH_LIMITS = Object.freeze({ queryMin: 2, queryMax: 100, pageSizeMax: 50, pageSizeDefault: 20 });

export const documentTextSearchQuerySchema = z.object({
  /** Mots recherchés (syntaxe web : plusieurs mots = tous requis, « expression exacte », -exclu, OR). */
  q: z.string().trim().min(DOCUMENT_TEXT_SEARCH_LIMITS.queryMin, "Saisissez au moins 2 caractères.").max(DOCUMENT_TEXT_SEARCH_LIMITS.queryMax),
  categoryId: documentsUuidSchema.optional(),
  kind: documentKindSchema.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(DOCUMENT_TEXT_SEARCH_LIMITS.pageSizeMax).optional(),
});
export type DocumentTextSearchQuery = z.infer<typeof documentTextSearchQuerySchema>;

/** Segment d'extrait : le texte est TOUJOURS du texte brut (jamais du HTML) ; `match` marque les mots trouvés. */
export const documentTextSnippetSegmentSchema = z.object({ text: z.string(), match: z.boolean() });
export type DocumentTextSnippetSegment = z.infer<typeof documentTextSnippetSegmentSchema>;

export const documentTextHitDtoSchema = z.object({
  document: documentSummaryDtoSchema,
  snippet: z.array(documentTextSnippetSegmentSchema),
  versionNo: z.number().int().min(1),
  pageCount: z.number().int().min(0).nullable(),
  pagesIndexed: z.number().int().min(0).nullable(),
  truncated: z.boolean(),
  /** Pertinence (plus grand = plus pertinent) ; valeur relative, sans unité. */
  score: z.number(),
});
export type DocumentTextHitDto = z.infer<typeof documentTextHitDtoSchema>;

export const documentTextSearchPageDtoSchema = z.object({
  items: z.array(documentTextHitDtoSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentTextSearchPageDto = z.infer<typeof documentTextSearchPageDtoSchema>;

/** `FAILED` : ré-essaie les PDF en échec ; `ALL` : ré-extrait tous les PDF (l'index est vidé puis reconstruit par le worker). */
export const documentTextReindexBodySchema = z.object({ scope: z.enum(["FAILED", "ALL"]).default("FAILED") });
export type DocumentTextReindexBody = z.infer<typeof documentTextReindexBodySchema>;
export const documentTextReindexResultDtoSchema = z.object({ queued: z.number().int().min(0) });
export type DocumentTextReindexResultDto = z.infer<typeof documentTextReindexResultDtoSchema>;

export const documentTextIndexStatusDtoSchema = z.object({
  counts: z.object({ PENDING: z.number().int().min(0), INDEXED: z.number().int().min(0), NO_TEXT: z.number().int().min(0), FAILED: z.number().int().min(0) }),
  /** Cause la plus fréquente parmi les échecs (code), pour orienter l'exploitation. */
  failures: z.array(z.object({ errorCode: z.string(), count: z.number().int().min(0) })),
});
export type DocumentTextIndexStatusDto = z.infer<typeof documentTextIndexStatusDtoSchema>;

export const documentDetailDtoSchema = documentSummaryDtoSchema.extend({
  /** Indexation du texte de la version courante ; `null` si ce n'est pas un PDF. */
  textIndex: documentTextIndexDtoSchema.nullable().optional(),
  metadata: documentMetadataSchema,
  alertDays: documentAlertDaysSchema.nullable(),
  versions: z.array(documentVersionDtoSchema),
  /** Présent seulement pour qui peut partager. */
  shares: z.array(documentShareDtoSchema).nullable(),
  archivedAt: documentsInstantSchema.nullable(),
  archiveReason: z.string().nullable(),
  purgeAfter: documentsInstantSchema.nullable(),
});
export type DocumentDetailDto = z.infer<typeof documentDetailDtoSchema>;

export const documentPageDtoSchema = z.object({
  items: z.array(documentSummaryDtoSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentPageDto = z.infer<typeof documentPageDtoSchema>;

export const DOCUMENT_SORTS = ["updatedAt", "title", "expiresOn", "createdAt"] as const;
export const documentSortSchema = z.enum(DOCUMENT_SORTS);

export const documentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: documentsUuidSchema.optional(),
  kind: documentKindSchema.optional(),
  ownerType: documentOwnerTypeSchema.optional(),
  ownerId: documentsUuidSchema.optional(),
  /** `ARCHIVED` et `ALL` : réservés à la gestion (sinon 403). */
  status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional(),
  expiry: z.enum(["any", "expiring", "expired", "dated", "missing"]).optional(),
  withinDays: z.coerce.number().int().min(0).max(3650).optional(),
  scope: documentListScopeSchema.optional(),
  sort: documentSortSchema.optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(DOCUMENT_LIMITS.pageSizeMax).optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

/**
 * Champs du dépôt (multipart : ces champs + le champ `file`). Les listes et objets arrivent en TEXTE (JSON ou liste séparée par
 * des virgules) : `parseUploadFields` du module les normalise avant ce schéma.
 */
export const documentCreateFieldsSchema = z.object({
  categoryId: documentsUuidSchema,
  title: titleSchema,
  description: descriptionSchema.nullable().optional(),
  ownerType: documentOwnerTypeSchema.default("NONE"),
  ownerId: documentsUuidSchema.nullable().optional(),
  visibility: documentVisibilitySchema.default("INHERIT"),
  tags: documentTagsSchema.default([]),
  metadata: documentMetadataSchema.default({}),
  expiresOn: documentsDateSchema.nullable().optional(),
  alertDays: documentAlertDaysSchema.nullable().optional(),
  note: noteSchema.nullable().optional(),
});
export type DocumentCreateFields = z.infer<typeof documentCreateFieldsSchema>;

export const documentVersionFieldsSchema = z.object({
  note: noteSchema.nullable().optional(),
  expiresOn: documentsDateSchema.nullable().optional(),
  /** Version que l'utilisateur croit remplacer : refus `409 documents.version_conflict` si une autre est apparue. */
  baseVersion: z.coerce.number().int().min(1).optional(),
});
export type DocumentVersionFields = z.infer<typeof documentVersionFieldsSchema>;

export const documentUpdateBodySchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.nullable(),
    tags: documentTagsSchema,
    metadata: documentMetadataSchema,
    categoryId: documentsUuidSchema,
    visibility: documentVisibilitySchema,
    expiresOn: documentsDateSchema.nullable(),
    alertDays: documentAlertDaysSchema.nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Aucune modification.");
export type DocumentUpdateBody = z.infer<typeof documentUpdateBodySchema>;

export const documentArchiveBodySchema = z.object({ reason: z.string().trim().min(3, "Motif obligatoire.").max(DOCUMENT_LIMITS.noteMax) });
export type DocumentArchiveBody = z.infer<typeof documentArchiveBodySchema>;

/** Accusé d'archivage (un document archivé n'est plus visible hors gestion : pas de détail). */
export const documentArchiveResultDtoSchema = z.object({
  id: documentsUuidSchema,
  status: z.literal("ARCHIVED"),
  archivedAt: documentsInstantSchema,
  purgeAfter: documentsInstantSchema.nullable(),
});
export type DocumentArchiveResultDto = z.infer<typeof documentArchiveResultDtoSchema>;

export const documentShareBodySchema = z.object({
  userId: documentsUuidSchema,
  level: documentShareLevelSchema.default("READ"),
  expiresAt: documentsInstantSchema.nullable().optional(),
  note: noteSchema.nullable().optional(),
});
export type DocumentShareBody = z.infer<typeof documentShareBodySchema>;

export const documentSignedUrlDtoSchema = z.object({
  url: z.string().url(),
  expiresAt: documentsInstantSchema,
  fileName: z.string(),
  mime: z.string(),
  versionNo: z.number().int().min(1),
});
export type DocumentSignedUrlDto = z.infer<typeof documentSignedUrlDtoSchema>;

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export const documentHistoryEventDtoSchema = z.object({
  id: documentsUuidSchema,
  action: documentHistoryActionSchema,
  versionNo: z.number().int().nullable(),
  actorId: documentsUuidSchema.nullable(),
  actorName: z.string().nullable(),
  occurredAt: documentsInstantSchema,
  detail: z.record(z.unknown()),
});
export type DocumentHistoryEventDto = z.infer<typeof documentHistoryEventDtoSchema>;
export const documentHistoryPageDtoSchema = z.object({ items: z.array(documentHistoryEventDtoSchema), nextCursor: z.string().nullable() });
export type DocumentHistoryPageDto = z.infer<typeof documentHistoryPageDtoSchema>;
export const documentHistoryQuerySchema = z.object({ cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

// ---------------------------------------------------------------------------
// Quarantaine
// ---------------------------------------------------------------------------

export const documentQuarantineDtoSchema = z.object({
  id: documentsUuidSchema,
  status: documentQuarantineStatusSchema,
  fileName: z.string(),
  extension: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().min(0),
  sha256: z.string(),
  signature: z.string(),
  engine: z.string(),
  uploadedBy: documentsUuidSchema,
  uploadedByName: z.string().nullable(),
  createdAt: documentsInstantSchema,
  intentKind: z.enum(["CREATE", "VERSION"]),
  categoryId: documentsUuidSchema.nullable(),
  documentId: documentsUuidSchema.nullable(),
  decidedBy: documentsUuidSchema.nullable(),
  decidedAt: documentsInstantSchema.nullable(),
  decisionNote: z.string().nullable(),
  releasedDocumentId: documentsUuidSchema.nullable(),
});
export type DocumentQuarantineDto = z.infer<typeof documentQuarantineDtoSchema>;
export const documentQuarantinePageDtoSchema = z.object({ items: z.array(documentQuarantineDtoSchema), nextCursor: z.string().nullable() });
export const documentQuarantineQuerySchema = z.object({
  status: documentQuarantineStatusSchema.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const documentQuarantineDecisionBodySchema = z.object({ note: z.string().trim().min(3, "Motif obligatoire.").max(DOCUMENT_LIMITS.noteMax) });
export type DocumentQuarantineDecisionBody = z.infer<typeof documentQuarantineDecisionBodySchema>;

// ---------------------------------------------------------------------------
// Tableau de bord, recherche de personnes
// ---------------------------------------------------------------------------

export const documentSummaryCountsDtoSchema = z.object({
  expiring: z.number().int().min(0),
  expired: z.number().int().min(0),
  missingExpiry: z.number().int().min(0),
  total: z.number().int().min(0),
  quarantineHeld: z.number().int().min(0).nullable(),
  withinDays: z.number().int().min(0),
});
export type DocumentSummaryCountsDto = z.infer<typeof documentSummaryCountsDtoSchema>;

export const documentPersonDtoSchema = z.object({
  id: documentsUuidSchema,
  displayName: z.string(),
  /** `USER` : identité à partager ; `STUDENT` / `STAFF` : propriétaire possible d'un document. */
  kind: z.enum(["USER", "STUDENT", "STAFF"]),
  detail: z.string().nullable(),
});
export type DocumentPersonDto = z.infer<typeof documentPersonDtoSchema>;
export const documentPersonListDtoSchema = z.object({ items: z.array(documentPersonDtoSchema) });
export const documentPersonQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  kind: z.enum(["USER", "STUDENT", "STAFF"]).default("USER"),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});
export type DocumentPersonQuery = z.infer<typeof documentPersonQuerySchema>;

/** Tuteurs (identités) d'un élève : partage rapide. */
export const documentGuardianListDtoSchema = z.object({ items: z.array(documentPersonDtoSchema) });
export type DocumentGuardianListDto = z.infer<typeof documentGuardianListDtoSchema>;

// ---------------------------------------------------------------------------
// Codes d'erreur stables (partie du contrat d'API : ne jamais en renommer un)
// ---------------------------------------------------------------------------

export const DOCUMENTS_ERROR_CODES = [
  "documents.invalid_input",
  "documents.forbidden",
  "documents.port_unavailable",
  "documents.document_not_found",
  "documents.version_not_found",
  "documents.category_not_found",
  "documents.category_code_taken",
  "documents.category_archived",
  "documents.category_in_use",
  "documents.share_not_found",
  "documents.grant_not_found",
  "documents.quarantine_not_found",
  "documents.owner_not_found",
  "documents.owner_required",
  "documents.owner_not_allowed",
  "documents.kind_mismatch",
  "documents.file_missing",
  "documents.file_empty",
  "documents.file_too_large",
  "documents.type_undetected",
  "documents.type_mismatch",
  "documents.type_not_allowed",
  "documents.file_name_rejected",
  "documents.macro_content",
  "documents.malware_detected",
  "documents.scan_unavailable",
  "documents.quota_exceeded",
  "documents.duplicate",
  "documents.version_identical",
  "documents.version_conflict",
  "documents.too_many_versions",
  "documents.expiry_required",
  "documents.archived",
  "documents.not_archived",
  "documents.preview_unavailable",
  "documents.object_missing",
  "documents.integrity_failed",
  "documents.share_invalid",
  "documents.rate_limited",
] as const;
export type DocumentsErrorCode = (typeof DOCUMENTS_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Événements (payload `{ v: 1, … }`, identifiants seulement)
// ---------------------------------------------------------------------------

export const DOCUMENTS_EVENTS = Object.freeze({
  DOCUMENT_CREATED: "documents.document.created",
  DOCUMENT_VERSION_ADDED: "documents.document.version_added",
  DOCUMENT_UPDATED: "documents.document.updated",
  DOCUMENT_SHARED: "documents.document.shared",
  DOCUMENT_UNSHARED: "documents.document.unshared",
  DOCUMENT_ARCHIVED: "documents.document.archived",
  DOCUMENT_RESTORED: "documents.document.restored",
  DOCUMENT_PURGED: "documents.document.purged",
  DOCUMENT_EXPIRING: "documents.document.expiring",
  DOCUMENT_EXPIRED: "documents.document.expired",
  UPLOAD_QUARANTINED: "documents.upload.quarantined",
  QUARANTINE_RELEASED: "documents.quarantine.released",
  INTEGRITY_MISMATCH: "documents.integrity.mismatch",
} as const);
export type DocumentsEventType = (typeof DOCUMENTS_EVENTS)[keyof typeof DOCUMENTS_EVENTS];

const eventBase = {
  v: z.literal(1),
  documentId: documentsUuidSchema,
  categoryId: documentsUuidSchema,
  kind: documentKindSchema,
  ownerType: documentOwnerTypeSchema,
  ownerId: documentsUuidSchema.nullable(),
};

export const documentCreatedEventSchema = z.object({ ...eventBase, versionNo: z.number().int().min(1), createdBy: documentsUuidSchema });
export const documentVersionAddedEventSchema = z.object({ ...eventBase, versionNo: z.number().int().min(2), uploadedBy: documentsUuidSchema });
export const documentUpdatedEventSchema = z.object({ ...eventBase, changed: z.array(z.string()), updatedBy: documentsUuidSchema });
export const documentSharedEventSchema = z.object({ ...eventBase, shareId: documentsUuidSchema, userId: documentsUuidSchema, level: documentShareLevelSchema, sharedBy: documentsUuidSchema });
export const documentUnsharedEventSchema = z.object({ ...eventBase, shareId: documentsUuidSchema, userId: documentsUuidSchema, revokedBy: documentsUuidSchema });
export const documentArchivedEventSchema = z.object({ ...eventBase, archivedBy: documentsUuidSchema, purgeAfter: documentsInstantSchema.nullable() });
export const documentRestoredEventSchema = z.object({ ...eventBase, restoredBy: documentsUuidSchema });
export const documentPurgedEventSchema = z.object({ ...eventBase, versionsPurged: z.number().int().min(0) });

/** Alerte d'expiration : consommée par le chantier notifications (aucun titre, aucun nom de fichier). */
export const documentExpiringEventSchema = z.object({
  ...eventBase,
  createdBy: documentsUuidSchema,
  expiresOn: documentsDateSchema,
  daysLeft: z.number().int().min(0),
  /** Seuil franchi (jours) ayant déclenché l'alerte. */
  threshold: z.number().int().min(0),
});
export const documentExpiredEventSchema = z.object({
  ...eventBase,
  createdBy: documentsUuidSchema,
  expiresOn: documentsDateSchema,
  daysOverdue: z.number().int().min(1),
});
export const documentUploadQuarantinedEventSchema = z.object({
  v: z.literal(1),
  quarantineId: documentsUuidSchema,
  categoryId: documentsUuidSchema.nullable(),
  documentId: documentsUuidSchema.nullable(),
  uploadedBy: documentsUuidSchema,
  signature: z.string(),
  engine: z.string(),
  sizeBytes: z.number().int().min(0),
});
export const documentQuarantineReleasedEventSchema = z.object({
  v: z.literal(1),
  quarantineId: documentsUuidSchema,
  documentId: documentsUuidSchema,
  releasedBy: documentsUuidSchema,
});
export const documentIntegrityMismatchEventSchema = z.object({ ...eventBase, versionNo: z.number().int().min(1) });
