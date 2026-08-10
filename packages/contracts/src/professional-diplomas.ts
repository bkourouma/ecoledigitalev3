/**
 * Contrats partagés — Diplômes Professionnels (composés d'UE).
 * Features: 029-professional-diplomas → 030-pedagogie-ue-ecue.
 *
 * Le diplôme est rattaché à une Filière (`filiere_id` → programmes) et exige un
 * ensemble d'UE (`ue_id`). Les UV sont capitalisées au niveau UE.
 *
 * Voir specs/030-pedagogie-ue-ecue/data-model.md et
 * specs/030-pedagogie-ue-ecue/contracts/professional-ue-ecue-api.md.
 *
 * Convention : champs en snake_case ; dates/timestamps en chaînes ISO.
 */
import { z } from "zod";

/* ============================== Enums ================================= */

export const DiplomaStatutSchema = z.enum(["actif", "inactif"]);

export const StudentDiplomaStatutSchema = z.enum(["en_cours", "obtenu", "revoque"]);

/* ========================= Entrées (inputs) =========================== */

export const DiplomaCreateInputSchema = z.object({
  filiere_id: z.string().uuid("filiere_id est requis"),
  code: z.string().min(1, "Le code est requis").max(50),
  libelle: z.string().min(1, "Le libellé est requis").max(255),
  description: z.string().max(2000).nullable().optional(),
  uv_required: z.number().int().positive("uv_required doit être > 0"),
  statut: DiplomaStatutSchema.optional(),
});

// filiere_id et code sont figés après création.
export const DiplomaUpdateInputSchema = z
  .object({
    libelle: z.string().min(1, "Le libellé est requis").max(255),
    description: z.string().max(2000).nullable(),
    uv_required: z.number().int().positive("uv_required doit être > 0"),
    statut: DiplomaStatutSchema,
  })
  .partial();

export const DiplomaRequirementInputSchema = z.object({
  ue_id: z.string().uuid("ue_id est requis"),
  est_obligatoire: z.boolean().default(false),
  ordre: z.number().int().min(0, "ordre doit être >= 0").default(0),
});

export const DiplomaRequirementsReplaceInputSchema = z.object({
  requirements: z.array(DiplomaRequirementInputSchema).default([]),
});

export const DiplomaAwardManualInputSchema = z.object({
  student_id: z.string().uuid("student_id est requis"),
  force: z.boolean().optional().default(false),
});

export const DiplomaRevokeInputSchema = z.object({
  student_id: z.string().uuid("student_id est requis"),
  motif: z.string().min(1, "Le motif de révocation est requis"),
});

/* ============================ DTO ===================================== */

export const DiplomaDtoSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  filiere_id: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  description: z.string().nullable(),
  uv_required: z.number().int(),
  statut: DiplomaStatutSchema,
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const DiplomaRequirementDtoSchema = z.object({
  id: z.string().uuid(),
  diploma_id: z.string().uuid(),
  ue_id: z.string().uuid(),
  ue_code: z.string(),
  ue_libelle: z.string(),
  ue_nb_uv: z.number().int(),
  est_obligatoire: z.boolean(),
  ordre: z.number().int(),
});

export const DiplomaDetailDtoSchema = DiplomaDtoSchema.extend({
  requirements: z.array(DiplomaRequirementDtoSchema),
  uv_total_atteignable: z.number().int(),
  nb_diplomes_octroyes: z.number().int(),
});

/* Instantané (snapshot) des exigences figé au moment de l'octroi. */
export const DiplomaRequirementSnapshotItemSchema = z.object({
  ue_id: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  nb_uv: z.number().int(),
  est_obligatoire: z.boolean(),
  ordre: z.number().int(),
  validee: z.boolean(),
});

export const DiplomaRequirementsSnapshotSchema = z.object({
  uv_required: z.number().int(),
  captured_at: z.string(),
  requirements: z.array(DiplomaRequirementSnapshotItemSchema),
});

export const StudentDiplomaDtoSchema = z.object({
  id: z.string().uuid(),
  diploma_id: z.string().uuid(),
  student_id: z.string().uuid(),
  reference: z.string(),
  statut: StudentDiplomaStatutSchema,
  uv_total_validees: z.number().int(),
  requirements_snapshot: DiplomaRequirementsSnapshotSchema.nullable(),
  date_obtention: z.string().nullable(),
  date_revocation: z.string().nullable(),
  motif_revocation: z.string().nullable(),
  octroye_par: z.string().uuid().nullable(),
  revoque_par: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
<<<<<<< HEAD
=======
  /** Numéro de référence de l'attestation d'authenticité (AUTH/{année}/{NNN}), attribué à la 1ère génération. */
  authenticite_reference: z.string().nullable().optional(),
  authenticite_numero: z.number().int().nullable().optional(),
  authenticite_annee: z.number().int().nullable().optional(),
>>>>>>> 030-pedagogie-ue-ecue
});

/* UE dans une vue de progression. */
export const DiplomaProgressUeSchema = z.object({
  ue_id: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  nb_uv: z.number().int(),
  est_obligatoire: z.boolean(),
});

export const DiplomaProgressDtoSchema = z.object({
  diploma: DiplomaDtoSchema,
  uv_validees: z.number().int(),
  uv_required: z.number().int(),
  pourcentage: z.number().int(),
  ue_validees: z.array(DiplomaProgressUeSchema),
  ue_restantes: z.array(DiplomaProgressUeSchema),
  ue_obligatoires_manquantes: z.array(DiplomaProgressUeSchema),
  eligible: z.boolean(),
  diplome_obtenu: StudentDiplomaDtoSchema.nullable(),
});

export const StudentDiplomaSummaryDtoSchema = z.object({
  diploma: DiplomaDtoSchema,
  pourcentage: z.number().int(),
  eligible: z.boolean(),
  statut_octroi: StudentDiplomaStatutSchema.nullable(),
  reference: z.string().nullable(),
  date_obtention: z.string().nullable(),
});

export const DiplomaAttestationDtoSchema = z.object({
  reference: z.string(),
<<<<<<< HEAD
=======
  /** Numéro de référence de l'attestation d'authenticité (AUTH/{année}/{NNN}), séquentiel et persistant. */
  authenticite_reference: z.string(),
>>>>>>> 030-pedagogie-ue-ecue
  diplome: z.object({
    code: z.string(),
    libelle: z.string(),
    filiere_libelle: z.string(),
  }),
  etudiant: z.object({
    id: z.string().uuid(),
    nom_complet: z.string(),
  }),
  date_obtention: z.string(),
<<<<<<< HEAD
=======
  /** Année scolaire (« 2025-2026 ») dérivée des sessions d'UE de l'étudiant, imprimée sur l'attestation. */
  annee_academique: z.string().nullable().optional(),
>>>>>>> 030-pedagogie-ue-ecue
  uv_total_validees: z.number().int(),
  ue_validees: z.array(
    z.object({
      code: z.string(),
      libelle: z.string(),
      nb_uv: z.number().int(),
    })
  ),
<<<<<<< HEAD
=======
  /** Mention dérivée de la moyenne des bulletins de l'étudiant (null si aucun bulletin). */
  mention: z.string().nullable().optional(),
>>>>>>> 030-pedagogie-ue-ecue
});

/* ============================ Type exports ============================ */

export type DiplomaStatut = z.infer<typeof DiplomaStatutSchema>;
export type StudentDiplomaStatut = z.infer<typeof StudentDiplomaStatutSchema>;

export type DiplomaCreateInput = z.infer<typeof DiplomaCreateInputSchema>;
export type DiplomaUpdateInput = z.infer<typeof DiplomaUpdateInputSchema>;
export type DiplomaRequirementInput = z.infer<typeof DiplomaRequirementInputSchema>;
export type DiplomaRequirementsReplaceInput = z.infer<typeof DiplomaRequirementsReplaceInputSchema>;
export type DiplomaAwardManualInput = z.infer<typeof DiplomaAwardManualInputSchema>;
export type DiplomaRevokeInput = z.infer<typeof DiplomaRevokeInputSchema>;

export type DiplomaDto = z.infer<typeof DiplomaDtoSchema>;
export type DiplomaRequirementDto = z.infer<typeof DiplomaRequirementDtoSchema>;
export type DiplomaDetailDto = z.infer<typeof DiplomaDetailDtoSchema>;
export type DiplomaRequirementSnapshotItem = z.infer<typeof DiplomaRequirementSnapshotItemSchema>;
export type DiplomaRequirementsSnapshot = z.infer<typeof DiplomaRequirementsSnapshotSchema>;
export type StudentDiplomaDto = z.infer<typeof StudentDiplomaDtoSchema>;
export type DiplomaProgressUe = z.infer<typeof DiplomaProgressUeSchema>;
export type DiplomaProgressDto = z.infer<typeof DiplomaProgressDtoSchema>;
export type StudentDiplomaSummaryDto = z.infer<typeof StudentDiplomaSummaryDtoSchema>;
export type DiplomaAttestationDto = z.infer<typeof DiplomaAttestationDtoSchema>;
