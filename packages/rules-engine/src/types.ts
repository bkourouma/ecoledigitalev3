/**
 * Système de types statique du DSL.
 *
 * Types de base : nombre, texte, booléen, null (littéral `null`), liste<T>,
 * objet {champ: T}. Tout type peut être « nullable » (valeur éventuellement
 * absente) : l'usage d'une valeur nullable dans une opération arithmétique ou
 * une comparaison d'ordre est refusé à la publication, sauf après un test
 * `is_null(...)` ou un `coalesce(...)`.
 */

export type Ty =
  | { k: 'number'; nullable: boolean }
  | { k: 'string'; nullable: boolean }
  | { k: 'boolean'; nullable: boolean }
  | { k: 'null'; nullable: true }
  | { k: 'list'; item: Ty; nullable: boolean }
  | { k: 'object'; fields: Readonly<Record<string, Ty>>; nullable: boolean };

export const T_NUMBER: Ty = { k: 'number', nullable: false };
export const T_NUMBER_OPT: Ty = { k: 'number', nullable: true };
export const T_STRING: Ty = { k: 'string', nullable: false };
export const T_BOOLEAN: Ty = { k: 'boolean', nullable: false };
export const T_NULL: Ty = { k: 'null', nullable: true };

export function listOf(item: Ty, nullable = false): Ty {
  return { k: 'list', item, nullable };
}

export function withNullable(t: Ty, nullable: boolean): Ty {
  if (t.k === 'null') return t;
  return { ...t, nullable } as Ty;
}

export function nonNull(t: Ty): Ty {
  return t.k === 'null' ? t : withNullable(t, false);
}

/** Description lisible en français (utilisée dans les messages d'erreur). */
export function describeType(t: Ty): string {
  const opt = t.nullable && t.k !== 'null' ? ' (peut être absent)' : '';
  switch (t.k) {
    case 'number':
      return `nombre${opt}`;
    case 'string':
      return `texte${opt}`;
    case 'boolean':
      return `booléen${opt}`;
    case 'null':
      return 'null';
    case 'list':
      return `liste de ${describeType(t.item)}${opt}`;
    case 'object':
      return `objet${opt}`;
  }
}

/** Même forme, sans tenir compte de la nullité. */
export function sameShape(a: Ty, b: Ty): boolean {
  if (a.k === 'null' || b.k === 'null') return a.k === b.k;
  if (a.k !== b.k) return false;
  if (a.k === 'list' && b.k === 'list') return sameShape(a.item, b.item);
  if (a.k === 'object' && b.k === 'object') {
    const ka = Object.keys(a.fields);
    const kb = Object.keys(b.fields);
    if (ka.length !== kb.length) return false;
    return ka.every((key) => {
      const fa = a.fields[key];
      const fb = b.fields[key];
      return fa !== undefined && fb !== undefined && sameShape(fa, fb);
    });
  }
  return true;
}

/**
 * Unifie deux types de branches (if, coalesce, éléments d'une liste).
 * Retourne `undefined` si les formes sont incompatibles.
 */
export function unify(a: Ty, b: Ty): Ty | undefined {
  if (a.k === 'null') return b.k === 'null' ? a : withNullable(b, true);
  if (b.k === 'null') return withNullable(a, true);
  if (!sameShape(a, b)) return undefined;
  return withNullable(a, a.nullable || b.nullable);
}

/** Type scalaire attendu pour le résultat d'une règle. */
export type ResultTypeSpec =
  | 'number'
  | 'number?'
  | 'string'
  | 'string?'
  | 'boolean'
  | 'boolean?';

export function resultSpecToTy(spec: ResultTypeSpec): Ty {
  const nullable = spec.endsWith('?');
  const base = nullable ? spec.slice(0, -1) : spec;
  return { k: base as 'number' | 'string' | 'boolean', nullable } as Ty;
}

/** Le résultat `actual` est-il acceptable pour l'attendu `expected` ? */
export function resultMatches(actual: Ty, expected: Ty): boolean {
  if (actual.k === 'null') return expected.nullable;
  if (actual.k !== expected.k) return false;
  return !actual.nullable || expected.nullable;
}
