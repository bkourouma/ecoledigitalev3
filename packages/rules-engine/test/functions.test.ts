import { describe, expect, it } from 'vitest';
import { BUILTIN_FUNCTION_NAMES, Decimal, RuleEvaluationError, compile, evaluate, type EvalContext, type RuleSchemaSpec } from '../src';

const SCHEMA: RuleSchemaSpec = {
  variables: {
    x: 'number',
    y: 'number?',
    notes: { list: 'number?' },
    poids: { list: 'number' },
    pure: { list: 'number' },
    ecues: { list: { object: { note: 'number?', credits: 'number', manuel: 'boolean', code: 'string' } } },
  },
};

const CTX: EvalContext = {
  variables: {
    x: 2.675,
    y: null,
    notes: [10, null, 14],
    poids: [1, 2, 3],
    pure: [8, 14, 14, 12, 8],
    ecues: [
      { note: 12, credits: 4, manuel: false, code: 'A' },
      { note: 4, credits: 2, manuel: false, code: 'B' },
      { note: null, credits: 3, manuel: true, code: 'C' },
    ],
  },
};

const run = (src: string, ctx: EvalContext = CTX) => evaluate(compile(src, SCHEMA), ctx).json;
const r4 = (src: string) => new Decimal(run(src) as string).toDecimalPlaces(4).toString();

describe('agrégats', () => {
  it('avg / sum / min / max / count ignorent les valeurs absentes', () => {
    expect(run('avg(notes)')).toBe('12');
    expect(run('sum(notes)')).toBe('24');
    expect(run('min(notes)')).toBe('10');
    expect(run('max(notes)')).toBe('14');
    expect(run('count(notes)')).toBe('2');
    expect(r4('avg(10, 12, 15)')).toBe('12.3333');
    expect(run('sum(1, notes, [5, 6])')).toBe('36');
    expect(run('max(3, 9, 4)')).toBe('9');
    expect(run('min(3, 9, 4)')).toBe('3');
  });

  it('retournent null (ou 0) quand tout est absent', () => {
    const ctx: EvalContext = { variables: { ...CTX.variables, notes: [null, null] } };
    expect(run('avg(notes)', ctx)).toBeNull();
    expect(run('min(notes)', ctx)).toBeNull();
    expect(run('max(notes)', ctx)).toBeNull();
    expect(run('sum(notes)', ctx)).toBe('0');
    expect(run('count(notes)', ctx)).toBe('0');
    expect(run('avg(x, y)')).toBe('2.675');
  });

  it('wavg pondère et ignore les paires absentes', () => {
    expect(run('wavg([10, 20], [1, 3])')).toBe('17.5');
    expect(run('wavg(notes, [1, 5, 1])')).toBe('12'); // (10*1 + 14*1) / 2
    expect(run('wavg(notes, [0, 5, 0])')).toBeNull(); // poids total nul
    expect(r4('wavg(ecues.note, ecues.credits)')).toBe('9.3333'); // (12*4+4*2)/6
  });

  it('wavg refuse des longueurs différentes et des poids négatifs', () => {
    expect(() => run('wavg([1, 2], [1])')).toThrowError(/même longueur/);
    expect(() => run('wavg([1, 2], [1, -1])')).toThrowError(/négatif/);
    try {
      run('wavg([1, 2], [1])');
    } catch (e) {
      expect((e as RuleEvaluationError).code).toBe('LONGUEURS_DIFFERENTES');
    }
  });
});

describe('bornes et arrondis', () => {
  it('clamp, abs', () => {
    expect(run('clamp(25, 0, 20)')).toBe('20');
    expect(run('clamp(-3, 0, 20)')).toBe('0');
    expect(run('clamp(7, 0, 20)')).toBe('7');
    expect(run('clamp(y, 0, 20)')).toBeNull();
    expect(run('abs(-4.5)')).toBe('4.5');
    expect(run('abs(y)')).toBeNull();
    expect(() => run('clamp(1, 5, 2)')).toThrowError(/borne inférieure/);
  });

  it('round_half_up : 2.675 -> 2.68 (un flottant donnerait 2.67), 9.995 -> 10', () => {
    expect(run('round_half_up(x, 2)')).toBe('2.68');
    expect(run('round_half_up(9.995, 2)')).toBe('10');
    expect(run('round_half_up(2.5)')).toBe('3');
    expect(run('round_half_up(-2.5)')).toBe('-3');
    expect(run('round_half_up(1.005, 2)')).toBe('1.01');
    expect(run('round_half_up(y, 2)')).toBeNull();
  });

  it('round_half_even : arrondi du banquier', () => {
    expect(run('round_half_even(2.5)')).toBe('2');
    expect(run('round_half_even(3.5)')).toBe('4');
    expect(run('round_half_even(2.675, 2)')).toBe('2.68');
    expect(run('round_half_even(2.665, 2)')).toBe('2.66');
  });

  it('floor / ceil, avec ou sans décimales', () => {
    expect(run('floor(2.9)')).toBe('2');
    expect(run('ceil(2.1)')).toBe('3');
    expect(run('floor(-2.1)')).toBe('-3');
    expect(run('ceil(-2.9)')).toBe('-2');
    expect(run('floor(2.678, 2)')).toBe('2.67');
    expect(run('ceil(2.671, 2)')).toBe('2.68');
  });

  it('refuse un nombre de décimales invalide', () => {
    expect(() => compile('round_half_up(1.5, 13)', SCHEMA)).toThrowError(/entier entre 0 et 12/);
    expect(() => compile('round_half_up(1.5, 1.5)', SCHEMA)).toThrowError(/entier entre 0 et 12/);
    expect(() => run('round_half_up(1.5, x)')).toThrowError(/entier entre 0 et 12/);
    expect(() => run('round_half_up(1.5, -1 + 0)')).toThrowError(RuleEvaluationError);
  });
});

describe('contrôle et nullité', () => {
  it('if est paresseux et unifie ses branches', () => {
    expect(run('if(x > 1, "oui", "non")')).toBe('oui');
    expect(run('if(false, 1 / 0, 5)')).toBe('5');
    expect(run('if(true, null, 5)')).toBeNull();
    expect(compile('if(true, null, 5)', SCHEMA).resultType).toEqual({ type: 'number', nullable: true });
  });

  it('coalesce, is_null, narrowing après is_null', () => {
    expect(run('coalesce(y, 7)')).toBe('7');
    expect(run('coalesce(x, 7)')).toBe('2.675');
    expect(run('is_null(y)')).toBe(true);
    expect(run('is_null(x)')).toBe(false);
    expect(run('if(is_null(y), -1, y + 1)')).toBe('-1');
    expect(run('if(!is_null(y), y + 1, 0)')).toBe('0');
    expect(run('is_null(y) || y > 3')).toBe(true);
    expect(run('!is_null(y) && y > 3')).toBe(false);
    expect(run('if(y != null, y * 2, 0)')).toBe('0');
    expect(run('if(y == null, 0, y * 2)')).toBe('0');
    expect(compile('coalesce(null, 3)', SCHEMA).resultType).toEqual({ type: 'number', nullable: false });
  });
});

describe('rank (classement de compétition)', () => {
  it('ex æquo partagent le rang, le suivant saute', () => {
    // 14, 14, 12, 8, 8 -> rangs 1, 1, 3, 4, 4
    expect(run('rank(14, pure)')).toBe('1');
    expect(run('rank(12, pure)')).toBe('3');
    expect(run('rank(8, pure)')).toBe('4');
    expect(run('rank(20, pure)')).toBe('1');
    expect(run('rank(0, pure)')).toBe('6');
  });

  it('ignore les absents ; valeur absente => rang absent', () => {
    expect(run('rank(10, notes)')).toBe('2');
    expect(run('rank(y, notes)')).toBeNull();
  });

  it('ties jugés à N décimales près', () => {
    const ctx: EvalContext = { variables: { ...CTX.variables, pure: ['13.56661', '13.56664', '12'] } };
    expect(run('rank(13.56661, pure)', ctx)).toBe('2'); // exact : 13.56664 > 13.56661
    expect(run('rank(13.56661, pure, 4)', ctx)).toBe('1'); // à 4 décimales : égalité
  });
});

describe('listes : len, map, filter, any, all', () => {
  it('len', () => {
    expect(run('len(ecues)')).toBe('3');
    expect(run('len(notes) - count(notes)')).toBe('1');
  });

  it('any / all avec court-circuit', () => {
    expect(run('any(ecues, e => !e.manuel && !is_null(e.note) && e.note < 5)')).toBe(true);
    expect(run('all(ecues, e => e.credits > 0)')).toBe(true);
    expect(run('all(ecues, e => e.credits > 2)')).toBe(false);
    expect(run('any(pure, p => p > 100)')).toBe(false);
    // la lambda de any n'est plus évaluée après le premier vrai : pas de division par zéro sur le 2e élément
    const ctx: EvalContext = { variables: { ...CTX.variables, pure: [1, 0] } };
    expect(run('any(pure, p => 1 / p > 0)', ctx)).toBe(true);
  });

  it('map et filter', () => {
    expect(run('sum(map(pure, p => p * 2))')).toBe('112');
    expect(run('sum(map(ecues, e => e.credits * 10))')).toBe('90');
    expect(run('len(filter(ecues, e => e.credits >= 3))')).toBe('2');
    expect(run('sum(filter(ecues, e => e.manuel).credits)')).toBe('3');
    expect(run('max(map(ecues, e => if(is_null(e.note), 0, e.note)))')).toBe('12');
  });

  it('le nom du paramètre ne peut pas masquer une variable ni être réutilisé', () => {
    expect(() => compile('any(ecues, x => x.credits > 0)', SCHEMA)).toThrowError(/interdit ou déjà utilisé/);
    expect(() => compile('any(pure, p => any(pure, p => p > 1))', SCHEMA)).toThrowError(/interdit ou déjà utilisé/);
    expect(() => compile('any(pure, constructor => constructor > 1)', SCHEMA)).toThrowError(/interdit ou déjà utilisé/);
  });

  it('les lambdas n\'existent que comme 2e argument de map/filter/any/all', () => {
    expect(() => compile('sum(p => p)', SCHEMA)).toThrowError(/2e argument de map, filter, any ou all/);
    expect(() => compile('p => p', SCHEMA)).toThrowError(/Fonction fléchée non autorisée/);
    expect(() => compile('any(pure, 3)', SCHEMA)).toThrowError(/de la forme « x => expression »/);
    expect(() => compile('any(3, p => p > 1)', SCHEMA)).toThrowError(/doit être une liste/);
    expect(() => compile('any(pure, p => p + 1)', SCHEMA)).toThrowError(/doit être un booléen/);
    expect(() => compile('map(pure, p => [p])', SCHEMA)).toThrowError(/nombre, un texte ou un booléen/);
    expect(() => compile('map(pure, p => null)', SCHEMA)).toThrowError(/nombre, un texte ou un booléen/);
  });

  it('une lambda reste évaluée sous budget', () => {
    expect(() =>
      evaluate(compile('any(pure, p => p < 0)', SCHEMA), CTX, { budget: { maxNodes: 5 } }),
    ).toThrowError(/Budget d'évaluation dépassé/);
  });
});

describe('registre', () => {
  it('expose exactement les fonctions de la liste blanche', () => {
    const expected = ['avg', 'wavg', 'sum', 'min', 'max', 'clamp', 'round_half_up', 'round_half_even', 'floor', 'ceil', 'if', 'rank'];
    for (const f of expected) expect(BUILTIN_FUNCTION_NAMES.has(f)).toBe(true);
  });
});
