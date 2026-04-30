import { FastifyInstance } from "fastify";
import { CreateAssignmentInstanceSchema } from "@ecoledigitale/contracts";

export async function assignmentInstancesRoutes(fastify: FastifyInstance) {
  // POST /api/v1/assignment-instances - create an instance for a class
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["assignment_id", "class_id", "ends_at"],
        properties: {
          assignment_id: { type: "string", format: "uuid" },
          class_id: { type: "string", format: "uuid" },
          starts_at: { type: "string", format: "date-time" },
          ends_at: { type: "string", format: "date-time" },
          duration_minutes: { type: "number", minimum: 1 },
          max_attempts: { type: "number", minimum: 1 },
          shuffle_questions: { type: "boolean" },
          show_results_mode: { type: "string", enum: ["immediate", "after_end", "after_correction"] },
          late_submission_allowed: { type: "boolean" },
          late_penalty_percent: { type: "number", minimum: 0, maximum: 100 },
          status: { type: "string", enum: ["draft", "published", "archived"] },
        },
      },
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId;
      if (!tenantId) return reply.status(400).send({ error: "Tenant ID is required" });

      const body = request.body as any;
      try {
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get teacher_id from the assignment
        const assignmentResult = await fastify.pg.query(
          'SELECT teacher_id FROM assignments WHERE id = $1 AND tenant_id = $2',
          [body.assignment_id, tenantId]
        );

        if (assignmentResult.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        const teacherId = assignmentResult.rows[0].teacher_id;

        // Verify teacher exists and is accessible with current tenant context
        const teacherResult = await fastify.pg.query(
          'SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2',
          [teacherId, tenantId]
        );

        if (teacherResult.rows.length === 0) {
          fastify.log.warn(`Teacher ${teacherId} not found for tenant ${tenantId}, assignment ${body.assignment_id}`);
          return reply.status(400).send({
            error: "Teacher not found or not accessible",
            details: "The assignment references a teacher that is not available in the current context"
          });
        }

        // Get the active academic year for the tenant
        const academicYearResult = await fastify.pg.query(
          'SELECT id FROM academic_years WHERE tenant_id = $1 AND is_active = true LIMIT 1',
          [tenantId]
        );

        if (academicYearResult.rows.length === 0) {
          return reply.status(400).send({
            error: "No active academic year found",
            details: "An active academic year is required to create assignment instances"
          });
        }

        const academicYearId = academicYearResult.rows[0].id;

        // First, update the assignment status to 'published' when it's assigned to a class
        await fastify.pg.query(
          `UPDATE assignments SET status = 'published', updated_at = NOW() 
           WHERE id = $1 AND tenant_id = $2`,
          [body.assignment_id, tenantId]
        );

        const result = await fastify.pg.query(
          `INSERT INTO assignment_instances (
            tenant_id, assignment_id, class_id, teacher_id, academic_year_id,
            starts_at, ends_at,
            duration_minutes, max_attempts, shuffle_questions, show_results_mode,
            late_submission_allowed, late_penalty_percent, status
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
          ) RETURNING *`,
          [
            tenantId,
            body.assignment_id,
            body.class_id,
            teacherId,
            academicYearId,
            body.starts_at ? new Date(body.starts_at) : null,
            new Date(body.ends_at),
            body.duration_minutes ?? null,
            body.max_attempts ?? null,
            body.shuffle_questions ?? null,
            body.show_results_mode ?? null,
            body.late_submission_allowed ?? null,
            body.late_penalty_percent ?? null,
            'published', // Always set instance status to 'published' when assigned
          ]
        );

        return reply.status(201).send(result.rows[0]);
      } catch (error) {
        fastify.log.error('Create assignment instance error:', error);
        return reply.status(500).send({ error: 'Failed to create assignment instance' });
      }
    }
  });

  // GET /api/v1/assignment-instances - List assignment instances with filters
  fastify.get("/", {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          class_id: { type: 'string', format: 'uuid' },
          assignment_id: { type: 'string', format: 'uuid' },
          academic_year_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['draft', 'active', 'expired'] },
          search: { type: 'string' },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        }
      }
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId;
      if (!tenantId) return reply.status(400).send({ error: "Tenant ID is required" });
      const { class_id, assignment_id, academic_year_id, status, search, page = 1, limit = 20 } = request.query as any;

      const conditions: string[] = ['ai.tenant_id = $1'];
      const values: any[] = [tenantId];
      let idx = 2;

      if (class_id) { conditions.push(`ai.class_id = $${idx++}`); values.push(class_id); }
      if (assignment_id) { conditions.push(`ai.assignment_id = $${idx++}`); values.push(assignment_id); }
      if (academic_year_id) { conditions.push(`ai.academic_year_id = $${idx++}`); values.push(academic_year_id); }

      // Status filter
      if (status) {
        if (status === 'draft') {
          conditions.push(`ai.status = 'draft'`);
        } else if (status === 'active') {
          conditions.push(`ai.status != 'draft' AND ai.ends_at >= NOW() AND (ai.starts_at IS NULL OR ai.starts_at <= NOW())`);
        } else if (status === 'expired') {
          conditions.push(`ai.ends_at < NOW()`);
        }
      }

      // Search filter
      if (search) {
        conditions.push(`(a.title ILIKE $${idx} OR a.description ILIKE $${idx} OR c.name ILIKE $${idx})`);
        values.push(`%${search}%`);
        idx++;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const offset = (page - 1) * limit;

      try {
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Enhanced query with all relations and submission counts
        const list = await fastify.pg.query(
          `SELECT
            ai.*,
            a.title as assignment_title,
            a.description as assignment_description,
            a.type as assignment_type,
            c.name as class_name,
            co.name as course_name,
            co.code as course_code,
            t.first_name || ' ' || t.last_name as teacher_name,
            COUNT(sub.id) as submissions_count,
            COUNT(CASE WHEN sub.status = 'submitted' THEN 1 END) as completed_submissions
          FROM assignment_instances ai
          LEFT JOIN assignments a ON a.id = ai.assignment_id
          LEFT JOIN classes c ON c.id = ai.class_id
          LEFT JOIN courses co ON co.id = a.course_id
          LEFT JOIN teachers t ON t.id = ai.teacher_id
          LEFT JOIN assignment_submissions sub ON sub.assignment_instance_id = ai.id
          ${where}
          GROUP BY ai.id, a.title, a.description, a.type, c.name, co.name, co.code, t.first_name, t.last_name
          ORDER BY ai.created_at DESC
          LIMIT $${idx} OFFSET $${idx+1}`,
          [...values, limit, offset]
        );

        const count = await fastify.pg.query(
          `SELECT COUNT(DISTINCT ai.id) as count FROM assignment_instances ai
           LEFT JOIN assignments a ON a.id = ai.assignment_id
           LEFT JOIN classes c ON c.id = ai.class_id
           ${where}`,
          values
        );

        return reply.send({ data: list.rows, total: Number(count.rows[0].count), page, limit });
      } catch (error) {
        fastify.log.error('List assignment instances error:', error);
        return reply.status(500).send({ error: 'Failed to fetch assignment instances' });
      }
    }
  });

  // GET /api/v1/assignment-instances/classes/:classId/assignments - Get assignments for a class
  fastify.get("/classes/:classId/assignments", {
    schema: {
      params: {
        type: "object",
        properties: {
          classId: { type: "string", format: "uuid" },
        },
        required: ["classId"],
      },
      querystring: {
        type: "object",
        properties: {
          active_only: { type: "boolean", default: true },
          include_expired: { type: "boolean", default: false },
        },
      },
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId;
      if (!tenantId) return reply.status(400).send({ error: "Tenant ID is required" });

      const { classId } = request.params as any;
      const { active_only, include_expired } = request.query as any;

      try {
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        let whereClause = "WHERE ai.class_id = $2 AND ai.tenant_id = $1";
        const params = [tenantId, classId];

        if (active_only && !include_expired) {
          whereClause += " AND (ai.starts_at IS NULL OR ai.starts_at <= NOW()) AND ai.ends_at >= NOW()";
        } else if (!include_expired) {
          whereClause += " AND ai.ends_at >= NOW()";
        }

        const result = await fastify.pg.query(
          `SELECT
            ai.*,
            a.title,
            a.description,
            a.type,
            a.course_id,
            c.name as course_name,
            cl.name as class_name,
            t.first_name as teacher_first_name,
            t.last_name as teacher_last_name
          FROM assignment_instances ai
          JOIN assignments a ON a.id = ai.assignment_id
          JOIN courses c ON c.id = a.course_id
          JOIN classes cl ON cl.id = ai.class_id
          JOIN teachers t ON t.id = ai.teacher_id
          ${whereClause}
          ORDER BY ai.ends_at ASC`,
          params
        );

        return reply.send({
          assignments: result.rows,
          total: result.rows.length,
        });
      } catch (error) {
        fastify.log.error('Get class assignments error:', error);
        return reply.status(500).send({ error: 'Failed to get class assignments' });
      }
    },
  });

  // DELETE /api/v1/assignment-instances/:instanceId - Delete an assignment instance
  fastify.delete("/:instanceId", {
    schema: {
      params: {
        type: "object",
        properties: {
          instanceId: { type: "string", format: "uuid" },
        },
        required: ["instanceId"],
      },
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId;
      if (!tenantId) return reply.status(400).send({ error: "Tenant ID is required" });

      const { instanceId } = request.params as any;

      try {
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const result = await fastify.pg.query(
          'DELETE FROM assignment_instances WHERE id = $1 AND tenant_id = $2 RETURNING *',
          [instanceId, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment instance not found" });
        }

        return reply.send({ message: "Assignment instance deleted successfully" });
      } catch (error) {
        fastify.log.error('Delete assignment instance error:', error);
        return reply.status(500).send({ error: 'Failed to delete assignment instance' });
      }
    },
  });

  // GET /api/v1/assignment-instances/students/:studentId/assignments - Get assignments for a student
  fastify.get("/students/:studentId/assignments", {
    schema: {
      params: {
        type: "object",
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
        required: ["studentId"],
      },
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["available", "expired", "all"] },
          course_id: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId;
      if (!tenantId) return reply.status(400).send({ error: "Tenant ID is required" });

      const { studentId } = request.params as any;
      const { status = 'available', course_id } = request.query as any;

      try {
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // First, check if the student exists and is enrolled in any classes
        const studentCheck = await fastify.pg.query(
          `SELECT se.id, se.student_id, se.class_id
           FROM student_enrollments se
           WHERE se.student_id = $1 AND se.tenant_id = $2`,
          [studentId, tenantId]
        );

        if (studentCheck.rows.length === 0) {
          fastify.log.info(`No enrollments found for student ${studentId}`);
          return reply.send({
            assignments: [],
            total: 0,
          });
        }

        let whereClause = `
          WHERE se.student_id = $2
          AND ai.tenant_id = $1
          AND ai.status = 'published'
        `;
        const params = [tenantId, studentId];
        let paramIndex = 3;

        // Filter by status
        if (status === 'available') {
          whereClause += ` AND (ai.starts_at IS NULL OR ai.starts_at <= NOW()) AND ai.ends_at >= NOW()`;
        } else if (status === 'expired') {
          whereClause += ` AND ai.ends_at < NOW()`;
        }

        // Filter by course
        if (course_id) {
          whereClause += ` AND a.course_id = $${paramIndex}`;
          params.push(course_id);
          paramIndex++;
        }

        const query = `SELECT
            ai.*,
            a.title,
            a.description,
            a.type,
            a.course_id,
            a.duration_minutes as assignment_duration_minutes,
            a.max_attempts as assignment_max_attempts,
            a.shuffle_questions as assignment_shuffle_questions,
            a.show_results_mode as assignment_show_results_mode,
            a.late_submission_allowed as assignment_late_submission_allowed,
            a.late_penalty_percent as assignment_late_penalty_percent,
            c.name as course_name,
            c.code as course_code,
            cl.name as class_name,
            t.first_name as teacher_first_name,
            t.last_name as teacher_last_name,
            -- Default submission status (no submissions table join for now)
            'not_started' as submission_status,
            null as submission_id,
            null as submitted_at,
            null as final_score,
            false as is_late
          FROM assignment_instances ai
          JOIN assignments a ON a.id = ai.assignment_id
          JOIN courses c ON c.id = a.course_id
          JOIN classes cl ON cl.id = ai.class_id
          JOIN teachers t ON t.id = ai.teacher_id
          JOIN student_enrollments se ON se.class_id = ai.class_id
          ${whereClause}
          ORDER BY
            CASE
              WHEN ai.ends_at < NOW() THEN 2
              WHEN ai.starts_at IS NULL OR ai.starts_at <= NOW() THEN 1
              ELSE 3
            END,
            ai.ends_at ASC`;

        const result = await fastify.pg.query(query, params);

        return reply.send({
          assignments: result.rows,
          total: result.rows.length,
        });
      } catch (error) {
        fastify.log.error('Get student assignments error:', error);
        fastify.log.error('Error details:', {
          studentId,
          tenantId,
          status,
          course_id,
          message: error.message,
          stack: error.stack
        });

        // Return empty array instead of error to prevent frontend crashes
        return reply.send({
          assignments: [],
          total: 0,
        });
      }
    },
  });

  // GET /api/v1/assignment-instances/:id - Get a specific assignment instance
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId;
      const userIdHeader = request.headers['x-user-id'] as string;
      const studentIdHeader = request.headers['x-student-id'] as string;
      
      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      const { id: instanceId } = request.params as { id: string };

      try {
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Find the student if not provided in header
        let studentId = studentIdHeader;
        if (!studentId && userIdHeader) {
          const studentQuery = `
            SELECT sp.id as student_id
            FROM student_profiles sp
            WHERE sp.tenant_id = $1 AND sp.user_id = $2
          `;
          const studentResult = await fastify.pg.query(studentQuery, [tenantId, userIdHeader]);
          
          if (studentResult.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: 'Étudiant non trouvé'
            });
          }
          studentId = studentResult.rows[0].student_id;
        }

        // Query the specific assignment instance with student context
        const assignmentQuery = `
          SELECT DISTINCT
            ai.id as instance_id,
            a.id as assignment_id,
            a.title,
            a.description,
            a.type as submission_type,
            a.subject_content,
            a.subject_document_url,
            a.max_file_size_mb,
            a.late_submission_allowed,
            ai.max_attempts,
            100 as max_points,
            a.status as assignment_status,
            ai.starts_at,
            ai.ends_at as due_date,
            ai.status as instance_status,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            t.id as teacher_id,
            u.first_name as teacher_first_name,
            u.last_name as teacher_last_name,
            COALESCE(latest_submission.submitted_at, NULL) as submitted_at,
            COALESCE(latest_submission.final_score, latest_submission.manual_score, NULL) as grade,
            COALESCE(latest_submission.feedback, NULL) as feedback,
            CASE 
              WHEN latest_submission.submitted_at IS NOT NULL AND (latest_submission.final_score IS NOT NULL OR latest_submission.manual_score IS NOT NULL) THEN 'graded'
              WHEN latest_submission.submitted_at IS NOT NULL THEN 'submitted'
              WHEN ai.ends_at < NOW() THEN 'expired'
              ELSE 'pending'
            END as status,
            CASE 
              WHEN ai.ends_at < NOW() + INTERVAL '1 day' THEN 'high'
              WHEN ai.ends_at < NOW() + INTERVAL '3 days' THEN 'medium'
              ELSE 'low'
            END as priority,
            COALESCE(submission_count.count, 0) as submission_count,
            COALESCE(submission_count.max_attempt_number, 0) as max_attempt_number
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          JOIN classes cl ON ai.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN courses c ON a.course_id = c.id
          LEFT JOIN teachers t ON ai.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          LEFT JOIN (
            SELECT 
              assignment_id,
              student_id,
              submitted_at,
              final_score,
              manual_score,
              feedback,
              ROW_NUMBER() OVER (PARTITION BY assignment_id, student_id ORDER BY submitted_at DESC) as rn
            FROM assignment_submissions
            WHERE student_id = $2 AND tenant_id = $3
          ) latest_submission ON a.id = latest_submission.assignment_id AND latest_submission.rn = 1
          LEFT JOIN (
            SELECT 
              assignment_id,
              student_id,
              COUNT(*) as count,
              MAX(attempt_number) as max_attempt_number
            FROM assignment_submissions
            WHERE student_id = $2 AND tenant_id = $3
            GROUP BY assignment_id, student_id
          ) submission_count ON a.id = submission_count.assignment_id
          WHERE ai.id = $1 
            AND se.student_id = $2 
            AND se.tenant_id = $3 
            AND se.status = 'active'
            AND ai.tenant_id = $3
            AND a.tenant_id = $3
            AND a.status = 'published'
        `;
        
        const assignmentResult = await fastify.pg.query(assignmentQuery, [instanceId, studentId, tenantId]);
        
        if (assignmentResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Devoir non trouvé ou accès non autorisé'
          });
        }
        
        const row = assignmentResult.rows[0];
        
        // Transform the data to match the expected format
        const assignment = {
          id: row.instance_id,
          assignment_id: row.assignment_id,
          title: row.title,
          description: row.description || '',
          subject_content: row.subject_content,
          subject_document_url: row.subject_document_url,
          max_file_size_mb: row.max_file_size_mb || 10,
          max_attempts: row.max_attempts || 2,
          course: {
            id: row.course_id,
            name: row.course_name,
            code: row.course_code
          },
          instructor: {
            id: row.teacher_id,
            first_name: row.teacher_first_name,
            last_name: row.teacher_last_name
          },
          due_date: row.due_date,
          submitted_at: row.submitted_at,
          status: row.status,
          priority: row.priority,
          max_points: row.max_points || 100,
          grade: row.grade,
          submission_type: row.submission_type || 'online',
          feedback: row.feedback,
          allow_late_submissions: row.late_submission_allowed || false,
          submission_count: row.submission_count || 0,
          max_attempt_number: row.max_attempt_number || 0,
          can_submit: (row.submission_count || 0) < (row.max_attempts || 2)
        };

        return reply.send({
          success: true,
          data: assignment
        });

      } catch (error) {
        fastify.log.error('Get assignment instance error:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération du devoir'
        });
      }
    },
  });
}
