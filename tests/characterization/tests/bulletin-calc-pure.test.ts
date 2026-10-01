import { describe, expect, it } from "vitest";
import {
  ANNEE_SUP_CREDITS,
  POIDS_DEVOIRS,
  POIDS_EXAMEN,
  SEMESTRE_CREDITS_REQUIS,
  SEUIL_ELIMINATOIRE,
  SEUIL_VALIDATION,
  arrondi,
  creditsTotal,
  creditsValides,
  evaluerEcue,
  evaluerUe,
  moyenneDevoirs,
  moyenneSession,
  moyenneUe,
  noteEcue,
  normaliserNote,
  peutPasserAnneeSuperieure,
  semestreValide,
} from "../../../apps/api/src/services/bulletin-calc";
import { DefectCollector } from "../harness/defects";
import { Rat, shortestDecimal, weightedMean } from "../harness/exact";
import { expectMatchesSnapshot } from "../harness/snapshot";

/**
 * Fonctions PURES de apps/api/src/services/bulletin-calc.ts, exécutées directement (elles sont exportées : aucune copie,
 * le test importe le fichier legacy). Sorties figées en snapshot `bulletin-calc-pure`.
 */

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

function exactNote(dev: number | null, exam: number): Rat {
  return Rat.of(dev ?? 0).mul("0.4").add(Rat.of(exam).mul("0.6"));
}

describe("bulletin-calc : fonctions pures figées", () => {
  const defects = new DefectCollector();
  const data: Record<string, unknown> = {};

  it("constantes de règles", () => {
    data.constants = { POIDS_DEVOIRS, POIDS_EXAMEN, SEUIL_VALIDATION, SEUIL_ELIMINATOIRE, SEMESTRE_CREDITS_REQUIS, ANNEE_SUP_CREDITS };
    expect(data.constants).toEqual({ POIDS_DEVOIRS: 0.4, POIDS_EXAMEN: 0.6, SEUIL_VALIDATION: 10, SEUIL_ELIMINATOIRE: 5, SEMESTRE_CREDITS_REQUIS: 20, ANNEE_SUP_CREDITS: 48 });
  });

  it("note d'ECUE, éliminatoire et validation sur la grille de limites", () => {
    const rows: Record<string, unknown> = {};
    for (const [d, e] of [...GRID_TEN, ...GRID_FIVE, ...LIMITS]) {
      const key = `devoirs ${d} / examen ${e}`;
      const r = evaluerEcue({ moyenneDevoirs: d, noteExamen: e, credits: 1 });
      rows[key] = { note: r.note, eliminee: r.eliminee, validee: r.validee, statut: r.statut };
      const exact = exactNote(d, e);
      const path = `ecue["${key}"]`;
      if (r.validee !== exact.gte(10)) defects.flag("FLOAT_ECUE_VALIDATION_10", `${path}.validee`, r.validee, exact.gte(10), { note: `note exacte ${exact.toString()} ; flottant ${r.note}` });
      if (r.eliminee !== exact.lt(5)) defects.flag("FLOAT_ECUE_ELIMINATOIRE_5", `${path}.eliminee`, r.eliminee, exact.lt(5), { note: `note exacte ${exact.toString()} ; flottant ${r.note}` });
    }
    data.ecue = rows;
    expect(Object.keys(rows).length).toBe(GRID_TEN.length + GRID_FIVE.length + LIMITS.length);
    expect(defects.occurrences.filter((o) => o.id === "FLOAT_ECUE_VALIDATION_10").length).toBe(24);
    expect(defects.occurrences.filter((o) => o.id === "FLOAT_ECUE_ELIMINATOIRE_5").length).toBe(8);
  });

  it("note d'ECUE : cas particuliers (sans examen, sans devoir)", () => {
    data.noteEcue = {
      "sans examen": noteEcue(12, null),
      "sans devoir": noteEcue(null, 10),
      "sans rien": noteEcue(null, null),
      "devoirs 0 examen 0": noteEcue(0, 0),
    };
    expect(data.noteEcue).toEqual({ "sans examen": null, "sans devoir": 6, "sans rien": null, "devoirs 0 examen 0": 0 });
  });

  it("UE : compensation, éliminatoire, incomplète, validation manuelle, moyenne exactement 10", () => {
    const cases: Record<string, { ecues: { dev: number | null; exam: number | null; credits: number; manuel?: boolean }[] }> = {
      "compensation (14 pondéré 4, 7,6 pondéré 2)": { ecues: [{ dev: 14, exam: 14, credits: 4 }, { dev: 7, exam: 8, credits: 2 }] },
      "éliminatoire malgré une moyenne de 14": { ecues: [{ dev: 20, exam: 20, credits: 4 }, { dev: 0, exam: 8, credits: 2 }] },
      "éliminatoire levée par le jury": { ecues: [{ dev: 20, exam: 20, credits: 4 }, { dev: 0, exam: 8, credits: 2, manuel: true }] },
      "incomplète (examen manquant)": { ecues: [{ dev: 18, exam: 18, credits: 4 }, { dev: 18, exam: null, credits: 2 }] },
      "crédits nuls ignorés": { ecues: [{ dev: 20, exam: 20, credits: 0 }, { dev: 10, exam: 10, credits: 5 }] },
      "aucune ECUE": { ecues: [] },
      "moyenne 9,995 (9,99 et 10 à crédits égaux)": { ecues: [{ dev: 9.99, exam: 9.99, credits: 1 }, { dev: 10, exam: 10, credits: 1 }] },
      "moyenne 9,996 (affichée 10) : devoirs 9,99 et examen 10": { ecues: [{ dev: 9.99, exam: 10, credits: 1 }] },
      "moyenne exactement 10 : 6,4 (1 crédit) et 11,2 (3 crédits)": { ecues: [{ dev: 6.4, exam: 6.4, credits: 1 }, { dev: 11.2, exam: 11.2, credits: 3 }] },
      "moyenne exactement 10 : 7,15 (1 crédit) et 10,95 (3 crédits)": { ecues: [{ dev: 7.15, exam: 7.15, credits: 1 }, { dev: 10.95, exam: 10.95, credits: 3 }] },
      "témoin exactement représentable : 7 et 11 (1 et 3 crédits)": { ecues: [{ dev: 7, exam: 7, credits: 1 }, { dev: 11, exam: 11, credits: 3 }] },
    };
    const out: Record<string, unknown> = {};
    for (const [name, c] of Object.entries(cases)) {
      const r = evaluerUe(c.ecues.map((e) => ({ moyenneDevoirs: e.dev, noteExamen: e.exam, credits: e.credits, validationManuelle: e.manuel })));
      out[name] = { moyenne: r.moyenne, moyenneAffichee: arrondi(r.moyenne), validee: r.validee, motifs: r.motifs, credits: r.credits, statuts: r.ecues.map((e) => e.statut) };
      if (!r.validee && r.moyenne !== null && (arrondi(r.moyenne) as number) >= 10 && r.motifs.length === 1 && r.motifs[0] === "MOYENNE_INSUFFISANTE") {
        defects.flag("DISPLAYED_AVERAGE_10_NOT_VALIDATED", `ue["${name}"].moyenneAffichee`, arrondi(r.moyenne), "règle voulue (ADR-003) : validation sur la valeur non arrondie ; affichage à arbitrer", { note: `moyenne exacte ${r.moyenne}` });
      }
      // Oracle : moyenne exacte de l'UE, validée si >= 10, aucune ECUE exactement < 5 non validée, UE complète.
      const noted = c.ecues.filter((e) => e.exam !== null);
      const mean = weightedMean(noted.map((e) => ({ value: exactNote(e.dev, e.exam as number), weight: Math.max(e.credits, 0) })));
      const eliminated = c.ecues.some((e) => e.exam !== null && exactNote(e.dev, e.exam).lt(5) && !e.manuel);
      const incomplete = c.ecues.some((e) => e.exam === null);
      const exactValid = mean !== null && mean.gte(10) && !eliminated && !incomplete;
      if (r.validee !== exactValid) {
        defects.flag("FLOAT_UE_VALIDATION_10", `ue["${name}"].validee`, r.validee, exactValid, { note: `moyenne d'UE exacte ${mean?.toString()} ; flottant ${r.moyenne}` });
      }
    }
    data.ue = out;
    expect(moyenneUe([])).toBeNull();
  });

  it("moyenne de session, crédits, semestre à 20 crédits, année à plus de 48 crédits", () => {
    const ues = [
      { moyenne: 12, credits: 6, validee: true },
      { moyenne: 9, credits: 4, validee: false },
      { moyenne: null, credits: 5, validee: false },
      { moyenne: 15, credits: 10, validee: true },
    ];
    data.session = {
      moyenneSession: moyenneSession(ues),
      moyenneSessionVide: moyenneSession([]),
      creditsValides: creditsValides(ues),
      creditsTotal: creditsTotal(ues),
    };
    const semestre: Record<string, boolean> = {};
    for (const c of [0, 19, 19.99, 20, 21, 28, 30, 36]) semestre[String(c)] = semestreValide(c);
    const annee: Record<string, boolean> = {};
    for (const c of [0, 47, 48, 48.5, 49, 50, 56, 60]) annee[String(c)] = peutPasserAnneeSuperieure(c);
    data.semestreValide = semestre;
    data.peutPasserAnneeSuperieure = annee;
    expect(semestre["20"]).toBe(true);
    expect(semestre["19"]).toBe(false);
    expect(annee["48"]).toBe(false);
    expect(annee["49"]).toBe(true);
    // Règles « mortes » : les fonctions existent mais aucun service ne les appelle (voir le catalogue des défauts).
    defects.flag("RULES_NOT_WIRED_SEMESTER_20_CREDITS", "semestreValide", "fonction exportée, jamais appelée", "à arbitrer (la v2 doit choisir entre 20 crédits et toutes les UE validées)", {
      note: "le bulletin applique ues.every(validee) ; voir bts-premiere-annee (bako, S2 : 30 crédits acquis, semestre non validé)",
    });
    defects.flag("RULES_NOT_WIRED_YEAR_48_CREDITS", "peutPasserAnneeSuperieure", "fonction exportée, jamais appelée", "à arbitrer (aucune décision de passage annuel n'existe dans le legacy)", {
      note: "voir bts-premiere-annee : 56 crédits à l'année, aucune décision de passage dans le bulletin BTS",
    });
  });

  it("moyenne des devoirs et normalisation sur 20", () => {
    data.moyenneDevoirs = {
      vide: moyenneDevoirs([]),
      "[10, 11]": moyenneDevoirs([10, 11]),
      "[9.99, 10]": moyenneDevoirs([9.99, 10]),
      "[1, 2, 2]": moyenneDevoirs([1, 2, 2]),
    };
    const norm: Record<string, number> = {};
    for (const [note, max] of [[7, 10], [14, 20], [36, 40], [1, 3], [2, 3], [0.7, 1], [13, 30], [17.5, 25], [5, 0], [5, -1]] as [number, number][]) {
      norm[`${note}/${max}`] = normaliserNote(note, max);
    }
    data.normaliserNote = norm;
    expect(norm["14/20"]).toBe(14);
    expect(norm["5/0"]).toBe(0);
  });

  it("arrondi d'affichage : Math.round(x*100)/100, pas un demi-supérieur décimal", () => {
    const values = [1.005, 2.675, 9.995, 10.005, 0.125, 1.255, 8.345, 12.345, 13.5666666666, 9.994999, 0.005, 0.015, 0.025, 4.995, 14.285];
    const out: Record<string, number | null> = {};
    for (const x of values) {
      const got = arrondi(x);
      out[String(x)] = got;
      const half = Number(Rat.of(shortestDecimal(x)).toFixedHalfUp(2));
      if (got !== half) {
        defects.flag("DISPLAY_ROUNDING_NOT_HALF_UP", `arrondi["${x}"]`, got, half, { note: `demi-supérieur décimal de ${x} = ${half}` });
      }
    }
    out["null"] = arrondi(null);
    data.arrondi = out;
    expect(arrondi(null)).toBeNull();
    expect(arrondi(1.005)).toBe(1);
  });

  it("la sortie est identique à la snapshot figée", () => {
    expectMatchesSnapshot("bulletin-calc-pure", "bulletin-calc-pure", data, defects.sorted());
  });
});
