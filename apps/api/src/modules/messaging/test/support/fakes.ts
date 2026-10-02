/**
 * Doublures sans base de données pour les tests unitaires : TenantDb, Tx et port d'audit enregistreurs.
 */
import type { QueryResult, TenantDb, Tx } from "@ecoledigitale/database";
import type { AuditEntry, AuditPort } from "../../application/ports";

export interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

export interface FakeDb {
  db: TenantDb;
  queries: RecordedQuery[];
  audit: AuditPort;
  auditEntries: AuditEntry[];
}

export function makeFakeDb(options: { failAudit?: boolean } = {}): FakeDb {
  const queries: RecordedQuery[] = [];
  const auditEntries: AuditEntry[] = [];

  const tx: Tx = {
    async query<R = Record<string, any>>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<R>> {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
    async queryOne() {
      return null;
    },
    async many() {
      return [];
    },
    async transaction(fn) {
      return await fn(tx);
    },
  };

  const db = { run: async (_ctx: unknown, fn: (t: Tx) => Promise<unknown>) => await fn(tx) } as unknown as TenantDb;
  const audit: AuditPort = {
    async record(_tx, _ctx, entry) {
      if (options.failAudit) throw new Error("audit indisponible");
      auditEntries.push(entry);
    },
  };
  return { db, queries, audit, auditEntries };
}
