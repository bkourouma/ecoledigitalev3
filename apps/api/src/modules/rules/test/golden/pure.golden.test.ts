/**
 * GOLDEN — fonctions pures de `bulletin-calc.ts` (snapshot `bulletin-calc-pure`) rejouées par le RuleSet `CI-HIGHER-LMD`.
 *
 * Mêmes entrées que le test de caractérisation (grille des 24 couples à 10, 8 couples à 5, bornes, UE, session, crédits, arrondi),
 * sorties produites UNIQUEMENT par l'évaluation des règles du RuleSet (jamais de seuil ni de formule dans ce fichier).
 *
 * Écarts acceptés : bogues connus du legacy (FLOAT_ECUE_VALIDATION_10, FLOAT_ECUE_ELIMINATOIRE_5, FLOAT_UE_VALIDATION_10,
 * DISPLAY_ROUNDING_NOT_HALF_UP) et leurs CONSÉQUENCES déclarées champ par champ (statut d'ECUE, motifs d'échec d'UE).
 * Deux amélioration documentées de la parité (P-RUL-06) ne figurent pas au catalogue : un barème nul ou négatif ÉCHOUE en v2
 * au lieu de renvoyer 0 en silence.
 */
import { describe, expect, it } from "vitest";
import { compareStrict, describeDifferences, loadSnapshot, withConsequences } from "./helpers";
import { RuleRunner, compiledSeed } from "../support/runner";

const lmd = new RuleRunner(compiledSeed("CI-HIGHER-LMD"));

const GRID_TEN: [number, number][] = [
  [0.13, 16.58], [0.16, 16.56], [0.22, 16.52], [0.4, 16.4], [0.46, 16.36], [0.64, 16.24], [0.7, 16.2], [0.88, 16.08],
  [0.94, 16.04], [1.39, 15.74], [1.63, 15.58], [1.75, 15.5], [1.87, 15.42], [1.99, 15.34], [2.11, 15.26], [2.23, 15.18],
  [2.35, 15.1], [2.47, 15.02], [2.59, 14.94], [2.71, 14.86], [2.83, 14.78], [2.95, 14.7], [3.07, 14.62], [3.19, 14.54],
];
const GRID_FIVE: [number, number][] = [
  [0.08, 8.28], [0.11, 8.26], [0.2, 8.2], [0.23, 8.18], [0.32, 8.12], [0.35, 8.1], [0.44, 8.04], [0.47, 8.02],
];
const LIMITS: [number, number][] = [
  [0, 0], [20, 20], [10, 10], [9.99, 9.99], [10.01, 10.01], [5, 5], [4.99, 4.99], [5.01, 5.01], [0, 16.67], [0, 16.66],
  [12, 14], [11.25, 9], [13.75, 12.5], [20, 0], [0, 20], [15, 5], [3, 3], [8, 8], [10.5, 9.5],
];

const STATUS_KEYS: Record<string, string> = { PENDING: "en_cours", ELIMINATORY: "eliminatoire", VALIDATED: "valide", COMPENSATED: "compense", INSUFFICIENT: "insuffisant" };
const noteOf = (dev: number | null, exam: number | null): number | null => lmd.num("note_ecue", { moyenne_devoirs: dev, note_examen: exam });
const display = (x: number | null): number | null => lmd.num("arrondi_affichage", { valeur: x });

function ecueCase(dev: number | null, exam: number | null) {
  const note = noteOf(dev, exam);
  return {
    note,
    eliminee: lmd.bool("ecue_eliminee", { note, validation_manuelle: false }),
    validee: lmd.bool("ecue_validee", { note, validation_manuelle: false }),
    // ECUE isolée (hors UE) : « insuffisant » entre les deux seuils (la compensation suppose une UE validée).
    statut: STATUS_KEYS[lmd.str("statut_ecue", { note, ue_validee: false })],
  };
}

function ueCase(ecues: { dev: number | null; exam: number | null; credits: number; manuel?: boolean }[]) {
  const lines = ecues.map((e) => ({ note: noteOf(e.dev, e.exam), credits: e.credits, validation_manuelle: e.manuel === true }));
  const moyenne = lmd.num("moyenne_ue", { ecues: lines });
  const validee = lmd.bool("ue_validee", { moyenne, ecues: lines });
  // Motifs d'échec : composés des règles du jeu (le seuil de la moyenne est celui de `ecue_validee`, jamais une constante ici).
  const motifs: string[] = [];
  if (lines.some((l) => lmd.bool("ecue_eliminee", { note: l.note, validation_manuelle: false }) && !l.validation_manuelle)) motifs.push("NOTE_ELIMINATOIRE");
  if (!lmd.bool("ecue_validee", { note: moyenne, validation_manuelle: false })) motifs.push("MOYENNE_INSUFFISANTE");
  if (lines.some((l) => l.note === null)) motifs.push("INCOMPLET");
  return {
    moyenne,
    moyenneAffichee: display(moyenne),
    validee,
    motifs,
    credits: lmd.num("credits_ue", { ecues: lines }),
    statuts: lines.map((l) => STATUS_KEYS[lmd.str("statut_ecue", { note: l.note, ue_validee: validee })]),
  };
}

function actualSnapshotData() {
  const constants = {
    POIDS_DEVOIRS: lmd.param("note_ecue", "poids_devoirs"),
    POIDS_EXAMEN: lmd.param("note_ecue", "poids_examen"),
    SEUIL_VALIDATION: lmd.param("ecue_validee", "seuil_validation"),
    SEUIL_ELIMINATOIRE: lmd.param("ecue_eliminee", "seuil_eliminatoire"),
    SEMESTRE_CREDITS_REQUIS: lmd.param("semestre_valide", "credits_requis"),
    ANNEE_SUP_CREDITS: lmd.param("annee_validee", "credits_exclusifs"),
  };

  const ecue: Record<string, unknown> = {};
  for (const [d, e] of [...GRID_TEN, ...GRID_FIVE, ...LIMITS]) ecue[`devoirs ${d} / examen ${e}`] = ecueCase(d, e);

  const noteEcue = {
    "sans examen": noteOf(12, null),
    "sans devoir": noteOf(null, 10),
    "sans rien": noteOf(null, null),
    "devoirs 0 examen 0": noteOf(0, 0),
  };

  const ue: Record<string, unknown> = {
    "compensation (14 pondéré 4, 7,6 pondéré 2)": ueCase([{ dev: 14, exam: 14, credits: 4 }, { dev: 7, exam: 8, credits: 2 }]),
    "éliminatoire malgré une moyenne de 14": ueCase([{ dev: 20, exam: 20, credits: 4 }, { dev: 0, exam: 8, credits: 2 }]),
    "éliminatoire levée par le jury": ueCase([{ dev: 20, exam: 20, credits: 4 }, { dev: 0, exam: 8, credits: 2, manuel: true }]),
    "incomplète (examen manquant)": ueCase([{ dev: 18, exam: 18, credits: 4 }, { dev: 18, exam: null, credits: 2 }]),
    "crédits nuls ignorés": ueCase([{ dev: 20, exam: 20, credits: 0 }, { dev: 10, exam: 10, credits: 5 }]),
    "aucune ECUE": ueCase([]),
    "moyenne 9,995 (9,99 et 10 à crédits égaux)": ueCase([{ dev: 9.99, exam: 9.99, credits: 1 }, { dev: 10, exam: 10, credits: 1 }]),
    "moyenne 9,996 (affichée 10) : devoirs 9,99 et examen 10": ueCase([{ dev: 9.99, exam: 10, credits: 1 }]),
    "moyenne exactement 10 : 6,4 (1 crédit) et 11,2 (3 crédits)": ueCase([{ dev: 6.4, exam: 6.4, credits: 1 }, { dev: 11.2, exam: 11.2, credits: 3 }]),
    "moyenne exactement 10 : 7,15 (1 crédit) et 10,95 (3 crédits)": ueCase([{ dev: 7.15, exam: 7.15, credits: 1 }, { dev: 10.95, exam: 10.95, credits: 3 }]),
    "témoin exactement représentable : 7 et 11 (1 et 3 crédits)": ueCase([{ dev: 7, exam: 7, credits: 1 }, { dev: 11, exam: 11, credits: 3 }]),
  };

  const ues = [
    { moyenne: 12, credits: 6, validee: true },
    { moyenne: 9, credits: 4, validee: false },
    { moyenne: null, credits: 5, validee: false },
    { moyenne: 15, credits: 10, validee: true },
  ];
  const session = {
    moyenneSession: lmd.num("moyenne_session", { ues }),
    moyenneSessionVide: lmd.num("moyenne_session", { ues: [] }),
    creditsValides: lmd.num("credits_valides", { ues }),
    creditsTotal: lmd.num("credits_total", { ues }),
  };

  // Règles « mortes » du legacy (20 crédits, > 48 crédits) : DONNÉES configurables du RuleSet, inactives par défaut.
  // Le mode `CREDITS` reproduit exactement les anciennes fonctions.
  const semestre: Record<string, boolean> = {};
  for (const c of [0, 19, 19.99, 20, 21, 28, 30, 36]) semestre[String(c)] = lmd.bool("semestre_valide", { ues: [{ validee: true, credits: c }] }, { mode_validation: "CREDITS" });
  const annee: Record<string, boolean> = {};
  for (const c of [0, 47, 48, 48.5, 49, 50, 56, 60]) annee[String(c)] = lmd.bool("annee_validee", { ues: [{ validee: true, credits: c }] }, { mode_validation: "CREDITS" });

  const devoir = (note: number) => ({ note, bareme: 20, poids: 1 });
  const moyenneDevoirs = {
    vide: lmd.num("moyenne_devoirs", { devoirs: [] }),
    "[10, 11]": lmd.num("moyenne_devoirs", { devoirs: [10, 11].map(devoir) }),
    "[9.99, 10]": lmd.num("moyenne_devoirs", { devoirs: [9.99, 10].map(devoir) }),
    "[1, 2, 2]": lmd.num("moyenne_devoirs", { devoirs: [1, 2, 2].map(devoir) }),
  };

  const normaliserNote: Record<string, number | string> = {};
  for (const [note, max] of [[7, 10], [14, 20], [36, 40], [1, 3], [2, 3], [0.7, 1], [13, 30], [17.5, 25], [5, 0], [5, -1]] as [number, number][]) {
    const r = lmd.result("note_sur_20", { note, bareme: max });
    normaliserNote[`${note}/${max}`] = r.ok ? Number(r.value.value) : `erreur ${(r.error.details as { engineCode?: string } | undefined)?.engineCode ?? r.error.code}`;
  }

  const arrondi: Record<string, number | null> = {};
  for (const x of [1.005, 2.675, 9.995, 10.005, 0.125, 1.255, 8.345, 12.345, 13.5666666666, 9.994999, 0.005, 0.015, 0.025, 4.995, 14.285]) arrondi[String(x)] = display(x);
  arrondi["null"] = display(null);

  return { constants, ecue, noteEcue, ue, session, semestreValide: semestre, peutPasserAnneeSuperieure: annee, moyenneDevoirs, normaliserNote, arrondi };
}

describe("GOLDEN bulletin-calc-pure : CI-HIGHER-LMD reproduit le legacy, sauf bogues connus", () => {
  const snapshot = withConsequences(loadSnapshot("bulletin-calc-pure"), {
    // 24 couples exactement à 10 : le statut de l'ECUE suit sa validation.
    FLOAT_ECUE_VALIDATION_10: (p) => (p.startsWith("ecue[") ? [p.replace(/\.validee$/, ".statut")] : []),
    FLOAT_ECUE_ELIMINATOIRE_5: (p) => (p.startsWith("ecue[") ? [p.replace(/\.eliminee$/, ".statut")] : []),
    // Moyenne d'UE exactement à 10 : validation, statuts des ECUE et motifs d'échec suivent.
    FLOAT_UE_VALIDATION_10: (p) => [p.replace(/\.validee$/, ".statuts.*"), p.replace(/\.validee$/, ".motifs.*")],
  });
  const actual = actualSnapshotData();

  it("aucun écart inexpliqué (hors amélioration P-RUL-06 sur les barèmes invalides)", () => {
    const result = compareStrict(actual, snapshot, {
      // P-RUL-06 : le legacy renvoie 0 pour un barème nul ou négatif (donnée invalide masquée) ; la v2 refuse (erreur du moteur).
      ignore: ['normaliserNote["5/0"]', 'normaliserNote["5/-1"]'],
    });
    expect(result.differences, describeDifferences(result)).toEqual([]);
  });

  it("ne reproduit AUCUN des bogues flottants connus", () => {
    const result = compareStrict(actual, snapshot, { ignore: ['normaliserNote["5/0"]', 'normaliserNote["5/-1"]'] });
    expect(result.stillDefective).toEqual([]);
    const corrected = new Set(result.corrected.map((d) => d.id));
    expect([...corrected].sort()).toEqual(["DISPLAY_ROUNDING_NOT_HALF_UP", "FLOAT_ECUE_ELIMINATOIRE_5", "FLOAT_ECUE_VALIDATION_10", "FLOAT_UE_VALIDATION_10"]);
    // 24 + 8 + 2 + 3 occurrences corrigées (catalogue de caractérisation).
    expect(result.corrected.filter((d) => d.id === "FLOAT_ECUE_VALIDATION_10")).toHaveLength(24);
    expect(result.corrected.filter((d) => d.id === "FLOAT_ECUE_ELIMINATOIRE_5")).toHaveLength(8);
    expect(result.corrected.filter((d) => d.id === "FLOAT_UE_VALIDATION_10")).toHaveLength(2);
    expect(result.corrected.filter((d) => d.id === "DISPLAY_ROUNDING_NOT_HALF_UP")).toHaveLength(3);
    expect(result.divergedElsewhere).toEqual([]);
  });

  it("les valeurs « à arbitrer » du legacy sont tranchées par les décisions métier (aucun défaut ignoré en silence)", () => {
    const result = compareStrict(actual, snapshot, { ignore: ['normaliserNote["5/0"]', 'normaliserNote["5/-1"]'] });
    // semestreValide / peutPasserAnneeSuperieure : valeur « à arbitrer », décision du 2026-10-01 = toutes les UE validées ; les anciennes
    // règles restent rejouables par le mode CREDITS et coïncident exactement avec les fonctions du legacy (aucun écart ci-dessus).
    expect(result.unverified.map((d) => d.id).sort()).toEqual(
      expect.arrayContaining(["RULES_NOT_WIRED_SEMESTER_20_CREDITS", "RULES_NOT_WIRED_YEAR_48_CREDITS"]),
    );
    // Le mode par défaut (décision métier) ne coïncide PAS avec l'ancienne règle : il suffit de comparer 19 crédits tous validés.
    expect(lmd.bool("semestre_valide", { ues: [{ validee: true, credits: 19 }] })).toBe(true);
    expect(lmd.bool("semestre_valide", { ues: [{ validee: true, credits: 19 }] }, { mode_validation: "CREDITS" })).toBe(false);
  });

  it("le barème invalide ÉCHOUE au lieu de renvoyer 0 en silence (P-RUL-06)", () => {
    expect(actual.normaliserNote["5/0"]).toBe("erreur DIVISION_PAR_ZERO");
    expect(actual.normaliserNote["5/-1"]).toBe("erreur DIVISION_PAR_ZERO");
    expect(actual.normaliserNote["7/10"]).toBe(14);
  });
});
