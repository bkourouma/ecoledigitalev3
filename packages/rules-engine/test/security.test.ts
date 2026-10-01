import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RuleBudgetError,
  RuleCheckError,
  RuleError,
  RuleSyntaxError,
  compile,
  evaluate,
  validate,
  type EvalContext,
  type RuleSchemaSpec,
} from '../src';

const SCHEMA: RuleSchemaSpec = {
  variables: {
    a: { object: { b: 'number' } },
    x: 'number',
    s: 'string',
    xs: { list: 'number' },
  },
};

const CTX: EvalContext = { variables: { a: { b: 1 }, x: 2, s: 'texte', xs: [1, 2, 3] } };

/** Expressions hostiles : AUCUNE ne doit compiler. */
const HOSTILE: readonly string[] = [
  'constructor',
  '__proto__',
  'prototype',
  'a.constructor',
  'a.__proto__',
  'a.constructor.constructor("return process")()',
  'a.__proto__.polluted',
  'a["constructor"]',
  'a["__proto__"]["x"]',
  's.constructor',
  '"".constructor',
  '[].constructor',
  '(1).constructor',
  'x.toString()',
  'a.hasOwnProperty("b")',
  'a.valueOf',
  'this',
  'this.constructor',
  'globalThis',
  'global',
  'window',
  'self',
  'process',
  'process.env',
  'process.versions.node',
  'require("fs")',
  'require',
  'module.exports',
  'import("fs")',
  'import fs from "fs"',
  'eval("1")',
  'Function("return process")()',
  'new Function("return 1")',
  'new Date()',
  'Date.now()',
  'Math.random()',
  'now()',
  'random()',
  '$now()',
  'setTimeout(1)',
  'fetch("http://x")',
  '`${1}`',
  'a?.b',
  'x ?? 1',
  'x ** 2',
  'x = 1',
  'x += 1',
  'x++',
  'delete a.b',
  'typeof x',
  'void 0',
  'x instanceof Object',
  '"b" in a',
  '1; 2',
  '(1, 2)',
  'function(){ return 1 }',
  '() => 1',
  'x => x',
  'async x => x',
  '...a',
  'x ? 1 : 2',
  '{ b: 1 }',
  '{}',
  'while(true){}',
  'for(;;){}',
  'do {} while (1)',
  'x.y.z',
  'undefined',
  'NaN',
  'Infinity',
  'arguments',
  'Symbol.iterator',
  'Object.keys(a)',
  'JSON.stringify(a)',
  'a.b.c',
  'xs.length',
  'xs.map(p => p)',
  'sum(xs).constructor',
  'avg.call(1)',
  '__defineGetter__',
  '\\u0061',
  '"abc',
  '1 +',
  '#',
  '@x',
];

describe('évasions refusées à la compilation', () => {
  it.each(HOSTILE)('refuse : %s', (src) => {
    const run = () => compile(src, SCHEMA);
    expect(run).toThrowError(RuleError);
    const r = validate(src, SCHEMA);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    for (const d of r.diagnostics) {
      expect(['syntax', 'check']).toContain(d.phase);
      expect(d.message.length).toBeGreaterThan(5);
    }
  });

  it('les refus sont des RuleSyntaxError ou RuleCheckError, jamais une erreur JS native', () => {
    for (const src of HOSTILE) {
      try {
        compile(src, SCHEMA);
      } catch (e) {
        expect(e instanceof RuleSyntaxError || e instanceof RuleCheckError).toBe(true);
      }
    }
  });
});

describe('isolation à l\'évaluation', () => {
  const protoNames = () => Object.getOwnPropertyNames(Object.prototype).sort();

  it('un contexte hostile (__proto__, accesseurs, fonctions) ne pollue rien et n\'exécute rien', () => {
    const before = protoNames();
    const globalsBefore = Object.keys(globalThis).sort();
    const hostile = JSON.parse('{"__proto__": {"polluted": "oui"}, "x": 2, "a": {"b": 1}, "s": "t", "xs": [1]}') as Record<string, unknown>;
    const r = evaluate(compile('x + a.b', SCHEMA), { variables: hostile });
    expect(r.json).toBe('3');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(protoNames()).toEqual(before);
    expect(Object.keys(globalThis).sort()).toEqual(globalsBefore);
  });

  it('une valeur fonction est refusée comme donnée, jamais appelée', () => {
    const spy = vi.fn(() => 5);
    expect(() => evaluate(compile('x + 1', SCHEMA), { variables: { ...CTX.variables, x: spy } })).toThrowError(/nombre fini/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('valueOf / toString / toJSON / toStringTag fournis par les données ne sont jamais appelés', () => {
    const boom = vi.fn(() => {
      throw new Error('code des données exécuté !');
    });
    const sneaky = { valueOf: boom, toString: boom, toJSON: boom, toStringTag: '[object Decimal]' };
    expect(() => evaluate(compile('x + 1', SCHEMA), { variables: { ...CTX.variables, x: sneaky } })).toThrowError(/nombre fini/);
    expect(boom).not.toHaveBeenCalled();
    const obj = { b: 1, toString: boom, valueOf: boom };
    expect(evaluate(compile('a.b', SCHEMA), { variables: { ...CTX.variables, a: obj } }).json).toBe('1');
    expect(boom).not.toHaveBeenCalled();
  });

  it('une propriété héritée d\'Object.prototype n\'est jamais lue comme donnée', () => {
    Object.defineProperty(Object.prototype, 'x', { value: 99, configurable: true, writable: true, enumerable: false });
    try {
      expect(() => evaluate(compile('x + 1', SCHEMA), { variables: { a: { b: 1 }, s: '', xs: [] } })).toThrowError(/absente/);
      expect(() => evaluate(compile('a.b', SCHEMA), { variables: { a: Object.create({ b: 7 }) as object, x: 1, s: '', xs: [] } })).toThrowError(/objet simple/);
    } finally {
      delete (Object.prototype as Record<string, unknown>).x;
    }
  });

  it('les recherches ne lisent que des propriétés propres', () => {
    const schema: RuleSchemaSpec = { variables: {}, lookups: { period: { value: { object: { v: 'number' } } } } };
    const c = compile('period("toString").v', schema);
    expect(() => evaluate(c, { lookups: { period: {} } })).toThrowError(/absente/);
    expect(() => evaluate(compile('period("constructor").v', schema), { lookups: { period: {} } })).toThrowError(/absente/);
    const hostile = JSON.parse('{"period": {"__proto__": {"v": 1}}}') as Record<string, Record<string, unknown>>;
    expect(() => evaluate(compile('period("v").v', schema), { lookups: hostile })).toThrowError(/absente/);
  });

  it('la règle compilée et son AST sont gelés', () => {
    const c = compile('x + 1', SCHEMA);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.ast)).toBe(true);
    expect(() => {
      (c as { source: string }).source = 'x - 1';
    }).toThrowError(TypeError);
    expect(() => {
      (c.ast as unknown as { op: string }).op = '-';
    }).toThrowError(TypeError);
    expect(() => (c.names as string[]).push('y')).toThrowError(TypeError);
  });

  it('une règle reconstruite (JSON, structuredClone, objet forgé) n\'est pas évaluable', () => {
    const c = compile('x + 1', SCHEMA);
    expect(() => evaluate(JSON.parse(JSON.stringify(c)) as typeof c, CTX)).toThrowError(/Règle non reconnue/);
    expect(() => evaluate({ ...c }, CTX)).toThrowError(/Règle non reconnue/);
  });

  it('le contexte n\'est jamais modifié (même gelé en profondeur)', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
      }
      return o;
    };
    const ctx = deepFreeze({ variables: { a: { b: 1 }, x: 2, s: 'texte', xs: [3, 1, 2] } });
    const snapshot = JSON.stringify(ctx);
    const c = compile('rank(x, xs) + sum(map(xs, p => p * 2)) + coalesce(max(xs), 0) + a.b', SCHEMA);
    expect(evaluate(c, ctx).json).toBe('18'); // rang 2 + somme doublée 12 + max 3 + a.b 1
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });
});

describe('déterminisme', () => {
  const SRC = 'round_half_up((sum(xs) + 2 * x) / 3, 2) + rank(x, xs)';
  const trace = (r: ReturnType<typeof evaluate>) => JSON.stringify([r.json, r.trace, r.nodesEvaluated]);

  it('1000 évaluations donnent exactement le même résultat, la même trace et le même coût', () => {
    const c = compile(SRC, SCHEMA);
    const first = trace(evaluate(c, CTX));
    for (let i = 0; i < 1000; i++) expect(trace(evaluate(c, CTX))).toBe(first);
  });

  it('1000 compilations successives produisent la même AST', () => {
    const first = JSON.stringify(compile(SRC, SCHEMA).ast);
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(compile(SRC, SCHEMA).ast)).toBe(first);
  });

  it('ni aléa ni horloge n\'influencent la valeur : Math.random interdit, Date.now qui dérive', () => {
    const c = compile(SRC, SCHEMA);
    const expected = evaluate(c, CTX).json;
    const rnd = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random appelé !');
    });
    let t = 1_700_000_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (t += 7));
    try {
      for (let i = 0; i < 200; i++) expect(evaluate(c, CTX).json).toBe(expected);
      expect(rnd).not.toHaveBeenCalled();
    } finally {
      rnd.mockRestore();
      now.mockRestore();
    }
  });

  it('même résultat quel que soit l\'ordre d\'insertion des clés du contexte', () => {
    const c = compile('x + a.b + sum(xs)', SCHEMA);
    const c1: EvalContext = { variables: { a: { b: 1 }, x: 2, s: '', xs: [1, 2] } };
    const c2: EvalContext = { variables: { xs: [1, 2], s: '', x: 2, a: { b: 1 } } };
    expect(trace(evaluate(c, c1))).toBe(trace(evaluate(c, c2)));
  });
});

describe('pureté du paquet (analyse statique du code source)', () => {
  const srcDir = join(__dirname, '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
  const sources = files(srcDir).map((p) => ({ name: relative(srcDir, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('n\'importe que des modules relatifs, zod et decimal.js', () => {
    for (const { name, text } of sources) {
      const imports = [...code(text).matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
      for (const i of imports) {
        expect(i.startsWith('./') || i === 'zod' || i === 'decimal.js', `${name} importe « ${i} »`).toBe(true);
      }
    }
  });

  it('ne contient aucune évaluation dynamique, I/O, horloge ou aléa (sauf l\'horloge du budget)', () => {
    const forbidden: [RegExp, string][] = [
      [/\beval\s*\(/, 'eval'],
      [/\bnew\s+Function\b/, 'new Function'],
      [/(^|[^.\w])Function\s*\(/, 'Function()'],
      [/\brequire\s*\(/, 'require'],
      [/\bimport\s*\(/, 'import()'],
      [/\bprocess\b/, 'process'],
      [/\bglobalThis\b/, 'globalThis'],
      [/\bMath\.random\b/, 'Math.random'],
      [/\bcrypto\b/, 'crypto'],
      [/\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b/, 'timers'],
      [/\bfetch\s*\(/, 'fetch'],
      [/\bconsole\./, 'console'],
      [/\bnew\s+Date\b/, 'new Date'],
      [/\bperformance\b/, 'performance'],
      [/\bwith\s*\(/, 'with'],
      [/\.__proto__\b|__proto__\s*:/, '__proto__ en écriture'],
    ];
    for (const { name, text } of sources) {
      const c = code(text);
      for (const [re, label] of forbidden) {
        expect(re.test(c), `${name} utilise ${label}`).toBe(false);
      }
    }
  });

  it('Date.now n\'apparaît qu\'une seule fois : l\'horloge par défaut du budget de temps', () => {
    const hits = sources.flatMap(({ name, text }) => (code(text).match(/Date\.now/g) ?? []).map(() => name));
    expect(hits).toEqual(['compile.ts']);
  });

  it('le package.json ne dépend ni de Fastify, ni de pg, ni de Next, ni de React', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['decimal.js', 'zod']);
  });
});

describe('budget : l\'explosion combinatoire est stoppée proprement', () => {
  const BIG: RuleSchemaSpec = { variables: { l: { list: 'number' } } };
  const l = Array.from({ length: 1000 }, (_, i) => i);

  it('3 niveaux imbriqués sur 1000 éléments (10^9 itérations) : erreur de budget en moins de 3 s', () => {
    const c = compile('any(l, a => any(l, b => any(l, c => a + b + c > 1000000)))', BIG);
    const t0 = Date.now();
    try {
      evaluate(c, { variables: { l } });
      throw new Error('devait dépasser le budget');
    } catch (e) {
      expect(e).toBeInstanceOf(RuleBudgetError);
      expect((e as RuleBudgetError).code).toBe('BUDGET_NOEUDS_DEPASSE');
      expect((e as RuleBudgetError).message).toContain('Budget d\'évaluation dépassé');
      expect((e as RuleBudgetError).position?.line).toBe(1);
    }
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('une grande liste de données dépasse le budget dès sa lecture', () => {
    const c = compile('sum(l)', BIG);
    const huge = Array.from({ length: 200_000 }, () => 1);
    expect(() => evaluate(c, { variables: { l: huge } })).toThrowError(RuleBudgetError);
    expect(evaluate(c, { variables: { l: huge } }, { budget: { maxNodes: 1_000_000 } }).json).toBe('200000');
  });

  it('budget de temps : horloge injectée', () => {
    const c = compile('any(l, a => any(l, b => a + b < 0))', BIG);
    let now = 0;
    const clock = () => (now += 10);
    try {
      evaluate(c, { variables: { l } }, { clock, budget: { maxMillis: 50, maxNodes: 1e12 } });
      throw new Error('devait dépasser le temps');
    } catch (e) {
      expect(e).toBeInstanceOf(RuleBudgetError);
      expect((e as RuleBudgetError).code).toBe('BUDGET_TEMPS_DEPASSE');
      expect((e as RuleBudgetError).message).toMatch(/plus de 50 ms/);
    }
  });

  it('budget de temps désactivable (Infinity) et par défaut actif', () => {
    const c = compile('sum(l)', BIG);
    let calls = 0;
    const clock = () => (calls++, 0);
    evaluate(c, { variables: { l: [1, 2, 3] } }, { clock, budget: { maxMillis: Infinity } });
    expect(calls).toBeGreaterThan(0); // t0 lu : l'horloge reste injectable
    expect(evaluate(c, { variables: { l: [1] } }).json).toBe('1');
  });

  it('maxNodes borne aussi les expressions simples', () => {
    const c = compile('1 + 2 + 3 + 4', BIG);
    expect(evaluate(c, {}, { budget: { maxNodes: 7 } }).json).toBe('10');
    expect(() => evaluate(c, {}, { budget: { maxNodes: 6 } })).toThrowError(RuleBudgetError);
  });
});
