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
  /**
   * Nom de classe « filiereId|nom », repris de l'écran admin Paiements.
   * Restreint TOUT l'écran, comme la filière — pas seulement un tableau.
   */
  nomClasse: z.string().optional(),
  /** État de règlement de l'étudiant, appliqué au tableau des impayés. */
  etat: z.enum(["non_regle", "partiel", "solde", "tous"]).optional().default("tous"),
  /**
   * Recherche nom / prénom / matricule, appliquée au SEUL tableau des impayés —
   * exactement comme le champ « Étudiant… » de la page admin Paiements, qui ne
   * touche pas non plus les totaux de l'écran.
   */
  recherche: z.string().optional(),
});

export const OwnerFinancesProTotalsSchema = z.object({
  /** Σ professional_orders.montant_total, hors commandes `annulee`. */
  expected: z.number(),
  /** Σ professional_payments.montant WHERE statut = 'confirme'. */
  collected: z.number(),
  /**
   * collected / expected, en %. `null` quand rien n'est attendu : un zéro
   * afficherait 0 % de recouvrement sur un périmètre intégralement payé.
   */
  recoveryRate: z.number().nullable(),
  /** max(0, expected − collected). */
  outstanding: z.number(),
  /** Étudiants dont le reste dû dépasse 0,5 FCFA (tolérance d'arrondi). */
  unsettledStudents: z.number().int().nonnegative(),
  /**
   * PART DES UE DE CONDUITE dans les deux totaux ci-dessus.
   *
   * L'écran admin Paiements écarte ces UE de son périmètre : il ne les affiche
   * pas, ne les compte pas, ne les facture pas. Le propriétaire, lui, ne peut
   * pas les écarter — sur cette base elles portent 10 200 000 FCFA de commandes
   * INTÉGRALEMENT ENCAISSÉES, et les retirer ferait disparaître de l'argent
   * réellement entré en caisse, en plus de désaccorder cet écran du tableau de
   * bord et de Rentabilité, qui les comptent.
   *
   * Ces deux montants sont donc publiés pour que l'écart entre les deux écrans
   * soit LISIBLE plutôt que subi : « attendu ici, moins la conduite, égale
   * l'attendu de la page Paiements ».
   */
  conduite: z.object({
    expected: z.number(),
    collected: z.number(),
  }),
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
  /** Nom de classe retenu (« filiereId|nom »), ou `null` pour toutes. */
  nomClasse: z.string().nullable(),
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

/**
 * Années scolaires où l'option porte de l'activité, millésimes « AAAA-AAAA+1 ».
 *
 * Sert à faire commander la liste par l'année choisie, comme sur l'écran
 * Paiements du module professionnel : une classe ouverte en 2021-2022 n'a rien
 * à faire dans le sélecteur quand on regarde 2023-2024, et la proposer promet
 * un croisement qui ne ramènera jamais rien.
 *
 * LES DEUX MOTEURS Y SONT : ouvertures de sessions professionnelles ET classes
 * de la scolarité rattachées à une année académique. Un tableau vide dit donc
 * « cette entrée n'a jamais porté d'activité, nulle part » — une ligne de
 * catalogue jamais ouverte. Le sélecteur la masque dès qu'une année est retenue,
 * puisqu'elle ne peut rien ramener.
 */
const OwnerOptionAnneesSchema = z.array(z.string()).default([]);

export const OwnerStatsFiliereOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  /** Cycle de rattachement. `null` quand le cycle a été supprimé. */
  cycleId: z.string().uuid().nullable(),
  cycleName: z.string().nullable(),
  annees: OwnerOptionAnneesSchema,
});

export const OwnerStatsSemestreOptionSchema = z.object({
  id: z.string().uuid(),
  libelle: z.string(),
  filiereId: z.string().uuid(),
  annees: OwnerOptionAnneesSchema,
});

/**
 * NOM DE CLASSE — la dimension par laquelle l'administration filtre réellement.
 *
 * Ce n'est pas la filière : une même filière peut porter plusieurs classes
 * (« LICENCE 1 TRANSPORT LOGISTIQUE » et « … B » existent sur la même). Les
 * écrans admin Paiements et Étudiants inscrits le dérivent du libellé de
 * l'ouverture, amputé de son suffixe « — CODE UE ». On reprend ici la MÊME
 * règle, au caractère près, sans quoi les deux écrans proposeraient des listes
 * différentes pour la même école.
 *
 * `value` porte « filiereId|nom », la clé de sélection de la page Paiements :
 * deux filières peuvent avoir donné le même nom à une classe.
 */
export const OwnerStatsNomClasseOptionSchema = z.object({
  value: z.string(),
  nom: z.string(),
  filiereId: z.string().uuid(),
  annees: OwnerOptionAnneesSchema,
  /** Semestres atteignables depuis cette classe — dernier maillon de la cascade. */
  semestreIds: z.array(z.string().uuid()).default([]),
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
  nomsDeClasse: z.array(OwnerStatsNomClasseOptionSchema).default([]),
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
  /**
   * Année scolaire `YYYY-YYYY` (pivot septembre), dérivée des ouvertures de
   * classe. Remplace l'ancien `academicYearId` : il portait sur
   * `student_enrollments.academic_year_id`, et cette table n'est pas alimentée.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
});

export const OwnerPersonnesKpisSchema = z.object({
  activeStudents: z.number().int().nonnegative(),
  activeTeachers: z.number().int().nonnegative(),
  parents: z.number().int().nonnegative(),
  /** Étudiants actifs / enseignants actifs. `null` si aucun enseignant. */
  studentTeacherRatio: z.number().nullable(),
  /**
   * Comptes sans mot de passe initial généré, PARMI LES PERSONNES DU PÉRIMÈTRE
   * — étudiants, leurs parents, enseignants. Il comptait auparavant tous les
   * utilisateurs du tenant, propriétaire et comptes d'administration inclus,
   * sur un écran qui ne parle pas d'eux.
   *
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
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
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
/*  Économie                                                                   */
/* -------------------------------------------------------------------------- */

export const OwnerEconomieQuerySchema = z.object({
  /**
   * Année scolaire `YYYY-YYYY` (pivot septembre), dérivée des ouvertures de
   * classe. Absente ⇒ toutes années cumulées.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
});

/**
 * Couverture des sources de coût.
 *
 * Sans elle, une marge de 80 % se lit comme une performance alors qu'elle ne
 * traduit qu'une comptabilité absente. Ces champs permettent à l'écran de
 * refuser d'employer le mot « marge » tant que rien n'est saisi.
 */
export const OwnerEconomieCouvertureSchema = z.object({
  coutEnseignantSaisi: z.boolean(),
  chargesSaisies: z.boolean(),
  nombreCharges: z.number().int().nonnegative(),
  chargesAffectees: z.number().int().nonnegative(),
  /** Date depuis laquelle l'historique des statuts élève existe (migration 0099). */
  historiqueStatutsDepuis: z.string().nullable(),
  /** `false` = le chiffre affiché est un chiffre d'affaires, pas une marge. */
  margeInterpretable: z.boolean(),
});

export const OwnerMargeFiliereSchema = z.object({
  filiereId: z.string(),
  filiereName: z.string(),
  encaisse: z.number(),
  coutEnseignant: z.number(),
  /** Charges explicitement rattachées à la filière. Jamais de répartition automatique. */
  chargesAffectees: z.number(),
  margeBrute: z.number(),
  tauxMarge: z.number().nullable(),
  etudiants: z.number().int().nonnegative(),
  margeParEtudiant: z.number().nullable(),
});

export const OwnerFamilleSchema = z.object({
  parentId: z.string(),
  parentNom: z.string(),
  enfants: z.number().int().nonnegative(),
  /** LTV RÉALISÉE : ce qui a été encaissé, pas une projection. */
  encaisseTotal: z.number(),
  anneesPresence: z.number().nullable(),
  revenuAnnuelMoyen: z.number().nullable(),
});

export const OwnerRetentionSchema = z.object({
  filiereId: z.string(),
  filiereName: z.string(),
  cohorte: z.number().int().nonnegative(),
  poursuivis: z.number().int().nonnegative(),
  tauxRetention: z.number().nullable(),
});

export const OwnerEconomieResponseSchema = z.object({
  computedAt: z.string(),
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
  couverture: OwnerEconomieCouvertureSchema,
  kpis: z.object({
    encaisseTotal: z.number(),
    coutTotal: z.number(),
    margeBruteTotale: z.number(),
    tauxMargeBrute: z.number().nullable(),
    famillesSuivies: z.number().int().nonnegative(),
    fratries: z.number().int().nonnegative(),
  }),
  marges: z.array(OwnerMargeFiliereSchema),
  familles: z.array(OwnerFamilleSchema),
  retention: z.array(OwnerRetentionSchema),
});

/* -------------------------------------------------------------------------- */
/*  Qualité & risque                                                           */
/* -------------------------------------------------------------------------- */

export const OwnerRisqueQuerySchema = z.object({
  filiereIds: z.array(z.string().uuid()).optional(),
});

/** Les quatre signaux du score de décrochage. */
export const OwnerRisqueSignalKeySchema = z.enum([
  "absence",
  "resultats",
  "impaye",
  "supports",
]);

export const OwnerRisqueStudentSchema = z.object({
  studentId: z.string(),
  nom: z.string(),
  matricule: z.string().nullable(),
  email: z.string().nullable(),
  telephone: z.string().nullable(),
  filiereName: z.string().nullable(),
  /** 0 à 100, calculé sur les seuls signaux mesurables. */
  score: z.number().int(),
  motifDominant: z.string(),
  /**
   * Signaux réellement pris en compte. Un score fondé sur deux signaux ne vaut
   * pas un score fondé sur quatre : l'écran doit pouvoir le dire.
   */
  signauxMesures: z.array(OwnerRisqueSignalKeySchema),
  heuresAbsence: z.number(),
  heuresTotal: z.number(),
  tauxAbsence: z.number().nullable(),
  moyenne: z.number().nullable(),
  nbEliminees: z.number().int().nonnegative(),
  resteDu: z.number(),
  joursRetardPaiement: z.number().nullable(),
  /** Séances sans horaire saisi, donc invisibles du calcul d'absence. */
  seancesSansHoraire: z.number().int().nonnegative(),
});

export const OwnerRisqueTeacherSchema = z.object({
  teacherId: z.string(),
  nom: z.string(),
  notesAttendues: z.number().int().nonnegative(),
  notesSaisies: z.number().int().nonnegative(),
  tauxSaisie: z.number().nullable(),
  seances30j: z.number().int().nonnegative(),
  seancesPointees30j: z.number().int().nonnegative(),
  tauxAppels: z.number().nullable(),
});

export const OwnerRisquePresenceSchema = z.object({
  filiereId: z.string(),
  filiereName: z.string(),
  taux30j: z.number().nullable(),
  taux7j: z.number().nullable(),
  /** Points d'écart entre la semaine écoulée et le mois. Négatif = chute. */
  ecart: z.number().nullable(),
});

export const OwnerRisqueCorrelationPointSchema = z.object({
  studentId: z.string(),
  heuresAbsence: z.number(),
  moyenne: z.number(),
  filiereName: z.string().nullable(),
});

export const OwnerRisqueResponseSchema = z.object({
  computedAt: z.string(),
  kpis: z.object({
    etudiantsSuivis: z.number().int().nonnegative(),
    aRisque: z.number().int().nonnegative(),
    aSurveiller: z.number().int().nonnegative(),
    seuilRisque: z.number().int(),
    /**
     * `false` quand l'établissement ne dépose aucun support ou qu'aucune
     * consultation n'a jamais été enregistrée : le signal est alors retiré du
     * score, et l'écran doit l'annoncer plutôt que de laisser croire à quatre
     * signaux sur quatre.
     */
    supportsMesurables: z.boolean(),
    enseignantsEnRetardSaisie: z.number().int().nonnegative(),
    enseignantsSousAppel: z.number().int().nonnegative(),
  }),
  students: z.array(OwnerRisqueStudentSchema),
  enseignants: z.array(OwnerRisqueTeacherSchema),
  presence: z.array(OwnerRisquePresenceSchema),
  correlation: z.array(OwnerRisqueCorrelationPointSchema),
});

/* -------------------------------------------------------------------------- */
/*  Remplissage & planning                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerRemplissageQuerySchema = z.object({
  /**
   * Année scolaire `YYYY-YYYY` (pivot septembre), dérivée des ouvertures de
   * classe. Absente ⇒ toutes années cumulées.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
});

/**
 * Un taux vaut `null` quand la capacité n'est pas renseignée — jamais 0.
 * Afficher « 0 % de remplissage » sur une cohorte sans capacité déclarée
 * ferait passer une donnée manquante pour un échec commercial.
 */
const TauxSchema = z.number().nullable();

export const OwnerRemplissageKpisSchema = z.object({
  cohortesActives: z.number().int().nonnegative(),
  cohortesVides: z.number().int().nonnegative(),
  /** Cohortes exclues du taux global, faute de `capacite_max`. */
  cohortesSansCapacite: z.number().int().nonnegative(),
  tauxRemplissageCohortes: TauxSchema,
  /** Cohortes du périmètre encore ouvertes — celles qui appellent un arbitrage. */
  cohortesOuvertes: z.number().int().nonnegative(),
  conflitsPlanning: z.number().int().nonnegative(),
  creneauxTotal: z.number().int().nonnegative(),
  creneauxSansSalle: z.number().int().nonnegative(),
  creneauxSansEnseignant: z.number().int().nonnegative(),
  /**
   * Heures de grille déroulées sur LE PÉRIMÈTRE DE L'ÉCRAN — l'année choisie,
   * ou toutes années cumulées. Auparavant une fenêtre glissante de 30 jours,
   * qui ne couvrait que 24 des 1 326 séances tenues et ignorait tout filtre.
   */
  heuresPlanifiees: z.number(),
  heuresTenues: z.number(),
  /** Heures tenues rapportées aux heures planifiées, même périmètre. */
  tauxRespectPlanning: TauxSchema,
  /**
   * Séances du périmètre sans horaire saisi : elles ne comptent pas dans les
   * heures tenues, ce qui minore mécaniquement le taux de respect.
   */
  seancesSansHoraire: z.number().int().nonnegative(),
});

export const OwnerCohorteRowSchema = z.object({
  sessionId: z.string(),
  libelle: z.string(),
  ueCode: z.string(),
  ueLibelle: z.string(),
  filiereName: z.string().nullable(),
  statut: z.string(),
  dateDebut: z.string().nullable(),
  dateFin: z.string().nullable(),
  joursAvantDebut: z.number().nullable(),
  capacite: z.number().nullable(),
  inscrits: z.number().int().nonnegative(),
  tauxRemplissage: TauxSchema,
});

export const OwnerPlanningConflitSchema = z.object({
  type: z.enum(["salle", "enseignant"]),
  /** Salle ou enseignant en double réservation. */
  ressource: z.string(),
  jour: z.string(),
  plageA: z.string(),
  plageB: z.string(),
  coursA: z.string(),
  coursB: z.string(),
});

export const OwnerCouvertureRowSchema = z.object({
  semestreId: z.string(),
  libelle: z.string(),
  filiereName: z.string().nullable(),
  ecueTotal: z.number().int().nonnegative(),
  ecueProgrammees: z.number().int().nonnegative(),
  taux: TauxSchema,
});

export const OwnerRemplissageResponseSchema = z.object({
  computedAt: z.string(),
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
  kpis: OwnerRemplissageKpisSchema,
  cohortes: z.array(OwnerCohorteRowSchema),
  conflits: z.array(OwnerPlanningConflitSchema),
  couverture: z.array(OwnerCouvertureRowSchema),
});

/* -------------------------------------------------------------------------- */
/*  Trésorerie & recouvrement                                                  */
/* -------------------------------------------------------------------------- */

/** Pas de la courbe de trésorerie. */
export const OwnerTresorerieGranularitySchema = z.enum(["day", "week", "month"]);

export const OwnerTresorerieQuerySchema = z.object({
  /** Bornes incluses, format `YYYY-MM-DD`. Par défaut : 90 derniers jours. */
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  granularity: OwnerTresorerieGranularitySchema.optional().default("week"),
  filiereIds: z.array(z.string().uuid()).optional(),
});

/**
 * Tranche d'ancienneté d'un impayé.
 *
 * `a_echoir` n'est PAS un impayé : c'est du dû à venir. Le confondre avec du
 * retard gonfle artificiellement la dette et fait paniquer pour rien.
 */
export const OwnerAgedBucketSchema = z.enum(["a_echoir", "j0_30", "j31_60", "j61_90", "j90_plus"]);

export const OwnerAgedByFiliereRowSchema = z.object({
  filiereId: z.string().nullable(),
  filiereName: z.string(),
  aEchoir: z.number(),
  j0_30: z.number(),
  j31_60: z.number(),
  j61_90: z.number(),
  j90Plus: z.number(),
  /** Somme des tranches échues uniquement (hors `a_echoir`). */
  totalEchu: z.number(),
});

export const OwnerCashflowPointSchema = z.object({
  /** Début de la tranche, format `YYYY-MM-DD`. */
  date: z.string(),
  label: z.string(),
  scolaire: z.number(),
  professionnel: z.number(),
  total: z.number(),
  /** Même tranche décalée d'un an, pour comparer à saison égale. */
  totalAnneePrecedente: z.number(),
});

export const OwnerPaymentModeRowSchema = z.object({
  mode: z.string(),
  label: z.string(),
  amount: z.number(),
  count: z.number().int().nonnegative(),
});

/**
 * Écarts de caisse : des situations qui ne devraient pas exister et que
 * personne ne voit aujourd'hui.
 */
export const OwnerCashAnomaliesSchema = z.object({
  /** Commandes marquées « payée » sans aucune ligne de paiement. */
  ordersPaidWithoutPayment: z.object({ count: z.number().int(), amount: z.number() }),
  /** Paiements encaissés depuis plus de 48 h sans numéro de reçu. */
  paymentsWithoutReceipt: z.object({ count: z.number().int(), amount: z.number() }),
});

export const OwnerTresorerieTotalsSchema = z.object({
  collected: z.number(),
  expected: z.number(),
  outstanding: z.number(),
  /** Part échue du reste à recouvrer. */
  outstandingEchu: z.number(),
  /**
   * `null` quand RIEN n'est attendu sur la période — à ne pas confondre avec
   * « rien n'est recouvré ». Un zéro affichait 0 % de recouvrement sur un
   * établissement intégralement payé, sur l'écran même des impayés.
   */
  recoveryRate: z.number().nullable(),
});

export const OwnerTresorerieResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  granularity: OwnerTresorerieGranularitySchema,
  computedAt: z.string(),
  totals: OwnerTresorerieTotalsSchema,
  agedByFiliere: z.array(OwnerAgedByFiliereRowSchema),
  cashflow: z.array(OwnerCashflowPointSchema),
  byPaymentMode: z.array(OwnerPaymentModeRowSchema),
  anomalies: OwnerCashAnomaliesSchema,
});

/* --- Journal de caisse ---------------------------------------------------- */

export const OwnerCashRegisterRowSchema = z.object({
  paymentId: z.string(),
  paidAt: z.string(),
  receiptNumber: z.string().nullable(),
  studentName: z.string(),
  matricule: z.string().nullable(),
  filiereName: z.string().nullable(),
  orderReference: z.string().nullable(),
  mode: z.string(),
  modeLabel: z.string(),
  amount: z.number(),
});

export const OwnerCashRegisterQuerySchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  mode: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(50),
});

export const OwnerCashRegisterResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  rows: z.array(OwnerCashRegisterRowSchema),
  /** Totaux sur TOUT le périmètre filtré, jamais sur la seule page affichée. */
  totalAmount: z.number(),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

/* -------------------------------------------------------------------------- */
/*  Pouls — barre haute de l'espace propriétaire                               */
/* -------------------------------------------------------------------------- */

/**
 * Unité d'un KPI du pouls. Elle pilote le formatage côté écran : jamais de
 * montant sans devise, jamais de pourcentage sans signe.
 */
export const OwnerPulseUnitSchema = z.enum(["fcfa", "percent", "count"]);

/**
 * État d'un KPI. Toujours DOUBLÉ d'un libellé à l'écran : la couleur seule n'est
 * pas une information (règle de la palette data-viz).
 *  - `good`     : au-dessus du seuil attendu
 *  - `warning`  : à surveiller
 *  - `critical` : décision à prendre maintenant
 *  - `neutral`  : pas de seuil applicable, ou périmètre vide
 */
export const OwnerPulseStatusSchema = z.enum(["good", "warning", "critical", "neutral"]);

export const OwnerPulseKpiSchema = z.object({
  /** Identifiant stable, utilisé comme clé de rendu et dans les tests. */
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: OwnerPulseUnitSchema,
  /** Valeur de comparaison, ou `null` quand la comparaison n'a pas de sens. */
  previousValue: z.number().nullable(),
  /** Ce à quoi on compare, en toutes lettres (« même mois l'an dernier »). */
  previousLabel: z.string(),
  status: OwnerPulseStatusSchema,
  /**
   * Méthodologie et limites assumées de l'indicateur, affichées à l'écran.
   * Un chiffre approximé DOIT porter son hypothèse ici.
   */
  hint: z.string(),
  /** Sous-valeur marquante (« dont 1 250 000 FCFA à plus de 60 jours »). */
  detail: z.string().nullable(),
  /** Lien profond vers l'écran qui permet d'agir sur ce chiffre. */
  href: z.string().nullable(),
  /**
   * `false` quand la donnée nécessaire n'existe pas encore en base : l'écran
   * affiche « non mesuré » au lieu d'un zéro qui passerait pour un vrai chiffre.
   */
  measured: z.boolean(),
});

/**
 * Année scolaire regardée, au format « AAAA-AAAA+1 ».
 *
 * C'est l'année DÉRIVÉE des ouvertures de classe, pas une ligne de la table
 * `academic_years`. Le module professionnel n'a pas de table d'années : une
 * année existe parce qu'une classe a été ouverte, et son millésime se lit sur
 * la date de début de l'ouverture avec un pivot en septembre.
 *
 * S'adosser à `academic_years` était une erreur : sur une base réelle, cette
 * table ignorait trois années portant douze ouvertures chacune et déclarait une
 * année qui n'en portait aucune. Le filtre montrait donc le contraire de
 * l'activité.
 *
 * Absente, le pouls décrit le présent — le mois en cours, les 30 derniers
 * jours. Présente, il décrit cette année-là de bout en bout, et les indicateurs
 * concernés changent de libellé pour le dire.
 */
export const OwnerPulseQuerySchema = z.object({
  anneeScolaire: OwnerAcademicYearSchema.optional(),
});

export const OwnerPulseResponseSchema = z.object({
  /** Horodatage du calcul, affiché comme « données au JJ/MM à HH:MM ». */
  computedAt: z.string(),
  /** Fenêtre de l'année scolaire retenue pour les indicateurs annuels. */
  academicYearLabel: z.string().nullable(),
  /**
   * Bornes de la fenêtre effectivement retenue, en `AAAA-MM-JJ`.
   *
   * Le tableau de bord les réutilise pour caler ses autres blocs — courbe des
   * encaissements, concentration des impayés — sur la MÊME fenêtre que les
   * indicateurs. Les recalculer de son côté finirait par diverger le jour où
   * une année ne suivrait pas le pivot de septembre.
   *
   * `null` quand l'année demandée est introuvable : rien n'est alors mesuré,
   * plutôt que d'afficher les chiffres d'une autre année sous son nom.
   */
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  kpis: z.array(OwnerPulseKpiSchema),
});

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type OwnerEconomieQuery = z.infer<typeof OwnerEconomieQuerySchema>;
export type OwnerEconomieResponse = z.infer<typeof OwnerEconomieResponseSchema>;
export type OwnerMargeFiliere = z.infer<typeof OwnerMargeFiliereSchema>;
export type OwnerFamille = z.infer<typeof OwnerFamilleSchema>;
export type OwnerRisqueQuery = z.infer<typeof OwnerRisqueQuerySchema>;
export type OwnerRisqueResponse = z.infer<typeof OwnerRisqueResponseSchema>;
export type OwnerRisqueSignalKey = z.infer<typeof OwnerRisqueSignalKeySchema>;
export type OwnerRisqueStudent = z.infer<typeof OwnerRisqueStudentSchema>;
export type OwnerRisqueTeacher = z.infer<typeof OwnerRisqueTeacherSchema>;
export type OwnerRemplissageQuery = z.infer<typeof OwnerRemplissageQuerySchema>;
export type OwnerRemplissageResponse = z.infer<typeof OwnerRemplissageResponseSchema>;
export type OwnerCohorteRow = z.infer<typeof OwnerCohorteRowSchema>;
export type OwnerPlanningConflit = z.infer<typeof OwnerPlanningConflitSchema>;
export type OwnerCouvertureRow = z.infer<typeof OwnerCouvertureRowSchema>;
export type OwnerTresorerieGranularity = z.infer<typeof OwnerTresorerieGranularitySchema>;
export type OwnerTresorerieQuery = z.infer<typeof OwnerTresorerieQuerySchema>;
export type OwnerTresorerieResponse = z.infer<typeof OwnerTresorerieResponseSchema>;
export type OwnerAgedBucket = z.infer<typeof OwnerAgedBucketSchema>;
export type OwnerAgedByFiliereRow = z.infer<typeof OwnerAgedByFiliereRowSchema>;
export type OwnerCashflowPoint = z.infer<typeof OwnerCashflowPointSchema>;
export type OwnerCashRegisterQuery = z.infer<typeof OwnerCashRegisterQuerySchema>;
export type OwnerCashRegisterResponse = z.infer<typeof OwnerCashRegisterResponseSchema>;
export type OwnerCashRegisterRow = z.infer<typeof OwnerCashRegisterRowSchema>;
export type OwnerPulseUnit = z.infer<typeof OwnerPulseUnitSchema>;
export type OwnerPulseStatus = z.infer<typeof OwnerPulseStatusSchema>;
export type OwnerPulseKpi = z.infer<typeof OwnerPulseKpiSchema>;
export type OwnerPulseQuery = z.infer<typeof OwnerPulseQuerySchema>;
export type OwnerPulseResponse = z.infer<typeof OwnerPulseResponseSchema>;
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

/* -------------------------------------------------------------------------- */
/*  5.J — /owner/payroll : masse salariale                                     */
/* -------------------------------------------------------------------------- */

/**
 * Statuts réels de `payment_status` en base — six, pas trois.
 *
 * `disputed`, `cancelled` et `unpaid` existent et doivent être nommés : une
 * paie contestée exclue d'un total sans le dire ferait un écart inexplicable
 * entre cet écran et le bulletin que l'enseignant a en main.
 */
export const OwnerPayrollStatusSchema = z.enum([
  "calculated",
  "approved",
  "paid",
  "disputed",
  "cancelled",
  "unpaid",
]);

/** Filtre d'archivage. Toutes les paies d'un exercice clos sont archivées. */
export const OwnerPayrollArchiveSchema = z.enum(["actives", "archivees", "toutes"]);

/**
 * Année scolaire au format « AAAA-AAAA+1 », telle que l'affiche la page admin
 * des bulletins archivés. Le format est vérifié ici : c'est une chaîne libre qui
 * finit dans une comparaison SQL.
 */
export const OwnerPayrollAnneeSchema = z.string().regex(/^[0-9]{4}-[0-9]{4}$/);

export const OwnerPayrollQuerySchema = z.object({
  /** `payment_periods.id`. Absent = toutes les périodes. */
  periodId: z.string().uuid().optional(),
  /** Année scolaire ; restreint aux périodes de paie qui lui appartiennent. */
  anneeScolaire: OwnerPayrollAnneeSchema.optional(),
  /**
   * `teachers.id`. Absent = tous les enseignants.
   *
   * Même axe que le filtre « Enseignant » de la page administrateur des
   * bulletins archivés : « combien je paie, À QUI » est la moitié de la
   * question de l'écran, elle doit être filtrable.
   */
  teacherId: z.string().uuid().optional(),
  status: OwnerPayrollStatusSchema.optional(),
  archive: OwnerPayrollArchiveSchema.default("toutes"),
});

export const OwnerPayrollPeriodOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.string(),
  /**
   * Année scolaire de la période. `academic_years.name` quand la période y est
   * rattachée, sinon déduite de `period_start` avec un pivot en septembre —
   * même règle que la page administrateur des bulletins archivés, pour que les
   * deux écrans classent un même bulletin dans la même année.
   */
  anneeScolaire: z.string().nullable(),
});

export const OwnerPayrollKpisSchema = z.object({
  /** Somme des paies retenues par le filtre, hors annulées. */
  masseSalariale: z.number(),
  bulletins: z.number().int().nonnegative(),
  enseignantsPayes: z.number().int().nonnegative(),
  /** Masse / enseignants payés. `null` si personne n'est payé. */
  coutMoyenParEnseignant: z.number().nullable(),
  /** Statut `calculated` : calculé, en attente de la signature du propriétaire. */
  enAttenteValidation: z.number().int().nonnegative(),
  montantEnAttente: z.number(),
  /** Approuvé mais `paid_at IS NULL` : engagé, pas encore sorti de caisse. */
  approuveNonVerse: z.number().int().nonnegative(),
  montantApprouveNonVerse: z.number(),
  /**
   * Montant des paies annulées ou contestées sur le périmètre. Exclu de
   * `masseSalariale`, et affiché à part pour que l'exclusion soit visible.
   */
  montantHorsTotal: z.number(),
});

/** Décomposition du bulletin, telle que la porte `teacher_payments`. */
export const OwnerPayrollBreakdownSchema = z.object({
  base: z.number(),
  heuresSup: z.number(),
  primes: z.number(),
  retenues: z.number(),
  total: z.number(),
});

export const OwnerPayrollByPeriodSchema = z.object({
  periodId: z.string().uuid(),
  name: z.string(),
  periodStart: z.string(),
  bulletins: z.number().int().nonnegative(),
  enseignantsPayes: z.number().int().nonnegative(),
  montant: z.number(),
});

export const OwnerPayrollByTeacherSchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  email: z.string().nullable(),
  bulletins: z.number().int().nonnegative(),
  base: z.number(),
  heuresSup: z.number(),
  primes: z.number(),
  retenues: z.number(),
  total: z.number(),
});

export const OwnerPayrollPendingRowSchema = z.object({
  id: z.string().uuid(),
  teacherName: z.string(),
  periodName: z.string().nullable(),
  amount: z.number(),
  calculatedAt: z.string().nullable(),
});

export const OwnerPayrollCourseGapSchema = z.object({
  classCourseId: z.string().uuid(),
  className: z.string(),
  courseName: z.string(),
});

/**
 * Enseignant proposé au filtre, avec son nombre de bulletins.
 *
 * Seuls ceux qui EN ONT figurent dans la liste — même règle que la page
 * administrateur des bulletins archivés. Proposer quelqu'un sans bulletin
 * ouvrirait un écran vide sans dire pourquoi.
 */
export const OwnerPayrollTeacherOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bulletins: z.number().int().nonnegative(),
});

/**
 * Statut réellement porté par au moins un bulletin, avec son effectif.
 *
 * `payment_status` a six valeurs ; une base n'en porte généralement que deux ou
 * trois. Lister les six dans le menu revient à proposer quatre filtres qui
 * n'ouvrent que du vide. L'effectif est renvoyé pour que l'option annonce ce
 * qu'elle contient avant d'être choisie.
 */
export const OwnerPayrollStatusCountSchema = z.object({
  status: OwnerPayrollStatusSchema,
  bulletins: z.number().int().nonnegative(),
});

/**
 * Un bulletin, tel que la page administrateur des bulletins archivés le montre.
 *
 * L'écran propriétaire agrège ; mais dès qu'un enseignant ou une période est
 * choisi, la question devient « quelles lignes exactement ? ». Les mêmes
 * colonnes que l'historique — deux dates distinctes, `archivedAt` qui dit quand
 * le montant a été arrêté et `paidAt` quand l'argent est parti — pour que les
 * deux écrans ne puissent pas raconter deux histoires du même bulletin.
 */
export const OwnerPayrollBulletinSchema = z.object({
  id: z.string().uuid(),
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  periodId: z.string().uuid().nullable(),
  periodName: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  anneeScolaire: z.string().nullable(),
  status: z.string(),
  amount: z.number(),
  /** `null` tant que le bulletin n'a pas été archivé. */
  archivedAt: z.string().nullable(),
  /** Date du versement RÉEL. `null` tant que le bulletin reste dû. */
  paidAt: z.string().nullable(),
});

export const OwnerPayrollResponseSchema = z.object({
  /** Filtres réellement appliqués, ré-exposés pour l'affichage et le PDF. */
  periodId: z.string().uuid().nullable(),
  periodName: z.string().nullable(),
  anneeScolaire: z.string().nullable(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string().nullable(),
  status: OwnerPayrollStatusSchema.nullable(),
  archive: OwnerPayrollArchiveSchema,
  /** Périodes proposées au filtre : l'écran n'a pas à les deviner. */
  periods: z.array(OwnerPayrollPeriodOptionSchema),
  /**
   * Années réellement représentées, de la plus récente à la plus ancienne.
   * Proposer une année sans aucun bulletin donnerait un écran vide sans dire
   * pourquoi.
   */
  anneesScolaires: z.array(z.string()),
  /** Enseignants porteurs d'au moins un bulletin, du plus fourni au moins. */
  teachers: z.array(OwnerPayrollTeacherOptionSchema),
  /**
   * Statuts réellement présents, hors filtre de statut : le menu ne doit pas se
   * vider de ses propres options dès qu'on en choisit une.
   */
  statuts: z.array(OwnerPayrollStatusCountSchema),
  /**
   * Effectifs des deux faces de l'archivage, hors filtre d'archivage. Un
   * établissement dont tout est classé doit le LIRE sur l'option, plutôt que de
   * découvrir un écran vide après l'avoir choisie.
   */
  archiveCounts: z.object({
    actives: z.number().int().nonnegative(),
    archivees: z.number().int().nonnegative(),
  }),
  kpis: OwnerPayrollKpisSchema,
  breakdown: OwnerPayrollBreakdownSchema,
  /** Toutes les périodes, filtre de période ignoré : c'est une évolution. */
  byPeriod: z.array(OwnerPayrollByPeriodSchema),
  byTeacher: z.array(OwnerPayrollByTeacherSchema),
  /**
   * Les bulletins du périmètre, ligne à ligne. Plafonnés côté serveur ;
   * `bulletinsTotal` porte sur tout ce que le filtre retient, pour qu'un
   * écrêtage se lise au lieu de se deviner.
   */
  bulletins: z.array(OwnerPayrollBulletinSchema),
  bulletinsTotal: z.number().int().nonnegative(),
  pending: z.array(OwnerPayrollPendingRowSchema),
  coursesWithoutTeacher: z.array(OwnerPayrollCourseGapSchema),
  /**
   * Cours sans titulaire AFFICHABLES : mêmes jointures que la liste, pour que
   * le compteur et le tableau ne puissent pas se contredire.
   */
  coursesWithoutTeacherTotal: z.number().int().nonnegative(),
  /**
   * Lignes `class_courses` sans titulaire dont la classe ou la matière
   * référencée n'existe plus. Elles ne sont listables nulle part : les compter
   * avec les autres afficherait un total au-dessus d'un tableau plus court, ce
   * qui se lit comme une troncature au lieu d'un défaut de données.
   */
  coursesWithoutTeacherOrphaned: z.number().int().nonnegative(),
});

export type OwnerPayrollStatus = z.infer<typeof OwnerPayrollStatusSchema>;
export type OwnerPayrollArchive = z.infer<typeof OwnerPayrollArchiveSchema>;
export type OwnerPayrollQuery = z.infer<typeof OwnerPayrollQuerySchema>;
export type OwnerPayrollResponse = z.infer<typeof OwnerPayrollResponseSchema>;
export type OwnerPayrollByTeacher = z.infer<typeof OwnerPayrollByTeacherSchema>;
export type OwnerPayrollTeacherOption = z.infer<typeof OwnerPayrollTeacherOptionSchema>;
export type OwnerPayrollPeriodOption = z.infer<typeof OwnerPayrollPeriodOptionSchema>;
export type OwnerPayrollBulletin = z.infer<typeof OwnerPayrollBulletinSchema>;
