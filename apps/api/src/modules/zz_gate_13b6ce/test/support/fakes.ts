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
  /** Ordre des écritures (SQL résumé et audit) pour vérifier « audit en dernier ». */
  order: string[];
  audit: AuditPort;
  auditEntries: AuditEntry[];
}

export function makeFakeDb(options: { failAudit?: boolean } = {}): FakeDb {
  const queries: RecordedQuery[] = [];
  const order: string[] = [];
  const auditEntries: AuditEntry[] = [];

  const tx: Tx = {
    async query<R = Record<string, any>>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<R>> {
      queries.push({ sql, params });
      order.push(/^\s*INSERT INTO kernel\.domain_events/i.test(sql) ? "outbox" : "sql");
      return { rows: [], rowCount: 1 };
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
    async record(_tx, entry) {
      order.push("audit");
      if (options.failAudit) throw new Error("audit indisponible");
      auditEntries.push(entry);
    },
  };
  return { db, queries, order, audit, auditEntries };
}
