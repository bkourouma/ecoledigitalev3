import { z } from "zod";

// ========================================
// ENUM SCHEMAS
// ========================================

export const ScheduleGenerationStatusSchema = z.enum([
  "pending",
  "processing", 
  "completed",
  "failed",
  "cancelled"
]);

export const WeekPatternTypeSchema = z.enum([
  "weekly",
  "biweekly",
  "monthly", 
  "custom"
]);

export const DayOfWeekSchema = z.enum([
  "monday",
  "tuesday",
  "wednesday", 
  "thursday",
  "friday",
  "saturday",
  "sunday"
]);

// ========================================
// TIME SLOT SCHEMAS
// ========================================

export const TimeSlotSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(100),
  dayOfWeek: DayOfWeekSchema,
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/), // HH:MM:SS format
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(1).default(1),
  maxConcurrentSessions: z.number().int().min(1).default(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateTimeSlotSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  dayOfWeek: DayOfWeekSchema,
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Format d'heure invalide (HH:MM:SS)"),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Format d'heure invalide (HH:MM:SS)"),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(1).max(10).default(5),
  maxConcurrentSessions: z.number().int().min(1).default(1),
}).refine(
  (data) => {
    const start = new Date(`2000-01-01T${data.startTime}`);
    const end = new Date(`2000-01-01T${data.endTime}`);
    return start < end;
  },
  { message: "L'heure de début doit être antérieure à l'heure de fin" }
);

export const UpdateTimeSlotSchema = z.object({
  name: z.string().min(1, "Le nom est requis").optional(),
  dayOfWeek: DayOfWeekSchema.optional(),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Format d'heure invalide (HH:MM:SS)").optional(),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Format d'heure invalide (HH:MM:SS)").optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(1).max(10).optional(),
  maxConcurrentSessions: z.number().int().min(1).optional(),
}).refine(
  (data) => {
    if (data.startTime && data.endTime) {
      const start = new Date(`2000-01-01T${data.startTime}`);
      const end = new Date(`2000-01-01T${data.endTime}`);
      return start < end;
    }
    return true;
  },
  { message: "L'heure de début doit être antérieure à l'heure de fin" }
);

// ========================================
// COURSE SELECTION SCHEMAS
// ========================================

export const SelectedCourseSchema = z.object({
  courseId: z.string().uuid(),
  requiredHours: z.number().int().positive(),
  preferredSessionDuration: z.number().int().min(30).max(240).default(120), // minutes
  maxSessionsPerWeek: z.number().int().min(1).max(10).optional(),
});

export const GenerationPreferencesSchema = z.object({
  balanceWorkload: z.boolean().default(true),
  avoidBackToBackSessions: z.boolean().default(false),
  preferMorningSlots: z.boolean().default(false),
  maxDailyHours: z.number().int().min(2).max(12).optional(),
  allowWeekendSessions: z.boolean().default(false),
});

// ========================================
// SCHEDULE GENERATION REQUEST SCHEMAS
// ========================================

export const ScheduleGenerationRequestSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  classId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  selectedCourses: z.array(SelectedCourseSchema).min(1),
  availableTimeSlots: z.array(z.string().uuid()).min(1),
  generationPreferences: GenerationPreferencesSchema.optional(),
  status: ScheduleGenerationStatusSchema,
  errorMessage: z.string().optional(),
  processingStartedAt: z.date().optional(),
  processingCompletedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateScheduleGenerationRequestSchema = z.object({
  classId: z.string().uuid(),
  selectedCourses: z.array(SelectedCourseSchema).min(1),
  availableTimeSlots: z.array(z.string().uuid()).min(1),
  generationPreferences: GenerationPreferencesSchema.optional(),
});

// ========================================
// GENERATED SCHEDULE SCHEMAS
// ========================================

export const ScheduleConflictSchema = z.object({
  type: z.enum(["room_conflict", "teacher_conflict", "time_overlap", "capacity_exceeded"]),
  description: z.string(),
  affectedSessions: z.array(z.string().uuid()),
  severity: z.enum(["low", "medium", "high", "critical"]),
});

export const ScheduleSessionSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  courseName: z.string(),
  teacherId: z.string().uuid().optional(),
  teacherName: z.string().optional(),
  classroomId: z.string().uuid().optional(),
  classroomName: z.string().optional(),
  dayOfWeek: DayOfWeekSchema,
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  durationMinutes: z.number().int().positive(),
  weekPattern: WeekPatternTypeSchema,
});

export const GeneratedScheduleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  generationRequestId: z.string().uuid(),
  scheduleData: z.object({
    sessions: z.array(ScheduleSessionSchema),
    totalHours: z.number(),
    weeklyDistribution: z.record(DayOfWeekSchema, z.number()),
  }),
  optimizationScore: z.number().min(0).max(100).optional(),
  conflictsDetected: z.array(ScheduleConflictSchema),
  generationAlgorithm: z.string().default("genetic"),
  generationDurationMs: z.number().int().optional(),
  isApproved: z.boolean().default(false),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const ApproveScheduleSchema = z.object({
  scheduleId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ========================================
// SCHEDULED SESSION SCHEMAS
// ========================================

export const ScheduledSessionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  generatedScheduleId: z.string().uuid(),
  classCourseId: z.string().uuid(),
  teacherId: z.string().uuid().optional(),
  classroomId: z.string().uuid().optional(),
  dayOfWeek: DayOfWeekSchema,
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  durationMinutes: z.number().int().positive(),
  weekPattern: WeekPatternTypeSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ========================================
// API RESPONSE SCHEMAS
// ========================================

export const GenerationOptionsSchema = z.object({
  availableCourses: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    hoursTotal: z.number().int().positive(),
    isAssigned: z.boolean(),
    teacherName: z.string().optional(),
  })),
  availableTimeSlots: z.array(TimeSlotSchema),
  availableClassrooms: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    capacity: z.number().int().positive(),
    type: z.string().optional(),
  })),
  classInfo: z.object({
    id: z.string().uuid(),
    name: z.string(),
    capacity: z.number().int().positive(),
    programmeName: z.string(),
  }),
});

export const GenerationStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: ScheduleGenerationStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  estimatedTimeRemaining: z.number().int().optional(), // seconds
  errorMessage: z.string().optional(),
  createdAt: z.date(),
  processingStartedAt: z.date().optional(),
  processingCompletedAt: z.date().optional(),
});

export const GenerationResultSchema = z.object({
  request: ScheduleGenerationRequestSchema,
  schedule: GeneratedScheduleSchema.optional(),
  alternatives: z.array(GeneratedScheduleSchema).optional(),
});

// ========================================
// QUERY SCHEMAS
// ========================================

export const TimeSlotQuerySchema = z.object({
  dayOfWeek: DayOfWeekSchema.optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(1).optional(),
});

export const ScheduleGenerationRequestQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  status: ScheduleGenerationStatusSchema.optional(),
  requestedBy: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// ========================================
// TYPE EXPORTS
// ========================================

export type ScheduleGenerationStatus = z.infer<typeof ScheduleGenerationStatusSchema>;
export type WeekPatternType = z.infer<typeof WeekPatternTypeSchema>;
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

export type TimeSlot = z.infer<typeof TimeSlotSchema>;
export type CreateTimeSlot = z.infer<typeof CreateTimeSlotSchema>;
export type UpdateTimeSlot = z.infer<typeof UpdateTimeSlotSchema>;

export type SelectedCourse = z.infer<typeof SelectedCourseSchema>;
export type GenerationPreferences = z.infer<typeof GenerationPreferencesSchema>;

export type ScheduleGenerationRequest = z.infer<typeof ScheduleGenerationRequestSchema>;
export type CreateScheduleGenerationRequest = z.infer<typeof CreateScheduleGenerationRequestSchema>;

export type ScheduleConflict = z.infer<typeof ScheduleConflictSchema>;
export type ScheduleSession = z.infer<typeof ScheduleSessionSchema>;
export type GeneratedSchedule = z.infer<typeof GeneratedScheduleSchema>;
export type ApproveSchedule = z.infer<typeof ApproveScheduleSchema>;

export type ScheduledSession = z.infer<typeof ScheduledSessionSchema>;

export type GenerationOptions = z.infer<typeof GenerationOptionsSchema>;
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

export type TimeSlotQuery = z.infer<typeof TimeSlotQuerySchema>;
export type ScheduleGenerationRequestQuery = z.infer<typeof ScheduleGenerationRequestQuerySchema>;
