import { FastifyInstance } from "fastify";
import { z } from "zod";

const TeacherCorrectionsQuerySchema = z.object({
  status: z.enum(['all', 'submitted', 'graded', 'in_progress']).optional().default('all'),
  class_id: z.string().uuid().optional(),
  course_id: z.string().uuid().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(50)
});

const SubmissionSchema = z.object({
  id: z.string(),
  assignment: z.object({
    id: z.string(),
    title: z.string(),
    type: z.string()
  }),
  course: z.object({
    id: z.string(),
    name: z.string(),
    code: z.string()
  }),
  class: z.object({
    id: z.string(),
    name: z.string()
  }).nullable(),
  student: z.object({
    id: z.string(),
    number: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    full_name: z.string(),
    email: z.string()
  }),
  file: z.object({
    url: z.string(),
    name: z.string(),
    size_mb: z.number()
  }),
  grade: z.object({
    manual_score: z.number().nullable(),
    final_score: z.number().nullable(),
    feedback: z.string().nullable()
  }),
  status: z.enum(['submitted', 'graded']),
  submitted_at: z.string(),
  graded_at: z.string().nullable(),
  is_late: z.boolean()
});

const TeacherCorrectionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    submissions: z.array(SubmissionSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number()
    })
  })
});

export async function teacherCorrectionsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/teacher/corrections - Get submissions for teacher to correct
  fastify.get('/corrections', {
    schema: {
      description: 'Get all submissions that need to be corrected by the authenticated teacher',
      tags: ['Teacher Corrections'],
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['all', 'submitted', 'graded', 'in_progress'],
            default: 'all'
          },
          class_id: {
            type: 'string',
            format: 'uuid'
          },
          course_id: {
            type: 'string',
            format: 'uuid'
          },
          page: {
            type: 'number',
            minimum: 1,
            default: 1
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 100,
            default: 50
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      // Get user ID from header or authenticated user
      const userIdHeader = request.headers['x-user-id'] as string;
      const userId = userIdHeader || (request as any).user?.id;
      const tenantId = (request as any).tenantId;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      if (!userId) {
        return reply.status(401).send({
          error: 'Authentication Required',
          message: 'User ID is required'
        });
      }

      if (!tenantId) {
        return reply.status(400).send({
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context'
        });
      }

      const query = {
        status: (request.query as any).status || 'all',
        class_id: (request.query as any).class_id,
        course_id: (request.query as any).course_id,
        page: parseInt((request.query as any).page) || 1,
        limit: parseInt((request.query as any).limit) || 50
      };
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();

      try {
        // Get teacher ID from user ID
        fastify.log.info(`Looking for teacher with user_id: ${userId}, tenant_id: ${tenantId}`);
        const teacherQuery = await client.query(
          'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        fastify.log.info(`Teacher query result: ${JSON.stringify(teacherQuery.rows)}`);

        if (teacherQuery.rows.length === 0) {
          return reply.status(404).send({
            error: 'Teacher Not Found',
            message: 'No teacher profile found for this user'
          });
        }

        const teacherId = teacherQuery.rows[0].id;

        // Build query conditions
        let whereConditions = ['s.tenant_id = $1', 'a.teacher_id = $2'];
        let queryParams = [tenantId, teacherId];
        let paramIndex = 3;

        if (query.status !== 'all') {
          if (query.status === 'submitted') {
            whereConditions.push('s.status = $' + paramIndex);
            queryParams.push('submitted');
          } else if (query.status === 'graded') {
            whereConditions.push('s.status = $' + paramIndex);
            queryParams.push('graded');
          } else if (query.status === 'in_progress') {
            whereConditions.push('s.status = $' + paramIndex);
            queryParams.push('in_progress');
          }
          paramIndex++;
        }

        if (query.class_id) {
          whereConditions.push('se.class_id = $' + paramIndex);
          queryParams.push(query.class_id);
          paramIndex++;
        }

        if (query.course_id) {
          whereConditions.push('c.id = $' + paramIndex);
          queryParams.push(query.course_id);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          // Use EXISTS to avoid relying on the outer `cl` alias in dynamic WHERE clauses.
          whereConditions.push(`
            EXISTS (
              SELECT 1
              FROM student_enrollments se_ay
              JOIN classes cl_ay ON cl_ay.id = se_ay.class_id
              WHERE se_ay.student_id = sp.id
                AND se_ay.tenant_id = s.tenant_id
                AND cl_ay.academic_year_id = $${paramIndex}
            )
          `);
          queryParams.push(activeAcademicYearId);
          paramIndex++;
        }

        // Query to get submissions with assignment, course, and student info
        // Join with student_enrollments to get class information from student's enrollment
        const submissionsQuery = `
          SELECT
            s.id as submission_id,
            s.manual_score,
            s.final_score,
            s.feedback,
            s.status,
            s.submitted_at,
            s.graded_at,
            s.is_late,
            s.submitted_file_url,
            s.submitted_file_name,
            s.submitted_file_size_mb,
            a.id as assignment_id,
            a.title as assignment_title,
            a.type as assignment_type,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            cl.id as class_id,
            cl.name as class_name,
            sp.id as student_id,
            sp.student_number,
            u.first_name as student_first_name,
            u.last_name as student_last_name,
            u.email as student_email
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id
          LEFT JOIN classes cl ON se.class_id = cl.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY s.submitted_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(query.limit, offset);

        const submissionsResult = await client.query(submissionsQuery, queryParams);

        // Get total count for pagination
        const countQuery = `
          SELECT COUNT(*) as total
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id
          LEFT JOIN classes cl ON se.class_id = cl.id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await client.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        // Transform results
        const submissions = submissionsResult.rows.map(row => ({
          id: row.submission_id,
          assignment: {
            id: row.assignment_id,
            title: row.assignment_title,
            type: row.assignment_type
          },
          course: {
            id: row.course_id,
            name: row.course_name,
            code: row.course_code
          },
          class: row.class_id ? {
            id: row.class_id,
            name: row.class_name
          } : null,
          student: {
            id: row.student_id,
            number: row.student_number,
            first_name: row.student_first_name,
            last_name: row.student_last_name,
            full_name: `${row.student_first_name} ${row.student_last_name}`,
            email: row.student_email
          },
          file: {
            url: row.submitted_file_url || '',
            name: row.submitted_file_name || '',
            size_mb: row.submitted_file_size_mb || 0
          },
          grade: {
            manual_score: row.manual_score,
            final_score: row.final_score,
            feedback: row.feedback
          },
          status: row.status,
          submitted_at: row.submitted_at,
          graded_at: row.graded_at,
          is_late: row.is_late
        }));

        const response = {
          success: true,
          data: {
            submissions,
            pagination: {
              page: query.page,
              limit: query.limit,
              total,
              totalPages: Math.ceil(total / query.limit)
            }
          }
        };

        reply.send(response);

      } finally {
        client.release();
      }

    } catch (error: any) {
      fastify.log.error('Error fetching teacher corrections:', error);
      reply.status(500).send({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'An error occurred while fetching submissions'
      });
    }
  });

  // GET /api/v1/teacher/classes - Get all classes for the authenticated teacher
  fastify.get('/classes', async (request, reply) => {
    try {
      const userIdHeader = request.headers['x-user-id'] as string;
      const userId = userIdHeader || (request as any).user?.id;
      const tenantId = (request as any).tenantId;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      if (!userId) {
        return reply.status(401).send({
          error: 'Authentication Required',
          message: 'User ID is required'
        });
      }

      if (!tenantId) {
        return reply.status(400).send({
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context'
        });
      }

      const client = await fastify.pg.connect();

      try {
        // Get teacher ID from user ID
        const teacherQuery = await client.query(
          'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        if (teacherQuery.rows.length === 0) {
          return reply.status(404).send({
            error: 'Teacher Not Found',
            message: 'No teacher profile found for this user'
          });
        }

        const teacherId = teacherQuery.rows[0].id;

        // Get all classes where teacher has assignments
        const classesQuery = `
          SELECT DISTINCT
            cl.id,
            cl.name,
            cl.code
          FROM classes cl
          INNER JOIN assignment_instances ai ON cl.id = ai.class_id
          INNER JOIN assignments a ON ai.assignment_id = a.id
          WHERE a.teacher_id = $1 AND a.tenant_id = $2
          ${activeAcademicYearId ? 'AND cl.academic_year_id = $3' : ''}
          ORDER BY cl.name
        `;

        const classesResult = await client.query(
          classesQuery,
          activeAcademicYearId ? [teacherId, tenantId, activeAcademicYearId] : [teacherId, tenantId]
        );

        const classes = classesResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          code: row.code
        }));

        reply.send({
          success: true,
          data: { classes }
        });

      } finally {
        client.release();
      }

    } catch (error: any) {
      fastify.log.error('Error fetching teacher classes:', error);
      reply.status(500).send({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'An error occurred while fetching classes'
      });
    }
  });
}
