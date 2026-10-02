/**
 * Contrats du module `audit` (v2) : journal d'audit en LECTURE SEULE.
 * Aucune route d'écriture ni de suppression n'existe : l'écriture passe
 * exclusivement par `audit.record(tx, …)` côté serveur, dans la transaction métier.
 */
import { z } from "zod";

export const AUDIT_ACTOR_TYPES = ["user", "system", "superAdmin", "impersonation"] as const;
export const AUDIT_SEVERITIES = ["info", "notice", "warning", "critical"] as const;

export const auditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export const auditSeveritySchema = z.enum(AUDIT_SEVERITIES);

export type AuditActorTypeDto = z.infer<typeof auditActorTypeSchema>;
export type AuditSeverityDto = z.infer<typeof auditSeveritySchema>;

/** `entité.verbe`, ex. `grade.published`, `role.changed`. */
export const auditActionSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Action attendue au format entité.verbe (minuscules).");

const isoInstant = z.string().datetime({ offset: true });
const jsonObject = z.record(z.unknown());

/** Entrée complète (détail). */
export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  /** `null` pour une entrée du journal de PLATEFORME (`GET /api/v1/platform/audit/logs`), jamais pour un tenant. */
  tenantId: z.string().uuid().nullable(),
  seq: z.number().int().positive(),
  occurredAt: isoInstant,
  recordedAt: isoInstant,
  actorType: auditActorTypeSchema,
  actorId: z.string().uuid().nullable(),
  impersonatedBy: z.string().uuid().nullable(),
  action: auditActionSchema,
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  diff: jsonObject.nullable(),
  metadata: jsonObject.nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  device: z.string().nullable(),
  requestId: z.string().nullable(),
  reason: z.string().nullable(),
  severity: auditSeveritySchema,
  hashAlg: z.enum(["sha256", "hmac-sha256"]),
  prevHash: z.string().regex(/^[0-9a-f]{64}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AuditLogEntryDto = z.infer<typeof auditLogEntrySchema>;

/** Entrée de liste : sans before/after (volumineux), avec diff (résumé des changements). */
export const auditLogSummarySchema = auditLogEntrySchema.omit({
  before: true,
  after: true,
  metadata: true,
  userAgent: true,
  prevHash: true,
  hashAlg: true,
});
export type AuditLogSummaryDto = z.infer<typeof auditLogSummarySchema>;

export const AUDIT_LIST_MAX_LIMIT = 200;

const severityList = z
  .string()
  .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
  .pipe(z.array(auditSeveritySchema).min(1).max(4));

/** Filtres communs à la liste et à l'export. */
export const auditLogFilterSchema = z.object({
  actorId: z.string().uuid().optional(),
  entity: z.string().regex(/^[a-z][a-z0-9_]*$/).max(100).optional(),
  entityId: z.string().min(1).max(200).optional(),
  /** Exact, ou préfixe avec `.*` final (ex. `role.*`). */
  action: z
    .string()
    .max(102)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?$/)
    .optional(),
  /** Un ou plusieurs niveaux séparés par des virgules (`warning,critical`). */
  severity: severityList.optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
});
export type AuditLogFilterDto = z.infer<typeof auditLogFilterSchema>;

export const auditLogListQuerySchema = auditLogFilterSchema.extend({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_LIST_MAX_LIMIT).default(50),
});
export type AuditLogListQueryDto = z.infer<typeof auditLogListQuerySchema>;

export const auditLogListResponseSchema = z.object({
  items: z.array(auditLogSummarySchema),
  /** Curseur opaque de la page suivante ; `null` à la fin. */
  nextCursor: z.string().nullable(),
});
export type AuditLogListResponseDto = z.infer<typeof auditLogListResponseSchema>;

export const auditLogIdParamsSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Journal de PLATEFORME (`GET /api/v1/platform/audit/logs`, opérateurs super-admin)
// ---------------------------------------------------------------------------

/**
 * Entrée du journal de plateforme : celle d'un tenant, sans tenant (`tenantId: null`). Comme pour le tenant, la liste
 * ne montre PAS `before`/`after`/`metadata`/`userAgent` ni `prevHash`/`hashAlg`/`keyId` : seul `hash` (empreinte de
 * l'entrée, publique par construction) et `seq` (ordre) sont exposés ; le contrôle d'intégrité se fait côté serveur.
 */
export const platformAuditLogSummarySchema = auditLogSummarySchema.extend({ tenantId: z.null() });
export type PlatformAuditLogSummaryDto = z.infer<typeof platformAuditLogSummarySchema>;

/** Mêmes filtres et même pagination par curseur que l'audit d'un tenant (`GET /api/v1/audit/logs`). */
export const platformAuditLogListQuerySchema = auditLogListQuerySchema;
export type PlatformAuditLogListQueryDto = z.infer<typeof platformAuditLogListQuerySchema>;

/** MÊME enveloppe que `auditLogListResponseSchema` : `{ items, nextCursor }`. */
export const platformAuditLogListResponseSchema = z.object({
  items: z.array(platformAuditLogSummarySchema),
  nextCursor: z.string().nullable(),
});
export type PlatformAuditLogListResponseDto = z.infer<typeof platformAuditLogListResponseSchema>;

/** Export CSV borné : période obligatoire (<= 31 jours) et plafond de lignes. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
export const AUDIT_EXPORT_MAX_DAYS = 31;

export const auditLogExportQuerySchema = auditLogFilterSchema
  .required({ from: true, to: true })
  .extend({
    limit: z.coerce.number().int().min(1).max(AUDIT_EXPORT_MAX_ROWS).default(AUDIT_EXPORT_MAX_ROWS),
  })
  .superRefine((q, ctx) => {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (!(to > from)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "`to` doit être postérieur à `from`." });
    } else if (to - from > AUDIT_EXPORT_MAX_DAYS * 86_400_000) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `La période d'export est limitée à ${AUDIT_EXPORT_MAX_DAYS} jours.`,
      });
    }
  });
export type AuditLogExportQueryDto = z.infer<typeof auditLogExportQuerySchema>;

/** Vérification d'intégrité de la chaîne. Par numéro de séquence OU par période. */
export const auditVerifyQuerySchema = z.object({
  fromSeq: z.coerce.number().int().positive().optional(),
  toSeq: z.coerce.number().int().positive().optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
});
export type AuditVerifyQueryDto = z.infer<typeof auditVerifyQuerySchema>;

export const auditChainIssueKindSchema = z.enum([
  "hash_mismatch",
  "prev_hash_mismatch",
  "seq_gap",
  "duplicate_seq",
  "genesis_mismatch",
  "head_mismatch",
  "key_unavailable",
  "weak_hash",
  "unsupported_hash_alg",
]);

export const auditChainVerificationSchema = z.object({
  ok: z.boolean(),
  checked: z.number().int().nonnegative(),
  firstSeq: z.number().int().nullable(),
  lastSeq: z.number().int().nullable(),
  headSeq: z.number().int().nullable(),
  /** `genesis` : la plage commence au tout début de la chaîne ; `trusted-anchor` : début au milieu (ou partitions archivées). */
  anchor: z.enum(["genesis", "trusted-anchor", "empty"]),
  issues: z.array(
    z.object({
      kind: auditChainIssueKindSchema,
      seq: z.number().int().nullable(),
      id: z.string().uuid().nullable(),
      detail: z.string(),
    }),
  ),
  /** `true` si la liste d'anomalies a été tronquée. */
  issuesTruncated: z.boolean(),
});
export type AuditChainVerificationDto = z.infer<typeof auditChainVerificationSchema>;
