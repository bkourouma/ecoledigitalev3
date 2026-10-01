/**
 * Golden tests BTS / LMD : formules RÉELLES de apps/api/src/services/bulletin-calc.ts
 * (feature 030). Les valeurs attendues sont calculées à la main (décimales exactes).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRng, runner } from './helpers';
import { btsLmdVersion } from './fixtures/rulesets';

const r = runner(btsLmdVersion);

interface EcueIn {
  dev: number | null;
  exam: number | null;
  credits: number;
  manuel?: boolean;
}

/** Chaîne complète ECUE -> UE avec le moteur de règles. */
function ue(ecues: EcueIn[]) {
  const notes = ecues.map((e) => r.value('note_ecue', { moyenne_devoirs: e.dev, note_examen: e.exam }) as string | null);
  const rows = ecues.map((e, i) => ({ note: notes[i] ?? null, credits: e.credits, validation_manuelle: e.manuel === true }));
  const moyenne = r.value('moyenne_ue', { ecues: rows }) as string | null;
  const validee = r.value('ue_validee', { moyenne, ecues: rows }) as boolean;
  const statuts = rows.map((row) => r.value('statut_ecue', { note: row.note, ue_validee: validee }) as string);
  const credits = r.value('credits_ue', { ecues: rows }) as string;
  return { notes, moyenne, validee, statuts, credits };
}

describe('BTS/LMD : toutes les règles se compilent à la publication', () => {
  it('compile les 13 règles avec leur schéma, type de résultat compris', () => {
    const all = r.compileAll();
    expect(all.length).toBe(btsLmdVersion.rules.length);
    expect(all.length).toBe(13);
  });
});

describe('Note ECUE = devoirs × 0,4 + examen × 0,6', () => {
  const note = (dev: number | null, exam: number | null) => r.value('note_ecue', { moyenne_devoirs: dev, note_examen: exam });

  it('cas courants (valeurs exactes)', () => {
    expect(note(12, 14)).toBe('13.2'); // 4,8 + 8,4
    expect(note(10, 10)).toBe('10');
    expect(note(0, 20)).toBe('12');
    expect(note(20, 0)).toBe('8');
    expect(note(11.25, 9)).toBe('9.9'); // un flottant donne 9.899999999999999
    expect(note(13.75, 12.5)).toBe('13'); // 5,5 + 7,5
  });

  it('sans devoir, le continu compte pour 0 ; sans examen, pas de note', () => {
    expect(note(null, 10)).toBe('6');
    expect(note(15, null)).toBeNull();
    expect(note(null, null)).toBeNull();
  });

  it('les poids sont des paramètres (0,4 / 0,6 par défaut)', () => {
    expect(r.value('note_ecue', { moyenne_devoirs: 12, note_examen: 14 }, { poids_devoirs: 0.5, poids_examen: 0.5 })).toBe('13');
    expect(() => r.value('note_ecue', { moyenne_devoirs: 12, note_examen: 14 }, { poids_devoirs: 1.5 })).toThrowError(/hors de l'intervalle/);
    expect(() => r.value('note_ecue', { moyenne_devoirs: 12, note_examen: 14 }, { poids_devoirs: 'x' })).toThrowError(/doit être de type number/);
  });

  it('correction des erreurs d\'arrondi binaire sur les seuils (régressions du code historique)', () => {
    // 0,2 × 0,4 + 8,2 × 0,6 = 5 exactement : le flottant donne 4.999999999999999 (< 5 => « éliminatoire » à tort)
    expect(0.2 * 0.4 + 8.2 * 0.6 < 5).toBe(true);
    expect(note(0.2, 8.2)).toBe('5');
    expect(r.value('ecue_eliminee', { note: note(0.2, 8.2), validation_manuelle: false })).toBe(false);
    // 0,4 × 0,4 + 16,4 × 0,6 = 10 exactement : le flottant donne 9.999999999999998 (< 10 => « non validée » à tort)
    expect(0.4 * 0.4 + 16.4 * 0.6 >= 10).toBe(false);
    expect(note(0.4, 16.4)).toBe('10');
    expect(r.value('ecue_validee', { note: note(0.4, 16.4), validation_manuelle: false })).toBe(true);
  });
});

describe('ECUE éliminatoire (< 5, valeur non arrondie) et validation (≥ 10)', () => {
  const elim = (note: string | null, manuel = false) => r.value('ecue_eliminee', { note, validation_manuelle: manuel });
  const valid = (note: string | null, manuel = false) => r.value('ecue_validee', { note, validation_manuelle: manuel });

  it('seuil éliminatoire : strictement inférieur à 5', () => {
    expect(elim('4.99')).toBe(true);
    expect(elim('4.999999999999999999')).toBe(true);
    expect(elim('5')).toBe(false);
    expect(elim('5.00')).toBe(false);
    expect(elim('0')).toBe(true);
    expect(elim(null)).toBe(false);
  });

  it('seuil de validation 10 testé sur la valeur NON arrondie', () => {
    expect(valid('10')).toBe(true);
    expect(valid('9.995')).toBe(false); // s'affiche 10,00 mais n'est PAS ≥ 10
    expect(valid('9.9999999999999999')).toBe(false);
    expect(valid('10.0000000000000001')).toBe(true);
    expect(valid('9.5')).toBe(false);
    expect(valid(null)).toBe(false);
  });

  it('la validation manuelle force la validation, même sans note', () => {
    expect(valid('8', true)).toBe(true);
    expect(valid(null, true)).toBe(true);
  });

  it('l\'arrondi d\'affichage ne sert jamais pour un seuil', () => {
    expect(r.value('arrondi_affichage', { valeur: '9.995' })).toBe('10');
    expect(r.value('arrondi_affichage', { valeur: '13.5666666666' })).toBe('13.57');
    expect(r.value('arrondi_affichage', { valeur: '0.005' })).toBe('0.01');
    expect(r.value('arrondi_affichage', { valeur: null })).toBeNull();
    expect(valid('9.995')).toBe(false);
  });
});

describe('Moyenne UE pondérée par crédits, UE validée, compensation', () => {
  it('moyenne pondérée par les crédits des ECUE', () => {
    const u = ue([
      { dev: 12, exam: 14, credits: 4 }, // 13,2
      { dev: 8, exam: 8, credits: 6 }, // 8
    ]);
    expect(u.notes).toEqual(['13.2', '8']);
    expect(u.moyenne).toBe('10.08'); // (13,2×4 + 8×6) / 10
    expect(u.credits).toBe('10');
    expect(u.validee).toBe(true);
    expect(u.statuts).toEqual(['valide', 'compense']); // 8 est compensée par l'UE
  });

  it('UE non validée : les ECUE faibles sont « insuffisant »', () => {
    const u = ue([
      { dev: 10, exam: 10, credits: 2 }, // 10
      { dev: 8, exam: 8, credits: 8 }, // 8
    ]);
    expect(u.moyenne).toBe('8.4');
    expect(u.validee).toBe(false);
    expect(u.statuts).toEqual(['valide', 'insuffisant']);
  });

  it('ECUE éliminatoire (< 5) : l\'UE n\'est pas validée même avec une excellente moyenne', () => {
    const u = ue([
      { dev: 20, exam: 20, credits: 4 }, // 20
      { dev: 0, exam: 8, credits: 2 }, // 4,8 < 5
    ]);
    expect(u.notes).toEqual(['20', '4.8']);
    expect(Number(u.moyenne)).toBeGreaterThan(14);
    expect(u.validee).toBe(false);
    expect(u.statuts).toEqual(['valide', 'eliminatoire']);
  });

  it('une note de 5 pile n\'est pas éliminatoire : l\'UE se valide à 10 pile', () => {
    const u = ue([
      { dev: 5, exam: 5, credits: 3 }, // 5
      { dev: 15, exam: 15, credits: 3 }, // 15
    ]);
    expect(u.moyenne).toBe('10');
    expect(u.validee).toBe(true);
    expect(u.statuts).toEqual(['compense', 'valide']);
  });

  it('la validation manuelle lève le verrou éliminatoire (le statut reste « eliminatoire »)', () => {
    const u = ue([
      { dev: 20, exam: 20, credits: 4 },
      { dev: 0, exam: 8, credits: 2, manuel: true },
    ]);
    expect(u.validee).toBe(true);
    expect(u.statuts).toEqual(['valide', 'eliminatoire']);
  });

  it('UE incomplète (examen manquant) : jamais validée', () => {
    const u = ue([
      { dev: 18, exam: 18, credits: 4 },
      { dev: 18, exam: null, credits: 2 },
    ]);
    expect(u.moyenne).toBe('18'); // moyenne sur les ECUE notées
    expect(u.validee).toBe(false);
    expect(u.statuts).toEqual(['valide', 'en_cours']);
  });

  it('crédits nuls ignorés ; UE sans note => moyenne absente et non validée', () => {
    const u = ue([
      { dev: 20, exam: 20, credits: 0 },
      { dev: 10, exam: 10, credits: 5 },
    ]);
    expect(u.moyenne).toBe('10');
    const vide = ue([]);
    expect(vide.moyenne).toBeNull();
    expect(vide.validee).toBe(false);
    expect(vide.credits).toBe('0');
    const sansNote = ue([{ dev: 10, exam: null, credits: 3 }]);
    expect(sansNote.moyenne).toBeNull();
    expect(sansNote.validee).toBe(false);
  });

  it('seuil UE sur la valeur non arrondie : 9,995 n\'est pas validée', () => {
    const rows = [
      { note: '9.99', credits: 1, validation_manuelle: false },
      { note: '10', credits: 1, validation_manuelle: false },
    ];
    const moyenne = r.value('moyenne_ue', { ecues: rows });
    expect(moyenne).toBe('9.995');
    expect(r.value('ue_validee', { moyenne, ecues: rows })).toBe(false);
    expect(r.value('arrondi_affichage', { valeur: moyenne })).toBe('10');
  });
});

describe('Session : moyenne par crédits, 20 crédits par semestre, > 48 par année', () => {
  const ues = [
    { moyenne: '12', credits: 6, validee: true },
    { moyenne: '9', credits: 4, validee: false },
    { moyenne: null, credits: 5, validee: false },
    { moyenne: '15', credits: 10, validee: true },
  ];

  it('moyenne de session pondérée, UE sans moyenne ignorées', () => {
    // (12×6 + 9×4 + 15×10) / 20 = 258 / 20
    expect(r.value('moyenne_session', { ues })).toBe('12.9');
    expect(r.value('moyenne_session', { ues: [] })).toBeNull();
  });

  it('crédits acquis et engagés', () => {
    expect(r.value('credits_valides', { ues })).toBe('16');
    expect(r.value('credits_total', { ues })).toBe('25');
    expect(r.value('credits_valides', { ues: [] })).toBe('0');
  });

  it('semestre validé à 20 crédits acquis (≥ 20)', () => {
    expect(r.value('semestre_valide', { credits: 20 })).toBe(true);
    expect(r.value('semestre_valide', { credits: 19 })).toBe(false);
    expect(r.value('semestre_valide', { credits: 30 })).toBe(true);
    expect(r.value('semestre_valide', { credits: 15 }, { credits_requis: 15 })).toBe(true);
  });

  it('passage en année supérieure : STRICTEMENT plus de 48 crédits', () => {
    expect(r.value('passage_annee_superieure', { credits: 48 })).toBe(false);
    expect(r.value('passage_annee_superieure', { credits: 49 })).toBe(true);
    expect(r.value('passage_annee_superieure', { credits: 60 })).toBe(true);
    expect(r.value('passage_annee_superieure', { credits: 48.5 })).toBe(true);
  });
});

describe('Explicabilité : la trace expose les valeurs intermédiaires', () => {
  it('trace de la note ECUE', () => {
    const res = r.run('note_ecue', { moyenne_devoirs: 11.25, note_examen: 9 });
    expect(res.json).toBe('9.9');
    const labels = res.trace.map((t) => `${t.label}=${JSON.stringify(t.value)}`);
    expect(labels).toContain('note_examen="9"');
    expect(labels).toContain('moyenne_devoirs="11.25"');
    expect(labels).toContain('*="4.5"'); // devoirs × 0,4
    expect(labels).toContain('*="5.4"'); // examen × 0,6
    expect(labels).toContain('+="9.9"');
    expect(res.trace.at(-1)?.label).toBe('if');
  });
});

/* ------------------------------------------------------------------------- */
/* Différentiel : le moteur de règles reproduit le code historique            */
/* ------------------------------------------------------------------------- */

const legacyPath = join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'services', 'bulletin-calc.ts');
const legacyAvailable = existsSync(legacyPath);

describe.skipIf(!legacyAvailable)('différentiel vs apps/api/src/services/bulletin-calc.ts', () => {
  it('2000 UE aléatoires : moyennes, validations et statuts identiques (hors cas d\'égalité de seuil à l\'erreur flottante près)', async () => {
    const legacy = (await import(/* @vite-ignore */ legacyPath.replace(/\\/g, '/'))) as typeof import('../../../apps/api/src/services/bulletin-calc');
    const rnd = makeRng(20240901);
    const pick = (n: number) => Math.floor(rnd() * n);
    const grade = () => pick(2001) / 100; // 0,00 à 20,00 par pas de 0,01
    let compared = 0;
    let skipped = 0;
    for (let i = 0; i < 2000; i++) {
      const n = 1 + pick(5);
      const ecues: EcueIn[] = Array.from({ length: n }, () => ({
        dev: rnd() < 0.15 ? null : grade(),
        exam: rnd() < 0.1 ? null : grade(),
        credits: pick(7),
        manuel: rnd() < 0.1,
      }));
      const mine = ue(ecues);
      const old = legacy.evaluerUe(
        ecues.map((e) => ({ moyenneDevoirs: e.dev, noteExamen: e.exam, credits: e.credits, validationManuelle: e.manuel })),
      );

      // Les cas où la formule flottante historique tombe à 1e-9 d'un seuil sont exactement ceux où elle peut se tromper : écartés.
      const near = (x: number | null, t: number) => x != null && Math.abs(x - t) < 1e-9;
      if (old.ecues.some((e) => near(e.note, 5) || near(e.note, 10)) || near(old.moyenne, 10)) {
        skipped++;
        continue;
      }
      compared++;

      mine.notes.forEach((m, k) => {
        const o = old.ecues[k]?.note ?? null;
        if (o === null) expect(m).toBeNull();
        else expect(Math.abs(Number(m) - o)).toBeLessThan(1e-9);
      });
      if (old.moyenne === null) expect(mine.moyenne).toBeNull();
      else expect(Math.abs(Number(mine.moyenne) - old.moyenne)).toBeLessThan(1e-9);
      expect(mine.validee).toBe(old.validee);
      expect(mine.statuts).toEqual(old.ecues.map((e) => e.statut));
      expect(Number(mine.credits)).toBe(old.credits);
    }
    expect(compared).toBeGreaterThan(1900);
    expect(skipped + compared).toBe(2000);
  });

  it('sessions, crédits acquis, semestre et année : identiques', async () => {
    const legacy = (await import(/* @vite-ignore */ legacyPath.replace(/\\/g, '/'))) as typeof import('../../../apps/api/src/services/bulletin-calc');
    const rnd = makeRng(4242);
    const pick = (n: number) => Math.floor(rnd() * n);
    for (let i = 0; i < 500; i++) {
      const ues = Array.from({ length: 1 + pick(8) }, () => ({
        moyenne: rnd() < 0.1 ? null : pick(2001) / 100,
        credits: pick(11),
        validee: rnd() < 0.6,
      }));
      const mineSession = r.value('moyenne_session', { ues });
      const oldSession = legacy.moyenneSession(ues);
      if (oldSession === null) expect(mineSession).toBeNull();
      else expect(Math.abs(Number(mineSession) - oldSession)).toBeLessThan(1e-9);
      const acquis = Number(r.value('credits_valides', { ues }));
      expect(acquis).toBe(legacy.creditsValides(ues));
      expect(Number(r.value('credits_total', { ues }))).toBe(legacy.creditsTotal(ues));
      expect(r.value('semestre_valide', { credits: acquis })).toBe(legacy.semestreValide(acquis));
      expect(r.value('passage_annee_superieure', { credits: acquis })).toBe(legacy.peutPasserAnneeSuperieure(acquis));
    }
    for (const c of [0, 19, 20, 21, 47, 48, 49, 60]) {
      expect(r.value('semestre_valide', { credits: c })).toBe(legacy.semestreValide(c));
      expect(r.value('passage_annee_superieure', { credits: c })).toBe(legacy.peutPasserAnneeSuperieure(c));
    }
  });
});
