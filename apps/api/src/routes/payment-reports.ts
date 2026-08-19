import { FastifyInstance } from "fastify";
import { 
  PaymentReportQuerySchema,
  PaymentReportSchema,
  PaymentSummarySchema,
  TeacherPaymentSummarySchema
} from "@ecoledigitale/contracts/src/payments";

export async function paymentReportsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/payment-reports/summary - Payment summary report
  fastify.get("/summary", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          periodId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          courseId: { type: "string", format: "uuid" },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
          groupBy: { type: "string", enum: ["teacher", "course", "period", "month"], default: "teacher" },
          includeDetails: { type: "boolean", default: false },
          // Filtre d'origine (feature 031). S'applique au DÉTAIL horaire : un
          // paiement mixte apparaît dans les deux filtres, avec des montants
          // partiels.
          source: { type: "string", enum: ["all", "academique", "professionnel"], default: "all" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                summary: {
                  type: "object",
                  properties: {
                    totalPayments: { type: "number" },
                    totalAmount: { type: "number" },
                    pendingApprovals: { type: "number" },
                    pendingPayments: { type: "number" },
                    byStatus: { type: "object" },
                    byType: { type: "object" },
                    // Ventilation par origine (feature 031). `nonVentile`
                    // recueille ce qui n'est rattaché à aucune heure — les
                    // salaires, qui ne dépendent pas des séances. Sans ce
                    // troisième poste, académique + professionnel ne
                    // retomberait pas sur le total et l'écart serait
                    // inexplicable pour le gestionnaire.
                    bySource: {
                      type: "object",
                      properties: {
                        academique: { type: "number" },
                        professionnel: { type: "number" },
                        nonVentile: { type: "number" },
                      },
                    },
                  },
                },
                details: { type: "array" },
                period: { type: "object" },
                generatedAt: { type: "string" },
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

      const query = PaymentReportQuerySchema.parse(request.query);
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause for filtering
        let whereClause = "WHERE tp.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.periodId) {
          whereClause += ` AND tp.payment_period_id = $${paramIndex}`;
          params.push(query.periodId);
          paramIndex++;
        }

        if (query.teacherId) {
          whereClause += ` AND tp.teacher_id = $${paramIndex}`;
          params.push(query.teacherId);
          paramIndex++;
        }

        if (query.courseId) {
          // Repointé sur `attendance_session_id` : le calculateur n'alimente
          // pas `teaching_hours_id`, donc l'ancienne jointure ne remontait
          // jamais aucun paiement (écart E4).
          whereClause += ` AND EXISTS (
            SELECT 1 FROM payment_hour_details phd
            JOIN teacher_attendance_sessions tas ON tas.id = phd.attendance_session_id
            JOIN class_courses cc ON cc.id = tas.class_course_id
            WHERE phd.payment_id = tp.id AND cc.course_id = $${paramIndex}
          )`;
          params.push(query.courseId);
          paramIndex++;
        }

        // Filtre d'origine : ne retient que les paiements comportant au moins
        // une heure de cette origine. Le montant affiché reste ventilé par
        // `bySource` — un paiement mixte apparaît dans les deux filtres.
        if (query.source && query.source !== "all") {
          whereClause += ` AND EXISTS (
            SELECT 1 FROM payment_hour_details phd
            WHERE phd.payment_id = tp.id AND phd.source = $${paramIndex}
          )`;
          params.push(query.source);
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

        if (activeAcademicYearId) {
          whereClause += ` AND tp.payment_period_id IN (
            SELECT id FROM payment_periods WHERE tenant_id = $1 AND academic_year_id = $${paramIndex}
          )`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        // Get summary statistics
        const summaryResult = await client.query(
          `SELECT 
            COUNT(*) as total_payments,
            COALESCE(SUM(tp.total_amount), 0) as total_amount,
            COUNT(*) FILTER (WHERE tp.status = 'calculated') as pending_approvals,
            COUNT(*) FILTER (WHERE tp.status = 'approved') as pending_payments
          FROM teacher_payments tp
          ${whereClause}`,
          params
        );

        // Get breakdown by status
        const statusResult = await client.query(
          `SELECT tp.status, COUNT(*) as count, COALESCE(SUM(tp.total_amount), 0) as amount
          FROM teacher_payments tp
          ${whereClause}
          GROUP BY tp.status`,
          params
        );

        // Get breakdown by type
        const typeResult = await client.query(
          `SELECT tp.payment_type, COUNT(*) as count, COALESCE(SUM(tp.total_amount), 0) as amount
          FROM teacher_payments tp
          ${whereClause}
          GROUP BY tp.payment_type`,
          params
        );

        // Ventilation par origine (feature 031). Elle se lit sur le DÉTAIL
        // horaire, pas sur le paiement : un bulletin mixte contribue aux deux
        // origines. Ce qui n'a aucune ligne de détail — typiquement un salaire —
        // ne relève d'aucune origine et forme le troisième poste.
        const bySourceResult = await client.query(
          `SELECT
             COALESCE(SUM(phd.amount) FILTER (WHERE phd.source = 'academique'), 0)    AS academique,
             COALESCE(SUM(phd.amount) FILTER (WHERE phd.source = 'professionnel'), 0) AS professionnel
           FROM payment_hour_details phd
           WHERE phd.payment_id IN (SELECT tp.id FROM teacher_payments tp ${whereClause})`,
          params
        );

        const summary = summaryResult.rows[0];
        const sourceRow = bySourceResult.rows[0] ?? {};
        const academique = parseFloat(sourceRow.academique ?? 0);
        const professionnel = parseFloat(sourceRow.professionnel ?? 0);
        const bySource = {
          academique,
          professionnel,
          // Le reste du total : ce que le détail horaire ne justifie pas.
          // Sans ce poste, académique + professionnel ne retomberait pas sur le
          // total et l'écart serait inexplicable.
          nonVentile: parseFloat(summary.total_amount ?? 0) - academique - professionnel,
        };
        const byStatus = {};
        const byType = {};

        statusResult.rows.forEach(row => {
          byStatus[row.status] = {
            count: parseInt(row.count),
            amount: parseFloat(row.amount),
          };
        });

        typeResult.rows.forEach(row => {
          byType[row.payment_type] = {
            count: parseInt(row.count),
            amount: parseFloat(row.amount),
          };
        });

        let details = [];
        let period = null;

        // Get period info if specified
        if (query.periodId) {
          const periodResult = await client.query(
            `SELECT id, name, period_start, period_end, status
            FROM payment_periods WHERE id = $1 AND tenant_id = $2`,
            [query.periodId, request.tenantId]
          );
          if (periodResult.rows.length > 0) {
            const p = periodResult.rows[0];
            period = {
              id: p.id,
              name: p.name,
              periodStart: p.period_start instanceof Date 
                ? p.period_start.toISOString() 
                : new Date(p.period_start).toISOString(),
              periodEnd: p.period_end instanceof Date 
                ? p.period_end.toISOString() 
                : new Date(p.period_end).toISOString(),
              status: p.status,
            };
          }
        }

        // Get detailed breakdown if requested
        if (query.includeDetails) {
          let detailsQuery = "";
          let detailsParams = [...params];

          switch (query.groupBy) {
            case "teacher":
              detailsQuery = `
                SELECT 
                  tp.teacher_id,
                  COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
                  COALESCE(u.email, t.email, '') as teacher_email,
                  COUNT(*) as payment_count,
                  COALESCE(SUM(tp.total_amount), 0) as total_amount,
                  COALESCE(SUM(CASE WHEN tp.status = 'calculated' THEN tp.total_amount ELSE 0 END), 0) as pending_amount,
                  COALESCE(SUM(CASE WHEN tp.status = 'approved' THEN tp.total_amount ELSE 0 END), 0) as approved_amount,
                  COALESCE(SUM(CASE WHEN tp.status = 'paid' THEN tp.total_amount ELSE 0 END), 0) as paid_amount
                FROM teacher_payments tp
                JOIN teachers t ON tp.teacher_id = t.id
                LEFT JOIN users u ON t.user_id = u.id
                ${whereClause}
                GROUP BY tp.teacher_id, COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant'), COALESCE(u.email, t.email, '')
                ORDER BY total_amount DESC
              `;
              break;

            case "course":
              detailsQuery = `
                SELECT 
                  c.id as course_id,
                  c.title as course_title,
                  c.code as course_code,
                  COUNT(DISTINCT tp.id) as payment_count,
                  COALESCE(SUM(phd.amount), 0) as total_amount
                FROM teacher_payments tp
                JOIN payment_hour_details phd ON tp.id = phd.payment_id
                JOIN teaching_hours th ON phd.teaching_hours_id = th.id
                JOIN course_assignments ca ON th.assignment_id = ca.id
                JOIN courses c ON ca.course_id = c.id
                ${whereClause}
                GROUP BY c.id, c.title, c.code
                ORDER BY total_amount DESC
              `;
              break;

            case "period":
              detailsQuery = `
                SELECT 
                  pp.id as period_id,
                  pp.name as period_name,
                  pp.period_start,
                  pp.period_end,
                  COUNT(*) as payment_count,
                  COALESCE(SUM(tp.total_amount), 0) as total_amount
                FROM teacher_payments tp
                JOIN payment_periods pp ON tp.payment_period_id = pp.id
                ${whereClause}
                GROUP BY pp.id, pp.name, pp.period_start, pp.period_end
                ORDER BY pp.period_start DESC
              `;
              break;

            case "month":
              detailsQuery = `
                SELECT 
                  DATE_TRUNC('month', tp.calculated_at) as month,
                  COUNT(*) as payment_count,
                  COALESCE(SUM(tp.total_amount), 0) as total_amount
                FROM teacher_payments tp
                ${whereClause}
                GROUP BY DATE_TRUNC('month', tp.calculated_at)
                ORDER BY month DESC
              `;
              break;
          }

          const detailsResult = await client.query(detailsQuery, detailsParams);
          details = detailsResult.rows;
        }

        return {
          data: {
            summary: {
              totalPayments: parseInt(summary.total_payments),
              totalAmount: parseFloat(summary.total_amount),
              pendingApprovals: parseInt(summary.pending_approvals),
              pendingPayments: parseInt(summary.pending_payments),
              byStatus,
              byType,
              bySource,
            },
            details,
            period,
            generatedAt: new Date().toISOString(),
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/payment-reports/teacher/:teacherId - Detailed teacher payment report
  fastify.get("/teacher/:teacherId", {
    schema: {
      params: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
        },
        required: ["teacherId"],
      },
      querystring: {
        type: "object",
        properties: {
          periodId: { type: "string", format: "uuid" },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
          includeHourDetails: { type: "boolean", default: false },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                teacher: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    email: { type: "string" },
                  },
                },
                summary: {
                  type: "object",
                  properties: {
                    totalPayments: { type: "number" },
                    totalAmount: { type: "number" },
                    totalHours: { type: "number" },
                    regularHours: { type: "number" },
                    overtimeHours: { type: "number" },
                    averageHourlyRate: { type: "number" },
                  },
                },
                payments: { type: "array" },
                hourDetails: { type: "array" },
                generatedAt: { type: "string" },
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

      const { teacherId } = request.params as { teacherId: string };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const { periodId, fromDate, toDate, includeHourDetails } = request.query as {
        periodId?: string;
        fromDate?: string;
        toDate?: string;
        includeHourDetails?: boolean;
      };

      const client = await fastify.pg.connect();
      try {
        // Get teacher info
        const teacherResult = await client.query(
          `SELECT t.id, COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as name, COALESCE(u.email, t.email, '') as email
          FROM teachers t
          LEFT JOIN users u ON t.user_id = u.id
          WHERE t.id = $1 AND t.tenant_id = $2`,
          [teacherId, request.tenantId]
        );

        if (teacherResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher not found",
          });
        }

        const teacher = teacherResult.rows[0];

        // Build WHERE clause for payments
        let whereClause = "WHERE tp.tenant_id = $1 AND tp.teacher_id = $2";
        const params = [request.tenantId, teacherId];
        let paramIndex = 3;

        if (periodId) {
          whereClause += ` AND tp.payment_period_id = $${paramIndex}`;
          params.push(periodId);
          paramIndex++;
        }

        if (fromDate) {
          whereClause += ` AND tp.calculated_at >= $${paramIndex}`;
          params.push(fromDate);
          paramIndex++;
        }

        if (toDate) {
          whereClause += ` AND tp.calculated_at <= $${paramIndex}`;
          params.push(toDate);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          whereClause += ` AND tp.payment_period_id IN (
            SELECT id FROM payment_periods WHERE tenant_id = $1 AND academic_year_id = $${paramIndex}
          )`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        // Get payment summary
        const summaryResult = await client.query(
          `SELECT 
            COUNT(*) as total_payments,
            COALESCE(SUM(tp.total_amount), 0) as total_amount,
            COALESCE(SUM((tp.calculation_details->>'regularHours')::numeric), 0) as regular_hours,
            COALESCE(SUM((tp.calculation_details->>'overtimeHours')::numeric), 0) as overtime_hours
          FROM teacher_payments tp
          ${whereClause}`,
          params
        );

        const summary = summaryResult.rows[0];
        const totalHours = parseFloat(summary.regular_hours) + parseFloat(summary.overtime_hours);
        const averageHourlyRate = totalHours > 0 ? parseFloat(summary.total_amount) / totalHours : 0;

        // Get detailed payments
        const paymentsResult = await client.query(
          `SELECT 
            tp.id, tp.payment_type, tp.base_amount, tp.overtime_amount,
            tp.bonus_amount, tp.deductions, tp.total_amount, tp.currency,
            tp.status, tp.calculated_at, tp.approved_at, tp.paid_at,
            tp.calculation_details, tp.notes,
            pp.name as period_name, pp.period_start, pp.period_end
          FROM teacher_payments tp
          JOIN payment_periods pp ON tp.payment_period_id = pp.id
          ${whereClause}
          ORDER BY tp.calculated_at DESC`,
          params
        );

        const payments = paymentsResult.rows.map(row => ({
          id: row.id,
          paymentType: row.payment_type,
          baseAmount: parseFloat(row.base_amount),
          overtimeAmount: parseFloat(row.overtime_amount),
          bonusAmount: parseFloat(row.bonus_amount),
          deductions: parseFloat(row.deductions),
          totalAmount: parseFloat(row.total_amount),
          currency: row.currency,
          status: row.status,
          calculatedAt: row.calculated_at,
          approvedAt: row.approved_at,
          paidAt: row.paid_at,
          calculationDetails: row.calculation_details,
          notes: row.notes,
          period: {
            name: row.period_name,
            start: row.period_start,
            end: row.period_end,
          },
        }));

        let hourDetails = [];
        if (includeHourDetails) {
          const hourDetailsResult = await client.query(
            `SELECT 
              phd.hours_count, phd.hourly_rate, phd.amount, phd.is_overtime,
              th.session_date, th.session_type,
              c.title as course_title, c.code as course_code,
              pp.name as period_name
            FROM payment_hour_details phd
            JOIN teaching_hours th ON phd.teaching_hours_id = th.id
            JOIN course_assignments ca ON th.assignment_id = ca.id
            JOIN courses c ON ca.course_id = c.id
            JOIN teacher_payments tp ON phd.payment_id = tp.id
            JOIN payment_periods pp ON tp.payment_period_id = pp.id
            ${whereClause.replace('tp.tenant_id', 'phd.tenant_id')}
            ORDER BY th.session_date DESC`,
            params
          );

          hourDetails = hourDetailsResult.rows.map(row => ({
            hoursCount: parseFloat(row.hours_count),
            hourlyRate: parseFloat(row.hourly_rate),
            amount: parseFloat(row.amount),
            isOvertime: row.is_overtime,
            sessionDate: row.session_date,
            sessionType: row.session_type,
            courseTitle: row.course_title,
            courseCode: row.course_code,
            periodName: row.period_name,
          }));
        }

        return {
          data: {
            teacher: {
              id: teacher.id,
              name: teacher.name,
              email: teacher.email,
            },
            summary: {
              totalPayments: parseInt(summary.total_payments),
              totalAmount: parseFloat(summary.total_amount),
              totalHours,
              regularHours: parseFloat(summary.regular_hours),
              overtimeHours: parseFloat(summary.overtime_hours),
              averageHourlyRate,
            },
            payments,
            hourDetails,
            generatedAt: new Date().toISOString(),
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/payment-reports/period/:periodId - Period payment report
  fastify.get("/period/:periodId", {
    schema: {
      params: {
        type: "object",
        properties: {
          periodId: { type: "string", format: "uuid" },
        },
        required: ["periodId"],
      },
      querystring: {
        type: "object",
        properties: {
          includeTeacherDetails: { type: "boolean", default: true },
          includeCourseBreakdown: { type: "boolean", default: false },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                period: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    periodStart: { type: "string" },
                    periodEnd: { type: "string" },
                    status: { type: "string" },
                  },
                },
                summary: {
                  type: "object",
                  properties: {
                    totalTeachers: { type: "number" },
                    totalPayments: { type: "number" },
                    totalAmount: { type: "number" },
                    totalHours: { type: "number" },
                    averagePayment: { type: "number" },
                    byStatus: { type: "object" },
                  },
                },
                teachers: { type: "array" },
                courses: { type: "array" },
                generatedAt: { type: "string" },
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

      const { periodId } = request.params as { periodId: string };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const { includeTeacherDetails, includeCourseBreakdown } = request.query as {
        includeTeacherDetails?: boolean;
        includeCourseBreakdown?: boolean;
      };

      const client = await fastify.pg.connect();
      try {
        // Get period info
        const periodResult = await client.query(
          `SELECT id, name, period_start, period_end, status
          FROM payment_periods WHERE id = $1 AND tenant_id = $2`,
          [periodId, request.tenantId]
        );

        if (periodResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Payment period not found",
          });
        }

        if (activeAcademicYearId) {
          const yearCheck = await client.query(
            `SELECT 1 FROM payment_periods WHERE id = $1 AND tenant_id = $2 AND academic_year_id = $3`,
            [periodId, request.tenantId, activeAcademicYearId]
          );
          if (yearCheck.rows.length === 0) {
            return reply.status(404).send({
              error: "Not Found",
              message: "Payment period not found for active academic year",
            });
          }
        }

        const period = periodResult.rows[0];

        // Get period summary
        const summaryResult = await client.query(
          `SELECT 
            COUNT(DISTINCT tp.teacher_id) as total_teachers,
            COUNT(*) as total_payments,
            COALESCE(SUM(tp.total_amount), 0) as total_amount,
            COALESCE(SUM((tp.calculation_details->>'regularHours')::numeric), 0) + 
            COALESCE(SUM((tp.calculation_details->>'overtimeHours')::numeric), 0) as total_hours
          FROM teacher_payments tp
          WHERE tp.tenant_id = $1 AND tp.payment_period_id = $2`,
          [request.tenantId, periodId]
        );

        // Get status breakdown
        const statusResult = await client.query(
          `SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
          FROM teacher_payments
          WHERE tenant_id = $1 AND payment_period_id = $2
          GROUP BY status`,
          [request.tenantId, periodId]
        );

        const summary = summaryResult.rows[0];
        const byStatus = {};
        statusResult.rows.forEach(row => {
          byStatus[row.status] = {
            count: parseInt(row.count),
            amount: parseFloat(row.amount),
          };
        });

        const averagePayment = parseInt(summary.total_payments) > 0 
          ? parseFloat(summary.total_amount) / parseInt(summary.total_payments) 
          : 0;

        let teachers = [];
        if (includeTeacherDetails) {
          const teachersResult = await client.query(
            `SELECT 
              tp.teacher_id,
              COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
              COALESCE(u.email, t.email, '') as teacher_email,
              COUNT(*) as payment_count,
              COALESCE(SUM(tp.total_amount), 0) as total_amount,
              COALESCE(SUM((tp.calculation_details->>'regularHours')::numeric), 0) as regular_hours,
              COALESCE(SUM((tp.calculation_details->>'overtimeHours')::numeric), 0) as overtime_hours,
              MAX(tp.status) as latest_status
            FROM teacher_payments tp
            JOIN teachers t ON tp.teacher_id = t.id
            LEFT JOIN users u ON t.user_id = u.id
            WHERE tp.tenant_id = $1 AND tp.payment_period_id = $2
            GROUP BY tp.teacher_id, COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant'), COALESCE(u.email, t.email, '')
            ORDER BY total_amount DESC`,
            [request.tenantId, periodId]
          );

          teachers = teachersResult.rows.map(row => ({
            teacherId: row.teacher_id,
            teacherName: row.teacher_name,
            teacherEmail: row.teacher_email,
            paymentCount: parseInt(row.payment_count),
            totalAmount: parseFloat(row.total_amount),
            regularHours: parseFloat(row.regular_hours),
            overtimeHours: parseFloat(row.overtime_hours),
            totalHours: parseFloat(row.regular_hours) + parseFloat(row.overtime_hours),
            latestStatus: row.latest_status,
          }));
        }

        let courses = [];
        if (includeCourseBreakdown) {
          const coursesResult = await client.query(
            `SELECT 
              c.id as course_id,
              c.title as course_title,
              c.code as course_code,
              COUNT(DISTINCT tp.teacher_id) as teacher_count,
              COUNT(DISTINCT phd.id) as session_count,
              COALESCE(SUM(phd.hours_count), 0) as total_hours,
              COALESCE(SUM(phd.amount), 0) as total_amount
            FROM teacher_payments tp
            JOIN payment_hour_details phd ON tp.id = phd.payment_id
            JOIN teaching_hours th ON phd.teaching_hours_id = th.id
            JOIN course_assignments ca ON th.assignment_id = ca.id
            JOIN courses c ON ca.course_id = c.id
            WHERE tp.tenant_id = $1 AND tp.payment_period_id = $2
            GROUP BY c.id, c.title, c.code
            ORDER BY total_amount DESC`,
            [request.tenantId, periodId]
          );

          courses = coursesResult.rows.map(row => ({
            courseId: row.course_id,
            courseTitle: row.course_title,
            courseCode: row.course_code,
            teacherCount: parseInt(row.teacher_count),
            sessionCount: parseInt(row.session_count),
            totalHours: parseFloat(row.total_hours),
            totalAmount: parseFloat(row.total_amount),
          }));
        }

        return {
          data: {
            period: {
              id: period.id,
              name: period.name,
              periodStart: period.period_start,
              periodEnd: period.period_end,
              status: period.status,
            },
            summary: {
              totalTeachers: parseInt(summary.total_teachers),
              totalPayments: parseInt(summary.total_payments),
              totalAmount: parseFloat(summary.total_amount),
              totalHours: parseFloat(summary.total_hours),
              averagePayment,
              byStatus,
            },
            teachers,
            courses,
            generatedAt: new Date().toISOString(),
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/payment-reports/export/:format - Export payment report
  fastify.get("/export/:format", {
    schema: {
      params: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["csv", "xlsx"] },
        },
        required: ["format"],
      },
      querystring: {
        type: "object",
        properties: {
          periodId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
          includeHourDetails: { type: "boolean", default: false },
          source: { type: "string", enum: ["all", "academique", "professionnel"], default: "all" },
        },
      },
      response: {
        200: {
          type: "string",
          description: "File download",
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

      const { format } = request.params as { format: string };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const { periodId, teacherId, fromDate, toDate, includeHourDetails, source } = request.query as {
        periodId?: string;
        teacherId?: string;
        fromDate?: string;
        toDate?: string;
        includeHourDetails?: boolean;
        source?: "all" | "academique" | "professionnel";
      };

      // This would typically use a library like csv-writer or exceljs
      // For now, return a simple CSV format
      const client = await fastify.pg.connect();
      try {
        let whereClause = "WHERE tp.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (periodId) {
          whereClause += ` AND tp.payment_period_id = $${paramIndex}`;
          params.push(periodId);
          paramIndex++;
        }

        if (teacherId) {
          whereClause += ` AND tp.teacher_id = $${paramIndex}`;
          params.push(teacherId);
          paramIndex++;
        }

        if (fromDate) {
          whereClause += ` AND tp.calculated_at >= $${paramIndex}`;
          params.push(fromDate);
          paramIndex++;
        }

        if (toDate) {
          whereClause += ` AND tp.calculated_at <= $${paramIndex}`;
          params.push(toDate);
          paramIndex++;
        }

        // Filtre d'origine (feature 031) — au niveau du détail horaire.
        if (source && source !== "all") {
          whereClause += ` AND EXISTS (
            SELECT 1 FROM payment_hour_details phd
            WHERE phd.payment_id = tp.id AND phd.source = $${paramIndex}
          )`;
          params.push(source);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          whereClause += ` AND tp.payment_period_id IN (
            SELECT id FROM payment_periods WHERE tenant_id = $1 AND academic_year_id = $${paramIndex}
          )`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        const result = await client.query(
          `SELECT
            tp.id,
            COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
            COALESCE(u.email, t.email, '') as teacher_email,
            pp.name as period_name,
            tp.payment_type,
            tp.base_amount,
            tp.overtime_amount,
            tp.bonus_amount,
            tp.deductions,
            tp.total_amount,
            tp.currency,
            tp.status,
            tp.calculated_at,
            tp.approved_at,
            tp.paid_at,
            -- Ventilation par origine : la même colonne que l'affichage, sinon
            -- l'export raconte une autre histoire que l'écran (FR-030).
            COALESCE((SELECT SUM(d.amount) FROM payment_hour_details d
                       WHERE d.payment_id = tp.id AND d.source = 'academique'), 0)    AS montant_academique,
            COALESCE((SELECT SUM(d.amount) FROM payment_hour_details d
                       WHERE d.payment_id = tp.id AND d.source = 'professionnel'), 0) AS montant_professionnel
          FROM teacher_payments tp
          JOIN teachers t ON tp.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          JOIN payment_periods pp ON tp.payment_period_id = pp.id
          ${whereClause}
          ORDER BY tp.calculated_at DESC`,
          params
        );

        // Generate CSV content
        const headers = [
          "Payment ID", "Teacher Name", "Teacher Email", "Period", "Payment Type",
          "Base Amount", "Overtime Amount", "Bonus Amount", "Deductions", "Total Amount",
          "Montant Academique", "Montant Professionnel",
          "Currency", "Status", "Calculated At", "Approved At", "Paid At"
        ];

        let csvContent = headers.join(",") + "\n";
        
        result.rows.forEach(row => {
          const values = [
            row.id,
            `"${row.teacher_name}"`,
            row.teacher_email,
            `"${row.period_name}"`,
            row.payment_type,
            row.base_amount,
            row.overtime_amount,
            row.bonus_amount,
            row.deductions,
            row.total_amount,
            row.montant_academique,
            row.montant_professionnel,
            row.currency,
            row.status,
            row.calculated_at,
            row.approved_at || "",
            row.paid_at || ""
          ];
          csvContent += values.join(",") + "\n";
        });

        const filename = `payment-report-${new Date().toISOString().split('T')[0]}.${format}`;
        
        reply.header('Content-Type', format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        
        return csvContent;
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/payment-reports/list - List payments for management
  fastify.get("/list", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          status: { type: "string", enum: ["calculated", "approved", "paid", "cancelled"] },
          teacherId: { type: "string", format: "uuid" },
          periodId: { type: "string", format: "uuid" },
          fromDate: { type: "string", format: "date" },
          toDate: { type: "string", format: "date" },
          source: { type: "string", enum: ["all", "academique", "professionnel"], default: "all" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { page = 1, limit = 20, status, teacherId, periodId, fromDate, toDate, source } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const offset = (page - 1) * limit;

      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Build WHERE clause
        let whereClause = "WHERE tp.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (status) {
          whereClause += ` AND tp.status = $${paramIndex}`;
          params.push(status);
          paramIndex++;
        }

        if (teacherId) {
          whereClause += ` AND tp.teacher_id = $${paramIndex}`;
          params.push(teacherId);
          paramIndex++;
        }

        if (periodId) {
          whereClause += ` AND tp.payment_period_id = $${paramIndex}`;
          params.push(periodId);
          paramIndex++;
        }

        if (fromDate) {
          whereClause += ` AND tp.calculated_at >= $${paramIndex}`;
          params.push(fromDate);
          paramIndex++;
        }

        if (toDate) {
          whereClause += ` AND tp.calculated_at <= $${paramIndex}`;
          params.push(toDate);
          paramIndex++;
        }

        // Filtre d'origine (feature 031) — au niveau du détail horaire.
        if (source && source !== "all") {
          whereClause += ` AND EXISTS (
            SELECT 1 FROM payment_hour_details phd
            WHERE phd.payment_id = tp.id AND phd.source = $${paramIndex}
          )`;
          params.push(source);
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
        const countResult = await client.query(
          `SELECT COUNT(*) as total
           FROM teacher_payments tp
           JOIN teachers t ON tp.teacher_id = t.id
           JOIN payment_periods pp ON tp.payment_period_id = pp.id
           ${whereClause}`,
          params
        );
        const total = parseInt(countResult.rows[0].total);

        // Get paginated results
        const result = await client.query(
          `SELECT
            tp.id,
            COALESCE(t.first_name || ' ' || t.last_name, 'Unknown Teacher') as teacher_name,
            t.email as teacher_email,
            pp.name as period_name,
            tp.payment_type,
            tp.base_amount,
            tp.overtime_amount,
            tp.bonus_amount,
            tp.deductions,
            tp.total_amount,
            tp.currency,
            tp.status,
            tp.calculated_at,
            tp.approved_at,
            tp.paid_at
          FROM teacher_payments tp
          JOIN teachers t ON tp.teacher_id = t.id
          JOIN payment_periods pp ON tp.payment_period_id = pp.id
          ${whereClause}
          ORDER BY tp.calculated_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset]
        );

        return reply.send({
          data: result.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to fetch payments" });
      } finally {
        client.release();
      }
    }
  });

  // Update payment status
  fastify.patch('/:paymentId/status', async (request, reply) => {
    const client = await fastify.pg.connect();

    try {
      const { paymentId } = request.params as { paymentId: string };
      const { status } = request.body as { status: string };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      // Validate status
      const validStatuses = ['calculated', 'approved', 'paid', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({
          error: 'Invalid status',
          message: 'Status must be one of: calculated, approved, paid, cancelled'
        });
      }

      // Update the payment status
      const updateField = status === 'approved' ? 'approved_at' :
                         status === 'paid' ? 'paid_at' : null;

      let query = 'UPDATE teacher_payments SET status = $1';
      let params = [status];

      if (updateField) {
        query += `, ${updateField} = NOW()`;
      }

      query += ' WHERE id = $2 AND tenant_id = $3';
      params.push(paymentId, request.tenantId);
      if (activeAcademicYearId) {
        query += ` AND payment_period_id IN (
          SELECT id FROM payment_periods WHERE tenant_id = $3 AND academic_year_id = $4
        )`;
        params.push(activeAcademicYearId);
      }
      query += ' RETURNING *';

      const result = await client.query(query, params);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: 'Payment not found'
        });
      }

      reply.send({
        message: 'Payment status updated successfully',
        payment: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating payment status:', error);
      reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to update payment status'
      });
    } finally {
      client.release();
    }
  });
}