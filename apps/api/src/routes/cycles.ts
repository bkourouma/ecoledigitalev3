import { FastifyInstance } from "fastify";
import { 
  CycleSchema, 
  CreateCycleSchema, 
  UpdateCycleSchema, 
  CycleQuerySchema,
  CycleStatusSchema 
} from "@ecoledigitale/contracts";

const DEFAULT_CYCLE_DURATION_MONTHS = 12;

function sanitizeCodePart(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildCycleCodeCandidates(name: string): string[] {
  const base = sanitizeCodePart(name).slice(0, 20) || "CYCLE";
  const candidates = [base];
  for (let i = 2; i <= 20; i++) {
    const suffix = `-${i}`;
    candidates.push(`${base.slice(0, 20 - suffix.length)}${suffix}`);
  }
  return candidates;
}

export async function cyclesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/cycles - List cycles
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "active", "archived"] },
          type: { type: "string", enum: ["academic", "professional", "short", "certification"] },
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
                  code: { type: "string" },
                  type: { type: "string" },
                  durationMonths: { type: "number" },
                  description: { type: "string" },
                  certificationLevel: { type: "string" },
                  status: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
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

      const query = CycleQuerySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause
        let whereClause = "WHERE tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.status) {
          whereClause += ` AND status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        if (query.type) {
          whereClause += ` AND type = $${paramIndex}`;
          params.push(query.type);
          paramIndex++;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM cycles ${whereClause}`;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get cycles
        const cyclesQuery = `
          SELECT id, tenant_id, name, code, type, duration_months, 
                 description, certification_level, status, created_at, updated_at
          FROM cycles 
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        const cyclesResult = await client.query(cyclesQuery, [...params, query.limit, offset]);

        const cycles = cyclesResult.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          name: row.name,
          code: row.code,
          type: row.type,
          durationMonths: row.duration_months,
          description: row.description,
          certificationLevel: row.certification_level,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        reply.send({
          data: cycles,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching cycles: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching cycles",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/cycles - Create cycle
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          type: { type: "string", enum: ["academic", "professional", "short", "certification"] },
          durationMonths: { type: "number", minimum: 1 },
          description: { type: "string" },
          certificationLevel: { type: "string", maxLength: 50 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            tenantId: { type: "string" },
            name: { type: "string" },
            code: { type: "string" },
            type: { type: "string" },
            durationMonths: { type: "number" },
            description: { type: "string" },
            certificationLevel: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
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

      const cycleData = CreateCycleSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        let cycleCode = cycleData.code;

        if (cycleCode) {
          const existingQuery = `
            SELECT id FROM cycles 
            WHERE tenant_id = $1 AND code = $2
          `;
          const existingResult = await client.query(existingQuery, [request.tenantId, cycleCode]);

          if (existingResult.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: "A cycle with this code already exists",
            });
          }
        } else {
          const codeCandidates = buildCycleCodeCandidates(cycleData.name);
          for (const candidate of codeCandidates) {
            const existingQuery = `
              SELECT id FROM cycles 
              WHERE tenant_id = $1 AND code = $2
            `;
            const existingResult = await client.query(existingQuery, [request.tenantId, candidate]);
            if (existingResult.rows.length === 0) {
              cycleCode = candidate;
              break;
            }
          }
        }

        if (!cycleCode) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Unable to generate a unique cycle code",
          });
        }

        // Insert new cycle with status (default to 'active' from schema if not provided)
        const status = (cycleData as any).status || 'active';
        const insertQuery = `
          INSERT INTO cycles (tenant_id, name, code, type, duration_months, description, certification_level, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, tenant_id, name, code, type, duration_months, 
                    description, certification_level, status, created_at, updated_at
        `;
        
        const insertResult = await client.query(insertQuery, [
          request.tenantId,
          cycleData.name,
          cycleCode,
          cycleData.type,
          cycleData.durationMonths ?? DEFAULT_CYCLE_DURATION_MONTHS,
          cycleData.description || null,
          cycleData.certificationLevel || null,
          status,
        ]);

        const cycle = insertResult.rows[0];
        
        await client.query('COMMIT');

        const response = {
          id: cycle.id,
          tenantId: cycle.tenant_id,
          name: cycle.name,
          code: cycle.code,
          type: cycle.type,
          durationMonths: cycle.duration_months,
          description: cycle.description,
          certificationLevel: cycle.certification_level,
          status: cycle.status,
          createdAt: cycle.created_at,
          updatedAt: cycle.updated_at,
        };

        reply.status(201).send(response);
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error creating cycle: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while creating the cycle",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/cycles/:id - Get cycle by ID
  fastify.get("/:id", {
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
            id: { type: "string" },
            tenantId: { type: "string" },
            name: { type: "string" },
            code: { type: "string" },
            type: { type: "string" },
            durationMonths: { type: "number" },
            description: { type: "string" },
            certificationLevel: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
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

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        const query = `
          SELECT id, tenant_id, name, code, type, duration_months, 
                 description, certification_level, status, created_at, updated_at
          FROM cycles 
          WHERE id = $1 AND tenant_id = $2
        `;
        
        const result = await client.query(query, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Cycle not found",
          });
        }

        const cycle = result.rows[0];
        
        const response = {
          id: cycle.id,
          tenantId: cycle.tenant_id,
          name: cycle.name,
          code: cycle.code,
          type: cycle.type,
          durationMonths: cycle.duration_months,
          description: cycle.description,
          certificationLevel: cycle.certification_level,
          status: cycle.status,
          createdAt: cycle.created_at,
          updatedAt: cycle.updated_at,
        };

        reply.send(response);
      } catch (error) {
        fastify.log.error(`Error fetching cycle: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching the cycle",
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/cycles/:id - Update cycle
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          type: { type: "string", enum: ["academic", "professional", "short", "certification"] },
          durationMonths: { type: "number", minimum: 1 },
          description: { type: "string" },
          certificationLevel: { type: "string", maxLength: 50 },
          status: { type: "string", enum: ["draft", "active", "archived"] },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            tenantId: { type: "string" },
            name: { type: "string" },
            code: { type: "string" },
            type: { type: "string" },
            durationMonths: { type: "number" },
            description: { type: "string" },
            certificationLevel: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
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

      const { id } = request.params as { id: string };
      const updateData = UpdateCycleSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if cycle exists
        const existsQuery = `
          SELECT id FROM cycles
          WHERE id = $1 AND tenant_id = $2
        `;
        const existsResult = await client.query(existsQuery, [id, request.tenantId]);

        if (existsResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Cycle not found",
          });
        }

        // Check if code conflicts with another cycle (if code is being updated)
        if (updateData.code) {
          const conflictQuery = `
            SELECT id FROM cycles
            WHERE tenant_id = $1 AND code = $2 AND id != $3
          `;
          const conflictResult = await client.query(conflictQuery, [request.tenantId, updateData.code, id]);

          if (conflictResult.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: "A cycle with this code already exists",
            });
          }
        }

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        Object.entries(updateData).forEach(([key, value]) => {
          if (value !== undefined) {
            const dbField = key === 'durationMonths' ? 'duration_months' :
                           key === 'certificationLevel' ? 'certification_level' : key;
            updateFields.push(`${dbField} = $${paramIndex}`);
            updateValues.push(value);
            paramIndex++;
          }
        });

        if (updateFields.length === 0) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        updateFields.push(`updated_at = NOW()`);

        const updateQuery = `
          UPDATE cycles
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, tenant_id, name, code, type, duration_months,
                    description, certification_level, status, created_at, updated_at
        `;

        const updateResult = await client.query(updateQuery, [...updateValues, id, request.tenantId]);
        const cycle = updateResult.rows[0];

        await client.query('COMMIT');

        const response = {
          id: cycle.id,
          tenantId: cycle.tenant_id,
          name: cycle.name,
          code: cycle.code,
          type: cycle.type,
          durationMonths: cycle.duration_months,
          description: cycle.description,
          certificationLevel: cycle.certification_level,
          status: cycle.status,
          createdAt: cycle.created_at,
          updatedAt: cycle.updated_at,
        };

        reply.send(response);
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error updating cycle: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while updating the cycle",
        });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/cycles/:id - Delete cycle
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
          description: "No content"
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        409: {
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

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if cycle exists
        const existsQuery = `
          SELECT id FROM cycles
          WHERE id = $1 AND tenant_id = $2
        `;
        const existsResult = await client.query(existsQuery, [id, request.tenantId]);

        if (existsResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Cycle not found",
          });
        }

        // Check if cycle has associated programmes
        const programmesQuery = `
          SELECT COUNT(*) FROM programmes
          WHERE cycle_id = $1 AND tenant_id = $2
        `;
        const programmesResult = await client.query(programmesQuery, [id, request.tenantId]);
        const programmesCount = parseInt(programmesResult.rows[0].count);

        if (programmesCount > 0) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Cannot delete cycle with associated programmes",
          });
        }

        // Delete cycle
        const deleteQuery = `
          DELETE FROM cycles
          WHERE id = $1 AND tenant_id = $2
        `;
        await client.query(deleteQuery, [id, request.tenantId]);

        await client.query('COMMIT');
        reply.status(204).send();
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error deleting cycle: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while deleting the cycle",
        });
      } finally {
        client.release();
      }
    },
  });
}
