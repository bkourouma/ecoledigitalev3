import { ECUE_VALIDATION_THRESHOLD } from "../services/professional-results.service";
import {
  ValidateProfessionalEcueResultSchema,
  ProfessionalEcueResultSchema,
  StudentProfessionalUeResultSchema,
  ProfessionalUeEcueInputSchema,
} from "@ecoledigitale/contracts";

/**
 * Tests — Résultats ECUE & validation UE (feature 030, FR-040/FR-041).
 * Seuil de validation figé (10/20) + contrats de validation/résultat.
 */

describe("ECUE_VALIDATION_THRESHOLD", () => {
  it("est figé à 10/20", () => {
    expect(ECUE_VALIDATION_THRESHOLD).toBe(10);
  });

  it("auto-validation : moyenne >= seuil valide l'ECUE", () => {
    const valide = (moyenne: number) => moyenne >= ECUE_VALIDATION_THRESHOLD;
    expect(valide(10)).toBe(true);
    expect(valide(12.5)).toBe(true);
    expect(valide(9.99)).toBe(false);
  });
});

describe("ValidateProfessionalEcueResultSchema (override manuel)", () => {
  it("accepte validee=true (override)", () => {
    expect(ValidateProfessionalEcueResultSchema.safeParse({ validee: true }).success).toBe(true);
  });

  it("accepte validee=false (invalidation)", () => {
    expect(ValidateProfessionalEcueResultSchema.safeParse({ validee: false }).success).toBe(true);
  });

  it("rejette une valeur non booléenne", () => {
    expect(ValidateProfessionalEcueResultSchema.safeParse({ validee: "oui" }).success).toBe(false);
  });
});

describe("ProfessionalEcueResultSchema", () => {
  it("accepte un résultat avec moyenne nulle (non encore noté)", () => {
    const r = ProfessionalEcueResultSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      tenant_id: "22222222-2222-2222-2222-222222222222",
      ecue_id: "33333333-3333-3333-3333-333333333333",
      student_id: "44444444-4444-4444-4444-444444444444",
      ue_session_id: "55555555-5555-5555-5555-555555555555",
      moyenne: null,
      validee: false,
      validee_manuellement: false,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });
});

describe("StudentProfessionalUeResultSchema (capitalisation UV)", () => {
  it("accepte une UE validée avec UV acquises", () => {
    const r = StudentProfessionalUeResultSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      tenant_id: "22222222-2222-2222-2222-222222222222",
      ue_id: "33333333-3333-3333-3333-333333333333",
      student_id: "44444444-4444-4444-4444-444444444444",
      statut: "validee",
      uv_acquises: 4,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejette un statut hors enum", () => {
    expect(
      StudentProfessionalUeResultSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        tenant_id: "22222222-2222-2222-2222-222222222222",
        ue_id: "33333333-3333-3333-3333-333333333333",
        student_id: "44444444-4444-4444-4444-444444444444",
        statut: "obtenu",
        uv_acquises: 0,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      }).success
    ).toBe(false);
  });
});

describe("ProfessionalUeEcueInputSchema (composition / mutualisation)", () => {
  it("applique les défauts est_obligatoire=true, coefficient=1, ordre=0", () => {
    const parsed = ProfessionalUeEcueInputSchema.parse({
      ecue_id: "33333333-3333-3333-3333-333333333333",
    });
    expect(parsed.est_obligatoire).toBe(true);
    expect(parsed.coefficient).toBe(1);
    expect(parsed.ordre).toBe(0);
  });

  it("rejette un coefficient <= 0", () => {
    expect(
      ProfessionalUeEcueInputSchema.safeParse({
        ecue_id: "33333333-3333-3333-3333-333333333333",
        coefficient: 0,
      }).success
    ).toBe(false);
  });
});
