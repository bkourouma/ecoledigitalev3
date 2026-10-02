/**
 * Harnais SQL des tests de comportement du DDL (port TypeScript de `specs/v2/006-secondary/ddl-test/harness.mjs`).
 *
 * Les scénarios s'exécutent sous le rôle `app_user` (NOBYPASSRLS, non propriétaire) dans une transaction annulée à la fin,
 * avec le contexte posé comme `TenantDb` (app.tenant_id, app.user_id, app.actor). Ils parlent SQL brut : ils prouvent
 * ce que la BASE impose, indépendamment de toute couche applicative.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";

export const uuid = (): string => randomUUID();

export async function newTenant(db: Client, slug: string): Promise<string> {
  const id = uuid();
  await db.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `${slug}-${id.slice(0, 6)}`, `Tenant ${slug}`]);
  return id;
}

export interface SqlTx {
  tenantId: string;
  q(sql: string, params?: unknown[]): Promise<any[]>;
  one(sql: string, params?: unknown[]): Promise<any>;
  /** Attend une erreur dont le message correspond (sous SAVEPOINT : la transaction reste utilisable). */
  fail(sql: string, params: unknown[], pattern?: RegExp | string): Promise<unknown>;
  attempt(fn: () => Promise<unknown>, pattern?: RegExp | string): Promise<unknown>;
  /** Change l'identité de session au milieu du scénario. */
  as(next: { userId?: string | null; actor?: string }): Promise<void>;
}

export interface TenantCtx {
  tenantId: string;
  userId?: string;
  actor?: string;
}

export async function inTenant<T>(db: Client, ctx: TenantCtx, fn: (tx: SqlTx) => Promise<T>, { commit = false }: { commit?: boolean } = {}): Promise<T> {
  const state = { tenantId: ctx.tenantId, userId: ctx.userId ?? "", actor: ctx.actor ?? "user" };
  const apply = async (): Promise<void> => {
    await db.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.actor', $3, true)", [
      state.tenantId,
      state.userId,
      state.actor,
    ]);
  };
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE app_user");
    await apply();
    let sp = 0;
    const check = (e: any, pattern?: RegExp | string): unknown => {
      const text = `${e.code ?? ""} ${e.message}`;
      if (pattern && !(pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern))) {
        throw new Error(`Erreur inattendue : ${text} (attendu : ${String(pattern)})`);
      }
      return e;
    };
    const tx: SqlTx = {
      tenantId: state.tenantId,
      async q(sql, params = []) {
        return (await db.query(sql, params as never[])).rows;
      },
      async one(sql, params = []) {
        const r = await db.query(sql, params as never[]);
        if (r.rows.length !== 1) throw new Error(`Une ligne attendue, ${r.rows.length} reçue(s) pour : ${sql}`);
        return r.rows[0];
      },
      async fail(sql, params, pattern) {
        const name = `sp_${++sp}`;
        await db.query(`SAVEPOINT ${name}`);
        try {
          await db.query(sql, params as never[]);
        } catch (e) {
          await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return check(e, pattern);
        }
        await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw new Error(`Une erreur était attendue pour : ${sql}`);
      },
      async attempt(fn, pattern) {
        const name = `sp_${++sp}`;
        await db.query(`SAVEPOINT ${name}`);
        try {
          await fn();
        } catch (e) {
          await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return check(e, pattern);
        }
        await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw new Error("Une erreur était attendue.");
      },
      async as(next) {
        if (next.userId !== undefined) state.userId = next.userId ?? "";
        if (next.actor !== undefined) state.actor = next.actor;
        await apply();
      },
    };
    const result = await fn(tx);
    await db.query(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

export async function insert(tx: SqlTx, table: string, cols: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(cols);
  const ph = keys.map((_, i) => `$${i + 1}`);
  const rows = await tx.q(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${ph.join(", ")}) RETURNING id`, keys.map((k) => cols[k]));
  return rows[0]?.id as string;
}

/** Contrôle structurel d'isolation d'un schéma (même contrat que `assertTenantIsolation`). */
export async function structuralIsolationViolations(db: Client, schema: string): Promise<{ tables: string[]; problems: string[] }> {
  const { rows } = await db.query(
    `SELECT c.relname AS table_name,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS own_policy,
            EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnotnull AND a.atttypid = 'uuid'::regtype AND NOT a.attisdropped) AS has_tenant_id,
            EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisvalid AND i.indpred IS NULL
                      AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = c.oid AND attname = 'tenant_id')) AS has_tenant_index,
            has_table_privilege('app_user', c.oid, 'SELECT') AS app_can_select
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
    [schema],
  );
  const problems: string[] = [];
  for (const r of rows) {
    if (!r.has_tenant_id) problems.push(`${schema}.${r.table_name} : tenant_id uuid NOT NULL absent`);
    if (!r.rls || !r.forced) problems.push(`${schema}.${r.table_name} : RLS non forcée`);
    if (r.policies !== 1 || r.own_policy !== 1) problems.push(`${schema}.${r.table_name} : la policy tenant_isolation doit être la seule`);
    if (!r.has_tenant_index) problems.push(`${schema}.${r.table_name} : aucun index en tête sur tenant_id`);
    if (!r.app_can_select) problems.push(`${schema}.${r.table_name} : app_user sans SELECT`);
  }
  return { tables: rows.map((r) => r.table_name as string), problems };
}
