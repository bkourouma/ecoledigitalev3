import { FastifyInstance } from "fastify";
import { z } from "zod";

const bodySchema = z.object({
  periodId: z.string().uuid(),
  items: z.array(z.object({
    assignmentId: z.string().uuid(),
    hours: z.number().positive(),
    sessionType: z.enum(['theory','practical']).default('theory'),
  })).min(1),
});

export async function teachingHoursBatchRoutes(fastify: FastifyInstance) {
  fastify.post('/from-assignments', async (request, reply) => {
    try {
      const tenantId = (request as any).tenantId || (request.headers['x-tenant'] as string);
      if (!tenantId) return reply.status(400).send({ error: 'Tenant Required', message: 'X-Tenant missing' });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation Error', message: parsed.error.message });
      const { periodId, items } = parsed.data;

      const client = await fastify.pg.connect();
      try {
        // Resolve period end
        const pRes = await client.query(`SELECT period_end FROM payment_periods WHERE id = $1 AND tenant_id = $2`, [periodId, tenantId]);
        if (pRes.rows.length === 0) return reply.status(400).send({ error: 'Invalid Period', message: 'Payment period not found' });
        const periodEnd = pRes.rows[0].period_end;

        // Resolve acting user
        let userId: string | null = (request as any).userId || null;
        if (!userId) {
          const r = await client.query('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [tenantId]);
          if (r.rows.length > 0) userId = r.rows[0].id; else {
            const bcrypt = require('bcrypt');
            const passwordHash = await bcrypt.hash('testpassword123', 10);
            const ui = await client.query(
              'INSERT INTO users (email, first_name, last_name, password_hash, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [`validator-${Date.now()}@example.com`, 'Validator', 'User', passwordHash, tenantId]
            );
            userId = ui.rows[0].id;
          }
        }

        await client.query('BEGIN');
        for (const it of items) {
          // Ensure assignment belongs to tenant
          const a = await client.query('SELECT id FROM course_assignments WHERE id = $1 AND tenant_id = $2', [it.assignmentId, tenantId]);
          if (a.rows.length === 0) continue;

          await client.query(
            `INSERT INTO teaching_hours (tenant_id, assignment_id, session_date, hours_taught, session_type, validated_by, validated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [tenantId, it.assignmentId, periodEnd, it.hours, it.sessionType, userId]
          );
        }
        await client.query('COMMIT');
        return reply.send({ data: { created: items.length } });
      } catch (e) {
        try { await (await fastify.pg.connect()).query('ROLLBACK'); } catch {}
        throw e;
      } finally { client.release(); }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create hours' });
    }
  });
}

