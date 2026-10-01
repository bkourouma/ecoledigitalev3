import { describe, expect, it } from 'vitest';
import { simulate, type RuleDefinition, type RuleVersion, type SimulationCase } from '../src';
import { makeRng } from './helpers';
import { CLASSIQUE_RULES, classiqueVersion, makeVersion } from './fixtures/rulesets';

const withRules = (id: string, rules: RuleDefinition[], version = 1): RuleVersion => makeVersion({ id, ruleSetId: 'rs', version, rules });

/** Variante d'établissement : seuil « Assez bien » et mentions décalées. */
const variant = (over: (r: RuleDefinition) => RuleDefinition): RuleVersion =>
  withRules('ver-variante', CLASSIQUE_RULES.map(over), 2);

const students = (n: number, seed = 11): SimulationCase[] => {
  const rnd = makeRng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `eleve-${i + 1}`,
    label: `Élève ${i + 1}`,
    context: { variables: { moyenne: Math.floor(rnd() * 2001) / 100, second_semestre: true, bts_deuxieme_annee: false } },
  }));
};

const MENTION_ONLY = ['mention'];

describe('simulate : rapport de différences avant / après', () => {
  it('versions identiques : aucun écart', () => {
    const rep = simulate(classiqueVersion, classiqueVersion, students(50), { ruleKeys: MENTION_ONLY });
    expect(rep.identical).toBe(true);
    expect(rep.summary).toMatchObject({ cases: 50, rules: 1, evaluations: 50, changed: 0, unchanged: 50, changedPercent: '0' });
    expect(rep.differences).toEqual([]);
    expect(rep.truncated).toBe(false);
  });

  it('seuil de mention modifié : liste exacte des élèves impactés et transitions', () => {
    // « Bien » passe de 12 à 11 : les élèves entre 11 et 12 passent de « Assez bien » à « Bien »
    const nouvelle = variant((r) => (r.key === 'mention' ? { ...r, parameters: { ...r.parameters!, bien: { type: 'number', default: 11 } } } : r));
    const data = students(200);
    const rep = simulate(classiqueVersion, nouvelle, data, { ruleKeys: MENTION_ONLY });

    const expectedChanged = data.filter((d) => {
      const m = d.context.variables?.moyenne as number;
      return m >= 11 && m < 12;
    });
    expect(expectedChanged.length).toBeGreaterThan(0);
    expect(rep.identical).toBe(false);
    expect(rep.summary.changed).toBe(expectedChanged.length);
    expect(rep.summary.unchanged).toBe(200 - expectedChanged.length);
    expect(rep.differences.map((d) => d.caseId)).toEqual(expectedChanged.map((d) => d.id));
    expect(rep.differences.every((d) => d.kind === 'value_changed')).toBe(true);
    expect(rep.differences[0]).toMatchObject({
      ruleKey: 'mention',
      old: { status: 'ok', type: 'string', value: 'Assez bien' },
      new: { status: 'ok', type: 'string', value: 'Bien' },
      caseLabel: expect.stringMatching(/^Élève \d+$/),
    });
    expect(rep.rules[0]?.transitions).toEqual([{ from: 'Assez bien', to: 'Bien', count: expectedChanged.length }]);
    expect(rep.summary.changedPercent).toBe(((expectedChanged.length * 100) / 200).toFixed(2).replace(/\.?0+$/, ''));
  });

  it('résultats numériques : delta exact, écart maximal et écart moyen', () => {
    const nouvelle = variant((r) =>
      r.key === 'moyenne_annuelle'
        ? { ...r, parameters: { poids_s1: { type: 'number', default: 1 }, poids_s2: { type: 'number', default: 1 } } }
        : r,
    );
    const data: SimulationCase[] = [
      { id: 'a', context: { variables: { s1: 12, s2: 15, second_semestre: true } } }, // 14 -> 13.5 : -0.5
      { id: 'b', context: { variables: { s1: 10, s2: 10, second_semestre: true } } }, // 10 -> 10 : inchangé
      { id: 'c', context: { variables: { s1: 8, s2: 14, second_semestre: true } } }, // 12 -> 11 : -1
    ];
    const rep = simulate(classiqueVersion, nouvelle, data, { ruleKeys: ['moyenne_annuelle'] });
    expect(rep.summary).toMatchObject({ changed: 2, unchanged: 1 });
    expect(rep.differences.map((d) => [d.caseId, d.delta])).toEqual([['a', '-0.5'], ['c', '-1']]);
    expect(rep.rules[0]).toMatchObject({ key: 'moyenne_annuelle', maxAbsDelta: '1', meanDelta: '-0.75', changed: 2, unchanged: 1 });
  });

  it('erreurs introduites, résolues ou modifiées', () => {
    const base = withRules('v1', [
      { key: 'ratio', type: 'rounding', expression: 'a / b', inputSchema: { variables: { a: 'number', b: 'number' } }, result: 'number' },
      { key: 'ratio2', type: 'rounding', expression: 'a / (b - 1)', inputSchema: { variables: { a: 'number', b: 'number' } }, result: 'number' },
      { key: 'ratio3', type: 'rounding', expression: 'a / b', inputSchema: { variables: { a: 'number', b: 'number' } }, result: 'number' },
    ]);
    const next = withRules(
      'v2',
      [
        { key: 'ratio', type: 'rounding', expression: 'a / (b - 2)', inputSchema: { variables: { a: 'number', b: 'number' } }, result: 'number' },
        { key: 'ratio2', type: 'rounding', expression: 'a / b', inputSchema: { variables: { a: 'number', b: 'number' } }, result: 'number' },
        { key: 'ratio3', type: 'rounding', expression: 'a % b', inputSchema: { variables: { a: 'number', b: 'number' } }, result: 'number' },
      ],
      2,
    );
    const data: SimulationCase[] = [
      { id: 'x', context: { variables: { a: 10, b: 2 } } }, // ratio: ok -> erreur (b-2=0) ; ratio2: ok(10/1)->ok (5) ; ratio3: 5 -> 0
      { id: 'y', context: { variables: { a: 10, b: 1 } } }, // ratio: ok -> ok ; ratio2: erreur -> ok ; ratio3: 10 -> 0
      { id: 'z', context: { variables: { a: 10, b: 0 } } }, // ratio: erreur -> ok(−5) ; ratio2: ok(-10) -> erreur ; ratio3: erreur -> erreur (même code mais message différent ? non)
    ];
    const rep = simulate(base, next, data);
    const byKey = (k: string) => rep.differences.filter((d) => d.ruleKey === k).map((d) => [d.caseId, d.kind]);
    expect(byKey('ratio')).toEqual([['x', 'error_introduced'], ['y', 'value_changed'], ['z', 'error_resolved']]);
    expect(byKey('ratio2')).toEqual([['x', 'value_changed'], ['y', 'error_resolved'], ['z', 'error_introduced']]);
    expect(rep.summary.newErrors).toBe(2);
    expect(rep.summary.resolvedErrors).toBe(2);
    // ratio3 : division (/) par zéro -> modulo (%) par zéro : deux erreurs de même code mais de message différent
    expect(byKey('ratio3')).toContainEqual(['z', 'error_changed']);
    expect(rep.summary.changedErrors).toBe(1);
    const err = rep.differences.find((d) => d.caseId === 'x' && d.ruleKey === 'ratio');
    expect(err?.new).toMatchObject({ status: 'error', code: 'DIVISION_PAR_ZERO' });
    expect(rep.rules.find((r) => r.key === 'ratio')).toMatchObject({ newErrors: 1, resolvedErrors: 1 });
  });

  it('règles ajoutées / retirées, erreurs de compilation signalées par règle', () => {
    const oldV = withRules('v1', [
      { key: 'a', type: 'rounding', expression: 'x + 1', inputSchema: { variables: { x: 'number' } } },
      { key: 'ancienne', type: 'rounding', expression: 'x', inputSchema: { variables: { x: 'number' } } },
      { key: 'cassee', type: 'rounding', expression: 'x', inputSchema: { variables: { x: 'number' } } },
    ]);
    const newV = withRules(
      'v2',
      [
        { key: 'a', type: 'rounding', expression: 'x + 1', inputSchema: { variables: { x: 'number' } } },
        { key: 'nouvelle', type: 'rounding', expression: 'x', inputSchema: { variables: { x: 'number' } } },
        { key: 'cassee', type: 'rounding', expression: 'x +', inputSchema: { variables: { x: 'number' } } },
      ],
      2,
    );
    const rep = simulate(oldV, newV, [{ id: 'c1', context: { variables: { x: 1 } } }]);
    const by = Object.fromEntries(rep.rules.map((r) => [r.key, r]));
    expect(by.ancienne?.presence).toBe('removed');
    expect(by.nouvelle?.presence).toBe('added');
    expect(by.a?.presence).toBe('both');
    expect(by.cassee?.compileErrors.new).toMatch(/Fin d'expression inattendue/);
    expect(by.cassee?.compileErrors.old).toBeUndefined();
    expect(rep.identical).toBe(false);
    expect(rep.summary.rules).toBe(4);
    // la règle cassée apparaît comme erreur introduite
    expect(rep.differences.find((d) => d.ruleKey === 'cassee')).toMatchObject({ kind: 'error_introduced', new: { status: 'error', code: 'COMPILATION' } });
    // l'ancienne version peut elle aussi être cassée
    const rep2 = simulate(newV, oldV, [{ id: 'c1', context: { variables: { x: 1 } } }]);
    expect(rep2.rules.find((r) => r.key === 'cassee')?.compileErrors.old).toBeDefined();
    expect(rep2.differences.find((d) => d.ruleKey === 'cassee')?.kind).toBe('error_resolved');
    expect(rep2.differences.find((d) => d.ruleKey === 'cassee')?.old).toMatchObject({ status: 'error', code: 'COMPILATION' });
  });

  it('plafonne les différences détaillées mais garde des compteurs exacts', () => {
    const nouvelle = variant((r) => (r.key === 'mention' ? { ...r, parameters: { ...r.parameters!, excellent: { type: 'number', default: 0 } } } : r));
    const rep = simulate(classiqueVersion, nouvelle, students(300), { ruleKeys: MENTION_ONLY, maxDifferences: 10 });
    expect(rep.differences.length).toBe(10);
    expect(rep.truncated).toBe(true);
    expect(rep.summary.changed).toBeGreaterThan(10);
    expect(rep.rules[0]?.changed).toBe(rep.summary.changed);
  });

  it('schémas fournis par type de règle, schéma de repli et budget transmis', () => {
    const sans: RuleDefinition = { key: 'k', type: 'rounding', expression: 'round_half_up(x, 1)' };
    const v1 = withRules('a', [sans]);
    const v2 = withRules('b', [{ ...sans, expression: 'round_half_up(x, 2)' }], 2);
    const data: SimulationCase[] = [{ id: '1', context: { variables: { x: 1.26 } } }];
    // sans schéma : la règle ne compile pas
    expect(simulate(v1, v2, data).rules[0]?.compileErrors.old).toMatch(/Nom inconnu « x »/);
    const viaType = simulate(v1, v2, data, { schemas: { rounding: { variables: { x: 'number' } } } });
    expect(viaType.differences[0]).toMatchObject({ old: { value: '1.3' }, new: { value: '1.26' }, delta: '-0.04' });
    const viaDefault = simulate(v1, v2, data, { defaultSchema: { variables: { x: 'number' } } });
    expect(viaDefault.summary.changed).toBe(1);
    // budget de 3 : l'ancienne règle (3 nœuds) passe, la nouvelle (round_half_up(x + 0, 2) = 5 nœuds) le dépasse
    const v3 = withRules('c', [{ ...sans, expression: 'round_half_up(x + 0, 2)' }], 3);
    const low = simulate(v1, v3, data, { defaultSchema: { variables: { x: 'number' } }, budget: { maxNodes: 3 } });
    expect(low.differences[0]).toMatchObject({ kind: 'error_introduced', new: { status: 'error', code: 'BUDGET_NOEUDS_DEPASSE' } });
    // erreur identique des deux côtés : aucune différence
    const same = simulate(v1, v2, data, { defaultSchema: { variables: { x: 'number' } }, budget: { maxNodes: 2 } });
    expect(same.summary).toMatchObject({ changed: 0, unchanged: 1, changedErrors: 0 });
  });

  it('contexte vide, jeu de données vide : rapport cohérent', () => {
    const rep = simulate(classiqueVersion, classiqueVersion, [], { ruleKeys: MENTION_ONLY });
    expect(rep.summary).toMatchObject({ cases: 0, evaluations: 0, changedPercent: '0' });
    expect(rep.identical).toBe(true);
  });

  it('déterminisme : même rapport à chaque appel (JSON identique)', () => {
    const nouvelle = variant((r) => (r.key === 'mention' ? { ...r, parameters: { ...r.parameters!, bien: { type: 'number', default: 11 } } } : r));
    const data = students(120, 5);
    const a = JSON.stringify(simulate(classiqueVersion, nouvelle, data));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(simulate(classiqueVersion, nouvelle, data))).toBe(a);
  });

  it('simulation complète de la pile classique sur 300 élèves (toutes règles)', () => {
    const rnd = makeRng(3);
    const data: SimulationCase[] = Array.from({ length: 300 }, (_, i) => {
      const moyenne = Math.floor(rnd() * 2001) / 100;
      return {
        id: `e${i}`,
        context: {
          variables: {
            moyenne,
            s1: moyenne,
            s2: Math.floor(rnd() * 2001) / 100,
            second_semestre: true,
            bts_deuxieme_annee: false,
            cohorte: [moyenne, 12, 14],
            matieres: [{ score: moyenne, coef: 2 }],
          },
        },
      };
    });
    const rep = simulate(classiqueVersion, classiqueVersion, data);
    expect(rep.summary.evaluations).toBe(300 * CLASSIQUE_RULES.length);
    expect(rep.identical).toBe(true);
    expect(rep.summary.newErrors).toBe(0);
  });
});
