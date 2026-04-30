import { FastifyInstance } from "fastify";
import {
  TeacherPaymentSchema,
  TeacherPaymentQuerySchema,
  PaymentCalculationRequestSchema,
  PaymentApprovalSchema,
  PaymentBulkActionSchema,
  PaymentStatusSchema
} from "@ecoledigitale/contracts/src/payments";
import { PaymentCalculator } from "../services/payment-calculator.js";

export async function teacherPaymentsRoutes(fastify: FastifyInstance) {
  const paymentCalculator = new PaymentCalculator(fastify);

  // GET /api/v1/teacher-payments - List teacher payments
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          periodId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["calculated", "approved", "paid", "disputed", "cancelled"] },
          paymentType: { type: "string", enum: ["salary", "hourly", "bonus", "deduction"] },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
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
                  teacherId: { type: "string" },
                  paymentPeriodId: { type: "string" },
                  paymentType: { type: "string" },
                  baseAmount: { type: "number" },
                  overtimeAmount: { type: "number" },
                  bonusAmount: { type: "number" },
                  deductions: { type: "number" },
                  totalAmount: { type: "number" },
                  currency: { type: "string" },
                  status: { type: "string" },
                  calculatedAt: { type: "string" },
                  approvedBy: { type: "string" },
                  approvedAt: { type: "string" },
                  paidAt: { type: "string" },
                  notes: { type: "string" },
                  calculationDetails: { type: "object" },
                  // Include related data
                  teacherName: { type: "string" },
                  teacherEmail: { type: "string" },
                  periodName: { type: "string" },
                  approverName: { type: "string" },
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

      const query = TeacherPaymentQuerySchema.parse(request.query);
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause
        let whereClause = "WHERE tp.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.teacherId) {
          whereClause += ` AND tp.teacher_id = $${paramIndex}`;
          params.push(query.teacherId);
          paramIndex++;
        }

        if (query.periodId) {
          whereClause += ` AND tp.payment_period_id = $${paramIndex}`;
          params.push(query.periodId);
          paramIndex++;
        }

        if (query.status) {
          whereClause += ` AND tp.status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        if (query.paymentType) {
          whereClause += ` AND tp.payment_type = $${paramIndex}`;
          params.push(query.paymentType);
          paramIndex++;
        }

        if (query.fromDate) {
          whereClause += ` AND tp.calculated_at >= $${paramIndex}`;
          params.push(query.fromDate);
          paramIndex++;
        }

        if (query.toDate) {
          whereClause += ` AND tp.calculated_at <= $${paramIndex}`;
          params.push(query.toDate);
          paramIndex++;
        }

        if (query.cursor) {
          whereClause += ` AND tp.calculated_at < $${paramIndex}`;
          params.push(query.cursor);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          whereClause += ` AND tp.payment_period_id IN (
            SELECT id FROM payment_periods WHERE tenant_id = $1 AND academic_year_id = $${paramIndex}
          )`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*)
          FROM teacher_payments tp
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get payments with related data
        const paymentsQuery = `
          SELECT
            tp.id, tp.tenant_id, tp.teacher_id, tp.payment_period_id,
            tp.payment_type, tp.base_amount, tp.overtime_amount, tp.bonus_amount,
            tp.deductions, tp.total_amount, tp.currency, tp.status,
            tp.calculated_at, tp.approved_by, tp.approved_at, tp.paid_at, tp.notes,
            tp.calculation_details,
            COALESCE(tu.first_name || ' ' || tu.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
            COALESCE(tu.email, t.email, '') as teacher_email,
            pp.name as period_name,
            au.first_name || ' ' || au.last_name as approver_name
          FROM teacher_payments tp
          JOIN teachers t ON tp.teacher_id = t.id
          LEFT JOIN users tu ON t.user_id = tu.id
          JOIN payment_periods pp ON tp.payment_period_id = pp.id
          LEFT JOIN users au ON tp.approved_by = au.id
          ${whereClause}
          ORDER BY tp.calculated_at DESC
          LIMIT $${paramIndex}
        `;
        params.push(query.limit + 1); // Get one extra to check if there are more

        const result = await client.query(paymentsQuery, params);
        const hasMore = result.rows.length > query.limit;
        const payments = result.rows.slice(0, query.limit);

        const data = payments.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          teacherId: row.teacher_id,
          paymentPeriodId: row.payment_period_id,
          paymentType: row.payment_type,
          baseAmount: parseFloat(row.base_amount),
          overtimeAmount: parseFloat(row.overtime_amount),
          bonusAmount: parseFloat(row.bonus_amount),
          deductions: parseFloat(row.deductions),
          totalAmount: parseFloat(row.total_amount),
          currency: row.currency,
          status: row.status,
          calculatedAt: row.calculated_at,
          approvedBy: row.approved_by,
          approvedAt: row.approved_at,
          paidAt: row.paid_at,
          notes: row.notes,
          calculationDetails: row.calculation_details,
          teacherName: row.teacher_name,
          teacherEmail: row.teacher_email,
          periodName: row.period_name,
          approverName: row.approver_name,
        }));

        return {
          data,
          pagination: {
            cursor: hasMore ? payments[payments.length - 1].calculated_at : undefined,
            hasMore,
            total,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-payments/:id - Get payment by ID
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
                teacherId: { type: "string" },
                paymentPeriodId: { type: "string" },
                paymentType: { type: "string" },
                baseAmount: { type: "number" },
                overtimeAmount: { type: "number" },
                bonusAmount: { type: "number" },
                deductions: { type: "number" },
                totalAmount: { type: "number" },
                currency: { type: "string" },
                calculationDetails: { type: "object" },
                status: { type: "string" },
                calculatedAt: { type: "string" },
                approvedBy: { type: "string" },
                approvedAt: { type: "string" },
                paidAt: { type: "string" },
                notes: { type: "string" },
                teacherName: { type: "string" },
                periodName: { type: "string" },
                hourDetails: { type: "array" },
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
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      const client = await fastify.pg.connect();
      try {
        // Get payment with related data
        const paymentResult = await client.query(
          `SELECT
            tp.id, tp.tenant_id, tp.teacher_id, tp.payment_period_id,
            tp.payment_type, tp.base_amount, tp.overtime_amount, tp.bonus_amount,
            tp.deductions, tp.total_amount, tp.currency, tp.calculation_details,
            tp.status, tp.calculated_at, tp.approved_by, tp.approved_at, tp.paid_at, tp.notes,
            COALESCE(tu.first_name || ' ' || tu.last_name, t.first_name || ' ' || t.last_name, 'Unknown Teacher') as teacher_name,
            t.email as teacher_email,
            pp.name as period_name
          FROM teacher_payments tp
          JOIN teachers t ON tp.teacher_id = t.id
          LEFT JOIN users tu ON t.user_id = tu.id
          JOIN payment_periods pp ON tp.payment_period_id = pp.id
          WHERE tp.id = $1 AND tp.tenant_id = $2
          ${activeAcademicYearId ? "AND pp.academic_year_id = $3" : ""}`,
          activeAcademicYearId
            ? [id, request.tenantId, activeAcademicYearId]
            : [id, request.tenantId]
        );

        if (paymentResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher payment not found",
          });
        }

        // Get hour details (handle cases where payment has no hour details)
        let hourDetails = [];
        try {
          const hourDetailsResult = await client.query(
            `SELECT
              phd.id, phd.teaching_hours_id, phd.hours_count, phd.hourly_rate,
              phd.amount, phd.is_overtime, phd.created_at,
              th.session_date, th.session_type,
              c.name as course_title
            FROM payment_hour_details phd
            LEFT JOIN teaching_hours th ON phd.teaching_hours_id = th.id
            LEFT JOIN course_assignments ca ON th.assignment_id = ca.id
            LEFT JOIN courses c ON ca.course_id = c.id
            WHERE phd.payment_id = $1
            ORDER BY th.session_date NULLS LAST`,
            [id]
          );
          
          hourDetails = hourDetailsResult.rows
            .filter(hd => hd.id) // Filter out null rows if any
            .map(hd => ({
              id: hd.id,
              teachingHoursId: hd.teaching_hours_id,
              hoursCount: parseFloat(hd.hours_count || '0'),
              hourlyRate: parseFloat(hd.hourly_rate || '0'),
              amount: parseFloat(hd.amount || '0'),
              isOvertime: hd.is_overtime || false,
              sessionDate: hd.session_date,
              sessionType: hd.session_type,
              courseTitle: hd.course_title || 'N/A',
            }));
        } catch (hourDetailsError) {
          // If hour details query fails, log but don't fail the entire request
          fastify.log.warn('Error fetching hour details (non-critical):', hourDetailsError);
          hourDetails = [];
        }

        const row = paymentResult.rows[0];

        return reply.send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            teacherId: row.teacher_id,
            paymentPeriodId: row.payment_period_id,
            paymentType: row.payment_type,
            baseAmount: parseFloat(row.base_amount),
            overtimeAmount: parseFloat(row.overtime_amount),
            bonusAmount: parseFloat(row.bonus_amount),
            deductions: parseFloat(row.deductions),
            totalAmount: parseFloat(row.total_amount),
            currency: row.currency,
            calculationDetails: row.calculation_details,
            status: row.status,
            calculatedAt: row.calculated_at,
            approvedBy: row.approved_by,
            approvedAt: row.approved_at,
            paidAt: row.paid_at,
            notes: row.notes,
            teacherName: row.teacher_name,
            teacherEmail: row.teacher_email,
            periodName: row.period_name,
            hourDetails,
          },
        });
      } catch (error) {
        fastify.log.error('Error fetching teacher payment:', error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Failed to fetch teacher payment",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teacher-payments - Create a new payment
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          periodId: { type: "string", format: "uuid" },
          paymentType: { type: "string", enum: ["salary", "hourly", "mixed", "bonus", "deduction"] },
          baseAmount: { type: "number", minimum: 0 },
          overtimeAmount: { type: "number", minimum: 0, default: 0 },
          bonusAmount: { type: "number", minimum: 0, default: 0 },
          deductions: { type: "number", minimum: 0, default: 0 },
          totalAmount: { type: "number" },
          hourlyDetails: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                hoursValidated: { type: "number" },
                hourlyRate: { type: "number" },
                amount: { type: "number" }
              }
            }
          },
          notes: { type: "string" }
        },
        required: ["teacherId", "periodId", "paymentType", "totalAmount"]
      }
    },
    handler: async (request, reply) => {
      let tenantId = (request as any).tenantId as string | undefined;
      let userId = (request as any).userId as string | undefined;

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
      if (!tenantId) return reply.status(400).send({ error: 'Tenant Required', message: 'Tenant missing' });
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      if (!activeAcademicYearId) {
        return reply.status(400).send({
          error: "Academic Year Required",
          message: "Aucune année académique active détectée. Veuillez activer une année avant l'enregistrement.",
        });
      }

      // For now, use a default user ID if not provided by auth middleware
      if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        userId = '634a57fe-2007-4ecb-ae5b-f9e3152a24fb'; // Default admin user
        fastify.log.warn(`Invalid userId provided: ${userId}, using default admin user`);
      }

      const data = request.body as any;
      const client = await fastify.pg.connect();

      try {
        // Verify the teacher_payments table exists
        const tableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'teacher_payments'
          )
        `);
        
        if (!tableCheck.rows[0].exists) {
          return reply.status(500).send({
            error: "Table Missing",
            message: "teacher_payments table does not exist. Please run database migrations."
          });
        }

        // Verify the required columns exist
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'teacher_payments' 
          AND column_name IN ('payment_config_id', 'payment_type', 'base_amount', 'total_amount')
        `);
        
        if (columnCheck.rows.length < 4) {
          return reply.status(500).send({
            error: "Table Schema Error",
            message: "teacher_payments table is missing required columns. Please run database migrations.",
            missingColumns: ['payment_config_id', 'payment_type', 'base_amount', 'total_amount'].filter(
              col => !columnCheck.rows.some(row => row.column_name === col)
            )
          });
        }

        await client.query('BEGIN');

        const periodYearCheck = await client.query(
          `SELECT 1 FROM payment_periods WHERE id = $1 AND tenant_id = $2 AND academic_year_id = $3`,
          [data.periodId, tenantId, activeAcademicYearId]
        );
        if (periodYearCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({
            error: "Academic Year Mismatch",
            message: "La période sélectionnée n'appartient pas à l'année académique active.",
          });
        }

        // Get the teacher's payment config ID
        let paymentConfigId = null;
        if (data.paymentType === 'salary' || data.paymentType === 'mixed' || data.paymentType === 'hourly') {
          fastify.log.info(`Looking for payment config for teacher ${data.teacherId} in tenant ${tenantId}`);
          const configResult = await client.query(
            `SELECT id FROM teacher_payment_configs 
             WHERE tenant_id = $1 AND teacher_id = $2 
             AND academic_year_id = $3
             AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
             AND effective_from <= CURRENT_DATE
             ORDER BY effective_from DESC LIMIT 1`,
            [tenantId, data.teacherId, activeAcademicYearId]
          );
          if (configResult.rows.length > 0) {
            paymentConfigId = configResult.rows[0].id;
            fastify.log.info(`Found payment config: ${paymentConfigId}`);
          } else {
            fastify.log.warn(`No active payment config found for teacher ${data.teacherId}`);
          }
        }

        // Create the payment record
        fastify.log.info(`Creating payment record with config ID: ${paymentConfigId}`);
        const paymentResult = await client.query(
          `INSERT INTO teacher_payments (
            tenant_id, teacher_id, payment_period_id, payment_config_id, payment_type,
            base_amount, overtime_amount, bonus_amount, deductions, total_amount,
            currency, status, created_by, calculation_details
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'XOF', 'calculated', $11, $12)
          RETURNING *`,
          [
            tenantId,
            data.teacherId,
            data.periodId,
            paymentConfigId,
            data.paymentType,
            data.baseAmount || 0,
            data.overtimeAmount || 0,
            data.bonusAmount || 0,
            data.deductions || 0,
            data.totalAmount,
            userId,
            JSON.stringify({ hourlyDetails: data.hourlyDetails || [] })
          ]
        );

        const payment = paymentResult.rows[0];

        await client.query('COMMIT');

        return reply.status(201).send({
          data: {
            id: payment.id,
            teacherId: payment.teacher_id,
            periodId: payment.payment_period_id,
            paymentType: payment.payment_type,
            baseAmount: parseFloat(payment.base_amount),
            overtimeAmount: parseFloat(payment.overtime_amount),
            bonusAmount: parseFloat(payment.bonus_amount),
            deductions: parseFloat(payment.deductions),
            totalAmount: parseFloat(payment.total_amount),
            status: payment.status,
            createdAt: payment.created_at
          }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error('Error creating teacher payment:', error);
        fastify.log.error('Payment data:', data);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create payment",
          details: error.message
        });
      } finally {
        client.release();
      }
    }
  });

  // POST /api/v1/teacher-payments/calculate - Calculate payments for period
  fastify.post("/calculate", {
    schema: {
      body: {
        type: "object",
        properties: {
          periodId: { type: "string", format: "uuid" },
          teacherIds: {
            type: "array",
            items: { type: "string", format: "uuid" }
          },
          recalculate: { type: "boolean", default: false },
        },
        required: ["periodId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                calculated: { type: "number" },
                skipped: { type: "number" },
                errors: { type: "number" },
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      teacherId: { type: "string" },
                      teacherName: { type: "string" },
                      status: { type: "string" },
                      paymentId: { type: "string" },
                      totalAmount: { type: "number" },
                      paymentType: { type: "string" },
                      baseAmount: { type: "number" },
                      overtimeAmount: { type: "number" },
                      bonusAmount: { type: "number" },
                      deductions: { type: "number" },
                      regularHours: { type: "number" },
                      overtimeHours: { type: "number" },
                      totalHours: { type: "number" },
                      error: { type: "string" },
                    },
                  },
                },
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
    handler: async (request, reply) => {
      const client = await fastify.pg.connect();
      try {
        // Resolve tenantId: prefer middleware, else header (UUID or slug lookup)
        if (!request.tenantId) {
          const headerTenant = (request.headers['x-tenant'] as string | undefined)?.trim();
          if (headerTenant) {
            const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenant);
            if (uuidLike) {
              request.tenantId = headerTenant;
            } else {
              try {
                const tmp = await fastify.pg.connect();
                try {
                  const t = await tmp.query('SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1', [headerTenant]);
                  if (t.rows.length > 0) request.tenantId = t.rows[0].id;
                } finally {
                  tmp.release();
                }
              } catch {}
            }
          }
        }
        const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
        if (!activeAcademicYearId) {
          return reply.status(400).send({
            error: "Academic Year Required",
            message: "Aucune année académique active détectée. Veuillez activer une année avant le calcul.",
          });
        }
        if (!request.tenantId) {
          return reply.status(400).send({
            error: "Tenant Required",
            message: "This endpoint requires tenant context via subdomain or X-Tenant header",
          });
        }

        let data;
        try {
          data = PaymentCalculationRequestSchema.parse(request.body);
        } catch (parseError) {
          fastify.log.error('Schema validation error:', parseError);
          return reply.status(400).send({
            error: "Invalid Request",
            message: parseError instanceof Error ? parseError.message : "Invalid request body",
          });
        }
        // Verify payment period exists and is active
        const periodResult = await client.query(
          `SELECT status FROM payment_periods WHERE id = $1 AND tenant_id = $2 AND academic_year_id = $3`,
          [data.periodId, request.tenantId, activeAcademicYearId]
        );

        if (periodResult.rows.length === 0) {
          return reply.status(400).send({
            error: "Period Not Found",
            message: "Payment period not found",
          });
        }

        if (periodResult.rows[0].status === 'closed' || periodResult.rows[0].status === 'archived') {
          return reply.status(400).send({
            error: "Period Closed",
            message: "Cannot calculate payments for closed or archived periods",
          });
        }

        // Resolve a userId to use for created_by when auth is not wired
        let effectiveUserId: string | null = (request as any).userId || null;
        if (!effectiveUserId) {
          try {
            const ures = await client.query('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [request.tenantId]);
            if (ures.rows.length > 0) {
              effectiveUserId = ures.rows[0].id;
            } else {
              // Create a test user if none exists to satisfy NOT NULL created_by
              const bcrypt = require('bcrypt');
              const passwordHash = await bcrypt.hash('testpassword123', 10);
              const ui = await client.query(
                'INSERT INTO users (email, first_name, last_name, password_hash, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [`calc-${Date.now()}@example.com`, 'Calc', 'User', passwordHash, request.tenantId]
              );
              effectiveUserId = ui.rows[0].id;
            }
          } catch (e) {
            fastify.log.warn(`Unable to resolve user for created_by: ${e instanceof Error ? e.message : String(e)}`);
            // Try to get any user as fallback
            try {
              const fallbackRes = await client.query('SELECT id FROM users LIMIT 1');
              if (fallbackRes.rows.length > 0) {
                effectiveUserId = fallbackRes.rows[0].id;
              }
            } catch (fallbackError) {
              fastify.log.error(`Failed to get fallback user: ${fallbackError}`);
            }
          }
        }

        if (!effectiveUserId) {
          return reply.status(500).send({
            error: "Internal Server Error",
            message: "Unable to resolve user for payment creation",
          });
        }

        // Calculate payments
        fastify.log.info(`Starting batch payment calculation for period ${data.periodId}, teachers: ${data.teacherIds?.length || 'all'}`);
        const calculations = await paymentCalculator.calculateBatchPayments(
          request.tenantId,
          data.periodId,
          data.teacherIds
        );
        fastify.log.info(`Batch calculation returned ${calculations.length} result(s)`);

        let calculated = 0;
        let skipped = 0;
        let errors = 0;
        const results = [];

        for (const calc of calculations) {
          try {
            // Check if payment already exists
            const existingResult = await client.query(
              `SELECT id FROM teacher_payments
              WHERE tenant_id = $1 AND teacher_id = $2 AND payment_period_id = $3 AND payment_type = $4`,
              [request.tenantId, calc.teacherId, data.periodId, calc.paymentType]
            );

            if (existingResult.rows.length > 0 && !data.recalculate) {
              skipped++;
              results.push({
                teacherId: calc.teacherId,
                teacherName: "Unknown", // Would need to fetch from DB
                status: "skipped",
                paymentId: existingResult.rows[0].id,
                totalAmount: 0,
                paymentType: calc.paymentType,
                baseAmount: calc.baseAmount,
                overtimeAmount: calc.overtimeAmount,
                bonusAmount: calc.bonusAmount,
                deductions: calc.deductions,
                regularHours: calc.calculationDetails.regularHours,
                overtimeHours: calc.calculationDetails.overtimeHours,
                totalHours: calc.calculationDetails.regularHours + calc.calculationDetails.overtimeHours,
                error: "Payment already exists",
              });
              continue;
            }

            // Begin transaction for this payment
            await client.query('BEGIN');

            let paymentId;
            if (existingResult.rows.length > 0) {
              // Update existing payment
              const updateResult = await client.query(
                `UPDATE teacher_payments
                SET base_amount = $1, overtime_amount = $2, bonus_amount = $3,
                    deductions = $4, total_amount = $5, calculation_details = $6,
                    status = 'calculated', calculated_at = NOW(), updated_at = NOW()
                WHERE id = $7
                RETURNING id`,
                [
                  calc.baseAmount,
                  calc.overtimeAmount,
                  calc.bonusAmount,
                  calc.deductions,
                  calc.totalAmount,
                  JSON.stringify(calc.calculationDetails),
                  existingResult.rows[0].id,
                ]
              );
              paymentId = updateResult.rows[0].id;

              // Delete existing hour details
              await client.query(
                `DELETE FROM payment_hour_details WHERE payment_id = $1`,
                [paymentId]
              );
            } else {
              // Create new payment
              const insertResult = await client.query(
                `INSERT INTO teacher_payments
                (tenant_id, teacher_id, payment_period_id, payment_type, base_amount,
                 overtime_amount, bonus_amount, deductions, total_amount,
                 calculation_details, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id`,
                [
                  request.tenantId,
                  calc.teacherId,
                  data.periodId,
                  calc.paymentType,
                  calc.baseAmount,
                  calc.overtimeAmount,
                  calc.bonusAmount,
                  calc.deductions,
                  calc.totalAmount,
                  JSON.stringify(calc.calculationDetails),
                  effectiveUserId,
                ]
              );
              paymentId = insertResult.rows[0].id;
            }

            // Insert hour details
            for (const hourDetail of calc.hourDetails) {
              await client.query(
                `INSERT INTO payment_hour_details
                (tenant_id, payment_id, teaching_hours_id, hours_count, hourly_rate, amount, is_overtime)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  request.tenantId,
                  paymentId,
                  hourDetail.teachingHoursId,
                  hourDetail.hoursCount,
                  hourDetail.hourlyRate,
                  hourDetail.amount,
                  hourDetail.isOvertime,
                ]
              );
            }

            await client.query('COMMIT');
            calculated++;

            results.push({
              teacherId: calc.teacherId,
              teacherName: "Unknown", // Would need to fetch from DB
              status: "calculated",
              paymentId,
              totalAmount: calc.totalAmount,
              paymentType: calc.paymentType,
              baseAmount: calc.baseAmount,
              overtimeAmount: calc.overtimeAmount,
              bonusAmount: calc.bonusAmount,
              deductions: calc.deductions,
              regularHours: calc.calculationDetails.regularHours,
              overtimeHours: calc.calculationDetails.overtimeHours,
              totalHours: calc.calculationDetails.regularHours + calc.calculationDetails.overtimeHours,
            });
          } catch (error) {
            await client.query('ROLLBACK');
            errors++;
            fastify.log.error(`Error saving payment for teacher ${calc.teacherId}:`, error);

            results.push({
              teacherId: calc.teacherId,
              teacherName: "Unknown",
              status: "error",
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        return {
          data: {
            calculated,
            skipped,
            errors,
            results,
          },
        };
      } catch (error) {
        fastify.log.error('Error in payment calculation handler:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error('Payment calculation error details:', {
          error: errorMessage,
          stack: errorStack,
          periodId: (request.body as any)?.periodId,
          tenantId: request.tenantId
        });
        
        return reply.status(500).send({
          error: "Internal Server Error",
          message: errorMessage || "Failed to calculate payments",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teacher-payments/approve - Approve payments
  fastify.post("/approve", {
    schema: {
      body: {
        type: "object",
        properties: {
          paymentIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1,
          },
          notes: { type: "string" },
        },
        required: ["paymentIds"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                approved: { type: "number" },
                failed: { type: "number" },
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      paymentId: { type: "string" },
                      status: { type: "string" },
                      error: { type: "string" },
                    },
                  },
                },
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
          message: "This endpoint requires tenant context via subdomain or X-Tenant header",
        });
      }

      const data = PaymentApprovalSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        let approved = 0;
        let failed = 0;
        const results = [];

        for (const paymentId of data.paymentIds) {
          try {
            const result = await client.query(
              `UPDATE teacher_payments
              SET status = 'approved', approved_by = $1, approved_at = NOW(),
                  notes = COALESCE($2, notes), updated_at = NOW()
              WHERE id = $3 AND tenant_id = $4 AND status = 'calculated'
              RETURNING id`,
              [request.userId, data.notes, paymentId, request.tenantId]
            );

            if (result.rowCount > 0) {
              approved++;
              results.push({
                paymentId,
                status: "approved",
              });
            } else {
              failed++;
              results.push({
                paymentId,
                status: "failed",
                error: "Payment not found or not in calculated status",
              });
            }
          } catch (error) {
            failed++;
            results.push({
              paymentId,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        return {
          data: {
            approved,
            failed,
            results,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teacher-payments/bulk-action - Bulk actions on payments
  fastify.post("/bulk-action", {
    schema: {
      body: {
        type: "object",
        properties: {
          paymentIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1,
          },
          action: {
            type: "string",
            enum: ["approve", "reject", "mark_paid", "cancel"]
          },
          notes: { type: "string" },
        },
        required: ["paymentIds", "action"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                processed: { type: "number" },
                failed: { type: "number" },
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      paymentId: { type: "string" },
                      status: { type: "string" },
                      error: { type: "string" },
                    },
                  },
                },
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
          message: "This endpoint requires tenant context via subdomain or X-Tenant header",
        });
      }

      const data = PaymentBulkActionSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        let processed = 0;
        let failed = 0;
        const results = [];

        for (const paymentId of data.paymentIds) {
          try {
            let updateQuery = "";
            let params = [request.userId, data.notes, paymentId, request.tenantId];

            switch (data.action) {
              case "approve":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'approved', approved_by = $1, approved_at = NOW(),
                      notes = COALESCE($2, notes), updated_at = NOW()
                  WHERE id = $3 AND tenant_id = $4 AND status = 'calculated'
                `;
                break;
              case "reject":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'disputed', notes = COALESCE($2, notes), updated_at = NOW()
                  WHERE id = $3 AND tenant_id = $4 AND status IN ('calculated', 'approved')
                `;
                break;
              case "mark_paid":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'paid', paid_at = NOW(),
                      notes = COALESCE($2, notes), updated_at = NOW()
                  WHERE id = $3 AND tenant_id = $4 AND status = 'approved'
                `;
                break;
              case "cancel":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'cancelled', notes = COALESCE($2, notes), updated_at = NOW()
                  WHERE id = $3 AND tenant_id = $4 AND status IN ('calculated', 'approved')
                `;
                break;
            }

            const result = await client.query(updateQuery, params);

            if (result.rowCount > 0) {
              processed++;
              results.push({
                paymentId,
                status: "processed",
              });
            } else {
              failed++;
              results.push({
                paymentId,
                status: "failed",
                error: "Payment not found or invalid status for this action",
              });
            }
          } catch (error) {
            failed++;
            results.push({
              paymentId,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        return {
          data: {
            processed,
            failed,
            results,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-payments/summary - Payment summary for dashboard
  fastify.get("/summary", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          periodId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                totalPayments: { type: "number" },
                totalAmount: { type: "number" },
                pendingApprovals: { type: "number" },
                pendingPayments: { type: "number" },
                byStatus: { type: "object" },
                byType: { type: "object" },
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

      const { periodId, teacherId } = request.query as {
        periodId?: string;
        teacherId?: string;
      };

      const client = await fastify.pg.connect();
      try {
        let whereClause = "WHERE tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (periodId) {
          whereClause += ` AND payment_period_id = $${paramIndex}`;
          params.push(periodId);
          paramIndex++;
        }

        if (teacherId) {
          whereClause += ` AND teacher_id = $${paramIndex}`;
          params.push(teacherId);
          paramIndex++;
        }

        // Get summary statistics
        const summaryResult = await client.query(
          `SELECT
            COUNT(*) as total_payments,
            COALESCE(SUM(total_amount), 0) as total_amount,
            COUNT(*) FILTER (WHERE status = 'calculated') as pending_approvals,
            COUNT(*) FILTER (WHERE status = 'approved') as pending_payments
          FROM teacher_payments
          ${whereClause}`,
          params
        );

        // Get breakdown by status
        const statusResult = await client.query(
          `SELECT status, COUNT(*) as count
          FROM teacher_payments
          ${whereClause}
          GROUP BY status`,
          params
        );

        // Get breakdown by type
        const typeResult = await client.query(
          `SELECT payment_type, COUNT(*) as count
          FROM teacher_payments
          ${whereClause}
          GROUP BY payment_type`,
          params
        );

        const summary = summaryResult.rows[0];
        const byStatus = {};
        const byType = {};

        statusResult.rows.forEach(row => {
          byStatus[row.status] = parseInt(row.count);
        });

        typeResult.rows.forEach(row => {
          byType[row.payment_type] = parseInt(row.count);
        });

        return {
          data: {
            totalPayments: parseInt(summary.total_payments),
            totalAmount: parseFloat(summary.total_amount),
            pendingApprovals: parseInt(summary.pending_approvals),
            pendingPayments: parseInt(summary.pending_payments),
            byStatus,
            byType,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // PATCH /api/v1/teacher-payments/:id/status - Update payment status
  fastify.patch("/:id/status", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" }
        }
      },
      body: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["calculated", "approved", "paid", "cancelled"] }
        }
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };
      const userId = "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"; // TODO: Get from auth

      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Update payment status
        const updateFields = ["status = $2", "updated_at = NOW()"];
        const params = [id, status];
        let paramIndex = 3;

        if (status === 'approved') {
          updateFields.push(`approved_by = $${paramIndex}`, `approved_at = NOW()`);
          params.push(userId);
          paramIndex++;
        } else if (status === 'paid') {
          updateFields.push(`paid_at = NOW()`);
        }

        const result = await client.query(
          `UPDATE teacher_payments
           SET ${updateFields.join(', ')}
           WHERE tenant_id = $${paramIndex} AND id = $1
           RETURNING *`,
          [...params, request.tenantId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Payment not found" });
        }

        return reply.send({ data: result.rows[0] });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to update payment status" });
      } finally {
        client.release();
      }
    }
  });
}
