import { z } from "zod";

/**
 * Prospection — d'où viennent les étudiants, et qui est payé pour les avoir
 * amenés (migrations `0120`, `0124`, `0125`).
 *
 * Un étudiant a UNE provenance. Quand cette provenance est un commercial, un
 * taux de commission est figé sur la fiche : il s'applique à chaque paiement de
 * scolarité confirmé de l'étudiant. Les autres canaux — y compris une
 * connaissance ou un étudiant parrain — sont enregistrés pour le suivi, sans
 * commission.
 */

export const PROVENANCE_CANAUX = [
  "google",
  "facebook",
  "autre_media",
  "commercial",
  "connaissance",
  "etudiant",
  "autre",
] as const;

export const ProvenanceCanalSchema = z.enum(PROVENANCE_CANAUX);
export type ProvenanceCanal = z.infer<typeof ProvenanceCanalSchema>;

/** Libellés d'affichage, dans l'ordre attendu des listes déroulantes. */
export const PROVENANCE_CANAL_LABELS: Record<ProvenanceCanal, string> = {
  google: "Google",
  facebook: "Facebook",
  autre_media: "Radio / Télé / Journal",
  commercial: "Commercial IPAM",
  connaissance: "Une connaissance",
  etudiant: "Un étudiant",
  autre: "Autre",
};

/**
 * Canaux qui se suffisent à eux-mêmes : Google et Facebook nomment déjà leur
 * source, et « commercial » a son propre bloc (qui, lui, engage de l'argent).
 * Tous les AUTRES réclament une précision en texte libre, sans quoi
 * « Radio / Télé / Journal » ou « Autre » ne disent rien d'exploitable.
 */
export function canalDemandeDetail(canal: ProvenanceCanal): boolean {
  return canal !== "google" && canal !== "facebook" && canal !== "commercial";
}

/** Intitulé du champ de détail, selon ce qu'on attend vraiment. */
export const PROVENANCE_DETAIL_LABELS: Partial<Record<ProvenanceCanal, string>> = {
  autre_media: "Quel média ? (radio, chaîne, titre du journal…)",
  connaissance: "Précisions sur cette personne",
  etudiant: "Précisions",
  autre: "Précisez la provenance",
};

/** Taux proposé tant que rien d'autre n'a été convenu avec le commercial. */
export const TAUX_COMMISSION_DEFAUT = 5;

export const VERSEMENT_MODES = ["especes", "mobile_money", "virement", "autre"] as const;
export const VersementModeSchema = z.enum(VERSEMENT_MODES);
export type VersementMode = z.infer<typeof VersementModeSchema>;

export const VERSEMENT_MODE_LABELS: Record<VersementMode, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  autre: "Autre",
};

// ---------------------------------------------------------------------------
// Commerciaux
// ---------------------------------------------------------------------------

const tauxSchema = z
  .number({ invalid_type_error: "Le taux doit être un nombre." })
  .min(0, "Le taux ne peut pas être négatif.")
  .max(100, "Le taux ne peut pas dépasser 100 %.");

export const CreateCommercialSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis.").max(255),
  telephone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email("Email invalide.").max(255).nullable().optional().or(z.literal("")),
  taux_commission: tauxSchema.default(TAUX_COMMISSION_DEFAUT),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const UpdateCommercialSchema = CreateCommercialSchema.partial().extend({
  actif: z.boolean().optional(),
});

export type CreateCommercialInput = z.infer<typeof CreateCommercialSchema>;
export type UpdateCommercialInput = z.infer<typeof UpdateCommercialSchema>;

export const CommercialDtoSchema = z.object({
  id: z.string().uuid(),
  nom: z.string(),
  telephone: z.string().nullable(),
  email: z.string().nullable(),
  taux_commission: z.number(),
  actif: z.boolean(),
  note: z.string().nullable(),
  /** Nombre d'étudiants dont la provenance désigne ce commercial. */
  etudiants: z.number(),
  created_at: z.string(),
});

export type CommercialDto = z.infer<typeof CommercialDtoSchema>;

// ---------------------------------------------------------------------------
// Provenance d'un étudiant
// ---------------------------------------------------------------------------

/**
 * Corps d'un enregistrement de provenance. Les champs dépendants du canal sont
 * vérifiés ici plutôt qu'au seul niveau SQL, pour rendre un message utile.
 */
export const ProvenanceInputSchema = z
  .object({
    canal: ProvenanceCanalSchema,
    commercial_id: z.string().uuid().nullable().optional(),
    taux_commission: tauxSchema.nullable().optional(),
    referent_nom: z.string().trim().max(255).nullable().optional(),
    referent_student_id: z.string().uuid().nullable().optional(),
    media_detail: z.string().trim().max(255).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.canal === "commercial" && !value.commercial_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commercial_id"],
        message: "Sélectionnez le commercial à créditer.",
      });
    }
    if (value.canal !== "commercial" && value.commercial_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commercial_id"],
        message: "Un commercial ne se rattache qu'au canal « Commercial IPAM ».",
      });
    }
    if (value.canal === "connaissance" && !value.referent_nom?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referent_nom"],
        message: "Indiquez le nom de la personne qui a référé l'étudiant.",
      });
    }
    if (value.canal === "etudiant" && !value.referent_student_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referent_student_id"],
        message: "Sélectionnez l'étudiant qui a référé.",
      });
    }
    // « Autre » sans précision ne dit rien : c'est le seul canal dont le détail
    // porte toute l'information.
    if (value.canal === "autre" && !value.media_detail?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media_detail"],
        message: "Précisez la provenance.",
      });
    }
  });

export type ProvenanceInput = z.infer<typeof ProvenanceInputSchema>;

/** Enregistrement en lot depuis la page Inscriptions. */
export const ProvenanceBulkSchema = z.object({
  entrees: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        provenance: ProvenanceInputSchema,
      })
    )
    .min(1, "Aucune provenance à enregistrer."),
});

export type ProvenanceBulkInput = z.infer<typeof ProvenanceBulkSchema>;

export const ProvenanceRowDtoSchema = z.object({
  student_id: z.string().uuid(),
  student_nom: z.string(),
  matricule: z.string().nullable(),
  canal: ProvenanceCanalSchema.nullable(),
  commercial_id: z.string().uuid().nullable(),
  commercial_nom: z.string().nullable(),
  taux_commission: z.number().nullable(),
  referent_nom: z.string().nullable(),
  referent_student_id: z.string().uuid().nullable(),
  referent_student_nom: z.string().nullable(),
  media_detail: z.string().nullable(),
  note: z.string().nullable(),
  /** Scolarité confirmée de l'étudiant — ligne « Scolarité » du barème. */
  total_paye: z.number(),
  /** Commission acquise = somme des lignes. Nulle hors canal « commercial ». */
  commission: z.number(),
  enregistre_le: z.string().nullable(),
});

export type ProvenanceRowDto = z.infer<typeof ProvenanceRowDtoSchema>;

export const ProvenanceQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  /** `non_renseigne` isole les étudiants dont la provenance manque encore. */
  canal: z.union([ProvenanceCanalSchema, z.literal("non_renseigne")]).optional(),
  commercial_id: z.string().uuid().optional(),
  /**
   * Restreint à un étudiant. Sa fiche est alors renvoyée même sans provenance
   * — c'est ainsi que le détail d'un étudiant sait quoi afficher.
   */
  student_id: z.string().uuid().optional(),
});

export type ProvenanceQuery = z.infer<typeof ProvenanceQuerySchema>;

// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------

export const CommissionCommercialDtoSchema = z.object({
  commercial_id: z.string().uuid(),
  nom: z.string(),
  telephone: z.string().nullable(),
  actif: z.boolean(),
  etudiants: z.number(),
  /** Scolarité encaissée sur les étudiants amenés par ce commercial. */
  scolarite_encaissee: z.number(),
  commission_acquise: z.number(),
  commission_versee: z.number(),
  solde: z.number(),
});

export type CommissionCommercialDto = z.infer<typeof CommissionCommercialDtoSchema>;

/**
 * Règlement de lignes de commission — une ligne étant un paiement de scolarité
 * d'un étudiant amené par un commercial (migration 0125).
 *
 * Aucun montant n'est transmis : le serveur le recalcule à partir du paiement
 * et du taux figé sur la fiche de l'étudiant. Laisser l'écran l'envoyer
 * ouvrirait la porte à un règlement qui ne correspond pas à la ligne.
 */
export const ReglerCommissionsSchema = z.object({
  payment_ids: z.array(z.string().uuid()).min(1, "Sélectionnez au moins une ligne."),
  mode: VersementModeSchema.default("especes"),
  reference: z.string().trim().max(120).nullable().optional(),
  paid_at: z.string().trim().min(1).optional(),
});

export type ReglerCommissionsInput = z.infer<typeof ReglerCommissionsSchema>;

export const LigneCommissionDtoSchema = z.object({
  /** Le paiement de scolarité qui ouvre la commission — clé de la ligne. */
  payment_id: z.string().uuid(),
  montant_scolarite: z.number(),
  paiement_le: z.string().nullable(),
  mode_scolarite: z.string().nullable(),
  receipt_number: z.string().nullable(),
  student_id: z.string().uuid(),
  student_nom: z.string(),
  matricule: z.string().nullable(),
  commercial_id: z.string().uuid(),
  commercial_nom: z.string(),
  taux_commission: z.number(),
  commission: z.number(),
  statut: z.enum(["regle", "impaye"]),
  reglement_id: z.string().uuid().nullable(),
  regle_le: z.string().nullable(),
  mode_reglement: z.string().nullable(),
  reference_reglement: z.string().nullable(),
  regle_par: z.string().nullable(),
});

export type LigneCommissionDto = z.infer<typeof LigneCommissionDtoSchema>;

export const LignesCommissionQuerySchema = z.object({
  commercial_id: z.string().uuid().optional(),
  statut: z.enum(["regle", "impaye"]).optional(),
});

export type LignesCommissionQuery = z.infer<typeof LignesCommissionQuerySchema>;

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

export const ProspectionDashboardQuerySchema = z.object({
  date_debut: z.string().trim().optional(),
  date_fin: z.string().trim().optional(),
});

export type ProspectionDashboardQuery = z.infer<typeof ProspectionDashboardQuerySchema>;

export const ProspectionDashboardDtoSchema = z.object({
  total_etudiants: z.number(),
  renseignes: z.number(),
  non_renseignes: z.number(),
  /** Étudiants amenés par un commercial. */
  via_commercial: z.number(),
  commission_acquise: z.number(),
  commission_versee: z.number(),
  commission_due: z.number(),
  par_canal: z.array(
    z.object({
      canal: ProvenanceCanalSchema,
      etudiants: z.number(),
      scolarite_encaissee: z.number(),
    })
  ),
  par_mois: z.array(
    z.object({
      mois: z.string(),
      total: z.number(),
      commercial: z.number(),
      /** Google, Facebook, radio / télé / journal. */
      medias: z.number(),
      bouche_a_oreille: z.number(),
      autre: z.number(),
    })
  ),
  top_commerciaux: z.array(CommissionCommercialDtoSchema),
});

export type ProspectionDashboardDto = z.infer<typeof ProspectionDashboardDtoSchema>;
