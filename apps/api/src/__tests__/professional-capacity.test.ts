import { computeSessionCapacityStatus } from "../services/professional-enrollment.service";

/**
 * Tests US4 — Automatisation de capacité des sessions (feature 028, FR-026, SC-009).
 */

describe("computeSessionCapacityStatus", () => {
  it("passe à 'complet' quand la capacité est atteinte", () => {
    expect(computeSessionCapacityStatus("ouvert", 30, 30, true)).toBe("complet");
  });

  it("passe à 'complet' quand la capacité est dépassée", () => {
    expect(computeSessionCapacityStatus("ouvert", 30, 31, true)).toBe("complet");
  });

  it("reste inchangé tant qu'il reste des places", () => {
    expect(computeSessionCapacityStatus("ouvert", 30, 29, true)).toBeNull();
  });

  it("revient à 'ouvert' quand une place se libère dans la fenêtre", () => {
    expect(computeSessionCapacityStatus("complet", 30, 29, true)).toBe("ouvert");
  });

  it("ne revient pas à 'ouvert' hors de la fenêtre d'inscription", () => {
    expect(computeSessionCapacityStatus("complet", 30, 29, false)).toBeNull();
  });

  it("ne change jamais le statut d'une session à capacité illimitée (null)", () => {
    expect(computeSessionCapacityStatus("ouvert", null, 9999, true)).toBeNull();
  });

  it("aucune sur-réservation : 30/30 déclenche bien le passage à 'complet'", () => {
    expect(computeSessionCapacityStatus("ouvert", 30, 30, true)).not.toBeNull();
  });
});
