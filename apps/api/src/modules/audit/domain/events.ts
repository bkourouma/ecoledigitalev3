/**
 * Abonnements du module `audit` aux événements de domaine (outbox `kernel.domain_events`).
 *
 * Chaque handler est une FONCTION PURE `(event) => AuditEntry | null` : pas d'I/O, pas
 * d'horloge, pas de hasard — rejouable et testable sans base. Le futur registre
 * d'abonnés du worker les enregistre via `AUDIT_EVENT_SUBSCRIPTIONS` et appelle
 * `consumeAuditEvent` (application/event-consumer.ts) qui écrit.
 *
 * Idempotence (ADR-004, livraison « au moins une fois ») : l'entrée reprend l'`id` ET
 * l'`occurredAt` de l'événement ; la clé primaire du journal (tenant, occurred_at, id)
 * fait le dédoublonnage (`idempotent: true`).
 *
 * Les payloads sont lus de façon DÉFENSIVE : leurs schémas appartiennent aux modules
 * émetteurs (iam, rbac, tenancy, entitlements) et peuvent évoluer ; une clé manquante
 * donne un champ vide, jamais une exception qui bloquerait la file.
 */
import type { DomainEvent } from "@ecoledigitale/kernel";
import type { AuditActor, AuditEntry, AuditSeverity } from "./types";

export type AuditEventHandler = (event: DomainEvent) => AuditEntry | null;

export interface AuditSubscription {
  /** Type exact (`iam.login.failed`) ou préfixe (`tenancy.*`). */
  readonly pattern: string;
  readonly handle: AuditEventHandler;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asUuid = (v: unknown): string | null =>
  typeof v === "string" && UUID_RE.test(v) && v !== NIL_UUID ? v.toLowerCase() : null;
const asText = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : null;

function pick(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (payload[k] !== undefined && payload[k] !== null) return payload[k];
  return undefined;
}

const payloadOf = (event: DomainEvent): Record<string, unknown> => (isRecord(event.payload) ? event.payload : {});

/** Tenant de l'événement ; `null` = journal de plateforme. */
export function tenantOf(event: DomainEvent): string | null {
  return asUuid(event.tenantId) ?? asUuid(payloadOf(event).tenantId);
}

function requestOf(event: DomainEvent, p: Record<string, unknown>): AuditEntry["request"] {
  return {
    ip: asText(p.ip, 64),
    userAgent: asText(p.userAgent, 512),
    requestId: asText(event.requestId),
  };
}

function actorOf(event: DomainEvent, p: Record<string, unknown>, ...payloadKeys: string[]): AuditActor {
  const id = asUuid(event.actorId) ?? asUuid(pick(p, ...payloadKeys));
  if (!id) return { type: "system", id: null };
  return { type: p.actorType === "superAdmin" ? "superAdmin" : "user", id };
}

function base(event: DomainEvent): Pick<AuditEntry, "id" | "occurredAt" | "tenantId" | "idempotent"> {
  return { id: event.id, occurredAt: event.occurredAt, tenantId: tenantOf(event), idempotent: true };
}

function metadataWithout(p: Record<string, unknown>, ...omit: string[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (!omit.includes(k) && v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// iam.*
// ---------------------------------------------------------------------------

export const onImpersonationStarted: AuditEventHandler = (event) => {
  const p = payloadOf(event);
  const superAdminId = asUuid(pick(p, "superAdminId", "impersonatorId", "actorId")) ?? asUuid(event.actorId);
  return {
    ...base(event),
    action: "impersonation.started",
    entity: "user",
    entityId: asText(pick(p, "targetUserId", "impersonatedUserId", "userId")),
    actor: superAdminId ? { type: "superAdmin", id: superAdminId } : { type: "system", id: null },
    severity: "critical",
    reason: asText(p.reason, 1000),
    metadata: metadataWithout(p, "reason", "ip", "userAgent", "superAdminId", "impersonatorId", "actorId", "targetUserId", "impersonatedUserId"),
    request: requestOf(event, p),
  };
};

export const onLoginFailed: AuditEventHandler = (event) => {
  const p = payloadOf(event);
  const locked = p.locked === true || p.accountLocked === true;
  return {
    ...base(event),
    action: "login.failed",
    entity: "user",
    entityId: asText(pick(p, "userId")),
    // L'auteur d'une tentative échouée n'est pas authentifié : jamais « user ».
    actor: { type: "system", id: null },
    severity: locked ? "warning" : "notice",
    metadata: {
      identifier: asText(pick(p, "identifier", "email", "login"), 254),
      cause: asText(pick(p, "cause", "reason", "failure")),
      attempts: typeof p.attempts === "number" ? p.attempts : null,
      locked,
    },
    request: requestOf(event, p),
  };
};

export const onSessionRevoked: AuditEventHandler = (event) => {
  const p = payloadOf(event);
  const cause = asText(pick(p, "cause", "reason"));
  return {
    ...base(event),
    action: "session.revoked",
    entity: "session",
    entityId: asText(pick(p, "sessionId", "id")),
    actor: actorOf(event, p, "revokedBy"),
    severity: cause && /reuse|theft|compromis|security/i.test(cause) ? "warning" : "notice",
    metadata: { userId: asUuid(p.userId), cause },
    request: requestOf(event, p),
  };
};

// ---------------------------------------------------------------------------
// rbac.*
// ---------------------------------------------------------------------------

export const onRoleChanged: AuditEventHandler = (event) => {
  const p = payloadOf(event);
  return {
    ...base(event),
    action: "role.changed",
    entity: "role",
    entityId: asText(pick(p, "roleId", "id")) ?? event.aggregateId ?? null,
    actor: actorOf(event, p, "changedBy"),
    severity: "warning",
    before: p.before,
    after: p.after,
    metadata: { change: asText(p.change) },
    reason: asText(p.reason, 1000),
    request: requestOf(event, p),
  };
};

export const onAssignmentChanged: AuditEventHandler = (event) => {
  const p = payloadOf(event);
  return {
    ...base(event),
    action: "assignment.changed",
    entity: "role_assignment",
    entityId: asText(pick(p, "assignmentId", "id")) ?? event.aggregateId ?? null,
    actor: actorOf(event, p, "changedBy", "assignedBy"),
    severity: "warning",
    before: p.before,
    after: p.after,
    metadata: {
      change: asText(p.change),
      userId: asUuid(p.userId),
      roleId: asText(p.roleId),
      campusId: asText(p.campusId),
    },
    reason: asText(p.reason, 1000),
    request: requestOf(event, p),
  };
};

// ---------------------------------------------------------------------------
// tenancy.* / entitlements.* — traitement générique
// ---------------------------------------------------------------------------

const RISKY_VERBS = /(suspend|archiv|delet|remov|revok|disabl|overrid|downgrad|expire|cancel|reset)/;

function severityForVerb(verb: string): AuditSeverity {
  if (RISKY_VERBS.test(verb)) return "warning";
  if (/(creat|activat|enabl|grant|upgrad|chang|updat)/.test(verb)) return "notice";
  return "info";
}

/**
 * `tenancy.tenant.suspended` -> action `tenant.suspended`, entité `tenant`.
 * `entitlements.override.set` -> action `override.set`, entité `override`.
 * Un type à deux segments (`tenancy.provisioned`) -> action `tenancy.provisioned`, entité `tenancy`.
 */
export function genericEventHandler(event: DomainEvent): AuditEntry | null {
  const parts = event.type.split(".");
  if (parts.length < 2) return null;
  const rest = parts.slice(1);
  const entity = rest.length >= 2 ? (rest[0] as string) : (parts[0] as string);
  const action = rest.length >= 2 ? rest.join(".") : event.type;
  const p = payloadOf(event);
  const verb = rest[rest.length - 1] as string;
  return {
    ...base(event),
    action,
    entity,
    entityId: asText(pick(p, `${entity}Id`, "id")) ?? event.aggregateId ?? null,
    actor: actorOf(event, p, "changedBy", "performedBy"),
    severity: severityForVerb(verb),
    before: p.before,
    after: p.after,
    reason: asText(p.reason, 1000),
    metadata: metadataWithout(p, "before", "after", "reason", "ip", "userAgent"),
    request: requestOf(event, p),
  };
}

/** Abonnements, du plus spécifique au plus générique (premier qui correspond gagne). */
export const AUDIT_EVENT_SUBSCRIPTIONS: readonly AuditSubscription[] = Object.freeze([
  { pattern: "iam.impersonation.started", handle: onImpersonationStarted },
  { pattern: "iam.login.failed", handle: onLoginFailed },
  { pattern: "iam.session.revoked", handle: onSessionRevoked },
  { pattern: "rbac.role.changed", handle: onRoleChanged },
  { pattern: "rbac.assignment.changed", handle: onAssignmentChanged },
  { pattern: "tenancy.*", handle: genericEventHandler },
  { pattern: "entitlements.*", handle: genericEventHandler },
  // Opérations de sécurité de l'identité (enrôlement/désactivation/réinitialisation de la MFA, changement de
  // mot de passe, accès créés ou modifiés) : sans ces abonnements, activer la MFA ne laissait aucune trace
  // (défaut d'assemblage révélé par le test de sortie de phase 1). Les payloads d'iam ne portent aucun secret.
  { pattern: "iam.mfa.*", handle: genericEventHandler },
  { pattern: "iam.password.*", handle: genericEventHandler },
  { pattern: "iam.membership.*", handle: genericEventHandler },
]);

export function patternMatches(pattern: string, type: string): boolean {
  return pattern.endsWith(".*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type;
}

export function resolveAuditHandler(type: string): AuditEventHandler | undefined {
  return AUDIT_EVENT_SUBSCRIPTIONS.find((s) => patternMatches(s.pattern, type))?.handle;
}

/** Types déclarés dans le manifeste (`events.consumes`). */
export const AUDIT_CONSUMED_EVENTS: readonly string[] = AUDIT_EVENT_SUBSCRIPTIONS.map((s) => s.pattern);
