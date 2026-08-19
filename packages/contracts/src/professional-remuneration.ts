/**
 * Contrats partagés — Rémunération des enseignants du Module Professionnel.
 * Feature: 031-remuneration-professionnelle.
 *
 * Voir specs/031-remuneration-professionnelle/data-model.md et
 * specs/031-remuneration-professionnelle/contracts/remuneration-professionnelle-api.md.
 *
 * Principe : le module de paie (0011) n'est PAS dupliqué. Périodes,
 * configurations d'enseignant, workflow d'approbation, audit et rapports restent
 * partagés avec l'Académique — un enseignant reçoit un seul bulletin par
 * période. Ce fichier ne couvre que ce qui est propre au professionnel : le
 * cycle de vie des séances d'ECUE (source des heures) et leur tarification.
 *
 * Convention : champs en snake_case ; dates/timestamps en chaînes ISO
 * (même convention que professional.ts).
 */
import { z } from "zod";

/* ============================== Enums ================================= */

/**
 * Cycle de vie PÉDAGOGIQUE d'une séance : la séance a-t-elle eu lieu ?
 * Distinct de la validation pour la paie, qui est un acte de GESTION.
 * Les confondre ferait de tout constat pédagogique un engagement financier.
 */
export const ProfessionalSeanceStatutSchema = z.enum(["planifiee", "realisee", "annulee"]);

/**
 * Motif de non-payabilité d'une séance. Renvoyé par l'API pour que l'écran
 * puisse dire POURQUOI une séance ne peut pas être validée, plutôt que de la
 * griser sans explication.
 */
export const SeanceBlockerSchema = z.enum([
  "STATUT_NON_REALISEE",
  "NON_VALIDEE",
  "SANS_ENSEIGNANT",
  "HORAIRES_INCOMPLETS",
  "DEJA_PAYEE",
]);

/** Origine du tarif retenu lors de la résolution (traçabilité du montant). */
export const EcueRateOriginSchema = z.enum([
  "ecue_enseignant",
  "ecue_generique",
  "config_defaut",
]);

/* ======================= Séances — lecture ============================ */

export const ProfessionalSeancePaieSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  heure_debut: z.string().nullable(),
  heure_fin: z.string().nullable(),
  /** Durée RETENUE pour la paie : dérogation si elle existe, sinon horaires. */
  duree_heures: z.number().nullable(),
  /** Durée déduite des horaires. Reste le registre pédagogique, jamais réécrite. */
  duree_planifiee: z.number().nullable(),
  /** Dérogation comptable. NULL = aucune, la durée vient des horaires. */
  duree_payee: z.number().nullable(),
  duree_payee_le: z.string().nullable(),
  duree_payee_par_nom: z.string().nullable(),
  /** true = séance ajoutée depuis l'écran de paie, pas par l'enseignant. */
  saisie_comptable: z.boolean(),
  statut: ProfessionalSeanceStatutSchema,
  validated_at: z.string().nullable(),
  validated_by: z.string().uuid().nullable(),
  validated_by_nom: z.string().nullable(),
  /** Prédicat complet : realisee ET validée ET enseignant ET horaires. */
  payable: z.boolean(),
  blockers: z.array(SeanceBlockerSchema),
  enseignant_id: z.string().uuid().nullable(),
  enseignant_nom: z.string().nullable(),
  ecue_id: z.string().uuid(),
  ecue_code: z.string().nullable(),
  ecue_libelle: z.string().nullable(),
  ue_session_id: z.string().uuid(),
  cohorte_libelle: z.string().nullable(),
  /** Libellé libre saisi à la création de la séance (« Rattrapage du 12 »). */
  seance_libelle: z.string().nullable(),
  /** Semestre et filière portant la cohorte, via `professional_semestres`. */
  semestre_id: z.string().uuid().nullable(),
  semestre_libelle: z.string().nullable(),
  filiere_id: z.string().uuid().nullable(),
  filiere_nom: z.string().nullable(),
  /** Indice de réalisation, jamais une preuve : la validation reste humaine. */
  presences_saisies: z.number().int(),
  /** Paiement rattaché, s'il existe — verrouille la dévalidation. */
  paiement_id: z.string().uuid().nullable(),
  paiement_statut: z.string().nullable(),
});

/**
 * Booléen porté par une query string.
 *
 * z.coerce.boolean() applique Boolean(...) : la chaîne "false" y devient true.
 * Le filtre « Non payables » renvoyait donc exactement l'inverse de ce qu'il
 * annonçait, et l'onglet « À traiter » (validated=false) aurait listé les
 * séances déjà validées — soit précisément ce qu'il est censé écarter.
 */
const QueryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

/**
 * Année scolaire « AAAA-AAAA+1 », pivot septembre : une séance de septembre
 * 2025 comme une séance de mars 2026 appartiennent à « 2025-2026 ». Même
 * convention que professional-bulletin.service.ts et les écrans de présences.
 *
 * Les deux années doivent être consécutives : « 2025-2030 » ne désigne aucune
 * année scolaire et ne renverrait silencieusement aucune séance.
 */
export const AnneeScolaireSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, "Format attendu : AAAA-AAAA+1.")
  .refine((v) => {
    const [debut, fin] = v.split("-").map(Number);
    return fin === debut + 1;
  }, "Les deux années doivent être consécutives.");
export const ProfessionalSeancePaieQuerySchema = z.object({
  enseignantId: z.string().uuid().optional(),
  ueSessionId: z.string().uuid().optional(),
  ecueId: z.string().uuid().optional(),
  /** Filière portant la cohorte de la séance, via son semestre. */
  filiereId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * Dérivée de la date de la séance, jamais stockée. La calculer côté client
   * sur la page déjà chargée donnerait un total faux dès que la pagination
   * tronque : le découpage appartient donc à la requête.
   */
  anneeScolaire: AnneeScolaireSchema.optional(),
  statut: ProfessionalSeanceStatutSchema.optional(),
  validated: QueryBooleanSchema.optional(),
  payable: QueryBooleanSchema.optional(),
  /** Aide au rattrapage : séances passées dont la présence a été saisie. */
  hasAttendance: QueryBooleanSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ======================= Séances — écriture =========================== */

export const SetProfessionalSeanceStatutSchema = z.object({
  statut: ProfessionalSeanceStatutSchema,
});

export const ValidateProfessionalSeancesSchema = z.object({
  seanceIds: z.array(z.string().uuid()).min(1).max(500),
  validated: z.boolean(),
});

/**
 * Le lot est appliqué PARTIELLEMENT : les séances éligibles passent, les autres
 * sont rejetées avec leur motif. Faire échouer tout le lot sur une anomalie
 * bloquerait 200 séances pour une seule.
 */
export const ValidateProfessionalSeancesResultSchema = z.object({
  updated: z.number().int(),
  rejected: z.array(
    z.object({
      seanceId: z.string().uuid(),
      reason: SeanceBlockerSchema,
    })
  ),
});

/**
 * Dérogation comptable sur le volume horaire.
 * `duree` à `null` retire la dérogation et redonne la main aux horaires.
 */
export const SetSeanceDureePayeeSchema = z.object({
  duree: z.number().positive().max(24).nullable(),
});

/**
 * Ajout d'une séance depuis l'écran de paie. Horaires OU volume horaire :
 * l'un des deux suffit, mais pas aucun — sans durée, rien n'est payable.
 */
export const CreateSeanceComptableSchema = z
  .object({
    ue_session_id: z.string().uuid(),
    ecue_id: z.string().uuid(),
    enseignant_id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    heure_debut: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
    heure_fin: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
    duree_payee: z.number().positive().max(24).nullish(),
    libelle: z.string().max(300).nullish(),
  })
  .refine(
    (v) => (Boolean(v.heure_debut) && Boolean(v.heure_fin)) || Boolean(v.duree_payee),
    { message: "Renseignez des horaires complets ou un volume horaire." }
  );

/** Créneau d'emploi du temps attendu sans séance correspondante. */
export const SeanceManquanteSchema = z.object({
  ue_session_id: z.string().uuid(),
  ecue_id: z.string().uuid(),
  enseignant_id: z.string().uuid().nullable(),
  date: z.string(),
  heure_debut: z.string().nullable(),
  heure_fin: z.string().nullable(),
  duree_attendue: z.number().nullable(),
  ecue_code: z.string().nullable(),
  ecue_libelle: z.string().nullable(),
  cohorte_libelle: z.string().nullable(),
  enseignant_nom: z.string().nullable(),
});

/** Deux séances du même enseignant dont les créneaux se recoupent. */
export const SeanceOverlapSchema = z.object({
  enseignant_id: z.string().uuid(),
  enseignant_nom: z.string().nullable(),
  date: z.string(),
  seance_a_id: z.string().uuid(),
  seance_a_libelle: z.string().nullable(),
  seance_a_debut: z.string().nullable(),
  seance_a_fin: z.string().nullable(),
  seance_b_id: z.string().uuid(),
  seance_b_libelle: z.string().nullable(),
  seance_b_debut: z.string().nullable(),
  seance_b_fin: z.string().nullable(),
});

/* ==================== Tarifs horaires ECUE ============================ */

export const ProfessionalEcueHourlyRateSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ecue_id: z.string().uuid(),
  ecue_code: z.string().nullable().optional(),
  ecue_libelle: z.string().nullable().optional(),
  /** NULL = tarif générique de l'ECUE. Renseigné = nominatif, prioritaire. */
  enseignant_id: z.string().uuid().nullable(),
  enseignant_nom: z.string().nullable().optional(),
  montant_horaire: z.number(),
  devise: z.string(),
  valide_du: z.string(),
  valide_au: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateProfessionalEcueHourlyRateSchema = z.object({
  ecue_id: z.string().uuid(),
  enseignant_id: z.string().uuid().nullish(),
  montant_horaire: z.number().nonnegative(),
  devise: z.string().min(3).max(8).default("XOF"),
  valide_du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valide_au: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  notes: z.string().max(2000).nullish(),
});

export const UpdateProfessionalEcueHourlyRateSchema =
  CreateProfessionalEcueHourlyRateSchema.partial();

export const ProfessionalEcueHourlyRateQuerySchema = z.object({
  ecueId: z.string().uuid().optional(),
  enseignantId: z.string().uuid().optional(),
  /** Ne retourne que les tarifs valides à cette date. */
  activeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Résolution d'un tarif. Ordre figé :
 * (ecue, enseignant) → (ecue, NULL) → teacher_payment_configs.default_hourly_rate.
 * Aucun repli résoluble = anomalie explicite, jamais un montant nul silencieux.
 */
export const EcueRateResolutionSchema = z.object({
  montant_horaire: z.number(),
  devise: z.string(),
  origine: EcueRateOriginSchema,
  rate_id: z.string().uuid().nullable(),
});

export const EcueRateResolveQuerySchema = z.object({
  ecueId: z.string().uuid(),
  enseignantId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/* ============================== Types ================================= */

export type ProfessionalSeanceStatut = z.infer<typeof ProfessionalSeanceStatutSchema>;
export type SeanceBlocker = z.infer<typeof SeanceBlockerSchema>;
export type EcueRateOrigin = z.infer<typeof EcueRateOriginSchema>;

export type ProfessionalSeancePaie = z.infer<typeof ProfessionalSeancePaieSchema>;
export type ProfessionalSeancePaieQuery = z.infer<typeof ProfessionalSeancePaieQuerySchema>;
export type SetProfessionalSeanceStatut = z.infer<typeof SetProfessionalSeanceStatutSchema>;
export type ValidateProfessionalSeances = z.infer<typeof ValidateProfessionalSeancesSchema>;
export type ValidateProfessionalSeancesResult = z.infer<
  typeof ValidateProfessionalSeancesResultSchema
>;
export type SeanceOverlap = z.infer<typeof SeanceOverlapSchema>;
export type SetSeanceDureePayee = z.infer<typeof SetSeanceDureePayeeSchema>;
export type CreateSeanceComptable = z.infer<typeof CreateSeanceComptableSchema>;
export type SeanceManquante = z.infer<typeof SeanceManquanteSchema>;

export type ProfessionalEcueHourlyRate = z.infer<typeof ProfessionalEcueHourlyRateSchema>;
export type CreateProfessionalEcueHourlyRate = z.infer<
  typeof CreateProfessionalEcueHourlyRateSchema
>;
export type UpdateProfessionalEcueHourlyRate = z.infer<
  typeof UpdateProfessionalEcueHourlyRateSchema
>;
export type ProfessionalEcueHourlyRateQuery = z.infer<
  typeof ProfessionalEcueHourlyRateQuerySchema
>;
export type EcueRateResolution = z.infer<typeof EcueRateResolutionSchema>;
export type EcueRateResolveQuery = z.infer<typeof EcueRateResolveQuerySchema>;
