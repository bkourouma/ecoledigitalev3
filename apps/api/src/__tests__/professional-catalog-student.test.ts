import {
  ProfessionalCatalogItemSchema,
  ProfessionalFiliereOptionSchema,
} from "@ecoledigitale/contracts";

/**
 * Tests — Contrats du catalogue étudiant (feature 030, FR-006).
 * Catalogue Filière → UE → ECUE.
 */

describe("ProfessionalFiliereOptionSchema", () => {
  it("accepte une option de filière valide", () => {
    expect(
      ProfessionalFiliereOptionSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        name: "BTS Comptabilité-Gestion",
        code: "BTS-CG",
        nb_ue_inscriptibles: 4,
      }).success
    ).toBe(true);
  });
});

describe("ProfessionalCatalogItemSchema", () => {
  const item = {
    ue: {
      id: "11111111-1111-1111-1111-111111111111",
      code: "UE-A",
      libelle: "Comptabilité et gestion",
      nb_uv: 3,
      prix: 50000,
      devise: "XOF",
      filiere_id: "22222222-2222-2222-2222-222222222222",
    },
    ecue: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        code: "ECUE-A1",
        libelle: "Comptabilité analytique",
        est_obligatoire: true,
        coefficient: 1,
        ordre: 0,
      },
    ],
    sessions: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        libelle: "Cohorte Janvier 2026",
        date_debut: "2026-01-10",
        date_fin: "2026-03-10",
        inscription_ouverte_le: "2026-01-01T00:00:00.000Z",
        inscription_fermee_le: "2026-01-09T00:00:00.000Z",
        capacite_max: 30,
        places_restantes: 12,
        statut: "ouvert",
        inscriptible: true,
      },
    ],
    prerequisites_status: {
      satisfait: false,
      manquants: [
        { id: "44444444-4444-4444-4444-444444444444", code: "UE-PRE-1", libelle: "Prérequis" },
      ],
    },
    verrouille: true,
  };

  it("accepte un item de catalogue complet (UE + ECUE + cohortes)", () => {
    expect(ProfessionalCatalogItemSchema.safeParse(item).success).toBe(true);
  });

  it("reflète le verrouillage par prérequis UE manquant", () => {
    const r = ProfessionalCatalogItemSchema.safeParse(item);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.verrouille).toBe(true);
      expect(r.data.prerequisites_status.satisfait).toBe(false);
      expect(r.data.prerequisites_status.manquants).toHaveLength(1);
    }
  });

  it("accepte une capacité illimitée (capacite_max null)", () => {
    const unlimited = {
      ...item,
      sessions: [{ ...item.sessions[0], capacite_max: null, places_restantes: null }],
    };
    expect(ProfessionalCatalogItemSchema.safeParse(unlimited).success).toBe(true);
  });
});
