import { describe, expect, it } from 'vitest';
import { Decimal, compile, evaluate, validate, type RuleSchemaSpec } from '../src';
import { describeType, listOf, sameShape, unify, withNullable, nonNull, T_NULL, T_NUMBER, T_STRING } from '../src/types';
import { toDecimal } from '../src/decimal';

const SCHEMA: RuleSchemaSpec = {
  variables: {
    actif: 'boolean',
    ecue: { object: { note: 'number?' } },
    autre: { object: { note: 'number?', extra: 'string' } },
    notes: { list: 'number' },
    textes: { list: 'string' },
  },
};

describe('types : formes, nullité, unification', () => {
  it('describeType en français', () => {
    expect(describeType(T_NUMBER)).toBe('nombre');
    expect(describeType(withNullable(T_STRING, true))).toBe('texte (peut être absent)');
    expect(describeType(T_NULL)).toBe('null');
    expect(describeType(listOf(T_NUMBER))).toBe('liste de nombre');
    expect(describeType({ k: 'object', fields: {}, nullable: false })).toBe('objet');
    expect(describeType({ k: 'boolean', nullable: false })).toBe('booléen');
    expect(describeType(nonNull(T_NULL))).toBe('null');
  });

  it('sameShape / unify', () => {
    const o1: Parameters<typeof sameShape>[0] = { k: 'object', fields: { a: T_NUMBER }, nullable: false };
    const o2: Parameters<typeof sameShape>[0] = { k: 'object', fields: { a: T_NUMBER }, nullable: true };
    const o3: Parameters<typeof sameShape>[0] = { k: 'object', fields: { a: T_STRING }, nullable: false };
    const o4: Parameters<typeof sameShape>[0] = { k: 'object', fields: { b: T_NUMBER }, nullable: false };
    const o5: Parameters<typeof sameShape>[0] = { k: 'object', fields: { a: T_NUMBER, b: T_NUMBER }, nullable: false };
    expect(sameShape(o1, o2)).toBe(true);
    expect(sameShape(o1, o3)).toBe(false);
    expect(sameShape(o1, o4)).toBe(false);
    expect(sameShape(o1, o5)).toBe(false);
    expect(sameShape(listOf(T_NUMBER), listOf(T_NUMBER, true))).toBe(true);
    expect(sameShape(listOf(T_NUMBER), listOf(T_STRING))).toBe(false);
    expect(sameShape(T_NULL, T_NULL)).toBe(true);
    expect(sameShape(T_NULL, T_NUMBER)).toBe(false);
    expect(unify(T_NULL, T_NULL)).toEqual(T_NULL);
    expect(unify(T_NULL, T_NUMBER)).toEqual({ k: 'number', nullable: true });
    expect(unify(T_NUMBER, T_NULL)).toEqual({ k: 'number', nullable: true });
    expect(unify(T_NUMBER, T_STRING)).toBeUndefined();
    expect(unify(o1, o2)).toEqual({ ...o1, nullable: true });
  });

  it('if sur des objets : branches compatibles mais résultat non scalaire refusé', () => {
    expect(validate('if(actif, ecue, ecue)', SCHEMA).diagnostics[0]?.code).toBe('TYPE_RESULTAT_INVALIDE');
    expect(validate('if(actif, ecue, autre)', SCHEMA).diagnostics[0]?.message).toContain('même type');
    expect(validate('if(actif, notes, textes)', SCHEMA).diagnostics[0]?.message).toContain('même type');
    expect(compile('sum(if(actif, notes, notes))', SCHEMA).resultType.type).toBe('number');
    expect(compile('is_null(if(actif, notes, null))', SCHEMA).resultType.type).toBe('boolean');
  });
});

describe('conversion des données', () => {
  it('toDecimal : nombres, chaînes décimales, bigint, Decimal ; refuse le reste', () => {
    expect(toDecimal(0.1)?.toString()).toBe('0.1');
    expect(toDecimal(' 12.50 ')?.toString()).toBe('12.5');
    expect(toDecimal('-3')?.toString()).toBe('-3');
    expect(toDecimal('+3.')?.toString()).toBe('3');
    expect(toDecimal('.5')?.toString()).toBe('0.5');
    expect(toDecimal(10n ** 30n)?.toString()).toBe('1000000000000000000000000000000');
    const d = new Decimal('1.5');
    expect(toDecimal(d)).toBe(d);
    for (const bad of ['', 'abc', '1e5', '0x10', '1,5', '--1', NaN, Infinity, null, undefined, {}, [], true, '1'.repeat(200)]) {
      expect(toDecimal(bad)).toBeUndefined();
    }
  });

  it('un Decimal du moteur est accepté comme donnée', () => {
    const c = compile('x * 2', { variables: { x: 'number' } });
    expect(evaluate(c, { variables: { x: new Decimal('0.1') } }).json).toBe('0.2');
  });

  it('chiffres significatifs : les divisions sont arrondies à 40 chiffres, pas à 15', () => {
    const c = compile('1 / 3', { variables: {} });
    const v = evaluate(c, {}).json as string;
    expect(v.length).toBe(42); // « 0. » + 40 chiffres significatifs
    expect(v.startsWith('0.3333333333333333333333333333333333333')).toBe(true);
    // pas d'écriture exponentielle pour les petites valeurs
    expect(evaluate(compile('1 / 3000000', { variables: {} }), {}).json).toMatch(/^0\.00000033333/);
  });

  it('le Decimal du moteur n\'altère pas la configuration du Decimal global', async () => {
    const mod = await import('decimal.js');
    const Global = mod.default;
    const before = Global.precision;
    expect(new Global(1).div(3).toString().length).toBeLessThan(25); // précision globale par défaut : 20
    expect(Global.precision).toBe(before);
    expect(Decimal.precision).toBe(40);
  });
});
