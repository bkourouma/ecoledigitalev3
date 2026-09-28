import { commissionDue } from "../services/prospection.service";

/**
 * Commission d'un commercial — taux figé sur la provenance de l'étudiant,
 * appliqué aux frais de scolarité CONFIRMÉS (migration 0120).
 */

describe("commissionDue", () => {
  it("applique le taux aux frais de scolarité encaissés", () => {
    expect(commissionDue(150_000, 5)).toBe(7_500);
    expect(commissionDue(1_200_000, 7.5)).toBe(90_000);
  });

  it("arrondit à l'unité — le franc CFA n'a pas de subdivision", () => {
    expect(commissionDue(33_333, 5)).toBe(1_667);
  });

  it("ne doit rien tant que l'étudiant n'a rien versé", () => {
    expect(commissionDue(0, 5)).toBe(0);
  });

  it("ne doit rien hors canal commercial — le taux est alors absent", () => {
    expect(commissionDue(500_000, null)).toBe(0);
    expect(commissionDue(500_000, undefined)).toBe(0);
  });

  it("traite un taux nul comme une absence de commission", () => {
    expect(commissionDue(500_000, 0)).toBe(0);
  });

  it("ne renvoie jamais NaN sur une valeur non numérique", () => {
    expect(commissionDue(Number.NaN, 5)).toBe(0);
    expect(commissionDue(500_000, Number.NaN)).toBe(0);
  });

  it("ignore un remboursement qui rendrait le total négatif", () => {
    expect(commissionDue(-10_000, 5)).toBe(0);
  });
});
