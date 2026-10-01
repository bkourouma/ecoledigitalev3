/**
 * Types du domaine `audit` (aucun import pg/fastify).
 */

export const AUDIT_ACTOR_TYPES = ["user", "system", "superAdmin", "impersonation"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_SEVERITIES = ["info", "notice", "warning", "critical"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** `entité.verbe` en minuscules, ex. `grade.published`. Miroir de la contrainte SQL. */
export const ACTION_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const ENTITY_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Qui agit.
 *  - `user`          : utilisateur du tenant ;
 *  - `system`        : tâche interne ou événement sans humain identifiable (`id` = null) ;
 *  - `superAdmin`    : opérateur plateforme agissant en son nom propre ;
 *  - `impersonation` : un super-admin agit AU NOM d'un utilisateur : `id` = l'utilisateur
 *                      imité, `impersonatedBy` = le super-admin (obligatoire).
 */
export interface AuditActor {
  type: AuditActorType;
  id: string | null;
  impersonatedBy?: string | null;
}

export interface AuditRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  device?: string | null;
  requestId?: string | null;
}

export interface AuditEntryInput {
  /** `entité.verbe`. */
  action: string;
  /** Type d'objet concerné (snake_case), ex. `role`, `grade`, `user`. */
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  /** Contexte libre (masqué comme before/after). */
  metadata?: Record<string, unknown> | null;
  reason?: string | null;
  severity?: AuditSeverity;
  /** Défaut : dérivé du RequestContext de la transaction. */
  actor?: AuditActor;
  /** Défaut : tenant du RequestContext. Doit être celui de la transaction (la RLS le vérifie). */
  tenantId?: string;
  /** Identifiant imposé (événements rejoués). Défaut : UUID v7 généré. */
  id?: string;
  /** Instant imposé (événements rejoués). Défaut : horloge injectée. */
  occurredAt?: Date | string;
  /** Défaut : ALS `audit request meta` (ip, user-agent) + requestId du contexte. */
  request?: AuditRequestMeta;
  /**
   * `true` : un doublon (même tenant, même `id`, même `occurredAt`) est ignoré au lieu de
   * lever — pour les consommateurs d'événements (livraison au moins une fois, ADR-004).
   */
  idempotent?: boolean;
}

/** Entrée issue d'un événement : le tenant peut être absent (journal de plateforme). */
export type AuditEntry = Omit<AuditEntryInput, "tenantId" | "id" | "occurredAt" | "actor"> & {
  tenantId: string | null;
  id: string;
  occurredAt: string;
  actor: AuditActor;
  idempotent: true;
};

export interface RecordResult {
  id: string;
  seq: number;
  hash: string;
  /** `true` si l'entrée existait déjà (rejeu idempotent) : rien n'a été écrit. */
  duplicate: boolean;
}

export type HashAlg = "sha256" | "hmac-sha256";

/** Ligne telle que lue en base (forme API interne, camelCase). */
export interface StoredAuditEntry {
  id: string;
  /** `null` pour le journal de plateforme. */
  tenantId: string | null;
  seq: number;
  occurredAt: string;
  recordedAt: string;
  actorType: AuditActorType;
  actorId: string | null;
  impersonatedBy: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  diff: JsonValue | null;
  metadata: JsonValue | null;
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  requestId: string | null;
  reason: string | null;
  severity: AuditSeverity;
  hashAlg: HashAlg;
  keyId: string | null;
  prevHash: string;
  hash: string;
}
