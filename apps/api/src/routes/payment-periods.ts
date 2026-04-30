import { FastifyInstance, FastifyRequest } from "fastify";
import {
  PaymentPeriodSchema,
  CreatePaymentPeriodSchema,
  UpdatePaymentPeriodSchema,
  PaymentPeriodQuerySchema,
  PaymentPeriodStatusSchema
} from "@ecoledigitale/contracts/src/payments";

// Extend FastifyRequest to include our custom properties
interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  userId?: string;
}

export async function paymentPeriodsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/payment-periods - List payment periods
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "active", "closed", "archived"] },
          year: { type: "number", minimum: 2020, maximum: 2050 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
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
                  academicYearId: { type: ["string", "null"] },
                  name: { type: "string" },
                  description: { type: "string" },
                  periodStart: { type: "string" },
                  periodEnd: { type: "string" },
                  status: { type: "string" },
                  createdBy: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
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

      const query = PaymentPeriodQuerySchema.parse(request.query);
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      
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

        if (query.year) {
          whereClause += ` AND EXTRACT(YEAR FROM period_start) = $${paramIndex}`;
          params.push(query.year.toString());
          paramIndex++;
        }

        if (query.cursor) {
          whereClause += ` AND created_at < $${paramIndex}`;
          params.push(query.cursor);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          whereClause += ` AND academic_year_id = $${paramIndex}`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM payment_periods ${whereClause}`;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get payment periods
        const periodsQuery = `
          SELECT 
            id, tenant_id, academic_year_id, name, description, period_start, period_end, 
            status, created_by, created_at, updated_at
          FROM payment_periods 
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${paramIndex}
        `;
        params.push((query.limit + 1).toString()); // Get one extra to check if there are more

        const result = await client.query(periodsQuery, params);
        const hasMore = result.rows.length > query.limit;
        const periods = result.rows.slice(0, query.limit);

        const data = periods.map(row => ({
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

        return {
          data,
          pagination: {
            cursor: hasMore ? periods[periods.length - 1].created_at : undefined,
            hasMore,
            total,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/payment-periods/:id - Get payment period by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
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
                academicYearId: { type: ["string", "null"] },
                name: { type: "string" },
                description: { type: "string" },
                periodStart: { type: "string" },
                periodEnd: { type: "string" },
                status: { type: "string" },
                createdBy: { type: "string" },
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

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `SELECT 
            id, tenant_id, academic_year_id, name, description, period_start, period_end, 
            status, created_by, created_at, updated_at
          FROM payment_periods 
          WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Payment period not found",
          });
        }

        const row = result.rows[0];
        return {
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
        };
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/payment-periods - Create payment period
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string" },
          periodStart: { type: "string", format: "date" },
          periodEnd: { type: "string", format: "date" },
        },
        required: ["name", "periodStart", "periodEnd"],
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
                academicYearId: { type: ["string", "null"] },
                name: { type: "string" },
                description: { type: "string" },
                periodStart: { type: "string" },
                periodEnd: { type: "string" },
                status: { type: "string" },
                createdBy: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      try {
        console.log('📥 Received request body:', request.body);

        // Simple validation
        const body = request.body as any;
        if (!body || !body.name || !body.periodStart || !body.periodEnd) {
          return reply.status(400).send({
            error: "Missing required fields",
            message: "name, periodStart, and periodEnd are required",
          });
        }

        // Resolve tenant from middleware
        const tenantId = request.tenantId;
        const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
        if (!tenantId) {
          return reply.status(400).send({
            error: "Tenant Required",
            message: "This endpoint requires tenant context",
          });
        }
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
        } finally {
          client.release();
        }

        const data = body;

        // Validate date range
        if (new Date(data.periodStart) >= new Date(data.periodEnd)) {
          return reply.status(400).send({
            error: "Invalid Date Range",
            message: "Period start date must be before end date",
          });
        }

        const dbClient = await fastify.pg.connect();
        try {
          const academicYearResult = await dbClient.query(
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
          const periodStart = new Date(data.periodStart);
          const periodEnd = new Date(data.periodEnd);

          if (periodStart < ayStart || periodEnd > ayEnd) {
            return reply.status(400).send({
              error: "Out of Bounds",
              message: "Les dates de la période doivent être comprises dans l'année académique active",
            });
          }

          // Check for overlapping periods
          const overlapCheck = await dbClient.query(
            `SELECT id FROM payment_periods
            WHERE tenant_id = $1
            AND status != 'archived'
            AND daterange($2::date, $3::date, '[]') && daterange(period_start, period_end, '[]')`,
            [tenantId, data.periodStart, data.periodEnd]
          );

          if (overlapCheck.rows.length > 0) {
            return reply.status(400).send({
              error: "Overlapping Period",
              message: "Payment period overlaps with an existing period",
            });
          }

          const result = await dbClient.query(
            `INSERT INTO payment_periods
            (tenant_id, academic_year_id, name, description, period_start, period_end, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, tenant_id, academic_year_id, name, description, period_start, period_end,
                      status, created_by, created_at, updated_at`,
            [
              tenantId,
              activeAcademicYearId,
              data.name,
              data.description,
              data.periodStart,
              data.periodEnd,
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
          dbClient.release();
        }
      } catch (error) {
        console.error('❌ Error creating payment period:', error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create payment period",
        });
      }
    },
  });

  // PUT /api/v1/payment-periods/:id - Update payment period
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string" },
          periodStart: { type: "string", format: "date" },
          periodEnd: { type: "string", format: "date" },
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
                academicYearId: { type: ["string", "null"] },
                name: { type: "string" },
                description: { type: "string" },
                periodStart: { type: "string" },
                periodEnd: { type: "string" },
                status: { type: "string" },
                createdBy: { type: "string" },
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
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(400).send({
          error: "Authentication Required",
          message: "This endpoint requires authentication and tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const data = UpdatePaymentPeriodSchema.parse(request.body);
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      if (!activeAcademicYearId) {
        return reply.status(400).send({
          error: "Academic Year Required",
          message: "Aucune année académique active détectée. Veuillez activer une année avant l'enregistrement.",
        });
      }

      const client = await fastify.pg.connect();
      try {
        // Check if period exists and is editable
        const existingResult = await client.query(
          `SELECT status FROM payment_periods WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Payment period not found",
          });
        }

        const currentStatus = existingResult.rows[0].status;
        if (currentStatus === 'closed' || currentStatus === 'archived') {
          return reply.status(400).send({
            error: "Cannot Edit",
            message: "Cannot edit closed or archived payment periods",
          });
        }

        // Build update query
        const updateFields = [];
        const params = [id, request.tenantId];
        let paramIndex = 3;

        if (data.name !== undefined) {
          updateFields.push(`name = $${paramIndex}`);
          params.push(data.name);
          paramIndex++;
        }

        if (data.description !== undefined) {
          updateFields.push(`description = $${paramIndex}`);
          params.push(data.description);
          paramIndex++;
        }

        if (data.periodStart !== undefined) {
          updateFields.push(`period_start = $${paramIndex}`);
          params.push(data.periodStart.toISOString().split('T')[0]);
          paramIndex++;
        }

        if (data.periodEnd !== undefined) {
          updateFields.push(`period_end = $${paramIndex}`);
          params.push(data.periodEnd.toISOString().split('T')[0]);
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({
            error: "No Updates",
            message: "No fields to update",
          });
        }

        const academicYearResult = await client.query(
          `SELECT start_date, end_date
           FROM academic_years
           WHERE id = $1 AND tenant_id = $2`,
          [activeAcademicYearId, request.tenantId]
        );

        if (academicYearResult.rows.length === 0) {
          return reply.status(400).send({
            error: "Academic Year Not Found",
            message: "Année académique active introuvable pour ce tenant",
          });
        }

        const currentPeriodResult = await client.query(
          `SELECT period_start, period_end
           FROM payment_periods
           WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        const currentStart = currentPeriodResult.rows[0]?.period_start;
        const currentEnd = currentPeriodResult.rows[0]?.period_end;
        const nextStart = data.periodStart ? data.periodStart.toISOString().split('T')[0] : currentStart;
        const nextEnd = data.periodEnd ? data.periodEnd.toISOString().split('T')[0] : currentEnd;

        const ayStart = new Date(academicYearResult.rows[0].start_date);
        const ayEnd = new Date(academicYearResult.rows[0].end_date);
        const periodStart = new Date(nextStart);
        const periodEnd = new Date(nextEnd);

        if (periodStart < ayStart || periodEnd > ayEnd) {
          return reply.status(400).send({
            error: "Out of Bounds",
            message: "Les dates de la période doivent être comprises dans l'année académique active",
          });
        }

        updateFields.push(`academic_year_id = $${paramIndex}`);
        params.push(activeAcademicYearId);
        paramIndex++;

        const result = await client.query(
          `UPDATE payment_periods 
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, tenant_id, academic_year_id, name, description, period_start, period_end, 
                    status, created_by, created_at, updated_at`,
          params
        );

        const row = result.rows[0];
        return {
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
        };
      } finally {
        client.release();
      }
    },
  });

  // PATCH /api/v1/payment-periods/:id/status - Update payment period status
  fastify.patch("/:id/status", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "active", "closed", "archived"] },
        },
        required: ["status"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                status: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(400).send({
          error: "Authentication Required",
          message: "This endpoint requires authentication and tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };

      // Validate status transition
      const validTransitions = {
        draft: ['active', 'archived'],
        active: ['closed', 'archived'],
        closed: ['archived'],
        archived: [], // Cannot transition from archived
      };

      const client = await fastify.pg.connect();
      try {
        const existingResult = await client.query(
          `SELECT status FROM payment_periods WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Payment period not found",
          });
        }

        const currentStatus = existingResult.rows[0].status;
        if (!validTransitions[currentStatus].includes(status)) {
          return reply.status(400).send({
            error: "Invalid Transition",
            message: `Cannot transition from ${currentStatus} to ${status}`,
          });
        }

        const result = await client.query(
          `UPDATE payment_periods 
          SET status = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3
          RETURNING id, status, updated_at`,
          [status, id, request.tenantId]
        );

        const row = result.rows[0];
        return {
          data: {
            id: row.id,
            status: row.status,
            updatedAt: row.updated_at,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/payment-periods/purge-dev - Purge all periods for tenant (DEV ONLY)
  fastify.post("/purge-dev", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                before: {
                  type: "object",
                  properties: {
                    periods: { type: "number" },
                    payments: { type: "number" }
                  }
                },
                after: {
                  type: "object",
                  properties: {
                    periods: { type: "number" },
                    payments: { type: "number" }
                  }
                }
              }
            }
          }
        },
        403: {
          type: "object",
          properties: { error: { type: "string" }, message: { type: "string" } }
        },
        400: {
          type: "object",
          properties: { error: { type: "string" }, message: { type: "string" } }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (process.env.NODE_ENV !== 'development') {
        return reply.status(403).send({ error: 'Forbidden', message: 'DEV only' });
      }
      if (!request.tenantId) {
        return reply.status(400).send({ error: 'Tenant Required', message: 'This endpoint requires tenant context' });
      }
      // Simple safeguard header
      const confirm = request.headers['x-dev-confirm'];
      if (confirm !== 'PURGE') {
        return reply.status(400).send({ error: 'Confirmation Required', message: 'Send X-Dev-Confirm: PURGE' });
      }

      const client = await fastify.pg.connect();
      try {
        const beforePeriods = await client.query(`SELECT COUNT(*) FROM payment_periods WHERE tenant_id = $1`, [request.tenantId]);
        const beforePayments = await client.query(`SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1`, [request.tenantId]);

        await client.query('BEGIN');
        await client.query("SET LOCAL session_replication_role = 'replica'");
        try {
          await client.query(
            `DELETE FROM payment_audit_log WHERE tenant_id = $1 AND payment_id IN (
               SELECT id FROM teacher_payments WHERE tenant_id = $1
             )`,
            [request.tenantId]
          );
        } catch {}
        await client.query(
          `DELETE FROM teacher_payments WHERE payment_period_id IN (SELECT id FROM payment_periods WHERE tenant_id = $1)`,
          [request.tenantId]
        );
        await client.query(`DELETE FROM payment_periods WHERE tenant_id = $1`, [request.tenantId]);
        await client.query("SET LOCAL session_replication_role = 'origin'");
        await client.query('COMMIT');

        const afterPeriods = await client.query(`SELECT COUNT(*) FROM payment_periods WHERE tenant_id = $1`, [request.tenantId]);
        const afterPayments = await client.query(`SELECT COUNT(*) FROM teacher_payments WHERE tenant_id = $1`, [request.tenantId]);

        return reply.send({
          data: {
            before: { periods: parseInt(beforePeriods.rows[0].count), payments: parseInt(beforePayments.rows[0].count) },
            after: { periods: parseInt(afterPeriods.rows[0].count), payments: parseInt(afterPayments.rows[0].count) }
          }
        });
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to purge periods' });
      } finally {
        client.release();
      }
    }
  });

  // DELETE /api/v1/payment-periods/:id - Delete payment period
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          cascade: { type: "boolean" },
        },
      },
      response: {
        204: {
          type: "null",
          description: "No content"
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
            paymentCount: { type: "number" },
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
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(400).send({
          error: "Authentication Required",
          message: "This endpoint requires authentication and tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const { cascade } = (request.query as { cascade?: boolean }) || {};

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if period has any payments
        const paymentsCheck = await client.query(
          `SELECT COUNT(*) as count FROM teacher_payments WHERE payment_period_id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        const paymentCount = parseInt(paymentsCheck.rows[0].count);

        if (paymentCount > 0) {
          // If cascade is true, delete payments first
          if (cascade === true) {
            // Temporarily disable the audit trigger to avoid FK issues
            await client.query("SET LOCAL session_replication_role = 'replica'");

            // Get payment IDs before deletion for audit log cleanup
            const paymentIdsResult = await client.query(
              `SELECT id FROM teacher_payments WHERE payment_period_id = $1 AND tenant_id = $2`,
              [id, request.tenantId]
            );
            const paymentIds = paymentIdsResult.rows.map(row => row.id);

            if (paymentIds.length > 0) {
              // Delete related audit logs first
              await client.query(
                `DELETE FROM payment_audit_log 
                 WHERE tenant_id = $1 AND payment_id = ANY($2)`,
                [request.tenantId, paymentIds]
              );

              // Delete payment hour details
              await client.query(
                `DELETE FROM payment_hour_details 
                 WHERE tenant_id = $1 AND payment_id = ANY($2)`,
                [request.tenantId, paymentIds]
              );

              // Delete teacher payments
              await client.query(
                `DELETE FROM teacher_payments WHERE payment_period_id = $1 AND tenant_id = $2`,
                [id, request.tenantId]
              );
            }

            // Re-enable triggers
            await client.query("SET LOCAL session_replication_role = 'origin'");
          } else {
            await client.query('ROLLBACK');
            return reply.status(400).send({
              error: "Cannot Delete",
              message: `Cette période contient ${paymentCount} paiement(s). Utilisez le paramètre cascade=true pour supprimer également les paiements associés.`,
              paymentCount: paymentCount,
            });
          }
        }

        // Delete the payment period
        const result = await client.query(
          `DELETE FROM payment_periods WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Payment period not found",
          });
        }

        await client.query('COMMIT');
        return reply.status(204).send();
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  });
}