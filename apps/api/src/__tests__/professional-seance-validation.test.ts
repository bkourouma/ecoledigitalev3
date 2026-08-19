import {
  SEANCE_PAYABLE_PREDICATE,
  computeBlockers,
} from "../services/professional-seance-validation.service";
import {
  ProfessionalSeanceStatutSchema,
  ValidateProfessionalSeancesSchema,
  SeanceBlockerSchema,
} from "@ecoledigitale/contracts";

/**
 * Tests — validation des séances pour la paie (feature 031, US1).
 *
 * La payabilité est la garde qui empêche de payer le PLANNING. Chacune de ses
 * quatre conditions est vérifiée séparément : en oublier une revient à payer
 * des séances qui n'ont pas eu lieu.
 */

function row(over: Record<string, any> = {}) {
  return {
    statut: "realisee",
    validated_at: "2026-07-10T09:00:00.000Z",
    enseignant_id: "teacher-1",
    heure_debut: "08:00:00",
    heure_fin: "10:00:00",
    ...over,
  };
}

describe("Prédicat de payabilité (SQL)", () => {
  it("exige les quatre conditions de FR-003", () => {
    // Les espaces sont normalisés : l'assertion porte sur les conditions, pas
    // sur l'alignement du SQL — une simple reindentation ne doit pas faire
    // échouer le garde-fou du prédicat.
    const sql = SEANCE_PAYABLE_PREDICATE.replace(/\s+/g, " ");
    expect(sql).toContain("se.statut = 'realisee'");
    expect(sql).toContain("se.validated_at IS NOT NULL");
    expect(sql).toContain("se.enseignant_id IS NOT NULL");
    // La durée doit être connue : soit une dérogation comptable, soit des
    // horaires complets. C'est une alternative, pas deux exigences.
    expect(sql).toContain("se.duree_payee IS NOT NULL");
    expect(sql).toContain("se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL");
  });

  it("n'accepte jamais le statut planifiee ni annulee", () => {
    expect(SEANCE_PAYABLE_PREDICATE).not.toContain("planifiee");
    expect(SEANCE_PAYABLE_PREDICATE).not.toContain("annulee");
  });
});

describe("computeBlockers — motifs de non-payabilité", () => {
  it("une séance complète et validée n'a aucun bloqueur", () => {
    expect(computeBlockers(row())).toEqual([]);
  });

  it("une séance planifiée n'est pas payable", () => {
    expect(computeBlockers(row({ statut: "planifiee" }))).toContain("STATUT_NON_REALISEE");
  });

  it("une séance annulée n'est pas payable", () => {
    expect(computeBlockers(row({ statut: "annulee" }))).toContain("STATUT_NON_REALISEE");
  });

  it("une séance réalisée mais non validée n'est pas payable", () => {
    expect(computeBlockers(row({ validated_at: null }))).toEqual(["NON_VALIDEE"]);
  });

  it("une séance sans enseignant n'est pas payable (aucun bénéficiaire)", () => {
    expect(computeBlockers(row({ enseignant_id: null }))).toContain("SANS_ENSEIGNANT");
  });

  it("une séance sans horaires n'est pas payable (durée indéterminable)", () => {
    expect(computeBlockers(row({ heure_fin: null }))).toContain("HORAIRES_INCOMPLETS");
    expect(computeBlockers(row({ heure_debut: null }))).toContain("HORAIRES_INCOMPLETS");
  });

  it("cumule les motifs quand plusieurs conditions manquent", () => {
    const blockers = computeBlockers(
      row({ statut: "planifiee", validated_at: null, enseignant_id: null, heure_fin: null })
    );
    expect(blockers).toEqual([
      "STATUT_NON_REALISEE",
      "NON_VALIDEE",
      "SANS_ENSEIGNANT",
      "HORAIRES_INCOMPLETS",
    ]);
  });
});

describe("Contrats de validation", () => {
  it("le statut n'accepte que les trois valeurs du cycle de vie", () => {
    expect(ProfessionalSeanceStatutSchema.safeParse("realisee").success).toBe(true);
    expect(ProfessionalSeanceStatutSchema.safeParse("planifiee").success).toBe(true);
    expect(ProfessionalSeanceStatutSchema.safeParse("annulee").success).toBe(true);
    expect(ProfessionalSeanceStatutSchema.safeParse("validee").success).toBe(false);
  });

  it("la validation en lot exige au moins une séance", () => {
    expect(
      ValidateProfessionalSeancesSchema.safeParse({ seanceIds: [], validated: true }).success
    ).toBe(false);
  });

  it("la validation en lot est plafonnée pour éviter une requête ingérable", () => {
    const trop = Array.from({ length: 501 }, () => "11111111-1111-1111-1111-111111111111");
    expect(ValidateProfessionalSeancesSchema.safeParse({ seanceIds: trop, validated: true }).success).toBe(
      false
    );
  });

  it("DEJA_PAYEE fait partie des motifs de rejet (verrou FR-006)", () => {
    expect(SeanceBlockerSchema.safeParse("DEJA_PAYEE").success).toBe(true);
  });
});
