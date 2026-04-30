import { z } from 'zod';

// Enum schemas for student payments
export const InstallmentStatusSchema = z.enum(['pending', 'partial', 'completed', 'overdue']);
export const PaymentFeeTypeSchema = z.enum(['inscription', 'scolarite', 'annexes', 'autres']);
export const PaymentMethodTypeSchema = z.enum(['orange_money', 'mtn_money', 'moov_money', 'card', 'bank_transfer', 'especes']);
export const TransactionStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded']);

// Base schemas
export const TuitionInstallmentSchema = z.object({
  percentage: z.number().min(0).max(100),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  label: z.string().min(1).max(100),
});

export const TuitionPaymentScheduleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  classId: z.string().uuid().optional(), // NULL means applies to all classes
  scheduleName: z.string().min(1).max(100),
  installments: z.array(TuitionInstallmentSchema),
  isActive: z.boolean(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const StudentTuitionInstallmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  installmentNumber: z.number().int().positive(),
  installmentLabel: z.string().min(1).max(100),
  amount: z.number().nonnegative(),
  dueDate: z.date(),
  status: InstallmentStatusSchema,
  amountPaid: z.number().nonnegative(),
  lateFee: z.number().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PaymentTransactionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  tuitionInstallmentId: z.string().uuid().optional(), // NULL for non-tuition fees
  feeType: PaymentFeeTypeSchema,
  externalTransactionId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default('XOF'),
  paymentMethod: PaymentMethodTypeSchema.optional(),
  status: TransactionStatusSchema,
  gatewayResponse: z.record(z.any()).optional(),
  receiptUrl: z.string().url().optional(),
  processedAt: z.date().optional(),
  createdBy: z.string().uuid().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PaymentReceiptSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  transactionId: z.string().uuid(),
  receiptNumber: z.string().min(1).max(50),
  receiptUrl: z.string().url(),
  generatedAt: z.date(),
});

export const PaymentNotificationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  notificationType: z.enum(['reminder', 'confirmation', 'overdue']),
  feeType: PaymentFeeTypeSchema.optional(),
  tuitionInstallmentId: z.string().uuid().optional(),
  transactionId: z.string().uuid().optional(),
  sentTo: z.string().min(1).max(255),
  sentVia: z.enum(['email', 'sms']),
  status: z.enum(['pending', 'sent', 'failed']),
  sentAt: z.date().optional(),
  createdAt: z.date(),
});

// Create schemas (for API inputs)
export const CreateTuitionPaymentScheduleSchema = z.object({
  academicYearId: z.string().uuid(),
  classId: z.string().uuid().optional(),
  scheduleName: z.string().min(1).max(100),
  installments: z.array(TuitionInstallmentSchema).min(1),
});

export const UpdateTuitionPaymentScheduleSchema = CreateTuitionPaymentScheduleSchema.partial();

export const CreatePaymentTransactionSchema = z.object({
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  feeType: PaymentFeeTypeSchema,
  amount: z.number().positive(),
  currency: z.string().length(3).default('XOF'),
  paymentMethod: PaymentMethodTypeSchema,
  tuitionInstallmentId: z.string().uuid().optional(), // Required for tuition payments
  returnUrl: z.string().url().optional(), // For payment gateway redirect
});

export const PaymentInitiationResponseSchema = z.object({
  transactionId: z.string().uuid(),
  paymentUrl: z.string().url().optional(), // Gateway payment URL
  externalTransactionId: z.string().optional(),
  status: TransactionStatusSchema,
  message: z.string().optional(),
});

export const PaymentVerificationSchema = z.object({
  transactionId: z.string().uuid(),
  externalTransactionId: z.string().optional(),
});

export const PaymentWebhookSchema = z.object({
  externalTransactionId: z.string(),
  status: z.enum(['completed', 'failed', 'cancelled']),
  amount: z.number().positive(),
  currency: z.string().length(3),
  gatewayResponse: z.record(z.any()).optional(),
});

// Query schemas
export const StudentPaymentQuerySchema = z.object({
  studentId: z.string().uuid(),
  feeType: PaymentFeeTypeSchema.optional(),
  status: TransactionStatusSchema.optional(),
  fromDate: z.date().optional(),
  toDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const TuitionScheduleQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const PaymentReportQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  feeType: PaymentFeeTypeSchema.optional(),
  fromDate: z.date().optional(),
  toDate: z.date().optional(),
  groupBy: z.enum(['student', 'class', 'fee_type', 'month']).default('student'),
  includeDetails: z.boolean().default(false),
});

// Response schemas
export const StudentPaymentSummarySchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  enrollmentId: z.string().uuid(),
  totalFees: z.number().nonnegative(),
  totalPaid: z.number().nonnegative(),
  totalOutstanding: z.number().nonnegative(),
  immediateFeesStatus: z.object({
    inscription: z.object({
      amount: z.number().nonnegative(),
      paid: z.boolean(),
      paidAmount: z.number().nonnegative(),
    }),
    annexes: z.object({
      amount: z.number().nonnegative(),
      paid: z.boolean(),
      paidAmount: z.number().nonnegative(),
    }),
    autres: z.object({
      amount: z.number().nonnegative(),
      paid: z.boolean(),
      paidAmount: z.number().nonnegative(),
    }),
  }),
  tuitionInstallments: z.array(StudentTuitionInstallmentSchema),
  recentTransactions: z.array(PaymentTransactionSchema),
});

export const PaymentDashboardSummarySchema = z.object({
  totalStudents: z.number().int().nonnegative(),
  totalRevenue: z.number().nonnegative(),
  pendingPayments: z.number().nonnegative(),
  overduePayments: z.number().nonnegative(),
  collectionRate: z.number().min(0).max(100), // Percentage
  byFeeType: z.record(PaymentFeeTypeSchema, z.object({
    total: z.number().nonnegative(),
    collected: z.number().nonnegative(),
    pending: z.number().nonnegative(),
  })),
  byPaymentMethod: z.record(PaymentMethodTypeSchema, z.number().nonnegative()),
  recentTransactions: z.array(PaymentTransactionSchema),
});

// Bulk operations
export const BulkGenerateInstallmentsSchema = z.object({
  scheduleId: z.string().uuid(),
  enrollmentIds: z.array(z.string().uuid()).optional(), // If not provided, generate for all enrollments
  overwriteExisting: z.boolean().default(false),
});

export const BulkPaymentReminderSchema = z.object({
  studentIds: z.array(z.string().uuid()).optional(), // If not provided, send to all with overdue payments
  feeType: PaymentFeeTypeSchema.optional(),
  reminderType: z.enum(['upcoming', 'overdue']),
  sendVia: z.enum(['email', 'sms', 'both']).default('email'),
});

// Type exports
export type InstallmentStatus = z.infer<typeof InstallmentStatusSchema>;
export type PaymentFeeType = z.infer<typeof PaymentFeeTypeSchema>;
export type PaymentMethodType = z.infer<typeof PaymentMethodTypeSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export type TuitionInstallment = z.infer<typeof TuitionInstallmentSchema>;
export type TuitionPaymentSchedule = z.infer<typeof TuitionPaymentScheduleSchema>;
export type StudentTuitionInstallment = z.infer<typeof StudentTuitionInstallmentSchema>;
export type PaymentTransaction = z.infer<typeof PaymentTransactionSchema>;
export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>;
export type PaymentNotification = z.infer<typeof PaymentNotificationSchema>;

export type CreateTuitionPaymentSchedule = z.infer<typeof CreateTuitionPaymentScheduleSchema>;
export type UpdateTuitionPaymentSchedule = z.infer<typeof UpdateTuitionPaymentScheduleSchema>;
export type CreatePaymentTransaction = z.infer<typeof CreatePaymentTransactionSchema>;
export type PaymentInitiationResponse = z.infer<typeof PaymentInitiationResponseSchema>;
export type PaymentVerification = z.infer<typeof PaymentVerificationSchema>;
export type PaymentWebhook = z.infer<typeof PaymentWebhookSchema>;

export type StudentPaymentQuery = z.infer<typeof StudentPaymentQuerySchema>;
export type TuitionScheduleQuery = z.infer<typeof TuitionScheduleQuerySchema>;
export type PaymentReportQuery = z.infer<typeof PaymentReportQuerySchema>;

export type StudentPaymentSummary = z.infer<typeof StudentPaymentSummarySchema>;
export type PaymentDashboardSummary = z.infer<typeof PaymentDashboardSummarySchema>;

export type BulkGenerateInstallments = z.infer<typeof BulkGenerateInstallmentsSchema>;
export type BulkPaymentReminder = z.infer<typeof BulkPaymentReminderSchema>;
