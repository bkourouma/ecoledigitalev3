import { FastifyInstance } from 'fastify';

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

export async function sessionInstancesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/attendance/session-instances
  fastify.get('/session-instances', {
    schema: {
      tags: ['Session Instances'],
      summary: 'Get session instances for attendance',
      querystring: {
        type: 'object',
        properties: {
          classId: { type: 'string' },
          courseId: { type: 'string' },
          teacherId: { type: 'string' },
          status: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  sessionDate: { type: 'string' },
                  startDatetime: { type: 'string' },
                  endDatetime: { type: 'string' },
                  status: { type: 'string' },
                  attendanceTaken: { type: 'boolean' },
                  courseName: { type: 'string' },
                  courseCode: { type: 'string' },
                  className: { type: 'string' },
                  teacherName: { type: 'string' },
                  classroom: { type: 'string' },
                  durationMinutes: { type: 'number' }
                }
              }
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                limit: { type: 'number' },
                offset: { type: 'number' }
              }
            }
          }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const query = request.query as any;

      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires a tenant",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build the SQL query
        let whereConditions = ['si.tenant_id = $1'];
        const queryParams = [tenantId];
        let paramIndex = 2;

        // Add filters
        if (query.classId) {
          whereConditions.push(`si.class_id = $${paramIndex}`);
          queryParams.push(query.classId);
          paramIndex++;
        }

        if (query.courseId) {
          whereConditions.push(`si.course_id = $${paramIndex}`);
          queryParams.push(query.courseId);
          paramIndex++;
        }

        if (query.teacherId) {
          whereConditions.push(`si.teacher_id = $${paramIndex}`);
          queryParams.push(query.teacherId);
          paramIndex++;
        }

        if (query.status) {
          whereConditions.push(`si.status = $${paramIndex}`);
          queryParams.push(query.status);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`si.session_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`si.session_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        // Count total records - session_instances now has direct class_id and course_id
        const countSql = `
          SELECT COUNT(*) as total
          FROM session_instances si
          LEFT JOIN courses c ON si.course_id = c.id
          LEFT JOIN classes cl ON si.class_id = cl.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await pool.query(countSql, queryParams);
        const total = parseInt(countResult.rows[0].total);

        // Add pagination
        const limit = Math.min(query.limit || 50, 100);
        const offset = query.offset || 0;

        queryParams.push(limit, offset);

        // Main query - session_instances now has direct class_id and course_id (no scheduled_sessions)
        const sql = `
          SELECT
            si.id,
            si.session_date,
            si.start_datetime,
            si.end_datetime,
            si.status,
            si.attendance_taken,
            si.notes,
            si.classroom,
            si.duration_minutes,
            c.name as course_name,
            c.code as course_code,
            cl.name as class_name,
            COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'TBD') as teacher_name,
            t.id as teacher_id,
            si.class_id,
            si.course_id
          FROM session_instances si
          LEFT JOIN courses c ON si.course_id = c.id
          LEFT JOIN classes cl ON si.class_id = cl.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY si.session_date DESC, si.start_datetime DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const result = await pool.query(sql, queryParams);

        return reply.send({
          success: true,
          data: result.rows.map((row: any) => ({
            id: row.id,
            sessionDate: row.session_date,
            startDatetime: row.start_datetime,
            endDatetime: row.end_datetime,
            status: row.status,
            attendanceTaken: row.attendance_taken,
            notes: row.notes,
            classroom: row.classroom,
            durationMinutes: row.duration_minutes,
            courseName: row.course_name,
            courseCode: row.course_code,
            className: row.class_name,
            teacherName: row.teacher_name,
            teacherId: row.teacher_id,
            classId: row.class_id,
            courseId: row.course_id,
            // Format pour compatibilité avec l'interface existante
            sessionTime: row.start_datetime ? new Date(row.start_datetime).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Paris'
            }) : 'N/A'
          })),
          pagination: {
            total,
            limit,
            offset
          }
        });

      } catch (error) {
        console.error('Error fetching session instances:', error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch session instances",
        });
      }
    }
  });

  // GET /api/v1/attendance/session-instances/:id
  fastify.get('/session-instances/:id', {
    schema: {
      tags: ['Session Instances'],
      summary: 'Get a specific session instance',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const { id } = request.params as { id: string };

      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires a tenant",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const sql = `
          SELECT 
            si.id,
            si.session_date,
            si.start_datetime,
            si.end_datetime,
            si.status,
            si.attendance_taken,
            si.notes,
            si.classroom,
            si.duration_minutes,
            c.name as course_name,
            c.code as course_code,
            cl.name as class_name,
            COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'TBD') as teacher_name,
            t.id as teacher_id,
            si.class_id,
            si.course_id,
            -- Récupérer les étudiants de la classe via les inscriptions
            (
              SELECT json_agg(
                json_build_object(
                  'id', sp.id,
                  'name', CONCAT(us.first_name, ' ', us.last_name),
                  'studentNumber', sp.student_number,
                  'email', us.email
                )
              )
              FROM student_enrollments se
              JOIN student_profiles sp ON se.student_id = sp.id
              JOIN users us ON sp.user_id = us.id
              WHERE se.class_id = si.class_id
              AND se.tenant_id = si.tenant_id
              AND se.status = 'active'
            ) as students
          FROM session_instances si
          LEFT JOIN courses c ON si.course_id = c.id
          LEFT JOIN classes cl ON si.class_id = cl.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE si.id = $1 AND si.tenant_id = $2
        `;

        const result = await pool.query(sql, [id, tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Session Instance Not Found",
            message: "The specified session instance does not exist",
          });
        }

        const row = result.rows[0];

        return reply.send({
          success: true,
          data: {
            id: row.id,
            sessionDate: row.session_date,
            startDatetime: row.start_datetime,
            endDatetime: row.end_datetime,
            status: row.status,
            attendanceTaken: row.attendance_taken,
            notes: row.notes,
            classroom: row.classroom,
            durationMinutes: row.duration_minutes,
            courseName: row.course_name,
            courseCode: row.course_code,
            className: row.class_name,
            teacherName: row.teacher_name,
            teacherId: row.teacher_id,
            classId: row.class_id,
            courseId: row.course_id,
            students: row.students || [],
            sessionTime: row.start_datetime ? new Date(row.start_datetime).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Paris'
            }) : 'N/A'
          }
        });

      } catch (error) {
        console.error('Error fetching session instance:', error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch session instance",
        });
      }
    }
  });

  // DELETE /api/v1/attendance/session-instances/:id
  fastify.delete('/session-instances/:id', {
    schema: {
      tags: ['Session Instances'],
      summary: 'Delete a specific session instance',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const { id } = request.params as { id: string };

      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires a tenant",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Delete the session instance
        const result = await pool.query(
          'DELETE FROM session_instances WHERE id = $1 AND tenant_id = $2 RETURNING id',
          [id, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Session Instance Not Found",
            message: "The specified session instance does not exist",
          });
        }

        return reply.send({
          success: true,
          message: "Session instance deleted successfully",
        });

      } catch (error) {
        console.error('Error deleting session instance:', error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to delete session instance",
        });
      }
    }
  });
}
