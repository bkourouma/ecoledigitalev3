import { FastifyInstance } from "fastify";
import { z } from "zod";

// Schema for creating academic calendar event
const CreateAcademicCalendarEventSchema = z.object({
  academicYearId: z.string().uuid("L'ID de l'année académique doit être un UUID valide"),
  name: z.string().min(1, "Le nom de l'événement est requis").max(255, "Le nom est trop long"),
  type: z.enum(['semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone'], {
    errorMap: () => ({ message: "Le type d'événement doit être l'un des suivants: semester_start, semester_end, holiday, break, special_event, academic_milestone" })
  }),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  description: z.string().optional(),
  semester: z.number().int().min(1).max(8).optional(),
});

// Schema for updating academic calendar event
const UpdateAcademicCalendarEventSchema = CreateAcademicCalendarEventSchema.partial();

export async function academicCalendarEventsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/academic-calendar-events - List academic calendar events
  fastify.get("/", {
    schema: {
      tags: ['Academic Calendar'],
      summary: 'List academic calendar events',
      querystring: {
        type: 'object',
        properties: {
          academicYearId: { type: 'string', format: 'uuid' },
          semester: { type: 'number', minimum: 1, maximum: 8 },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          type: { type: 'string', enum: ['semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone'] },
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
                  academicYearId: { type: 'string' },
                  academicYearName: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                  eventDate: { type: 'string' },
                  description: { type: 'string', nullable: true },
                  semester: { type: 'number', nullable: true },
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
        academicYearId?: string;
        semester?: number;
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
        const whereConditions = ['ace.tenant_id = $1'];
        const queryParams: any[] = [request.tenantId];
        let paramIndex = 2;

        if (effectiveAcademicYearId) {
          whereConditions.push(`ace.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (query.semester !== undefined && query.semester !== null) {
          whereConditions.push(`ace.semester = $${paramIndex}`);
          queryParams.push(query.semester);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`ace.event_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`ace.event_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        if (query.type) {
          whereConditions.push(`ace.type = $${paramIndex}`);
          queryParams.push(query.type);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM academic_calendar_events ace
          WHERE ${whereConditions.join(' AND ')}
        `;
        const countResult = await client.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / query.limit);

        // Get events
        const eventsQuery = `
          SELECT 
            ace.id,
            ace.academic_year_id,
            ay.name as academic_year_name,
            ace.name,
            ace.type,
            ace.event_date,
            ace.description,
            ace.semester,
            ace.created_at,
            ace.updated_at
          FROM academic_calendar_events ace
          JOIN academic_years ay ON ace.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ace.event_date ASC, ace.name ASC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(query.limit, offset);
        const eventsResult = await client.query(eventsQuery, queryParams);

        const events = eventsResult.rows.map((row: any) => ({
          id: row.id,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          name: row.name,
          type: row.type,
          eventDate: row.event_date ? row.event_date.toISOString().split('T')[0] : null,
          description: row.description || null,
          semester: row.semester ? parseInt(row.semester, 10) : null,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        }));

        return reply.send({
          success: true,
          data: events,
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
          message: error.message || 'An error occurred while fetching academic calendar events',
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/academic-calendar-events - Create academic calendar event
  fastify.post("/", {
    schema: {
      tags: ['Academic Calendar'],
      summary: 'Create academic calendar event',
      body: {
        type: 'object',
        required: ['academicYearId', 'name', 'type', 'eventDate'],
        properties: {
          academicYearId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          type: { type: 'string', enum: ['semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone'] },
          eventDate: { type: 'string', format: 'date' },
          description: { type: 'string' },
          semester: { type: 'number', minimum: 1, maximum: 8 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                academicYearId: { type: 'string' },
                academicYearName: { type: 'string' },
                name: { type: 'string' },
                type: { type: 'string' },
                eventDate: { type: 'string' },
                description: { type: 'string', nullable: true },
                semester: { type: 'number', nullable: true },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
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

      try {
        const data = CreateAcademicCalendarEventSchema.parse(request.body);

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

          // Verify academic year exists and belongs to tenant
          const academicYearCheck = await client.query(
            'SELECT id, name FROM academic_years WHERE id = $1 AND tenant_id = $2',
            [data.academicYearId, request.tenantId]
          );

          if (academicYearCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              success: false,
              error: "Not Found",
              message: "L'année académique spécifiée n'existe pas ou n'appartient pas à ce tenant",
            });
          }

          // Insert new academic calendar event
          const insertQuery = `
            INSERT INTO academic_calendar_events (
              tenant_id,
              academic_year_id,
              name,
              type,
              event_date,
              description,
              semester
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, academic_year_id, name, type, event_date, description, semester, created_at, updated_at
          `;

          const result = await client.query(insertQuery, [
            request.tenantId,
            data.academicYearId,
            data.name,
            data.type,
            data.eventDate,
            data.description || null,
            data.semester || null,
          ]);

          await client.query('COMMIT');

          const event = result.rows[0];
          const academicYearName = academicYearCheck.rows[0].name;

          return reply.status(201).send({
            success: true,
            data: {
              id: event.id,
              academicYearId: event.academic_year_id,
              academicYearName,
              name: event.name,
              type: event.type,
              eventDate: event.event_date ? event.event_date.toISOString().split('T')[0] : null,
              description: event.description || null,
              semester: event.semester ? parseInt(event.semester, 10) : null,
              createdAt: event.created_at ? event.created_at.toISOString() : null,
              updatedAt: event.updated_at ? event.updated_at.toISOString() : null,
            },
          });
        } catch (error: any) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: "Validation Error",
            message: error.errors.map(e => e.message).join(", "),
          });
        }

        // Check for unique constraint violation
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            error: "Conflict",
            message: "Un événement avec ce nom et cette date existe déjà pour cette année académique",
          });
        }

        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while creating academic calendar event',
        });
      }
    },
  });

  // PUT /api/v1/academic-calendar-events/:id - Update academic calendar event
  fastify.put("/:id", {
    schema: {
      tags: ['Academic Calendar'],
      summary: 'Update academic calendar event',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          type: { type: 'string', enum: ['semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone'] },
          eventDate: { type: 'string', format: 'date' },
          description: { type: 'string' },
          semester: { type: 'number', minimum: 1, maximum: 8 },
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
                id: { type: 'string' },
                academicYearId: { type: 'string' },
                academicYearName: { type: 'string' },
                name: { type: 'string' },
                type: { type: 'string' },
                eventDate: { type: 'string' },
                description: { type: 'string', nullable: true },
                semester: { type: 'number', nullable: true },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
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

      const { id } = request.params as { id: string };

      try {
        const data = UpdateAcademicCalendarEventSchema.parse(request.body);

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

          // Check if event exists and belongs to tenant
          const existingEvent = await client.query(
            `SELECT ace.*, ay.name as academic_year_name
             FROM academic_calendar_events ace
             JOIN academic_years ay ON ace.academic_year_id = ay.id
             WHERE ace.id = $1 AND ace.tenant_id = $2`,
            [id, request.tenantId]
          );

          if (existingEvent.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              success: false,
              error: "Not Found",
              message: "L'événement du calendrier académique spécifié n'existe pas",
            });
          }

          // Build update query dynamically
          const updateFields: string[] = [];
          const updateParams: any[] = [];
          let paramIndex = 1;

          if (data.name !== undefined) {
            updateFields.push(`name = $${paramIndex}`);
            updateParams.push(data.name);
            paramIndex++;
          }

          if (data.type !== undefined) {
            updateFields.push(`type = $${paramIndex}`);
            updateParams.push(data.type);
            paramIndex++;
          }

          if (data.eventDate !== undefined) {
            updateFields.push(`event_date = $${paramIndex}`);
            updateParams.push(data.eventDate);
            paramIndex++;
          }

          if (data.description !== undefined) {
            updateFields.push(`description = $${paramIndex}`);
            updateParams.push(data.description || null);
            paramIndex++;
          }

          if (data.semester !== undefined) {
            updateFields.push(`semester = $${paramIndex}`);
            updateParams.push(data.semester || null);
            paramIndex++;
          }

          if (updateFields.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(400).send({
              success: false,
              error: "Bad Request",
              message: "Aucun champ à mettre à jour",
            });
          }

          // Add updated_at
          updateFields.push(`updated_at = NOW()`);

          // Add WHERE clause params
          updateParams.push(id, request.tenantId);

          const updateQuery = `
            UPDATE academic_calendar_events
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
            RETURNING id, academic_year_id, name, type, event_date, description, semester, created_at, updated_at
          `;

          const result = await client.query(updateQuery, updateParams);

          await client.query('COMMIT');

          const event = result.rows[0];
          const academicYearName = existingEvent.rows[0].academic_year_name;

          return reply.send({
            success: true,
            data: {
              id: event.id,
              academicYearId: event.academic_year_id,
              academicYearName,
              name: event.name,
              type: event.type,
              eventDate: event.event_date ? event.event_date.toISOString().split('T')[0] : null,
              description: event.description || null,
              semester: event.semester ? parseInt(event.semester, 10) : null,
              createdAt: event.created_at ? event.created_at.toISOString() : null,
              updatedAt: event.updated_at ? event.updated_at.toISOString() : null,
            },
          });
        } catch (error: any) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: "Validation Error",
            message: error.errors.map(e => e.message).join(", "),
          });
        }

        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while updating academic calendar event',
        });
      }
    },
  });

  // DELETE /api/v1/academic-calendar-events/:id - Delete academic calendar event
  fastify.delete("/:id", {
    schema: {
      tags: ['Academic Calendar'],
      summary: 'Delete academic calendar event',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
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

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Check if event exists and belongs to tenant
        const existingEvent = await client.query(
          'SELECT id FROM academic_calendar_events WHERE id = $1 AND tenant_id = $2',
          [id, request.tenantId]
        );

        if (existingEvent.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Not Found",
            message: "L'événement du calendrier académique spécifié n'existe pas",
          });
        }

        // Delete event
        await client.query(
          'DELETE FROM academic_calendar_events WHERE id = $1 AND tenant_id = $2',
          [id, request.tenantId]
        );

        return reply.send({
          success: true,
          message: "L'événement du calendrier académique a été supprimé avec succès",
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while deleting academic calendar event',
        });
      } finally {
        client.release();
      }
    },
  });
}

