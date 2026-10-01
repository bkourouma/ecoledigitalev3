/**
 * Aides SQL de l'infrastructure `tenancy`.
 *
 * Les NOMS de colonnes viennent exclusivement de tables de correspondance
 * écrites dans le code (jamais de l'entrée utilisateur) ; les VALEURS sont
 * toujours des paramètres `$n`.
 */
import type { Tx } from "@ecoledigitale/database";

/**
 * Construit `UPDATE <table> SET col = $n, ..., updated_at = $k WHERE <where>`.
 * @param columns  correspondance clé du patch -> colonne SQL (liste blanche)
 * @param patch    valeurs à écrire ; les clés `undefined` sont ignorées, `null` écrit NULL
 * @param where    condition déjà paramétrée, numérotée à partir de `$1`
 * @returns le nombre de lignes modifiées, ou `null` si le patch est vide
 */
export async function updateRow(
  tx: Tx,
  table: string,
  columns: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, unknown>>,
  now: Date,
  where: { sql: string; params: readonly unknown[] },
): Promise<{ rows: Array<Record<string, any>> } | null> {
  const sets: string[] = [];
  const params: unknown[] = [...where.params];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = columns[key];
    if (!column) throw new Error(`Champ non modifiable : ${key}`);
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return null;
  params.push(now);
  sets.push(`updated_at = $${params.length}`);
  const res = await tx.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${where.sql} RETURNING *`, params);
  return { rows: res.rows };
}
