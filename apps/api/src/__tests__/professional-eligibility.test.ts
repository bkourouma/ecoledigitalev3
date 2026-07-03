import {
  evaluateSessionEligibility,
  type EligibilityInput,
} from "../services/professional-enrollment.service";

/**
 * Tests US2 — Éligibilité serveur à une session (feature 028, FR-012).
 */

const NOW = new Date("2026-02-01T12:00:00.000Z");

function base(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    sessionStatut: "ouvert",
    inscriptionOuverteLe: "2026-01-01T00:00:00.000Z",
    inscriptionFermeeLe: "2026-03-01T00:00:00.000Z",
    capaciteMax: 30,
    activeEnrollmentCount: 5,
    studentAlreadyEnrolled: false,
    prerequisitesSatisfied: true,
    now: NOW,
    ...overrides,
  };
}

describe("evaluateSessionEligibility", () => {
  it("est éligible dans le cas nominal", () => {
    expect(evaluateSessionEligibility(base()).eligible).toBe(true);
  });

  it("refuse une session non ouverte", () => {
    const r = evaluateSessionEligibility(base({ sessionStatut: "brouillon" }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("SESSION_NOT_ENROLLABLE");
  });

  it("refuse une inscription avant l'ouverture de la fenêtre", () => {
    const r = evaluateSessionEligibility(base({ now: new Date("2025-12-15T00:00:00.000Z") }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("SESSION_NOT_ENROLLABLE");
  });

  it("refuse une inscription après la fermeture de la fenêtre", () => {
    const r = evaluateSessionEligibility(base({ now: new Date("2026-04-01T00:00:00.000Z") }));
    expect(r.eligible).toBe(false);
  });

  it("refuse une session complète", () => {
    const r = evaluateSessionEligibility(base({ capaciteMax: 30, activeEnrollmentCount: 30 }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("SESSION_FULL");
  });

  it("accepte une capacité illimitée (null)", () => {
    expect(
      evaluateSessionEligibility(base({ capaciteMax: null, activeEnrollmentCount: 999 })).eligible
    ).toBe(true);
  });

  it("refuse une double inscription", () => {
    const r = evaluateSessionEligibility(base({ studentAlreadyEnrolled: true }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("DUPLICATE_ENROLLMENT");
  });

  it("refuse si les prérequis ne sont pas satisfaits", () => {
    const r = evaluateSessionEligibility(base({ prerequisitesSatisfied: false }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("UE_PREREQ_NOT_VALIDATED");
  });
});
