import { z } from "zod";

/*
   LE TABLEAU DE BORD AGRÉGÉ A ÉTÉ RETIRÉ le 23/09/2026.

   Six schémas vivaient ici — finances, academic, staff, formations,
   professional et leur enveloppe — pour un seul consommateur :
   `GET /api/v1/owner/dashboard`. Cet endpoint n'était plus appelé par aucune
   des trois applications du monorepo ; l'écran `/owner/dashboard` lit
   `/owner/pulse` et `/owner/tresorerie`, qui datent les montants à l'ouverture
   de classe là où l'agrégat interrogeait encore les tables legacy Imhotep en
   parallèle des `professional_*`.

   Garder un contrat sans lecteur, c'est promettre une compatibilité que
   personne ne vérifie plus. Le service et sa route sont partis avec.
*/

export const OwnerFinancesPeriodSchema = z.enum([
  "month",
  "quarter",
  "year",
  "academic_year",
]);

export const OwnerFinancesQuerySchema = z.object({
  period: OwnerFinancesPeriodSchema.optional().default("month"),
  /**
   * Année scolaire « AAAA-AAAA+1 », DÉRIVÉE des ouvertures de classe.
   * Remplace l'ancien `academicYearId` : la table `academic_years` ne décrit pas
   * l'activité réelle de l'établissement (cf. `OwnerPulseQuerySchema`).
   */
  anneeScolaire: z.string().regex(/^[0-9]{4}-[0-9]{4}$/).optional(),
  /** Restreint la moitié PROFESSIONNELLE. */
  filiereIds: z.array(z.string().uuid()).optional(),
  /**
   * Ouverture de classe, clé « filiereId|nom » — la dimension de filtrage des
   * écrans d'administration. Même contrat que `owner-perimetre.sql`.
   */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

/** Un point de la courbe : un mois du module professionnel. */
export const OwnerFinancesMonthlyPointSchema = z.object({
  /** `AAAA-MM`. */
  month: z.string(),
  label: z.string(),
  /**
   * Encaissé du mois. `professionnel` et `total` portent la même valeur depuis
   * que l'écran ne couvre plus que le module professionnel : `total` reste pour
   * les consommateurs qui le lisent, il n'additionne plus rien.
   */
  professionnel: z.number(),
  total: z.number(),
});

export const OwnerFinancesByFiliereSchema = z.object({
  filiereId: z.string().uuid().nullable(),
  filiereName: z.string(),
  expected: z.number(),
  collected: z.number(),
  recoveryRate: z.number(),
});

/** Répartition des encaissements professionnels par mode de règlement. */
export const OwnerFinancesByModeSchema = z.object({
  mode: z.string(),
  label: z.string(),
  amount: z.number(),
  count: z.number().int().nonnegative(),
});

/**
 * Totaux du MODULE PROFESSIONNEL uniquement.
 *
 * L'endpoint consolidait la scolarité et le professionnel, et exposait les deux
 * moitiés de chaque montant. L'écran `/owner/finances` ne parle plus que du
 * professionnel : les moitiés scolaires ont été retirées plutôt que laissées à
 * zéro, un zéro non mesuré se lisant comme une contre-performance.
 */
export const OwnerFinancesTotalsSchema = z.object({
  /** Σ `professional_payments.montant` confirmés sur la période. */
  collected: z.number(),
  /** Σ `professional_orders.montant_total`, commandes non annulées. */
  expected: z.number(),
  /** collected / expected, en %. `null` quand rien n'est attendu. */
  recoveryRate: z.number().nullable(),
  /** Même période, un an plus tôt — la saisonnalité rend l'écart mensuel muet. */
  collectedPreviousYear: z.number(),
});

/**
 * Ce que le module professionnel a réellement fourni.
 *
 * Une source sans aucune donnée saisie n'est pas une source à zéro : c'est une
 * source qu'on ne mesure pas. L'écran l'annonce au lieu de laisser lire un zéro
 * comme une contre-performance.
 */
export const OwnerFinancesCouvertureSchema = z.object({
  professionnelAlimente: z.boolean(),
});

export const OwnerFinancesResponseSchema = z.object({
  period: OwnerFinancesPeriodSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  anneeScolaire: z.string().nullable(),
  filiereIds: z.array(z.string().uuid()),
  couverture: OwnerFinancesCouvertureSchema,
  totals: OwnerFinancesTotalsSchema,
  monthly: z.array(OwnerFinancesMonthlyPointSchema),
  byFiliere: z.array(OwnerFinancesByFiliereSchema),
  byMode: z.array(OwnerFinancesByModeSchema),
  /**
   * Écarts de caisse, arrivés ici AVEC le journal de caisse.
   *
   * Une pièce comptable se lit avec ses écarts sous les yeux. Les laisser sur
   * l'écran des Impayés obligeait à changer de page pour savoir si le journal
   * qu'on vient de lire est fiable — et l'écran des Impayés répond, lui, à une
   * tout autre question : ce qui n'est pas encore rentré.
   *
   * `ordersPaidWithoutPayment` est le seul des deux qui puisse cacher une
   * perte : `adminUpdateEnrollment` force le statut « payée » sans créer de
   * règlement, donc la commande est soldée dans l'application sans que l'argent
   * soit passé par la caisse.
   */
  anomalies: z.object({
    ordersPaidWithoutPayment: z.object({
      count: z.number().int().nonnegative(),
      amount: z.number(),
    }),
    /** Encaissements confirmés sans numéro de reçu, passé 48 heures. */
    paymentsWithoutReceipt: z.object({
      count: z.number().int().nonnegative(),
      amount: z.number(),
    }),
  }),
});

export const OwnerFinancialReportFormatSchema = z.enum(["pdf", "csv"]);

export const OwnerFinancialReportQuerySchema = OwnerFinancesQuerySchema.extend({
  format: OwnerFinancialReportFormatSchema,
});

export const OwnerPayrollValidateResponseSchema = z.object({
  id: z.string().uuid(),
  teacherName: z.string(),
  periodLabel: z.string().nullable(),
  amount: z.number(),
  status: z.string(),
  calculatedAt: z.string(),
  approvedAt: z.string().nullable().optional(),
  approvedByUserId: z.string().uuid().nullable().optional(),
});

/** Corps d’erreur API pour validation paie (409 : état non éligible) */
export const OwnerPayrollValidateConflictBodySchema = z.object({
  success: z.literal(false),
  error: z.literal("Conflict"),
  message: z.string(),
});

/** Corps d’erreur API pour validation paie (404) */
export const OwnerPayrollValidateNotFoundBodySchema = z.object({
  success: z.literal(false),
  error: z.literal("Not Found"),
  message: z.string(),
});

export const OwnerAcademicClassAverageSchema = z.object({
  classId: z.string().uuid(),
  className: z.string(),
  studentCount: z.number().int().nonnegative(),
  averageGrade: z.number(),
});

export const OwnerAcademicSemesterAverageSchema = z.object({
  periodId: z.string().uuid(),
  periodName: z.string(),
  sortOrder: z.number().int(),
  averageGrade: z.number(),
});

export const OwnerAcademicProgramSuccessSchema = z.object({
  programmeId: z.string().uuid(),
  programmeName: z.string(),
  studentCount: z.number().int().nonnegative(),
  successRate: z.number(),
});

export const OwnerAcademicAttendanceWeekSchema = z.object({
  classId: z.string().uuid(),
  className: z.string(),
  weekStart: z.string(),
  presentRate: z.number(),
  totalRecords: z.number().int().nonnegative(),
});

export const OwnerAcademicAssignmentsSchema = z.object({
  gradedRate: z.number(),
  totalSubmissions: z.number().int().nonnegative(),
  gradedSubmissions: z.number().int().nonnegative(),
});

export const OwnerAcademicAtRiskClassSchema = z.object({
  classId: z.string().uuid(),
  className: z.string(),
  averageGrade: z.number(),
  threshold: z.number(),
});

export const OwnerAcademicResponseSchema = z.object({
  riskGradeThreshold: z.number(),
  averagesByClass: z.array(OwnerAcademicClassAverageSchema),
  semesterAverages: z.array(OwnerAcademicSemesterAverageSchema),
  successByProgram: z.array(OwnerAcademicProgramSuccessSchema),
  attendanceByClassWeek: z.array(OwnerAcademicAttendanceWeekSchema),
  assignments: OwnerAcademicAssignmentsSchema,
  atRiskClasses: z.array(OwnerAcademicAtRiskClassSchema),
});

export const OwnerStaffTeacherSchema = z.object({
  teacherId: z.string().uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.string(),
  hoursTaught: z.number(),
  hoursValidated: z.number(),
});

export const OwnerStaffCourseGapSchema = z.object({
  classCourseId: z.string().uuid(),
  className: z.string(),
  courseName: z.string(),
});

export const OwnerStaffPayrollPendingSchema = z.object({
  id: z.string().uuid(),
  teacherName: z.string(),
  periodLabel: z.string().nullable(),
  amount: z.number(),
  status: z.string(),
  calculatedAt: z.string(),
});

export const OwnerStaffResponseSchema = z.object({
  teachers: z.array(OwnerStaffTeacherSchema),
  coursesWithoutTeacher: z.array(OwnerStaffCourseGapSchema),
  payrollPending: z.array(OwnerStaffPayrollPendingSchema),
  activeFormateurs: z.number().int().nonnegative().optional(),
});

export const OwnerFormationsResponseSchema = z.object({
  usesSessionBasedProfessionalTraining: z.boolean(),
  activeSessions: z.number().int().nonnegative(),
  enrollments: z.number().int().nonnegative(),
  revenue: z.number(),
  companies: z.number().int().nonnegative(),
  activeFormateurs: z.number().int().nonnegative().optional(),
});

export const OwnerUserListItemSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  roleKeys: z.array(z.string()),
});

export const OwnerUsersListResponseSchema = z.object({
  users: z.array(OwnerUserListItemSchema),
});

export const OwnerAssignableRolesResponseSchema = z.object({
  roleKeys: z.array(z.string()),
});

export const OwnerUserRolesPatchBodySchema = z.object({
  roleKeys: z.array(z.string()),
});

export const OwnerUserRolesPatchResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  roleKeys: z.array(z.string()),
});

export type OwnerFinancesPeriod = z.infer<typeof OwnerFinancesPeriodSchema>;
export type OwnerFinancesResponse = z.infer<typeof OwnerFinancesResponseSchema>;
export type OwnerPayrollValidateResponse = z.infer<typeof OwnerPayrollValidateResponseSchema>;
export type OwnerAcademicResponse = z.infer<typeof OwnerAcademicResponseSchema>;
export type OwnerUserListItem = z.infer<typeof OwnerUserListItemSchema>;
export type OwnerUserRolesPatchResponse = z.infer<typeof OwnerUserRolesPatchResponseSchema>;
export type OwnerUsersListResponse = z.infer<typeof OwnerUsersListResponseSchema>;
export type OwnerAssignableRolesResponse = z.infer<typeof OwnerAssignableRolesResponseSchema>;
export type OwnerStaffResponse = z.infer<typeof OwnerStaffResponseSchema>;
export type OwnerFormationsResponse = z.infer<typeof OwnerFormationsResponseSchema>;
