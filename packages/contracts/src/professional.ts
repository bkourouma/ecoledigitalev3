/**
 * Contrats partagés — Module Professionnel : Filière → UE → ECUE.
 * Features: 028-professional-module → 030-pedagogie-ue-ecue.
 *
 * Voir specs/030-pedagogie-ue-ecue/data-model.md et
 * specs/030-pedagogie-ue-ecue/contracts/professional-ue-ecue-api.md.
 *
 * Principe : UE = pôle ADMINISTRATIF (prix, UV, cohortes, inscription) ;
 *            ECUE = pôle PÉDAGOGIQUE (supports, devoirs, séances, présence).
 * La Filière est la table `programmes` (libellé métier), référencée par
 * `filiere_id` dans les tables pro.
 *
 * Convention : champs en snake_case ; dates/timestamps en chaînes ISO.
 */
import { z } from "zod";

/* ============================== Enums ================================= */

export const ProfessionalEcueStatutSchema = z.enum(["actif", "inactif"]);
export const ProfessionalUeStatutSchema = z.enum(["actif", "inactif"]);

export const ProfessionalUeSessionStatutSchema = z.enum([
  "brouillon",
  "ouvert",
  "complet",
  "en_cours",
  "termine",
  "annule",
]);

export const ProfessionalOrderStatutSchema = z.enum([
  "brouillon",
  "en_attente_paiement",
  "payee",
  "annulee",
]);

export const ProfessionalEnrollmentStatutSchema = z.enum([
  "en_attente_paiement",
  "confirmee",
  "terminee",
  "annulee",
]);

export const ProfessionalPaymentModeSchema = z.enum([
  "especes",
  "mobile_money",
  "virement",
  "autre",
]);

export const ProfessionalPaymentStatutSchema = z.enum([
  "initie",
  "confirme",
  "echoue",
  "rembourse",
]);

export const ProfessionalAttendanceStatutSchema = z.enum([
  "present",
  "absent",
  "retard",
  "excuse",
]);

export const ProfessionalUeResultStatutSchema = z.enum(["en_cours", "validee", "echec"]);

/* ======================= ECUE (pédagogie) ============================= */
/* Élément Constitutif d'UE — ex-Matière. SANS prix / nb_uv / filiere_id.   */

export const ProfessionalEcueSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  bilan_type_id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(100),
  libelle: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  credits: z.number().int().nonnegative().nullable().optional(),
  statut: ProfessionalEcueStatutSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateProfessionalEcueSchema = z.object({
  bilan_type_id: z.string().uuid().nullable().optional(),
  code: z.string().min(1, "Le code est requis").max(100),
  libelle: z.string().min(1, "Le libellé est requis").max(255),
  description: z.string().max(2000).nullable().optional(),
  credits: z.number().int().nonnegative("Les crédits doivent être >= 0").nullable().optional(),
  statut: ProfessionalEcueStatutSchema.optional(),
});

export const UpdateProfessionalEcueSchema = CreateProfessionalEcueSchema.partial();

/* ========================== UE (administratif) ======================== */
/* Unité d'Enseignement — porte prix / UV / filière.                       */

export const ProfessionalUeCategorieSchema = z.enum([
  "fondamentale",
  "specialite",
  "culture_generale",
]);

export const ProfessionalUeSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  filiere_id: z.string().uuid(),
  code: z.string().min(1).max(100),
  libelle: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  categorie: ProfessionalUeCategorieSchema.nullable().optional(),
  prix: z.number().min(0),
  devise: z.string(),
  nb_uv: z.number().int().min(0),
  statut: ProfessionalUeStatutSchema,
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateProfessionalUeSchema = z.object({
  filiere_id: z.string().uuid("filiere_id est requis"),
  code: z.string().min(1, "Le code est requis").max(100),
  libelle: z.string().min(1, "Le libellé est requis").max(255),
  description: z.string().max(2000).nullable().optional(),
  categorie: ProfessionalUeCategorieSchema.nullable().optional(),
  prix: z.number().min(0, "Le prix doit être >= 0").default(0),
  devise: z.string().min(1).max(10).optional(),
  nb_uv: z.number().int().min(0, "Le nombre d'UV doit être >= 0").default(0),
  statut: ProfessionalUeStatutSchema.optional(),
});

// filiere_id est figé après création (cohérence prérequis/diplôme « même filière »).
export const UpdateProfessionalUeSchema = CreateProfessionalUeSchema.omit({
  filiere_id: true,
}).partial();

/* ====================== Liaison UE ↔ ECUE ============================== */

export const ProfessionalUeEcueInputSchema = z.object({
  ecue_id: z.string().uuid("ecue_id est requis"),
  est_obligatoire: z.boolean().default(true),
  coefficient: z.number().positive("coefficient doit être > 0").default(1),
  ordre: z.number().int().min(0, "ordre doit être >= 0").default(0),
});

export const UpdateProfessionalUeEcueSchema = z
  .object({
    est_obligatoire: z.boolean(),
    coefficient: z.number().positive("coefficient doit être > 0"),
    ordre: z.number().int().min(0, "ordre doit être >= 0"),
  })
  .partial();

export const ProfessionalUeEcueSchema = z.object({
  id: z.string().uuid(),
  ue_id: z.string().uuid(),
  ecue_id: z.string().uuid(),
  ecue_code: z.string(),
  ecue_libelle: z.string(),
  est_obligatoire: z.boolean(),
  coefficient: z.number(),
  ordre: z.number().int(),
});

/* ====================== Prérequis entre UE ============================ */

export const ProfessionalUePrerequisiteSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
});

export const SetProfessionalUePrerequisitesSchema = z.object({
  prerequisite_ue_ids: z.array(z.string().uuid()).default([]),
});

export const ProfessionalUePrerequisitesStatusSchema = z.object({
  satisfait: z.boolean(),
  manquants: z.array(ProfessionalUePrerequisiteSchema),
});

/* ====================== Cohorte d'UE (session) ======================== */

const ProfessionalUeSessionInputBase = z.object({
  libelle: z.string().min(1, "Le libellé est requis").max(255),
  date_debut: z.string().min(1, "date_debut est requise"),
  date_fin: z.string().min(1, "date_fin est requise"),
  inscription_ouverte_le: z.string().min(1, "inscription_ouverte_le est requise"),
  inscription_fermee_le: z.string().min(1, "inscription_fermee_le est requise"),
  capacite_max: z.number().int().positive("capacite_max doit être > 0").nullable().optional(),
  enseignant_id: z.string().uuid().nullable().optional(),
  classroom_id: z.string().uuid().nullable().optional(),
});

export const CreateProfessionalUeSessionSchema = ProfessionalUeSessionInputBase
  .refine((d) => d.date_fin >= d.date_debut, {
    message: "date_fin doit être >= date_debut",
    path: ["date_fin"],
  })
  .refine((d) => d.inscription_fermee_le >= d.inscription_ouverte_le, {
    message: "inscription_fermee_le doit être >= inscription_ouverte_le",
    path: ["inscription_fermee_le"],
  });

export const UpdateProfessionalUeSessionSchema = ProfessionalUeSessionInputBase.partial();

export const ProfessionalUeSessionStatusTransitionSchema = z.object({
  statut: ProfessionalUeSessionStatutSchema,
});

export const ProfessionalUeSessionSchema = ProfessionalUeSessionInputBase.extend({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ue_id: z.string().uuid(),
  statut: ProfessionalUeSessionStatutSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

/* ====================== Semestre (regroupement de cohortes) ========== */
/* Un semestre appartient à une filière et regroupe des sessions d'UE (non    */
/* terminées) de cette filière. Une session peut figurer dans plusieurs       */
/* semestres.                                                                  */

export const CreateProfessionalSemestreSchema = z.object({
  filiere_id: z.string().uuid("filiere_id est requis"),
  libelle: z.string().min(1, "Le libellé est requis").max(255),
  ue_ids: z.array(z.string().uuid()).min(1, "Sélectionnez au moins une UE"),
});

// Création groupée : plusieurs semestres pour une même filière (3 par défaut).
export const CreateProfessionalSemestresBatchSchema = z.object({
  filiere_id: z.string().uuid("filiere_id est requis"),
  semestres: z
    .array(
      z.object({
        libelle: z.string().min(1, "Le libellé est requis").max(255),
        ue_ids: z.array(z.string().uuid()).min(1, "Sélectionnez au moins une UE"),
      })
    )
    .min(1, "Ajoutez au moins un semestre"),
});

/* Réouverture de sessions terminées : prolonge la date de fin et repasse en
   « ouvert » (sinon la finalisation auto les re-clôturerait). */
export const ReopenSessionsSchema = z.object({
  session_ids: z.array(z.string().uuid()).min(1, "Aucune session à rouvrir"),
  date_fin: z.string().min(1, "La nouvelle date de fin est requise"),
});

export const UpdateProfessionalSemestreSchema = z.object({
  libelle: z.string().min(1, "Le libellé est requis").max(255).optional(),
  // Remplace l'ensemble des UE du semestre quand fourni.
  ue_ids: z.array(z.string().uuid()).min(1, "Sélectionnez au moins une UE").optional(),
});

/* Création groupée de SESSIONS par semestre. Pour chaque bloc (= un semestre),
   on crée une session par UE du semestre, datée selon le bloc, et rattachée au
   semestre. Plusieurs blocs = plusieurs semestres (dates indépendantes), ce qui
   permet « un semestre » ou « toute la filière ». */
export const CreateSessionsBySemestreSchema = z.object({
  filiere_id: z.string().uuid("filiere_id est requis"),
  blocks: z
    .array(
      z.object({
        semestre_id: z.string().uuid(),
        libelle: z.string().min(1, "Le libellé est requis").max(200),
        date_debut: z.string().min(1, "date_debut est requise"),
        date_fin: z.string().min(1, "date_fin est requise"),
        inscription_ouverte_le: z.string().min(1),
        inscription_fermee_le: z.string().min(1),
        capacite_max: z.number().int().positive().nullable().optional(),
        statut: z.enum(["brouillon", "ouvert"]).optional(),
        // Affectation enseignant par ECUE (appliquée aux sessions créées).
        ecue_teachers: z
          .array(
            z.object({
              ecue_id: z.string().uuid(),
              enseignant_id: z.string().uuid(),
            })
          )
          .optional(),
      })
    )
    .min(1, "Sélectionnez au moins un semestre"),
});

export const ProfessionalSemestreSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  filiere_id: z.string().uuid(),
  libelle: z.string(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Élément de la liste des semestres (avec filière, nombre de sessions et d'UV).
export const ProfessionalSemestreListItemSchema = ProfessionalSemestreSchema.extend({
  filiere_nom: z.string().nullable().optional(),
  nb_sessions: z.number().int().min(0),
  nb_uv: z.number().int().min(0),
});

// Session rattachée à un semestre (vue détail / édition).
export const ProfessionalSemestreSessionSchema = z.object({
  id: z.string().uuid(),
  ue_id: z.string().uuid(),
  ue_code: z.string().nullable().optional(),
  ue_libelle: z.string().nullable().optional(),
  libelle: z.string(),
  date_debut: z.string(),
  date_fin: z.string(),
  statut: ProfessionalUeSessionStatutSchema,
  nb_uv: z.number().int().min(0).optional(),
  nb_inscrits: z.number().int().min(0).optional(),
});

// Détail d'un semestre : infos + sessions + agrégats (tableau de bord).
export const ProfessionalSemestreDetailSchema = ProfessionalSemestreSchema.extend({
  filiere_nom: z.string().nullable().optional(),
  nb_sessions: z.number().int().min(0),
  nb_ue: z.number().int().min(0),
  nb_uv: z.number().int().min(0),
  nb_inscrits: z.number().int().min(0),
  statut_counts: z.record(z.string(), z.number().int().min(0)),
  sessions: z.array(ProfessionalSemestreSessionSchema),
});

/* ====================== Emploi du temps (hebdomadaire) =============== */
/* Pour une ECUE programmée (session d'UE), jour de la semaine + créneau, sur
   toute la période de la session. Consulté par filière + semestre. */
export const CreateEmploiTempsSlotSchema = z.object({
  ue_session_id: z.string().uuid("ue_session_id est requis"),
  ecue_id: z.string().uuid("ecue_id est requis"),
  jour: z.number().int().min(1).max(7), // 1 = Lundi … 7 = Dimanche
  heure_debut: z.string().min(1, "heure_debut est requise"), // "HH:MM"
  heure_fin: z.string().min(1, "heure_fin est requise"),
  date_debut: z.string().min(1, "date_debut est requise"), // "YYYY-MM-DD"
  date_fin: z.string().min(1, "date_fin est requise"),
  enseignant_id: z.string().uuid().nullable().optional(),
  classroom_id: z.string().uuid().nullable().optional(),
});

export const UpdateEmploiTempsSlotSchema = z.object({
  jour: z.number().int().min(1).max(7).optional(),
  heure_debut: z.string().min(1).optional(),
  heure_fin: z.string().min(1).optional(),
  date_debut: z.string().min(1).optional(),
  date_fin: z.string().min(1).optional(),
  enseignant_id: z.string().uuid().nullable().optional(),
  classroom_id: z.string().uuid().nullable().optional(),
});

export type CreateEmploiTempsSlot = z.infer<typeof CreateEmploiTempsSlotSchema>;
export type UpdateEmploiTempsSlot = z.infer<typeof UpdateEmploiTempsSlotSchema>;

/* ====================== Planning des cours =========================== */
/* Créneau (date_debut → date_fin) pour un ECUE d'une session d'UE ouverte.    */

const ProfessionalCoursePlanningInputBase = z.object({
  ue_session_id: z.string().uuid("La session est requise"),
  ecue_id: z.string().uuid("L'ECUE est requis"),
  titre: z.string().max(255).nullable().optional(),
  // Planification détaillée : un jour + heure de début (+ heure de fin optionnelle).
  date: z.string().min(1, "La date est requise"),
  heure_debut: z.string().min(1, "L'heure de début est requise"),
  heure_fin: z.string().nullable().optional(),
});

export const CreateProfessionalCoursePlanningSchema = ProfessionalCoursePlanningInputBase.refine(
  (d) => !d.heure_fin || d.heure_fin > d.heure_debut,
  { message: "L'heure de fin doit être postérieure à l'heure de début", path: ["heure_fin"] }
);

export const UpdateProfessionalCoursePlanningSchema = z
  .object({
    titre: z.string().max(255).nullable().optional(),
    date: z.string().min(1).optional(),
    heure_debut: z.string().min(1).optional(),
    heure_fin: z.string().nullable().optional(),
  })
  .refine((d) => !d.heure_debut || !d.heure_fin || d.heure_fin > d.heure_debut, {
    message: "L'heure de fin doit être postérieure à l'heure de début",
    path: ["heure_fin"],
  });

export const ProfessionalCoursePlanningSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ue_session_id: z.string().uuid(),
  ecue_id: z.string().uuid(),
  enseignant_id: z.string().uuid().nullable().optional(),
  titre: z.string().nullable().optional(),
  date: z.string(),
  heure_debut: z.string(),
  heure_fin: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

/* ====================== Séance d'ECUE ================================= */

const ProfessionalEcueSeanceInputBase = z.object({
  ecue_id: z.string().uuid("ecue_id est requis"),
  libelle: z.string().max(255).nullable().optional(),
  date: z.string().min(1, "date est requise"),
  heure_debut: z.string().nullable().optional(),
  heure_fin: z.string().nullable().optional(),
  enseignant_id: z.string().uuid().nullable().optional(),
  classroom_id: z.string().uuid().nullable().optional(),
});

export const CreateProfessionalEcueSeanceSchema = ProfessionalEcueSeanceInputBase;

export const UpdateProfessionalEcueSeanceSchema = ProfessionalEcueSeanceInputBase
  .omit({ ecue_id: true })
  .partial();

export const ProfessionalEcueSeanceSchema = ProfessionalEcueSeanceInputBase.extend({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ue_session_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

/* ============ Affectation enseignant ↔ (session, ECUE) =============== */

export const SetSessionEcueTeacherSchema = z.object({
  ecue_id: z.string().uuid("ecue_id est requis"),
  // null = retirer l'affectation de cet ECUE.
  enseignant_id: z.string().uuid().nullable(),
});

export type SetSessionEcueTeacher = z.infer<typeof SetSessionEcueTeacherSchema>;

/* ====================== Présence (par séance) ======================== */

export const MarkProfessionalAttendanceItemSchema = z.object({
  student_id: z.string().uuid("student_id est requis"),
  statut: ProfessionalAttendanceStatutSchema,
});

export const MarkProfessionalAttendanceSchema = z.object({
  entries: z.array(MarkProfessionalAttendanceItemSchema).default([]),
});

/**
 * Justification administrative d'une absence : `justifiee` fait passer le
 * pointage de `absent` à `excuse` (la valeur que le bulletin compte comme
 * « absence justifiée ») avec son motif ; `false` fait le chemin inverse et
 * efface le motif.
 */
export const JustifyProfessionalAbsenceSchema = z.object({
  justifiee: z.boolean(),
  motif: z.string().trim().max(500, "Motif trop long (500 caractères maximum)").optional(),
});

export const ProfessionalEcueAttendanceSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  seance_id: z.string().uuid(),
  student_id: z.string().uuid(),
  statut: ProfessionalAttendanceStatutSchema,
  marked_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

/* ====================== Résultat ECUE ================================ */

export const ProfessionalEcueResultSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ecue_id: z.string().uuid(),
  student_id: z.string().uuid(),
  ue_session_id: z.string().uuid(),
  moyenne: z.number().nullable(),
  moyenne_devoirs: z.number().nullable().optional(),
  note_examen: z.number().nullable().optional(),
  eliminee: z.boolean().optional(),
  note_source: z.enum(["auto", "manuel", "mixte", "aucune"]).optional(),
  validee: z.boolean(),
  validee_manuellement: z.boolean(),
  valide_par: z.string().uuid().nullable().optional(),
  date_validation: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Validation manuelle (override) : validee=true même si moyenne < seuil.
export const ValidateProfessionalEcueResultSchema = z.object({
  validee: z.boolean(),
});

/* ================= Saisie manuelle de notes par ECUE ================= */

export const ProfessionalNoteNatureSchema = z.enum(["devoir", "examen"]);

// Saisie manuelle d'une note (devoir ou examen) directement sur une ECUE,
// sans passer par une évaluation. L'examen est unique par (ECUE, étudiant,
// cohorte, session). `session` : 1 = session normale, 2 = rattrapage (LMD).
export const CreateEcueManualNoteSchema = z.object({
  ecue_id: z.string().uuid(),
  student_id: z.string().uuid(),
  ue_session_id: z.string().uuid(),
  nature: ProfessionalNoteNatureSchema,
  libelle: z.string().max(255).nullable().optional(),
  note: z.number().min(0),
  note_max: z.number().positive().default(20),
  session: z.number().int().min(1).max(2).default(1),
});

export const UpdateEcueManualNoteSchema = z.object({
  libelle: z.string().max(255).nullable().optional(),
  note: z.number().min(0).optional(),
  note_max: z.number().positive().optional(),
});

export const ProfessionalEcueNoteSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ecue_id: z.string().uuid(),
  student_id: z.string().uuid(),
  ue_session_id: z.string().uuid(),
  nature: ProfessionalNoteNatureSchema,
  libelle: z.string().nullable().optional(),
  note: z.number(),
  note_max: z.number(),
  saisi_par: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

/* ============================== Bulletin ============================== */

export const BulletinEcueStatutSchema = z.enum([
  "valide",
  "compense",
  "insuffisant",
  "eliminatoire",
  "en_cours",
]);

export const BulletinDecisionSchema = z.enum(["admis", "ajourne", "rattrapage"]);

// Ligne ECUE d'un bulletin.
export const BulletinLineEcueSchema = z.object({
  ecue_id: z.string().uuid(),
  code: z.string().nullable().optional(),
  libelle: z.string().nullable().optional(),
  credits: z.number().int().nullable().optional(),
  moyenne_devoirs: z.number().nullable(),
  note_examen: z.number().nullable(),
  note_ecue: z.number().nullable(),
  validee: z.boolean(),
  validee_manuellement: z.boolean().optional(),
  statut: BulletinEcueStatutSchema,
  result_id: z.string().uuid().nullable().optional(),
});

// Ligne UE d'un bulletin (avec ses ECUE).
export const BulletinLineUeSchema = z.object({
  ue_id: z.string().uuid(),
  ue_session_id: z.string().uuid().nullable().optional(),
  code: z.string().nullable().optional(),
  libelle: z.string().nullable().optional(),
  credits: z.number().int(),
  nb_uv: z.number().int().nullable().optional(),
  moyenne_ue: z.number().nullable(),
  validee: z.boolean(),
  motifs: z.array(z.string()),
  ecues: z.array(BulletinLineEcueSchema),
});

// Bulletin complet d'un étudiant pour un semestre.
export const BulletinSchema = z.object({
  student: z.object({
    id: z.string().uuid(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    matricule: z.string().nullable().optional(),
  }),
  filiere: z.object({
    id: z.string().uuid().nullable().optional(),
    name: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  }),
  semestre: z.object({
    id: z.string().uuid(),
    libelle: z.string(),
  }),
  ues: z.array(BulletinLineUeSchema),
  moyenne_session: z.number().nullable(),
  credits_valides: z.number().int(),
  credits_total: z.number().int(),
  semestre_valide: z.boolean(),
  decision: BulletinDecisionSchema,
});

// Ligne du tableau récapitulatif (filière/semestre).
export const BulletinRosterItemSchema = z.object({
  student_id: z.string().uuid(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  matricule: z.string().nullable().optional(),
  moyenne_session: z.number().nullable(),
  credits_valides: z.number().int(),
  credits_total: z.number().int(),
  semestre_valide: z.boolean(),
  decision: BulletinDecisionSchema,
});

/* ====================== Capitalisation UV par UE ===================== */

export const StudentProfessionalUeResultSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  ue_id: z.string().uuid(),
  student_id: z.string().uuid(),
  ue_session_id: z.string().uuid().nullable().optional(),
  statut: ProfessionalUeResultStatutSchema,
  uv_acquises: z.number().int().min(0),
  date_validation: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

/* ========================== Commande / Panier ========================= */

export const ProfessionalCartItemSchema = z.object({
  ue_session_id: z.string().uuid("ue_session_id est requis"),
});

/** Inscription directe d'un étudiant à une session par un administrateur. */
export const AdminEnrollStudentSchema = z.object({
  student_id: z.string().uuid("student_id est requis"),
});
export type AdminEnrollStudent = z.infer<typeof AdminEnrollStudentSchema>;

/** Mise à jour du statut d'une inscription par un administrateur. */
export const AdminUpdateEnrollmentSchema = z.object({
  statut: ProfessionalEnrollmentStatutSchema,
});
export type AdminUpdateEnrollment = z.infer<typeof AdminUpdateEnrollmentSchema>;

/** Enregistrement d'un paiement (partiel possible) par un administrateur. */
export const AdminRecordPaymentSchema = z.object({
  montant: z.number().positive("Le montant doit être positif"),
  mode: ProfessionalPaymentModeSchema,
  reference_transaction: z.string().max(255).optional().or(z.literal("")),
});
export type AdminRecordPayment = z.infer<typeof AdminRecordPaymentSchema>;

/** Paiement d'un étudiant réparti sur plusieurs inscriptions (un lot). */
export const AdminRecordStudentPaymentSchema = z.object({
  enrollment_ids: z.array(z.string().uuid()).min(1, "Au moins une inscription est requise."),
  montant: z.number().positive("Le montant doit être positif"),
  mode: ProfessionalPaymentModeSchema,
  reference_transaction: z.string().max(255).optional().or(z.literal("")),
});
export type AdminRecordStudentPayment = z.infer<typeof AdminRecordStudentPaymentSchema>;

/** Liste d'ids d'inscriptions (ex. historique fusionné des paiements). */
export const EnrollmentIdsSchema = z.object({
  enrollment_ids: z.array(z.string().uuid()).min(1),
});

/** Inscription en lot : N étudiants × M sessions. */
export const AdminEnrollBulkSchema = z.object({
  ue_session_ids: z.array(z.string().uuid()).min(1, "Au moins une session est requise."),
  student_ids: z.array(z.string().uuid()).min(1, "Au moins un étudiant est requis."),
});
export type AdminEnrollBulk = z.infer<typeof AdminEnrollBulkSchema>;

export const ProfessionalOrderSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  student_id: z.string().uuid(),
  reference: z.string(),
  montant_total: z.number().min(0),
  devise: z.string(),
  statut: ProfessionalOrderStatutSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

/* ============================= Inscription ============================ */

export const ProfessionalEnrollmentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  order_id: z.string().uuid(),
  student_id: z.string().uuid(),
  ue_session_id: z.string().uuid(),
  prix_unitaire: z.number().min(0),
  statut: ProfessionalEnrollmentStatutSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

/* ============================== Paiement ============================== */

export const ProfessionalPaymentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  order_id: z.string().uuid(),
  montant: z.number().min(0),
  mode: ProfessionalPaymentModeSchema,
  reference_transaction: z.string().nullable().optional(),
  statut: ProfessionalPaymentStatutSchema,
  paid_at: z.string().nullable().optional(),
  receipt_number: z.string().nullable().optional(),
  receipt_url: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateProfessionalPaymentSchema = z.object({
  mode: ProfessionalPaymentModeSchema,
  reference_transaction: z.string().min(1).max(255).optional(),
});

/* ===================== Vues agrégées côté étudiant ==================== */
/* Catalogue : Filière → UE inscriptibles → ECUE.                          */

export const ProfessionalFiliereOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable().optional(),
  nb_ue_inscriptibles: z.number().int().min(0),
});

export const ProfessionalCatalogSessionSchema = z.object({
  id: z.string().uuid(),
  libelle: z.string(),
  date_debut: z.string(),
  date_fin: z.string(),
  inscription_ouverte_le: z.string(),
  inscription_fermee_le: z.string(),
  capacite_max: z.number().int().nullable(),
  places_restantes: z.number().int().nullable(),
  statut: ProfessionalUeSessionStatutSchema,
  inscriptible: z.boolean(),
  // L'étudiant a déjà une inscription active sur cette cohorte → l'UI affiche « Validé ».
  deja_inscrit: z.boolean().optional(),
});

// ECUE incluse dans une UE (vue catalogue : pédagogie débloquée par l'achat).
export const ProfessionalCatalogEcueSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  est_obligatoire: z.boolean(),
  coefficient: z.number(),
  ordre: z.number().int(),
});

export const ProfessionalCatalogItemSchema = z.object({
  ue: ProfessionalUeSchema.pick({
    id: true,
    code: true,
    libelle: true,
    nb_uv: true,
    prix: true,
    devise: true,
    filiere_id: true,
  }),
  ecue: z.array(ProfessionalCatalogEcueSchema),
  sessions: z.array(ProfessionalCatalogSessionSchema),
  prerequisites_status: ProfessionalUePrerequisitesStatusSchema,
  verrouille: z.boolean(),
});

/* ============================ Type exports ============================ */

export type ProfessionalEcueStatut = z.infer<typeof ProfessionalEcueStatutSchema>;
export type ProfessionalUeStatut = z.infer<typeof ProfessionalUeStatutSchema>;
export type ProfessionalUeSessionStatut = z.infer<typeof ProfessionalUeSessionStatutSchema>;
export type ProfessionalOrderStatut = z.infer<typeof ProfessionalOrderStatutSchema>;
export type ProfessionalEnrollmentStatut = z.infer<typeof ProfessionalEnrollmentStatutSchema>;
export type ProfessionalPaymentMode = z.infer<typeof ProfessionalPaymentModeSchema>;
export type ProfessionalPaymentStatut = z.infer<typeof ProfessionalPaymentStatutSchema>;
export type ProfessionalAttendanceStatut = z.infer<typeof ProfessionalAttendanceStatutSchema>;
export type ProfessionalUeResultStatut = z.infer<typeof ProfessionalUeResultStatutSchema>;

export type ProfessionalEcue = z.infer<typeof ProfessionalEcueSchema>;
export type CreateProfessionalEcue = z.infer<typeof CreateProfessionalEcueSchema>;
export type UpdateProfessionalEcue = z.infer<typeof UpdateProfessionalEcueSchema>;

export type ProfessionalUe = z.infer<typeof ProfessionalUeSchema>;
export type CreateProfessionalUe = z.infer<typeof CreateProfessionalUeSchema>;
export type UpdateProfessionalUe = z.infer<typeof UpdateProfessionalUeSchema>;

export type ProfessionalUeEcueInput = z.infer<typeof ProfessionalUeEcueInputSchema>;
export type UpdateProfessionalUeEcue = z.infer<typeof UpdateProfessionalUeEcueSchema>;
export type ProfessionalUeEcue = z.infer<typeof ProfessionalUeEcueSchema>;

export type ProfessionalUePrerequisite = z.infer<typeof ProfessionalUePrerequisiteSchema>;
export type SetProfessionalUePrerequisites = z.infer<typeof SetProfessionalUePrerequisitesSchema>;
export type ProfessionalUePrerequisitesStatus = z.infer<typeof ProfessionalUePrerequisitesStatusSchema>;

export type ProfessionalUeSession = z.infer<typeof ProfessionalUeSessionSchema>;
export type CreateProfessionalUeSession = z.infer<typeof CreateProfessionalUeSessionSchema>;
export type UpdateProfessionalUeSession = z.infer<typeof UpdateProfessionalUeSessionSchema>;
export type ProfessionalUeSessionStatusTransition = z.infer<
  typeof ProfessionalUeSessionStatusTransitionSchema
>;

export type CreateProfessionalSemestre = z.infer<typeof CreateProfessionalSemestreSchema>;
export type CreateProfessionalSemestresBatch = z.infer<typeof CreateProfessionalSemestresBatchSchema>;
export type CreateSessionsBySemestre = z.infer<typeof CreateSessionsBySemestreSchema>;
export type ReopenSessions = z.infer<typeof ReopenSessionsSchema>;
export type UpdateProfessionalSemestre = z.infer<typeof UpdateProfessionalSemestreSchema>;
export type ProfessionalSemestre = z.infer<typeof ProfessionalSemestreSchema>;
export type ProfessionalSemestreListItem = z.infer<typeof ProfessionalSemestreListItemSchema>;
export type ProfessionalSemestreSession = z.infer<typeof ProfessionalSemestreSessionSchema>;
export type ProfessionalSemestreDetail = z.infer<typeof ProfessionalSemestreDetailSchema>;

export type CreateProfessionalCoursePlanning = z.infer<
  typeof CreateProfessionalCoursePlanningSchema
>;
export type UpdateProfessionalCoursePlanning = z.infer<
  typeof UpdateProfessionalCoursePlanningSchema
>;
export type ProfessionalCoursePlanning = z.infer<typeof ProfessionalCoursePlanningSchema>;

export type ProfessionalEcueSeance = z.infer<typeof ProfessionalEcueSeanceSchema>;
export type CreateProfessionalEcueSeance = z.infer<typeof CreateProfessionalEcueSeanceSchema>;
export type UpdateProfessionalEcueSeance = z.infer<typeof UpdateProfessionalEcueSeanceSchema>;

export type MarkProfessionalAttendanceItem = z.infer<typeof MarkProfessionalAttendanceItemSchema>;
export type MarkProfessionalAttendance = z.infer<typeof MarkProfessionalAttendanceSchema>;
export type JustifyProfessionalAbsence = z.infer<typeof JustifyProfessionalAbsenceSchema>;
export type ProfessionalEcueAttendance = z.infer<typeof ProfessionalEcueAttendanceSchema>;

export type ProfessionalEcueResult = z.infer<typeof ProfessionalEcueResultSchema>;
export type ValidateProfessionalEcueResult = z.infer<typeof ValidateProfessionalEcueResultSchema>;
export type StudentProfessionalUeResult = z.infer<typeof StudentProfessionalUeResultSchema>;

export type ProfessionalNoteNature = z.infer<typeof ProfessionalNoteNatureSchema>;
export type CreateEcueManualNote = z.infer<typeof CreateEcueManualNoteSchema>;
export type UpdateEcueManualNote = z.infer<typeof UpdateEcueManualNoteSchema>;
export type ProfessionalEcueNote = z.infer<typeof ProfessionalEcueNoteSchema>;
export type BulletinEcueStatut = z.infer<typeof BulletinEcueStatutSchema>;
export type BulletinDecision = z.infer<typeof BulletinDecisionSchema>;
export type BulletinLineEcue = z.infer<typeof BulletinLineEcueSchema>;
export type BulletinLineUe = z.infer<typeof BulletinLineUeSchema>;
export type Bulletin = z.infer<typeof BulletinSchema>;
export type BulletinRosterItem = z.infer<typeof BulletinRosterItemSchema>;

export type ProfessionalCartItem = z.infer<typeof ProfessionalCartItemSchema>;
export type ProfessionalOrder = z.infer<typeof ProfessionalOrderSchema>;
export type ProfessionalEnrollment = z.infer<typeof ProfessionalEnrollmentSchema>;

export type ProfessionalPayment = z.infer<typeof ProfessionalPaymentSchema>;
export type CreateProfessionalPayment = z.infer<typeof CreateProfessionalPaymentSchema>;

export type ProfessionalFiliereOption = z.infer<typeof ProfessionalFiliereOptionSchema>;
export type ProfessionalCatalogSession = z.infer<typeof ProfessionalCatalogSessionSchema>;
export type ProfessionalCatalogEcue = z.infer<typeof ProfessionalCatalogEcueSchema>;
export type ProfessionalCatalogItem = z.infer<typeof ProfessionalCatalogItemSchema>;
