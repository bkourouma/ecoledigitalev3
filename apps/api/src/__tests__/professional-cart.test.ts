import { computeOrderTotal } from "../services/professional-enrollment.service";
import { ProfessionalCartItemSchema } from "@ecoledigitale/contracts";

/**
 * Tests US2 — Panier & total de commande (feature 028, FR-016).
 */

describe("computeOrderTotal", () => {
  it("calcule la somme exacte des prix figés", () => {
    expect(computeOrderTotal([50000, 25000, 10000])).toBe(85000);
  });

  it("retourne 0 pour un panier vide", () => {
    expect(computeOrderTotal([])).toBe(0);
  });

  it("gère les prix renvoyés en chaîne par node-pg (numeric)", () => {
    expect(computeOrderTotal(["50000.50", "10000"])).toBe(60000.5);
  });
});

describe("ProfessionalCartItemSchema", () => {
  it("accepte un ue_session_id valide", () => {
    expect(
      ProfessionalCartItemSchema.safeParse({
        ue_session_id: "11111111-1111-1111-1111-111111111111",
      }).success
    ).toBe(true);
  });

  it("rejette un ue_session_id absent", () => {
    expect(ProfessionalCartItemSchema.safeParse({}).success).toBe(false);
  });

  it("rejette un ue_session_id non-UUID", () => {
    expect(ProfessionalCartItemSchema.safeParse({ ue_session_id: "abc" }).success).toBe(false);
  });
});
