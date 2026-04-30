import { FastifyInstance } from "fastify";

export default async function paymentPeriodsRoutes(fastify: FastifyInstance) {
  // POST /api/v1/simple-payment-periods - Create a new payment period
  fastify.post("/", async (request, reply) => {
    try {
      console.log('📥 Received request body:', request.body);
      
      const body = request.body as any;
      
      // Simple validation
      if (!body || !body.name || !body.periodStart || !body.periodEnd) {
        return reply.status(400).send({
          error: "Missing required fields",
          message: "name, periodStart, and periodEnd are required",
        });
      }

      // Resolve tenantId (UUID): prefer middleware, else header (UUID or slug lookup)
      let tenantId = (request as any).tenantId as string | undefined;
      if (!tenantId) {
        const headerTenant = (request.headers['x-tenant'] as string | undefined)?.trim();
        if (headerTenant) {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenant);
          if (uuidLike) {
            tenantId = headerTenant;
          } else {
            const tmpClient = await fastify.pg.connect();
            try {
              const t = await tmpClient.query(
                'SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1',
                [headerTenant]
              );
              if (t.rows.length > 0) tenantId = t.rows[0].id;
            } finally {
              tmpClient.release();
            }
          }
        }
      }
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "Tenant context missing or unknown X-Tenant",
        });
      }

      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      if (!activeAcademicYearId) {
        return reply.status(400).send({
          error: "Academic Year Required",
          message: "Aucune année académique active détectée. Veuillez activer une année avant l'enregistrement.",
        });
      }
      
      // Get or create a user for testing
      const client = await fastify.pg.connect();
      let userId: string;
      
      try {
        // Try to find an existing user in this tenant
        const existingUserResult = await client.query(
          'SELECT id FROM users WHERE tenant_id = $1 LIMIT 1',
          [tenantId]
        );
        
        if (existingUserResult.rows.length > 0) {
          userId = existingUserResult.rows[0].id;
        } else {
          // Create a test user if none exists
          const bcrypt = require('bcrypt');
          const passwordHash = await bcrypt.hash('testpassword123', 10);
          const userResult = await client.query(
            'INSERT INTO users (email, first_name, last_name, password_hash, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [`test-${Date.now()}@example.com`, 'Test', 'User', passwordHash, tenantId]
          );
          userId = userResult.rows[0].id;
        }

        const academicYearResult = await client.query(
          `SELECT start_date, end_date
           FROM academic_years
           WHERE id = $1 AND tenant_id = $2`,
          [activeAcademicYearId, tenantId]
        );

        if (academicYearResult.rows.length === 0) {
          return reply.status(400).send({
            error: "Academic Year Not Found",
            message: "Année académique active introuvable pour ce tenant",
          });
        }

        const ayStart = new Date(academicYearResult.rows[0].start_date);
        const ayEnd = new Date(academicYearResult.rows[0].end_date);
        const periodStart = new Date(body.periodStart);
        const periodEnd = new Date(body.periodEnd);

        if (periodStart < ayStart || periodEnd > ayEnd) {
          return reply.status(400).send({
            error: "Out of Bounds",
            message: "Les dates de la période doivent être comprises dans l'année académique active",
          });
        }

        // Insert the payment period
        const result = await client.query(
          `INSERT INTO payment_periods 
          (tenant_id, academic_year_id, name, description, period_start, period_end, status, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, tenant_id, academic_year_id, name, description, period_start, period_end, 
                    status, created_by, created_at, updated_at`,
          [
            tenantId,
            activeAcademicYearId,
            body.name,
            body.description || null,
            body.periodStart,
            body.periodEnd,
            'active', // Set status to 'active' by default instead of 'draft'
            userId,
          ]
        );

        const row = result.rows[0];
        return reply.status(201).send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            name: row.name,
            description: row.description,
            periodStart: row.period_start,
            periodEnd: row.period_end,
            status: row.status,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Error creating payment period:', error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to create payment period",
      });
    }
  });

  // GET /api/v1/simple-payment-periods - List payment periods
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
            const tmpClient = await fastify.pg.connect();
            try {
              const t = await tmpClient.query(
                'SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1',
                [headerTenant]
              );
              if (t.rows.length > 0) tenantId = t.rows[0].id;
            } finally {
              tmpClient.release();
            }
          }
        }
      }
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "Tenant context missing or unknown X-Tenant",
        });
      }
      
      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `SELECT id, tenant_id, academic_year_id, name, description, period_start, period_end, 
                  status, created_by, created_at, updated_at
           FROM payment_periods 
           WHERE tenant_id = $1 
           ORDER BY created_at DESC`,
          [tenantId]
        );

        const periods = result.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          academicYearId: row.academic_year_id,
          name: row.name,
          description: row.description,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          status: row.status,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        return reply.status(200).send({
          data: periods,
          pagination: {
            hasMore: false,
            total: periods.length,
          },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Error fetching payment periods:', error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to fetch payment periods",
      });
    }
  });
}
