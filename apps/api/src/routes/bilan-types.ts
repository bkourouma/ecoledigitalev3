import { FastifyInstance } from "fastify";
import { z } from "zod";

const CreateBilanTypeSchema = z.object({
  name: z.string().min(1, "Le libellé est requis").max(255, "Le libellé est trop long"),
  description: z.string().max(2000, "La description est trop longue").optional().nullable(),
});

const UpdateBilanTypeSchema = z.object({
  name: z.string().min(1, "Le libellé est requis").max(255, "Le libellé est trop long").optional(),
  description: z.string().max(2000, "La description est trop longue").optional().nullable(),
});

export async function bilanTypesRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          search: { type: "string" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
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

      const query = request.query as { search?: string; page: number; limit: number };
      const offset = (query.page - 1) * query.limit;
      const client = await fastify.pg.connect();

      try {
        let whereClause = "WHERE tenant_id = $1";
        const params: Array<string | number> = [request.tenantId];

        if (query.search?.trim()) {
          whereClause += " AND (name ILIKE $2 OR COALESCE(description, '') ILIKE $2)";
          params.push(`%${query.search.trim()}%`);
        }

        const countResult = await client.query(
          `SELECT COUNT(*) FROM bilan_types ${whereClause}`,
          params
        );

        const listResult = await client.query(
          `
            SELECT id, tenant_id, name, description, created_at, updated_at
            FROM bilan_types
            ${whereClause}
            ORDER BY created_at DESC, name ASC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
          `,
          [...params, query.limit, offset]
        );

        return reply.send({
          data: listResult.rows.map((row) => ({
            id: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            description: row.description,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
          pagination: {
            page: query.page,
            limit: query.limit,
            total: Number.parseInt(countResult.rows[0].count, 10),
            totalPages: Math.ceil(Number.parseInt(countResult.rows[0].count, 10) / query.limit),
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching bilan types: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch bilan types",
        });
      } finally {
        client.release();
      }
    },
  });

  fastify.post("/", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const data = CreateBilanTypeSchema.parse(request.body);
        const client = await fastify.pg.connect();

        try {
          const result = await client.query(
            `
              INSERT INTO bilan_types (tenant_id, name, description)
              VALUES ($1, $2, $3)
              RETURNING id, tenant_id, name, description, created_at, updated_at
            `,
            [request.tenantId, data.name.trim(), data.description?.trim() || null]
          );

          const row = result.rows[0];
          return reply.status(201).send({
            data: {
              id: row.id,
              tenantId: row.tenant_id,
              name: row.name,
              description: row.description,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          });
        } catch (error: any) {
          if (error?.code === "23505") {
            return reply.status(409).send({
              error: "Conflict",
              message: "Un type de bilan avec ce libellé existe déjà",
            });
          }
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Invalid request data",
            details: error.errors,
          });
        }

        fastify.log.error(`Error creating bilan type: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create bilan type",
        });
      }
    },
  });

  fastify.put("/:id", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const params = request.params as { id: string };

      try {
        const data = UpdateBilanTypeSchema.parse(request.body);

        if (!Object.keys(data).length) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Aucune donnée à mettre à jour",
          });
        }

        const client = await fastify.pg.connect();

        try {
          const fields: string[] = [];
          const values: Array<string | null> = [];

          if (data.name !== undefined) {
            fields.push(`name = $${fields.length + 3}`);
            values.push(data.name.trim());
          }

          if (data.description !== undefined) {
            fields.push(`description = $${fields.length + 3}`);
            values.push(data.description?.trim() || null);
          }

          const result = await client.query(
            `
              UPDATE bilan_types
              SET ${fields.join(", ")}
              WHERE id = $1 AND tenant_id = $2
              RETURNING id, tenant_id, name, description, created_at, updated_at
            `,
            [params.id, request.tenantId, ...values]
          );

          if (result.rows.length === 0) {
            return reply.status(404).send({
              error: "Not Found",
              message: "Type de bilan introuvable",
            });
          }

          const row = result.rows[0];
          return reply.send({
            data: {
              id: row.id,
              tenantId: row.tenant_id,
              name: row.name,
              description: row.description,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          });
        } catch (error: any) {
          if (error?.code === "23505") {
            return reply.status(409).send({
              error: "Conflict",
              message: "Un type de bilan avec ce libellé existe déjà",
            });
          }
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Invalid request data",
            details: error.errors,
          });
        }

        fastify.log.error(`Error updating bilan type: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to update bilan type",
        });
      }
    },
  });

  fastify.delete("/:id", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const params = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        const result = await client.query(
          `
            DELETE FROM bilan_types
            WHERE id = $1 AND tenant_id = $2
            RETURNING id
          `,
          [params.id, request.tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Type de bilan introuvable",
          });
        }

        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(`Error deleting bilan type: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to delete bilan type",
        });
      } finally {
        client.release();
      }
    },
  });
}
