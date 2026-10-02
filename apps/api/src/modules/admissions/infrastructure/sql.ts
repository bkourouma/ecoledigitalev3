/**
 * Aides SQL communes : instants renvoyés en ISO 8601 UTC et dates en `AAAA-MM-JJ` directement par Postgres (le pilote `pg`
 * convertirait sinon les `timestamptz` en `Date` locale et les `date` à minuit local).
 */
export const ts = (column: string, alias: string): string => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "${alias}"`;
export const dt = (column: string, alias: string): string => `to_char(${column}, 'YYYY-MM-DD') AS "${alias}"`;

/** Construit `SET a = $n, b = $m …` pour un patch partiel ; ignore les champs `undefined`. Renvoie `null` si rien à écrire. */
export function buildSet(patch: Record<string, unknown>, columns: Readonly<Record<string, string>>, startAt = 1): { set: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${startAt + params.length - 1}`);
  }
  return sets.length === 0 ? null : { set: sets.join(", "), params };
}

/** Échappe `%`, `_` et `\` d'une saisie utilisée dans un `ILIKE`. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
