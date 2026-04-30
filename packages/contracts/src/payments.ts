import { z } from 'zod';

// Enum schemas
export const PaymentPeriodStatusSchema = z.enum(['draft', 'active', 'closed', 'archived']);
export const PaymentConfigTypeSchema = z.enum(['salary', 'hourly', 'mixed']);
export const PaymentTypeSchema = z.enum(['salary', 'hourly', 'bonus', 'deduction']);
export const PaymentStatusSchema = z.enum(['calculated', 'approved', 'paid', 'disputed', 'cancelled']);
export const RateTypeSchema = z.enum(['theory', 'practical', 'exam', 'evaluation', 'supervision']);

// Base schemas
export const PaymentPeriodSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  periodStart: z.date(),
  periodEnd: z.date(),
  status: PaymentPeriodStatusSchema,
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const TeacherPaymentConfigSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  teacherId: z.string().uuid(),
  configType: PaymentConfigTypeSchema,
  monthlySalary: z.number().positive().optional(),
  annualSalary: z.number().positive().optional(),
  defaultHourlyRate: z.number().positive().optional(),
  overtimeThreshold: z.number().int().positive().default(40),
  overtimeMultiplier: z.number().positive().default(1.5),
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  notes: z.string().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PaymentCalculationDetailsSchema = z.object({
  regularHours: z.number().nonnegative(),
  overtimeHours: z.number().nonnegative(),
  rates: z.object({
    regular: z.number().positive(),
    overtime: z.number().positive(),
  }),
  periodDays: z.number().int().positive(),
  workingDays: z.number().int().positive(),
  breakdown: z.array(z.object({
    description: z.string(),
    amount: z.number(),
    hours: z.number().optional(),
    rate: z.number().optional(),
  })),
});

export const TeacherPaymentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  teacherId: z.string().uuid(),
  paymentPeriodId: z.string().uuid(),
  paymentConfigId: z.string().uuid().optional(),
  paymentType: PaymentTypeSchema,
  baseAmount: z.number().nonnegative(),
  overtimeAmount: z.number().nonnegative().default(0),
  bonusAmount: z.number().nonnegative().default(0),
  deductions: z.number().nonnegative().default(0),
  totalAmount: z.number(),
  currency: z.string().length(3).default('XOF'),
  calculationDetails: PaymentCalculationDetailsSchema.optional(),
  status: PaymentStatusSchema,
  calculatedAt: z.date(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
  paidAt: z.date().optional(),
  notes: z.string().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PaymentHourDetailSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  paymentId: z.string().uuid(),
  teachingHoursId: z.string().uuid(),
  hoursCount: z.number().positive(),
  hourlyRate: z.number().positive(),
  amount: z.number().positive(),
  isOvertime: z.boolean().default(false),
  createdAt: z.date(),
});

export const CourseHourlyRateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  rateAmount: z.number().positive(),
  rateType: RateTypeSchema,
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  notes: z.string().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PaymentAuditLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  paymentId: z.string().uuid(),
  action: z.string().max(20),
  oldValues: z.record(z.any()).optional(),
  newValues: z.record(z.any()).optional(),
  reason: z.string().optional(),
  changedBy: z.string().uuid(),
  changedAt: z.date(),
});

// Create schemas (for API inputs)
export const CreatePaymentPeriodSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").transform((str) => new Date(str)),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").transform((str) => new Date(str)),
});

export const UpdatePaymentPeriodSchema = CreatePaymentPeriodSchema.partial();

export const CreateTeacherPaymentConfigSchema = z.object({
  teacherId: z.string().uuid(),
  configType: PaymentConfigTypeSchema,
  monthlySalary: z.number().positive().optional(),
  annualSalary: z.number().positive().optional(),
  defaultHourlyRate: z.number().positive().optional(),
  overtimeThreshold: z.number().int().positive().default(40),
  overtimeMultiplier: z.number().positive().default(1.5),
  // Accept 'YYYY-MM-DD' strings from JSON and coerce to Date
  effectiveFrom: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, "Invalid date format (YYYY-MM-DD)")
    .transform((s) => new Date(s)),
  effectiveTo: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, "Invalid date format (YYYY-MM-DD)")
    .transform((s) => new Date(s))
    .optional(),
  notes: z.string().optional(),
});

export const UpdateTeacherPaymentConfigSchema = CreateTeacherPaymentConfigSchema.partial();

export const CreateCourseHourlyRateSchema = z.object({
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  rateAmount: z.number().positive(),
  rateType: RateTypeSchema,
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  notes: z.string().optional(),
});

export const UpdateCourseHourlyRateSchema = CreateCourseHourlyRateSchema.partial();

export const PaymentCalculationRequestSchema = z.object({
  periodId: z.string().uuid(),
  teacherIds: z.array(z.string().uuid()).optional(), // If not provided, calculate for all teachers
  recalculate: z.boolean().default(false), // Force recalculation even if already calculated
});

export const PaymentApprovalSchema = z.object({
  paymentIds: z.array(z.string().uuid()),
  notes: z.string().optional(),
});

export const PaymentBulkActionSchema = z.object({
  paymentIds: z.array(z.string().uuid()),
  action: z.enum(['approve', 'reject', 'mark_paid', 'cancel']),
  notes: z.string().optional(),
});

// Query schemas
export const PaymentPeriodQuerySchema = z.object({
  status: PaymentPeriodStatusSchema.optional(),
  year: z.number().int().min(2020).max(2050).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const TeacherPaymentQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  status: PaymentStatusSchema.optional(),
  paymentType: PaymentTypeSchema.optional(),
  fromDate: z.date().optional(),
  toDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const PaymentReportQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  fromDate: z.date().optional(),
  toDate: z.date().optional(),
  groupBy: z.enum(['teacher', 'course', 'period', 'month']).default('teacher'),
  includeDetails: z.boolean().default(false),
});

// Response schemas
export const PaymentSummarySchema = z.object({
  totalPayments: z.number(),
  totalAmount: z.number(),
  pendingApprovals: z.number(),
  pendingPayments: z.number(),
  byStatus: z.record(PaymentStatusSchema, z.number()),
  byType: z.record(PaymentTypeSchema, z.number()),
});

export const TeacherPaymentSummarySchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  totalAmount: z.number(),
  regularHours: z.number(),
  overtimeHours: z.number(),
  payments: z.array(TeacherPaymentSchema),
});

export const PaymentReportSchema = z.object({
  summary: PaymentSummarySchema,
  details: z.array(TeacherPaymentSummarySchema),
  period: PaymentPeriodSchema.optional(),
  generatedAt: z.date(),
});

// Type exports
export type PaymentPeriodStatus = z.infer<typeof PaymentPeriodStatusSchema>;
export type PaymentConfigType = z.infer<typeof PaymentConfigTypeSchema>;
export type PaymentType = z.infer<typeof PaymentTypeSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type RateType = z.infer<typeof RateTypeSchema>;

export type PaymentPeriod = z.infer<typeof PaymentPeriodSchema>;
export type TeacherPaymentConfig = z.infer<typeof TeacherPaymentConfigSchema>;
export type TeacherPayment = z.infer<typeof TeacherPaymentSchema>;
export type PaymentHourDetail = z.infer<typeof PaymentHourDetailSchema>;
export type CourseHourlyRate = z.infer<typeof CourseHourlyRateSchema>;
export type PaymentAuditLog = z.infer<typeof PaymentAuditLogSchema>;
export type PaymentCalculationDetails = z.infer<typeof PaymentCalculationDetailsSchema>;

export type CreatePaymentPeriod = z.infer<typeof CreatePaymentPeriodSchema>;
export type UpdatePaymentPeriod = z.infer<typeof UpdatePaymentPeriodSchema>;
export type CreateTeacherPaymentConfig = z.infer<typeof CreateTeacherPaymentConfigSchema>;
export type UpdateTeacherPaymentConfig = z.infer<typeof UpdateTeacherPaymentConfigSchema>;
export type CreateCourseHourlyRate = z.infer<typeof CreateCourseHourlyRateSchema>;
export type UpdateCourseHourlyRate = z.infer<typeof UpdateCourseHourlyRateSchema>;

export type PaymentCalculationRequest = z.infer<typeof PaymentCalculationRequestSchema>;
export type PaymentApproval = z.infer<typeof PaymentApprovalSchema>;
export type PaymentBulkAction = z.infer<typeof PaymentBulkActionSchema>;

export type PaymentPeriodQuery = z.infer<typeof PaymentPeriodQuerySchema>;
export type TeacherPaymentQuery = z.infer<typeof TeacherPaymentQuerySchema>;
export type PaymentReportQuery = z.infer<typeof PaymentReportQuerySchema>;

export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;
export type TeacherPaymentSummary = z.infer<typeof TeacherPaymentSummarySchema>;
export type PaymentReport = z.infer<typeof PaymentReportSchema>;