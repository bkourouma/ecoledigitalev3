import { FastifyInstance } from "fastify";
import { z } from "zod";

const listQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validated: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(500).default(100),
});

const bulkValidateSchema = z.object({
  hourIds: z.array(z.string().uuid()).min(1),
  validated: z.boolean(),
});

// Note: zod does not have .date() on string; using regex yyyy-MM-dd for simple validation

export async function teachingHoursRoutes(fastify: FastifyInstance) {
  // GET /api/v1/teaching-hours - list hours
  fastify.get("/", async (request, reply) => {
    try {
      // Resolve tenantId (UUID): prefer middleware, else header (UUID or slug lookup)
      let tenantId = (request as any).tenantId as string | undefined;
      if (!tenantId) {
        const headerTenant = (request.headers['x-tenant'] as string | undefined)?.trim();
        if (headerTenant) {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenant);
          if (uuidLike) {
            tenantId = headerTenant;
          } else {
            const tmp = await fastify.pg.connect();
            try {
              const t = await tmp.query('SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1', [headerTenant]);
              if (t.rows.length > 0) tenantId = t.rows[0].id;
            } finally { tmp.release(); }
          }
        }
      }
      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "Tenant context missing or unknown X-Tenant" });
      }

      // Validate query
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation Error", message: parsed.error.message });
      }
      const { teacherId, fromDate, toDate, validated, limit } = parsed.data;

      const client = await fastify.pg.connect();
      try {
        let where = "th.tenant_id = $1";
        const params: any[] = [tenantId];
        let i = 2;

        if (teacherId) { where += ` AND ca.teacher_id = $${i++}`; params.push(teacherId); }
        if (fromDate) { where += ` AND th.session_date >= $${i++}`; params.push(fromDate); }
        if (toDate) { where += ` AND th.session_date <= $${i++}`; params.push(toDate); }
        if (validated === true) { where += ` AND th.validated_at IS NOT NULL`; }
        if (validated === false) { where += ` AND th.validated_at IS NULL`; }

        const rows = await client.query(
          `SELECT th.id, th.assignment_id, th.session_date, th.hours_taught, th.session_type,
                  th.validated_by, th.validated_at,
                  ca.teacher_id, c.id as course_id, c.name as course_title, c.code as course_code,
                  COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
                  COALESCE(u.email, t.email) as teacher_email
           FROM teaching_hours th
           JOIN course_assignments ca ON th.assignment_id = ca.id
           JOIN teachers t ON ca.teacher_id = t.id
           LEFT JOIN users u ON t.user_id = u.id
           JOIN courses c ON ca.course_id = c.id
           WHERE ${where}
           ORDER BY th.session_date DESC, th.created_at DESC
           LIMIT $${i}
          `,
          [...params, limit]
        );

        const data = rows.rows.map(r => ({
          id: r.id,
          assignmentId: r.assignment_id,
          sessionDate: r.session_date,
          hoursTaught: parseFloat(r.hours_taught),
          sessionType: r.session_type,
          validatedBy: r.validated_by,
          validatedAt: r.validated_at,
          teacher: { id: r.teacher_id, name: r.teacher_name, email: r.teacher_email },
          course: { id: r.course_id, title: r.course_title, code: r.course_code },
        }));

        return reply.send({ data, pagination: { hasMore: false, total: data.length } });
      } finally { client.release(); }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Internal Server Error", message: "Failed to fetch teaching hours" });
    }
  });

  // POST /api/v1/teaching-hours/bulk-validate - set/unset validation
  fastify.post("/bulk-validate", async (request, reply) => {
    try {
      // Resolve tenantId
      let tenantId = (request as any).tenantId as string | undefined;
      if (!tenantId) {
        const headerTenant = (request.headers['x-tenant'] as string | undefined)?.trim();
        if (headerTenant) {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenant);
          if (uuidLike) tenantId = headerTenant; else {
            const tmp = await fastify.pg.connect();
            try {
              const t = await tmp.query('SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1', [headerTenant]);
              if (t.rows.length > 0) tenantId = t.rows[0].id;
            } finally { tmp.release(); }
          }
        }
      }
      if (!tenantId) return reply.status(400).send({ error: "Tenant Required", message: "Tenant context missing or unknown X-Tenant" });

      const parsed = bulkValidateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation Error", message: parsed.error.message });
      }
      const { hourIds, validated } = parsed.data;

      const client = await fastify.pg.connect();
      try {
        // Determine acting user (dev fallback)
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
        if (validated) {
          await client.query(
            `UPDATE teaching_hours
             SET validated_by = $1, validated_at = NOW()
             WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
            [userId, tenantId, hourIds]
          );
        } else {
          await client.query(
            `UPDATE teaching_hours
             SET validated_by = NULL, validated_at = NULL
             WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
            [tenantId, hourIds]
          );
        }
        await client.query('COMMIT');
        return reply.send({ data: { updated: hourIds.length } });
      } catch (e) {
        try { await (await fastify.pg.connect()).query('ROLLBACK'); } catch {}
        throw e;
      } finally { client.release(); }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Internal Server Error", message: "Failed to update validation" });
    }
  });
}

