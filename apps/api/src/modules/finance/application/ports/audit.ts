/**
 * Port d'audit. Le module `audit` (Phase 1, piste A) n'existe pas encore : le module
 * finance appelle ce port, no-op par défaut, dans la MÊME transaction que l'opération
 * sensible (convention n° 8). Le branchement futur est une simple injection.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

export interface AuditEntry {
  /** `finance.<entité>.<action>` — ex. `finance.refund.approved`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (remboursement, clôture de caisse, avoir, annulation). */
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit sera branché plus tard */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<{ ctx: RequestContext; entry: AuditEntry }> = [];
  async record(_tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ctx, entry });
  }
  actions(): string[] {
    return this.entries.map((e) => e.entry.action);
  }
}
