import type { CallNode, Node } from './ast';
import { Decimal, ROUND_CEIL, ROUND_FLOOR, ROUND_HALF_EVEN, ROUND_HALF_UP, type RoundingMode } from './decimal';
import type { RuleErrorCode } from './errors';
import { BUILTIN_FUNCTION_NAMES } from './function-names';
import type { Runtime, Value } from './runtime';
import { T_BOOLEAN, T_NUMBER, T_NUMBER_OPT, describeType, withNullable, type Ty } from './types';

/**
 * Bibliothèque de fonctions (liste blanche). Toutes sont PURES : aucune I/O,
 * aucune horloge, aucun aléa. Les listes sont parcourues une fois et chaque
 * élément coûte une unité de budget.
 *
 * Valeurs absentes (null) : les agrégats (avg, wavg, sum, min, max, count)
 * IGNORENT les valeurs absentes ; avg/wavg/min/max renvoient null quand il ne
 * reste rien à agréger.
 */

export interface FnCheckCtx {
  report(code: RuleErrorCode, message: string, node: Node, hint?: string): void;
}

export interface FunctionDef {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  /** Fonctions à évaluation paresseuse (vérifiées et évaluées par le vérificateur / l'évaluateur eux-mêmes). */
  readonly lazy?: true;
  check?(c: FnCheckCtx, call: CallNode, args: readonly (Ty | undefined)[]): Ty | undefined;
  run?(rt: Runtime, call: CallNode, args: readonly Value[]): Value;
}

const MAX_PLACES = 12;

/* ------------------------------ vérifications ----------------------------- */

function ordinal(i: number): string {
  return i === 0 ? '1er' : `${i + 1}e`;
}

/** Argument scalaire numérique (nullable accepté si `allowNull`). */
function expectNumber(c: FnCheckCtx, fn: string, call: CallNode, i: number, t: Ty | undefined, allowNull: boolean): boolean {
  if (!t) return false;
  const node = call.args[i] as Node;
  if (t.k !== 'number') {
    c.report('TYPE_INCOMPATIBLE', `Le ${ordinal(i)} argument de « ${fn} » doit être un nombre, mais c'est : ${describeType(t)}.`, node);
    return false;
  }
  if (t.nullable && !allowNull) {
    c.report(
      'VALEUR_PEUT_ETRE_ABSENTE',
      `Le ${ordinal(i)} argument de « ${fn} » peut être absent.`,
      node,
      'Utilisez coalesce(valeur, défaut), ou testez is_null(valeur) avant.',
    );
    return false;
  }
  return true;
}

/** Argument liste de nombres (éléments éventuellement absents). */
function expectNumberList(c: FnCheckCtx, fn: string, call: CallNode, i: number, t: Ty | undefined): boolean {
  if (!t) return false;
  const node = call.args[i] as Node;
  if (t.k !== 'list' || t.item.k !== 'number') {
    c.report('TYPE_INCOMPATIBLE', `Le ${ordinal(i)} argument de « ${fn} » doit être une liste de nombres, mais c'est : ${describeType(t)}.`, node);
    return false;
  }
  if (t.nullable) {
    c.report('VALEUR_PEUT_ETRE_ABSENTE', `Le ${ordinal(i)} argument de « ${fn} » (une liste) peut être absent.`, node, 'Utilisez coalesce pour fournir une liste par défaut ou testez is_null avant.');
    return false;
  }
  return true;
}

function literalNumberValue(node: Node): string | undefined {
  return node.t === 'number' ? node.value : undefined;
}

function checkPlaces(c: FnCheckCtx, fn: string, call: CallNode, i: number, t: Ty | undefined): void {
  if (call.args.length <= i) return;
  if (!expectNumber(c, fn, call, i, t, false)) return;
  const lit = literalNumberValue(call.args[i] as Node);
  if (lit !== undefined) {
    const d = new Decimal(lit);
    if (!d.isInteger() || d.lt(0) || d.gt(MAX_PLACES)) {
      c.report('ARGUMENT_INVALIDE', `Le nombre de décimales de « ${fn} » doit être un entier entre 0 et ${MAX_PLACES} (reçu : ${lit}).`, call.args[i] as Node);
    }
  }
}

/** Agrégat numérique : arguments scalaires et/ou listes de nombres. */
function checkAggregate(
  c: FnCheckCtx,
  fn: string,
  call: CallNode,
  args: readonly (Ty | undefined)[],
  nullableResult: (hasGuaranteed: boolean) => boolean,
): Ty | undefined {
  let ok = true;
  let guaranteed = false;
  args.forEach((t, i) => {
    if (!t) {
      ok = false;
      return;
    }
    if (t.k === 'list') {
      ok = expectNumberList(c, fn, call, i, t) && ok;
    } else if (t.k === 'number') {
      if (!t.nullable) guaranteed = true;
    } else {
      c.report('TYPE_INCOMPATIBLE', `Le ${ordinal(i)} argument de « ${fn} » doit être un nombre ou une liste de nombres, mais c'est : ${describeType(t)}.`, call.args[i] as Node);
      ok = false;
    }
  });
  if (!ok) return undefined;
  return nullableResult(guaranteed) ? T_NUMBER_OPT : T_NUMBER;
}

/* ------------------------------- évaluation ------------------------------- */

function asDecimal(v: Value, rt: Runtime, call: CallNode, what: string): Decimal {
  if (v instanceof Decimal) return v;
  return rt.fail('VALEUR_ABSENTE', `${what} est absent(e) alors qu'un nombre est requis.`, call);
}

/** Aplatit les arguments (scalaires et listes) en nombres, en ignorant les absents. */
function collectNumbers(rt: Runtime, call: CallNode, args: readonly Value[]): Decimal[] {
  const out: Decimal[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      const arr = a as readonly Value[];
      rt.consume(arr.length, call);
      for (const x of arr) if (x instanceof Decimal) out.push(x);
    } else if (a instanceof Decimal) {
      out.push(a);
    }
  }
  return out;
}

function sumOf(nums: readonly Decimal[]): Decimal {
  let s = new Decimal(0);
  for (const n of nums) s = s.plus(n);
  return s;
}

function placesOf(rt: Runtime, call: CallNode, args: readonly Value[], i: number): number {
  const raw = args[i];
  if (raw === undefined) return 0;
  const d = asDecimal(raw, rt, call, `Le nombre de décimales de « ${call.callee} »`);
  if (!d.isInteger() || d.lt(0) || d.gt(MAX_PLACES)) {
    return rt.fail('DOMAINE_INVALIDE', `Le nombre de décimales de « ${call.callee} » doit être un entier entre 0 et ${MAX_PLACES} (reçu : ${d.toString()}).`, call);
  }
  return d.toNumber();
}

function roundingFn(name: string, mode: RoundingMode): FunctionDef {
  return {
    name,
    min: 1,
    max: 2,
    check(c, call, args) {
      const okX = expectNumber(c, name, call, 0, args[0], true);
      checkPlaces(c, name, call, 1, args[1]);
      if (!okX) return undefined;
      return withNullable(T_NUMBER, (args[0] as Ty).nullable);
    },
    run(rt, call, args) {
      const x = args[0];
      if (x === null) return null;
      const d = asDecimal(x as Value, rt, call, 'Le 1er argument');
      return d.toDecimalPlaces(placesOf(rt, call, args, 1), mode);
    },
  };
}

const defs: FunctionDef[] = [
  {
    name: 'avg',
    min: 1,
    max: 16,
    check: (c, call, args) => checkAggregate(c, 'avg', call, args, (g) => !g),
    run(rt, call, args) {
      const nums = collectNumbers(rt, call, args);
      return nums.length === 0 ? null : sumOf(nums).div(nums.length);
    },
  },
  {
    name: 'sum',
    min: 1,
    max: 16,
    check: (c, call, args) => checkAggregate(c, 'sum', call, args, () => false),
    run: (rt, call, args) => sumOf(collectNumbers(rt, call, args)),
  },
  {
    name: 'min',
    min: 1,
    max: 16,
    check: (c, call, args) => checkAggregate(c, 'min', call, args, (g) => !g),
    run(rt, call, args) {
      const nums = collectNumbers(rt, call, args);
      let best: Decimal | null = null;
      for (const n of nums) if (best === null || n.lt(best)) best = n;
      return best;
    },
  },
  {
    name: 'max',
    min: 1,
    max: 16,
    check: (c, call, args) => checkAggregate(c, 'max', call, args, (g) => !g),
    run(rt, call, args) {
      const nums = collectNumbers(rt, call, args);
      let best: Decimal | null = null;
      for (const n of nums) if (best === null || n.gt(best)) best = n;
      return best;
    },
  },
  {
    name: 'count',
    min: 1,
    max: 16,
    check: (c, call, args) => checkAggregate(c, 'count', call, args, () => false),
    run: (rt, call, args) => new Decimal(collectNumbers(rt, call, args).length),
  },
  {
    name: 'wavg',
    min: 2,
    max: 2,
    check(c, call, args) {
      const a = expectNumberList(c, 'wavg', call, 0, args[0]);
      const b = expectNumberList(c, 'wavg', call, 1, args[1]);
      return a && b ? T_NUMBER_OPT : undefined;
    },
    run(rt, call, args) {
      const values = args[0] as readonly Value[];
      const weights = args[1] as readonly Value[];
      if (values.length !== weights.length) {
        return rt.fail(
          'LONGUEURS_DIFFERENTES',
          `wavg : la liste des valeurs (${values.length}) et celle des poids (${weights.length}) n'ont pas la même longueur.`,
          call,
        );
      }
      rt.consume(values.length, call);
      let num = new Decimal(0);
      let den = new Decimal(0);
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const w = weights[i];
        if (!(v instanceof Decimal) || !(w instanceof Decimal)) continue;
        if (w.isNegative()) {
          return rt.fail('DOMAINE_INVALIDE', `wavg : le poids n°${i + 1} est négatif (${w.toString()}).`, call);
        }
        num = num.plus(v.times(w));
        den = den.plus(w);
      }
      return den.isZero() ? null : num.div(den);
    },
  },
  {
    name: 'clamp',
    min: 3,
    max: 3,
    check(c, call, args) {
      const x = expectNumber(c, 'clamp', call, 0, args[0], true);
      const lo = expectNumber(c, 'clamp', call, 1, args[1], false);
      const hi = expectNumber(c, 'clamp', call, 2, args[2], false);
      if (!(x && lo && hi)) return undefined;
      return withNullable(T_NUMBER, (args[0] as Ty).nullable);
    },
    run(rt, call, args) {
      if (args[0] === null) return null;
      const x = asDecimal(args[0] as Value, rt, call, 'Le 1er argument');
      const lo = asDecimal(args[1] as Value, rt, call, 'Le 2e argument');
      const hi = asDecimal(args[2] as Value, rt, call, 'Le 3e argument');
      if (lo.gt(hi)) {
        return rt.fail('DOMAINE_INVALIDE', `clamp : la borne inférieure (${lo.toString()}) dépasse la borne supérieure (${hi.toString()}).`, call);
      }
      return x.lt(lo) ? lo : x.gt(hi) ? hi : x;
    },
  },
  {
    name: 'abs',
    min: 1,
    max: 1,
    check(c, call, args) {
      if (!expectNumber(c, 'abs', call, 0, args[0], true)) return undefined;
      return withNullable(T_NUMBER, (args[0] as Ty).nullable);
    },
    run(rt, call, args) {
      if (args[0] === null) return null;
      return asDecimal(args[0] as Value, rt, call, 'Le 1er argument').abs();
    },
  },
  roundingFn('round_half_up', ROUND_HALF_UP),
  roundingFn('round_half_even', ROUND_HALF_EVEN),
  roundingFn('floor', ROUND_FLOOR),
  roundingFn('ceil', ROUND_CEIL),
  {
    name: 'is_null',
    min: 1,
    max: 1,
    check: (_c, _call, args) => (args[0] ? T_BOOLEAN : undefined),
    run: (_rt, _call, args) => args[0] === null,
  },
  { name: 'if', min: 3, max: 3, lazy: true },
  { name: 'coalesce', min: 2, max: 2, lazy: true },
  { name: 'map', min: 2, max: 2, lazy: true },
  { name: 'filter', min: 2, max: 2, lazy: true },
  { name: 'any', min: 2, max: 2, lazy: true },
  { name: 'all', min: 2, max: 2, lazy: true },
  {
    name: 'len',
    min: 1,
    max: 1,
    check(c, call, args) {
      const t = args[0];
      if (!t) return undefined;
      if (t.k !== 'list') {
        c.report('TYPE_INCOMPATIBLE', `L'argument de « len » doit être une liste, mais c'est : ${describeType(t)}.`, call.args[0] as Node);
        return undefined;
      }
      if (t.nullable) {
        c.report('VALEUR_PEUT_ETRE_ABSENTE', 'L\'argument de « len » (une liste) peut être absent.', call.args[0] as Node);
        return undefined;
      }
      return T_NUMBER;
    },
    run(rt, call, args) {
      const l = args[0] as readonly Value[];
      rt.consume(1, call);
      return new Decimal(l.length);
    },
  },
  {
    name: 'rank',
    min: 2,
    max: 3,
    check(c, call, args) {
      const v = expectNumber(c, 'rank', call, 0, args[0], true);
      const l = expectNumberList(c, 'rank', call, 1, args[1]);
      checkPlaces(c, 'rank', call, 2, args[2]);
      if (!(v && l)) return undefined;
      return withNullable(T_NUMBER, (args[0] as Ty).nullable);
    },
    run(rt, call, args) {
      if (args[0] === null) return null;
      const value = asDecimal(args[0] as Value, rt, call, 'Le 1er argument');
      const list = args[1] as readonly Value[];
      rt.consume(list.length, call);
      const places = args[2] === undefined ? undefined : placesOf(rt, call, args, 2);
      const key = (d: Decimal): Decimal => (places === undefined ? d : d.toDecimalPlaces(places, ROUND_HALF_UP));
      const mine = key(value);
      // Classement « de compétition » : les ex æquo partagent le meilleur rang (1, 2, 2, 4…).
      let better = 0;
      for (const item of list) if (item instanceof Decimal && key(item).gt(mine)) better++;
      return new Decimal(better + 1);
    },
  },
];

export const FUNCTIONS: ReadonlyMap<string, FunctionDef> = new Map(defs.map((d) => [d.name, d]));

// Garde-fou de cohérence : le registre expose exactement les noms déclarés.
if (FUNCTIONS.size !== BUILTIN_FUNCTION_NAMES.size || [...FUNCTIONS.keys()].some((k) => !BUILTIN_FUNCTION_NAMES.has(k))) {
  throw new Error('rules-engine : le registre de fonctions diverge de BUILTIN_FUNCTION_NAMES');
}

export function arityText(def: Pick<FunctionDef, 'min' | 'max'>): string {
  if (def.min === def.max) return `${def.min} argument${def.min > 1 ? 's' : ''}`;
  if (def.max >= 16) return `au moins ${def.min} argument${def.min > 1 ? 's' : ''}`;
  return `entre ${def.min} et ${def.max} arguments`;
}
