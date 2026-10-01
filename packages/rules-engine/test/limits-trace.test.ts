import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, RuleSyntaxError, compile, evaluate, validate, type EvalContext, type RuleSchemaSpec } from '../src';

const SCHEMA: RuleSchemaSpec = {
  variables: { x: 'number', ys: { list: 'number?' } },
  lookups: { period: { keys: ['S1', 'S2'], value: { object: { average: 'number?' } } } },
};

const RELAXED = { maxSourceLength: 10_000_000 };
const code = (src: string, limits: Record<string, number> = {}) => {
  try {
    compile(src, SCHEMA, { limits: { ...RELAXED, ...limits } });
    return 'OK';
  } catch (e) {
    return e instanceof RuleSyntaxError ? e.code : `AUTRE:${(e as Error).message}`;
  }
};

describe('limites de compilation (aucun dépassement de pile)', () => {
  it('valeurs par défaut exposées', () => {
    expect(DEFAULT_LIMITS).toEqual({ maxSourceLength: 10_000, maxDepth: 64, maxHeight: 128, maxNodes: 2_000 });
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });

  it('source trop longue refusée avant toute analyse', () => {
    expect(code('1+'.repeat(6000) + '1', { maxSourceLength: 10_000 })).toBe('LIMITE_SOURCE_TROP_LONGUE');
    expect(() => compile('1'.repeat(10_001), SCHEMA)).toThrowError(/trop longue/);
    expect(validate('x'.repeat(10_001), SCHEMA).diagnostics[0]?.code).toBe('LIMITE_SOURCE_TROP_LONGUE');
  });

  it('parenthèses imbriquées : arrêt net à la profondeur maximale, même avec 200 000 niveaux', () => {
    for (const n of [63, 64, 1000, 200_000]) {
      const src = '('.repeat(n) + '1' + ')'.repeat(n);
      expect(code(src)).toBe(n <= 63 ? 'OK' : 'LIMITE_PROFONDEUR');
    }
  });

  it('opérateurs unaires empilés', () => {
    expect(code('-'.repeat(100_000) + '1')).toBe('LIMITE_PROFONDEUR');
    expect(code('!'.repeat(100_000) + 'true')).toBe('LIMITE_PROFONDEUR');
    expect(code('- - - 1')).toBe('OK');
  });

  it('chaînes d\'opérateurs gauche-profondes (1+1+1+…) : hauteur bornée', () => {
    expect(code('1+'.repeat(100_000) + '1')).toBe('LIMITE_PROFONDEUR');
    expect(code('1+'.repeat(100) + '1')).toBe('OK');
    expect(code('1+'.repeat(130) + '1')).toBe('LIMITE_PROFONDEUR');
  });

  it('appels imbriqués et lambdas imbriquées', () => {
    expect(code('abs('.repeat(100_000) + '1' + ')'.repeat(100_000))).toBe('LIMITE_PROFONDEUR');
    expect(code('any(ys, a => '.repeat(10_000) + 'true' + ')'.repeat(10_000))).toBe('LIMITE_PROFONDEUR');
  });

  it('listes imbriquées', () => {
    expect(code('['.repeat(100_000) + '1' + ']'.repeat(100_000))).toBe('LIMITE_PROFONDEUR');
  });

  it('nombre de nœuds borné', () => {
    const list = `[${Array.from({ length: 200 }, () => '1').join(',')}]`;
    const src = `sum(${Array.from({ length: 12 }, () => list).join(',')})`;
    expect(code(src)).toBe('LIMITE_NOMBRE_DE_NOEUDS');
    expect(code(src, { maxNodes: 10_000 })).toBe('OK');
  });

  it('limites personnalisables', () => {
    expect(code('((1))', { maxDepth: 1 })).toBe('LIMITE_PROFONDEUR');
    expect(code('1 + 2 + 3', { maxHeight: 2 })).toBe('LIMITE_PROFONDEUR');
    expect(code('1 + 2 + 3', { maxNodes: 4 })).toBe('LIMITE_NOMBRE_DE_NOEUDS');
  });

  it('une règle de 40 termes (usage réaliste) compile sans difficulté', () => {
    const src = Array.from({ length: 40 }, (_, i) => `x * ${i + 1}`).join(' + ');
    expect(code(src, { maxSourceLength: 10_000 })).toBe('OK');
  });
});

describe('trace (explicabilité)', () => {
  const FORMULA = 'round_half_up((period("S1").average + 2 * period("S2").average) / 3, 2)';
  const CTX: EvalContext = { lookups: { period: { S1: { average: 12.5 }, S2: { average: 14.1 } } } };
  const SCHEMA2: RuleSchemaSpec = {
    variables: {},
    lookups: { period: { keys: ['S1', 'S2'], value: { object: { average: 'number' } } } },
  };

  it('liste les valeurs intermédiaires en post-ordre, avec extrait de source et positions', () => {
    const r = evaluate(compile(FORMULA, SCHEMA2), CTX);
    expect(r.json).toBe('13.57');
    const t = r.trace;
    expect(t.map((e) => e.seq)).toEqual(t.map((_, i) => i + 1));
    expect(t.map((e) => [e.kind, e.label, e.value])).toEqual([
      ['lookup', 'period("S1")', '[objet]'],
      ['member', 'average', '12.5'],
      ['lookup', 'period("S2")', '[objet]'],
      ['member', 'average', '14.1'],
      ['binary', '*', '28.2'],
      ['binary', '+', '40.7'],
      ['binary', '/', '13.56666666666666666666666666666666666667'],
      ['call', 'round_half_up', '13.57'],
    ]);
    const last = t[t.length - 1];
    expect(last?.source).toBe(FORMULA);
    expect(last?.start).toBe(0);
    expect(last?.end).toBe(FORMULA.length);
    expect(t[1]?.source).toBe('period("S1").average');
    expect(t[1]?.type).toBe('number');
    expect(r.traceTruncated).toBe(false);
  });

  it('la trace est sérialisable en JSON', () => {
    const r = evaluate(compile(FORMULA, SCHEMA2), CTX);
    expect(JSON.parse(JSON.stringify(r.trace))).toEqual(r.trace);
  });

  it('seules les branches réellement évaluées apparaissent (if, &&)', () => {
    const c = compile('if(true, 1 + 1, 2 * 5)', { variables: {} });
    const labels = evaluate(c, {}).trace.map((e) => e.label);
    expect(labels).toEqual(['+', 'if']);
    expect(evaluate(compile('false && 1 / 1 > 0', { variables: {} }), {}).trace.map((e) => e.label)).toEqual(['&&']);
  });

  it('trace désactivable et plafonnée', () => {
    const c = compile(FORMULA, SCHEMA2);
    expect(evaluate(c, CTX, { trace: false }).trace).toEqual([]);
    const capped = evaluate(c, CTX, { budget: { maxTraceEntries: 3 } });
    expect(capped.trace.length).toBe(3);
    expect(capped.traceTruncated).toBe(true);
    expect(capped.json).toBe('13.57');
    expect(evaluate(c, CTX, { budget: { maxTraceEntries: 0 } }).trace).toEqual([]);
  });

  it('les itérations de lambda ne noient pas la trace : seul le résultat d\'ensemble est tracé', () => {
    const c = compile('count(map(ys, v => if(is_null(v), 0, v * 2)))', SCHEMA);
    const r = evaluate(c, { variables: { x: 1, ys: [1, null, 3] } });
    expect(r.json).toBe('3');
    expect(r.trace.map((e) => `${e.kind}:${e.label}`)).toEqual(['name:ys', 'call:map', 'call:count']);
    expect(r.trace[1]?.value).toEqual(['2', '0', '6']);
  });

  it('les listes longues sont résumées dans la trace', () => {
    const ys = Array.from({ length: 50 }, (_, i) => i);
    const r = evaluate(compile('sum(ys)', SCHEMA), { variables: { x: 1, ys } });
    const v = r.trace[0]?.value as string[];
    expect(v.length).toBe(21);
    expect(v[20]).toBe('… (+30)');
  });

  it('les textes, booléens et valeurs absentes sont tracés', () => {
    const c = compile('if(is_null(x), "vide", "plein")', { variables: { x: 'number?' } });
    const r = evaluate(c, { variables: { x: null } });
    expect(r.trace.map((e) => [e.label, e.value])).toEqual([
      ['x', null],
      ['is_null', true],
      ['if', 'vide'],
    ]);
    expect(r.type).toBe('string');
  });

  it('une liste littérale et une trace de liste de listes', () => {
    const r = evaluate(compile('max([1, 5, 3])', { variables: {} }), {});
    expect(r.trace.map((e) => [e.kind, e.value])).toEqual([
      ['list', ['1', '5', '3']],
      ['call', '5'],
    ]);
  });
});
