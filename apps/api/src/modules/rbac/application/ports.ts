/**
 * Ports du module `rbac` : tout ce qui vient d'AUTRES modules passe par ici, pour
 * que `rbac` (socle CORE) ne dépende d'aucun d'eux.
 */
import type { Tx } from "@ecoledigitale/database";
import type { Clock, Logger, OutboxWriter } from "@ecoledigitale/kernel";
import type { Entitlements } from "../domain/navigation";
import type { AuthorizationContext } from "../domain/permission-set";

/** Entrée de journal d'audit (le module `audit` fournit l'implémentation réelle). */
export interface AuditEntry {
  readonly tenantId: string;
  /** Acteur ; `null` pour une tâche système. */
  readonly actorId: string | null;
  readonly requestId: string;
  /** Ex. `rbac.role.created`, `rbac.assignment.revoked`. */
  readonly action: string;
  readonly entityType: "role" | "assignment";
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Port OPTIONNEL vers `audit.record(tx, {...})`. Appelé dans la MÊME transaction
 * que la modification. Par défaut : no-op (le module audit se branche aussi via
 * les événements `rbac.*.changed`).
 */
export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({ record: async () => undefined });

/** Entitlements d'un tenant (module `entitlements`, optionnel). */
export interface EntitlementsPort {
  forTenant(tenantId: string): Promise<Entitlements>;
}

/** Dépendances d'un use case, liées à UNE transaction. */
export interface UseCaseDeps {
  readonly tx: Tx;
  readonly clock: Clock;
  readonly outbox: OutboxWriter;
  readonly audit: AuditPort;
  readonly logger: Logger;
  /**
   * Droits de l'acteur, pour l'anti-escalade. Obligatoire pour un acteur `user` /
   * `superAdmin` (son absence refuse l'opération) ; ignoré pour un acteur `system`.
   */
  readonly actor?: AuthorizationContext;
  /** Instantané de la hiérarchie des périmètres (validation d'existence). */
  readonly scopeTree?: import("../domain/scope").ScopeTree;
}
