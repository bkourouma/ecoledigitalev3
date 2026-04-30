import { FastifyInstance } from "fastify";
import { z } from "zod";

// Temporary inline schema for testing
const CreateAcademicYearSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
});

const UpdateAcademicYearSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long").optional(),
});

const CreateAcademicYearPeriodSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  { message: "La date de fin doit être postérieure à la date de début", path: ["endDate"] }
);

const UpdateAcademicYearPeriodSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) > new Date(data.startDate);
    }
    return true;
  },
  { message: "La date de fin doit être postérieure à la date de début", path: ["endDate"] }
);

export async function academicYearsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/academic-years - List academic years
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          includeStats: { type: "boolean", default: false },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tenantId: { type: "string" },
                  name: { type: "string" },
                  startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                  endDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                  isActive: { type: "boolean" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  classCount: { type: "number" },
                  studentCount: { type: "number" },
                },
              },
            },
            pagination: {
              type: "object",
              properties: {
                page: { type: "number" },
                limit: { type: "number" },
                total: { type: "number" },
                totalPages: { type: "number" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const query = request.query as { includeStats?: boolean; page: number; limit: number };
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        // Get total count
        const countQuery = `
          SELECT COUNT(*) FROM academic_years
          WHERE tenant_id = $1
        `;
        const countResult = await client.query(countQuery, [request.tenantId]);
        const total = parseInt(countResult.rows[0].count);

        // Base query for academic years
        let academicYearsQuery = `
          SELECT ay.id, ay.tenant_id, ay.name, ay.start_date, ay.end_date,
                 ay.is_active, ay.created_at, ay.updated_at
        `;

        // Add stats if requested
        if (query.includeStats) {
          academicYearsQuery += `,
            COALESCE(class_stats.class_count, 0) as class_count,
            COALESCE(enrollment_stats.student_count, 0) as student_count
          `;
        }

        academicYearsQuery += `
          FROM academic_years ay
        `;

        // Add joins for stats if requested
        if (query.includeStats) {
          academicYearsQuery += `
            LEFT JOIN (
              SELECT academic_year_id, COUNT(*) as class_count
              FROM classes
              WHERE tenant_id = $1
              GROUP BY academic_year_id
            ) class_stats ON ay.id = class_stats.academic_year_id
            LEFT JOIN (
              SELECT academic_year_id, COUNT(*) as student_count
              FROM student_enrollments
              WHERE tenant_id = $1 AND status = 'active'
              GROUP BY academic_year_id
            ) enrollment_stats ON ay.id = enrollment_stats.academic_year_id
          `;
        }

        academicYearsQuery += `
          WHERE ay.tenant_id = $1
          ORDER BY ay.is_active DESC, ay.created_at DESC
          LIMIT $2 OFFSET $3
        `;

        const academicYearsResult = await client.query(academicYearsQuery, [
          request.tenantId,
          query.limit,
          offset
        ]);

        const academicYears = academicYearsResult.rows.map(row => {
          const baseData = {
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            startDate: row.start_date,
            endDate: row.end_date,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };

          if (query.includeStats) {
            return {
              ...baseData,
              classCount: parseInt(row.class_count) || 0,
              studentCount: parseInt(row.student_count) || 0,
            };
          }

          return baseData;
        });

        const totalPages = Math.ceil(total / query.limit);

        return reply.send({
          data: academicYears,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching academic years: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch academic years",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/academic-years/active - Get active academic year
  fastify.get("/active", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                name: { type: "string" },
                startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                endDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                isActive: { type: "boolean" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const client = await fastify.pg.connect();
      try {
        const query = `
          SELECT id, tenant_id, name, start_date, end_date, is_active, created_at, updated_at
          FROM academic_years
          WHERE tenant_id = $1 AND is_active = true
        `;

        const result = await client.query(query, [request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "No active academic year found",
          });
        }

        const academicYear = result.rows[0];
        return reply.send({
          data: {
            id: academicYear.id,
            tenantId: academicYear.tenant_id,
            name: academicYear.name,
            startDate: academicYear.start_date,
            endDate: academicYear.end_date,
            isActive: academicYear.is_active,
            createdAt: academicYear.created_at,
            updatedAt: academicYear.updated_at,
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching active academic year: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch active academic year",
        });
      } finally {
        client.release();
      }
    },
  });

  // --- Semestres / trimestres (périodes d'année académique) ---

  async function loadAcademicYearBounds(
    client: any,
    tenantId: string,
    academicYearId: string
  ): Promise<{ start_date: string | null; end_date: string | null } | null> {
    const r = await client.query(
      `SELECT start_date::text, end_date::text FROM academic_years WHERE id = $1 AND tenant_id = $2`,
      [academicYearId, tenantId]
    );
    return r.rows[0] ?? null;
  }

  function assertPeriodWithinYear(
    _ayStart: string | null,
    _ayEnd: string | null,
    _pStart: string,
    _pEnd: string
  ): string | null {
    // Les dates des périodes ne sont plus contraintes par celles de l'année.
    // C'est désormais les périodes (semestres/trimestres) qui définissent les plages.
    return null;
  }

  // GET /api/v1/academic-years/:id/periods
  fastify.get("/:id/periods", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tenantId: { type: "string" },
                  academicYearId: { type: "string" },
                  name: { type: "string" },
                  startDate: { type: "string" },
                  endDate: { type: "string" },
                  sortOrder: { type: "number" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }
      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();
      try {
        const exists = await client.query(
          `SELECT 1 FROM academic_years WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        if (exists.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Academic year not found" });
        }
        const result = await client.query(
          `SELECT id, tenant_id, academic_year_id, name, start_date::text, end_date::text, sort_order, created_at, updated_at
           FROM academic_year_periods
           WHERE academic_year_id = $1 AND tenant_id = $2
           ORDER BY sort_order ASC, start_date ASC`,
          [id, request.tenantId]
        );
        const data = result.rows.map((row: any) => ({
          id: row.id,
          tenantId: row.tenant_id,
          academicYearId: row.academic_year_id,
          name: row.name,
          startDate: row.start_date,
          endDate: row.end_date,
          sortOrder: row.sort_order,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        return reply.send({ data });
      } catch (error) {
        fastify.log.error(`Error fetching academic year periods: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to fetch periods" });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/academic-years/:id/periods
  fastify.post("/:id/periods", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }
      const { id } = request.params as { id: string };
      let data: z.infer<typeof CreateAcademicYearPeriodSchema>;
      try {
        data = CreateAcademicYearPeriodSchema.parse(request.body);
      } catch (err: any) {
        return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid input" });
      }

      const client = await fastify.pg.connect();
      try {
        const bounds = await loadAcademicYearBounds(client, request.tenantId, id);
        if (!bounds) {
          return reply.status(404).send({ error: "Not Found", message: "Academic year not found" });
        }
        const within = assertPeriodWithinYear(bounds.start_date, bounds.end_date, data.startDate, data.endDate);
        if (within) {
          return reply.status(400).send({ error: "Validation Error", message: within });
        }

        const insertQuery = `
          WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
            FROM academic_year_periods
            WHERE academic_year_id = $2 AND tenant_id = $1
          )
          INSERT INTO academic_year_periods (tenant_id, academic_year_id, name, start_date, end_date, sort_order)
          SELECT $1, $2, $3, $4::date, $5::date, next_sort FROM mx
          RETURNING id, tenant_id, academic_year_id, name, start_date::text, end_date::text, sort_order, created_at, updated_at
        `;
        const result = await client.query(insertQuery, [
          request.tenantId,
          id,
          data.name,
          data.startDate,
          data.endDate,
        ]);
        const row = result.rows[0];
        return reply.status(201).send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            name: row.name,
            startDate: row.start_date,
            endDate: row.end_date,
            sortOrder: row.sort_order,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        });
      } catch (error) {
        fastify.log.error(`Error creating academic year period: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to create period" });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/academic-years/:id/periods/:periodId
  fastify.put("/:id/periods/:periodId", {
    schema: {
      params: {
        type: "object",
        required: ["id", "periodId"],
        properties: {
          id: { type: "string", format: "uuid" },
          periodId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
        },
        additionalProperties: false,
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }
      const { id, periodId } = request.params as { id: string; periodId: string };
      let data: z.infer<typeof UpdateAcademicYearPeriodSchema>;
      try {
        data = UpdateAcademicYearPeriodSchema.parse(request.body || {});
      } catch (err: any) {
        return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid input" });
      }
      if (!data || Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "Bad Request", message: "No fields to update" });
      }

      const client = await fastify.pg.connect();
      try {
        const existing = await client.query(
          `SELECT start_date::text, end_date::text FROM academic_year_periods
           WHERE id = $1 AND academic_year_id = $2 AND tenant_id = $3`,
          [periodId, id, request.tenantId]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Period not found" });
        }
        const cur = existing.rows[0];
        const nextStart = data.startDate ?? cur.start_date;
        const nextEnd = data.endDate ?? cur.end_date;
        if (new Date(nextEnd) <= new Date(nextStart)) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "La date de fin doit être postérieure à la date de début",
          });
        }

        const bounds = await loadAcademicYearBounds(client, request.tenantId, id);
        if (!bounds) {
          return reply.status(404).send({ error: "Not Found", message: "Academic year not found" });
        }
        const within = assertPeriodWithinYear(bounds.start_date, bounds.end_date, nextStart, nextEnd);
        if (within) {
          return reply.status(400).send({ error: "Validation Error", message: within });
        }

        const setParts: string[] = [];
        const values: any[] = [];
        let idx = 1;
        if (data.name) {
          setParts.push(`name = $${idx++}`);
          values.push(data.name);
        }
        if (data.startDate) {
          setParts.push(`start_date = $${idx++}`);
          values.push(data.startDate);
        }
        if (data.endDate) {
          setParts.push(`end_date = $${idx++}`);
          values.push(data.endDate);
        }
        setParts.push(`updated_at = NOW()`);

        const updateQuery = `
          UPDATE academic_year_periods
          SET ${setParts.join(", ")}
          WHERE id = $${idx++} AND academic_year_id = $${idx++} AND tenant_id = $${idx}
          RETURNING id, tenant_id, academic_year_id, name, start_date::text, end_date::text, sort_order, created_at, updated_at
        `;
        values.push(periodId, id, request.tenantId);

        const result = await client.query(updateQuery, values);
        const row = result.rows[0];
        return reply.send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            name: row.name,
            startDate: row.start_date,
            endDate: row.end_date,
            sortOrder: row.sort_order,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        });
      } catch (error) {
        fastify.log.error(`Error updating academic year period: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to update period" });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/academic-years/:id/periods/:periodId
  fastify.delete("/:id/periods/:periodId", {
    schema: {
      params: {
        type: "object",
        required: ["id", "periodId"],
        properties: {
          id: { type: "string", format: "uuid" },
          periodId: { type: "string", format: "uuid" },
        },
      },
      response: { 204: { type: "null" } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }
      const { id, periodId } = request.params as { id: string; periodId: string };
      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `DELETE FROM academic_year_periods WHERE id = $1 AND academic_year_id = $2 AND tenant_id = $3`,
          [periodId, id, request.tenantId]
        );
        if (result.rowCount === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Period not found" });
        }
        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(`Error deleting academic year period: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to delete period" });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/academic-years - Create academic year
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                name: { type: "string" },
                startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                endDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                isActive: { type: "boolean" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        fastify.log.info('Creating academic year with body:', request.body);
        const data = CreateAcademicYearSchema.parse(request.body);
        fastify.log.info('Parsed data:', data);

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');

          // Check for name uniqueness within tenant
          const existingQuery = `
            SELECT id FROM academic_years
            WHERE tenant_id = $1 AND name = $2
          `;
          const existingResult = await client.query(existingQuery, [request.tenantId, data.name]);

          if (existingResult.rows.length > 0) {
            await client.query('ROLLBACK');
            return reply.status(409).send({
              error: "Conflict",
              message: "Une année académique avec ce nom existe déjà",
            });
          }

          // Insert new academic year (dates optionnelles, fallback pour compat DB sans migration 0050)
          const body = request.body as any;
          const startDate = body.startDate || null;
          const endDate = body.endDate || null;
          const insertQuery = `
            INSERT INTO academic_years (tenant_id, name, start_date, end_date)
            VALUES ($1, $2, $3, $4)
            RETURNING id, tenant_id, name, start_date, end_date, is_active, created_at, updated_at
          `;

          const result = await client.query(insertQuery, [
            request.tenantId,
            data.name,
            startDate,
            endDate,
          ]);

          await client.query('COMMIT');

          const academicYear = result.rows[0];
          return reply.status(201).send({
            data: {
              id: academicYear.id,
              tenantId: academicYear.tenant_id,
              name: academicYear.name,
              startDate: academicYear.start_date,
              endDate: academicYear.end_date,
              isActive: academicYear.is_active,
              createdAt: academicYear.created_at,
              updatedAt: academicYear.updated_at,
            },
          });
        } catch (dbError) {
          await client.query('ROLLBACK');
          throw dbError;
        } finally {
          client.release();
        }
      } catch (error) {
        if (error.name === 'ZodError') {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Invalid input data",
            details: error.errors,
          });
        }

        fastify.log.error(`Error creating academic year: ${error}`);
        fastify.log.error('Error details:', error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create academic year",
          details: error.message,
        });
      }
    },
  });

  // POST /api/v1/academic-years/:id/set-active - Set academic year as active
  fastify.post("/:id/set-active", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                name: { type: "string" },
                startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                endDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                isActive: { type: "boolean" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if academic year exists and belongs to tenant
        const existingQuery = `
          SELECT id FROM academic_years
          WHERE id = $1 AND tenant_id = $2
        `;
        const existingResult = await client.query(existingQuery, [id, request.tenantId]);

        if (existingResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Academic year not found",
          });
        }

        // Deactivate all other academic years for this tenant
        await client.query(
          `UPDATE academic_years SET is_active = false WHERE tenant_id = $1`,
          [request.tenantId]
        );

        // Activate the specified academic year
        const updateQuery = `
          UPDATE academic_years
          SET is_active = true, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, tenant_id, name, start_date, end_date, is_active, created_at, updated_at
        `;

        const result = await client.query(updateQuery, [id, request.tenantId]);

        await client.query('COMMIT');

        const academicYear = result.rows[0];
        return reply.send({
          data: {
            id: academicYear.id,
            tenantId: academicYear.tenant_id,
            name: academicYear.name,
            startDate: academicYear.start_date,
            endDate: academicYear.end_date,
            isActive: academicYear.is_active,
            createdAt: academicYear.created_at,
            updatedAt: academicYear.updated_at,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error setting active academic year: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to set active academic year",
        });
      } finally {
        client.release();
      }
    },
  });


  // PUT /api/v1/academic-years/:id - Update academic year
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                name: { type: "string" },
                startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                endDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                isActive: { type: "boolean" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };

      let data: any;
      try {
        data = UpdateAcademicYearSchema.parse(request.body || {});
      } catch (err: any) {
        return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid input" });
      }

      if (!data || Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "Bad Request", message: "No fields to update" });
      }

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        const existing = await client.query(
          `SELECT id, name FROM academic_years WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        if (existing.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: "Not Found", message: "Academic year not found" });
        }

        if (data.name) {
          const dup = await client.query(
            `SELECT 1 FROM academic_years WHERE tenant_id = $1 AND name = $2 AND id <> $3`,
            [request.tenantId, data.name, id]
          );
          if (dup.rows.length > 0) {
            await client.query('ROLLBACK');
            return reply.status(409).send({ error: "Conflict", message: "Une année académique avec ce nom existe déjà" });
          }
        }

        const setParts: string[] = [];
        const values: any[] = [];
        let idx = 1;
        if (data.name) { setParts.push(`name = $${idx++}`); values.push(data.name); }
        setParts.push(`updated_at = NOW()`);

        const updateQuery = `
          UPDATE academic_years
          SET ${setParts.join(', ')}
          WHERE id = $${idx++} AND tenant_id = $${idx}
          RETURNING id, tenant_id, name, start_date, end_date, is_active, created_at, updated_at
        `;
        values.push(id, request.tenantId);

        const result = await client.query(updateQuery, values);
        await client.query('COMMIT');

        const ay = result.rows[0];
        return reply.send({
          data: {
            id: ay.id,
            tenantId: ay.tenant_id,
            name: ay.name,
            startDate: ay.start_date,
            endDate: ay.end_date,
            isActive: ay.is_active,
            createdAt: ay.created_at,
            updatedAt: ay.updated_at,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error updating academic year: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to update academic year" });
      } finally {
        client.release();
      }
    },
  });
  // DELETE /api/v1/academic-years/:id - Delete academic year
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        204: {
          type: "null",
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if academic year exists and belongs to tenant
        const existingQuery = `
          SELECT id, is_active FROM academic_years
          WHERE id = $1 AND tenant_id = $2
        `;
        const existingResult = await client.query(existingQuery, [id, request.tenantId]);

        if (existingResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Academic year not found",
          });
        }

        // Check if there are any classes associated with this academic year
        const classesQuery = `
          SELECT COUNT(*) FROM classes
          WHERE academic_year_id = $1 AND tenant_id = $2
        `;
        const classesResult = await client.query(classesQuery, [id, request.tenantId]);
        const classCount = parseInt(classesResult.rows[0].count);

        if (classCount > 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: "Conflict",
            message: "Cannot delete academic year with associated classes",
          });
        }

        // Delete the academic year
        await client.query(
          `DELETE FROM academic_years WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        await client.query('COMMIT');

        return reply.status(204).send();
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error deleting academic year: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to delete academic year",
        });
      } finally {
        client.release();
      }
    },
  });
}

