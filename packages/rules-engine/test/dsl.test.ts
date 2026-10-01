import { describe, expect, it } from 'vitest';
import { compile, evaluate, validate, type EvalContext, type RuleSchemaSpec } from '../src';

const SCHEMA: RuleSchemaSpec = {
  variables: {
    a: 'number',
    b: 'number',
    opt: 'number?',
    s: 'string',
    flag: 'boolean',
    notes: { list: 'number?' },
    ecues: { list: { object: { note: 'number?', credits: 'number' } } },
    cfg: { object: { seuil: 'number', label: 'string' } },
  },
  lookups: {
    period: { keys: ['S1', 'S2'], value: { object: { average: 'number?', credits: 'number' } } },
  },
};

const CTX: EvalContext = {
  variables: {
    a: 12.5,
    b: 4,
    opt: null,
    s: 'Bien',
    flag: true,
    notes: [10, null, 14, '16.5'],
    ecues: [
      { note: 12, credits: 4 },
      { note: null, credits: 2 },
      { note: 8, credits: 6 },
    ],
    cfg: { seuil: 10, label: 'x' },
  },
  lookups: { period: { S1: { average: 12.5, credits: 30 }, S2: { average: 14.1, credits: 30 } } },
};

const ev = (src: string, ctx: EvalContext = CTX) => evaluate(compile(src, SCHEMA), ctx);
const val = (src: string, ctx: EvalContext = CTX) => ev(src, ctx).json;

describe('littéraux et opérateurs', () => {
  it('évalue l\'arithmétique avec les priorités usuelles', () => {
    expect(val('1 + 2 * 3')).toBe('7');
    expect(val('(1 + 2) * 3')).toBe('9');
    expect(val('10 - 4 - 3')).toBe('3');
    expect(val('100 / 10 / 5')).toBe('2');
    expect(val('-a + 20')).toBe('7.5');
    expect(val('- -3')).toBe('3');
    expect(val('7 % 4')).toBe('3');
    expect(val('2 * -3')).toBe('-6');
  });

  it('évalue comparaisons et logique, avec court-circuit', () => {
    expect(val('1 < 2')).toBe(true);
    expect(val('2 <= 2 && 3 > 2')).toBe(true);
    expect(val('1 >= 2 || 5 != 5')).toBe(false);
    expect(val('!flag')).toBe(false);
    expect(val('a >= 10 && b == 4')).toBe(true);
    // le côté droit n'est jamais évalué : pas d'erreur de division par zéro
    expect(val('false && 1 / 0 > 1')).toBe(false);
    expect(val('true || 1 / 0 > 1')).toBe(true);
  });

  it('gère textes, booléens, null et commentaires', () => {
    expect(val('"abc"')).toBe('abc');
    expect(val("'it\\'s'")).toBe("it's");
    expect(val('"a\\"b\\\\c"')).toBe('a"b\\c');
    expect(val('s == "Bien"')).toBe(true);
    expect(val('s != "Passable"')).toBe(true);
    expect(val('true')).toBe(true);
    expect(val('1 + 1 // deux\n+ 1')).toBe('3');
    expect(val('opt == null')).toBe(true);
    expect(val('a != null')).toBe(true);
    expect(val('null == null')).toBe(true);
    expect(val('1 == 1.0')).toBe(true);
  });

  it('lit variables, champs, plucks et recherches', () => {
    expect(val('a')).toBe('12.5');
    expect(val('cfg.seuil')).toBe('10');
    expect(val('sum(ecues.credits)')).toBe('12');
    expect(val('period("S1").average')).toBe('12.5');
    expect(val('period("S2").credits + 1')).toBe('31');
    expect(val('avg(notes)')).toBe('13.5'); // (10+14+16.5)/3 = 13.5
  });

  it('accepte les chaînes décimales et les bigint en entrée', () => {
    const ctx: EvalContext = { variables: { a: '0.1', b: 3n, notes: [], ecues: [], cfg: { seuil: 1, label: '' }, s: '', flag: false, opt: undefined }, lookups: {} };
    expect(val('a * 3', ctx)).toBe('0.3');
    expect(val('b + 1', ctx)).toBe('4');
  });

  it('les nombres non nuls sont exacts', () => {
    expect(val('0.1 + 0.2 == 0.3')).toBe(true);
    expect(val('0.7 + 0.1 >= 0.8')).toBe(true);
    expect(val('0.1 * 3')).toBe('0.3');
  });
});

describe('résultat', () => {
  it('expose type, valeur sérialisable et nombre de nœuds', () => {
    const r = ev('a * 2');
    expect(r.type).toBe('number');
    expect(String(r.value)).toBe('25');
    expect(r.json).toBe('25');
    expect(r.nodesEvaluated).toBeGreaterThan(0);
    expect(ev('"x"').type).toBe('string');
    expect(ev('true').type).toBe('boolean');
    expect(ev('if(false, 1, null)').type).toBe('null');
  });

  it('validate() renvoie un rapport sans lever', () => {
    const ok = validate('period("S1").average ?? 0', SCHEMA);
    expect(ok.ok).toBe(false);
    const good = validate('coalesce(period("S1").average, 0) + a', SCHEMA);
    expect(good.ok).toBe(true);
    expect(good.names).toEqual(['a']);
    expect(good.lookups).toEqual(['period']);
    expect(good.functions).toEqual(['coalesce']);
    expect(good.resultType).toEqual({ type: 'number', nullable: false });
  });
});
