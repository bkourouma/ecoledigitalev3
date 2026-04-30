import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";
import { createTresorPayService } from "../services/tresorpay-gateway.service";

export async function studentPaymentsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as Pool;

  // GET /api/v1/student-payments/recent - Get recent completed payments
  fastify.get("/recent", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
          offset: { type: "number", minimum: 0, default: 0 },
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
                  studentId: { type: "string" },
                  studentName: { type: "string" },
                  enrollmentId: { type: "string" },
                  feeType: { type: "string" },
                  amount: { type: "number" },
                  currency: { type: "string" },
                  paymentMethod: { type: "string" },
                  status: { type: "string" },
                  externalTransactionId: { type: "string" },
                  createdAt: { type: "string" },
                  processedAt: { type: ["string", "null"] },
                },
              },
            },
            total: { type: "number" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 50, offset = 0 } = request.query as any;

      const client = await pool.connect();

      try {
        // Use set_config instead of SET for custom parameters
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Get recent completed transactions with student info
        const query = `
          SELECT
            pt.id,
            pt.student_id,
            u.first_name || ' ' || u.last_name as student_name,
            pt.enrollment_id,
            pt.fee_type,
            pt.amount,
            pt.currency,
            pt.payment_method,
            pt.status,
            pt.external_transaction_id,
            pt.created_at,
            pt.processed_at
          FROM payment_transactions pt
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE pt.status = 'completed'::transaction_status
          ORDER BY pt.processed_at DESC, pt.created_at DESC
          LIMIT $1 OFFSET $2
        `;

        const result = await client.query(query, [limit, offset]);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM payment_transactions pt
          WHERE pt.status = 'completed'::transaction_status
        `;

        const countResult = await client.query(countQuery);

        const transactions = result.rows.map(row => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          enrollmentId: row.enrollment_id,
          feeType: row.fee_type,
          amount: parseFloat(row.amount),
          currency: row.currency,
          paymentMethod: row.payment_method,
          status: row.status,
          externalTransactionId: row.external_transaction_id,
          createdAt: row.created_at.toISOString(),
          processedAt: row.processed_at ? row.processed_at.toISOString() : null,
        }));

        return reply.send({
          data: transactions,
          total: parseInt(countResult.rows[0].total),
        });
      } catch (error) {
        fastify.log.error("Error fetching recent payments:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch recent payments",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/student-payments/pending - Get pending payments for validation
  fastify.get("/pending", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
          offset: { type: "number", minimum: 0, default: 0 },
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
                  studentId: { type: "string" },
                  studentName: { type: "string" },
                  enrollmentId: { type: "string" },
                  feeType: { type: "string" },
                  amount: { type: "number" },
                  currency: { type: "string" },
                  paymentMethod: { type: "string" },
                  status: { type: "string" },
                  externalTransactionId: { type: "string" },
                  createdAt: { type: "string" },
                  processedAt: { type: ["string", "null"] },
                },
              },
            },
            total: { type: "number" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 50, offset = 0 } = request.query as any;

      const client = await pool.connect();

      try {
        // Use set_config instead of SET for custom parameters
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Get pending transactions with student info
        const query = `
          SELECT
            pt.id,
            pt.student_id,
            u.first_name || ' ' || u.last_name as student_name,
            pt.enrollment_id,
            pt.fee_type,
            pt.amount,
            pt.currency,
            pt.payment_method,
            pt.status,
            pt.external_transaction_id,
            pt.created_at,
            pt.processed_at
          FROM payment_transactions pt
          JOIN student_profiles sp ON pt.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE pt.status IN ('pending', 'processing')
          ORDER BY pt.created_at DESC
          LIMIT $1 OFFSET $2
        `;

        const result = await client.query(query, [limit, offset]);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM payment_transactions pt
          WHERE pt.status IN ('pending', 'processing')
        `;

        const countResult = await client.query(countQuery);

        const transactions = result.rows.map(row => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          enrollmentId: row.enrollment_id,
          feeType: row.fee_type,
          amount: parseFloat(row.amount),
          currency: row.currency,
          paymentMethod: row.payment_method,
          status: row.status,
          externalTransactionId: row.external_transaction_id,
          createdAt: row.created_at.toISOString(),
          processedAt: row.processed_at ? row.processed_at.toISOString() : null,
        }));

        return reply.send({
          data: transactions,
          total: parseInt(countResult.rows[0].total),
        });
      } catch (error) {
        fastify.log.error("Error fetching pending payments:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch pending payments",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/student-payments/:studentId - Get student payment summary
  fastify.get("/:studentId", {
    schema: {
      params: {
        type: "object",
        required: ["studentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                studentId: { type: "string" },
                studentName: { type: "string" },
                enrollmentId: { type: "string" },
                totalFees: { type: "number" },
                totalPaid: { type: "number" },
                totalOutstanding: { type: "number" },
                fees: {
                  type: "object",
                  properties: {
                    inscription: { type: "number" },
                    scolarite: { type: "number" },
                    annexes: { type: "number" },
                    autres: { type: "number" },
                    total: { type: "number" },
                  },
                },
                immediateFeesStatus: { type: "object" },
                tuitionInstallments: { type: "array" },
                recentTransactions: { type: "array" },
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

      const { studentId } = request.params as { studentId: string };
      const query = request.query as { academicYearId?: string };
      const activeAcademicYearId = (request.headers["x-academic-year-id"] as string | undefined) || query.academicYearId;
      const client = await pool.connect();

      try {
        // Use set_config to set custom GUC with parameter binding
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Get student enrollment and fees
        const enrollmentQuery = `
          SELECT 
            se.id as enrollment_id,
            se.class_id,
            se.academic_year_id,
            se.fees,
            sp.id as student_id,
            u.first_name || ' ' || u.last_name as student_name,
            c.programme_id,
            p.cycle_id
          FROM student_enrollments se
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN classes c ON c.id = se.class_id
          JOIN programmes p ON p.id = c.programme_id
          WHERE sp.id = $1
            AND (
              ($2::uuid IS NULL AND se.status = 'active')
              OR ($2::uuid IS NOT NULL AND se.academic_year_id = $2::uuid)
            )
          ORDER BY (se.status = 'active') DESC, se.created_at DESC
          LIMIT 1
        `;

        let enrollmentResult = await client.query(enrollmentQuery, [studentId, activeAcademicYearId || null]);

        if (enrollmentResult.rows.length === 0) {
          const studentResult = await client.query(
            `
            SELECT sp.id as student_id, u.first_name || ' ' || u.last_name as student_name
            FROM student_profiles sp
            JOIN users u ON u.id = sp.user_id
            WHERE sp.id = $1
            LIMIT 1
            `,
            [studentId]
          );

          if (studentResult.rows.length === 0) {
            return reply.status(404).send({
              error: "Not Found",
              message: "Student not found",
            });
          }

          return reply.send({
            data: {
              studentId,
              studentName: studentResult.rows[0].student_name,
              enrollmentId: null,
              totalFees: 0,
              totalPaid: 0,
              totalOutstanding: 0,
              fees: {
                inscription: 0,
                scolarite: 0,
                annexes: 0,
                autres: 0,
                total: 0,
              },
              immediateFeesStatus: {
                inscription: { amount: 0, paid: false, paidAmount: 0 },
                annexes: { amount: 0, paid: false, paidAmount: 0 },
                autres: { amount: 0, paid: false, paidAmount: 0 },
              },
              tuitionInstallments: [],
              recentTransactions: [],
            },
          });
        }

        const enrollment = enrollmentResult.rows[0];
        const rawFees = (enrollment.fees && typeof enrollment.fees === "object") ? enrollment.fees : {};

        // Default fees from cycle + programme configuration
        const cycleFeesResult = await client.query(
          `SELECT inscription, scolarite, annexes, autres
           FROM cycles_frais
           WHERE tenant_id = $1 AND cycle_id = $2 AND programme_id = $3
           ORDER BY created_at DESC
           LIMIT 1`,
          [request.tenantId, enrollment.cycle_id, enrollment.programme_id]
        );
        const defaultFees = cycleFeesResult.rows[0] || {};

        const pickFee = (value: any, fallback: any) => {
          const parsedValue = Number(value);
          if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue;
          const parsedFallback = Number(fallback);
          return Number.isFinite(parsedFallback) ? parsedFallback : 0;
        };

        const effectiveFees = {
          inscription: pickFee((rawFees as any).inscription, defaultFees.inscription),
          scolarite: pickFee((rawFees as any).scolarite ?? (rawFees as any).scolarité ?? (rawFees as any).SCOLARITE, defaultFees.scolarite),
          annexes: pickFee((rawFees as any).annexes, defaultFees.annexes),
          autres: pickFee((rawFees as any).autres, defaultFees.autres),
        };
        const effectiveTotal = effectiveFees.inscription + effectiveFees.scolarite + effectiveFees.annexes + effectiveFees.autres;

        // Get payment transactions for immediate fees
        const immediateFeesQuery = `
          SELECT fee_type, SUM(amount) as paid_amount
          FROM payment_transactions
          WHERE student_id = $1 AND enrollment_id = $2 
          AND fee_type IN ('inscription', 'annexes', 'autres')
          AND status = 'completed'
          GROUP BY fee_type
        `;

        const immediateFeesResult = await client.query(immediateFeesQuery, [
          studentId,
          enrollment.enrollment_id,
        ]);

        const paidFees = immediateFeesResult.rows.reduce((acc, row) => {
          acc[row.fee_type] = parseFloat(row.paid_amount);
          return acc;
        }, {} as Record<string, number>);

        // Get tuition installments
        const installmentsQuery = `
          SELECT 
            sti.*,
            tps.schedule_name
          FROM student_tuition_installments sti
          JOIN tuition_payment_schedules tps ON sti.schedule_id = tps.id
          WHERE sti.student_id = $1 AND sti.enrollment_id = $2
          ORDER BY sti.installment_number
        `;

        let installmentsResult = await client.query(installmentsQuery, [
          studentId,
          enrollment.enrollment_id,
        ]);

        // If installments are missing, generate them from the applicable schedule for this programme.
        if (installmentsResult.rows.length === 0 && effectiveFees.scolarite > 0) {
          const scheduleResult = await client.query(
            `SELECT tps.id, tps.installments
             FROM tuition_payment_schedules tps
             LEFT JOIN classes schedule_class ON schedule_class.id = tps.class_id
             WHERE tps.tenant_id = $1
               AND tps.academic_year_id = $2
               AND (
                 (tps.class_id IS NOT NULL AND schedule_class.programme_id = $3)
                 OR tps.class_id IS NULL
               )
             ORDER BY
               CASE WHEN tps.class_id IS NOT NULL THEN 0 ELSE 1 END,
               tps.is_active DESC,
               tps.created_at DESC
             LIMIT 1`,
            [request.tenantId, enrollment.academic_year_id, enrollment.programme_id]
          );

          if (scheduleResult.rows.length > 0) {
            const schedule = scheduleResult.rows[0];
            const scheduleInstallments = Array.isArray(schedule.installments) ? schedule.installments : [];

            if (scheduleInstallments.length > 0) {
              const tuples: string[] = [];
              const values: any[] = [];
              let p = 1;

              for (let i = 0; i < scheduleInstallments.length; i++) {
                const inst = scheduleInstallments[i];
                const percentage = Number(inst.percentage || 0);
                const rawAmount = (effectiveFees.scolarite * percentage) / 100;
                const amount = Math.round(rawAmount * 100) / 100;

                tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
                values.push(
                  request.tenantId,
                  studentId,
                  enrollment.enrollment_id,
                  schedule.id,
                  i + 1,
                  String(inst.label || `Echeance ${i + 1}`),
                  amount,
                  String(inst.dueDate).slice(0, 10)
                );
              }

              if (tuples.length > 0) {
                await client.query(
                  `INSERT INTO student_tuition_installments (
                    tenant_id, student_id, enrollment_id, schedule_id,
                    installment_number, installment_label, amount, due_date
                  ) VALUES ${tuples.join(", ")}
                  ON CONFLICT (tenant_id, enrollment_id, installment_number) DO NOTHING`,
                  values
                );
              }

              installmentsResult = await client.query(installmentsQuery, [
                studentId,
                enrollment.enrollment_id,
              ]);
            }
          }
        }

        // Get recent transactions
        const transactionsQuery = `
          SELECT *
          FROM payment_transactions
          WHERE student_id = $1 AND enrollment_id = $2
          ORDER BY created_at DESC
          LIMIT 10
        `;

        const transactionsResult = await client.query(transactionsQuery, [
          studentId,
          enrollment.enrollment_id,
        ]);

        // Calculate totals
        const totalFees = effectiveTotal;
        const totalPaid =
          (paidFees.inscription || 0) +
          (paidFees.annexes || 0) +
          (paidFees.autres || 0) +
          installmentsResult.rows.reduce((sum, inst) => sum + parseFloat(inst.amount_paid), 0);

        const summary = {
          studentId,
          studentName: enrollment.student_name,
          enrollmentId: enrollment.enrollment_id,
          totalFees,
          totalPaid,
          totalOutstanding: Math.max(0, totalFees - totalPaid),
          fees: {
            inscription: effectiveFees.inscription,
            scolarite: effectiveFees.scolarite,
            annexes: effectiveFees.annexes,
            autres: effectiveFees.autres,
            total: effectiveTotal,
          },
          immediateFeesStatus: {
            inscription: {
              amount: effectiveFees.inscription,
              paid: (paidFees.inscription || 0) >= effectiveFees.inscription,
              paidAmount: paidFees.inscription || 0,
            },
            annexes: {
              amount: effectiveFees.annexes,
              paid: (paidFees.annexes || 0) >= effectiveFees.annexes,
              paidAmount: paidFees.annexes || 0,
            },
            autres: {
              amount: effectiveFees.autres,
              paid: (paidFees.autres || 0) >= effectiveFees.autres,
              paidAmount: paidFees.autres || 0,
            },
          },
          tuitionInstallments: installmentsResult.rows.map(row => ({
            id: row.id,
            tenantId: row.tenant_id,
            studentId: row.student_id,
            enrollmentId: row.enrollment_id,
            scheduleId: row.schedule_id,
            installmentNumber: row.installment_number,
            installmentLabel: row.installment_label,
            amount: parseFloat(row.amount),
            dueDate: new Date(row.due_date),
            status: row.status,
            amountPaid: parseFloat(row.amount_paid),
            lateFee: parseFloat(row.late_fee),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
          })),
          recentTransactions: transactionsResult.rows.map(row => ({
            id: row.id,
            tenantId: row.tenant_id,
            studentId: row.student_id,
            enrollmentId: row.enrollment_id,
            tuitionInstallmentId: row.tuition_installment_id,
            feeType: row.fee_type,
            externalTransactionId: row.external_transaction_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            paymentMethod: row.payment_method,
            status: row.status,
            gatewayResponse: row.gateway_response,
            receiptUrl: row.receipt_url,
            processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
            createdBy: row.created_by,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
          })),
        };

        return reply.send({ data: summary });
      } catch (error) {
        console.error("Error fetching student payment summary:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch payment summary",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/student-payments/initiate - Initiate payment
  fastify.post("/initiate", {
    schema: {
      body: {
        type: "object",
        required: ["studentId", "enrollmentId", "feeType", "amount", "paymentMethod"],
        properties: {
          studentId: { type: "string", format: "uuid" },
          enrollmentId: { type: "string", format: "uuid" },
          feeType: {
            type: "string",
            enum: ["inscription", "scolarite", "annexes", "autres"]
          },
          amount: { type: "number", minimum: 0.01 },
          currency: { type: "string", minLength: 3, maxLength: 3, default: "XOF" },
          paymentMethod: {
            type: "string",
            enum: ["orange_money", "mtn_money", "moov_money", "card", "bank_transfer", "especes"]
          },
          tuitionInstallmentId: { type: "string", format: "uuid" },
          returnUrl: { type: "string", format: "uri" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                transactionId: { type: "string" },
                externalTransactionId: { type: "string" },
                paymentUrl: { type: "string" },
                amount: { type: "number" },
                currency: { type: "string" },
                status: { type: "string" },
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

      const paymentRequest = request.body as any;
      console.log('Payment initiate request:', {
        tenantId: request.tenantId,
        studentId: paymentRequest.studentId,
        enrollmentId: paymentRequest.enrollmentId,
        feeType: paymentRequest.feeType,
        amount: paymentRequest.amount,
        userId: request.user?.id
      });

      const client = await pool.connect();

      try {
        // Use set_config instead of SET for custom parameters
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Validate enrollment and get student info
        const studentQuery = `
          SELECT
            sp.id as student_id,
            u.first_name || ' ' || u.last_name as student_name,
            u.email,
            sp.phone,
            se.id as enrollment_id,
            se.fees,
            se.class_id,
            c.programme_id,
            p.cycle_id
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          JOIN student_enrollments se ON se.student_id = sp.id
          JOIN classes c ON c.id = se.class_id
          JOIN programmes p ON p.id = c.programme_id
          WHERE sp.id = $1 AND se.id = $2 AND se.status = 'active'
        `;

        const studentResult = await client.query(studentQuery, [
          paymentRequest.studentId,
          paymentRequest.enrollmentId,
        ]);

        console.log('Student query result:', studentResult.rows.length, 'rows');

        if (studentResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Student or enrollment not found",
          });
        }

        const student = studentResult.rows[0];

        // Validate payment amount using effective fees (enrollment fees + cycle/programme defaults)
        console.log('Validating payment amount:', paymentRequest.enrollmentId, paymentRequest.feeType, paymentRequest.amount);

        const rawFees = (student.fees && typeof student.fees === "object") ? student.fees : {};
        const cycleFeesResult = await client.query(
          `SELECT inscription, scolarite, annexes, autres
           FROM cycles_frais
           WHERE tenant_id = $1 AND cycle_id = $2 AND programme_id = $3
           ORDER BY created_at DESC
           LIMIT 1`,
          [request.tenantId, student.cycle_id, student.programme_id]
        );
        const defaultFees = cycleFeesResult.rows[0] || {};

        const pickFee = (value: any, fallback: any) => {
          const parsedValue = Number(value);
          if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue;
          const parsedFallback = Number(fallback);
          return Number.isFinite(parsedFallback) ? parsedFallback : 0;
        };

        const effectiveFees = {
          inscription: pickFee((rawFees as any).inscription, defaultFees.inscription),
          scolarite: pickFee((rawFees as any).scolarite ?? (rawFees as any).scolarité ?? (rawFees as any).SCOLARITE, defaultFees.scolarite),
          annexes: pickFee((rawFees as any).annexes, defaultFees.annexes),
          autres: pickFee((rawFees as any).autres, defaultFees.autres),
        } as Record<"inscription" | "scolarite" | "annexes" | "autres", number>;

        if (paymentRequest.feeType === "scolarite" && paymentRequest.tuitionInstallmentId) {
          const installmentRes = await client.query(
            `SELECT amount, amount_paid
             FROM student_tuition_installments
             WHERE id = $1 AND tenant_id = $2 AND enrollment_id = $3`,
            [paymentRequest.tuitionInstallmentId, request.tenantId, paymentRequest.enrollmentId]
          );

          if (installmentRes.rows.length === 0) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: "Échéance de scolarité introuvable pour cet étudiant.",
              errorCode: "INSTALLMENT_NOT_FOUND",
            });
          }

          const inst = installmentRes.rows[0];
          const configuredAmount = Number(inst.amount || 0);
          const paidAmount = Number(inst.amount_paid || 0);
          const outstanding = Math.max(0, configuredAmount - paidAmount);
          const requestedAmount = Number(paymentRequest.amount || 0);

          if (configuredAmount <= 0) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: "Les frais de scolarité ne sont pas configurés pour cette échéance.",
              errorCode: "FEE_NOT_CONFIGURED",
              details: { configuredAmount, paidAmount, outstanding, requestedAmount },
            });
          }

          if (outstanding <= 0) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: "Cette échéance de scolarité est déjà entièrement payée.",
              errorCode: "ALREADY_FULLY_PAID",
              details: { configuredAmount, paidAmount, outstanding, requestedAmount },
            });
          }

          if (requestedAmount > outstanding) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: "Le montant demandé dépasse le restant à payer de cette échéance.",
              errorCode: "AMOUNT_EXCEEDS_OUTSTANDING",
              details: { configuredAmount, paidAmount, outstanding, requestedAmount },
            });
          }
        } else {
          const feeType = paymentRequest.feeType as "inscription" | "scolarite" | "annexes" | "autres";
          const configuredAmount = Number(effectiveFees[feeType] || 0);
          const requestedAmount = Number(paymentRequest.amount || 0);

          const paidRes = await client.query(
            `SELECT COALESCE(SUM(amount), 0) as paid_amount
             FROM payment_transactions
             WHERE tenant_id = $1
               AND enrollment_id = $2
               AND fee_type = $3
               AND status = 'completed'`,
            [request.tenantId, paymentRequest.enrollmentId, feeType]
          );
          const paidAmount = Number(paidRes.rows[0]?.paid_amount || 0);
          const outstanding = Math.max(0, configuredAmount - paidAmount);

          if (configuredAmount <= 0) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: `Les frais de type "${feeType}" ne sont pas configurés pour cet étudiant.`,
              errorCode: "FEE_NOT_CONFIGURED",
              details: { configuredAmount, paidAmount, outstanding, requestedAmount },
            });
          }

          if (outstanding <= 0) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: `Les frais de type "${feeType}" sont déjà entièrement payés.`,
              errorCode: "ALREADY_FULLY_PAID",
              details: { configuredAmount, paidAmount, outstanding, requestedAmount },
            });
          }

          if (requestedAmount > outstanding) {
            return reply.status(400).send({
              error: "Invalid Amount",
              message: "Le montant demandé dépasse le restant à payer.",
              errorCode: "AMOUNT_EXCEEDS_OUTSTANDING",
              details: { configuredAmount, paidAmount, outstanding, requestedAmount },
            });
          }
        }

        // Create payment transaction record as completed
        const transactionId = crypto.randomUUID();
        console.log('Creating completed payment transaction with ID:', transactionId);

        const insertQuery = `
          INSERT INTO payment_transactions (
            id, tenant_id, student_id, enrollment_id, tuition_installment_id,
            fee_type, amount, currency, payment_method, status, processed_at, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::transaction_status, NOW(), $11)
          RETURNING id, created_at
        `;

        const insertParams = [
          transactionId,
          request.tenantId,
          paymentRequest.studentId,
          paymentRequest.enrollmentId,
          paymentRequest.tuitionInstallmentId || null,
          paymentRequest.feeType,
          paymentRequest.amount,
          paymentRequest.currency,
          paymentRequest.paymentMethod,
          'completed', // Payment is immediately completed
          request.user?.id || null,
        ];

        console.log('Insert params:', insertParams);
        const insertResult = await client.query(insertQuery, insertParams);

        // Return success response
        const paymentResponse = {
          transactionId: transactionId,
          status: 'completed',
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          paymentMethod: paymentRequest.paymentMethod,
          processedAt: insertResult.rows[0].created_at,
          message: 'Payment recorded successfully'
        };

        return reply.send({ data: paymentResponse });
      } catch (error) {
        console.error("Error initiating payment:", error);
        console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to initiate payment",
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/student-payments/verify/:transactionId - Verify payment
  fastify.post("/verify/:transactionId", {
    schema: {
      params: {
        type: "object",
        required: ["transactionId"],
        properties: {
          transactionId: { type: "string", format: "uuid" },
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

      const { transactionId } = request.params as { transactionId: string };
      const client = await pool.connect();

      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Get transaction details
        const transactionQuery = `
          SELECT * FROM payment_transactions
          WHERE id = $1 AND tenant_id = $2
        `;

        const transactionResult = await client.query(transactionQuery, [
          transactionId,
          request.tenantId,
        ]);

        if (transactionResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Transaction not found",
          });
        }

        const transaction = transactionResult.rows[0];

        if (!transaction.external_transaction_id) {
          return reply.status(400).send({
            error: "Invalid Transaction",
            message: "Transaction has no external ID for verification",
          });
        }

        // Verify with payment gateway
        const gatewayService = createTresorPayService(request.tenantId);
        const verificationResult = await gatewayService.verifyPayment(
          transaction.external_transaction_id
        );

        // Update transaction status
        const updateQuery = `
          UPDATE payment_transactions
          SET
            status = $1::transaction_status,
            gateway_response = $2,
            processed_at = $3,
            updated_at = NOW()
          WHERE id = $4
          RETURNING *
        `;

        const updatedResult = await client.query(updateQuery, [
          verificationResult.status,
          JSON.stringify(verificationResult.gatewayResponse),
          verificationResult.processedAt,
          transactionId,
        ]);

        return reply.send({
          data: {
            transactionId,
            status: verificationResult.status,
            amount: verificationResult.amount,
            currency: verificationResult.currency,
            paymentMethod: verificationResult.paymentMethod,
            processedAt: verificationResult.processedAt,
          }
        });
      } catch (error) {
        console.error("Error verifying payment:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to verify payment",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/student-payments/webhook - Handle payment webhook
  fastify.post("/webhook", {
    schema: {
      body: {
        type: "object",
        // Don't validate webhook body structure as it comes from external service
      },
    },
    handler: async (request, reply) => {
      const signature = request.headers['x-signature'] as string;
      const payload = JSON.stringify(request.body);

      if (!signature) {
        return reply.status(400).send({
          error: "Missing Signature",
          message: "Webhook signature is required",
        });
      }

      const client = await pool.connect();

      try {
        // Verify webhook signature (using default tenant for webhook verification)
        const gatewayService = createTresorPayService();
        const isValidSignature = gatewayService.verifyWebhookSignature(payload, signature);

        if (!isValidSignature) {
          return reply.status(401).send({
            error: "Invalid Signature",
            message: "Webhook signature verification failed",
          });
        }

        // Parse webhook payload
        const webhookData = gatewayService.parseWebhookPayload(request.body);

        // Find transaction by external ID
        const transactionQuery = `
          SELECT * FROM payment_transactions
          WHERE external_transaction_id = $1
        `;

        const transactionResult = await client.query(transactionQuery, [
          webhookData.externalTransactionId,
        ]);

        if (transactionResult.rows.length === 0) {
          console.warn(`Webhook received for unknown transaction: ${webhookData.externalTransactionId}`);
          return reply.status(200).send({ message: "Transaction not found, but webhook acknowledged" });
        }

        const transaction = transactionResult.rows[0];

        // Set tenant context for the transaction
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [transaction.tenant_id]);

        // Update transaction status
        const updateQuery = `
          UPDATE payment_transactions
          SET
            status = $1::transaction_status,
            gateway_response = $2,
            processed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE processed_at END,
            updated_at = NOW()
          WHERE external_transaction_id = $3
          RETURNING *
        `;

        const updatedResult = await client.query(updateQuery, [
          webhookData.status,
          JSON.stringify(webhookData.gatewayResponse),
          webhookData.externalTransactionId,
        ]);

        // If payment completed, trigger receipt generation and notifications
        if (webhookData.status === 'completed') {
          // TODO: Trigger receipt generation
          // TODO: Send payment confirmation notification
          console.log(`Payment completed for transaction: ${transaction.id}`);
        }

        return reply.status(200).send({ message: "Webhook processed successfully" });
      } catch (error) {
        console.error("Error processing webhook:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to process webhook",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/student-payments/:studentId/transactions - Get payment history
  fastify.get("/:studentId/transactions", {
    schema: {
      params: {
        type: "object",
        required: ["studentId"],
        properties: {
          studentId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          feeType: { type: "string", enum: ["inscription", "scolarite", "annexes", "autres"] },
          status: { type: "string", enum: ["pending", "processing", "completed", "failed", "cancelled", "refunded"] },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          offset: { type: "number", minimum: 0, default: 0 },
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

      const { studentId } = request.params as { studentId: string };
      const { feeType, status, limit = 20, offset = 0 } = request.query as any;
      const client = await pool.connect();

      try {
        await client.query("SET app.tenant_id = $1", [request.tenantId]);

        let whereConditions = ["student_id = $1"];
        let queryParams: any[] = [studentId];
        let paramIndex = 2;

        if (feeType) {
          whereConditions.push(`fee_type = $${paramIndex}`);
          queryParams.push(feeType);
          paramIndex++;
        }

        if (status) {
          whereConditions.push(`status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        const transactionsQuery = `
          SELECT *
          FROM payment_transactions
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);

        const transactionsResult = await client.query(transactionsQuery, queryParams);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM payment_transactions
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await client.query(countQuery, queryParams.slice(0, -2));

        const transactions = transactionsResult.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          studentId: row.student_id,
          enrollmentId: row.enrollment_id,
          tuitionInstallmentId: row.tuition_installment_id,
          feeType: row.fee_type,
          externalTransactionId: row.external_transaction_id,
          amount: parseFloat(row.amount),
          currency: row.currency,
          paymentMethod: row.payment_method,
          status: row.status,
          gatewayResponse: row.gateway_response,
          receiptUrl: row.receipt_url,
          processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }));

        return reply.send({
          data: transactions,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + limit < parseInt(countResult.rows[0].total),
          },
        });
      } catch (error) {
        console.error("Error fetching payment transactions:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch payment transactions",
        });
      } finally {
        client.release();
      }
    },
  });
}
