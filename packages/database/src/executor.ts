/**
 * Exécuteur transactionnel commun à `TenantDb` et `SystemDb`.
 *
 * Invariants :
 *  1. Un `Tx` ne vit que dans UNE transaction ; passé `COMMIT`/`ROLLBACK` il est
 *     fermé et toute requête lève (pas de réutilisation d'une connexion rendue
 *     au pool).
 *  2. Les variables de session sont posées avec `set_config(..., true)`
 *     (équivalent de `SET LOCAL`) : elles disparaissent à la fin de la
 *     transaction. Une connexion du pool ne peut donc jamais « hériter » du
 *     tenant de la requête précédente.
 *  3. La valeur des variables est passée en PARAMÈTRE (`$n`), jamais
 *     interpolée dans le SQL.
 *  4. Un `run` imbriqué (même exécuteur, même contexte) réutilise la
 *     transaction via SAVEPOINT ; avec un contexte différent (autre tenant,
 *     autre utilisateur ou autre acteur) il est REFUSÉ : on ne change jamais
 *     d'identité au milieu d'une transaction.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { InternalError } from "@ecoledigitale/kernel";
import type { PgPoolLike, PoolClientLike, QueryResult, RunOptions, Tx } from "./types";

export type DbActor = "user" | "system" | "superAdmin";

/** Ce qui est posé dans `current_setting('app.*')` pour la durée de la transaction. */
export interface SessionSettings {
  /** UUID, ou chaîne vide : aucun tenant (la RLS ne laisse alors rien passer). */
  readonly tenantId: string;
  readonly userId: string;
  readonly actor: DbActor;
  readonly requestId: string;
  readonly reason: string;
}

export interface ExecutorOptions {
  /** `SET LOCAL statement_timeout` (ms) pour chaque transaction ; absent = valeur du serveur/rôle. */
  statementTimeoutMs?: number;
}

const SET_CONFIG_SQL = `SELECT
  set_config('app.tenant_id', $1, true),
  set_config('app.user_id', $2, true),
  set_config('app.actor', $3, true),
  set_config('app.request_id', $4, true),
  set_config('app.reason', $5, true)`;

class PgTx implements Tx {
  private closed = false;
  private savepointSeq = 0;

  constructor(private readonly client: PoolClientLike) {}

  close(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new InternalError("Transaction terminée : le client Tx ne peut plus être utilisé.", {
        code: "TX_CLOSED",
      });
    }
  }

  async query<R = Record<string, any>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>> {
    this.assertOpen();
    const res = await this.client.query(sql, params === undefined ? undefined : [...params]);
    return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
  }

  async queryOne<R = Record<string, any>>(sql: string, params?: readonly unknown[]): Promise<R | null> {
    const { rows } = await this.query<R>(sql, params);
    if (rows.length > 1) {
      throw new InternalError(`queryOne : ${rows.length} lignes renvoyées, 0 ou 1 attendue.`, {
        code: "DB_TOO_MANY_ROWS",
      });
    }
    return rows[0] ?? null;
  }

  async many<R = Record<string, any>>(sql: string, params?: readonly unknown[]): Promise<R[]> {
    return (await this.query<R>(sql, params)).rows;
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.assertOpen();
    const name = `ed_sp_${++this.savepointSeq}`;
    await this.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn(this);
      await this.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      // Si la connexion est cassée, ce ROLLBACK échoue aussi : l'erreur d'origine prime.
      try {
        await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await this.client.query(`RELEASE SAVEPOINT ${name}`);
      } catch {
        /* l'erreur d'origine est relancée ci-dessous */
      }
      throw error;
    }
  }
}

interface ActiveTx {
  readonly tx: PgTx;
  readonly settings: SessionSettings;
}

export class TransactionExecutor {
  private readonly active = new AsyncLocalStorage<ActiveTx>();

  constructor(
    private readonly pool: PgPoolLike,
    private readonly options: ExecutorOptions = {},
  ) {
    if (
      options.statementTimeoutMs !== undefined &&
      (!Number.isInteger(options.statementTimeoutMs) || options.statementTimeoutMs < 0)
    ) {
      throw new TypeError("statementTimeoutMs doit être un entier ≥ 0.");
    }
  }

  async execute<T>(
    settings: SessionSettings,
    fn: (tx: Tx) => Promise<T>,
    runOptions: RunOptions = {},
    wrap: <R>(inner: () => R) => R = (inner) => inner(),
  ): Promise<T> {
    const outer = this.active.getStore();
    if (outer) {
      const s = outer.settings;
      if (s.tenantId !== settings.tenantId || s.userId !== settings.userId || s.actor !== settings.actor) {
        throw new InternalError(
          "Changement d'identité (tenant, utilisateur ou acteur) refusé à l'intérieur d'une transaction.",
          { code: "TX_IDENTITY_SWITCH" },
        );
      }
      return outer.tx.transaction(fn);
    }

    const client = await this.pool.connect();
    const tx = new PgTx(client);
    let destroy: Error | undefined;
    try {
      await client.query(runOptions.readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query(SET_CONFIG_SQL, [
        settings.tenantId,
        settings.userId,
        settings.actor,
        settings.requestId,
        settings.reason,
      ]);
      if (this.options.statementTimeoutMs !== undefined) {
        await client.query("SELECT set_config('statement_timeout', $1, true)", [
          String(this.options.statementTimeoutMs),
        ]);
      }
      const result = await this.active.run({ tx, settings }, () => wrap(() => fn(tx)));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // Connexion dans un état inconnu : on la détruit plutôt que de la recycler.
        destroy = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw error;
    } finally {
      tx.close();
      client.release(destroy);
    }
  }
}
