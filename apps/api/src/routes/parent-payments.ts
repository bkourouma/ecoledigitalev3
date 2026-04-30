import { FastifyInstance } from "fastify";
import { z } from "zod";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    roles?: string[];
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

// Verify parent-child relationship utility
async function verifyParentChildRelationshipForPayments(
  pool: any,
  parentId: string,
  childId: string,
  tenantId: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM student_parents 
     WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
    [parentId, childId, tenantId]
  );
  return result.rows.length > 0;
}

export async function parentPaymentsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/payments/history - List all payment transactions for children linked to the authenticated parent
  fastify.get('/history', {
    schema: {
      tags: ['Parent Payments'],
      summary: 'List all payment transactions for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          feeType: { type: 'string', enum: ['tuition', 'inscription', 'annexes', 'autres'] },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          status: { type: 'string', enum: ['pending', 'completed', 'failed', 'cancelled'] },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                transactions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      enrollmentId: { type: 'string', format: 'uuid' },
                      tuitionInstallmentId: { type: 'string', format: 'uuid', nullable: true },
                      feeType: { type: 'string' },
                      amount: { type: 'number' },
                      currency: { type: 'string' },
                      paymentMethod: { type: 'string' },
                      status: { type: 'string' },
                      receiptUrl: { type: 'string', nullable: true },
                      processedAt: { type: 'string', nullable: true },
                      createdAt: { type: 'string' },
                    },
                  },
                },
                pagination: {
                  type: 'object',
                  properties: {
                    page: { type: 'number' },
                    limit: { type: 'number' },
                    total: { type: 'number' },
                    totalPages: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, feeType, startDate, endDate, status, page = 1, limit = 20 } = request.query as {
        childId?: string;
        feeType?: string;
        startDate?: string;
        endDate?: string;
        status?: string;
        page?: number;
        limit?: number;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForPayments(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'pt.tenant_id = $1',
          'pt.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
          '($3::uuid IS NULL OR EXISTS (SELECT 1 FROM student_enrollments se WHERE se.id = pt.enrollment_id AND se.tenant_id = pt.tenant_id AND se.academic_year_id = $3::uuid))',
        ];
        const queryParams: any[] = [tenantId, userId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`pt.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by fee type
        if (feeType) {
          whereConditions.push(`pt.fee_type = $${paramIndex}`);
          queryParams.push(feeType);
          paramIndex++;
        }

        // Filter by status
        if (status) {
          whereConditions.push(`pt.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`pt.created_at >= $${paramIndex}::date`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`pt.created_at <= $${paramIndex}::date + INTERVAL '1 day'`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Count total for pagination
        const countQuery = `
          SELECT COUNT(DISTINCT pt.id) as total
          FROM payment_transactions pt
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query payment transactions
        const transactionsQuery = `
          SELECT 
            pt.id as transaction_id,
            pt.student_id,
            pt.enrollment_id,
            pt.tuition_installment_id,
            pt.fee_type,
            pt.amount,
            pt.currency,
            pt.payment_method,
            pt.status,
            pt.receipt_url,
            pt.processed_at,
            pt.created_at,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM payment_transactions pt
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY pt.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);
        const transactionsResult = await pool.query(transactionsQuery, queryParams);

        // Process transactions
        const transactions = transactionsResult.rows.map((row: any) => ({
          id: row.transaction_id,
          studentId: row.student_id,
          childId: row.child_id,
          childName: row.child_name,
          enrollmentId: row.enrollment_id,
          tuitionInstallmentId: row.tuition_installment_id || null,
          feeType: row.fee_type,
          amount: parseFloat(row.amount),
          currency: row.currency || 'XOF',
          paymentMethod: row.payment_method || null,
          status: row.status,
          receiptUrl: row.receipt_url || null,
          processedAt: row.processed_at ? (typeof row.processed_at === 'string' ? row.processed_at : row.processed_at.toISOString()) : null,
          createdAt: row.created_at ? (typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString()) : row.created_at,
        }));

        return reply.send({
          success: true,
          data: {
            transactions,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching payment history',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch payment history',
        });
      }
    },
  });

  // GET /api/v1/parent/payments/installments - List all tuition installments for children linked to the authenticated parent
  fastify.get('/installments', {
    schema: {
      tags: ['Parent Payments'],
      summary: 'List all tuition installments for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                installments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      enrollmentId: { type: 'string', format: 'uuid' },
                      scheduleId: { type: 'string', format: 'uuid' },
                      installmentNumber: { type: 'number' },
                      installmentLabel: { type: 'string' },
                      amount: { type: 'number' },
                      dueDate: { type: 'string' },
                      status: { type: 'string' },
                      amountPaid: { type: 'number' },
                      lateFee: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId } = request.query as {
        childId?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForPayments(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sti.tenant_id = $1',
          'sti.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
          '($3::uuid IS NULL OR se.academic_year_id = $3::uuid)',
        ];
        const queryParams: any[] = [tenantId, userId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`sti.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Query tuition installments
        const installmentsQuery = `
          SELECT 
            sti.id as installment_id,
            sti.student_id,
            sti.enrollment_id,
            sti.schedule_id,
            sti.installment_number,
            sti.installment_label,
            sti.amount,
            sti.due_date,
            sti.status,
            sti.amount_paid,
            sti.late_fee,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM student_tuition_installments sti
          JOIN student_enrollments se ON sti.enrollment_id = se.id
          JOIN student_profiles sp ON sti.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY sti.due_date ASC
        `;

        const installmentsResult = await pool.query(installmentsQuery, queryParams);

        // Process installments
        const installments = installmentsResult.rows.map((row: any) => ({
          id: row.installment_id,
          studentId: row.student_id,
          childId: row.child_id,
          childName: row.child_name,
          enrollmentId: row.enrollment_id,
          scheduleId: row.schedule_id,
          installmentNumber: row.installment_number,
          installmentLabel: row.installment_label,
          amount: parseFloat(row.amount),
          dueDate: row.due_date ? (typeof row.due_date === 'string' ? row.due_date : row.due_date.toISOString().split('T')[0]) : null,
          status: row.status,
          amountPaid: parseFloat(row.amount_paid || 0),
          lateFee: parseFloat(row.late_fee || 0),
        }));

        return reply.send({
          success: true,
          data: {
            installments,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching tuition installments',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch tuition installments',
        });
      }
    },
  });

  // GET /api/v1/parent/payments/schedules - List all payment schedules for children linked to the authenticated parent
  fastify.get('/schedules', {
    schema: {
      tags: ['Parent Payments'],
      summary: 'List all payment schedules for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                schedules: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      enrollmentId: { type: 'string', format: 'uuid' },
                      scheduleName: { type: 'string' },
                      academicYear: { type: 'string' },
                      totalTuition: { type: 'number' },
                      numberOfInstallments: { type: 'number' },
                      installments: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            installmentNumber: { type: 'number' },
                            installmentLabel: { type: 'string' },
                            amount: { type: 'number' },
                            dueDate: { type: 'string' },
                            status: { type: 'string' },
                            amountPaid: { type: 'number' },
                            lateFee: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId } = request.query as {
        childId?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForPayments(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sti.tenant_id = $1',
          'sti.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
          '($3::uuid IS NULL OR se.academic_year_id = $3::uuid)',
        ];
        const queryParams: any[] = [tenantId, userId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`sti.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Query payment schedules via student_tuition_installments
        // We get unique schedules by grouping installments by schedule_id
        const schedulesQuery = `
          SELECT DISTINCT
            tps.id as schedule_id,
            sti.student_id,
            sti.enrollment_id,
            tps.schedule_name,
            ay.name as academic_year,
            se.fees->>'scolarite' as total_tuition_raw,
            COUNT(DISTINCT sti.id) as number_of_installments,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM student_tuition_installments sti
          JOIN tuition_payment_schedules tps ON sti.schedule_id = tps.id
          JOIN student_profiles sp ON sti.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_enrollments se ON sti.enrollment_id = se.id
          JOIN academic_years ay ON se.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          GROUP BY tps.id, sti.student_id, sti.enrollment_id, tps.schedule_name, ay.name, se.fees->>'scolarite', sp.id, u.first_name, u.last_name, u.name
          ORDER BY ay.name DESC, tps.schedule_name DESC
        `;

        const schedulesResult = await pool.query(schedulesQuery, queryParams);

        // For each schedule, get the installments
        const schedules = await Promise.all(
          schedulesResult.rows.map(async (row: any) => {
            // Get installments for this schedule and student
            const installmentsQuery = `
              SELECT 
                sti.id,
                sti.installment_number,
                sti.installment_label,
                sti.amount,
                sti.due_date,
                sti.status,
                sti.amount_paid,
                sti.late_fee
              FROM student_tuition_installments sti
              WHERE sti.schedule_id = $1 
                AND sti.student_id = $2
                AND sti.tenant_id = $3
              ORDER BY sti.installment_number ASC
            `;

            const installmentsResult = await pool.query(installmentsQuery, [
              row.schedule_id,
              row.student_id,
              tenantId,
            ]);

            const totalTuition = parseFloat(row.total_tuition_raw || 0);

            return {
              id: row.schedule_id,
              studentId: row.student_id,
              childId: row.child_id,
              childName: row.child_name,
              enrollmentId: row.enrollment_id,
              scheduleName: row.schedule_name,
              academicYear: row.academic_year,
              totalTuition,
              numberOfInstallments: parseInt(row.number_of_installments, 10),
              installments: installmentsResult.rows.map((inst: any) => ({
                installmentNumber: inst.installment_number,
                installmentLabel: inst.installment_label,
                amount: parseFloat(inst.amount),
                dueDate: inst.due_date ? (typeof inst.due_date === 'string' ? inst.due_date : inst.due_date.toISOString().split('T')[0]) : null,
                status: inst.status,
                amountPaid: parseFloat(inst.amount_paid || 0),
                lateFee: parseFloat(inst.late_fee || 0),
              })),
            };
          })
        );

        return reply.send({
          success: true,
          data: {
            schedules,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching payment schedules',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch payment schedules',
        });
      }
    },
  });

  // GET /api/v1/parent/payments/balances - List all outstanding balances for children linked to the authenticated parent
  fastify.get('/balances', {
    schema: {
      tags: ['Parent Payments'],
      summary: 'List all outstanding balances for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          feeType: { type: 'string', enum: ['tuition', 'inscription', 'annexes', 'autres'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                balances: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      feeType: { type: 'string' },
                      totalOutstanding: { type: 'number' },
                      amountPaid: { type: 'number' },
                      amountDue: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, feeType } = request.query as {
        childId?: string;
        feeType?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForPayments(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sp.tenant_id = $1',
          'sp.id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
        ];
        const queryParams: any[] = [tenantId, userId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        const balances: any[] = [];

        // Calculate balances for tuition fees (from student_tuition_installments)
        if (!feeType || feeType === 'tuition') {
          const tuitionWhereConditions = [
            'sti.tenant_id = $1',
            'sti.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
            "sti.status IN ('pending', 'overdue', 'partial')",
            '($3::uuid IS NULL OR se.academic_year_id = $3::uuid)',
          ];
          const tuitionQueryParams: any[] = [tenantId, userId, activeAcademicYearId || null];
          let tuitionParamIndex = 4;

          if (childId) {
            tuitionWhereConditions.push(`sti.student_id = $${tuitionParamIndex}`);
            tuitionQueryParams.push(childId);
            tuitionParamIndex++;
          }

          const tuitionQuery = `
            SELECT 
              sti.student_id,
              sp.id as child_id,
              COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
              SUM(sti.amount - sti.amount_paid) as total_outstanding,
              SUM(sti.amount_paid) as amount_paid,
              SUM(sti.amount) as total_amount
            FROM student_tuition_installments sti
            JOIN student_enrollments se ON sti.enrollment_id = se.id
            JOIN student_profiles sp ON sti.student_id = sp.id
            JOIN users u ON sp.user_id = u.id
            WHERE ${tuitionWhereConditions.join(' AND ')}
            GROUP BY sti.student_id, sp.id, u.first_name, u.last_name, u.name
            HAVING SUM(sti.amount - sti.amount_paid) > 0
          `;

          const tuitionResult = await pool.query(tuitionQuery, tuitionQueryParams);

          tuitionResult.rows.forEach((row: any) => {
            const totalOutstanding = parseFloat(row.total_outstanding || 0);
            const amountPaid = parseFloat(row.amount_paid || 0);
            const totalAmount = parseFloat(row.total_amount || 0);
            const amountDue = totalAmount - amountPaid;

            balances.push({
              studentId: row.student_id,
              childId: row.child_id,
              childName: row.child_name,
              feeType: 'tuition',
              totalOutstanding,
              amountPaid,
              amountDue,
            });
          });
        }

        // Calculate balances for other fees (inscription, annexes, autres) from enrollments and transactions
        const otherFeeTypes = feeType 
          ? (feeType === 'tuition' ? [] : [feeType])
          : ['inscription', 'annexes', 'autres'];

        if (otherFeeTypes.length > 0) {
          // Map fee types: 'tuition' -> 'scolarite' for database
          const feeTypeMap: Record<string, string> = {
            'inscription': 'inscription',
            'annexes': 'annexes',
            'autres': 'autres',
          };

          for (const feeTypeKey of otherFeeTypes) {
            const dbFeeType = feeTypeMap[feeTypeKey];
            if (!dbFeeType) continue;

            const otherWhereConditions = [
              'se.tenant_id = $1',
              'se.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
              'se.status = $3',
              '($4::uuid IS NULL OR se.academic_year_id = $4::uuid)',
            ];
            const otherQueryParams: any[] = [tenantId, userId, 'active', activeAcademicYearId || null];
            let otherParamIndex = 5;

            if (childId) {
              otherWhereConditions.push(`se.student_id = $${otherParamIndex}`);
              otherQueryParams.push(childId);
              otherParamIndex++;
            }

            // Get fees from enrollments and paid amounts from transactions
            const otherFeesQuery = `
              SELECT 
                se.student_id,
                sp.id as child_id,
                COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
                COALESCE((se.fees->>$${otherParamIndex})::numeric, 0) as total_amount,
                COALESCE(SUM(pt.amount) FILTER (WHERE pt.status = 'completed'), 0) as amount_paid
              FROM student_enrollments se
              JOIN student_profiles sp ON se.student_id = sp.id
              JOIN users u ON sp.user_id = u.id
              LEFT JOIN payment_transactions pt ON pt.student_id = se.student_id 
                AND pt.enrollment_id = se.id 
                AND pt.fee_type = $${otherParamIndex + 1}
                AND pt.tenant_id = $1
              WHERE ${otherWhereConditions.join(' AND ')}
              GROUP BY se.student_id, sp.id, u.first_name, u.last_name, u.name, se.fees->>$${otherParamIndex}
              HAVING COALESCE((se.fees->>$${otherParamIndex})::numeric, 0) > 0
            `;

            otherQueryParams.push(dbFeeType, dbFeeType);
            const otherFeesResult = await pool.query(otherFeesQuery, otherQueryParams);

            otherFeesResult.rows.forEach((row: any) => {
              const totalAmount = parseFloat(row.total_amount || 0);
              const amountPaid = parseFloat(row.amount_paid || 0);
              const amountDue = totalAmount - amountPaid;
              const totalOutstanding = amountDue > 0 ? amountDue : 0;

              if (totalOutstanding > 0) {
                balances.push({
                  studentId: row.student_id,
                  childId: row.child_id,
                  childName: row.child_name,
                  feeType: feeTypeKey,
                  totalOutstanding,
                  amountPaid,
                  amountDue,
                });
              }
            });
          }
        }

        return reply.send({
          success: true,
          data: {
            balances,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching outstanding balances',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch outstanding balances',
        });
      }
    },
  });

  // GET /api/v1/parent/payments/receipts - List all payment receipts for children linked to the authenticated parent
  fastify.get('/receipts', {
    schema: {
      tags: ['Parent Payments'],
      summary: 'List all payment receipts for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          feeType: { type: 'string', enum: ['tuition', 'inscription', 'annexes', 'autres'] },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                receipts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      transactionId: { type: 'string', format: 'uuid' },
                      receiptNumber: { type: 'string' },
                      receiptUrl: { type: 'string' },
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      feeType: { type: 'string' },
                      amount: { type: 'number' },
                      currency: { type: 'string' },
                      paymentMethod: { type: 'string' },
                      processedAt: { type: 'string', nullable: true },
                      generatedAt: { type: 'string' },
                    },
                  },
                },
                pagination: {
                  type: 'object',
                  properties: {
                    page: { type: 'number' },
                    limit: { type: 'number' },
                    total: { type: 'number' },
                    totalPages: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, feeType, startDate, endDate, page = 1, limit = 20 } = request.query as {
        childId?: string;
        feeType?: string;
        startDate?: string;
        endDate?: string;
        page?: number;
        limit?: number;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForPayments(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'pr.tenant_id = $1',
          'pt.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = $2 AND tenant_id = $1)',
          '($3::uuid IS NULL OR EXISTS (SELECT 1 FROM student_enrollments se WHERE se.id = pt.enrollment_id AND se.tenant_id = pt.tenant_id AND se.academic_year_id = $3::uuid))',
        ];
        const queryParams: any[] = [tenantId, userId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`pt.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by fee type
        if (feeType) {
          // Map 'tuition' to 'scolarite' for database
          const dbFeeType = feeType === 'tuition' ? 'scolarite' : feeType;
          whereConditions.push(`pt.fee_type = $${paramIndex}`);
          queryParams.push(dbFeeType);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`pr.generated_at >= $${paramIndex}::date`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`pr.generated_at <= $${paramIndex}::date + INTERVAL '1 day'`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Count total for pagination
        const countQuery = `
          SELECT COUNT(DISTINCT pr.id) as total
          FROM payment_receipts pr
          JOIN payment_transactions pt ON pr.transaction_id = pt.id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query payment receipts
        const receiptsQuery = `
          SELECT
            pr.id as receipt_id,
            pr.transaction_id,
            pr.receipt_number,
            pr.receipt_url,
            pr.generated_at,
            pt.student_id,
            pt.fee_type,
            pt.amount,
            pt.currency,
            pt.payment_method,
            pt.processed_at,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM payment_receipts pr
          JOIN payment_transactions pt ON pr.transaction_id = pt.id
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY pr.generated_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);
        const receiptsResult = await pool.query(receiptsQuery, queryParams);

        // Process receipts
        const receipts = receiptsResult.rows.map((row: any) => {
          // Map 'scolarite' back to 'tuition' for API response
          const apiFeeType = row.fee_type === 'scolarite' ? 'tuition' : row.fee_type;

          return {
            id: row.receipt_id,
            transactionId: row.transaction_id,
            receiptNumber: row.receipt_number,
            receiptUrl: row.receipt_url,
            studentId: row.student_id,
            childId: row.child_id,
            childName: row.child_name,
            feeType: apiFeeType,
            amount: parseFloat(row.amount),
            currency: row.currency || 'XOF',
            paymentMethod: row.payment_method || null,
            processedAt: row.processed_at ? (typeof row.processed_at === 'string' ? row.processed_at : row.processed_at.toISOString()) : null,
            generatedAt: row.generated_at ? (typeof row.generated_at === 'string' ? row.generated_at : row.generated_at.toISOString()) : row.generated_at,
          };
        });

        return reply.send({
          success: true,
          data: {
            receipts,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching payment receipts',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch payment receipts',
        });
      }
    },
  });

  // GET /api/v1/parent/payments/methods - List all payment methods for the authenticated parent
  fastify.get('/methods', {
    schema: {
      tags: ['Parent Payments'],
      summary: 'List all payment methods for the authenticated parent',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                methods: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      methodType: { type: 'string' },
                      last4Digits: { type: 'string', nullable: true },
                      expirationDate: { type: 'string', nullable: true },
                      isDefault: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Note: Payment methods storage may vary by implementation
        // For now, return empty array as payment methods are not yet stored in the system
        // This endpoint is ready for future implementation when payment methods are stored
        // Future implementation would query a payment_methods table or payment gateway API
        
        const methods: any[] = [];

        // TODO: Implement payment methods storage and retrieval
        // Example future implementation:
        // const methodsQuery = `
        //   SELECT 
        //     id,
        //     method_type,
        //     last_4_digits,
        //     expiration_date,
        //     is_default
        //   FROM payment_methods
        //   WHERE parent_id = $1 AND tenant_id = $2
        //   ORDER BY is_default DESC, created_at DESC
        // `;
        // const methodsResult = await pool.query(methodsQuery, [userId, tenantId]);
        // const methods = methodsResult.rows.map((row: any) => ({
        //   id: row.id,
        //   methodType: row.method_type,
        //   last4Digits: row.last_4_digits || null,
        //   expirationDate: row.expiration_date ? (typeof row.expiration_date === 'string' ? row.expiration_date : row.expiration_date.toISOString().split('T')[0]) : null,
        //   isDefault: row.is_default || false,
        // }));

        return reply.send({
          success: true,
          data: {
            methods,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching payment methods',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch payment methods',
        });
      }
    },
  });
}

