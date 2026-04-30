import { z } from "zod";

export const OwnerAlertSeveritySchema = z.enum(["high", "medium", "low"]);

export const OwnerAlertSchema = z.object({
  id: z.string().uuid(),
  severity: OwnerAlertSeveritySchema,
  message: z.string(),
  domain: z.string(),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable().optional(),
});

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

export const OwnerDashboardResponseSchema = z.object({
  finances: OwnerDashboardFinancesSchema,
  academic: OwnerDashboardAcademicSchema,
  staff: OwnerDashboardStaffSchema,
  formations: OwnerDashboardFormationsSchema,
  alerts: z.array(OwnerAlertSchema),
});

export const OwnerFinancesPeriodSchema = z.enum([
  "month",
  "quarter",
  "year",
  "academic_year",
]);

export const OwnerFinancesQuerySchema = z.object({
  period: OwnerFinancesPeriodSchema.optional().default("month"),
  academicYearId: z.string().uuid().optional(),
  /** Filtre cycle (UUID) */
  cycleId: z.string().uuid().optional(),
  /** Alias historique de cycleId */
  cycle: z.string().optional(),
});

export const OwnerFinancesRecoveryByClassSchema = z.object({
  classId: z.string().uuid(),
  className: z.string(),
  cycleName: z.string().nullable(),
  expected: z.number(),
  collected: z.number(),
  recoveryRate: z.number(),
});

export const OwnerFinancesOverdueRowSchema = z.object({
  studentRef: z.string(),
  className: z.string().nullable(),
  amountDue: z.number(),
  dueDate: z.string(),
});

export const OwnerFinancesPayrollRowSchema = z.object({
  id: z.string().uuid(),
  teacherName: z.string(),
  periodLabel: z.string().nullable(),
  amount: z.number(),
  status: z.string(),
  calculatedAt: z.string(),
});

export const OwnerFinancesTotalsSchema = z.object({
  expectedTuition: z.number(),
  collectedTuition: z.number(),
  recoveryRate: z.number(),
  overdueCount: z.number(),
  overdueAmount: z.number(),
  teacherPayrollTotal: z.number(),
});

export const OwnerFinancesResponseSchema = z.object({
  period: OwnerFinancesPeriodSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  academicYearId: z.string().uuid().optional(),
  cycleId: z.string().uuid().optional(),
  totals: OwnerFinancesTotalsSchema,
  recoveryByClass: z.array(OwnerFinancesRecoveryByClassSchema),
  overdueInstallments: z.array(OwnerFinancesOverdueRowSchema),
  teacherPayroll: z.array(OwnerFinancesPayrollRowSchema),
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

export const OwnerAlertsListResponseSchema = z.object({
  alerts: z.array(OwnerAlertSchema),
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
export type OwnerAlert = z.infer<typeof OwnerAlertSchema>;
export type OwnerFinancesPeriod = z.infer<typeof OwnerFinancesPeriodSchema>;
export type OwnerFinancesResponse = z.infer<typeof OwnerFinancesResponseSchema>;
export type OwnerPayrollValidateResponse = z.infer<typeof OwnerPayrollValidateResponseSchema>;
export type OwnerAcademicResponse = z.infer<typeof OwnerAcademicResponseSchema>;
export type OwnerUserListItem = z.infer<typeof OwnerUserListItemSchema>;
export type OwnerUserRolesPatchResponse = z.infer<typeof OwnerUserRolesPatchResponseSchema>;
export type OwnerAlertsListResponse = z.infer<typeof OwnerAlertsListResponseSchema>;
export type OwnerUsersListResponse = z.infer<typeof OwnerUsersListResponseSchema>;
export type OwnerAssignableRolesResponse = z.infer<typeof OwnerAssignableRolesResponseSchema>;
export type OwnerStaffResponse = z.infer<typeof OwnerStaffResponseSchema>;
export type OwnerFormationsResponse = z.infer<typeof OwnerFormationsResponseSchema>;
