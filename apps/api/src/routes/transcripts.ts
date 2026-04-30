import { FastifyInstance } from "fastify";
import { z } from "zod";

// Schema for creating transcript
const CreateTranscriptSchema = z.object({
  studentId: z.string().uuid("L'ID de l'étudiant doit être un UUID valide"),
  academicYearId: z.string().uuid("L'ID de l'année académique doit être un UUID valide"),
  transcriptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  totalCredits: z.number().int().min(0, "Le nombre de crédits doit être positif"),
  gpa: z.number().min(0).max(20, "La moyenne doit être entre 0 et 20"),
  transcriptUrl: z.string().optional().or(z.literal('')).refine(
    (val) => !val || val === '' || val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: "L'URL du relevé de notes doit être un chemin relatif (commençant par /) ou une URL complète" }
  ),
  downloadable: z.boolean().optional(),
  viewable: z.boolean().optional(),
});

// Schema for updating transcript
const UpdateTranscriptSchema = CreateTranscriptSchema.partial();

export async function transcriptsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/transcripts - List transcripts
  fastify.get("/", {
    schema: {
      tags: ['Transcripts'],
      summary: 'List transcripts',
      querystring: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
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
                  transcriptDate: { type: 'string' },
                  totalCredits: { type: 'number' },
                  gpa: { type: 'number' },
                  transcriptUrl: { type: 'string', nullable: true },
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
        const whereConditions = ['t.tenant_id = $1'];
        const queryParams: any[] = [request.tenantId];
        let paramIndex = 2;

        if (query.studentId) {
          whereConditions.push(`t.student_id = $${paramIndex}`);
          queryParams.push(query.studentId);
          paramIndex++;
        }

        if (effectiveAcademicYearId) {
          whereConditions.push(`t.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`t.transcript_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`t.transcript_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM transcripts t
          WHERE ${whereConditions.join(' AND ')}
        `;
        const countResult = await client.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / query.limit);

        // Get transcripts
        const transcriptsQuery = `
          SELECT 
            t.id,
            t.student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            t.academic_year_id,
            ay.name as academic_year_name,
            t.transcript_date,
            t.total_credits,
            t.gpa,
            t.transcript_url,
            COALESCE(t.downloadable, true) as downloadable,
            COALESCE(t.viewable, true) as viewable,
            t.created_at,
            t.updated_at
          FROM transcripts t
          JOIN student_profiles sp ON t.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN academic_years ay ON t.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY t.transcript_date DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(query.limit, offset);
        const transcriptsResult = await client.query(transcriptsQuery, queryParams);

        const transcripts = transcriptsResult.rows.map((row: any) => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          transcriptDate: row.transcript_date ? row.transcript_date.toISOString().split('T')[0] : null,
          totalCredits: parseInt(row.total_credits) || 0,
          gpa: parseFloat(row.gpa) || 0,
          transcriptUrl: row.transcript_url || null,
          downloadable: row.downloadable !== false,
          viewable: row.viewable !== false,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        }));

        return reply.send({
          success: true,
          data: transcripts,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty array instead of error
        const errorMessage = error.message || String(error);
        const errorMessageLower = errorMessage.toLowerCase();
        
        // Check for various forms of "table does not exist" errors (English and French)
        // PostgreSQL error: "la relation « transcripts » n'existe pas"
        if (
          errorMessageLower.includes('does not exist') ||
          errorMessageLower.includes('n\'existe pas') ||
          (errorMessageLower.includes('relation') && errorMessageLower.includes('transcripts'))
        ) {
          fastify.log.info('transcripts table does not exist, returning empty array');
          return reply.send({
            success: true,
            data: [],
            pagination: {
              page: query.page,
              limit: query.limit,
              total: 0,
              totalPages: 0,
            },
          });
        }

        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while fetching transcripts',
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // POST /api/v1/transcripts - Create transcript
  fastify.post("/", {
    schema: {
      tags: ['Transcripts'],
      summary: 'Create transcript',
      body: {
        type: 'object',
        required: ['studentId', 'academicYearId', 'transcriptDate', 'totalCredits', 'gpa'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          transcriptDate: { type: 'string', format: 'date' },
          totalCredits: { type: 'number', minimum: 0 },
          gpa: { type: 'number', minimum: 0, maximum: 20 },
          transcriptUrl: { type: 'string' },
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
        body = CreateTranscriptSchema.parse(request.body);
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
          INSERT INTO transcripts (
            tenant_id, student_id, academic_year_id, transcript_date, total_credits, gpa, transcript_url, downloadable, viewable
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, student_id, academic_year_id, transcript_date, total_credits, gpa, transcript_url, downloadable, viewable, created_at, updated_at
        `;

        const result = await client.query(insertQuery, [
          request.tenantId,
          body.studentId,
          body.academicYearId,
          body.transcriptDate,
          body.totalCredits,
          body.gpa,
          body.transcriptUrl || null,
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
            transcriptDate: row.transcript_date ? row.transcript_date.toISOString().split('T')[0] : null,
            totalCredits: parseInt(row.total_credits) || 0,
            gpa: parseFloat(row.gpa) || 0,
            transcriptUrl: row.transcript_url || null,
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error creating transcript:', {
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
            message: 'Un relevé de notes avec le même étudiant et année académique existe déjà pour ce tenant. Veuillez modifier l\'année académique.',
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
          message: error.message || 'An error occurred while creating transcript',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // PUT /api/v1/transcripts/:id - Update transcript
  fastify.put("/:id", {
    schema: {
      tags: ['Transcripts'],
      summary: 'Update transcript',
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
          transcriptDate: { type: 'string', format: 'date' },
          totalCredits: { type: 'number', minimum: 0 },
          gpa: { type: 'number', minimum: 0, maximum: 20 },
          transcriptUrl: { type: 'string' },
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
        body = UpdateTranscriptSchema.parse(request.body);
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
        if (body.transcriptDate !== undefined) {
          updateFields.push(`transcript_date = $${paramIndex}`);
          updateValues.push(body.transcriptDate);
          paramIndex++;
        }
        if (body.totalCredits !== undefined) {
          updateFields.push(`total_credits = $${paramIndex}`);
          updateValues.push(body.totalCredits);
          paramIndex++;
        }
        if (body.gpa !== undefined) {
          updateFields.push(`gpa = $${paramIndex}`);
          updateValues.push(body.gpa);
          paramIndex++;
        }
        if (body.transcriptUrl !== undefined) {
          updateFields.push(`transcript_url = $${paramIndex}`);
          updateValues.push(body.transcriptUrl || null);
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
        updateValues.push(request.tenantId, id);

        const updateQuery = `
          UPDATE transcripts
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex - 1}
          RETURNING id, student_id, academic_year_id, transcript_date, total_credits, gpa, transcript_url, downloadable, viewable, created_at, updated_at
        `;

        const result = await client.query(updateQuery, updateValues);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Transcript not found',
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
            transcriptDate: row.transcript_date ? row.transcript_date.toISOString().split('T')[0] : null,
            totalCredits: parseInt(row.total_credits) || 0,
            gpa: parseFloat(row.gpa) || 0,
            transcriptUrl: row.transcript_url || null,
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error updating transcript:', {
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
          message: error.message || 'An error occurred while updating transcript',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // DELETE /api/v1/transcripts/:id - Delete transcript
  fastify.delete("/:id", {
    schema: {
      tags: ['Transcripts'],
      summary: 'Delete transcript',
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
          DELETE FROM transcripts
          WHERE id = $1 AND tenant_id = $2
          RETURNING id
        `;

        const result = await client.query(deleteQuery, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Transcript not found',
          });
        }

        return reply.send({
          success: true,
          message: 'Transcript deleted successfully',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while deleting transcript',
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });
}

