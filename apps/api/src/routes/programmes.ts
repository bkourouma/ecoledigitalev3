import { FastifyInstance } from "fastify";
import {
  ApproveProgrammeSchema,
  CreateProgrammeSchema,
  ProgrammeQuerySchema,
  UpdateProgrammeSchema,
} from "@ecoledigitale/contracts";

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

function mapProgrammeRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    cycleId: row.programme_cycle_id,
    name: row.name,
    code: row.code,
    version: row.version,
    description: row.description,
    domaine: row.domaine ?? null,
    filiereId: row.filiere_id ?? null,
    filiere: row.filiere_id
      ? {
          id: row.filiere_id,
          name: row.filiere_name ?? null,
          domaine: row.filiere_domaine ?? null,
        }
      : null,
    objectives: row.objectives || [],
    ectsCredits: row.ects_credits,
    academicYear: row.academic_year,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cycle: {
      id: row.cycle_id,
      name: row.cycle_name,
      code: row.cycle_code,
      type: row.cycle_type,
    },
  };
}

async function ensureCycleExists(client: any, cycleId: string, tenantId: string) {
  const cycleResult = await client.query(
    `
      SELECT id
      FROM cycles
      WHERE id = $1 AND tenant_id = $2
    `,
    [cycleId, tenantId]
  );

  return cycleResult.rows.length > 0;
}

async function ensureFiliereExists(client: any, filiereId: string, tenantId: string) {
  const filiereResult = await client.query(
    `
      SELECT id
      FROM filieres
      WHERE id = $1 AND tenant_id = $2
    `,
    [filiereId, tenantId]
  );

  return filiereResult.rows.length > 0;
}

export async function programmesRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          cycleId: { type: "string", format: "uuid" },
          filiereId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["draft", "review", "approved", "active", "archived"] },
          academicYear: { type: "string", pattern: "^\\d{4}-\\d{4}$" },
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

      const tenantId = getEffectiveTenantId(request);

      const query = ProgrammeQuerySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        let whereClause = "WHERE p.tenant_id = $1";
        const params: Array<string | number> = [tenantId];
        let paramIndex = 2;

        if (query.cycleId) {
          whereClause += ` AND p.cycle_id = $${paramIndex}`;
          params.push(query.cycleId);
          paramIndex++;
        }

        // Filtre par filiere : absent du contrat partage, lu directement.
        const filiereIdFilter = (request.query as Record<string, unknown>)?.filiereId;
        if (typeof filiereIdFilter === "string" && filiereIdFilter) {
          whereClause += ` AND p.filiere_id = $${paramIndex}`;
          params.push(filiereIdFilter);
          paramIndex++;
        }
        if (query.status) {
          whereClause += ` AND p.status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        if (query.academicYear) {
          whereClause += ` AND p.academic_year = $${paramIndex}`;
          params.push(query.academicYear);
          paramIndex++;
        }

        const countResult = await client.query(
          `
            SELECT COUNT(*)
            FROM programmes p
            JOIN cycles c ON p.cycle_id = c.id
            ${whereClause}
          `,
          params
        );

        const programmesResult = await client.query(
          `
            SELECT
              p.id,
              p.tenant_id,
              p.cycle_id AS programme_cycle_id,
              p.name,
              p.code,
              p.version,
              p.description,
              p.domaine,
              p.objectives,
              p.ects_credits,
              p.academic_year,
              p.status,
              p.approved_by,
              p.approved_at,
              p.created_at,
              p.updated_at,
              p.filiere_id,
              c.id AS cycle_id,
              c.name AS cycle_name,
              c.code AS cycle_code,
              c.type AS cycle_type,
              f.name AS filiere_name,
              f.domaine AS filiere_domaine
            FROM programmes p
            JOIN cycles c ON p.cycle_id = c.id
            LEFT JOIN filieres f ON f.id = p.filiere_id AND f.tenant_id = p.tenant_id
            ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
          `,
          [...params, query.limit, offset]
        );

        const total = parseInt(countResult.rows[0].count, 10);

        reply.send({
          data: programmesResult.rows.map(mapProgrammeRow),
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching programmes: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching programmes",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["cycleId", "name", "code"],
        properties: {
          cycleId: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          version: { type: "string", maxLength: 10 },
          description: { type: "string" },
          domaine: { type: "string", maxLength: 255 },
          filiereId: { type: "string", format: "uuid" },
          objectives: { type: "array", items: { type: "string" } },
          ectsCredits: { type: "number", minimum: 0 },
          academicYear: { type: "string", pattern: "^\\d{4}-\\d{4}$" },
          status: { type: "string", enum: ["draft", "review", "approved", "active", "archived"] },
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

      const rawProgrammeData = request.body as Record<string, unknown>;
      const programmeData = {
        ...CreateProgrammeSchema.parse(rawProgrammeData),
        cycleId: String(rawProgrammeData.cycleId),
      };
      // `filiereId` n'est pas encore porte par le contrat partage : on le lit
      // directement dans le corps de la requete.
      const filiereId =
        typeof rawProgrammeData.filiereId === "string" && rawProgrammeData.filiereId
          ? rawProgrammeData.filiereId
          : null;
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const cycleExists = await ensureCycleExists(client, programmeData.cycleId, tenantId);
        if (!cycleExists) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Cycle not found",
          });
        }

        if (filiereId && !(await ensureFiliereExists(client, filiereId, tenantId))) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Filiere not found",
          });
        }

        const existingResult = await client.query(
          `
            SELECT id
            FROM programmes
            WHERE tenant_id = $1 AND code = $2 AND version = $3
          `,
          [tenantId, programmeData.code, programmeData.version || "1.0"]
        );

        if (existingResult.rows.length > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "Conflict",
            message: "A programme with this code and version already exists",
          });
        }

        const insertResult = await client.query(
          `
            INSERT INTO programmes (
              tenant_id,
              cycle_id,
              name,
              code,
              version,
              description,
              domaine,
              filiere_id,
              objectives,
              ects_credits,
              academic_year,
              status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING
              id,
              tenant_id,
              cycle_id AS programme_cycle_id,
              name,
              code,
              version,
              description,
              domaine,
              filiere_id,
              objectives,
              ects_credits,
              academic_year,
              status,
              approved_by,
              approved_at,
              created_at,
              updated_at
          `,
          [
            tenantId,
            programmeData.cycleId,
            programmeData.name,
            programmeData.code,
            programmeData.version || "1.0",
            programmeData.description || null,
            programmeData.domaine || null,
            filiereId,
            programmeData.objectives || [],
            programmeData.ectsCredits || null,
            programmeData.academicYear || null,
            programmeData.status || "active",
          ]
        );
        const programme = insertResult.rows[0];
        const detailsResult = await client.query(
          `
            SELECT
              c.id AS cycle_id,
              c.name AS cycle_name,
              c.code AS cycle_code,
              c.type AS cycle_type,
              f.name AS filiere_name,
              f.domaine AS filiere_domaine
            FROM cycles c
            LEFT JOIN filieres f ON f.id = $2
            WHERE c.id = $1
          `,
          [programme.programme_cycle_id, programme.filiere_id ?? null]
        );

        await client.query("COMMIT");

        reply.status(201).send(
          mapProgrammeRow({
            ...programme,
            ...detailsResult.rows[0],
          })
        );
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error creating programme: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while creating the programme",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
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
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        const result = await client.query(
          `
            SELECT
              p.id,
              p.tenant_id,
              p.cycle_id AS programme_cycle_id,
              p.name,
              p.code,
              p.version,
              p.description,
              p.domaine,
              p.objectives,
              p.ects_credits,
              p.academic_year,
              p.status,
              p.approved_by,
              p.approved_at,
              p.created_at,
              p.updated_at,
              p.filiere_id,
              c.id AS cycle_id,
              c.name AS cycle_name,
              c.code AS cycle_code,
              c.type AS cycle_type,
              f.name AS filiere_name,
              f.domaine AS filiere_domaine
            FROM programmes p
            JOIN cycles c ON p.cycle_id = c.id
            LEFT JOIN filieres f ON f.id = p.filiere_id AND f.tenant_id = p.tenant_id
            WHERE p.id = $1 AND p.tenant_id = $2
          `,
          [id, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Programme not found",
          });
        }

        reply.send(mapProgrammeRow(result.rows[0]));
      } catch (error) {
        fastify.log.error(`Error fetching programme: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching the programme",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

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
          cycleId: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          version: { type: "string", maxLength: 10 },
          description: { type: "string" },
          domaine: { type: "string", maxLength: 255 },
          filiereId: { type: "string", format: "uuid" },
          objectives: { type: "array", items: { type: "string" } },
          ectsCredits: { type: "number", minimum: 0 },
          academicYear: { type: "string", pattern: "^\\d{4}-\\d{4}$" },
          status: { type: "string", enum: ["draft", "review", "approved", "active", "archived"] },
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
      const rawUpdateData = request.body as Record<string, unknown>;
      const parsedUpdateData = UpdateProgrammeSchema.parse(rawUpdateData);
      const updateData = {
        ...parsedUpdateData,
        cycleId:
          rawUpdateData.cycleId !== undefined ? String(rawUpdateData.cycleId) : parsedUpdateData.cycleId,
      };
      const filiereIdUpdate =
        rawUpdateData.filiereId === undefined
          ? undefined
          : typeof rawUpdateData.filiereId === "string" && rawUpdateData.filiereId
          ? rawUpdateData.filiereId
          : null;
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const existingResult = await client.query(
          `
            SELECT id, code, version
            FROM programmes
            WHERE id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        if (existingResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Programme not found",
          });
        }

        const existingProgramme = existingResult.rows[0];

        if (updateData.cycleId) {
          const cycleExists = await ensureCycleExists(client, updateData.cycleId, tenantId);
          if (!cycleExists) {
            await client.query("ROLLBACK");
            return reply.status(404).send({
              error: "Not Found",
              message: "Cycle not found",
            });
          }
        }

        if (filiereIdUpdate && !(await ensureFiliereExists(client, filiereIdUpdate, tenantId))) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Filiere not found",
          });
        }

        if (updateData.code || updateData.version) {
          const conflictResult = await client.query(
            `
              SELECT id
              FROM programmes
              WHERE tenant_id = $1 AND code = $2 AND version = $3 AND id != $4
            `,
            [
              tenantId,
              updateData.code || existingProgramme.code,
              updateData.version || existingProgramme.version,
              id,
            ]
          );

          if (conflictResult.rows.length > 0) {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              error: "Conflict",
              message: "A programme with this code and version already exists",
            });
          }
        }

        const updateFields: string[] = [];
        const updateValues: Array<string | string[] | number | null> = [];
        let paramIndex = 1;

        if (updateData.cycleId !== undefined) {
          updateFields.push(`cycle_id = $${paramIndex}`);
          updateValues.push(updateData.cycleId);
          paramIndex++;
        }

        if (updateData.name !== undefined) {
          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(updateData.name);
          paramIndex++;
        }

        if (updateData.code !== undefined) {
          updateFields.push(`code = $${paramIndex}`);
          updateValues.push(updateData.code);
          paramIndex++;
        }

        if (updateData.version !== undefined) {
          updateFields.push(`version = $${paramIndex}`);
          updateValues.push(updateData.version);
          paramIndex++;
        }

        if (updateData.description !== undefined) {
          updateFields.push(`description = $${paramIndex}`);
          updateValues.push(updateData.description);
          paramIndex++;
        }

        if (updateData.domaine !== undefined) {
          updateFields.push(`domaine = $${paramIndex}`);
          updateValues.push(updateData.domaine || null);
          paramIndex++;
        }

        if (filiereIdUpdate !== undefined) {
          updateFields.push(`filiere_id = $${paramIndex}`);
          updateValues.push(filiereIdUpdate);
          paramIndex++;
        }

        if (updateData.objectives !== undefined) {
          updateFields.push(`objectives = $${paramIndex}`);
          updateValues.push(updateData.objectives);
          paramIndex++;
        }

        if (updateData.ectsCredits !== undefined) {
          updateFields.push(`ects_credits = $${paramIndex}`);
          updateValues.push(updateData.ectsCredits);
          paramIndex++;
        }

        if (updateData.academicYear !== undefined) {
          updateFields.push(`academic_year = $${paramIndex}`);
          updateValues.push(updateData.academicYear);
          paramIndex++;
        }

        if (updateData.status !== undefined) {
          updateFields.push(`status = $${paramIndex}`);
          updateValues.push(updateData.status);
          paramIndex++;
        }

        updateFields.push("updated_at = NOW()");

        if (updateFields.length === 1) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        const updateResult = await client.query(
          `
            UPDATE programmes
            SET ${updateFields.join(", ")}
            WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
            RETURNING
              id,
              tenant_id,
              cycle_id AS programme_cycle_id,
              name,
              code,
              version,
              description,
              domaine,
              filiere_id,
              objectives,
              ects_credits,
              academic_year,
              status,
              approved_by,
              approved_at,
              created_at,
              updated_at
          `,
          [...updateValues, id, tenantId]
        );

        const programme = updateResult.rows[0];
        const detailsResult = await client.query(
          `
            SELECT
              c.id AS cycle_id,
              c.name AS cycle_name,
              c.code AS cycle_code,
              c.type AS cycle_type,
              f.name AS filiere_name,
              f.domaine AS filiere_domaine
            FROM cycles c
            LEFT JOIN filieres f ON f.id = $2
            WHERE c.id = $1
          `,
          [programme.programme_cycle_id, programme.filiere_id ?? null]
        );

        await client.query("COMMIT");
        reply.send(
          mapProgrammeRow({
            ...programme,
            ...detailsResult.rows[0],
          })
        );
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error updating programme: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while updating the programme",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  fastify.put("/:id/approve", {
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
        required: ["approvedBy"],
        properties: {
          approvedBy: { type: "string", format: "uuid" },
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
      const approvalData = ApproveProgrammeSchema.parse(request.body);
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const programmeResult = await client.query(
          `
            SELECT id, status
            FROM programmes
            WHERE id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        if (programmeResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Programme not found",
          });
        }

        if (programmeResult.rows[0].status !== "review") {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "Bad Request",
            message: "Programme must be in review status to be approved",
          });
        }

        const updateResult = await client.query(
          `
            UPDATE programmes
            SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND tenant_id = $3
            RETURNING id, status, approved_by, approved_at
          `,
          [approvalData.approvedBy, id, tenantId]
        );

        await client.query("COMMIT");

        reply.send({
          id: updateResult.rows[0].id,
          status: updateResult.rows[0].status,
          approvedBy: updateResult.rows[0].approved_by,
          approvedAt: updateResult.rows[0].approved_at,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error approving programme: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while approving the programme",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

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
          description: "No content",
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
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const existsResult = await client.query(
          `
            SELECT id
            FROM programmes
            WHERE id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        if (existsResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Programme not found",
          });
        }

        const coursesResult = await client.query(
          `
            SELECT COUNT(*)
            FROM courses
            WHERE programme_id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        if (parseInt(coursesResult.rows[0].count, 10) > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "Conflict",
            message: "Cannot delete programme with associated courses",
          });
        }

        const classesResult = await client.query(
          `
            SELECT COUNT(*)
            FROM classes
            WHERE programme_id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        if (parseInt(classesResult.rows[0].count, 10) > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "Conflict",
            message: "Cannot delete programme with associated classes",
          });
        }

        await client.query(
          `
            DELETE FROM programmes
            WHERE id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        await client.query("COMMIT");
        reply.status(204).send();
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error deleting programme: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while deleting the programme",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });
}
