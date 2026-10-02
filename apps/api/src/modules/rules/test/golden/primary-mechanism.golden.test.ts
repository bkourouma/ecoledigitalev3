/**
 * GOLDEN DE MÉCANISME — `CI-PRIMARY-PLACEHOLDER` (specs/v2/005-primary/rule-contract.md §4, G1 à G18).
 *
 * Ces tests vérifient la PLOMBERIE (décimal exact, valeur absente, ex æquo, chaînage, reproductibilité), PAS la conformité
 * réglementaire : toutes les valeurs sont fictives. Un écart avec la table de la spec est un défaut de l'une ou de l'autre,
 * jamais une « règle ». Les sorties viennent UNIQUEMENT de l'évaluation des règles du jeu (aucune formule ici).
 */
import { describe, expect, it } from "vitest";
import { RuleRunner, compiledSeed } from "../support/runner";

const coef = new RuleRunner(compiledSeed("CI-PRIMARY-PLACEHOLDER"));
const competency = new RuleRunner(compiledSeed("CI-PRIMARY-PLACEHOLDER", undefined, 2));

const note = (n: number, bareme: number, poids = 1) => ({ note: n, bareme, poids, type: "DEVOIR" });

describe("CI-PRIMARY-PLACEHOLDER — golden de mécanisme", () => {
  it("la version est marquée `placeholder` et porte la référence du jeu de démonstration", () => {
    expect(coef.compiled.version.source.kind).toBe("placeholder");
    expect(coef.compiled.version.source.reference).toMatch(/démonstration/);
    expect(competency.compiled.version.source.kind).toBe("placeholder");
  });

  it("G1 — moyenne de matière sur deux notes", () => {
    expect(coef.value("moyenne_matiere", { notes: [note(12, 20), note(15, 20)] })).toBe("13.5");
  });

  it("G2 — barèmes différents et poids différents : (16×2 + 10×1)/3 = 14", () => {
    expect(coef.value("moyenne_matiere", { notes: [note(8, 10, 2), note(10, 20, 1)] })).toBe("14");
  });

  it("G3 — aucune note : absente, jamais 0", () => {
    expect(coef.value("moyenne_matiere", { notes: [] })).toBeNull();
  });

  it("G4 — une matière sans score est ignorée (ni 0, ni coefficient compté)", () => {
    expect(coef.value("moyenne_periode", { matieres: [{ score: null, coef: 2 }, { score: 14, coef: 1 }] })).toBe("14");
  });

  it("G5 — moyenne générale annuelle : une période non notée est ignorée", () => {
    expect(coef.value("moyenne_generale_annuelle", { periodes: [{ moyenne: 12, poids: 1 }, { moyenne: null, poids: 1 }, { moyenne: 14, poids: 1 }] })).toBe("13");
  });

  it("G6 — moyenne annuelle pondérée NON arrondie, puis arrondi d'affichage seulement", () => {
    const mga = coef.value("moyenne_generale_annuelle", { periodes: [{ moyenne: 12, poids: 1 }, { moyenne: 14, poids: 2 }] });
    expect(mga).toMatch(/^13\.3333333333/);
    expect(coef.value("arrondi_affichage", { valeur: mga })).toBe("13.33");
  });

  it("G7 — arrondi demi-supérieur décimal exact", () => {
    expect(coef.value("arrondi_affichage", { valeur: "13.335" })).toBe("13.34");
    expect(coef.value("arrondi_affichage", { valeur: "13.325" })).toBe("13.33");
  });

  it("G8 — 9,9/20 et 10,1/20 donnent exactement 10 (pas 9,999…) ; avec mga = 10, cas limite ⇒ COUNCIL_REVIEW", () => {
    const moyenne = coef.value("moyenne_matiere", { notes: [{ note: "9.9", bareme: 20, poids: 1, type: "DEVOIR" }, { note: "10.1", bareme: 20, poids: 1, type: "DEVOIR" }] });
    expect(moyenne).toBe("10");
    const limite = coef.bool("cas_limite", { mga: moyenne });
    expect(limite).toBe(true);
    const examen = coef.bool("cas_a_examiner", { limite, absences: false, redoublant: false });
    expect(coef.value("decision_fin_annee", { mga: moyenne, periodes_notees: 3, periodes_attendues: 3, cas_examen: examen })).toBe("COUNCIL_REVIEW");
  });

  it("G9 — rang de compétition (ex æquo, rang suivant sauté, absent sans rang)", () => {
    const cohorte = [15, 15, 12, null];
    expect(coef.value("rang_periode", { moyenne: 15, cohorte })).toBe("1");
    expect(coef.value("rang_periode", { moyenne: 12, cohorte })).toBe("3");
    expect(coef.value("rang_periode", { moyenne: null, cohorte })).toBeNull();
    expect(coef.value("rang_matiere", { moyenne: 15, cohorte })).toBe("1");
    expect(coef.value("rang_annuel", { moyenne: 12, cohorte })).toBe("3");
  });

  it("G10 — passage au-dessus du seuil", () => {
    expect(coef.value("decision_fin_annee", { mga: 11.2, periodes_notees: 3, periodes_attendues: 3, cas_examen: false })).toBe("PROMOTED");
  });

  it("G11 — redoublement sous le seuil", () => {
    expect(coef.value("decision_fin_annee", { mga: 7, periodes_notees: 3, periodes_attendues: 3, cas_examen: false })).toBe("REPEAT");
  });

  it("G12 — en attente : moyenne absente, ou périodes notées insuffisantes", () => {
    expect(coef.value("decision_fin_annee", { mga: null, periodes_notees: 3, periodes_attendues: 3, cas_examen: false })).toBe("PENDING");
    expect(coef.value("decision_fin_annee", { mga: 12, periodes_notees: 2, periodes_attendues: 3, cas_examen: false })).toBe("PENDING");
  });

  it("G13 — absences : 20 % non dépassé, 25 % dépassé (aucune division)", () => {
    expect(coef.bool("cas_absences", { absences_journees: 4, jours_ouverts: 20 })).toBe(false);
    expect(coef.bool("cas_absences", { absences_journees: 5, jours_ouverts: 20 })).toBe(true);
    expect(coef.bool("cas_absences", { absences_journees: 3, jours_ouverts: 0 })).toBe(false);
  });

  it("G14 — dossier à examiner", () => {
    expect(coef.bool("cas_a_examiner", { limite: false, absences: false, redoublant: true })).toBe(true);
    expect(coef.bool("cas_a_examiner", { limite: false, absences: false, redoublant: false })).toBe(false);
    expect(coef.bool("cas_deja_redoublant", { redoublements_cycle: 1 })).toBe(true);
    expect(coef.bool("cas_deja_redoublant", { redoublements_cycle: 0 })).toBe(false);
  });

  it("G15 — quorum du conseil : 3 sur 6 atteint, 2 sur 6 non", () => {
    expect(coef.bool("quorum_conseil", { convoques: 6, presents: 3 })).toBe(true);
    expect(coef.bool("quorum_conseil", { convoques: 6, presents: 2 })).toBe(false);
    expect(coef.bool("quorum_conseil", { convoques: 0, presents: 0 })).toBe(false);
    expect(competency.bool("quorum_conseil", { convoques: 6, presents: 3 })).toBe(true);
  });

  it("G16 — maternelle : 20/20 ⇒ COUNCIL_REVIEW ; 18/20 ⇒ PENDING (la règle ne décide jamais seule)", () => {
    expect(competency.value("decision_fin_annee", { competences_evaluees: 20, competences_attendues: 20, redoublements_cycle: 0 })).toBe("COUNCIL_REVIEW");
    expect(competency.value("decision_fin_annee", { competences_evaluees: 18, competences_attendues: 20, redoublements_cycle: 0 })).toBe("PENDING");
  });

  it("G17 — chaînage d'un élève sans aucune note : tout est absent, jamais une erreur, jamais 0", () => {
    const matiere = coef.value("moyenne_matiere", { notes: [] });
    expect(matiere).toBeNull();
    const periode = coef.value("moyenne_periode", { matieres: [{ score: matiere, coef: 2 }, { score: matiere, coef: 1 }] });
    expect(periode).toBeNull();
    expect(coef.value("rang_periode", { moyenne: periode, cohorte: [periode, 12] })).toBeNull();
    const mga = coef.value("moyenne_generale_annuelle", { periodes: [{ moyenne: periode, poids: 1 }, { moyenne: null, poids: 1 }] });
    expect(mga).toBeNull();
    expect(coef.bool("cas_limite", { mga })).toBe(false);
    expect(coef.value("decision_fin_annee", { mga, periodes_notees: 0, periodes_attendues: 3, cas_examen: false })).toBe("PENDING");
  });

  it("G18 — reproductibilité : mêmes entrées, même version ⇒ mêmes inputs_hash et outputs_hash", () => {
    const run = () => coef.result("moyenne_matiere", { notes: [note(12, 20), note(15, 20)] });
    const a = run();
    const b = run();
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.inputsHash).toBe(b.value.inputsHash);
      expect(a.value.outputsHash).toBe(b.value.outputsHash);
      expect(a.value.definitionHash).toBe(coef.compiled.definitionHash);
    }
    const other = coef.result("moyenne_matiere", { notes: [note(12, 20), note(16, 20)] });
    if (a.ok && other.ok) expect(other.value.inputsHash).not.toBe(a.value.inputsHash);
  });

  it("les paramètres du jeu fictif sont ceux de la spec (§1.5), tous bornés", () => {
    expect(coef.param("cas_limite", "seuil_passage")).toBe(10);
    expect(coef.param("cas_limite", "marge_conseil")).toBe(1);
    expect(coef.param("cas_absences", "pourcentage_absences")).toBe(20);
    expect(coef.param("cas_deja_redoublant", "redoublements_alerte")).toBe(1);
    expect(coef.param("quorum_conseil", "quorum_pourcent")).toBe(50);
    expect(coef.param("arrondi_affichage", "decimales")).toBe(2);
    for (const r of coef.compiled.rules) {
      for (const [name, spec] of Object.entries(r.parameters)) {
        if (spec.type === "number") expect(spec.min !== undefined && spec.max !== undefined, `${r.key}.${name}`).toBe(true);
      }
    }
  });

  it("une surcharge de paramètre bornée change la décision sans nouveau code (seuil 12)", () => {
    const r = coef.result("decision_fin_annee", { mga: 11.2, periodes_notees: 3, periodes_attendues: 3, cas_examen: false }, { seuil_passage: 12 });
    expect(r.ok && r.value.value).toBe("REPEAT");
  });
});
