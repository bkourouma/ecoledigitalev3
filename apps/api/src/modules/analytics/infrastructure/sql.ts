/**
 * Aides SQL de l'infrastructure : insertion en lot paramétrée (jamais de valeur concaténée).
 */
import type { Tx } from "@ecoledigitale/database";

/** Paramètres Postgres : 65 535 au plus ; on reste très en dessous. */
const MAX_PARAMS = 20_000;

/**
 * Insère `rows` (tableaux de valeurs alignés sur `columns`) par lots. `table` et `columns` sont des CONSTANTES du code
 * (jamais une entrée utilisateur) ; les valeurs passent toutes en paramètres.
 */
export async function bulkInsert(tx: Tx, table: string, columns: readonly string[], rows: ReadonlyArray<readonly unknown[]>, suffix = ""): Promise<number> {
  if (rows.length === 0) return 0;
  const perBatch = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  let written = 0;
  for (let start = 0; start < rows.length; start += perBatch) {
    const batch = rows.slice(start, start + perBatch);
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const slots = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${slots.join(", ")})`;
    });
    await tx.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")} ${suffix}`, params);
    written += batch.length;
  }
  return written;
}

/** Montants : `number` entier sûr -> `bigint` Postgres (chaîne), pour ne rien perdre au-delà de 2^31. */
export const big = (n: number | null | undefined): string | null => (n === null || n === undefined ? null : String(Math.trunc(n)));

/** `bigint` Postgres (chaîne) -> `number` (les montants de l'application tiennent dans 2^53). */
export const num = (s: string | number | null | undefined): number => (s === null || s === undefined ? 0 : Number(s));
export const numOrNull = (s: string | number | null | undefined): number | null => (s === null || s === undefined ? null : Number(s));
