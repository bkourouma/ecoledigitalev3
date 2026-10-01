/**
 * Dépendances de la console plateforme : bases de données, ports d'audit et d'identité, politique d'essai.
 * Aucun import d'un autre module ici : les ports sont décrits structurellement.
 */
import type { SystemDb, TenantDb, Tx } from "@ecoledigitale/database";
import type { AppError, Clock, Logger, RequestContext, Result } from "@ecoledigitale/kernel";

/** Opérateur authentifié (JWT super-admin) qui agit. */
export interface Operator {
  /** UUID de l'opérateur (acteur `superAdmin` des contextes et de l'audit). */
  id: string;
}

export interface OperatorRequestMeta {
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PlatformAuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
  reason?: string | null;
  severity?: "info" | "notice" | "warning" | "critical";
  actor?: { type: "user" | "system" | "superAdmin" | "impersonation"; id: string | null };
}

export interface PlatformAuditPort {
  /** Journal d'un tenant (dans la transaction de `tx`). */
  record(tx: Tx, entry: PlatformAuditEntry): Promise<unknown>;
  /** Journal de plateforme (événements sans tenant) — à appeler depuis `SystemDb.run`. */
  recordPlatform(tx: Tx, entry: PlatformAuditEntry): Promise<unknown>;
}

/** Port d'identité : `iam.provisionMember`. */
export interface MemberProvisioner {
  provisionMember(
    ctx: RequestContext,
    input: {
      email: string;
      roles: readonly string[];
      sendInvitation?: boolean;
      invitedBy?: string | null;
      meta: { ip: string | null; userAgent: string | null; requestId: string };
    },
  ): Promise<Result<{ membershipId: string; identityId: string }, AppError>>;
}

export interface TrialPolicy {
  planKey: string;
  days: number;
}

export interface PlatformDeps {
  tenantDb: TenantDb;
  systemDb: SystemDb;
  clock: Clock;
  logger: Logger;
  audit: PlatformAuditPort;
  members: MemberProvisioner;
  /** Cache de droits à invalider après un changement d'abonnement/surcharge/statut (lecteur en cache du process). */
  entitlementsCache?: { invalidate(tenantId: string): void; invalidateAll(): void };
  /** Essai accordé par défaut à un tenant provisionné. */
  trial: TrialPolicy;
}

export const DEFAULT_TRIAL: TrialPolicy = Object.freeze({ planKey: "STARTER", days: 30 });
