import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// Zod schemas from contracts package
const TeacherStudentsQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  includeMetrics: z.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

interface TeacherStudentsRequest extends FastifyRequest {
  query: {
    classId?: string;
    includeMetrics?: boolean;
    page?: number;
    limit?: number;
  };
  tenantId?: string;
}

/**
 * Helper function to map student and enrollment status to display status
 */
function mapStatus(
  profileStatus: string,
  enrollmentStatus: string
): 'active' | 'warning' | 'inactive' {
  if (profileStatus !== 'active') return 'inactive';
  if (enrollmentStatus === 'suspended') return 'warning';
  if (enrollmentStatus === 'active') return 'active';
  return 'inactive';
}

export async function teacherStudentsRoutes(fastify: FastifyInstance) {
  
  // GET /api/v1/teacher/classes - Get all classes assigned to teacher
  fastify.get('/classes', {
    schema: {
      description: 'Get all classes assigned to the authenticated teacher',
      tags: ['Teacher Classes'],
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  code: { type: 'string' },
                  studentCount: { type: 'number' }
                }
              }
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                page: { type: 'number' },
                limit: { type: 'number' },
                totalPages: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (request: TeacherStudentsRequest, reply: FastifyReply) => {
    // VALIDATION: Step 1 - Validate tenant context
    if (!request.tenantId) {
      return reply.status(400).send({
        error: 'Tenant Required',
        message: 'This endpoint requires tenant context'
      });
    }

    // VALIDATION: Step 2 - Validate user authentication
    const userId = request.headers['x-user-id'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
    if (!userId) {
      return reply.status(401).send({
        error: 'Authentication Required',
        message: 'Authentication required. X-User-Id header missing.'
      });
    }

    try {
      // Step 4: Get teacher ID from user ID
      const teacherQuery = await fastify.pg.query(`
        SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
      `, [userId, request.tenantId]);

      if (teacherQuery.rows.length === 0) {
        fastify.log.warn(`Teacher access denied for user ${userId}`);
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Access denied. Teacher role required.'
        });
      }

      const teacherId = teacherQuery.rows[0].id;
      fastify.log.info(`Teacher classes request - teacherId: ${teacherId}`);

      // Get teacher's classes with student count
      const classesQuery = await fastify.pg.query(`
        SELECT DISTINCT
          cl.id,
          cl.name,
          cl.code,
          COUNT(DISTINCT se.student_id) as student_count
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        LEFT JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          ${activeAcademicYearId ? 'AND cl.academic_year_id = $3' : ''}
        GROUP BY cl.id, cl.name, cl.code
        ORDER BY cl.name ASC
      `, activeAcademicYearId ? [teacherId, request.tenantId, activeAcademicYearId] : [teacherId, request.tenantId]);

      // Debug: Check if there are any student enrollments
      const debugQuery = await fastify.pg.query(`
        SELECT COUNT(*) as total_enrollments, 
               COUNT(CASE WHEN status = 'active' THEN 1 END) as active_enrollments,
               COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended_enrollments,
               COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_enrollments,
               COUNT(CASE WHEN status = 'dropped' THEN 1 END) as dropped_enrollments,
               COUNT(CASE WHEN status = 'transferred' THEN 1 END) as transferred_enrollments
        FROM student_enrollments 
        WHERE tenant_id = $1
      `, [request.tenantId]);

      fastify.log.info('Student enrollments debug:', debugQuery.rows[0]);

      const classes = classesQuery.rows.map(row => ({
        id: row.id,
        name: row.name,
        code: row.code,
        studentCount: parseInt(row.student_count, 10) || 0
      }));

      return reply.send({
        data: classes,
        pagination: {
          total: classes.length,
          page: 1,
          limit: classes.length,
          totalPages: 1
        }
      });

    } catch (error) {
      fastify.log.error(`Error fetching teacher classes: ${error}`);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred while fetching teacher classes'
      });
    }
  });

  // GET /api/v1/teacher/students - Get all students from classes assigned to teacher
  fastify.get('/', {
    schema: {
      description: 'Get all students from classes assigned to the authenticated teacher',
      tags: ['Teacher Students'],
      querystring: {
        type: 'object',
        properties: {
          classId: { type: 'string', format: 'uuid' },
          includeMetrics: { type: 'boolean', default: false },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 }
        }
      },
      headers: {
        type: 'object',
        properties: {
          'x-user-id': { type: 'string', format: 'uuid' },
          'x-tenant': { type: 'string' }
        },
        required: ['x-user-id', 'x-tenant']
      }
    }
  }, async (request: TeacherStudentsRequest, reply: FastifyReply) => {
    // VALIDATION: Step 1 - Validate tenant context
    if (!request.tenantId) {
      return reply.status(400).send({
        error: 'Tenant Required',
        message: 'This endpoint requires tenant context'
      });
    }

    // VALIDATION: Step 2 - Validate query parameters
    const queryValidation = TeacherStudentsQuerySchema.safeParse(request.query);
    if (!queryValidation.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: queryValidation.error.message,
        details: queryValidation.error.format()
      });
    }

    const { classId, includeMetrics, page, limit } = queryValidation.data;

    // VALIDATION: Step 3 - Extract and validate teacher ID
    const userId = request.headers['x-user-id'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
    if (!userId) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required. X-User-Id header missing.'
      });
    }

    try {
      // Step 4: Get teacher ID from user ID
      const teacherQuery = await fastify.pg.query(`
        SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
      `, [userId, request.tenantId]);

      if (teacherQuery.rows.length === 0) {
        fastify.log.warn(`Teacher access denied for user ${userId}`);
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Access denied. Teacher role required.'
        });
      }

      const teacherId = teacherQuery.rows[0].id;
      fastify.log.info(`Teacher students request - teacherId: ${teacherId}, classId: ${classId || 'all'}`);

      // QUERY 1: Step 5 - Get teacher's classes (for filter dropdown)
      const classesQuery = await fastify.pg.query(`
        SELECT DISTINCT
          cl.id,
          cl.name,
          cl.code,
          COUNT(DISTINCT se.student_id) as student_count
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        LEFT JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          ${activeAcademicYearId ? 'AND cl.academic_year_id = $3' : ''}
        GROUP BY cl.id, cl.name, cl.code
        ORDER BY cl.name ASC
      `, activeAcademicYearId ? [teacherId, request.tenantId, activeAcademicYearId] : [teacherId, request.tenantId]);

      const classes = classesQuery.rows.map(row => ({
        id: row.id,
        name: row.name,
        code: row.code,
        studentCount: parseInt(row.student_count, 10) || 0
      }));

      // QUERY 2 & 3: Step 6 - Get students (with optional class filter) + count
      const offset = (page - 1) * limit;
      
      // First, get the total count for pagination
      const countQuery = await fastify.pg.query(`
        SELECT COUNT(DISTINCT (sp.id, cl.id)) as total
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN student_enrollments se ON se.class_id = cl.id
        JOIN student_profiles sp ON se.student_id = sp.id
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          AND ($3::uuid IS NULL OR cl.id = $3)
          AND sp.tenant_id = $2
          ${activeAcademicYearId ? 'AND cl.academic_year_id = $4' : ''}
      `, activeAcademicYearId
        ? [teacherId, request.tenantId, classId || null, activeAcademicYearId]
        : [teacherId, request.tenantId, classId || null]);

      const total = parseInt(countQuery.rows[0]?.total || '0', 10);

      // Then get the actual student data with deduplication
      const studentsQuery = await fastify.pg.query(`
        SELECT DISTINCT ON (sp.id, cl.id)
          sp.id,
          sp.student_number as matricule,
          u.first_name,
          u.last_name,
          u.email,
          sp.phone,
          sp.status,
          cl.id as class_id,
          cl.name as class_name,
          cl.code as class_code,
          se.enrollment_date,
          se.status as enrollment_status
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN student_enrollments se ON se.class_id = cl.id
        JOIN student_profiles sp ON se.student_id = sp.id
        JOIN users u ON sp.user_id = u.id
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          AND ($3::uuid IS NULL OR cl.id = $3)
          AND sp.tenant_id = $2
          ${activeAcademicYearId ? 'AND cl.academic_year_id = $6' : ''}
        ORDER BY sp.id, cl.id, u.last_name ASC, u.first_name ASC
        LIMIT $4 OFFSET $5
      `, activeAcademicYearId
        ? [teacherId, request.tenantId, classId || null, limit, offset, activeAcademicYearId]
        : [teacherId, request.tenantId, classId || null, limit, offset]);

      // TRANSFORMATION: Step 8 - Transform students data
      const students = studentsQuery.rows.map(row => ({
        id: row.id,
        matricule: row.matricule || `STU${row.id.substring(0, 8)}`,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone || null,
        status: mapStatus(row.status, row.enrollment_status),
        classId: row.class_id,
        className: row.class_name,
        classCode: row.class_code,
        average: null, // TODO: Phase 5 - Implement performance metrics
        attendance: null, // TODO: Phase 5 - Implement performance metrics
        enrollmentDate: row.enrollment_date || new Date().toISOString().split('T')[0],
        enrollmentStatus: row.enrollment_status || 'active'
      }));

      // Step 9: Return response
      const response = {
        classes,
        students,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };

      fastify.log.info(`Returning ${students.length} students from ${classes.length} classes`);
      return reply.send(response);

    } catch (error) {
      fastify.log.error(`Teacher students error: ${error}`);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch teacher students',
        details: process.env.NODE_ENV === 'development' ? { error: String(error) } : undefined
      });
    }
  });

  // GET /api/v1/teacher/classes/performance - Get class performance statistics
  fastify.get('/classes/performance', {
    schema: {
      description: 'Get performance statistics for all classes assigned to teacher',
      tags: ['Teacher Classes'],
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  classId: { type: 'string' },
                  className: { type: 'string' },
                  classCode: { type: 'string' },
                  programmeName: { type: 'string' },
                  studentCount: { type: 'number' },
                  courseCount: { type: 'number' },
                  averageGrade: { type: 'number' },
                  attendanceRate: { type: 'number' },
                  completionRate: { type: 'number' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request: TeacherStudentsRequest, reply: FastifyReply) => {
    if (!request.tenantId) {
      return reply.status(400).send({
        error: 'Tenant Required',
        message: 'This endpoint requires tenant context'
      });
    }

    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({
        error: 'Authentication Required',
        message: 'Authentication required. X-User-Id header missing.'
      });
    }

    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

    try {
      // Get teacher ID
      const teacherQuery = await fastify.pg.query(`
        SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
      `, [userId, request.tenantId]);

      if (teacherQuery.rows.length === 0) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Access denied. Teacher role required.'
        });
      }

      const teacherId = teacherQuery.rows[0].id;

      // Get class performance statistics
      const performanceQuery = await fastify.pg.query(`
        SELECT 
          cl.id as class_id,
          cl.name as class_name,
          cl.code as class_code,
          p.name as programme_name,
          COUNT(DISTINCT se.student_id) as student_count,
          COUNT(DISTINCT cc.course_id) as course_count,
          COALESCE(
            (SELECT AVG(
              CASE 
                WHEN s.final_score IS NOT NULL THEN s.final_score
                WHEN s.manual_score IS NOT NULL THEN s.manual_score
                ELSE NULL
              END
            )
            FROM assignment_instances ai2
            JOIN assignment_submissions s ON s.assignment_instance_id = ai2.id AND s.tenant_id = $2
            WHERE ai2.class_id = cl.id AND ai2.tenant_id = $2
              AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
            ), 0
          ) as average_grade,
          -- Attendance rate from teacher_attendance_sessions and student_attendance
          COALESCE(
            (SELECT 
              CASE 
                WHEN COUNT(sa.id) > 0 THEN
                  (COUNT(CASE WHEN sa.attendance_status = 'present' THEN 1 END)::float / 
                   NULLIF(COUNT(sa.id), 0)::float * 100)
                ELSE 0
              END
             FROM teacher_attendance_sessions tas
             JOIN teacher_assignments ta2 ON tas.assignment_id = ta2.id
             JOIN class_courses cc2 ON ta2.class_course_id = cc2.id
             LEFT JOIN student_attendance sa ON sa.session_id = tas.id AND sa.tenant_id = $2
             WHERE cc2.class_id = cl.id AND ta2.teacher_id = $1 AND tas.tenant_id = $2
            ), 0
          ) as attendance_rate,
          -- Completion rate (graded assignments / total assignments)
          COALESCE(
            (SELECT 
              CASE 
                WHEN COUNT(DISTINCT ai3.id) > 0 THEN
                  (COUNT(DISTINCT CASE 
                    WHEN s2.final_score IS NOT NULL OR s2.manual_score IS NOT NULL 
                    THEN ai3.id 
                  END)::float / COUNT(DISTINCT ai3.id)::float * 100)
                ELSE 0
              END
             FROM assignment_instances ai3
             LEFT JOIN assignment_submissions s2 ON s2.assignment_instance_id = ai3.id AND s2.tenant_id = $2
             WHERE ai3.class_id = cl.id AND ai3.tenant_id = $2
            ), 0
          ) as completion_rate
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN programmes p ON cl.programme_id = p.id
        LEFT JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2 AND se.status = 'active'
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          ${activeAcademicYearId ? 'AND cl.academic_year_id = $3' : ''}
        GROUP BY cl.id, cl.name, cl.code, p.name
        ORDER BY cl.name ASC
      `, activeAcademicYearId ? [teacherId, request.tenantId, activeAcademicYearId] : [teacherId, request.tenantId]);

      const performance = performanceQuery.rows.map((row: any) => ({
        classId: row.class_id,
        className: row.class_name,
        classCode: row.class_code,
        programmeName: row.programme_name || 'N/A',
        studentCount: parseInt(row.student_count, 10) || 0,
        courseCount: parseInt(row.course_count, 10) || 0,
        averageGrade: parseFloat(row.average_grade) || 0,
        attendanceRate: parseFloat(row.attendance_rate) || 0,
        completionRate: parseFloat(row.completion_rate) || 0
      }));

      return reply.send({ data: performance });

    } catch (error) {
      fastify.log.error(`Error fetching class performance: ${error}`);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred while fetching class performance'
      });
    }
  });

  // GET /api/v1/teacher/students/progress - Get student progress statistics
  fastify.get('/progress', {
    schema: {
      description: 'Get progress statistics for all students assigned to teacher',
      tags: ['Teacher Students'],
      querystring: {
        type: 'object',
        properties: {
          classId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          timeRange: { type: 'string', enum: ['week', 'month', 'semester', 'year'] }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  studentId: { type: 'string' },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  email: { type: 'string' },
                  matricule: { type: 'string' },
                  className: { type: 'string' },
                  courseName: { type: 'string' },
                  currentGrade: { type: 'number' },
                  previousGrade: { type: 'number' },
                  progress: { type: 'number' },
                  assignmentsCompleted: { type: 'number' },
                  totalAssignments: { type: 'number' },
                  lastActivity: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request: TeacherStudentsRequest, reply: FastifyReply) => {
    if (!request.tenantId) {
      return reply.status(400).send({
        error: 'Tenant Required',
        message: 'This endpoint requires tenant context'
      });
    }

    const userId = request.headers['x-user-id'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
    if (!userId) {
      return reply.status(401).send({
        error: 'Authentication Required',
        message: 'Authentication required. X-User-Id header missing.'
      });
    }

    try {
      // Get teacher ID
      const teacherQuery = await fastify.pg.query(`
        SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
      `, [userId, request.tenantId]);

      if (teacherQuery.rows.length === 0) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Access denied. Teacher role required.'
        });
      }

      const teacherId = teacherQuery.rows[0].id;
      const { classId, courseId, timeRange = 'month' } = request.query as any;

      // Calculate date range based on timeRange
      let dateFilter = '';
      const now = new Date();
      let startDate: Date;
      
      switch (timeRange) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'semester':
          startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Build WHERE conditions and stable parameter indexes
      const whereConditions: string[] = ['ta.teacher_id = $1', 'ta.tenant_id = $2'];
      const queryParams: any[] = [teacherId, request.tenantId, startDate];
      const classParamIndex = classId ? 4 : 0;
      const courseParamIndex = courseId ? (classId ? 5 : 4) : 0;
      const academicYearParamIndex = activeAcademicYearId
        ? (courseId ? (classId ? 6 : 5) : (classId ? 5 : 4))
        : 0;

      if (classId) {
        whereConditions.push(`cl.id = $${classParamIndex}`);
        queryParams.push(classId);
      }

      if (courseId) {
        whereConditions.push(`c.id = $${courseParamIndex}`);
        queryParams.push(courseId);
      }
      if (activeAcademicYearId) {
        whereConditions.push(`cl.academic_year_id = $${academicYearParamIndex}`);
        queryParams.push(activeAcademicYearId);
      }

      const whereClause = whereConditions.join(' AND ');
      const courseFilter = courseId ? `AND a.course_id = $${courseParamIndex}` : '';

      // Get students with their progress data
      // Strategy: Include students from teacher_assignments AND students who have graded submissions
      // in courses taught by this teacher (to catch all students with grades, like in corrections page)
      const progressQuery = await fastify.pg.query(`
        SELECT DISTINCT
          sp.id as student_id,
          u.first_name,
          u.last_name,
          u.email,
          sp.student_number as matricule,
          cl.id as class_id,
          cl.name as class_name,
          c.id as course_id,
          c.name as course_name,
          -- Current grade: average of all graded assignments for this course (directly from assignment_submissions)
          COALESCE(
            (SELECT AVG(COALESCE(s.final_score, s.manual_score))
             FROM assignment_submissions s
             JOIN assignments a ON s.assignment_id = a.id
             WHERE s.student_id = sp.id
               AND s.tenant_id = $2
               AND a.tenant_id = $2
               AND a.course_id = c.id
               AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
            ), 0
          ) as current_grade,
          -- Period grade: average for the selected time range (for progress calculation)
          COALESCE(
            (SELECT AVG(COALESCE(s.final_score, s.manual_score))
             FROM assignment_submissions s
             JOIN assignments a ON s.assignment_id = a.id
             WHERE s.student_id = sp.id
               AND s.tenant_id = $2
               AND a.tenant_id = $2
               AND a.course_id = c.id
               AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
               AND s.graded_at >= $3
            ), 0
          ) as period_grade,
          -- Previous period average (before startDate)
          COALESCE(
            (SELECT AVG(COALESCE(s.final_score, s.manual_score))
             FROM assignment_submissions s
             JOIN assignments a ON s.assignment_id = a.id
             WHERE s.student_id = sp.id
               AND s.tenant_id = $2
               AND a.tenant_id = $2
               AND a.course_id = c.id
               AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
               AND s.graded_at < $3
            ), 0
          ) as previous_grade,
          -- Completed assignments count
          COALESCE(
            (SELECT COUNT(DISTINCT ai2.id)
             FROM assignment_instances ai2
             JOIN assignments a2 ON ai2.assignment_id = a2.id
             JOIN assignment_submissions s2 ON s2.assignment_instance_id = ai2.id
             WHERE ai2.class_id = cl.id
               AND a2.course_id = c.id
               AND s2.student_id = sp.id
               AND s2.tenant_id = $2
               AND ai2.tenant_id = $2
               AND (s2.final_score IS NOT NULL OR s2.manual_score IS NOT NULL)
               ${courseFilter}
            ), 0
          ) as assignments_completed,
          -- Total assignments count
          COALESCE(
            (SELECT COUNT(DISTINCT ai3.id)
             FROM assignment_instances ai3
             JOIN assignments a3 ON ai3.assignment_id = a3.id
             WHERE ai3.class_id = cl.id
               AND a3.course_id = c.id
               AND ai3.tenant_id = $2
               ${courseFilter}
            ), 0
          ) as total_assignments,
          -- Last activity (most recent submission or grade)
          COALESCE(
            (SELECT MAX(GREATEST(s3.submitted_at, s3.graded_at))
             FROM assignment_submissions s3
             JOIN assignment_instances ai4 ON s3.assignment_instance_id = ai4.id
             JOIN assignments a4 ON ai4.assignment_id = a4.id
             WHERE s3.student_id = sp.id
               AND s3.tenant_id = $2
               AND ai4.tenant_id = $2
               ${courseFilter}
            ), NULL
          ) as last_activity
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN courses c ON cc.course_id = c.id
        JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2 AND se.status = 'active'
        JOIN student_profiles sp ON se.student_id = sp.id AND sp.tenant_id = $2
        JOIN users u ON sp.user_id = u.id
        WHERE ${whereClause}
        
        UNION
        
        -- Also include students who have graded submissions in courses taught by this teacher
        -- This ensures we catch all students with grades, even if not in teacher_assignments for that specific class-course combo
        SELECT DISTINCT
          sp.id as student_id,
          u.first_name,
          u.last_name,
          u.email,
          sp.student_number as matricule,
          cl.id as class_id,
          cl.name as class_name,
          c.id as course_id,
          c.name as course_name,
          -- Current grade: average of all graded assignments for this course
          COALESCE(
            (SELECT AVG(COALESCE(s.final_score, s.manual_score))
             FROM assignment_submissions s
             JOIN assignments a ON s.assignment_id = a.id
             WHERE s.student_id = sp.id
               AND s.tenant_id = $2
               AND a.tenant_id = $2
               AND a.course_id = c.id
               AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
            ), 0
          ) as current_grade,
          -- Period grade
          COALESCE(
            (SELECT AVG(COALESCE(s.final_score, s.manual_score))
             FROM assignment_submissions s
             JOIN assignments a ON s.assignment_id = a.id
             WHERE s.student_id = sp.id
               AND s.tenant_id = $2
               AND a.tenant_id = $2
               AND a.course_id = c.id
               AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
               AND s.graded_at >= $3
            ), 0
          ) as period_grade,
          -- Previous grade
          COALESCE(
            (SELECT AVG(COALESCE(s.final_score, s.manual_score))
             FROM assignment_submissions s
             JOIN assignments a ON s.assignment_id = a.id
             WHERE s.student_id = sp.id
               AND s.tenant_id = $2
               AND a.tenant_id = $2
               AND a.course_id = c.id
               AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
               AND s.graded_at < $3
            ), 0
          ) as previous_grade,
          -- Completed assignments
          COALESCE(
            (SELECT COUNT(DISTINCT s2.id)
             FROM assignment_submissions s2
             JOIN assignments a2 ON s2.assignment_id = a2.id
             WHERE s2.student_id = sp.id
               AND s2.tenant_id = $2
               AND a2.tenant_id = $2
               AND a2.course_id = c.id
               AND (s2.final_score IS NOT NULL OR s2.manual_score IS NOT NULL)
            ), 0
          ) as assignments_completed,
          -- Total assignments
          COALESCE(
            (SELECT COUNT(DISTINCT a3.id)
             FROM assignments a3
             WHERE a3.course_id = c.id
               AND a3.tenant_id = $2
            ), 0
          ) as total_assignments,
          -- Last activity
          COALESCE(
            (SELECT MAX(GREATEST(s3.submitted_at, s3.graded_at))
             FROM assignment_submissions s3
             JOIN assignments a4 ON s3.assignment_id = a4.id
             WHERE s3.student_id = sp.id
               AND s3.tenant_id = $2
               AND a4.course_id = c.id
            ), NULL
          ) as last_activity
        FROM assignment_submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN courses c ON a.course_id = c.id
        JOIN student_profiles sp ON s.student_id = sp.id
        JOIN users u ON sp.user_id = u.id
        JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = $2 AND se.status = 'active'
        JOIN classes cl ON se.class_id = cl.id
        WHERE s.tenant_id = $2
          AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
          -- Only include courses taught by this teacher
          AND EXISTS (
            SELECT 1 FROM teacher_assignments ta2
            JOIN class_courses cc2 ON ta2.class_course_id = cc2.id
            JOIN classes cl2 ON cc2.class_id = cl2.id
            WHERE ta2.teacher_id = $1
              AND ta2.tenant_id = $2
              AND cc2.course_id = c.id
              ${activeAcademicYearId ? `AND cl2.academic_year_id = $${academicYearParamIndex}` : ''}
          )
          ${classId ? `AND cl.id = $${classParamIndex}` : ''}
          ${courseId ? `AND c.id = $${courseParamIndex}` : ''}
        
        ORDER BY last_name ASC, first_name ASC, course_name ASC
      `, queryParams);

      // Debug: Log raw query results
      fastify.log.info(`📊 [PROGRESS API] Query returned ${progressQuery.rows.length} rows`);
      if (progressQuery.rows.length > 0) {
        fastify.log.info(`📊 [PROGRESS API] Sample row:`, JSON.stringify(progressQuery.rows[0], null, 2));
        
        // Log all students with their raw grades
        progressQuery.rows.forEach((row: any, index: number) => {
          const studentName = `${row.first_name} ${row.last_name}`;
          fastify.log.info(`📊 [PROGRESS API] Row ${index + 1}: ${studentName} (${row.matricule}) - Course: ${row.course_name} - Raw current_grade: ${row.current_grade} - Raw assignments_completed: ${row.assignments_completed}`);
        });
      }

      const progress = progressQuery.rows.map((row: any) => {
        const currentGrade = parseFloat(row.current_grade) || 0;
        const periodGrade = parseFloat(row.period_grade) || 0;
        const previousGrade = parseFloat(row.previous_grade) || 0;
        // Calculate progress based on period grade vs previous period
        // But use currentGrade (all grades) for display
        const progressValue = periodGrade - previousGrade;

        // Debug: log if course_name is missing
        if (!row.course_name) {
          fastify.log.warn(`Missing course_name for student ${row.student_id}, class ${row.class_name}, course_id ${row.course_id}`);
        }

        // Debug: Detailed logging for students with grade issues
        const studentName = `${row.first_name} ${row.last_name}`;
        const studentMatricule = row.matricule;
        
        if (currentGrade === 0) {
          fastify.log.warn(`⚠️ [PROGRESS DEBUG] Student ${studentName} (${studentMatricule}) - currentGrade = 0`);
          fastify.log.warn(`   Student ID: ${row.student_id}`);
          fastify.log.warn(`   Course: ${row.course_name} (${row.course_id})`);
          fastify.log.warn(`   Class: ${row.class_name}`);
          fastify.log.warn(`   Raw current_grade from DB: ${row.current_grade}`);
          fastify.log.warn(`   Raw period_grade from DB: ${row.period_grade}`);
          fastify.log.warn(`   Raw previous_grade from DB: ${row.previous_grade}`);
          
          // Check if student has graded submissions for this course
          fastify.pg.query(`
            SELECT 
              s.id,
              s.final_score,
              s.manual_score,
              s.graded_at,
              a.title as assignment_title,
              a.course_id,
              c.name as course_name
            FROM assignment_submissions s
            JOIN assignments a ON s.assignment_id = a.id
            LEFT JOIN courses c ON a.course_id = c.id
            WHERE s.student_id = $1
              AND s.tenant_id = $2
              AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
              AND a.course_id = $3
            ORDER BY s.graded_at DESC
            LIMIT 5
          `, [row.student_id, request.tenantId, row.course_id])
          .then((submissionsResult: any) => {
            if (submissionsResult.rows.length > 0) {
              fastify.log.warn(`   ✅ Found ${submissionsResult.rows.length} graded submissions for this course:`);
              submissionsResult.rows.forEach((sub: any) => {
                const grade = sub.final_score || sub.manual_score;
                fastify.log.warn(`      - ${sub.assignment_title}: ${grade}/20 (graded: ${sub.graded_at})`);
              });
            } else {
              fastify.log.warn(`   ❌ No graded submissions found for student ${row.student_id} in course ${row.course_id}`);
            }
          })
          .catch((err: any) => {
            fastify.log.error(`   ❌ Error checking submissions: ${err.message}`);
          });
        } else {
          fastify.log.info(`✅ [PROGRESS] ${studentName} (${studentMatricule}) - Course: ${row.course_name} - Grade: ${currentGrade.toFixed(2)}/20`);
        }

        return {
          studentId: row.student_id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          matricule: row.matricule || `STU${row.student_id.substring(0, 8)}`,
          className: row.class_name || 'N/A',
          courseName: row.course_name || row.course_id || 'N/A',
          currentGrade,
          previousGrade,
          progress: progressValue,
          assignmentsCompleted: parseInt(row.assignments_completed, 10) || 0,
          totalAssignments: parseInt(row.total_assignments, 10) || 0,
          lastActivity: row.last_activity ? new Date(row.last_activity).toISOString().split('T')[0] : null
        };
      });

      // Debug: Log final progress data
      fastify.log.info(`📊 Final progress data:`, JSON.stringify(progress.slice(0, 3), null, 2));

      return reply.send({ data: progress });

    } catch (error) {
      fastify.log.error(`Error fetching student progress: ${error}`);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred while fetching student progress'
      });
    }
  });
}

