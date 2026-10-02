/**
 * Ports du module (ce que l'application attend de l'extérieur), décrits structurellement.
 * Le plugin HTTP les satisfait avec le ModuleRuntime (platform/runtime.ts) : runtime.auditPort est un AuditPort.
 */
import type { Tx, TenantDb } from "@ecoledigitale/database";
import type { Clock } from "@ecoledigitale/kernel";

/** Entrée d'audit : tenant, acteur et requête sont dérivés du contexte de la transaction. */
export interface AuditEntry {
  /** entité.verbe, ex. documents.item.create */
  action: string;
  /** Type d'objet (snake_case), ex. item */
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export interface ItemsDeps {
  tenantDb: TenantDb;
  clock: Clock;
  audit: AuditPort;
}
