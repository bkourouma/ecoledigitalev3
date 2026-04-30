import { FastifyInstance } from "fastify";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    roles?: string[];
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

// Verify parent-child access control utility
// Checks that authenticated user ID matches parent ID through student_parents relationship
// Returns userId and tenantId if authorized, otherwise sends error response and returns null
async function verifyParentChildAccess(
  pool: any,
  request: AuthenticatedRequest,
  reply: any,
  childId?: string
): Promise<{ userId: string; tenantId: string } | null> {
  const tenantId = request.tenantId;
  const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;

  if (!tenantId) {
    reply.status(400).send({
      success: false,
      error: 'Tenant Required',
      message: 'This endpoint requires tenant context',
    });
    return null;
  }

  if (!userId) {
    reply.status(401).send({
      success: false,
      error: 'Authentication Required',
      message: 'User ID is required',
    });
    return null;
  }

  // Check if user has parent role
  const userRoles = request.user?.roles || [];
  if (!userRoles.includes('parent')) {
    reply.status(403).send({
      success: false,
      error: 'Forbidden',
      message: 'This endpoint requires parent role',
    });
    return null;
  }

  // If childId is provided, verify parent-child relationship
  if (childId) {
    const result = await pool.query(
      `SELECT id FROM student_parents 
       WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
      [userId, childId, tenantId]
    );
    
    if (result.rows.length === 0) {
      reply.status(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Child not linked to parent',
      });
      return null;
    }
  }

  return {
    userId,
    tenantId,
  };
}

export async function parentAcademicRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/academic/enrolled-courses - Get enrolled courses for the authenticated parent's children
  fastify.get('/enrolled-courses', {
    schema: {
      tags: ['Parent Academic'],
      summary: 'Get enrolled courses for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                courses: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      teacherId: { type: 'string', format: 'uuid', nullable: true },
                      teacherName: { type: 'string', nullable: true },
                      scheduleDay: { type: 'number', nullable: true },
                      scheduleTime: { type: 'string', nullable: true },
                      classroom: { type: 'string', nullable: true },
                      deliveryMode: { type: 'string', enum: ['presential', 'remote', 'hybrid', 'elearning'] },
                      courseStatus: { type: 'string', enum: ['draft', 'active', 'inactive'] },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const { childId, courseId, teacherId, academicYearId } = request.query as {
        childId?: string;
        courseId?: string;
        teacherId?: string;
        academicYearId?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'se.tenant_id = $2',
          'se.status = \'active\'',
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Filter by teacher
        if (teacherId) {
          whereConditions.push(`t.id = $${paramIndex}`);
          queryParams.push(teacherId);
          paramIndex++;
        }

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`ay.id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Query enrolled courses
        // Note: schedule_day, schedule_time, classroom, and teacher_id are not in class_courses
        // They may be in session_instances or scheduled_sessions, but for now we'll return NULL
        const enrolledCoursesQuery = `
          SELECT 
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            NULL::uuid as teacher_id,
            NULL::text as teacher_name,
            NULL::integer as schedule_day,
            NULL::text as schedule_time,
            NULL::text as classroom,
            c.delivery_mode,
            c.status as course_status,
            ay.id as academic_year_id,
            ay.name as academic_year_name
          FROM student_enrollments se
          JOIN class_courses cc ON se.class_id = cc.class_id
          JOIN courses c ON cc.course_id = c.id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN academic_years ay ON se.academic_year_id = ay.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY c.name ASC
        `;

        const result = await pool.query(enrolledCoursesQuery, queryParams);

        const courses = result.rows.map((row: any) => ({
          courseId: row.course_id,
          courseName: row.course_name,
          courseCode: row.course_code,
          childId: row.child_id,
          childName: row.child_name,
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          scheduleDay: row.schedule_day,
          scheduleTime: row.schedule_time,
          classroom: row.classroom,
          deliveryMode: row.delivery_mode,
          courseStatus: row.course_status,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
        }));

        return reply.send({
          success: true,
          data: {
            courses,
          },
        });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while fetching enrolled courses',
        });
      }
    },
  });

  // GET /api/v1/parent/academic/course-materials - Get course materials for the authenticated parent's children
  fastify.get('/course-materials', {
    schema: {
      tags: ['Parent Academic'],
      summary: 'Get course materials for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          materialType: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                materials: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      materialId: { type: 'string', format: 'uuid' },
                      materialName: { type: 'string' },
                      materialType: { type: 'string' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      uploadDate: { type: 'string' },
                      fileSize: { type: 'number', nullable: true },
                      fileUrl: { type: 'string', nullable: true },
                      downloadable: { type: 'boolean' },
                      viewable: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const { childId, courseId, materialType, startDate, endDate } = request.query as {
        childId?: string;
        courseId?: string;
        materialType?: string;
        startDate?: string;
        endDate?: string;
      };

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'cm.tenant_id = $2',
          'se.status = \'active\'',
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Filter by material type (based on file_type)
        if (materialType) {
          whereConditions.push(`cm.file_type ILIKE $${paramIndex}`);
          queryParams.push(`%${materialType}%`);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`cm.created_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`cm.created_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Query course materials
        // Join through: course_materials -> courses -> class_courses -> classes -> student_enrollments -> student_profiles -> student_parents
        const materialsQuery = `
          SELECT DISTINCT ON (cm.id)
            cm.id as material_id,
            cm.title as material_name,
            cm.file_type as material_type,
            c.id as course_id,
            c.name as course_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            cm.created_at as upload_date,
            cm.file_size,
            cm.minio_key,
            CASE 
              WHEN cm.minio_key IS NOT NULL THEN CONCAT('/api/v1/files/', cm.minio_key)
              ELSE NULL
            END as file_url,
            CASE 
              WHEN cm.minio_key IS NOT NULL THEN true
              ELSE false
            END as downloadable,
            CASE 
              WHEN cm.file_type ILIKE '%pdf%' OR cm.file_type ILIKE '%image%' OR cm.file_type ILIKE '%video%' THEN true
              ELSE false
            END as viewable
          FROM course_materials cm
          JOIN courses c ON cm.course_id = c.id
          JOIN class_courses cc ON c.id = cc.course_id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY cm.id, cm.created_at DESC
        `;

        const result = await pool.query(materialsQuery, queryParams);

        const materials = result.rows.map((row: any) => ({
          materialId: row.material_id,
          materialName: row.material_name,
          materialType: row.material_type || 'other',
          courseId: row.course_id,
          courseName: row.course_name,
          childId: row.child_id,
          childName: row.child_name,
          uploadDate: row.upload_date ? row.upload_date.toISOString() : null,
          fileSize: row.file_size ? parseInt(row.file_size, 10) : null,
          fileUrl: row.file_url,
          downloadable: row.downloadable || false,
          viewable: row.viewable || false,
        }));

        return reply.send({
          success: true,
          data: {
            materials,
          },
        });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while fetching course materials',
        });
      }
    },
  });

  // GET /api/v1/parent/academic/calendar - Get academic calendar events for the authenticated parent's tenant
  fastify.get('/calendar', {
    schema: {
      tags: ['Parent Academic'],
      summary: 'Get academic calendar events for the authenticated parent\'s tenant',
      querystring: {
        type: 'object',
        properties: {
          academicYearId: { type: 'string', format: 'uuid' },
          semester: { type: 'number' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                events: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      eventId: { type: 'string', format: 'uuid' },
                      eventName: { type: 'string' },
                      eventType: { type: 'string' },
                      eventDate: { type: 'string', format: 'date' },
                      eventDescription: { type: 'string', nullable: true },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                      semester: { type: 'number', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const { academicYearId, semester, startDate, endDate } = request.query as {
        academicYearId?: string;
        semester?: number;
        startDate?: string;
        endDate?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access (no childId needed for calendar events - they're tenant-wide)
      const auth = await verifyParentChildAccess(pool, request, reply);
      if (!auth) {
        return; // Error response already sent
      }

      const { tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'ace.tenant_id = $1',
        ];
        const queryParams: any[] = [tenantId];
        let paramIndex = 2;

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`ace.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Filter by semester
        if (semester !== undefined && semester !== null) {
          whereConditions.push(`ace.semester = $${paramIndex}`);
          queryParams.push(semester);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`ace.event_date >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`ace.event_date <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Query academic calendar events
        // Note: This assumes the academic_calendar_events table exists with columns:
        // id, tenant_id, academic_year_id, name, type, event_date, description, semester
        const calendarQuery = `
          SELECT 
            ace.id as event_id,
            ace.name as event_name,
            ace.type as event_type,
            ace.event_date,
            ace.description as event_description,
            ay.id as academic_year_id,
            ay.name as academic_year_name,
            ace.semester
          FROM academic_calendar_events ace
          JOIN academic_years ay ON ace.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ace.event_date ASC
        `;

        const result = await pool.query(calendarQuery, queryParams);

        const events = result.rows.map((row: any) => ({
          eventId: row.event_id,
          eventName: row.event_name,
          eventType: row.event_type || 'other',
          eventDate: row.event_date ? row.event_date.toISOString().split('T')[0] : null,
          eventDescription: row.event_description || null,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          semester: row.semester ? parseInt(row.semester, 10) : null,
        }));

        return reply.send({
          success: true,
          data: {
            events,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty array instead of error
        const errorMessage = error.message || String(error);
        const errorMessageLower = errorMessage.toLowerCase();
        
        // Check for various forms of "table does not exist" errors (English and French)
        // PostgreSQL error: "la relation « academic_calendar_events » n'existe pas"
        if (
          errorMessageLower.includes('does not exist') ||
          errorMessageLower.includes('n\'existe pas') ||
          (errorMessageLower.includes('relation') && errorMessageLower.includes('academic_calendar_events'))
        ) {
          return reply.send({
            success: true,
            data: {
              events: [],
            },
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: errorMessage || 'An error occurred while fetching academic calendar events',
        });
      }
    },
  });

  // GET /api/v1/parent/academic/exam-schedules - Get exam schedules for the authenticated parent's children
  fastify.get('/exam-schedules', {
    schema: {
      tags: ['Parent Academic'],
      summary: 'Get exam schedules for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          examType: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          academicYearId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                exams: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      examId: { type: 'string', format: 'uuid' },
                      examName: { type: 'string' },
                      examType: { type: 'string' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      examDate: { type: 'string', format: 'date' },
                      examTime: { type: 'string' },
                      duration: { type: 'number', nullable: true },
                      location: { type: 'string', nullable: true },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const { childId, courseId, examType, startDate, endDate, academicYearId } = request.query as {
        childId?: string;
        courseId?: string;
        examType?: string;
        startDate?: string;
        endDate?: string;
        academicYearId?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'es.tenant_id = $2',
          'se.status = \'active\'',
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Filter by exam type
        if (examType) {
          whereConditions.push(`es.type = $${paramIndex}`);
          queryParams.push(examType);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`es.exam_date >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`es.exam_date <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`ay.id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Query exam schedules
        // Note: This assumes the exam_schedules table exists with columns:
        // id, tenant_id, course_id, academic_year_id, name, type, exam_date, exam_time, duration, location
        const examSchedulesQuery = `
          SELECT 
            es.id as exam_id,
            es.name as exam_name,
            es.type as exam_type,
            c.id as course_id,
            c.name as course_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            es.exam_date,
            es.exam_time,
            es.duration,
            es.location,
            ay.id as academic_year_id,
            ay.name as academic_year_name
          FROM exam_schedules es
          JOIN courses c ON es.course_id = c.id
          JOIN class_courses cc ON c.id = cc.course_id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          JOIN academic_years ay ON se.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY es.exam_date ASC, es.exam_time ASC
        `;

        const result = await pool.query(examSchedulesQuery, queryParams);

        const exams = result.rows.map((row: any) => ({
          examId: row.exam_id,
          examName: row.exam_name,
          examType: row.exam_type || 'other',
          courseId: row.course_id,
          courseName: row.course_name,
          childId: row.child_id,
          childName: row.child_name,
          examDate: row.exam_date ? row.exam_date.toISOString().split('T')[0] : null,
          examTime: row.exam_time ? row.exam_time.substring(0, 5) : null, // Format as HH:MM
          duration: row.duration ? parseInt(row.duration, 10) : null,
          location: row.location || null,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
        }));

        return reply.send({
          success: true,
          data: {
            exams,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty array instead of error
        const errorMessage = error.message || String(error);
        const errorMessageLower = errorMessage.toLowerCase();
        
        // Check for various forms of "table does not exist" errors (English and French)
        // PostgreSQL error: "la relation « exam_schedules » n'existe pas"
        if (
          errorMessageLower.includes('does not exist') ||
          errorMessageLower.includes('n\'existe pas') ||
          (errorMessageLower.includes('relation') && errorMessageLower.includes('exam_schedules'))
        ) {
          return reply.send({
            success: true,
            data: {
              exams: [],
            },
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: errorMessage || 'An error occurred while fetching exam schedules',
        });
      }
    },
  });

  // GET /api/v1/parent/academic/academic-year - Get academic year information for the authenticated parent's tenant
  fastify.get('/academic-year', {
    schema: {
      tags: ['Parent Academic'],
      summary: 'Get academic year information for the authenticated parent\'s tenant',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                academicYears: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                      startDate: { type: 'string', format: 'date' },
                      endDate: { type: 'string', format: 'date' },
                      isCurrent: { type: 'boolean' },
                      semesterInfo: { type: 'object' },
                      enrollmentDetails: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            childId: { type: 'string', format: 'uuid' },
                            childName: { type: 'string' },
                            enrollmentDate: { type: 'string', format: 'date' },
                            status: { type: 'string' },
                          },
                        },
                      },
                      academicMilestones: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            date: { type: 'string', format: 'date' },
                            description: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const { childId, academicYearId } = request.query as {
        childId?: string;
        academicYearId?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'ay.tenant_id = $1',
        ];
        const queryParams: any[] = [tenantId];
        let paramIndex = 2;

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`ay.id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Build WHERE clause for parent-child relationship
        let parentChildCondition = '';
        if (childId) {
          parentChildCondition = `AND sp_rel.parent_id = $${paramIndex} AND sp.id = $${paramIndex + 1}`;
          queryParams.push(parentId, childId);
          paramIndex += 2;
        } else {
          parentChildCondition = `AND (sp_rel.parent_id = $${paramIndex} OR sp_rel.parent_id IS NULL)`;
          queryParams.push(parentId);
          paramIndex++;
        }

        // Query academic years with enrollment details
        // Note: semester_info and academic_milestones columns may not exist in academic_years table
        // We'll return empty objects/arrays for these fields if they don't exist
        const academicYearQuery = `
          SELECT 
            ay.id as academic_year_id,
            ay.name as academic_year_name,
            ay.start_date,
            ay.end_date,
            ay.is_active as is_current,
            '{}'::jsonb as semester_info,
            '[]'::jsonb as academic_milestones,
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'childId', sp.id,
                'childName', COALESCE(u.first_name || ' ' || u.last_name, u.name),
                'enrollmentDate', se.enrollment_date,
                'status', se.status
              )
            ) FILTER (WHERE sp.id IS NOT NULL) as enrollment_details
          FROM academic_years ay
          LEFT JOIN student_enrollments se ON ay.id = se.academic_year_id AND se.tenant_id = ay.tenant_id
          LEFT JOIN student_profiles sp ON se.student_id = sp.id
          LEFT JOIN users u ON sp.user_id = u.id
          LEFT JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE ${whereConditions.join(' AND ')}
            ${parentChildCondition}
          GROUP BY ay.id, ay.name, ay.start_date, ay.end_date, ay.is_active
          ORDER BY ay.start_date DESC
        `;

        const result = await pool.query(academicYearQuery, queryParams);

        const academicYears = result.rows.map((row: any) => ({
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
          endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
          isCurrent: row.is_current || false,
          semesterInfo: row.semester_info || {},
          enrollmentDetails: row.enrollment_details || [],
          academicMilestones: row.academic_milestones || [],
        }));

        return reply.send({
          success: true,
          data: {
            academicYears,
          },
        });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while fetching academic year information',
        });
      }
    },
  });
}

