import { CreateProfessionalPaymentSchema } from "@ecoledigitale/contracts";

/**
 * Tests US2 — Contrat de paiement (feature 028).
 * L'idempotence du paiement (rejeu de `reference_transaction`) relève de la
 * base et est couverte par le smoke test de quickstart.md (T053).
 */

describe("CreateProfessionalPaymentSchema", () => {
  it("accepte un paiement avec mode et référence de transaction", () => {
    expect(
      CreateProfessionalPaymentSchema.safeParse({
        mode: "mobile_money",
        reference_transaction: "TX-001",
      }).success
    ).toBe(true);
  });

  it("accepte un paiement sans référence (optionnelle)", () => {
    expect(CreateProfessionalPaymentSchema.safeParse({ mode: "especes" }).success).toBe(true);
  });

  it("rejette un mode de paiement inconnu", () => {
    expect(CreateProfessionalPaymentSchema.safeParse({ mode: "bitcoin" }).success).toBe(false);
  });

  it("rejette un paiement sans mode", () => {
    expect(CreateProfessionalPaymentSchema.safeParse({}).success).toBe(false);
  });

  it("accepte les 4 modes supportés", () => {
    for (const mode of ["especes", "mobile_money", "virement", "autre"]) {
      expect(CreateProfessionalPaymentSchema.safeParse({ mode }).success).toBe(true);
    }
  });
});
