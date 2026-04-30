import { FastifyInstance } from "fastify";
import { z } from "zod";

// Schema for creating report card
const CreateReportCardSchema = z.object({
  studentId: z.string().uuid("L'ID de l'étudiant doit être un UUID valide"),
  academicYearId: z.string().uuid("L'ID de l'année académique doit être un UUID valide"),
  semester: z.number().int().min(1).max(8, "Le semestre doit être entre 1 et 8"),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  overallGrade: z.number().min(0).max(20, "La note doit être entre 0 et 20"),
  reportUrl: z.string().optional().or(z.literal('')).refine(
    (val) => !val || val === '' || val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: "L'URL du bulletin doit être un chemin relatif (commençant par /) ou une URL complète" }
  ),
  downloadable: z.boolean().optional(),
  viewable: z.boolean().optional(),
});

// Schema for updating report card
const UpdateReportCardSchema = CreateReportCardSchema.partial();

export async function reportCardsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/report-cards - List report cards
  fastify.get("/", {
    schema: {
      tags: ['Report Cards'],
      summary: 'List report cards',
      querystring: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          semester: { type: 'number', minimum: 1, maximum: 8 },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
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
                  studentId: { type: 'string' },
                  studentName: { type: 'string' },
                  academicYearId: { type: 'string' },
                  academicYearName: { type: 'string' },
                  semester: { type: 'number' },
                  reportDate: { type: 'string' },
                  overallGrade: { type: 'number' },
                  reportUrl: { type: 'string', nullable: true },
                  downloadable: { type: 'boolean' },
                  viewable: { type: 'boolean' },
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
        studentId?: string;
        academicYearId?: string;
        semester?: number;
        startDate?: string;
        endDate?: string;
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
        const whereConditions = ['rc.tenant_id = $1'];
        const queryParams: any[] = [request.tenantId];
        let paramIndex = 2;

        if (query.studentId) {
          whereConditions.push(`rc.student_id = $${paramIndex}`);
          queryParams.push(query.studentId);
          paramIndex++;
        }

        if (effectiveAcademicYearId) {
          whereConditions.push(`rc.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (query.semester !== undefined && query.semester !== null) {
          whereConditions.push(`rc.semester = $${paramIndex}`);
          queryParams.push(query.semester);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`rc.report_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`rc.report_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM report_cards rc
          WHERE ${whereConditions.join(' AND ')}
        `;
        const countResult = await client.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / query.limit);

        // Get report cards
        const reportCardsQuery = `
          SELECT 
            rc.id,
            rc.student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            rc.academic_year_id,
            ay.name as academic_year_name,
            rc.semester,
            rc.report_date,
            rc.overall_grade,
            rc.report_url,
            COALESCE(rc.downloadable, true) as downloadable,
            COALESCE(rc.viewable, true) as viewable,
            rc.created_at,
            rc.updated_at
          FROM report_cards rc
          JOIN student_profiles sp ON rc.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN academic_years ay ON rc.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY rc.report_date DESC, rc.semester DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(query.limit, offset);
        const reportCardsResult = await client.query(reportCardsQuery, queryParams);

        const reportCards = reportCardsResult.rows.map((row: any) => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          semester: row.semester ? parseInt(row.semester, 10) : null,
          reportDate: row.report_date ? row.report_date.toISOString().split('T')[0] : null,
          overallGrade: parseFloat(row.overall_grade) || 0,
          reportUrl: row.report_url || null,
          downloadable: row.downloadable !== false,
          viewable: row.viewable !== false,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        }));

        return reply.send({
          success: true,
          data: reportCards,
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
          message: error.message || 'An error occurred while fetching report cards',
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // POST /api/v1/report-cards - Create report card
  fastify.post("/", {
    schema: {
      tags: ['Report Cards'],
      summary: 'Create report card',
      body: {
        type: 'object',
        required: ['studentId', 'academicYearId', 'semester', 'reportDate', 'overallGrade'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          semester: { type: 'number', minimum: 1, maximum: 8 },
          reportDate: { type: 'string', format: 'date' },
          overallGrade: { type: 'number', minimum: 0, maximum: 20 },
          reportUrl: { type: 'string' },
          downloadable: { type: 'boolean' },
          viewable: { type: 'boolean' },
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
      let body;
      try {
        body = CreateReportCardSchema.parse(request.body);
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          fastify.log.error('Validation error:', validationError.errors);
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: validationError.errors.map(e => e.message).join(', '),
            details: validationError.errors,
          });
        }
        throw validationError;
      }

      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        const insertQuery = `
          INSERT INTO report_cards (
            tenant_id, student_id, academic_year_id, semester, report_date, overall_grade, report_url, downloadable, viewable
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, student_id, academic_year_id, semester, report_date, overall_grade, report_url, downloadable, viewable, created_at, updated_at
        `;

        const result = await client.query(insertQuery, [
          request.tenantId,
          body.studentId,
          body.academicYearId,
          body.semester,
          body.reportDate,
          body.overallGrade,
          body.reportUrl || null,
          body.downloadable !== false,
          body.viewable !== false,
        ]);

        const row = result.rows[0];

        // Get student and academic year names
        const studentResult = await client.query(
          'SELECT COALESCE(u.first_name || \' \' || u.last_name, u.name) as name FROM student_profiles sp JOIN users u ON sp.user_id = u.id WHERE sp.id = $1',
          [body.studentId]
        );
        const yearResult = await client.query('SELECT name FROM academic_years WHERE id = $1', [body.academicYearId]);

        return reply.status(201).send({
          success: true,
          data: {
            id: row.id,
            studentId: row.student_id,
            studentName: studentResult.rows[0]?.name || '',
            academicYearId: row.academic_year_id,
            academicYearName: yearResult.rows[0]?.name || '',
            semester: row.semester ? parseInt(row.semester, 10) : null,
            reportDate: row.report_date ? row.report_date.toISOString().split('T')[0] : null,
            overallGrade: parseFloat(row.overall_grade) || 0,
            reportUrl: row.report_url || null,
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error creating report card:', {
          error: error.message,
          stack: error.stack,
          code: error.code,
          body: request.body,
        });
        
        // Handle unique constraint violation
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            error: 'Conflict',
            message: 'Un bulletin avec le même étudiant, année académique et semestre existe déjà pour ce tenant. Veuillez modifier le semestre ou l\'année académique.',
          });
        }

        // Handle foreign key constraint violations
        if (error.code === '23503') {
          return reply.status(400).send({
            success: false,
            error: 'Invalid Reference',
            message: 'L\'étudiant ou l\'année académique spécifié n\'existe pas.',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while creating report card',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // PUT /api/v1/report-cards/:id - Update report card
  fastify.put("/:id", {
    schema: {
      tags: ['Report Cards'],
      summary: 'Update report card',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          semester: { type: 'number', minimum: 1, maximum: 8 },
          reportDate: { type: 'string', format: 'date' },
          overallGrade: { type: 'number', minimum: 0, maximum: 20 },
          reportUrl: { type: 'string' },
          downloadable: { type: 'boolean' },
          viewable: { type: 'boolean' },
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
      let body;
      try {
        body = UpdateReportCardSchema.parse(request.body);
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          fastify.log.error('Validation error:', validationError.errors);
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: validationError.errors.map(e => e.message).join(', '),
            details: validationError.errors,
          });
        }
        throw validationError;
      }
      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (body.studentId !== undefined) {
          updateFields.push(`student_id = $${paramIndex}`);
          updateValues.push(body.studentId);
          paramIndex++;
        }
        if (body.academicYearId !== undefined) {
          updateFields.push(`academic_year_id = $${paramIndex}`);
          updateValues.push(body.academicYearId);
          paramIndex++;
        }
        if (body.semester !== undefined) {
          updateFields.push(`semester = $${paramIndex}`);
          updateValues.push(body.semester);
          paramIndex++;
        }
        if (body.reportDate !== undefined) {
          updateFields.push(`report_date = $${paramIndex}`);
          updateValues.push(body.reportDate);
          paramIndex++;
        }
        if (body.overallGrade !== undefined) {
          updateFields.push(`overall_grade = $${paramIndex}`);
          updateValues.push(body.overallGrade);
          paramIndex++;
        }
        if (body.reportUrl !== undefined) {
          updateFields.push(`report_url = $${paramIndex}`);
          updateValues.push(body.reportUrl || null);
          paramIndex++;
        }
        if (body.downloadable !== undefined) {
          updateFields.push(`downloadable = $${paramIndex}`);
          updateValues.push(body.downloadable);
          paramIndex++;
        }
        if (body.viewable !== undefined) {
          updateFields.push(`viewable = $${paramIndex}`);
          updateValues.push(body.viewable);
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
          UPDATE report_cards
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, student_id, academic_year_id, semester, report_date, overall_grade, report_url, downloadable, viewable, created_at, updated_at
        `;

        const result = await client.query(updateQuery, updateValues);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Report card not found',
          });
        }

        const row = result.rows[0];

        // Get student and academic year names
        const studentResult = await client.query(
          'SELECT COALESCE(u.first_name || \' \' || u.last_name, u.name) as name FROM student_profiles sp JOIN users u ON sp.user_id = u.id WHERE sp.id = $1',
          [row.student_id]
        );
        const yearResult = await client.query('SELECT name FROM academic_years WHERE id = $1', [row.academic_year_id]);

        return reply.send({
          success: true,
          data: {
            id: row.id,
            studentId: row.student_id,
            studentName: studentResult.rows[0]?.name || '',
            academicYearId: row.academic_year_id,
            academicYearName: yearResult.rows[0]?.name || '',
            semester: row.semester ? parseInt(row.semester, 10) : null,
            reportDate: row.report_date ? row.report_date.toISOString().split('T')[0] : null,
            overallGrade: parseFloat(row.overall_grade) || 0,
            reportUrl: row.report_url || null,
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error updating report card:', {
          error: error.message,
          stack: error.stack,
          code: error.code,
          body: request.body,
        });
        
        // Handle foreign key constraint violations
        if (error.code === '23503') {
          return reply.status(400).send({
            success: false,
            error: 'Invalid Reference',
            message: 'L\'étudiant ou l\'année académique spécifié n\'existe pas.',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while updating report card',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // DELETE /api/v1/report-cards/:id - Delete report card
  fastify.delete("/:id", {
    schema: {
      tags: ['Report Cards'],
      summary: 'Delete report card',
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
          DELETE FROM report_cards
          WHERE id = $1 AND tenant_id = $2
          RETURNING id
        `;

        const result = await client.query(deleteQuery, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Report card not found',
          });
        }

        return reply.send({
          success: true,
          message: 'Report card deleted successfully',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while deleting report card',
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });
}

