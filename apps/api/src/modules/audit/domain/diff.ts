/**
 * Diff avant/après, calculé sur les valeurs BRUTES puis masqué.
 *
 * Calculer le diff sur des valeurs déjà masquées effacerait l'information « le mot de
 * passe a changé » (les deux côtés vaudraient `[MASKED]`). On compare donc les valeurs
 * réelles et on ne publie que `[MASKED]` pour les chemins sensibles.
 *
 * Format : `{ "<chemin>": { from?, to? } }`
 *   - chemin = clés séparées par `.` (un `.` ou `\` dans une clé est échappé par `\`) ;
 *   - `from` seul = champ supprimé ; `to` seul = champ ajouté ; les deux = modifié ;
 *   - les tableaux sont des FEUILLES (comparés en bloc) ;
 *   - racine non-objet (avant ou après) : chemin `$`.
 * Renvoie `null` quand il n'y a ni avant ni après (rien à comparer).
 */
import { canonicalize } from "./canonical";
import type { Masker } from "./masking";
import type { JsonValue } from "./types";

export type AuditDiff = Record<string, { from?: JsonValue; to?: JsonValue }>;

const isPlainObject = (v: JsonValue | undefined): v is { [key: string]: JsonValue } =>
  v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v);

const escapeSegment = (s: string): string => s.replace(/[\\.]/g, (c) => `\\${c}`);

export function computeDiff(
  before: JsonValue | null | undefined,
  after: JsonValue | null | undefined,
  masker: Masker,
): AuditDiff | null {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (!hasBefore && !hasAfter) return null;

  const diff: AuditDiff = Object.create(null);

  const record = (path: string, from: JsonValue | undefined, to: JsonValue | undefined, sensitive: boolean): void => {
    const entry: { from?: JsonValue; to?: JsonValue } = {};
    const show = (v: JsonValue): JsonValue => (sensitive && v !== null ? masker.replacement : masker.maskValue(v));
    if (from !== undefined) entry.from = show(from);
    if (to !== undefined) entry.to = show(to);
    diff[path] = entry;
  };

  const walk = (b: JsonValue | undefined, a: JsonValue | undefined, path: string[], sensitive: boolean): void => {
    if (b !== undefined && a !== undefined && canonicalize(b) === canonicalize(a)) return;

    // Les deux côtés sont des objets et le chemin n'est pas sensible : on descend.
    if (!sensitive && isPlainObject(b) && isPlainObject(a)) {
      const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const key of [...keys].sort()) {
        walk(b[key], a[key], [...path, key], masker.isSensitiveKey(key));
      }
      return;
    }
    // Création / suppression d'un objet entier : on descend aussi, champ par champ.
    if (!sensitive && ((b === undefined && isPlainObject(a)) || (a === undefined && isPlainObject(b)))) {
      const obj = (b ?? a) as { [key: string]: JsonValue };
      for (const key of Object.keys(obj).sort()) {
        walk(b === undefined ? undefined : obj[key], a === undefined ? undefined : obj[key], [...path, key], masker.isSensitiveKey(key));
      }
      return;
    }
    record(path.length === 0 ? "$" : path.map(escapeSegment).join("."), b, a, sensitive);
  };

  // Racine absente d'un côté : on traite comme un objet vide pour lister les champs ajoutés / retirés.
  const rootB = hasBefore ? (before as JsonValue) : isPlainObject(after ?? undefined) ? {} : undefined;
  const rootA = hasAfter ? (after as JsonValue) : isPlainObject(before ?? undefined) ? {} : undefined;
  walk(rootB, rootA, [], false);
  return diff;
}
