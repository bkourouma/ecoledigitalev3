import { FastifyInstance } from "fastify";
import { z } from "zod";

/**
 * Filieres — le domaine d'etude ("AUDIT ET CONTROLE DE GESTION"), independant
 * du cycle. Les classes qui la declinent ("MASTER 2 AUDIT ET CONTROLE DE
 * GESTION") vivent dans `programmes` et pointent ici via `filiere_id`.
 */

const CreateFiliereSchema = z.object({
  name: z.string().min(1, "Le nom de la filiere est requis").max(255),
  domaine: z.string().max(255).nullable().optional(),
});

const UpdateFiliereSchema = CreateFiliereSchema.partial();

function getEffectiveTenantId(request: any) {
  return request.user?.tenantId || request.tenantId;
}

async function setClientTenantContext(client: any, tenantId: string, tenantSlug?: string) {
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

  if (tenantSlug) {
    await client.query("SELECT set_config('app.tenant_slug', $1, false)", [tenantSlug]);
  }
}

async function clearClientTenantContext(client: any) {
  try {
    await client.query("RESET app.tenant_id");
  } catch {}

  try {
    await client.query("RESET app.tenant_slug");
  } catch {}
}

function mapFiliereRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    domaine: row.domaine ?? null,
    classCount: row.class_count !== undefined ? Number(row.class_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function filieresRoutes(fastify: FastifyInstance) {
  // GET / — liste des filieres, avec le nombre de classes rattachees.
  fastify.get("/", {
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const tenantId = getEffectiveTenantId(request);
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        const result = await client.query(
          `
            SELECT
              f.id,
              f.tenant_id,
              f.name,
              f.domaine,
              f.created_at,
              f.updated_at,
              COUNT(p.id) AS class_count
            FROM filieres f
            LEFT JOIN programmes p ON p.filiere_id = f.id
            WHERE f.tenant_id = $1
            GROUP BY f.id
            ORDER BY f.name ASC
          `,
          [tenantId]
        );

        reply.send({ data: result.rows.map(mapFiliereRow) });
      } catch (error) {
        fastify.log.error(`Error fetching filieres: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching filieres",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  // GET /:id
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const tenantId = getEffectiveTenantId(request);
      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        const result = await client.query(
          `
            SELECT
              f.id,
              f.tenant_id,
              f.name,
              f.domaine,
              f.created_at,
              f.updated_at,
              COUNT(p.id) AS class_count
            FROM filieres f
            LEFT JOIN programmes p ON p.filiere_id = f.id
            WHERE f.id = $1 AND f.tenant_id = $2
            GROUP BY f.id
          `,
          [id, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Filiere not found",
          });
        }

        reply.send(mapFiliereRow(result.rows[0]));
      } catch (error) {
        fastify.log.error(`Error fetching filiere: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching the filiere",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  // POST /
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          domaine: { type: ["string", "null"], maxLength: 255 },
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

      const tenantId = getEffectiveTenantId(request);
      const data = CreateFiliereSchema.parse(request.body);
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        const existing = await client.query(
          `SELECT id FROM filieres WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)`,
          [tenantId, data.name]
        );

        if (existing.rows.length > 0) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Une filiere portant ce nom existe deja",
          });
        }

        const result = await client.query(
          `
            INSERT INTO filieres (tenant_id, name, domaine)
            VALUES ($1, $2, $3)
            RETURNING id, tenant_id, name, domaine, created_at, updated_at
          `,
          [tenantId, data.name, data.domaine || null]
        );

        reply.status(201).send(mapFiliereRow(result.rows[0]));
      } catch (error) {
        fastify.log.error(`Error creating filiere: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while creating the filiere",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  // PUT /:id
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
          domaine: { type: ["string", "null"], maxLength: 255 },
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

      const tenantId = getEffectiveTenantId(request);
      const { id } = request.params as { id: string };
      const data = UpdateFiliereSchema.parse(request.body);
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        const existing = await client.query(
          `SELECT id FROM filieres WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Filiere not found",
          });
        }

        if (data.name) {
          const conflict = await client.query(
            `SELECT id FROM filieres WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3`,
            [tenantId, data.name, id]
          );

          if (conflict.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: "Une filiere portant ce nom existe deja",
            });
          }
        }

        const fields: string[] = [];
        const values: Array<string | null> = [];
        let paramIndex = 1;

        if (data.name !== undefined) {
          fields.push(`name = $${paramIndex}`);
          values.push(data.name);
          paramIndex++;
        }

        if (data.domaine !== undefined) {
          fields.push(`domaine = $${paramIndex}`);
          values.push(data.domaine || null);
          paramIndex++;
        }

        if (fields.length === 0) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        fields.push("updated_at = NOW()");

        const result = await client.query(
          `
            UPDATE filieres
            SET ${fields.join(", ")}
            WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
            RETURNING id, tenant_id, name, domaine, created_at, updated_at
          `,
          [...values, id, tenantId]
        );

        reply.send(mapFiliereRow(result.rows[0]));
      } catch (error) {
        fastify.log.error(`Error updating filiere: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while updating the filiere",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  // DELETE /:id — refuse tant que des classes y sont rattachees.
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const tenantId = getEffectiveTenantId(request);
      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        const classCount = await client.query(
          `SELECT COUNT(*)::int AS count FROM programmes WHERE filiere_id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );

        if (classCount.rows[0]?.count > 0) {
          return reply.status(409).send({
            error: "Conflict",
            message: `Impossible de supprimer cette filiere : ${classCount.rows[0].count} classe(s) y sont rattachee(s).`,
          });
        }

        const result = await client.query(
          `DELETE FROM filieres WHERE id = $1 AND tenant_id = $2 RETURNING id`,
          [id, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Filiere not found",
          });
        }

        reply.status(204).send();
      } catch (error) {
        fastify.log.error(`Error deleting filiere: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while deleting the filiere",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });
}
