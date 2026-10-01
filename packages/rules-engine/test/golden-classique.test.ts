/**
 * Golden tests de la pile classique : formules RÉELLES de
 * apps/api/src/routes/semester-averages.ts (moyenne pondérée par coefficient,
 * moyenne annuelle (S1 + 2·S2)/3, mentions, décisions, classement).
 */
import { describe, expect, it } from 'vitest';
import { makeRng, runner } from './helpers';
import { classiqueVersion } from './fixtures/rulesets';
import {
  buildAverageMention,
  buildCouncilDecision,
  buildDistinctionSanctionsFromAverage,
  buildEndYearDecision,
  computeAnnualAverage,
  computeCompetitionRanks,
  computeWeightedAverage,
} from './fixtures/legacy-semester-averages';

const r = runner(classiqueVersion);

describe('Classique : toutes les règles se compilent à la publication', () => {
  it('compile les 7 règles', () => {
    expect(r.compileAll().length).toBe(7);
  });
});

describe('Moyenne pondérée par coefficient', () => {
  const avg = (matieres: { score: number | null; coef: number }[]) => r.value('moyenne_ponderee', { matieres });

  it('pondère par coefficient et ignore les matières non notées', () => {
    expect(Number(avg([{ score: 12, coef: 2 }, { score: 15, coef: 3 }, { score: 8, coef: 1 }]))).toBeCloseTo(77 / 6, 12);
    expect(avg([{ score: 10, coef: 2 }, { score: null, coef: 5 }, { score: 14, coef: 2 }])).toBe('12');
    expect(avg([{ score: null, coef: 2 }])).toBeNull();
    expect(avg([])).toBeNull();
    expect(avg([{ score: 18, coef: 0 }])).toBeNull(); // coefficient total nul
  });

  it('coefficients décimaux (migration 0054) exacts', () => {
    expect(avg([{ score: 10, coef: 1.5 }, { score: 16, coef: 2.5 }])).toBe('13.75'); // (15 + 40) / 4
  });
});

describe('Moyenne annuelle (S1 + 2·S2) / 3', () => {
  const annual = (s1: number | null, s2: number | null, second = true) => r.value('moyenne_annuelle', { s1, s2, second_semestre: second });

  it('formule officielle au 2e semestre', () => {
    expect(annual(12, 15)).toBe('14'); // (12 + 30) / 3
    expect(annual(10, 10)).toBe('10');
    expect(annual(9.5, 10.25)).toBe('10');
    expect(annual(14, 11)).toBe('12'); // (14 + 22) / 3
  });

  it('valeur exacte puis arrondi d\'affichage', () => {
    const v = annual(12.5, 14.1) as string;
    expect(v.startsWith('13.5666666666666666666666666666666666666')).toBe(true);
    expect(r.value('moyenne_ponderee', { matieres: [{ score: v, coef: 1 }] })).toBe(v);
  });

  it('repli sur la moyenne du semestre quand S1 est absent ou hors 2e semestre', () => {
    expect(annual(null, 13)).toBe('13');
    expect(annual(12, null)).toBeNull();
    expect(annual(12, 15, false)).toBe('15');
    expect(annual(null, null)).toBeNull();
  });

  it('les poids (1 et 2) sont des paramètres', () => {
    expect(r.value('moyenne_annuelle', { s1: 12, s2: 15, second_semestre: true }, { poids_s1: 1, poids_s2: 1 })).toBe('13.5');
  });
});

describe('Mentions par seuils 16 / 14 / 12 / 10 / 8', () => {
  const mention = (m: number | string | null) => r.value('mention', { moyenne: m });

  it.each([
    [20, 'Excellent'],
    [16, 'Excellent'],
    ['15.9999999999', 'Très bien'],
    [14, 'Très bien'],
    ['13.99', 'Bien'],
    [12, 'Bien'],
    ['11.999', 'Assez bien'],
    [10, 'Assez bien'],
    ['9.995', 'Passable'], // s'affiche 10,00 mais n'atteint pas 10
    [8, 'Passable'],
    ['7.9999', 'Insuffisant'],
    [0, 'Insuffisant'],
    [null, 'En attente'],
  ])('moyenne %s -> %s', (m, expected) => {
    expect(mention(m)).toBe(expected);
  });

  it('les seuils sont des paramètres', () => {
    expect(r.value('mention', { moyenne: 15 }, { excellent: 15 })).toBe('Excellent');
  });
});

describe('Décisions du conseil et de fin d\'année', () => {
  it('décision de période', () => {
    const d = (m: number | string | null) => r.value('decision_conseil', { moyenne: m });
    expect(d(10)).toBe('Periode validee');
    expect(d('9.995')).toBe('Renforcement recommande');
    expect(d(8)).toBe('Renforcement recommande');
    expect(d('7.99')).toBe('Periode non validee');
    expect(d(null)).toBe('Notes incompletes');
  });

  it('décision de fin d\'année', () => {
    const d = (m: number | null, second: boolean, bts2: boolean) =>
      r.value('decision_fin_annee', { moyenne: m, second_semestre: second, bts_deuxieme_annee: bts2 });
    expect(d(12, true, false)).toBe('Admis(e) en année supérieure');
    expect(d(9.99, true, false)).toBe('Redoublement');
    expect(d(10, true, false)).toBe('Admis(e) en année supérieure');
    expect(d(12, true, true)).toBe("Redouble en cas d'échec au BTS");
    expect(d(5, true, true)).toBe("Redouble en cas d'échec au BTS");
    expect(d(12, false, true)).toBe('Admis(e) en année supérieure');
    expect(d(null, true, true)).toBe('Décision en attente');
  });

  it('distinctions (tableau d\'honneur)', () => {
    const d = (m: number | null) => r.value('distinction', { moyenne: m });
    expect(d(17)).toBe("Tableau d'honneur + félicitations");
    expect(d(16.99)).toBe("Tableau d'honneur + Encouragement");
    expect(d(15)).toBe("Tableau d'honneur + Encouragement");
    expect(d(14.99)).toBe("Tableau d'honneur");
    expect(d(12)).toBe("Tableau d'honneur");
    expect(d(11.99)).toBe('');
    expect(d(null)).toBe('');
  });
});

describe('Classement avec ex æquo partagés', () => {
  const rank = (m: number | string | null, cohorte: (number | string | null)[]) => r.value('rang', { moyenne: m, cohorte });

  it('1, 1, 3, 4, 4 : les ex æquo partagent le meilleur rang, le suivant saute', () => {
    const cohorte = [14, 14, 12, 8, 8];
    expect(cohorte.map((m) => rank(m, cohorte))).toEqual(['1', '1', '3', '4', '4']);
  });

  it('élèves sans moyenne : pas de rang, et ils ne comptent pas', () => {
    const cohorte = [15, null, 12, null];
    expect(rank(15, cohorte)).toBe('1');
    expect(rank(12, cohorte)).toBe('2');
    expect(rank(null, cohorte)).toBeNull();
  });

  it('égalité jugée à 4 décimales (une moyenne calculée n\'a pas à être strictement identique)', () => {
    const cohorte = ['13.56661', '13.56664', '10'];
    expect(rank('13.56661', cohorte)).toBe('1');
    expect(rank('13.56664', cohorte)).toBe('1');
    expect(rank('10', cohorte)).toBe('3');
  });
});

/* ------------------------------------------------------------------------- */
/* Différentiel : le moteur reproduit les fonctions historiques               */
/* ------------------------------------------------------------------------- */

describe('différentiel vs semester-averages.ts (copie des fonctions historiques)', () => {
  const near = (x: number | null, thresholds: number[]) => x != null && thresholds.some((t) => Math.abs(x - t) < 1e-9);

  it('moyenne pondérée : 1000 jeux aléatoires', () => {
    const rnd = makeRng(777);
    const pick = (n: number) => Math.floor(rnd() * n);
    for (let i = 0; i < 1000; i++) {
      const matieres = Array.from({ length: 1 + pick(8) }, () => ({
        score: rnd() < 0.15 ? null : pick(2001) / 100,
        coef: pick(7) + (rnd() < 0.3 ? 0.5 : 0),
      }));
      const old = computeWeightedAverage(matieres);
      const mine = r.value('moyenne_ponderee', { matieres }) as string | null;
      if (old === null) expect(mine).toBeNull();
      else expect(Math.abs(Number(mine) - old)).toBeLessThan(1e-9);
    }
  });

  it('moyenne annuelle : 1000 jeux aléatoires', () => {
    const rnd = makeRng(31337);
    const pick = (n: number) => Math.floor(rnd() * n);
    for (let i = 0; i < 1000; i++) {
      const s1 = rnd() < 0.15 ? null : pick(2001) / 100;
      const s2 = rnd() < 0.15 ? null : pick(2001) / 100;
      const second = rnd() < 0.7;
      const old = computeAnnualAverage(s1, s2, second);
      const mine = r.value('moyenne_annuelle', { s1, s2, second_semestre: second }) as string | null;
      if (old === null) expect(mine).toBeNull();
      else expect(Math.abs(Number(mine) - old)).toBeLessThan(1e-9);
    }
  });

  it('mentions, décisions et distinctions : 3000 moyennes (hors égalité de seuil à l\'erreur flottante près)', () => {
    const rnd = makeRng(99);
    const pick = (n: number) => Math.floor(rnd() * n);
    const thresholds = [8, 10, 12, 14, 15, 16, 17];
    let compared = 0;
    for (let i = 0; i < 3000; i++) {
      const m = rnd() < 0.05 ? null : pick(200001) / 10000; // 4 décimales
      if (near(m, thresholds)) continue;
      compared++;
      expect(r.value('mention', { moyenne: m })).toBe(buildAverageMention(m));
      expect(r.value('decision_conseil', { moyenne: m })).toBe(buildCouncilDecision(m));
      expect(r.value('distinction', { moyenne: m })).toBe(buildDistinctionSanctionsFromAverage(m));
      for (const [second, bts2] of [[false, false], [true, false], [true, true], [false, true]] as const) {
        expect(r.value('decision_fin_annee', { moyenne: m, second_semestre: second, bts_deuxieme_annee: bts2 })).toBe(
          buildEndYearDecision(m, { isSecondSemester: second, isSecondYearBts: bts2 }),
        );
      }
    }
    expect(compared).toBeGreaterThan(2900);
  });

  it('exactement sur les seuils : les valeurs entières donnent le même résultat qu\'avant', () => {
    for (const m of [0, 8, 10, 12, 14, 15, 16, 17, 20]) {
      expect(r.value('mention', { moyenne: m })).toBe(buildAverageMention(m));
      expect(r.value('decision_conseil', { moyenne: m })).toBe(buildCouncilDecision(m));
      expect(r.value('distinction', { moyenne: m })).toBe(buildDistinctionSanctionsFromAverage(m));
    }
  });

  it('classement : 300 cohortes aléatoires (moyennes à 2 décimales, ex æquo fréquents)', () => {
    const rnd = makeRng(2025);
    const pick = (n: number) => Math.floor(rnd() * n);
    for (let t = 0; t < 300; t++) {
      const size = 1 + pick(25);
      const scores: (number | null)[] = Array.from({ length: size }, () => (rnd() < 0.1 ? null : (800 + pick(400)) / 100));
      const oldRanks = computeCompetitionRanks(scores.map((score, i) => ({ key: String(i), score })));
      scores.forEach((s, i) => {
        const mine = r.value('rang', { moyenne: s, cohorte: scores }) as string | null;
        const old = oldRanks[String(i)] ?? null;
        expect(mine === null ? null : Number(mine)).toBe(old);
      });
    }
  });

  it('divergence documentée : le classement du moteur juge l\'égalité à 4 décimales fixes, pas par chaînage de tolérance', () => {
    // Ancien code : |diff| < 0,0001 entre voisins triés. Nouveau : égalité des valeurs arrondies à 4 décimales.
    const cohorte = [10.00004, 10.00006];
    const old = computeCompetitionRanks(cohorte.map((score, i) => ({ key: String(i), score })));
    expect(old['0']).toBe(old['1']); // tolérance : ex æquo
    expect(r.value('rang', { moyenne: 10.00004, cohorte })).toBe('2'); // 10,0000 < 10,0001
    expect(r.value('rang', { moyenne: 10.00006, cohorte })).toBe('1');
  });
});
