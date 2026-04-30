import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { z } from "zod";

// Define schema directly to avoid import issues
const UpsertCycleFeesSchema = z.object({
  cycleId: z.string().uuid(),
  programmeId: z.string().uuid(),
  inscription: z.number().nonnegative().default(0),
  scolarite: z.number().nonnegative().default(0),
  annexes: z.number().nonnegative().default(0),
  autres: z.number().nonnegative().default(0),
  currency: z.string().length(3).default('XOF'),
});

export async function cycleFeesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as Pool;

  // GET /api/v1/cycle-fees - list cycle fees (optional filter by cycleId/programmeId)
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          cycleId: { type: "string", format: "uuid" },
          programmeId: { type: "string", format: "uuid" },
          limit: { type: "number", minimum: 1, maximum: 200, default: 100 },
          cursor: { type: "string" },
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
                  cycleId: { type: "string" },
                  programmeId: { type: "string" },
                  inscription: { type: "number" },
                  scolarite: { type: "number" },
                  annexes: { type: "number" },
                  autres: { type: "number" },
                  currency: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  // Joined cycle info
                  cycleName: { type: "string" },
                  cycleCode: { type: "string" },
                  programmeName: { type: "string" },
                  programmeCode: { type: "string" },
                },
              },
            },
            pagination: {
              type: "object",
              properties: {
                cursor: { type: "string" },
                hasMore: { type: "boolean" },
                total: { type: "number" },
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

      const { cycleId, programmeId, limit = 100, cursor } = (request.query || {}) as { cycleId?: string; programmeId?: string; limit?: number; cursor?: string };

      const client = await pool.connect();
      try {
        let where = "WHERE cf.tenant_id = $1";
        const params: any[] = [request.tenantId];
        let paramIndex = 2;

        if (cycleId) {
          where += ` AND cf.cycle_id = $${paramIndex}`;
          params.push(cycleId);
          paramIndex++;
        }

        if (programmeId) {
          where += ` AND cf.programme_id = $${paramIndex}`;
          params.push(programmeId);
          paramIndex++;
        }

        if (cursor) {
          where += ` AND cf.created_at < $${paramIndex}`;
          params.push(cursor);
          paramIndex++;
        }

        const countRes = await client.query(`SELECT COUNT(*) FROM cycles_frais cf ${where}`, params);
        const total = parseInt(countRes.rows[0].count);

        const res = await client.query(
          `SELECT 
            cf.id, cf.tenant_id, cf.cycle_id, cf.programme_id, cf.inscription, cf.scolarite, cf.annexes, cf.autres, cf.currency, cf.created_at, cf.updated_at,
            c.name AS cycle_name, c.code AS cycle_code,
            p.name AS programme_name, p.code AS programme_code
          FROM cycles_frais cf
          JOIN cycles c ON c.id = cf.cycle_id
          JOIN programmes p ON p.id = cf.programme_id
          ${where}
          ORDER BY cf.created_at DESC
          LIMIT $${paramIndex}`,
          [...params, Math.min(limit, 200)]
        );

        const hasMore = res.rows.length > Math.min(limit, 200); // With LIMIT + 1 we could check, but we cap to limit
        return {
          data: res.rows.map((r) => ({
            id: r.id,
            tenantId: r.tenant_id,
            cycleId: r.cycle_id,
            programmeId: r.programme_id,
            inscription: Number(r.inscription),
            scolarite: Number(r.scolarite),
            annexes: Number(r.annexes),
            autres: Number(r.autres),
            currency: r.currency,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            cycleName: r.cycle_name,
            cycleCode: r.cycle_code,
            programmeName: r.programme_name,
            programmeCode: r.programme_code,
          })),
          pagination: {
            cursor: res.rows.length ? res.rows[res.rows.length - 1].created_at : undefined,
            hasMore,
            total,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/cycle-fees/upsert - create or update fees for a cycle and programme (filiere)
  fastify.post("/upsert", {
    schema: {
      body: {
        type: "object",
        required: ["cycleId", "programmeId"],
        properties: {
          cycleId: { type: "string", format: "uuid" },
          programmeId: { type: "string", format: "uuid" },
          inscription: { type: "number", minimum: 0, default: 0 },
          scolarite: { type: "number", minimum: 0, default: 0 },
          annexes: { type: "number", minimum: 0, default: 0 },
          autres: { type: "number", minimum: 0, default: 0 },
          currency: { type: "string", minLength: 3, maxLength: 3, default: "XOF" },
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
                cycleId: { type: "string" },
                programmeId: { type: "string" },
                inscription: { type: "number" },
                scolarite: { type: "number" },
                annexes: { type: "number" },
                autres: { type: "number" },
                currency: { type: "string" },
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

      const data = UpsertCycleFeesSchema.parse(request.body);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Ensure cycle exists for tenant
        const cycleCheck = await client.query(
          `SELECT id FROM cycles WHERE id = $1 AND tenant_id = $2`,
          [data.cycleId, request.tenantId]
        );
        if (cycleCheck.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Invalid cycle", message: "Cycle introuvable pour ce locataire" });
        }

        // Ensure programme exists for tenant and belongs to the selected cycle
        const programmeCheck = await client.query(
          `SELECT id FROM programmes WHERE id = $1 AND cycle_id = $2 AND tenant_id = $3`,
          [data.programmeId, data.cycleId, request.tenantId]
        );
        if (programmeCheck.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "Invalid programme",
            message: "La filière est introuvable pour ce cycle et ce locataire",
          });
        }

        // Upsert by (tenant_id, cycle_id, programme_id)
        const result = await client.query(
          `INSERT INTO cycles_frais (tenant_id, cycle_id, programme_id, inscription, scolarite, annexes, autres, currency)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, cycle_id, programme_id)
           DO UPDATE SET inscription = EXCLUDED.inscription, scolarite = EXCLUDED.scolarite,
                         annexes = EXCLUDED.annexes, autres = EXCLUDED.autres, currency = EXCLUDED.currency,
                         updated_at = NOW()
           RETURNING id, tenant_id, cycle_id, programme_id, inscription, scolarite, annexes, autres, currency, created_at, updated_at`,
          [request.tenantId, data.cycleId, data.programmeId, data.inscription, data.scolarite, data.annexes, data.autres, data.currency]
        );

        await client.query("COMMIT");

        const r = result.rows[0];
        return { data: {
          id: r.id,
          tenantId: r.tenant_id,
          cycleId: r.cycle_id,
          programmeId: r.programme_id,
          inscription: Number(r.inscription),
          scolarite: Number(r.scolarite),
          annexes: Number(r.annexes),
          autres: Number(r.autres),
          currency: r.currency,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }};
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  });
}
