// Adaptateurs uniformes pour comparer les moteurs d'expressions (spike ADR-003).
// Chaque adaptateur : { id, label, family, compile(src) -> compiled, evaluate(compiled, ctx) -> value (sync ou async) }
// `schema` : variables déclarées { nom: 'num' | 'str' | 'obj' } (utilisé pour la vérification à la publication).
import Decimal from 'decimal.js';
import jsonata from 'jsonata';
import * as marc from '@marcbachmann/cel-js';
import * as celjs from 'cel-js';
import * as buf from '@bufbuild/cel';
import * as peggyProto from './proto/peggy-interp.mjs';

export const SCHEMA = {
  devoirs: 'num',
  examen: 'num',
  s1: 'num',
  s2: 'num',
  period: 'obj',
  a: 'obj',
  s: 'str',
};

/** Convertit récursivement les nombres JS en Decimal exacts (via leur représentation décimale la plus courte). */
const toDecimals = (v) => {
  if (typeof v === 'number') return new Decimal(String(v));
  if (Array.isArray(v)) return v.map(toDecimals);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toDecimals(x)]));
  return v;
};

/** arrondi « au plus proche, égalité vers +inf » en flottants : meilleure tentative honnête (astuce de l'exposant décimal). */
const floatRoundHalfUp = (x, places) => Number(Math.round(Number(`${x}e${places}`)) + `e-${places}`);

/* ------------------------------- CEL : marc ------------------------------ */
function makeMarcEnv(limits) {
  const t = { num: 'double', str: 'string', obj: 'map' };
  let env = new marc.Environment({ limits });
  for (const [name, type] of Object.entries(SCHEMA)) env = env.registerVariable(name, t[type]);
  env = env
    .registerFunction('round_half_up(double, int): double', (x, n) => floatRoundHalfUp(x, Number(n)))
    .registerFunction('clamp(double, double, double): double', (x, lo, hi) => Math.min(Math.max(x, lo), hi));
  return env;
}

export const marcAdapter = {
  id: 'cel-marc',
  label: '@marcbachmann/cel-js 8.0.0 (flottants)',
  family: 'cel',
  env: makeMarcEnv({ maxAstNodes: 100_000, maxDepth: 250 }),
  compile(src) {
    const res = this.env.check(src);
    if (!res.valid) throw res.error;
    return this.env.parse(src);
  },
  evaluate(compiled, ctx) {
    return compiled(ctx);
  },
};

/* ----------------------- CEL : marc + type Decimal ---------------------- */
function makeMarcDecEnv() {
  const t = { num: 'Decimal', str: 'string', obj: 'map' };
  let env = new marc.Environment();
  env = env.registerType('Decimal', { ctor: Decimal, fields: {} });
  for (const [name, type] of Object.entries(SCHEMA)) env = env.registerVariable(name, t[type]);
  env = env
    .registerFunction('dec(string): Decimal', (s) => new Decimal(s))
    .registerFunction('dec(int): Decimal', (n) => new Decimal(n.toString()))
    .registerFunction('round_half_up(Decimal, int): Decimal', (x, n) =>
      x.toDecimalPlaces(Number(n), Decimal.ROUND_HALF_UP),
    );
  for (const [op, fn] of [
    ['+', (a, b) => a.plus(b)],
    ['-', (a, b) => a.minus(b)],
    ['*', (a, b) => a.times(b)],
    ['/', (a, b) => a.div(b)],
  ]) {
    env = env.registerOperator(`Decimal ${op} Decimal`, fn);
  }
  for (const [op, fn] of [
    ['<', (a, b) => a.lt(b)],
    ['<=', (a, b) => a.lte(b)],
    ['>', (a, b) => a.gt(b)],
    ['>=', (a, b) => a.gte(b)],
    ['==', (a, b) => a.eq(b)],
  ]) {
    env = env.registerOperator(`Decimal ${op} Decimal`, fn);
  }
  return env;
}

export const marcDecAdapter = {
  id: 'cel-marc-dec',
  label: '@marcbachmann/cel-js + type Decimal enregistré',
  family: 'cel-dec',
  env: makeMarcDecEnv(),
  compile(src) {
    const res = this.env.check(src);
    if (!res.valid) throw res.error;
    return this.env.parse(src);
  },
  evaluate(compiled, ctx) {
    return compiled(toDecimals(ctx));
  },
};

/* ------------------------------- CEL : cel-js ---------------------------- */
export const celjsAdapter = {
  id: 'cel-js',
  label: 'cel-js 0.8.2 (chevrotain)',
  family: 'cel',
  compile(src) {
    const ast = celjs.parse(src);
    if (!ast.isSuccess) throw new Error(ast.errors.join(' | '));
    return ast.cst;
  },
  evaluate(compiled, ctx) {
    return celjs.evaluate(compiled, ctx, {
      round_half_up: (x, n) => floatRoundHalfUp(x, Number(n)),
      clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
    });
  },
};

/* ------------------------------ CEL : bufbuild --------------------------- */
const { CelScalar } = buf;
const bufEnv = buf.celEnv({
  variables: {
    devoirs: CelScalar.DOUBLE,
    examen: CelScalar.DOUBLE,
    s1: CelScalar.DOUBLE,
    s2: CelScalar.DOUBLE,
    period: buf.mapType(CelScalar.STRING, CelScalar.DYN),
    a: buf.mapType(CelScalar.STRING, CelScalar.DYN),
    s: CelScalar.STRING,
  },
  funcs: [
    buf.celFunc('round_half_up', [CelScalar.DOUBLE, CelScalar.INT], CelScalar.DOUBLE, (x, n) =>
      floatRoundHalfUp(x, Number(n)),
    ),
  ],
});
export const bufAdapter = {
  id: 'cel-bufbuild',
  label: '@bufbuild/cel 0.6.1 (RE2, flottants)',
  family: 'cel',
  compile(src) {
    return buf.plan(bufEnv, buf.parse(src));
  },
  evaluate(compiled, ctx) {
    const r = compiled(ctx);
    if (buf.isCelError(r)) throw r;
    return r;
  },
};

/* -------------------------------- JSONata -------------------------------- */
export const jsonataAdapter = {
  id: 'jsonata',
  label: 'JSONata 2.2.2 (flottants)',
  family: 'jsonata',
  compile(src) {
    const e = jsonata(src);
    e.registerFunction('round_half_up', (x, n) => floatRoundHalfUp(x, n ?? 0));
    e.registerFunction('clamp', (x, lo, hi) => Math.min(Math.max(x, lo), hi));
    return e;
  },
  evaluate(compiled, ctx) {
    return compiled.evaluate(ctx);
  },
};

/* ------------------------- Maison : Peggy + interpréteur ----------------- */
export const peggyAdapter = {
  id: 'maison-peggy',
  label: 'Maison : Peggy 5.1 + interpréteur + decimal.js',
  family: 'custom',
  compile(src) {
    return peggyProto.compile(src, { vars: Object.keys(SCHEMA) });
  },
  evaluate(compiled, ctx) {
    const { period, ...rest } = ctx;
    return peggyProto.evaluate(compiled, { vars: toDecimals(rest), periods: toDecimals(period ?? {}) });
  },
};

/** Maison : Pratt écrit à la main (package final). Chargé dynamiquement si `dist/` existe. */
export async function loadCustomPratt() {
  try {
    const mod = await import('../dist/index.js');
    return {
      id: 'maison-pratt',
      label: 'Maison : Pratt manuel + interpréteur + decimal.js (@ecoledigitale/rules-engine)',
      family: 'custom',
      compile(src) {
        return mod.compile(src, {
          variables: {
            devoirs: 'number',
            examen: 'number',
            s1: 'number',
            s2: 'number',
            a: { object: { b: 'number' } },
            s: 'string',
          },
          lookups: { period: { keys: ['S1', 'S2'], value: { object: { average: 'number' } } } },
        });
      },
      evaluate(compiled, ctx) {
        const { period, ...variables } = ctx;
        const res = mod.evaluate(compiled, { variables, lookups: { period: period ?? {} } });
        return res.json;
      },
    };
  } catch (e) {
    return null;
  }
}

export const baseAdapters = [marcAdapter, marcDecAdapter, celjsAdapter, bufAdapter, jsonataAdapter, peggyAdapter];
