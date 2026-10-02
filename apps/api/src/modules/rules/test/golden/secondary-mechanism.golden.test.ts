/**
 * GOLDEN DE MÉCANISME — `CI-SECONDARY-PLACEHOLDER` (specs/v2/006-secondary/spec.md §6.4 ; plan.md « le contrat
 * `secondary-annual@1` compile ses règles sur 2, 3 et 4 périodes »).
 *
 * v1 (`coef-semester@1`) est une copie de démonstration de `CI-CLASSIC-SEMESTRE` v1 : ses sorties DOIVENT être celles du jeu
 * classique (même forme, mêmes valeurs). v2 (`secondary-annual@1`) généralise la moyenne annuelle à N périodes pondérées.
 * Aucune règle officielle, aucune règle d'orientation.
 */
import { describe, expect, it } from "vitest";
import { RuleRunner, compiledSeed } from "../support/runner";

const classic = new RuleRunner(compiledSeed("CI-CLASSIC-SEMESTRE"));
const v1 = new RuleRunner(compiledSeed("CI-SECONDARY-PLACEHOLDER"));
const v2 = new RuleRunner(compiledSeed("CI-SECONDARY-PLACEHOLDER", undefined, 2));

describe("CI-SECONDARY-PLACEHOLDER — golden de mécanisme", () => {
  it("les deux versions sont marquées `placeholder`, jamais `regulation`", () => {
    expect(v1.compiled.version.source.kind).toBe("placeholder");
    expect(v2.compiled.version.source.kind).toBe("placeholder");
    expect(v1.compiled.version.contractId).toBe("coef-semester@1");
    expect(v2.compiled.version.contractId).toBe("secondary-annual@1");
  });

  it("v1 reproduit CI-CLASSIC-SEMESTRE sur une grille de moyennes (mention, décisions, distinction, appréciation)", () => {
    for (const moyenne of [null, 0, 7.99, 8, 9.99, 10, 11.99, 12, 14, 15.5, 16, 17, 18, 20]) {
      for (const key of ["mention", "decision_conseil", "distinction", "appreciation_conseil"]) {
        expect(v1.value(key, { moyenne }), `${key}(${String(moyenne)})`).toBe(classic.value(key, { moyenne }));
      }
      for (const examen of [false, true]) {
        expect(v1.value("decision_fin_annee", { moyenne, second_semestre: true, examen_terminal_requis: examen })).toBe(classic.value("decision_fin_annee", { moyenne, second_semestre: true, examen_terminal_requis: examen }));
      }
    }
    expect(v1.value("moyenne_annuelle", { s1: 12, s2: 14, second_semestre: true })).toBe(classic.value("moyenne_annuelle", { s1: 12, s2: 14, second_semestre: true }));
  });

  it("v2 — moyenne annuelle sur 2, 3 et 4 périodes pondérées", () => {
    // 2 périodes de poids 1 et 2 : reproduit (S1 + 2·S2) / 3
    expect(v2.value("moyenne_annuelle", { periodes: [{ moyenne: 12, poids: 1 }, { moyenne: 15, poids: 2 }] })).toBe(v1.value("moyenne_annuelle", { s1: 12, s2: 15, second_semestre: true }));
    // 3 trimestres de poids égaux
    expect(v2.value("moyenne_annuelle", { periodes: [{ moyenne: 10, poids: 1 }, { moyenne: 12, poids: 1 }, { moyenne: 14, poids: 1 }] })).toBe("12");
    // 4 périodes dont une non notée : ignorée
    expect(v2.value("moyenne_annuelle", { periodes: [{ moyenne: 10, poids: 1 }, { moyenne: null, poids: 1 }, { moyenne: 14, poids: 2 }, { moyenne: 16, poids: 2 }] })).toBe("14");
    // aucune période notée : absente
    expect(v2.value("moyenne_annuelle", { periodes: [{ moyenne: null, poids: 1 }, { moyenne: null, poids: 1 }] })).toBeNull();
  });

  it("v2 — décision de fin d'année sur la DERNIÈRE période (plus de « second semestre » deviné)", () => {
    expect(v2.value("decision_fin_annee", { moyenne: null, derniere_periode: true, examen_terminal_requis: false })).toBe("PENDING");
    expect(v2.value("decision_fin_annee", { moyenne: 11, derniere_periode: true, examen_terminal_requis: false })).toBe("PROMOTED");
    expect(v2.value("decision_fin_annee", { moyenne: 9, derniere_periode: true, examen_terminal_requis: false })).toBe("REPEAT");
    expect(v2.value("decision_fin_annee", { moyenne: 13, derniere_periode: true, examen_terminal_requis: true })).toBe("EXAM_REFERRAL");
  });

  it("les libellés des codes de suggestion sont exposés (préremplissage de l'appréciation)", () => {
    expect(v2.label("appreciation_conseil", "WORK_GOOD")).toBe("Bon travail.");
    expect(v2.label("decision_fin_annee", "EXAM_REFERRAL")).toMatch(/fictif/);
  });

  it("aucune règle d'orientation dans le jeu (la décision d'orientation est humaine)", () => {
    for (const run of [v1, v2]) expect(run.compiled.rules.some((r) => r.type === "orientation")).toBe(false);
  });
});
