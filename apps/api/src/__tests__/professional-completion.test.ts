import { evaluatePrerequisites } from "../services/professional-enrollment.service";

/**
 * Tests US4 — Achèvement débloquant les matières dépendantes (feature 028, FR-025).
 * L'achèvement d'une inscription ajoute la matière à l'ensemble « validées » ;
 * une matière dont tous les prérequis sont validés devient déverrouillée.
 */

const PREREQS = [
  { id: "A", code: "PRE-A", libelle: "Matière A" },
  { id: "B", code: "PRE-B", libelle: "Matière B" },
];

describe("evaluatePrerequisites (déverrouillage par achèvement)", () => {
  it("satisfait quand la matière n'a aucun prérequis", () => {
    const r = evaluatePrerequisites([], new Set());
    expect(r.satisfait).toBe(true);
    expect(r.manquants).toHaveLength(0);
  });

  it("verrouillée tant qu'un prérequis n'est pas terminé", () => {
    const r = evaluatePrerequisites(PREREQS, new Set(["A"]));
    expect(r.satisfait).toBe(false);
    expect(r.manquants.map((m: any) => m.id)).toEqual(["B"]);
  });

  it("déverrouillée une fois tous les prérequis terminés", () => {
    const r = evaluatePrerequisites(PREREQS, new Set(["A", "B"]));
    expect(r.satisfait).toBe(true);
    expect(r.manquants).toHaveLength(0);
  });

  it("logique ET : un seul prérequis manquant suffit à verrouiller", () => {
    const r = evaluatePrerequisites(PREREQS, new Set(["B"]));
    expect(r.satisfait).toBe(false);
    expect(r.manquants).toHaveLength(1);
  });
});
