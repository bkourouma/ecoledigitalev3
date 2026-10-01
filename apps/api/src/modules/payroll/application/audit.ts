/**
 * Port d'audit du module payroll : appelé dans la MÊME transaction que l'opération sensible (conventions n° 8),
 * EN DERNIER. Adapté à `audit.record` (module `audit`, via `runtime.auditPort`) par `infrastructure/audit-adapter.ts`.
 * Les salaires sont des données sensibles : l'audit ne reçoit que des identifiants et des montants entiers.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

export interface AuditEntry {
  /** `payroll.<entité>.<action>` — ex. `payroll.payslip.approved`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (arrêt, versement, annulation, ajustement, export, réglages). */
  readonly sensitive?: boolean;
  readonly reason?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit est branché par le plugin (runtime.auditPort) */
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
