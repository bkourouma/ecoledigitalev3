/**
 * API Contracts: Teacher Students List
 * 
 * Feature: 001-modify-teacher-students
 * Endpoint: GET /api/v1/teacher/students
 * 
 * This file defines the request/response schemas for the teacher students
 * endpoint using Zod for runtime validation. These schemas should be moved
 * to packages/contracts/src/ during implementation.
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
 * Student status enum
 */
export const StudentStatusSchema = z.enum(['active', 'warning', 'inactive']);
export type StudentStatus = z.infer<typeof StudentStatusSchema>;

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
  status: StudentStatusSchema,
  
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
 * Pagination metadata
 */
export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

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
  pagination: PaginationSchema,
});

export type TeacherStudentsResponse = z.infer<typeof TeacherStudentsResponseSchema>;

// ============================================================================
// ERROR SCHEMAS
// ============================================================================

/**
 * Standard error response
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.any()).optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ============================================================================
// HTTP STATUS CODES
// ============================================================================

/**
 * Expected HTTP status codes for this endpoint:
 * 
 * - 200 OK: Successful response with students data
 * - 400 Bad Request: Invalid query parameters (validation failed)
 * - 401 Unauthorized: Missing or invalid authentication
 * - 403 Forbidden: User does not have teacher role
 * - 500 Internal Server Error: Database error or unexpected failure
 */

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/**
 * Example 1: Get all students across all classes (default)
 * 
 * Request:
 *   GET /api/v1/teacher/students
 *   Headers:
 *     X-Tenant: imhotepacademy
 *     X-User-Id: d7ea2980-d464-480b-b84c-13ed7df031bb
 * 
 * Response (200):
 *   {
 *     "classes": [
 *       { "id": "class-1", "name": "Licence 1 Info", "code": "L1-INFO", "studentCount": 25 },
 *       { "id": "class-2", "name": "Master DS-IA", "code": "M2-DS", "studentCount": 15 }
 *     ],
 *     "students": [
 *       {
 *         "id": "student-1",
 *         "matricule": "STU20240001",
 *         "firstName": "Jean",
 *         "lastName": "Dupont",
 *         "email": "jean.dupont@example.com",
 *         "phone": "+225 07 XX XX XX XX",
 *         "status": "active",
 *         "classId": "class-1",
 *         "className": "Licence 1 Info",
 *         "classCode": "L1-INFO",
 *         "average": null,
 *         "attendance": null,
 *         "enrollmentDate": "2024-09-01",
 *         "enrollmentStatus": "active"
 *       },
 *       // ... more students
 *     ],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 20,
 *       "total": 40,
 *       "totalPages": 2
 *     }
 *   }
 */

/**
 * Example 2: Filter by specific class
 * 
 * Request:
 *   GET /api/v1/teacher/students?classId=class-1
 *   Headers: [same as Example 1]
 * 
 * Response (200):
 *   {
 *     "classes": [/* same as Example 1 */],
 *     "students": [/* only students from class-1 */],
 *     "pagination": { "page": 1, "limit": 20, "total": 25, "totalPages": 2 }
 *   }
 */

/**
 * Example 3: Include performance metrics
 * 
 * Request:
 *   GET /api/v1/teacher/students?includeMetrics=true
 *   Headers: [same as Example 1]
 * 
 * Response (200):
 *   {
 *     "classes": [/* same */],
 *     "students": [
 *       {
 *         // ... student fields
 *         "average": 14.5,      // Grade out of 20
 *         "attendance": 85.0,   // 85% attendance
 *         // ... other fields
 *       }
 *     ],
 *     "pagination": { /* ... */ }
 *   }
 */

/**
 * Example 4: Validation error
 * 
 * Request:
 *   GET /api/v1/teacher/students?classId=not-a-uuid
 * 
 * Response (400):
 *   {
 *     "error": "Validation Error",
 *     "message": "Invalid classId: must be a valid UUID",
 *     "details": {
 *       "field": "classId",
 *       "value": "not-a-uuid",
 *       "expected": "uuid"
 *     }
 *   }
 */

/**
 * Example 5: Unauthorized access
 * 
 * Request:
 *   GET /api/v1/teacher/students
 *   Headers:
 *     X-Tenant: imhotepacademy
 *     (missing X-User-Id)
 * 
 * Response (401):
 *   {
 *     "error": "Unauthorized",
 *     "message": "Authentication required. X-User-Id header missing."
 *   }
 */

/**
 * Example 6: Non-teacher user
 * 
 * Request:
 *   GET /api/v1/teacher/students
 *   Headers:
 *     X-Tenant: imhotepacademy
 *     X-User-Id: student-user-id
 * 
 * Response (403):
 *   {
 *     "error": "Forbidden",
 *     "message": "Access denied. Teacher role required."
 *   }
 */

// ============================================================================
// IMPLEMENTATION NOTES
// ============================================================================

/**
 * Backend Implementation Checklist:
 * 
 * 1. Create route file: apps/api/src/routes/teacher-students.ts
 * 2. Validate query params using TeacherStudentsQuerySchema
 * 3. Extract teacherId from X-User-Id header
 * 4. Extract tenantId from request context (X-Tenant header)
 * 5. Verify user has teacher role (join with teachers table)
 * 6. Execute Query 1 (get teacher's classes) from data-model.md
 * 7. Execute Query 2 (get students) with optional classId filter
 * 8. If includeMetrics=true, execute Query 3 (performance metrics)
 * 9. Transform database rows to TeacherStudent schema
 * 10. Apply pagination (LIMIT/OFFSET)
 * 11. Return TeacherStudentsResponse
 * 12. Handle errors with appropriate status codes
 * 13. Log security events (unauthorized access attempts)
 * 
 * Frontend Implementation Checklist:
 * 
 * 1. Update apps/web/src/lib/hooks/use-teachers.ts
 * 2. Create new hook: useTeacherStudentsByClass(classId?: string)
 * 3. Update apps/web/src/app/teacher/students/page.tsx
 * 4. Replace useTeacherAssignments() with useTeacherStudentsByClass()
 * 5. Update filter dropdown to use classes from response
 * 6. Update student list to use students from response
 * 7. Handle multi-class students (optional consolidation)
 * 8. Preserve existing search functionality
 * 9. Update statistics calculations based on filtered students
 * 10. Add loading/error states
 * 
 * Testing Checklist:
 * 
 * 1. Unit test: Zod schema validation (valid/invalid inputs)
 * 2. Integration test: API endpoint with mock database
 * 3. E2E test: Teacher can view all students
 * 4. E2E test: Teacher can filter by class
 * 5. Security test: Non-teacher cannot access endpoint
 * 6. Security test: Teacher cannot see students from other tenants
 * 7. Performance test: Response time < 500ms for 100+ students
 * 8. Edge case test: Teacher with no assignments
 * 9. Edge case test: Class with no students
 * 10. Edge case test: Student in multiple classes
 */

