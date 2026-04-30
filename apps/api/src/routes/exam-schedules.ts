import { FastifyInstance } from "fastify";
import { z } from "zod";

// Schema for creating exam schedule
const CreateExamScheduleSchema = z.object({
  courseId: z.string().uuid("L'ID du cours doit être un UUID valide"),
  academicYearId: z.string().uuid("L'ID de l'année académique doit être un UUID valide"),
  name: z.string().min(1, "Le nom de l'examen est requis").max(255, "Le nom est trop long"),
  type: z.enum(['midterm', 'final', 'quiz', 'assignment', 'other'], {
    errorMap: () => ({ message: "Le type d'examen doit être l'un des suivants: midterm, final, quiz, assignment, other" })
  }),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  examTime: z.string().regex(/^\d{2}:\d{2}$/, "Format d'heure invalide (HH:MM)").optional(),
  duration: z.number().int().min(1).optional(),
  location: z.string().max(255).optional(),
});

// Schema for updating exam schedule
const UpdateExamScheduleSchema = CreateExamScheduleSchema.partial();

export async function examSchedulesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/exam-schedules - List exam schedules
  fastify.get("/", {
    schema: {
      tags: ['Exam Schedules'],
      summary: 'List exam schedules',
      querystring: {
        type: 'object',
        properties: {
          courseId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          type: { type: 'string', enum: ['midterm', 'final', 'quiz', 'assignment', 'other'] },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
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
                  courseId: { type: 'string' },
                  courseName: { type: 'string' },
                  academicYearId: { type: 'string' },
                  academicYearName: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                  examDate: { type: 'string' },
                  examTime: { type: 'string', nullable: true },
                  duration: { type: 'number', nullable: true },
                  location: { type: 'string', nullable: true },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const query = request.query as {
        courseId?: string;
        academicYearId?: string;
        startDate?: string;
        endDate?: string;
        type?: string;
        page: number;
        limit: number;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = query.academicYearId || activeAcademicYearId;

      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Build WHERE conditions
        const whereConditions = ['es.tenant_id = $1'];
        const queryParams: any[] = [request.tenantId];
        let paramIndex = 2;

        if (query.courseId) {
          whereConditions.push(`es.course_id = $${paramIndex}`);
          queryParams.push(query.courseId);
          paramIndex++;
        }

        if (effectiveAcademicYearId) {
          whereConditions.push(`es.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`es.exam_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`es.exam_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        if (query.type) {
          whereConditions.push(`es.type = $${paramIndex}`);
          queryParams.push(query.type);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM exam_schedules es
          WHERE ${whereConditions.join(' AND ')}
        `;
        const countResult = await client.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / query.limit);

        // Get exam schedules
        const examSchedulesQuery = `
          SELECT 
            es.id,
            es.course_id,
            c.name as course_name,
            es.academic_year_id,
            ay.name as academic_year_name,
            es.name,
            es.type,
            es.exam_date,
            es.exam_time,
            es.duration,
            es.location,
            es.created_at,
            es.updated_at
          FROM exam_schedules es
          JOIN courses c ON es.course_id = c.id
          JOIN academic_years ay ON es.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY es.exam_date ASC, es.exam_time ASC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(query.limit, offset);
        const examSchedulesResult = await client.query(examSchedulesQuery, queryParams);

        const examSchedules = examSchedulesResult.rows.map((row: any) => ({
          id: row.id,
          courseId: row.course_id,
          courseName: row.course_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          name: row.name,
          type: row.type,
          examDate: row.exam_date ? row.exam_date.toISOString().split('T')[0] : null,
          examTime: row.exam_time ? row.exam_time.substring(0, 5) : null, // Format as HH:MM
          duration: row.duration ? parseInt(row.duration, 10) : null,
          location: row.location || null,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        }));

        return reply.send({
          success: true,
          data: examSchedules,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while fetching exam schedules',
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/exam-schedules - Create exam schedule
  fastify.post("/", {
    schema: {
      tags: ['Exam Schedules'],
      summary: 'Create exam schedule',
      body: {
        type: 'object',
        required: ['courseId', 'academicYearId', 'name', 'type', 'examDate'],
        properties: {
          courseId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          type: { type: 'string', enum: ['midterm', 'final', 'quiz', 'assignment', 'other'] },
          examDate: { type: 'string', format: 'date' },
          examTime: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          duration: { type: 'number', minimum: 1 },
          location: { type: 'string', maxLength: 255 },
        },
      },
      response: { 201: { type: 'object' } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      // Validate with Zod schema
      const body = CreateExamScheduleSchema.parse(request.body);
      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        const insertQuery = `
          INSERT INTO exam_schedules (
            tenant_id, course_id, academic_year_id, name, type, exam_date, exam_time, duration, location
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, course_id, academic_year_id, name, type, exam_date, exam_time, duration, location, created_at, updated_at
        `;

        const result = await client.query(insertQuery, [
          request.tenantId,
          body.courseId,
          body.academicYearId,
          body.name,
          body.type,
          body.examDate,
          body.examTime || null,
          body.duration || null,
          body.location || null,
        ]);

        const row = result.rows[0];

        // Get course and academic year names
        const courseResult = await client.query('SELECT name FROM courses WHERE id = $1', [body.courseId]);
        const yearResult = await client.query('SELECT name FROM academic_years WHERE id = $1', [body.academicYearId]);

        return reply.status(201).send({
          success: true,
          data: {
            id: row.id,
            courseId: row.course_id,
            courseName: courseResult.rows[0]?.name || '',
            academicYearId: row.academic_year_id,
            academicYearName: yearResult.rows[0]?.name || '',
            name: row.name,
            type: row.type,
            examDate: row.exam_date ? row.exam_date.toISOString().split('T')[0] : null,
            examTime: row.exam_time ? row.exam_time.substring(0, 5) : null,
            duration: row.duration ? parseInt(row.duration, 10) : null,
            location: row.location || null,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        // Handle unique constraint violation
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            error: 'Conflict',
            message: 'Un examen avec le même nom, cours et date existe déjà pour ce tenant. Veuillez modifier le nom, la date ou le cours.',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while creating exam schedule',
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/exam-schedules/:id - Update exam schedule
  fastify.put("/:id", {
    schema: {
      tags: ['Exam Schedules'],
      summary: 'Update exam schedule',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          courseId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          type: { type: 'string', enum: ['midterm', 'final', 'quiz', 'assignment', 'other'] },
          examDate: { type: 'string', format: 'date' },
          examTime: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          duration: { type: 'number', minimum: 1 },
          location: { type: 'string', maxLength: 255 },
        },
      },
      response: { 200: { type: 'object' } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      // Validate with Zod schema
      const body = UpdateExamScheduleSchema.parse(request.body);
      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (body.courseId !== undefined) {
          updateFields.push(`course_id = $${paramIndex}`);
          updateValues.push(body.courseId);
          paramIndex++;
        }
        if (body.academicYearId !== undefined) {
          updateFields.push(`academic_year_id = $${paramIndex}`);
          updateValues.push(body.academicYearId);
          paramIndex++;
        }
        if (body.name !== undefined) {
          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(body.name);
          paramIndex++;
        }
        if (body.type !== undefined) {
          updateFields.push(`type = $${paramIndex}`);
          updateValues.push(body.type);
          paramIndex++;
        }
        if (body.examDate !== undefined) {
          updateFields.push(`exam_date = $${paramIndex}`);
          updateValues.push(body.examDate);
          paramIndex++;
        }
        if (body.examTime !== undefined) {
          updateFields.push(`exam_time = $${paramIndex}`);
          updateValues.push(body.examTime || null);
          paramIndex++;
        }
        if (body.duration !== undefined) {
          updateFields.push(`duration = $${paramIndex}`);
          updateValues.push(body.duration || null);
          paramIndex++;
        }
        if (body.location !== undefined) {
          updateFields.push(`location = $${paramIndex}`);
          updateValues.push(body.location || null);
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'No fields to update',
          });
        }

        updateFields.push(`updated_at = NOW()`);
        // Add WHERE clause parameters
        updateValues.push(id, request.tenantId);

        const updateQuery = `
          UPDATE exam_schedules
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, course_id, academic_year_id, name, type, exam_date, exam_time, duration, location, created_at, updated_at
        `;

        const result = await client.query(updateQuery, updateValues);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Exam schedule not found',
          });
        }

        const row = result.rows[0];

        // Get course and academic year names
        const courseResult = await client.query('SELECT name FROM courses WHERE id = $1', [row.course_id]);
        const yearResult = await client.query('SELECT name FROM academic_years WHERE id = $1', [row.academic_year_id]);

        return reply.send({
          success: true,
          data: {
            id: row.id,
            courseId: row.course_id,
            courseName: courseResult.rows[0]?.name || '',
            academicYearId: row.academic_year_id,
            academicYearName: yearResult.rows[0]?.name || '',
            name: row.name,
            type: row.type,
            examDate: row.exam_date ? row.exam_date.toISOString().split('T')[0] : null,
            examTime: row.exam_time ? row.exam_time.substring(0, 5) : null,
            duration: row.duration ? parseInt(row.duration, 10) : null,
            location: row.location || null,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while updating exam schedule',
        });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/exam-schedules/:id - Delete exam schedule
  fastify.delete("/:id", {
    schema: {
      tags: ['Exam Schedules'],
      summary: 'Delete exam schedule',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: { type: 'object' } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        const deleteQuery = `
          DELETE FROM exam_schedules
          WHERE id = $1 AND tenant_id = $2
          RETURNING id
        `;

        const result = await client.query(deleteQuery, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Exam schedule not found',
          });
        }

        return reply.send({
          success: true,
          message: 'Exam schedule deleted successfully',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while deleting exam schedule',
        });
      } finally {
        client.release();
      }
    },
  });
}

