/**
 * API PUBLIQUE du module `audit` — seul point d'import autorisé pour les autres modules.
 *
 *   import { audit } from "../audit";
 *   await audit.record(tx, { action: "grade.published", entity: "grade", entityId, before, after });
 *   await audit.withAudit(tx, { action: "role.updated", entity: "role", entityId, snapshot: (t) => loadRole(t, id) }, () => updateRole(tx, id, patch));
 *
 * Tests des autres modules : `import { testing } from "../audit"` puis `testing.expectAudited(...)`
 * (ou directement `../audit/testing`).
 */
export { audit } from "./service";
export { AuditService, createAuditService, type AuditServiceOptions, type WithAuditMeta } from "./application/audit-service";

export type {
  AuditActor,
  AuditActorType,
  AuditEntry,
  AuditEntryInput,
  AuditRequestMeta,
  AuditSeverity,
  RecordResult,
  StoredAuditEntry,
} from "./domain/types";
export { AUDIT_ACTOR_TYPES, AUDIT_SEVERITIES } from "./domain/types";
export { createMasker, DEFAULT_MASKING, MASK, type Masker, type MaskingConfig } from "./domain/masking";
export { computeDiff, type AuditDiff } from "./domain/diff";
export { GENESIS_HASH } from "./domain/hash";

export type { ChainIssue, ChainIssueKind, ChainRange, ChainVerification } from "./application/verify-chain";
export { runWithAuditRequestMeta, getAuditRequestMeta } from "./application/request-meta";

// Événements (pour le futur registre d'abonnés du worker)
export {
  AUDIT_EVENT_SUBSCRIPTIONS,
  AUDIT_CONSUMED_EVENTS,
  resolveAuditHandler,
  type AuditEventHandler,
  type AuditSubscription,
} from "./domain/events";
export { consumeAuditEvent, type AuditEventConsumerDeps, type ConsumeOutcome } from "./application/event-consumer";

// Jobs d'exploitation
export { ensureAuditPartitions, ensureAuditPartitionsOn, listAuditPartitions, type PartitionInfo } from "./application/partitions";
export {
  DEFAULT_RETENTION_MONTHS,
  MIN_RETENTION_MONTHS,
  computeGlobalRetentionMonths,
  detachExpiredAuditPartitions,
  getRetentionMonths,
  setRetentionMonths,
  type DetachReport,
} from "./application/retention";

// Lecture (usage interne : tableaux de bord, rapports)
export { listAuditLogs, listPlatformAuditLogs, getAuditLog, exportLogsCsv, toCsv, csvCell, type LogPage } from "./application/queries";
export type { LogFilter } from "./infrastructure/log-repository";
// Projection publique d'une entrée en ligne de liste (sans before/after/metadata ni maillon précédent de la chaîne)
export { toSummaryDto as toAuditSummaryDto } from "./http/plugin";

// Plugins Fastify
export { auditPlugin as auditHttpPlugin, type AuditHttpOptions } from "./http/plugin";
export { configureAuditFromEnv, auditHmacFromEnv, type AuditEnv } from "./config";
export { default as auditRequestMetaPlugin } from "./http/request-meta-plugin";

// Helpers de test d'architecture
export * as testing from "./testing";
