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
import { TeacherPayslipService } from "../services/teacher-payslip.service.js";
import { TeacherPayslipNotificationService } from "../services/teacher-payslip-notification.service.js";

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
          status: { type: "string", enum: ["calculated", "approved", "paid", "disputed", "cancelled", "unpaid"] },
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

        // Détail horaire, via la vue enrichie : elle résout le libellé de
        // l'origine (ECUE + cohorte, ou cours) sans dupliquer la jointure ici.
        // L'ancienne requête ne joignait que `teaching_hours`, table que le
        // calculateur n'alimente pas — elle renvoyait donc des libellés vides.
        let hourDetails = [];
        try {
          const hourDetailsResult = await client.query(
            `SELECT id, source, teaching_hours_id, attendance_session_id, seance_id,
                    hours_count, hourly_rate, amount, is_overtime, created_at,
                    session_date, intitule, code, cohorte_libelle
             FROM v_payment_hour_details_enriched
             WHERE payment_id = $1
             ORDER BY session_date NULLS LAST, created_at`,
            [id]
          );

          hourDetails = hourDetailsResult.rows
            .filter(hd => hd.id)
            .map(hd => ({
              id: hd.id,
              source: hd.source,
              teachingHoursId: hd.teaching_hours_id,
              attendanceSessionId: hd.attendance_session_id,
              seanceId: hd.seance_id,
              hoursCount: parseFloat(hd.hours_count || '0'),
              // Figés au calcul : jamais recalculés à la lecture (FR-023).
              hourlyRate: parseFloat(hd.hourly_rate || '0'),
              amount: parseFloat(hd.amount || '0'),
              isOvertime: hd.is_overtime || false,
              sessionDate: hd.session_date,
              intitule: hd.intitule,
              code: hd.code,
              cohorteLibelle: hd.cohorte_libelle,
              // Conservé pour les consommateurs existants du champ.
              courseTitle: hd.intitule || 'N/A',
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


  /**
   * POST /api/v1/teacher-payments — NEUTRALISÉ (feature 031).
   *
   * Cet endpoint créait un paiement à partir de montants fournis par l'appelant,
   * SANS écrire la moindre ligne dans payment_hour_details. Le bulletin
   * affichait donc un total que rien ne justifiait : impossible à contrôler,
   * impossible à contester.
   *
   * Il reste déclaré plutôt que supprimé pour répondre 410 avec une explication,
   * là où un 404 laisserait un appelant externe deviner. Le chemin correct est
   * POST /calculate, qui écrit le paiement ET sa justification ligne à ligne,
   * puis PATCH /:id/adjustments pour les primes et retenues.
   */
  fastify.post("/", {
    handler: async (_request, reply) => {
      return reply.status(410).send({
        error: "Gone",
        message:
          "Cet endpoint est retiré : il créait un paiement sans détail horaire, donc sans justification. " +
          "Utilisez POST /api/v1/teacher-payments/calculate (écrit le paiement et son détail), " +
          "puis PATCH /api/v1/teacher-payments/:id/adjustments pour les primes et retenues.",
        replacement: {
          calculate: "POST /api/v1/teacher-payments/calculate",
          adjustments: "PATCH /api/v1/teacher-payments/:id/adjustments",
        },
      });
    },
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
          // Périmètre de collecte. Absent = "all" : un appel existant inclut
          // désormais les heures professionnelles (feature 031).
          scope: { type: "string", enum: ["all", "academique", "professionnel"], default: "all" },
          // Aperçu : calcule sans persister.
          dryRun: { type: "boolean", default: false },
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
                      currency: { type: "string" },
                      paymentType: { type: "string" },
                      baseAmount: { type: "number" },
                      overtimeAmount: { type: "number" },
                      bonusAmount: { type: "number" },
                      deductions: { type: "number" },
                      regularHours: { type: "number" },
                      overtimeHours: { type: "number" },
                      totalHours: { type: "number" },
                      // Motif d'exclusion : sans lui, un enseignant non payé est
                      // indiscernable d'un enseignant absent du périmètre.
                      skipReason: { type: "string" },
                      message: { type: "string" },
                      hoursBySource: {
                        type: "object",
                        properties: {
                          academique: { type: "number" },
                          professionnel: { type: "number" },
                        },
                      },
                      // Renseigné en mode aperçu : permet à l'écran d'afficher
                      // le détail ligne à ligne avant validation.
                      hourDetails: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            source: { type: "string" },
                            sessionDate: { type: "string" },
                            intitule: { type: "string" },
                            code: { type: "string" },
                            hoursCount: { type: "number" },
                            hourlyRate: { type: "number" },
                            amount: { type: "number" },
                            isOvertime: { type: "boolean" },
                            seanceId: { type: "string" },
                            attendanceSessionId: { type: "string" },
                          },
                        },
                      },
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
        // Année académique facultative : les périodes de paie n'y sont plus
        // rattachées obligatoirement.
        const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
        void activeAcademicYearId;
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
          `SELECT status FROM payment_periods WHERE id = $1 AND tenant_id = $2`,
          [data.periodId, request.tenantId]
        );

        if (periodResult.rows.length === 0) {
          return reply.status(400).send({
            error: "Period Not Found",
            message: "Payment period not found",
          });
        }

        // ---------------------------------------------------------------
        // PÉRIMÈTRE DE LA PÉRIODE (feature 031).
        //
        // Une période ciblée ne doit produire de bulletins QUE pour les
        // enseignants qu'elle vise. Sans ce filtre, ouvrir une période pour
        // trois vacataires calculerait les trente — et l'écran l'annoncerait
        // comme une régularisation ciblée.
        //
        // Quand l'appelant fournit déjà `teacherIds`, on INTERSECTE plutôt que
        // de remplacer : le périmètre de la période est une borne, pas un
        // élargissement.
        // ---------------------------------------------------------------
        const perimetre = await client.query(
          `SELECT teacher_id FROM payment_period_teachers
            WHERE payment_period_id = $1 AND tenant_id = $2`,
          [data.periodId, request.tenantId]
        );

        if (perimetre.rows.length > 0) {
          const cibles = perimetre.rows.map((r: any) => r.teacher_id as string);
          data.teacherIds = data.teacherIds?.length
            ? data.teacherIds.filter((id: string) => cibles.includes(id))
            : cibles;

          if (data.teacherIds.length === 0) {
            return reply.status(400).send({
              error: "Empty Scope",
              message:
                "Aucun enseignant commun entre la demande et le périmètre de la période.",
            });
          }
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

        // Devise de l'établissement : le défaut de colonne ne suffit pas quand
        // la base a été construite depuis la variante 'EUR' de la migration 0011.
        let tenantCurrency = "XOF";
        try {
          const devise = await client.query(
            `SELECT devise FROM professional_ue
             WHERE tenant_id = $1 AND devise IS NOT NULL
             GROUP BY devise ORDER BY count(*) DESC LIMIT 1`,
            [request.tenantId]
          );
          if (devise.rows.length > 0 && devise.rows[0].devise) {
            tenantCurrency = devise.rows[0].devise;
          }
        } catch {
          // Le module professionnel peut ne pas être déployé : XOF reste le défaut.
        }

        // Calculate payments
        fastify.log.info(`Starting batch payment calculation for period ${data.periodId}, teachers: ${data.teacherIds?.length || 'all'}, scope: ${data.scope}`);
        const outcome = await paymentCalculator.calculateBatchPayments(
          request.tenantId,
          data.periodId,
          data.teacherIds,
          data.scope
        );
        const calculations = outcome.results;
        fastify.log.info(
          `Batch calculation returned ${calculations.length} result(s), ${outcome.skipped.length} skipped`
        );

        let calculated = 0;
        let skipped = 0;
        let errors = 0;
        const results: any[] = [];

        // Les enseignants écartés par le calculateur figurent dans le compte
        // rendu avec leur motif : les omettre laisserait croire qu'ils ont été
        // traités (FR-026).
        for (const s of outcome.skipped) {
          skipped++;
          results.push({
            teacherId: s.teacherId,
            teacherName: s.teacherName,
            status: "skipped",
            skipReason: s.skipReason,
            message: s.message,
          });
        }

        // Mode aperçu : on renvoie le résultat du moteur sans rien écrire.
        // C'est ce qui permet à l'écran de montrer un montant AVANT validation
        // en s'appuyant sur le même calcul que la validation elle-même.
        if (data.dryRun) {
          for (const calc of calculations) {
            calculated++;
            results.push({
              teacherId: calc.teacherId,
              teacherName: calc.teacherName,
              status: "preview",
              totalAmount: calc.totalAmount,
              currency: tenantCurrency,
              paymentType: calc.paymentType,
              baseAmount: calc.baseAmount,
              overtimeAmount: calc.overtimeAmount,
              bonusAmount: calc.bonusAmount,
              deductions: calc.deductions,
              regularHours: calc.calculationDetails.regularHours,
              overtimeHours: calc.calculationDetails.overtimeHours,
              totalHours:
                calc.calculationDetails.regularHours + calc.calculationDetails.overtimeHours,
              hoursBySource: calc.hoursBySource,
              hourDetails: calc.hourDetails,
            });
          }
          return { data: { calculated, skipped, errors, results } };
        }

        for (const calc of calculations) {
          try {
            // Check if payment already exists
            const existingResult = await client.query(
              // Recherche SANS le type de paiement : un enseignant n'a qu'UN
              // bulletin par période. Chercher aussi sur `payment_type` créait
              // un second bulletin dès qu'une configuration passait d'horaire à
              // salarié en cours de période — l'ancien restait, le nouveau
              // s'ajoutait, et payer les deux payait l'enseignant deux fois.
              `SELECT id, status::text AS status, payment_type::text AS payment_type
               FROM teacher_payments
               WHERE tenant_id = $1 AND teacher_id = $2 AND payment_period_id = $3`,
              [request.tenantId, calc.teacherId, data.periodId]
            );

            const existing = existingResult.rows[0];

            // Un paiement approuvé, payé ou annulé n'est JAMAIS écrasé par un
            // recalcul : il a déjà engagé l'établissement (FR-025).
            if (existing && ["approved", "paid", "cancelled"].includes(existing.status)) {
              skipped++;
              results.push({
                teacherId: calc.teacherId,
                teacherName: calc.teacherName,
                status: "skipped",
                skipReason: "PAYMENT_LOCKED",
                paymentId: existing.id,
                paymentType: calc.paymentType,
                message: `Paiement au statut « ${existing.status} » : non recalculé.`,
              });
              continue;
            }

            if (existing && !data.recalculate) {
              skipped++;
              results.push({
                teacherId: calc.teacherId,
                teacherName: calc.teacherName,
                status: "skipped",
                paymentId: existing.id,
                totalAmount: 0,
                paymentType: calc.paymentType,
                baseAmount: calc.baseAmount,
                overtimeAmount: calc.overtimeAmount,
                bonusAmount: calc.bonusAmount,
                deductions: calc.deductions,
                regularHours: calc.calculationDetails.regularHours,
                overtimeHours: calc.calculationDetails.overtimeHours,
                totalHours: calc.calculationDetails.regularHours + calc.calculationDetails.overtimeHours,
                hoursBySource: calc.hoursBySource,
                error: "Payment already exists",
              });
              continue;
            }

            // Begin transaction for this payment
            await client.query('BEGIN');

            let paymentId;
            if (existing) {
              // Update existing payment
              const updateResult = await client.query(
                // `payment_type` fait partie de la mise à jour : quand la
                // configuration passe d'horaire à salarié, le bulletin existant
                // CHANGE de type au lieu qu'un second soit créé à côté.
                `UPDATE teacher_payments
                SET payment_type = $9::payment_type,
                    base_amount = $1, overtime_amount = $2, bonus_amount = $3,
                    deductions = $4, total_amount = $5, calculation_details = $6,
                    currency = $8,
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
                  existing.id,
                  tenantCurrency,
                  calc.paymentType,
                ]
              );
              paymentId = updateResult.rows[0].id;

              // Le détail est reconstruit intégralement : un recalcul qui
              // ajouterait des lignes sans purger les anciennes doublerait les
              // heures affichées sur le bulletin (FR-024).
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
                 calculation_details, created_by, currency)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
                  tenantCurrency,
                ]
              );
              paymentId = insertResult.rows[0].id;
            }

            // Détail horaire : chaque ligne porte son origine et la référence
            // qui la justifie. `hours_count` et `hourly_rate` sont FIGÉS ici —
            // une révision de tarif ne doit pas altérer un paiement existant.
            for (const hourDetail of calc.hourDetails) {
              await client.query(
                `INSERT INTO payment_hour_details
                (tenant_id, payment_id, source, teaching_hours_id, attendance_session_id,
                 seance_id, hours_count, hourly_rate, amount, is_overtime)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                  request.tenantId,
                  paymentId,
                  hourDetail.source,
                  hourDetail.teachingHoursId,
                  hourDetail.attendanceSessionId,
                  hourDetail.seanceId,
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
              teacherName: calc.teacherName,
              status: "calculated",
              paymentId,
              totalAmount: calc.totalAmount,
              currency: tenantCurrency,
              paymentType: calc.paymentType,
              baseAmount: calc.baseAmount,
              overtimeAmount: calc.overtimeAmount,
              bonusAmount: calc.bonusAmount,
              deductions: calc.deductions,
              regularHours: calc.calculationDetails.regularHours,
              overtimeHours: calc.calculationDetails.overtimeHours,
              totalHours: calc.calculationDetails.regularHours + calc.calculationDetails.overtimeHours,
              hoursBySource: calc.hoursBySource,
            });
          } catch (error) {
            await client.query('ROLLBACK');
            errors++;
            fastify.log.error(`Error saving payment for teacher ${calc.teacherId}:`, error);

            results.push({
              teacherId: calc.teacherId,
              teacherName: calc.teacherName,
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
            // Les paramètres sont propres à CHAQUE action. Un jeu commun de
            // quatre valeurs laissait `$1` (l'utilisateur) non référencé par
            // « mark_paid », « reject » et « cancel » : PostgreSQL ne peut pas
            // inférer le type d'un paramètre inutilisé et rejetait la requête
            // (« n'a pas pu déterminer le type de données du paramètre $1 »).
            // Ces trois actions échouaient donc systématiquement, en silence —
            // la réponse restait 200 avec `processed: 0`.
            let params: unknown[] = [];

            switch (data.action) {
              case "approve":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'approved', approved_by = $1, approved_at = NOW(),
                      notes = COALESCE($2, notes), updated_at = NOW()
                  WHERE id = $3 AND tenant_id = $4 AND status = 'calculated'
                `;
                params = [request.userId, data.notes, paymentId, request.tenantId];
                break;
              case "reject":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'disputed', notes = COALESCE($1::text, notes), updated_at = NOW()
                  WHERE id = $2 AND tenant_id = $3 AND status IN ('calculated', 'approved')
                `;
                params = [data.notes, paymentId, request.tenantId];
                break;
              case "mark_paid":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'paid', paid_at = NOW(),
                      notes = COALESCE($1::text, notes), updated_at = NOW()
                  WHERE id = $2 AND tenant_id = $3 AND status = 'approved'
                `;
                params = [data.notes, paymentId, request.tenantId];
                break;
              case "cancel":
                updateQuery = `
                  UPDATE teacher_payments
                  SET status = 'cancelled', notes = COALESCE($1::text, notes), updated_at = NOW()
                  WHERE id = $2 AND tenant_id = $3 AND status IN ('calculated', 'approved')
                `;
                params = [data.notes, paymentId, request.tenantId];
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
  /**
   * PATCH /api/v1/teacher-payments/:id/adjustments
   *
   * Primes, retenues et, au besoin, correction du montant de base — les seules
   * valeurs que la spec prévoit de saisir à la main. Le TOTAL n'est jamais
   * accepté du client : il est recalculé ici à partir de ses composantes, sinon
   * rien ne garantit qu'il corresponde à ce que le détail justifie.
   *
   * Refusé sur un paiement approuvé ou payé : les ajuster reviendrait à modifier
   * un montant déjà engagé.
   */
  fastify.patch("/:id/adjustments", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", format: "uuid" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          baseAmount: { type: "number", minimum: 0 },
          bonusAmount: { type: "number", minimum: 0 },
          deductions: { type: "number", minimum: 0 },
          notes: { type: "string" },
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
      const body = request.body as {
        baseAmount?: number;
        bonusAmount?: number;
        deductions?: number;
        notes?: string;
      };

      const client = await fastify.pg.connect();
      try {
        const current = await client.query(
          `SELECT status::text AS status, base_amount, overtime_amount
           FROM teacher_payments WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        if (current.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Paiement introuvable." });
        }
        if (["approved", "paid", "cancelled"].includes(current.rows[0].status)) {
          return reply.status(409).send({
            error: "Payment Locked",
            message: `Paiement au statut « ${current.rows[0].status} » : ses montants ne sont plus modifiables.`,
          });
        }

        const base =
          body.baseAmount !== undefined
            ? body.baseAmount
            : parseFloat(current.rows[0].base_amount);
        const overtime = parseFloat(current.rows[0].overtime_amount) || 0;
        const bonus = body.bonusAmount ?? 0;
        const deductions = body.deductions ?? 0;
        const total = base + overtime + bonus - deductions;

        if (total < 0) {
          return reply.status(400).send({
            error: "Invalid Amounts",
            message: "Les retenues dépassent le montant dû.",
          });
        }

        const updated = await client.query(
          `UPDATE teacher_payments
           SET base_amount = $1, bonus_amount = $2, deductions = $3,
               total_amount = $4, notes = COALESCE($5, notes), updated_at = NOW()
           WHERE id = $6 AND tenant_id = $7
           RETURNING id, base_amount, overtime_amount, bonus_amount, deductions, total_amount`,
          [base, bonus, deductions, total, body.notes ?? null, id, request.tenantId]
        );

        const r = updated.rows[0];
        return {
          data: {
            id: r.id,
            baseAmount: parseFloat(r.base_amount),
            overtimeAmount: parseFloat(r.overtime_amount),
            bonusAmount: parseFloat(r.bonus_amount),
            deductions: parseFloat(r.deductions),
            totalAmount: parseFloat(r.total_amount),
          },
        };
      } catch (error) {
        fastify.log.error("Error adjusting payment:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Ajustement impossible",
        });
      } finally {
        client.release();
      }
    },
  });

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

/**
 * Bulletin de paie — feature 031.
 *
 * Ces routes sont enregistrees a part pour ne pas alourdir davantage le
 * fichier principal, mais restent montees sous le meme prefixe
 * (`/api/v1/teacher-payments`) : le bulletin est un attribut du paiement, pas
 * une ressource independante.
 */
export async function teacherPayslipRoutes(fastify: FastifyInstance) {
  const payslips = new TeacherPayslipService(fastify.pg as any);
  const notifications = new TeacherPayslipNotificationService();

  const ROLES_COMPTABLES = ["admin", "super_admin", "administrateur", "owner"];

  /**
   * Qui peut lire un bulletin de paie.
   *
   * Ces routes n'avaient AUCUN contrôle d'appelant : tout compte connecté du tenant
   * (étudiant, parent, autre enseignant) obtenait le bulletin de n'importe qui en
   * connaissant l'identifiant du paiement. La gestion (administrateur, propriétaire)
   * lit tout ; tout autre rôle ne lit que ses propres bulletins.
   */
  async function peutLireBulletin(request: any, reply: any, paymentId: string): Promise<boolean> {
    const user = request.user;
    if (!user?.id) {
      await reply.status(401).send({ success: false, error: "UNAUTHORIZED", message: "Connexion requise." });
      return false;
    }
    const roles: string[] = (user.roles ?? [user.role]).filter(Boolean).map((r: string) => String(r).toLowerCase());
    if (roles.some((r) => ROLES_COMPTABLES.includes(r))) return true;
    if (await payslips.appartientA(request.tenantId as string, paymentId, user.id as string)) return true;
    await reply
      .status(403)
      .send({ success: false, error: "FORBIDDEN", message: "Ce bulletin n'est pas le vôtre." });
    return false;
  }

  /**
   * Donnees du bulletin en JSON, pour un rendu PDF cote navigateur.
   *
   * La voie serveur (`/payslip.pdf`, ci-dessous) passe par Puppeteer : elle
   * renvoyait un 504 Gateway Time-out en production, Chromium et Puppeteer
   * n'etant pas de versions compatibles. Les bulletins de notes n'ont jamais eu
   * ce probleme parce qu'ils sont composes dans le navigateur avec jsPDF
   * (apps/web/src/lib/bulletin-pdf.ts) : aucun navigateur headless, aucun
   * delai d'expiration a franchir.
   *
   * Cet endpoint sert le meme `PayslipData` que celui remis au gabarit HTML —
   * la mise en page seule change de camp.
   */
  fastify.get("/:id/payslip-data", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await peutLireBulletin(request, reply, id))) return reply;
    const result = await payslips.getPayslipData(request.tenantId as string, id);
    if (!result.success) {
      const failure = result as { error: string; message?: string };
      return reply
        .status(failure.error === "PAYMENT_NOT_FOUND" ? 404 : 500)
        .send({ success: false, error: failure.error, message: failure.message });
    }
    return reply.send({ success: true, data: result.data });
  });

  /** Bulletin au format PDF, pret a etre telecharge ou archive. */
  fastify.get("/:id/payslip.pdf", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await peutLireBulletin(request, reply, id))) return reply;
    const result = await payslips.generatePdf(request.tenantId as string, id);
    if (!result.success) {
      const failure = result as { error: string; message?: string };
      return reply
        .status(failure.error === "PAYMENT_NOT_FOUND" ? 404 : 500)
        .send({ success: false, error: failure.error, message: failure.message });
    }

    // `inline` plutot que `attachment` : le bulletin se consulte le plus
    // souvent d'un coup d'oeil, le telechargement reste a un clic.
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="bulletin-paie-${id.slice(0, 8)}.pdf"`)
      .send(result.data);
  });

  /** Envoie le bulletin a l'enseignant par courriel, en piece jointe. */
  fastify.post("/:id/notify", async (request, reply) => {
    const { id } = request.params as { id: string };

    // L'envoi par courriel est un acte de gestion : jamais depuis un compte enseignant.
    const rolesAppelant: string[] = ((request as any).user?.roles ?? []).map((r: string) => String(r).toLowerCase());
    if (!rolesAppelant.some((r) => ROLES_COMPTABLES.includes(r))) {
      return reply
        .status(403)
        .send({ success: false, error: "FORBIDDEN", message: "Réservé à la gestion." });
    }

    const donnees = await payslips.getPayslipData(request.tenantId as string, id);
    if (!donnees.success) {
      const failure = donnees as { error: string; message?: string };
      return reply
        .status(failure.error === "PAYMENT_NOT_FOUND" ? 404 : 500)
        .send({ success: false, error: failure.error, message: failure.message });
    }

    const pdf = await payslips.generatePdf(request.tenantId as string, id);
    if (!pdf.success) {
      return reply.status(500).send({ success: false, error: "PDF_GENERATION_FAILED" });
    }

    const envoi = await notifications.notifier(donnees.data, pdf.data);
    // Un echec d'envoi n'est pas une erreur serveur : le bulletin existe. On
    // renvoie 200 avec le motif, a charge de l'appelant de le signaler.
    return reply.send({ success: true, data: envoi });
  });
}
