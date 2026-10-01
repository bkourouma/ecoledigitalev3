import type { Tx } from "@ecoledigitale/database";
import type { RulesAuditEntry, RulesAuditPort } from "../../application/ports";

/** Port d'audit de test : enregistre les entrées (tenant et plateforme) ; peut être armé pour échouer (atomicité). */
export class RecordingAuditPort implements RulesAuditPort {
  readonly entries: RulesAuditEntry[] = [];
  readonly platformEntries: RulesAuditEntry[] = [];
  failWith: Error | null = null;

  async record(_tx: Tx, entry: RulesAuditEntry): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.entries.push(entry);
  }

  async recordPlatform(_tx: Tx, entry: RulesAuditEntry): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.platformEntries.push(entry);
  }

  actions(): string[] {
    return this.entries.map((e) => e.action);
  }

  platformActions(): string[] {
    return this.platformEntries.map((e) => e.action);
  }

  clear(): void {
    this.entries.length = 0;
    this.platformEntries.length = 0;
  }
}
