/**
 * Tests — Diplômes Professionnels (feature 029).
 *
 * Couverture ciblée : logique pure (`evaluateDiplomaEligibility`) et schémas
 * Zod des contrats. Les blocs `describe` par user story sont ajoutés par les
 * tâches T011 (US1), T021 (US2), T026 (US3), T032 (US4), T037 (US5).
 *
 * Squelette créé en Phase 2 (T010) : imports, fixtures et helpers partagés.
 */
import {
  evaluateDiplomaEligibility,
  computeDiplomaProgress,
  type DiplomaRequirementForEval,
} from "../professional-diplomas.service";
import {
  DiplomaCreateInputSchema,
  DiplomaUpdateInputSchema,
  DiplomaRequirementInputSchema,
  DiplomaRequirementsReplaceInputSchema,
  DiplomaRevokeInputSchema,
  DiplomaAwardManualInputSchema,
  StudentDiplomaSummaryDtoSchema,
  type DiplomaRequirementDto,
} from "@ecoledigitale/contracts";

/* ----------------------------- Fixtures ------------------------------- */

/** UUID factices stables, lisibles dans les diagnostics de test. */
export const SUBJECT = {
  A: "11111111-1111-1111-1111-111111111111",
  B: "22222222-2222-2222-2222-222222222222",
  C: "33333333-3333-3333-3333-333333333333",
  D: "44444444-4444-4444-4444-444444444444",
} as const;

export const PROGRAMME_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const STUDENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Construit une exigence pour les tests de la fonction pure d'éligibilité. */
export function req(
  ue_id: string,
  nb_uv: number,
  est_obligatoire = false
): DiplomaRequirementForEval {
  return { ue_id, nb_uv, est_obligatoire };
}

/** Construit une exigence enrichie (`DiplomaRequirementDto`) pour les tests de progression. */
export function reqDto(
  ue_id: string,
  nb_uv: number,
  est_obligatoire = false,
  ordre = 0
): DiplomaRequirementDto {
  return {
    id: `req-${ue_id}`,
    diploma_id: "dip-1",
    ue_id,
    ue_code: `CODE-${ue_id.slice(0, 4)}`,
    ue_libelle: `Matière ${ue_id.slice(0, 4)}`,
    ue_nb_uv: nb_uv,
    est_obligatoire,
    ordre,
  };
}

/* ------------------------- Smoke test (squelette) --------------------- */

describe("ProfessionalDiplomas — squelette de tests (T010)", () => {
  it("expose la fonction pure d'éligibilité et les schémas de contrats", () => {
    expect(typeof evaluateDiplomaEligibility).toBe("function");
    expect(DiplomaCreateInputSchema).toBeDefined();
    expect(DiplomaRequirementInputSchema).toBeDefined();
    expect(DiplomaRevokeInputSchema).toBeDefined();
    expect(DiplomaAwardManualInputSchema).toBeDefined();
  });

  it("un diplôme sans exigence ne rend personne éligible", () => {
    const r = evaluateDiplomaEligibility([], 1, []);
    expect(r.eligible).toBe(false);
    expect(r.uv_validees).toBe(0);
  });
});

/* ===================================================================== */
/* US1 — Définition d'un diplôme et de ses exigences (T011)               */
/* ===================================================================== */

function validCreate() {
  return {
    filiere_id: PROGRAMME_ID,
    code: "DIP-CAP",
    libelle: "CAP Professionnel",
    uv_required: 12,
  };
}

describe("US1 — DiplomaCreateInputSchema", () => {
  it("accepte un diplôme valide minimal", () => {
    expect(DiplomaCreateInputSchema.safeParse(validCreate()).success).toBe(true);
  });

  it("accepte description et statut optionnels", () => {
    const r = DiplomaCreateInputSchema.safeParse({
      ...validCreate(),
      description: "Diplôme de niveau CAP",
      statut: "inactif",
    });
    expect(r.success).toBe(true);
  });

  it("rejette un code manquant", () => {
    const { code, ...sansCode } = validCreate();
    expect(DiplomaCreateInputSchema.safeParse(sansCode).success).toBe(false);
  });

  it("rejette un code vide", () => {
    expect(DiplomaCreateInputSchema.safeParse({ ...validCreate(), code: "" }).success).toBe(false);
  });

  it("rejette un code de plus de 50 caractères", () => {
    expect(
      DiplomaCreateInputSchema.safeParse({ ...validCreate(), code: "X".repeat(51) }).success
    ).toBe(false);
  });

  it("rejette un libellé manquant", () => {
    const { libelle, ...sansLibelle } = validCreate();
    expect(DiplomaCreateInputSchema.safeParse(sansLibelle).success).toBe(false);
  });

  it("rejette uv_required égal à 0", () => {
    expect(
      DiplomaCreateInputSchema.safeParse({ ...validCreate(), uv_required: 0 }).success
    ).toBe(false);
  });

  it("rejette uv_required négatif", () => {
    expect(
      DiplomaCreateInputSchema.safeParse({ ...validCreate(), uv_required: -3 }).success
    ).toBe(false);
  });

  it("rejette uv_required non entier", () => {
    expect(
      DiplomaCreateInputSchema.safeParse({ ...validCreate(), uv_required: 5.5 }).success
    ).toBe(false);
  });

  it("rejette un filiere_id manquant", () => {
    const { filiere_id, ...sansProg } = validCreate();
    expect(DiplomaCreateInputSchema.safeParse(sansProg).success).toBe(false);
  });

  it("rejette un filiere_id qui n'est pas un uuid", () => {
    expect(
      DiplomaCreateInputSchema.safeParse({ ...validCreate(), filiere_id: "pas-un-uuid" }).success
    ).toBe(false);
  });

  it("rejette un statut hors enum", () => {
    expect(
      DiplomaCreateInputSchema.safeParse({ ...validCreate(), statut: "archive" }).success
    ).toBe(false);
  });
});

describe("US1 — DiplomaUpdateInputSchema", () => {
  it("accepte un objet vide (mise à jour partielle)", () => {
    expect(DiplomaUpdateInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepte une mise à jour partielle d'un seul champ", () => {
    expect(DiplomaUpdateInputSchema.safeParse({ libelle: "Nouveau libellé" }).success).toBe(true);
  });

  it("rejette uv_required égal à 0", () => {
    expect(DiplomaUpdateInputSchema.safeParse({ uv_required: 0 }).success).toBe(false);
  });

  it("rejette un statut hors enum", () => {
    expect(DiplomaUpdateInputSchema.safeParse({ statut: "supprime" }).success).toBe(false);
  });
});

describe("US1 — DiplomaRequirementInputSchema / DiplomaRequirementsReplaceInputSchema", () => {
  it("applique les valeurs par défaut est_obligatoire=false et ordre=0", () => {
    const parsed = DiplomaRequirementInputSchema.parse({ ue_id: SUBJECT.A });
    expect(parsed.est_obligatoire).toBe(false);
    expect(parsed.ordre).toBe(0);
  });

  it("rejette un ue_id manquant", () => {
    expect(DiplomaRequirementInputSchema.safeParse({ est_obligatoire: true }).success).toBe(false);
  });

  it("rejette un ordre négatif", () => {
    expect(
      DiplomaRequirementInputSchema.safeParse({ ue_id: SUBJECT.A, ordre: -1 }).success
    ).toBe(false);
  });

  it("accepte une liste d'exigences vide (défaut)", () => {
    const parsed = DiplomaRequirementsReplaceInputSchema.parse({});
    expect(parsed.requirements).toEqual([]);
  });

  it("accepte une liste d'exigences valides", () => {
    const r = DiplomaRequirementsReplaceInputSchema.safeParse({
      requirements: [
        { ue_id: SUBJECT.A, est_obligatoire: true, ordre: 0 },
        { ue_id: SUBJECT.B, est_obligatoire: false, ordre: 1 },
      ],
    });
    expect(r.success).toBe(true);
  });
});

/* ===================================================================== */
/* US2 — Éligibilité et octroi automatique (T021)                         */
/* ===================================================================== */

describe("US2 — evaluateDiplomaEligibility", () => {
  it("est éligible quand toutes les obligatoires sont validées et le cumul d'UV atteint", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 4, true), req(SUBJECT.B, 4, true)],
      8,
      [SUBJECT.A, SUBJECT.B]
    );
    expect(r.eligible).toBe(true);
    expect(r.uv_validees).toBe(8);
    expect(r.obligatoires_ok).toBe(true);
  });

  it("cumule correctement les UV des matières validées", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 3), req(SUBJECT.B, 5), req(SUBJECT.C, 2)],
      10,
      [SUBJECT.A, SUBJECT.C]
    );
    expect(r.uv_validees).toBe(5);
  });

  it("ne compte une matière qu'une fois même si l'exigence est dupliquée", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 4, true), req(SUBJECT.A, 4, true)],
      4,
      [SUBJECT.A]
    );
    expect(r.uv_validees).toBe(4);
    expect(r.eligible).toBe(true);
  });

  it("n'est pas éligible si le cumul d'UV est insuffisant", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 3), req(SUBJECT.B, 3)],
      10,
      [SUBJECT.A, SUBJECT.B]
    );
    expect(r.eligible).toBe(false);
    expect(r.uv_validees).toBe(6);
  });

  it("n'est pas éligible si une matière obligatoire manque, même avec assez d'UV", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 10, true), req(SUBJECT.B, 10, false)],
      8,
      [SUBJECT.B]
    );
    expect(r.uv_validees).toBe(10);
    expect(r.obligatoires_ok).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("est éligible exactement au seuil (uv_validees === uv_required)", () => {
    const r = evaluateDiplomaEligibility([req(SUBJECT.A, 7, true)], 7, [SUBJECT.A]);
    expect(r.eligible).toBe(true);
  });

  it("une matière non obligatoire non validée n'empêche pas l'éligibilité", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 6, true), req(SUBJECT.B, 4, false)],
      6,
      [SUBJECT.A]
    );
    expect(r.eligible).toBe(true);
  });

  it("renseigne les listes validées / restantes", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 4), req(SUBJECT.B, 4), req(SUBJECT.C, 4)],
      4,
      [SUBJECT.A]
    );
    expect(r.validated_ue_ids).toEqual([SUBJECT.A]);
    expect(r.missing_ue_ids.sort()).toEqual([SUBJECT.B, SUBJECT.C].sort());
  });

  it("ne liste comme obligatoires manquantes que les exigences obligatoires", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 4, true), req(SUBJECT.B, 4, false)],
      4,
      []
    );
    expect(r.missing_obligatoire_ue_ids).toEqual([SUBJECT.A]);
  });

  it("obligatoires_ok est vrai quand le diplôme n'a aucune matière obligatoire", () => {
    const r = evaluateDiplomaEligibility(
      [req(SUBJECT.A, 4, false), req(SUBJECT.B, 4, false)],
      4,
      [SUBJECT.A]
    );
    expect(r.obligatoires_ok).toBe(true);
    expect(r.eligible).toBe(true);
  });

  it("accepte indifféremment un Set ou un tableau de matières validées", () => {
    const reqs = [req(SUBJECT.A, 5, true)];
    const fromArray = evaluateDiplomaEligibility(reqs, 5, [SUBJECT.A]);
    const fromSet = evaluateDiplomaEligibility(reqs, 5, new Set([SUBJECT.A]));
    expect(fromArray.eligible).toBe(true);
    expect(fromSet.eligible).toBe(true);
  });

  it("cumule 0 UV quand l'étudiant n'a rien validé", () => {
    const r = evaluateDiplomaEligibility([req(SUBJECT.A, 4, true)], 4, []);
    expect(r.uv_validees).toBe(0);
    expect(r.eligible).toBe(false);
  });
});

/* ===================================================================== */
/* US3 — Progression de l'étudiant (T026)                                 */
/* ===================================================================== */

describe("US3 — computeDiplomaProgress", () => {
  it("calcule un pourcentage d'avancement correct", () => {
    const v = computeDiplomaProgress(
      [reqDto(SUBJECT.A, 3), reqDto(SUBJECT.B, 7)],
      10,
      [SUBJECT.A]
    );
    expect(v.uv_validees).toBe(3);
    expect(v.pourcentage).toBe(30);
  });

  it("borne le pourcentage à 100 quand le cumul dépasse la cible", () => {
    const v = computeDiplomaProgress([reqDto(SUBJECT.A, 20)], 5, [SUBJECT.A]);
    expect(v.pourcentage).toBe(100);
  });

  it("arrondit le pourcentage à l'entier le plus proche", () => {
    const v = computeDiplomaProgress(
      [reqDto(SUBJECT.A, 1), reqDto(SUBJECT.B, 2)],
      3,
      [SUBJECT.A]
    );
    expect(v.pourcentage).toBe(33);
  });

  it("classe les matières validées et restantes", () => {
    const v = computeDiplomaProgress(
      [reqDto(SUBJECT.A, 4), reqDto(SUBJECT.B, 4), reqDto(SUBJECT.C, 4)],
      8,
      [SUBJECT.A, SUBJECT.B]
    );
    expect(v.ue_validees.map((m) => m.ue_id).sort()).toEqual(
      [SUBJECT.A, SUBJECT.B].sort()
    );
    expect(v.ue_restantes.map((m) => m.ue_id)).toEqual([SUBJECT.C]);
  });

  it("ne liste en obligatoires manquantes que les obligatoires non validées", () => {
    const v = computeDiplomaProgress(
      [reqDto(SUBJECT.A, 4, true), reqDto(SUBJECT.B, 4, true), reqDto(SUBJECT.C, 4, false)],
      4,
      [SUBJECT.A]
    );
    expect(v.ue_obligatoires_manquantes.map((m) => m.ue_id)).toEqual([
      SUBJECT.B,
    ]);
  });

  it("expose code, libellé et UV de chaque matière de progression", () => {
    const v = computeDiplomaProgress([reqDto(SUBJECT.A, 5, true)], 5, [SUBJECT.A]);
    const m = v.ue_validees[0];
    expect(m.code).toBe(`CODE-${SUBJECT.A.slice(0, 4)}`);
    expect(m.nb_uv).toBe(5);
    expect(m.est_obligatoire).toBe(true);
  });

  it("reflète l'éligibilité (obligatoires validées + UV atteint)", () => {
    const reqs = [reqDto(SUBJECT.A, 6, true), reqDto(SUBJECT.B, 4, false)];
    expect(computeDiplomaProgress(reqs, 6, [SUBJECT.A]).eligible).toBe(true);
    expect(computeDiplomaProgress(reqs, 6, [SUBJECT.B]).eligible).toBe(false);
  });

  it("renvoie une progression nulle quand rien n'est validé", () => {
    const v = computeDiplomaProgress([reqDto(SUBJECT.A, 4, true)], 4, []);
    expect(v.uv_validees).toBe(0);
    expect(v.pourcentage).toBe(0);
    expect(v.ue_validees).toHaveLength(0);
    expect(v.eligible).toBe(false);
  });
});

/* ===================================================================== */
/* US4 — Octroi et révocation manuels (T032)                              */
/* ===================================================================== */

describe("US4 — DiplomaAwardManualInputSchema", () => {
  it("accepte un octroi avec le seul student_id et applique force=false par défaut", () => {
    const parsed = DiplomaAwardManualInputSchema.parse({ student_id: STUDENT_ID });
    expect(parsed.force).toBe(false);
  });

  it("accepte un octroi forcé explicite", () => {
    const parsed = DiplomaAwardManualInputSchema.parse({
      student_id: STUDENT_ID,
      force: true,
    });
    expect(parsed.force).toBe(true);
  });

  it("rejette un student_id manquant", () => {
    expect(DiplomaAwardManualInputSchema.safeParse({ force: true }).success).toBe(false);
  });

  it("rejette un student_id qui n'est pas un uuid", () => {
    expect(
      DiplomaAwardManualInputSchema.safeParse({ student_id: "x" }).success
    ).toBe(false);
  });
});

describe("US4 — DiplomaRevokeInputSchema", () => {
  it("accepte une révocation avec student_id et motif", () => {
    const r = DiplomaRevokeInputSchema.safeParse({
      student_id: STUDENT_ID,
      motif: "Erreur de saisie",
    });
    expect(r.success).toBe(true);
  });

  it("rejette une révocation sans motif", () => {
    expect(
      DiplomaRevokeInputSchema.safeParse({ student_id: STUDENT_ID }).success
    ).toBe(false);
  });

  it("rejette une révocation au motif vide", () => {
    expect(
      DiplomaRevokeInputSchema.safeParse({ student_id: STUDENT_ID, motif: "" }).success
    ).toBe(false);
  });

  it("rejette une révocation sans student_id", () => {
    expect(
      DiplomaRevokeInputSchema.safeParse({ motif: "Motif valide" }).success
    ).toBe(false);
  });
});

/* ===================================================================== */
/* US5 — Consultation parent (T037)                                       */
/* ===================================================================== */

/** Diplôme DTO valide pour les tests de schéma de résumé. */
function validDiplomaDto() {
  return {
    id: SUBJECT.A,
    tenant_id: PROGRAMME_ID,
    filiere_id: PROGRAMME_ID,
    code: "DIP-X",
    libelle: "Diplôme X",
    description: null,
    uv_required: 10,
    statut: "actif",
    created_by: null,
    created_at: "2026-05-22T10:00:00.000Z",
    updated_at: "2026-05-22T10:00:00.000Z",
  };
}

describe("US5 — StudentDiplomaSummaryDtoSchema (DTO lu par l'étudiant et le parent)", () => {
  it("accepte un résumé d'un diplôme non encore obtenu", () => {
    const r = StudentDiplomaSummaryDtoSchema.safeParse({
      diploma: validDiplomaDto(),
      pourcentage: 40,
      eligible: false,
      statut_octroi: null,
      reference: null,
      date_obtention: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepte un résumé d'un diplôme obtenu", () => {
    const r = StudentDiplomaSummaryDtoSchema.safeParse({
      diploma: validDiplomaDto(),
      pourcentage: 100,
      eligible: true,
      statut_octroi: "obtenu",
      reference: "DIP-2026-000001",
      date_obtention: "2026-05-22T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejette un statut_octroi hors enum", () => {
    const r = StudentDiplomaSummaryDtoSchema.safeParse({
      diploma: validDiplomaDto(),
      pourcentage: 0,
      eligible: false,
      statut_octroi: "annule",
      reference: null,
      date_obtention: null,
    });
    expect(r.success).toBe(false);
  });
});
