/**
 * API Contracts: Teacher Students List
 * 
 * Feature: 001-modify-teacher-students
 * Endpoint: GET /api/v1/teacher/students
 * 
 * Zod schemas for teacher students endpoint with class filtering
 */

import { z } from 'zod';

// ============================================================================
// REQUEST SCHEMAS
// ============================================================================

/**
 * Query parameters for GET /api/v1/teacher/students
 */
export const TeacherStudentsQuerySchema = z.object({
  /**
   * Optional class filter - if provided, only students from this class are returned
   * If omitted or "all", returns students from all teacher's assigned classes
   */
  classId: z.string().uuid().optional(),
  
  /**
   * Whether to include performance metrics (average grade, attendance rate)
   * Default: false (metrics are expensive to calculate)
   */
  includeMetrics: z.boolean().optional().default(false),
  
  /**
   * Page number for pagination (1-indexed)
   * Default: 1
   */
  page: z.coerce.number().int().min(1).default(1),
  
  /**
   * Number of students per page
   * Default: 20, Max: 100
   */
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type TeacherStudentsQuery = z.infer<typeof TeacherStudentsQuerySchema>;

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Class information for filter dropdown
 */
export const TeacherClassSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  studentCount: z.number().int().nonnegative(),
});

export type TeacherClass = z.infer<typeof TeacherClassSchema>;

/**
 * Roster status for teacher students list (distinct from core `student.StudentStatusSchema`).
 */
export const TeacherStudentRosterStatusSchema = z.enum(['active', 'warning', 'inactive']);
export type TeacherStudentRosterStatus = z.infer<typeof TeacherStudentRosterStatusSchema>;

/**
 * Individual student information
 */
export const TeacherStudentSchema = z.object({
  id: z.string().uuid(),
  matricule: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  status: TeacherStudentRosterStatusSchema,
  
  // Class context
  classId: z.string().uuid(),
  className: z.string(),
  classCode: z.string(),
  
  // Performance metrics (optional, only if includeMetrics=true)
  average: z.number().min(0).max(20).nullable(), // Grade out of 20
  attendance: z.number().min(0).max(100).nullable(), // Percentage
  
  // Enrollment info
  enrollmentDate: z.string(), // ISO date string
  enrollmentStatus: z.string(),
  
  // Multi-class indicator (frontend-calculated)
  classes: z.array(z.string()).optional(), // All classes if student in multiple
  isMultiClass: z.boolean().optional(),
});

export type TeacherStudent = z.infer<typeof TeacherStudentSchema>;

/**
 * Pagination metadata for teacher students response (distinct from `common.PaginationSchema`).
 */
export const TeacherStudentsPaginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type TeacherStudentsPagination = z.infer<typeof TeacherStudentsPaginationSchema>;

/**
 * Main response schema for GET /api/v1/teacher/students
 */
export const TeacherStudentsResponseSchema = z.object({
  /**
   * List of classes where teacher has assignments
   * Used to populate the class filter dropdown
   */
  classes: z.array(TeacherClassSchema),
  
  /**
   * Students enrolled in the filtered/all classes
   */
  students: z.array(TeacherStudentSchema),
  
  /**
   * Pagination information
   */
  pagination: TeacherStudentsPaginationSchema,
});

export type TeacherStudentsResponse = z.infer<typeof TeacherStudentsResponseSchema>;

// ============================================================================
// ERROR SCHEMAS
// ============================================================================

/**
 * Standard error response
 */
export const TeacherStudentsErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.any()).optional(),
});

export type TeacherStudentsErrorResponse = z.infer<typeof TeacherStudentsErrorResponseSchema>;

