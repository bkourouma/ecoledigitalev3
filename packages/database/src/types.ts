/**
 * Types structurels minimaux : `pg.Pool` / `pg.PoolClient` les satisfont, et les
 * tests unitaires peuvent injecter un faux pool sans réseau.
 */

export interface QueryResult<R = Record<string, any>> {
  rows: R[];
  rowCount: number;
}

export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  /** `release(err)` détruit la connexion au lieu de la remettre dans le pool. */
  release(err?: Error | boolean): void;
}

export interface PgPoolLike {
  connect(): Promise<PoolClientLike>;
}

/**
 * Client SQL fourni à l'intérieur d'une transaction. C'est le SEUL moyen
 * d'accéder aux données depuis un use case : il n'expose ni le pool, ni
 * `BEGIN`/`COMMIT`, ni la connexion brute.
 */
export interface Tx {
  /** Exécute une requête paramétrée (`$1`, `$2`…). Jamais de concaténation de valeurs. */
  query<R = Record<string, any>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
  /** Première ligne ou `null`. Lève si PLUS d'une ligne est renvoyée (requête mal bornée). */
  queryOne<R = Record<string, any>>(sql: string, params?: readonly unknown[]): Promise<R | null>;
  /** Toutes les lignes. */
  many<R = Record<string, any>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
  /**
   * Sous-transaction (SAVEPOINT) : si `fn` lève, seul ce qu'elle a fait est
   * annulé et l'erreur est relancée ; sinon le savepoint est relâché.
   * Ne pas lancer deux sous-transactions EN PARALLÈLE sur le même `Tx`.
   */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface RunOptions {
  /** `BEGIN READ ONLY` : toute écriture est refusée par Postgres. */
  readOnly?: boolean;
}
