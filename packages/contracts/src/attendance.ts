import { z } from "zod";

// ========================================
// ENUM SCHEMAS
// ========================================

export const AttendanceStatusSchema = z.enum([
  'present',      // Student was present for the entire session
  'absent',       // Student was absent without excuse
  'late',         // Student arrived late but attended
  'excused',      // Student was absent with valid excuse
  'medical_leave' // Student on medical leave
]);

export const AttendanceSessionTypeSchema = z.enum([
  'theory',       // Theory class session (existing)
  'practical',    // Practical class session (existing)
  'exam',         // Examination session (existing)
  'evaluation',   // Assessment or evaluation session (existing)
  'regular',      // Regular class session (new)
  'makeup',       // Make-up session for missed class (new)
  'field_trip',   // Field trip or external activity (new)
  'lab'           // Laboratory session (new)
]);

export const SessionStatusSchema = z.enum([
  'scheduled',    // Session is planned but not started
  'in_progress',  // Session is currently active
  'completed',    // Session has been completed
  'cancelled'     // Session was cancelled
]);

// ========================================
// TYPE EXPORTS
// ========================================

export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;
export type AttendanceSessionType = z.infer<typeof AttendanceSessionTypeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// ========================================
// ATTENDANCE SESSION SCHEMAS
// ========================================

export const AttendanceSessionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  classCourseId: z.string().uuid(),
  teacherId: z.string().uuid(),
  classroomId: z.string().uuid().optional(),

  // Session timing
  sessionDate: z.date(),
  sessionTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/), // HH:MM:SS format
  durationMinutes: z.number().int().positive().default(120),

  // Session details
  sessionType: AttendanceSessionTypeSchema.default('theory'),
  location: z.string().optional(),
  notes: z.string().optional(),

  // Status tracking
  status: SessionStatusSchema.default('scheduled'),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),

  // Audit fields
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateAttendanceSessionSchema = z.object({
  classCourseId: z.string().uuid(),
  teacherId: z.string().uuid(),
  classroomId: z.string().uuid().optional(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
  sessionTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  durationMinutes: z.number().int().positive().default(120),
  sessionType: AttendanceSessionTypeSchema.default('theory'),
  location: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateAttendanceSessionSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sessionTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  durationMinutes: z.number().int().positive().optional(),
  sessionType: AttendanceSessionTypeSchema.optional(),
  classroomId: z.string().uuid().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  status: SessionStatusSchema.optional(),
});

// ========================================
// STUDENT ATTENDANCE SCHEMAS
// ========================================

export const StudentAttendanceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  
  // Attendance details
  attendanceStatus: AttendanceStatusSchema,
  arrivalTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  departureTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  
  // Excuse and documentation
  excuseReason: z.string().optional(),
  excuseDocumentUrl: z.string().url().optional(),
  
  // Audit information
  markedBy: z.string().uuid(),
  markedAt: z.date(),
  isMakeup: z.boolean().default(false),
  notes: z.string().optional(),
  
  // Audit fields
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateStudentAttendanceSchema = z.object({
  studentId: z.string().uuid(),
  attendanceStatus: AttendanceStatusSchema,
  arrivalTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  departureTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  excuseReason: z.string().optional(),
  excuseDocumentUrl: z.string().url().optional(),
  isMakeup: z.boolean().default(false),
  notes: z.string().optional(),
});

export const UpdateStudentAttendanceSchema = z.object({
  attendanceStatus: AttendanceStatusSchema.optional(),
  arrivalTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  departureTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  excuseReason: z.string().optional(),
  excuseDocumentUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

// ========================================
// BATCH OPERATIONS SCHEMAS
// ========================================

export const BatchAttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  attendanceStatus: AttendanceStatusSchema,
  arrivalTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  departureTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  excuseReason: z.string().optional(),
  notes: z.string().optional(),
});

export const BatchAttendanceSchema = z.object({
  attendanceRecords: z.array(BatchAttendanceRecordSchema).min(1),
  notes: z.string().optional(),
});

// ========================================
// ANALYTICS AND REPORTING SCHEMAS
// ========================================

export const AttendanceSummarySchema = z.object({
  studentId: z.string().uuid(),
  totalSessions: z.number().int().nonnegative(),
  presentCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  lateCount: z.number().int().nonnegative(),
  excusedCount: z.number().int().nonnegative(),
  medicalLeaveCount: z.number().int().nonnegative(),
  attendancePercentage: z.number().min(0).max(100),
  consecutiveAbsences: z.number().int().nonnegative(),
  lastSessionDate: z.date().optional(),
});

export const ClassAttendanceSummarySchema = z.object({
  classCourseId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sessionDate: z.date(),
  totalStudents: z.number().int().nonnegative(),
  presentCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  lateCount: z.number().int().nonnegative(),
  excusedCount: z.number().int().nonnegative(),
  attendanceRate: z.number().min(0).max(100),
});

export const AttendancePatternSchema = z.object({
  studentId: z.string().uuid(),
  weeklyPattern: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday, 6 = Saturday
    attendanceRate: z.number().min(0).max(100),
  })),
  monthlyTrend: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM format
    attendanceRate: z.number().min(0).max(100),
  })),
  riskLevel: z.enum(['low', 'medium', 'high']),
  recommendations: z.array(z.string()),
});

// ========================================
// QUERY SCHEMAS
// ========================================

export const AttendanceSessionQuerySchema = z.object({
  classCourseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: SessionStatusSchema.optional(),
  sessionType: AttendanceSessionTypeSchema.optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const StudentAttendanceQuerySchema = z.object({
  sessionId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  attendanceStatus: AttendanceStatusSchema.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

// ========================================
// TYPE EXPORTS
// ========================================

export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;
export type CreateAttendanceSession = z.infer<typeof CreateAttendanceSessionSchema>;
export type UpdateAttendanceSession = z.infer<typeof UpdateAttendanceSessionSchema>;

export type StudentAttendance = z.infer<typeof StudentAttendanceSchema>;
export type CreateStudentAttendance = z.infer<typeof CreateStudentAttendanceSchema>;
export type UpdateStudentAttendance = z.infer<typeof UpdateStudentAttendanceSchema>;

export type BatchAttendanceRecord = z.infer<typeof BatchAttendanceRecordSchema>;
export type BatchAttendance = z.infer<typeof BatchAttendanceSchema>;

export type AttendanceSummary = z.infer<typeof AttendanceSummarySchema>;
export type ClassAttendanceSummary = z.infer<typeof ClassAttendanceSummarySchema>;
export type AttendancePattern = z.infer<typeof AttendancePatternSchema>;

export type AttendanceSessionQuery = z.infer<typeof AttendanceSessionQuerySchema>;
export type StudentAttendanceQuery = z.infer<typeof StudentAttendanceQuerySchema>;
