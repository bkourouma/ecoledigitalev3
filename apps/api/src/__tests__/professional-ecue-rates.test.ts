import { EcueRateIndex } from "../services/professional-ecue-rates.service";
import {
  CreateProfessionalEcueHourlyRateSchema,
  EcueRateOriginSchema,
} from "@ecoledigitale/contracts";

/**
 * Tests — résolution des tarifs horaires ECUE (feature 031, US3/FR-012).
 *
 * L'ordre de résolution décide du montant payé : un tarif générique qui
 * l'emporterait sur un tarif nominatif ferait silencieusement sous-payer un
 * intervenant.
 */

const ECUE = "ecue-1";
const TEACHER = "teacher-1";

function rate(over: Record<string, any> = {}) {
  return {
    id: "r1",
    ecue_id: ECUE,
    enseignant_id: null,
    montant_horaire: 12000,
    devise: "XOF",
    valide_du: "2026-01-01",
    valide_au: null,
    ...over,
  };
}

describe("EcueRateIndex — ordre de résolution", () => {
  it("le tarif nominatif l'emporte sur le générique", () => {
    const index = new EcueRateIndex([
      rate({ id: "generique", montant_horaire: 12000, enseignant_id: null }),
      rate({ id: "nominatif", montant_horaire: 18000, enseignant_id: TEACHER }),
    ]);

    const hit = index.find(ECUE, TEACHER, "2026-07-06");
    expect(hit?.montant_horaire).toBe(18000);
    expect(hit?.origine).toBe("ecue_enseignant");
    expect(hit?.rate_id).toBe("nominatif");
  });

  it("retombe sur le tarif générique quand aucun nominatif n'existe", () => {
    const index = new EcueRateIndex([rate({ id: "generique", enseignant_id: null })]);

    const hit = index.find(ECUE, TEACHER, "2026-07-06");
    expect(hit?.montant_horaire).toBe(12000);
    expect(hit?.origine).toBe("ecue_generique");
  });

  it("le tarif nominatif d'un AUTRE enseignant ne s'applique pas", () => {
    const index = new EcueRateIndex([
      rate({ id: "autre", montant_horaire: 30000, enseignant_id: "teacher-2" }),
    ]);

    expect(index.find(ECUE, TEACHER, "2026-07-06")).toBeNull();
  });

  it("ne renvoie rien pour une ECUE sans tarif (le repli est au calculateur)", () => {
    const index = new EcueRateIndex([rate()]);
    expect(index.find("ecue-inconnue", TEACHER, "2026-07-06")).toBeNull();
  });
});

describe("EcueRateIndex — plage de validité", () => {
  it("ignore un tarif qui n'a pas encore commencé", () => {
    const index = new EcueRateIndex([rate({ valide_du: "2026-09-01" })]);
    expect(index.find(ECUE, TEACHER, "2026-07-06")).toBeNull();
  });

  it("ignore un tarif expiré", () => {
    const index = new EcueRateIndex([rate({ valide_du: "2026-01-01", valide_au: "2026-06-30" })]);
    expect(index.find(ECUE, TEACHER, "2026-07-06")).toBeNull();
  });

  it("inclut les bornes de la plage", () => {
    const index = new EcueRateIndex([rate({ valide_du: "2026-07-06", valide_au: "2026-07-06" })]);
    expect(index.find(ECUE, TEACHER, "2026-07-06")?.montant_horaire).toBe(12000);
  });

  it("un tarif sans date de fin reste applicable", () => {
    const index = new EcueRateIndex([rate({ valide_du: "2026-01-01", valide_au: null })]);
    expect(index.find(ECUE, TEACHER, "2030-01-01")?.montant_horaire).toBe(12000);
  });

  it("entre deux tarifs successifs, retient celui qui couvre la date", () => {
    const index = new EcueRateIndex([
      rate({ id: "ancien", montant_horaire: 10000, valide_du: "2026-01-01", valide_au: "2026-06-30" }),
      rate({ id: "nouveau", montant_horaire: 15000, valide_du: "2026-07-01", valide_au: null }),
    ]);

    expect(index.find(ECUE, TEACHER, "2026-03-15")?.montant_horaire).toBe(10000);
    expect(index.find(ECUE, TEACHER, "2026-07-06")?.montant_horaire).toBe(15000);
  });
});

describe("Contrat de création d'un tarif", () => {
  it("accepte un tarif générique (sans enseignant)", () => {
    const parsed = CreateProfessionalEcueHourlyRateSchema.safeParse({
      ecue_id: "11111111-1111-1111-1111-111111111111",
      montant_horaire: 12000,
      valide_du: "2026-07-01",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse un montant négatif", () => {
    const parsed = CreateProfessionalEcueHourlyRateSchema.safeParse({
      ecue_id: "11111111-1111-1111-1111-111111111111",
      montant_horaire: -1,
      valide_du: "2026-07-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuse une date mal formée", () => {
    const parsed = CreateProfessionalEcueHourlyRateSchema.safeParse({
      ecue_id: "11111111-1111-1111-1111-111111111111",
      montant_horaire: 12000,
      valide_du: "01/07/2026",
    });
    expect(parsed.success).toBe(false);
  });

  it("les trois origines de résolution sont contractualisées", () => {
    for (const o of ["ecue_enseignant", "ecue_generique", "config_defaut"]) {
      expect(EcueRateOriginSchema.safeParse(o).success).toBe(true);
    }
  });
});
