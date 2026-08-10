import { z } from "zod";

/**
 * Statistiques propriétaire du Module Professionnel (LMD : filière → semestre → UE → ECUE).
 *
 * Complète owner.schema.ts, qui ne couvre que le module académique classique
 * (classes / courses / payment_transactions).
 *
 * Toutes les agrégations sont faites en SQL côté API : ces schémas décrivent
 * des données déjà agrégées, jamais des lignes brutes à recalculer côté client.
 */

/* -------------------------------------------------------------------------- */
/*  Filtres communs                                                            */
/* -------------------------------------------------------------------------- */

/** Catégorie d'UE (colonne `professional_ue.categorie`, nullable en base). */
export const OwnerUeCategorieSchema = z.enum([
  "fondamentale",
  "specialite",
  "culture_generale",
]);

/**
 * Année scolaire au format `2025-2026`, dérivée par pivot septembre sur
 * `professional_ue_sessions.date_debut`. Ce n'est PAS une colonne en base.
 */
export const OwnerAcademicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, "Format attendu : 2025-2026");

/* -------------------------------------------------------------------------- */
/*  5.A — /owner/pedagogie                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerPedagogieQuerySchema = z.object({
  /** Année scolaire `YYYY-YYYY` (pivot septembre). Absente ⇒ toutes années. */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  /** Filières (= `programmes.id`). Vide ou absent ⇒ toutes filières. */
  filiereIds: z.array(z.string().uuid()).optional(),
  semestreId: z.string().uuid().optional(),
  /** Statut des sessions d'UE du périmètre. */
  statut: z.enum(["en_cours", "termine", "tous"]).optional().default("tous"),
  categorie: OwnerUeCategorieSchema.optional(),
});

export const OwnerPedagogieKpisSchema = z.object({
  /** Nombre de bulletins du périmètre — dénominateur de tous les taux ci-dessous. */
  bulletinCount: z.number().int().nonnegative(),
  /** count(decision='admis') / count(*) — en %. */
  successRate: z.number(),
  /** avg((data->>'moyenne_session')::float8) — sur 20. */
  averageGrade: z.number(),
  /** Σ credits_valides / Σ credits_total — en %. */
  creditsRate: z.number(),
  creditsValidated: z.number().int().nonnegative(),
  creditsTotal: z.number().int().nonnegative(),
  /** count(decision='rattrapage') / count(*) — en %. */
  retakeRate: z.number(),
  /** count(statut='definitif') / count(*) — en %. */
  finalBulletinRate: z.number(),
});

export const OwnerPedagogieDecisionRowSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  admis: z.number().int().nonnegative(),
  rattrapage: z.number().int().nonnegative(),
  ajourne: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const OwnerPedagogieSemestreAverageSchema = z.object({
  semestreId: z.string().uuid(),
  semestreLabel: z.string(),
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  averageGrade: z.number(),
  studentCount: z.number().int().nonnegative(),
});

export const OwnerPedagogieFailedEcueSchema = z.object({
  ecueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  /** Résultats avec une moyenne renseignée (ECUE non commencées exclues). */
  evaluated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Sous-ensemble de `failed` : moyenne < 5 (`eliminee = true`). */
  eliminated: z.number().int().nonnegative(),
  failRate: z.number(),
});

export const OwnerPedagogieUeHealthSchema = z.object({
  ueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  filiereName: z.string(),
  categorie: OwnerUeCategorieSchema.nullable(),
  studentCount: z.number().int().nonnegative(),
  averageGrade: z.number().nullable(),
  validationRate: z.number(),
  eliminatedRate: z.number(),
  /** Part des validations obtenues en session 2 (`session_obtention = 2`). */
  session2Rate: z.number(),
});

/** Tranches figées côté SQL — l'ordre porte le sens, il est conservé. */
export const OwnerPedagogieGradeBucketSchema = z.object({
  bucket: z.enum(["<5", "5-8", "8-10", "10-12", "12-14", "14-16", ">16"]),
  count: z.number().int().nonnegative(),
});

export const OwnerPedagogieSession2Schema = z.object({
  validatedTotal: z.number().int().nonnegative(),
  validatedSession2: z.number().int().nonnegative(),
  rate: z.number(),
});

export const OwnerPedagogieResponseSchema = z.object({
  /** Filtres réellement appliqués, ré-exposés pour l'affichage. */
  anneeScolaire: OwnerAcademicYearSchema.nullable(),
  filiereIds: z.array(z.string().uuid()),
  semestreId: z.string().uuid().nullable(),
  statut: z.enum(["en_cours", "termine", "tous"]),
  categorie: OwnerUeCategorieSchema.nullable(),
  kpis: OwnerPedagogieKpisSchema,
  decisionsByFiliere: z.array(OwnerPedagogieDecisionRowSchema),
  averagesBySemestre: z.array(OwnerPedagogieSemestreAverageSchema),
  topFailedEcue: z.array(OwnerPedagogieFailedEcueSchema),
  ueHealth: z.array(OwnerPedagogieUeHealthSchema),
  gradeDistribution: z.array(OwnerPedagogieGradeBucketSchema),
  session2: OwnerPedagogieSession2Schema,
});

/* -------------------------------------------------------------------------- */
/*  5.B — /owner/finances/professionnel                                        */
/* -------------------------------------------------------------------------- */

export const OwnerFinancesProPeriodSchema = z.enum([
  "month",
  "quarter",
  "year",
  "academic_year",
  "custom",
]);

export const OwnerFinancesProModeSchema = z.enum([
  "especes",
  "mobile_money",
  "virement",
  "autre",
]);

export const OwnerFinancesProQuerySchema = z.object({
  period: OwnerFinancesProPeriodSchema.optional().default("year"),
  /** Requis (et seulement lus) quand period = 'custom'. Format `YYYY-MM-DD`. */
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  semestreId: z.string().uuid().optional(),
  mode: OwnerFinancesProModeSchema.optional(),
  /** État de règlement de l'étudiant, appliqué au tableau des impayés. */
  etat: z.enum(["non_regle", "partiel", "solde", "tous"]).optional().default("tous"),
});

export const OwnerFinancesProTotalsSchema = z.object({
  /** Σ professional_orders.montant_total, hors commandes `annulee`. */
  expected: z.number(),
  /** Σ professional_payments.montant WHERE statut = 'confirme'. */
  collected: z.number(),
  /** collected / expected — en %. */
  recoveryRate: z.number(),
  /** max(0, expected − collected). */
  outstanding: z.number(),
  /** Étudiants dont le reste dû dépasse 0,5 FCFA (tolérance d'arrondi). */
  unsettledStudents: z.number().int().nonnegative(),
});

export const OwnerFinancesProMonthlySchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  amount: z.number(),
  /**
   * Transactions *métier*, groupées par (student_id, paid_at) :
   * un règlement unique produit N lignes payments, une par commande touchée.
   */
  transactionCount: z.number().int().nonnegative(),
});

export const OwnerFinancesProModeRowSchema = z.object({
  mode: OwnerFinancesProModeSchema,
  amount: z.number(),
  count: z.number().int().nonnegative(),
});

export const OwnerFinancesProRecoveryRowSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  expected: z.number(),
  collected: z.number(),
  recoveryRate: z.number(),
});

export const OwnerFinancesProUnpaidRowSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  matricule: z.string().nullable(),
  filiereNames: z.string().nullable(),
  due: z.number(),
  paid: z.number(),
  outstanding: z.number(),
  /** Date de la plus ancienne commande non soldée (`YYYY-MM-DD`). */
  oldestUnpaidAt: z.string().nullable(),
});

export const OwnerFinancesProUeRevenueSchema = z.object({
  ueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  filiereName: z.string(),
  confirmedEnrollments: z.number().int().nonnegative(),
  revenue: z.number(),
});

export const OwnerFinancesProFunnelSchema = z.object({
  created: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export const OwnerFinancesProResponseSchema = z.object({
  period: OwnerFinancesProPeriodSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  filiereIds: z.array(z.string().uuid()),
  semestreId: z.string().uuid().nullable(),
  mode: OwnerFinancesProModeSchema.nullable(),
  etat: z.enum(["non_regle", "partiel", "solde", "tous"]),
  /**
   * Décision produit : les UE « Conduite » sont INCLUSES ici (c'est du CA réel),
   * alors que l'écran admin /professionnel/admin/paiements les exclut.
   * Le front affiche cet écart en note de bas de tableau.
   */
  includesConduite: z.literal(true),
  totals: OwnerFinancesProTotalsSchema,
  monthlyCollections: z.array(OwnerFinancesProMonthlySchema),
  byPaymentMode: z.array(OwnerFinancesProModeRowSchema),
  recoveryByFiliere: z.array(OwnerFinancesProRecoveryRowSchema),
  topUnpaid: z.array(OwnerFinancesProUnpaidRowSchema),
  revenueByUe: z.array(OwnerFinancesProUeRevenueSchema),
  enrollmentFunnel: OwnerFinancesProFunnelSchema,
});

/* -------------------------------------------------------------------------- */
/*  Référentiel des filtres (alimente les sélecteurs des pages owner)          */
/* -------------------------------------------------------------------------- */

export const OwnerStatsFiliereOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  cycleName: z.string().nullable(),
});

export const OwnerStatsSemestreOptionSchema = z.object({
  id: z.string().uuid(),
  libelle: z.string(),
  filiereId: z.string().uuid(),
});

export const OwnerStatsCycleOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
});

/**
 * Année académique du module ACADÉMIQUE — une vraie ligne en base, à ne pas
 * confondre avec `anneesScolaires`, qui est une chaîne dérivée par pivot septembre
 * pour le module professionnel.
 */
export const OwnerStatsAcademicYearOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

export const OwnerStatsFiltersResponseSchema = z.object({
  filieres: z.array(OwnerStatsFiliereOptionSchema),
  semestres: z.array(OwnerStatsSemestreOptionSchema),
  anneesScolaires: z.array(OwnerAcademicYearSchema),
  cycles: z.array(OwnerStatsCycleOptionSchema),
  academicYears: z.array(OwnerStatsAcademicYearOptionSchema),
});

/* -------------------------------------------------------------------------- */
/*  5.D — /owner/referentiel                                                   */
/* -------------------------------------------------------------------------- */

export const OwnerReferentielQuerySchema = z.object({
  cycleId: z.string().uuid().optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  categorie: OwnerUeCategorieSchema.optional(),
});

export const OwnerReferentielKpisSchema = z.object({
  activeCycles: z.number().int().nonnegative(),
  activeFilieres: z.number().int().nonnegative(),
  activeUe: z.number().int().nonnegative(),
  activeEcue: z.number().int().nonnegative(),
  /** Moyenne de Σ crédits des ECUE par semestre. `null` si aucun semestre. */
  avgCreditsPerSemestre: z.number().nullable(),
});

export const OwnerReferentielFiliereRowSchema = z.object({
  filiereId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  cycleName: z.string().nullable(),
  domaine: z.string().nullable(),
  semestreCount: z.number().int().nonnegative(),
  ueCount: z.number().int().nonnegative(),
  ecueCount: z.number().int().nonnegative(),
  /** Σ professional_ue.nb_uv — valeur déclarée. */
  sumNbUv: z.number().int().nonnegative(),
  /** Σ professional_ecue.credits — valeur réellement utilisée en pondération. */
  sumCredits: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
});

/**
 * Une incohérence structurelle détectée dans le catalogue.
 * `kind` identifie la règle violée, `label` nomme l'objet, `detail` chiffre l'écart.
 */
export const OwnerReferentielIssueSchema = z.object({
  kind: z.enum([
    "ue_nb_uv_zero",
    "ue_nb_uv_mismatch",
    "ecue_credits_null",
    "ecue_orphan",
    "ue_without_ecue",
    "ue_price_zero",
    "semestre_without_session",
    "ecue_without_teacher",
    "course_orphan",
  ]),
  id: z.string().uuid(),
  label: z.string(),
  detail: z.string().nullable(),
  filiereName: z.string().nullable(),
});

export const OwnerReferentielMutualisationSchema = z.object({
  ecueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  ueCount: z.number().int().nonnegative(),
});

export const OwnerReferentielResponseSchema = z.object({
  cycleId: z.string().uuid().nullable(),
  filiereIds: z.array(z.string().uuid()),
  categorie: OwnerUeCategorieSchema.nullable(),
  kpis: OwnerReferentielKpisSchema,
  filieres: z.array(OwnerReferentielFiliereRowSchema),
  issues: z.array(OwnerReferentielIssueSchema),
  /** Compte par type d'incohérence — évite de recompter côté client. */
  issueCounts: z.record(z.string(), z.number().int().nonnegative()),
  ecueMutualisation: z.array(OwnerReferentielMutualisationSchema),
});

/* -------------------------------------------------------------------------- */
/*  5.C — /owner/assiduite                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerAssiduiteQuerySchema = z.object({
  /** Format `YYYY-MM-DD`. Par défaut : 12 dernières semaines. */
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  semestreId: z.string().uuid().optional(),
  building: z.string().optional(),
});

export const OwnerAssiduiteKpisSchema = z.object({
  /** present / total sur professional_ecue_attendance. Retards inclus au présent. */
  presenceRate: z.number(),
  absenceHours: z.number(),
  /** Séances passées ayant au moins un pointage / total des séances passées. */
  callRate: z.number(),
  /** Heures planifiées / (heures ouvrables × salles actives). */
  roomOccupancyRate: z.number(),
  plannedHours: z.number(),
});

export const OwnerAssiduiteWeekCellSchema = z.object({
  /** Lundi de la semaine, `YYYY-MM-DD`. */
  weekStart: z.string(),
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  presentRate: z.number(),
  totalRecords: z.number().int().nonnegative(),
});

export const OwnerAssiduiteAbsentStudentSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  matricule: z.string().nullable(),
  absenceHours: z.number(),
  excusedHours: z.number(),
  absenceCount: z.number().int().nonnegative(),
});

export const OwnerAssiduiteRoomSlotSchema = z.object({
  /** 1 = lundi … 7 = dimanche (convention de professional_emploi_temps.jour). */
  jour: z.number().int().min(1).max(7),
  /** Heure de début du créneau, 8 → 19. */
  hour: z.number().int().min(0).max(23),
  occupiedRooms: z.number().int().nonnegative(),
  rate: z.number(),
});

export const OwnerAssiduiteTeacherLoadSchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  weeklyHours: z.number(),
  ecueCount: z.number().int().nonnegative(),
  filiereCount: z.number().int().nonnegative(),
  /** teachers.user_id est nullable : un enseignant peut n'avoir aucun compte. */
  hasUserAccount: z.boolean(),
});

export const OwnerAssiduiteRoomUsageSchema = z.object({
  classroomId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  capacity: z.number().int().nonnegative(),
  building: z.string().nullable(),
  weeklyHours: z.number(),
  occupancyRate: z.number(),
});

export const OwnerAssiduiteUnassignedSchema = z.object({
  ueSessionId: z.string().uuid(),
  ueCode: z.string(),
  ecueId: z.string().uuid(),
  ecueCode: z.string(),
  ecueLibelle: z.string(),
  filiereName: z.string(),
});

export const OwnerAssiduiteTrendSchema = z.object({
  weekStart: z.string(),
  presentRate: z.number(),
  totalRecords: z.number().int().nonnegative(),
});

export const OwnerAssiduiteResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  filiereIds: z.array(z.string().uuid()),
  semestreId: z.string().uuid().nullable(),
  building: z.string().nullable(),
  /** Heures ouvrables retenues pour le taux d'occupation, pour rendre le calcul lisible. */
  openingHoursPerWeek: z.number(),
  kpis: OwnerAssiduiteKpisSchema,
  attendanceByWeek: z.array(OwnerAssiduiteWeekCellSchema),
  topAbsentStudents: z.array(OwnerAssiduiteAbsentStudentSchema),
  roomOccupancy: z.array(OwnerAssiduiteRoomSlotSchema),
  teacherLoad: z.array(OwnerAssiduiteTeacherLoadSchema),
  roomUsage: z.array(OwnerAssiduiteRoomUsageSchema),
  unassignedEcue: z.array(OwnerAssiduiteUnassignedSchema),
  presenceTrend: z.array(OwnerAssiduiteTrendSchema),
});

/* -------------------------------------------------------------------------- */
/*  5.E — /owner/personnes                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerPersonnesQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
});

export const OwnerPersonnesKpisSchema = z.object({
  activeStudents: z.number().int().nonnegative(),
  activeTeachers: z.number().int().nonnegative(),
  parents: z.number().int().nonnegative(),
  /** Étudiants actifs / enseignants actifs. `null` si aucun enseignant. */
  studentTeacherRatio: z.number().nullable(),
  /**
   * Comptes sans mot de passe initial généré.
   * ⚠️ Aucune colonne ne trace l'ENVOI des identifiants : on ne mesure que la
   * présence de `users.initial_password`, pas leur transmission effective.
   */
  accountsWithoutCredentials: z.number().int().nonnegative(),
});

export const OwnerPersonnesGenderRowSchema = z.object({
  /** Valeur normalisée en minuscules ; `null` si non renseignée. */
  gender: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesAgeRowSchema = z.object({
  /** Borne basse de la tranche de 2 ans (18 ⇒ « 18-19 ans »). */
  bucketStart: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesHeadcountRowSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  cycleName: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesContractRowSchema = z.object({
  contractType: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesTeacherRowSchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  contractType: z.string(),
  status: z.string(),
  hireDate: z.string().nullable(),
  /** Ancienneté en années révolues. `null` si `hire_date` absente. */
  seniorityYears: z.number().nullable(),
  ecueCount: z.number().int().nonnegative(),
  filiereCount: z.number().int().nonnegative(),
  hasUserAccount: z.boolean(),
});

export const OwnerPersonnesNationalityRowSchema = z.object({
  nationality: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesCoverageSchema = z.object({
  studentsWithoutParent: z.number().int().nonnegative(),
  parentsWithoutChild: z.number().int().nonnegative(),
  teachersWithoutAccount: z.number().int().nonnegative(),
  studentsWithoutBirthDate: z.number().int().nonnegative(),
});

export const OwnerPersonnesResponseSchema = z.object({
  academicYearId: z.string().uuid().nullable(),
  filiereIds: z.array(z.string().uuid()),
  kpis: OwnerPersonnesKpisSchema,
  genderDistribution: z.array(OwnerPersonnesGenderRowSchema),
  agePyramid: z.array(OwnerPersonnesAgeRowSchema),
  headcountByFiliere: z.array(OwnerPersonnesHeadcountRowSchema),
  teachersByContract: z.array(OwnerPersonnesContractRowSchema),
  teachers: z.array(OwnerPersonnesTeacherRowSchema),
  topNationalities: z.array(OwnerPersonnesNationalityRowSchema),
  coverage: OwnerPersonnesCoverageSchema,
});

/* -------------------------------------------------------------------------- */
/*  5.F — /owner/recrutement                                                   */
/* -------------------------------------------------------------------------- */

export const OwnerRecrutementAccountTypeSchema = z.enum(["student", "parent"]);
export const OwnerRecrutementStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const OwnerRecrutementQuerySchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  accountType: OwnerRecrutementAccountTypeSchema.optional(),
  status: OwnerRecrutementStatusSchema.optional(),
});

export const OwnerRecrutementKpisSchema = z.object({
  received: z.number().int().nonnegative(),
  /** approved / (approved + rejected) — les demandes en attente sont hors ratio. */
  approvalRate: z.number(),
  /** Moyenne de `reviewed_at − created_at`, en jours. `null` si rien de traité. */
  avgProcessingDays: z.number().nullable(),
  pending: z.number().int().nonnegative(),
});

export const OwnerRecrutementFunnelSchema = z.object({
  received: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  accountsCreated: z.number().int().nonnegative(),
  /** Comptes créés disposant d'un mot de passe initial généré. */
  credentialsIssued: z.number().int().nonnegative(),
});

export const OwnerRecrutementWeeklyRowSchema = z.object({
  weekStart: z.string(),
  student: z.number().int().nonnegative(),
  parent: z.number().int().nonnegative(),
});

export const OwnerRecrutementStatusRowSchema = z.object({
  status: OwnerRecrutementStatusSchema,
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementDelayRowSchema = z.object({
  bucket: z.enum(["<24h", "1-3j", "3-7j", ">7j"]),
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementReasonRowSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementLevelRowSchema = z.object({
  level: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  accountType: OwnerRecrutementAccountTypeSchema.nullable(),
  status: OwnerRecrutementStatusSchema.nullable(),
  kpis: OwnerRecrutementKpisSchema,
  funnel: OwnerRecrutementFunnelSchema,
  weekly: z.array(OwnerRecrutementWeeklyRowSchema),
  byStatus: z.array(OwnerRecrutementStatusRowSchema),
  processingDelays: z.array(OwnerRecrutementDelayRowSchema),
  rejectionReasons: z.array(OwnerRecrutementReasonRowSchema),
  desiredLevels: z.array(OwnerRecrutementLevelRowSchema),
});

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type OwnerUeCategorie = z.infer<typeof OwnerUeCategorieSchema>;
export type OwnerPedagogieQuery = z.infer<typeof OwnerPedagogieQuerySchema>;
export type OwnerPedagogieResponse = z.infer<typeof OwnerPedagogieResponseSchema>;
export type OwnerFinancesProPeriod = z.infer<typeof OwnerFinancesProPeriodSchema>;
export type OwnerFinancesProMode = z.infer<typeof OwnerFinancesProModeSchema>;
export type OwnerFinancesProQuery = z.infer<typeof OwnerFinancesProQuerySchema>;
export type OwnerFinancesProResponse = z.infer<typeof OwnerFinancesProResponseSchema>;
export type OwnerStatsFiltersResponse = z.infer<typeof OwnerStatsFiltersResponseSchema>;
export type OwnerReferentielQuery = z.infer<typeof OwnerReferentielQuerySchema>;
export type OwnerReferentielResponse = z.infer<typeof OwnerReferentielResponseSchema>;
export type OwnerReferentielIssue = z.infer<typeof OwnerReferentielIssueSchema>;
export type OwnerAssiduiteQuery = z.infer<typeof OwnerAssiduiteQuerySchema>;
export type OwnerAssiduiteResponse = z.infer<typeof OwnerAssiduiteResponseSchema>;
export type OwnerPersonnesQuery = z.infer<typeof OwnerPersonnesQuerySchema>;
export type OwnerPersonnesResponse = z.infer<typeof OwnerPersonnesResponseSchema>;
export type OwnerRecrutementQuery = z.infer<typeof OwnerRecrutementQuerySchema>;
export type OwnerRecrutementResponse = z.infer<typeof OwnerRecrutementResponseSchema>;
