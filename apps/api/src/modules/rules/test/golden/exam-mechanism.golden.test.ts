/**
 * GOLDEN DE MÉCANISME — `CI-EXAM-PLACEHOLDER` (specs/v2/018-examinations/rule-contract.md §5, G1 à G14).
 *
 * Vérifie la plomberie (décimal exact, valeur absente, ex æquo, dénominateur nul), PAS la conformité réglementaire :
 * aucune épreuve, aucun coefficient, aucun seuil officiel. Valeurs fictives.
 */
import { describe, expect, it } from "vitest";
import { RuleRunner, compiledSeed } from "../support/runner";

const exam = new RuleRunner(compiledSeed("CI-EXAM-PLACEHOLDER"));
const epreuve = (n: number | null, coef: number, bareme: number, extra: { absent?: boolean; facultative?: boolean } = {}) => ({
  note: n,
  coef,
  bareme,
  facultative: extra.facultative ?? false,
  absent: extra.absent ?? false,
});

describe("CI-EXAM-PLACEHOLDER — golden de mécanisme", () => {
  it("la version est marquée `placeholder` (jamais `regulation`)", () => {
    expect(exam.compiled.version.source.kind).toBe("placeholder");
    expect(exam.compiled.version.contractId).toBe("exam-national@1");
  });

  it("G1 — note d'épreuve ramenée sur 20", () => {
    expect(exam.value("note_epreuve_sur_20", { note: 7, bareme: 10 })).toBe("14");
    expect(exam.value("note_epreuve_sur_20", { note: 15, bareme: 20 })).toBe("15");
  });

  it("G2 — moyenne pondérée NON arrondie (14,666…) puis 14,67 à l'affichage", () => {
    const moyenne = exam.value("moyenne_candidat", { epreuves: [epreuve(14, 2, 20), epreuve(8, 1, 10)] });
    expect(moyenne).toMatch(/^14\.6666666666/);
    expect(exam.value("arrondi_affichage", { valeur: moyenne })).toBe("14.67");
  });

  it("G3 — épreuve absente et `absence_vaut_zero = 0` : ignorée", () => {
    expect(exam.value("moyenne_candidat", { epreuves: [epreuve(14, 2, 20), epreuve(null, 1, 20, { absent: true })] })).toBe("14");
  });

  it("G4 — `absence_vaut_zero = 1` : l'absente compte 0", () => {
    const r = exam.result("moyenne_candidat", { epreuves: [epreuve(15, 2, 20), epreuve(null, 1, 20, { absent: true })] }, { absence_vaut_zero: 1 });
    expect(r.ok && r.value.value).toBe("10");
  });

  it("G5 — aucune épreuve notée : absente", () => {
    expect(exam.value("moyenne_candidat", { epreuves: [epreuve(null, 2, 20, { absent: true }), epreuve(null, 1, 20)] })).toBeNull();
    expect(exam.value("moyenne_candidat", { epreuves: [] })).toBeNull();
  });

  it("G6 — seuil exact : 10 admis, 9,99 ajourné, sans moyenne absent", () => {
    expect(exam.value("resultat_candidat", { moyenne: 10, epreuves_absentes: 0, epreuves_eliminatoires_echouees: 0 })).toBe("ADMITTED");
    expect(exam.value("resultat_candidat", { moyenne: "9.99", epreuves_absentes: 0, epreuves_eliminatoires_echouees: 0 })).toBe("FAILED");
    expect(exam.value("resultat_candidat", { moyenne: null, epreuves_absentes: 2, epreuves_eliminatoires_echouees: 0 })).toBe("ABSENT");
  });

  it("G7 — épreuve éliminatoire échouée : ajourné malgré une bonne moyenne", () => {
    expect(exam.value("resultat_candidat", { moyenne: 15, epreuves_absentes: 0, epreuves_eliminatoires_echouees: 1 })).toBe("FAILED");
  });

  it("G8 — rang de compétition", () => {
    const cohorte = [14, 14, 9, null];
    expect(exam.value("rang_candidat", { moyenne: 14, cohorte })).toBe("1");
    expect(exam.value("rang_candidat", { moyenne: 9, cohorte })).toBe("3");
    expect(exam.value("rang_candidat", { moyenne: null, cohorte })).toBeNull();
  });

  it("G9 — taux de réussite : 75 sur les présents, 60 sur les inscrits", () => {
    const vars = { admis: 3, presents: 4, inscrits: 5 };
    expect(exam.value("taux_reussite", vars)).toBe("75");
    const sur = exam.result("taux_reussite", vars, { denominateur: 0 });
    expect(sur.ok && sur.value.value).toBe("60");
  });

  it("G10 — taux de réussite sans présent : absent (jamais d'erreur ni 100 %)", () => {
    expect(exam.value("taux_reussite", { admis: 0, presents: 0, inscrits: 5 })).toBeNull();
    const sur = exam.result("taux_reussite", { admis: 0, presents: 0, inscrits: 0 }, { denominateur: 0 });
    expect(sur.ok && sur.value.value).toBeNull();
  });

  it("G11 — éligibilité : hors classe d'examen, dossier incomplet, éligible", () => {
    const base = { age_annees: null, annee_session: 2026, nombre_tentatives: 0 };
    expect(exam.value("eligibilite", { ...base, en_classe_examen: false, pieces_completes: true })).toBe("INELIGIBLE");
    expect(exam.value("eligibilite", { ...base, en_classe_examen: true, pieces_completes: false })).toBe("NEEDS_REVIEW");
    expect(exam.value("eligibilite", { ...base, en_classe_examen: true, pieces_completes: true })).toBe("ELIGIBLE");
  });

  it("G12 — motif d'éligibilité des mêmes cas", () => {
    const base = { age_annees: 12, annee_session: 2026, nombre_tentatives: 1 };
    expect(exam.value("motif_eligibilite", { ...base, en_classe_examen: false, pieces_completes: true })).toBe("NOT_IN_EXAM_GRADE");
    expect(exam.value("motif_eligibilite", { ...base, en_classe_examen: true, pieces_completes: false })).toBe("DOCUMENTS_MISSING");
    expect(exam.value("motif_eligibilite", { ...base, en_classe_examen: true, pieces_completes: true })).toBe("NONE");
  });

  it("G13 — reproductibilité : mêmes entrées, même version ⇒ mêmes empreintes", () => {
    const run = () => exam.result("resultat_candidat", { moyenne: 12, epreuves_absentes: 0, epreuves_eliminatoires_echouees: 0 });
    const a = run();
    const b = run();
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.inputsHash).toBe(b.value.inputsHash);
      expect(a.value.outputsHash).toBe(b.value.outputsHash);
    }
  });

  it("G14 — décimal exact : 9,9/20 et 10,1/20 donnent 10, admis (pas 9,999…)", () => {
    const moyenne = exam.value("moyenne_candidat", { epreuves: [{ note: "9.9", coef: 1, bareme: 20, facultative: false, absent: false }, { note: "10.1", coef: 1, bareme: 20, facultative: false, absent: false }] });
    expect(moyenne).toBe("10");
    expect(exam.value("resultat_candidat", { moyenne, epreuves_absentes: 0, epreuves_eliminatoires_echouees: 0 })).toBe("ADMITTED");
  });
});
