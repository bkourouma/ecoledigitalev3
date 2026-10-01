/**
 * Aides SQL communes aux dépôts du module. TOUT l'accès aux données passe par `Tx` (TenantDb) : les requêtes sont
 * paramétrées (`$n`), les noms de colonnes viennent du code (jamais d'une entrée), les dates calendaires sont lues en
 * texte (`::text` → `AAAA-MM-JJ`) pour échapper aux conversions de fuseau de `pg`.
 */
import type { Tx } from "@ecoledigitale/database";

/** Instant ISO 8601 UTC d'une valeur `timestamptz` renvoyée par `pg` (Date) ou déjà texte. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const isoOrNull = (value: Date | string | null | undefined): string | null => (value === null || value === undefined ? null : iso(value));

/** `numeric` / `bigint` renvoyés en texte par `pg`. */
export const num = (value: string | number): number => (typeof value === "number" ? value : Number(value));
export const numOrNull = (value: string | number | null | undefined): number | null => (value === null || value === undefined ? null : num(value));

/** `HH:MM:SS` → `HH:MM`. */
export const hhmm = (value: string): string => value.slice(0, 5);

/** Échappe `%`, `_` et `\` pour un motif `LIKE … ESCAPE '\'`. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type ColumnValues = Record<string, unknown>;

/**
 * `UPDATE table SET col = $n, …, updated_at = $m WHERE tenant_id = $1 AND id = $2`. Seules les entrées dont la valeur
 * n'est pas `undefined` sont écrites (`null` efface). Renvoie le nombre de lignes modifiées ; ne fait rien (0) sans
 * colonne à écrire. `columns` est construit par le code appelant, jamais depuis une clé de requête.
 */
export async function updateById(
  tx: Tx,
  table: string,
  tenantId: string,
  id: string,
  columns: ColumnValues,
  now: Date | null,
  idColumn = "id",
): Promise<number> {
  const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (entries.length === 0 && now === null) return 0;
  const params: unknown[] = [tenantId, id];
  const sets = entries.map(([col, value]) => {
    params.push(value);
    return `${col} = $${params.length}`;
  });
  if (now !== null) {
    params.push(now);
    sets.push(`updated_at = $${params.length}`);
  }
  if (sets.length === 0) return 0;
  const res = await tx.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE tenant_id = $1 AND ${idColumn} = $2`, params);
  return res.rowCount;
}

/** Construit un `WHERE` à partir de fragments ; les valeurs sont ajoutées à `params` et référencées par `$n`. */
export class Where {
  readonly params: unknown[];
  private readonly clauses: string[] = [];
  constructor(initial: readonly unknown[] = []) {
    this.params = [...initial];
  }
  /** Ajoute une valeur et renvoie son marqueur `$n`. */
  bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  and(clause: string): this {
    this.clauses.push(clause);
    return this;
  }
  get sql(): string {
    return this.clauses.length === 0 ? "" : ` AND ${this.clauses.join(" AND ")}`;
  }
}
