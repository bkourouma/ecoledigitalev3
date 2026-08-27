import { z } from "zod";

export const OwnerDashboardFinancesSchema = z.object({
  revenueCurrentMonth: z.number(),
  recoveryRate: z.number(),
  recoveryByCycle: z.array(
    z.object({
      cycle: z.string(),
      rate: z.number(),
    })
  ),
  teacherPaymentRate: z.number(),
  overdueCount: z.number(),
});

export const OwnerDashboardAcademicSchema = z.object({
  totalStudents: z.number(),
  totalClasses: z.number(),
  averageGrade: z.number(),
  successRate: z.number(),
  attendanceRate: z.number(),
  assignmentsGradedRate: z.number(),
});

export const OwnerDashboardStaffSchema = z.object({
  activeTeachers: z.number(),
  totalHoursTaught: z.number(),
  coursesWithoutTeacher: z.number(),
  pendingPayrollValidations: z.number(),
});

export const OwnerDashboardFormationsSchema = z.object({
  activeSessions: z.number(),
  totalEnrollments: z.number(),
  revenueFormations: z.number(),
  clientCompanies: z.number(),
});

/**
 * Synthèse du Module Professionnel (LMD).
 * Les trois autres blocs ne couvrent que le module académique, les RH et les
 * formations courtes : sans celui-ci, tout le module UE/ECUE est absent du pilotage.
 */
export const OwnerDashboardProfessionalSchema = z.object({
  enrolledStudents: z.number(),
  /** Même mesure au mois précédent, pour afficher une variation. */
  enrolledStudentsPrevMonth: z.number(),
  recoveryRate: z.number(),
  /** `null` tant qu'aucun semestre clos ne porte de bulletin. */
  successRateLastSemester: z.number().nullable(),
  attendanceRate30d: z.number(),
});

export const OwnerDashboardResponseSchema = z.object({
  finances: OwnerDashboardFinancesSchema,
  academic: OwnerDashboardAcademicSchema,
  staff: OwnerDashboardStaffSchema,
  formations: OwnerDashboardFormationsSchema,
  /**
   * `optional` délibéré : le serveur le renseigne TOUJOURS, mais un client déployé
   * avant le serveur — ou l'inverse — doit pouvoir lire la réponse sans planter.
   * Ajouter un champ requis à un schéma de réponse casse toute version antérieure
   * du client pendant la fenêtre de déploiement. Les consommateurs doivent donc
   * tester sa présence.
   */
  professional: OwnerDashboardProfessionalSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/*  Encaissements — /owner/finances                                            */
/* -------------------------------------------------------------------------- */

/**
 * L'écran répond à « combien est rentré, et d'où ».
 *
 * IL NE DÉCRIT QUE LE MODULE PROFESSIONNEL. Il a d'abord lu la seule scolarité
 * (`payment_transactions`, `student_tuition_installments`), affichant zéro
 * encaissement sur un établissement dont la caisse encaissait — l'inverse de la
 * réalité, sur le seul écran qui porte le mot « Encaissements ». Il a ensuite
 * consolidé les deux moitiés. Il ne garde aujourd'hui que le professionnel.
 *
 * Pourquoi retirer plutôt que laisser à zéro : la scolarité n'est pas saisie
 * ici, et un zéro non mesuré se lit comme une contre-performance. Les axes de
 * ventilation partaient d'ailleurs dans deux directions — cycle et classe d'un
 * côté, filière de l'autre — sans jamais se rejoindre.
 *
 * CE QUI N'Y EST PLUS : le bloc des rémunérations enseignantes. C'est de
 * l'argent qui SORT, sur un écran qui décrit ce qui rentre — et il a désormais
 * son propre écran, filtrable et exportable.
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

export type OwnerDashboardResponse = z.infer<typeof OwnerDashboardResponseSchema>;
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
