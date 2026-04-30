import { FastifyInstance } from "fastify";
import { 
  TeacherPaymentConfigSchema,
  CreateTeacherPaymentConfigSchema,
  UpdateTeacherPaymentConfigSchema,
  PaymentConfigTypeSchema
} from "@ecoledigitale/contracts/src/payments";

export async function teacherPaymentConfigsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/teacher-payment-configs - List teacher payment configs
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          configType: { type: "string", enum: ["salary", "hourly", "mixed"] },
          active: { type: "boolean" }, // Only active configs (no end date or future end date)
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
                  teacherId: { type: "string" },
                  configType: { type: "string" },
                  monthlySalary: { type: "number" },
                  annualSalary: { type: "number" },
                  defaultHourlyRate: { type: "number" },
                  overtimeThreshold: { type: "number" },
                  overtimeMultiplier: { type: "number" },
                  effectiveFrom: { type: "string" },
                  effectiveTo: { type: "string" },
                  notes: { type: "string" },
                  createdBy: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  // Include teacher info
                  teacherName: { type: "string" },
                  teacherEmail: { type: "string" },
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

      const query = request.query as {
        teacherId?: string;
        configType?: string;
        active?: boolean;
        limit?: number;
        cursor?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      // Set default limit if not provided
      const limit = query.limit || 20;

      const client = await fastify.pg.connect();
      try {
        fastify.log.info(`Fetching teacher payment configs for tenant: ${request.tenantId}, limit: ${limit}`);
        
        // Build WHERE clause
        let whereClause = "WHERE tpc.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.teacherId) {
          whereClause += ` AND tpc.teacher_id = $${paramIndex}`;
          params.push(query.teacherId);
          paramIndex++;
        }

        if (query.configType) {
          whereClause += ` AND tpc.config_type = $${paramIndex}`;
          params.push(query.configType);
          paramIndex++;
        }

        if (query.active) {
          whereClause += ` AND (tpc.effective_to IS NULL OR tpc.effective_to >= CURRENT_DATE)`;
        }

        if (query.cursor) {
          whereClause += ` AND tpc.created_at < $${paramIndex}`;
          params.push(query.cursor);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          whereClause += ` AND tpc.academic_year_id = $${paramIndex}`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) 
          FROM teacher_payment_configs tpc 
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get configs with teacher info
        const configsQuery = `
          SELECT 
            tpc.id, tpc.tenant_id, tpc.teacher_id, tpc.config_type,
            tpc.academic_year_id,
            tpc.monthly_salary, tpc.annual_salary, tpc.default_hourly_rate,
            tpc.overtime_threshold, tpc.overtime_multiplier,
            tpc.effective_from, tpc.effective_to, tpc.notes,
            tpc.created_by, tpc.created_at, tpc.updated_at,
            COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name) as teacher_name,
            COALESCE(u.email, t.email) as teacher_email
          FROM teacher_payment_configs tpc
          JOIN teachers t ON tpc.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          ${whereClause}
          ORDER BY tpc.created_at DESC
          LIMIT $${paramIndex}
        `;
        params.push(limit + 1); // Get one extra to check if there are more

        const result = await client.query(configsQuery, params);
        const hasMore = result.rows.length > limit;
        const configs = result.rows.slice(0, limit);

        const data = configs.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          academicYearId: row.academic_year_id,
          teacherId: row.teacher_id,
          configType: row.config_type,
          monthlySalary: row.monthly_salary ? parseFloat(row.monthly_salary) : undefined,
          annualSalary: row.annual_salary ? parseFloat(row.annual_salary) : undefined,
          defaultHourlyRate: row.default_hourly_rate ? parseFloat(row.default_hourly_rate) : undefined,
          overtimeThreshold: parseInt(row.overtime_threshold),
          overtimeMultiplier: parseFloat(row.overtime_multiplier),
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          notes: row.notes,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          teacherName: row.teacher_name,
          teacherEmail: row.teacher_email,
        }));

        fastify.log.info(`Returning ${data.length} teacher payment configs out of ${total} total`);

        return {
          data,
          pagination: {
            cursor: hasMore ? configs[configs.length - 1].created_at : undefined,
            hasMore,
            total,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-payment-configs/:id - Get payment config by ID
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
                teacherId: { type: "string" },
                configType: { type: "string" },
                monthlySalary: { type: "number" },
                annualSalary: { type: "number" },
                defaultHourlyRate: { type: "number" },
                overtimeThreshold: { type: "number" },
                overtimeMultiplier: { type: "number" },
                effectiveFrom: { type: "string" },
                effectiveTo: { type: "string" },
                notes: { type: "string" },
                createdBy: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
                teacherName: { type: "string" },
                teacherEmail: { type: "string" },
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
            tpc.id, tpc.tenant_id, tpc.teacher_id, tpc.config_type,
            tpc.academic_year_id,
            tpc.monthly_salary, tpc.annual_salary, tpc.default_hourly_rate,
            tpc.overtime_threshold, tpc.overtime_multiplier,
            tpc.effective_from, tpc.effective_to, tpc.notes,
            tpc.created_by, tpc.created_at, tpc.updated_at,
            COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Unknown Teacher') as teacher_name,
            COALESCE(u.email, t.email, '') as teacher_email
          FROM teacher_payment_configs tpc
          LEFT JOIN teachers t ON tpc.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE tpc.id = $1 AND tpc.tenant_id = $2
          ${request.headers["x-academic-year-id"] ? "AND tpc.academic_year_id = $3" : ""}`,
          request.headers["x-academic-year-id"]
            ? [id, request.tenantId, request.headers["x-academic-year-id"]]
            : [id, request.tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher payment config not found",
          });
        }

        const row = result.rows[0];
        return reply.send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            teacherId: row.teacher_id,
            configType: row.config_type,
            monthlySalary: row.monthly_salary ? parseFloat(row.monthly_salary) : undefined,
            annualSalary: row.annual_salary ? parseFloat(row.annual_salary) : undefined,
            defaultHourlyRate: row.default_hourly_rate ? parseFloat(row.default_hourly_rate) : undefined,
            overtimeThreshold: parseInt(row.overtime_threshold),
            overtimeMultiplier: parseFloat(row.overtime_multiplier),
            effectiveFrom: row.effective_from,
            effectiveTo: row.effective_to,
            notes: row.notes,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            teacherName: row.teacher_name,
            teacherEmail: row.teacher_email,
          },
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-payment-configs/teacher/:teacherId/current - Get current config for teacher
  fastify.get("/teacher/:teacherId/current", {
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
          date: { type: "string", format: "date" }, // Check config for specific date
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
                teacherId: { type: "string" },
                configType: { type: "string" },
                monthlySalary: { type: "number" },
                annualSalary: { type: "number" },
                defaultHourlyRate: { type: "number" },
                overtimeThreshold: { type: "number" },
                overtimeMultiplier: { type: "number" },
                effectiveFrom: { type: "string" },
                effectiveTo: { type: "string" },
                notes: { type: "string" },
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

      const { teacherId } = request.params as { teacherId: string };
      const { date } = request.query as { date?: string };
      const checkDate = date ? new Date(date) : new Date();
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      const client = await fastify.pg.connect();
      try {
        const baseQuery = `
          SELECT 
            id, tenant_id, academic_year_id, teacher_id, config_type,
            monthly_salary, annual_salary, default_hourly_rate,
            overtime_threshold, overtime_multiplier,
            effective_from, effective_to, notes,
            created_by, created_at, updated_at
          FROM teacher_payment_configs
          WHERE tenant_id = $1 AND teacher_id = $2
          AND effective_from <= $3
          AND (effective_to IS NULL OR effective_to >= $3)
        `;

        // Prefer the current academic year when header is present, but do not fail hard:
        // if nothing is found for that year, fall back to any config valid at the target date.
        let result = activeAcademicYearId
          ? await client.query(
              `${baseQuery}
               AND academic_year_id = $4
               ORDER BY effective_from DESC
               LIMIT 1`,
              [request.tenantId, teacherId, checkDate, activeAcademicYearId]
            )
          : await client.query(
              `${baseQuery}
               ORDER BY effective_from DESC
               LIMIT 1`,
              [request.tenantId, teacherId, checkDate]
            );

        if (result.rows.length === 0 && activeAcademicYearId) {
          result = await client.query(
            `${baseQuery}
             ORDER BY effective_from DESC
             LIMIT 1`,
            [request.tenantId, teacherId, checkDate]
          );
        }

        if (result.rows.length === 0) {
          // Last-resort fallback for calculation screens:
          // if no config is active for the requested date, return the most recent
          // teacher config so payment computation can still proceed.
          result = await client.query(
            `SELECT
              id, tenant_id, academic_year_id, teacher_id, config_type,
              monthly_salary, annual_salary, default_hourly_rate,
              overtime_threshold, overtime_multiplier,
              effective_from, effective_to, notes,
              created_by, created_at, updated_at
             FROM teacher_payment_configs
             WHERE tenant_id = $1 AND teacher_id = $2
             ORDER BY effective_from DESC, created_at DESC
             LIMIT 1`,
            [request.tenantId, teacherId]
          );
        }

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "No active payment config found for teacher",
          });
        }

        const row = result.rows[0];
        return {
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            teacherId: row.teacher_id,
            configType: row.config_type,
            monthlySalary: row.monthly_salary ? parseFloat(row.monthly_salary) : undefined,
            annualSalary: row.annual_salary ? parseFloat(row.annual_salary) : undefined,
            defaultHourlyRate: row.default_hourly_rate ? parseFloat(row.default_hourly_rate) : undefined,
            overtimeThreshold: parseInt(row.overtime_threshold),
            overtimeMultiplier: parseFloat(row.overtime_multiplier),
            effectiveFrom: row.effective_from,
            effectiveTo: row.effective_to,
            notes: row.notes,
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

  // POST /api/v1/teacher-payment-configs - Create payment config
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          configType: { type: "string", enum: ["salary", "hourly", "mixed"] },
          monthlySalary: { type: "number", minimum: 0 },
          annualSalary: { type: "number", minimum: 0 },
          defaultHourlyRate: { type: "number", minimum: 0 },
          overtimeThreshold: { type: "number", minimum: 1, default: 40 },
          overtimeMultiplier: { type: "number", minimum: 1, default: 1.5 },
          effectiveFrom: { type: "string", format: "date" },
          effectiveTo: { type: "string", format: "date" },
          notes: { type: "string" },
        },
        required: ["teacherId", "configType", "effectiveFrom"],
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
                teacherId: { type: "string" },
                configType: { type: "string" },
                monthlySalary: { type: "number" },
                annualSalary: { type: "number" },
                defaultHourlyRate: { type: "number" },
                overtimeThreshold: { type: "number" },
                overtimeMultiplier: { type: "number" },
                effectiveFrom: { type: "string" },
                effectiveTo: { type: "string" },
                notes: { type: "string" },
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
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const data = CreateTeacherPaymentConfigSchema.parse(request.body);
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      if (!activeAcademicYearId) {
        return reply.status(400).send({
          error: "Academic Year Required",
          message: "Aucune année académique active détectée. Veuillez activer une année avant l'enregistrement.",
        });
      }

      // Validate config type requirements
      if (data.configType === 'salary' && !data.monthlySalary && !data.annualSalary) {
        return reply.status(400).send({
          error: "Invalid Configuration",
          message: "Salary config requires either monthly or annual salary",
        });
      }

      if ((data.configType === 'hourly' || data.configType === 'mixed') && !data.defaultHourlyRate) {
        return reply.status(400).send({
          error: "Invalid Configuration",
          message: "Hourly or mixed config requires default hourly rate",
        });
      }

      // Validate date range
      if (data.effectiveTo && new Date(data.effectiveFrom) >= new Date(data.effectiveTo)) {
        return reply.status(400).send({
          error: "Invalid Date Range",
          message: "Effective from date must be before effective to date",
        });
      }

      const client = await fastify.pg.connect();
      try {
        // Check if teacher exists
        const teacherCheck = await client.query(
          `SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2`,
          [data.teacherId, request.tenantId]
        );

        if (teacherCheck.rows.length === 0) {
          return reply.status(400).send({
            error: "Teacher Not Found",
            message: "Teacher not found in this tenant",
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

        const ayStart = new Date(academicYearResult.rows[0].start_date);
        const ayEnd = new Date(academicYearResult.rows[0].end_date);
        const effectiveFrom = new Date(data.effectiveFrom);
        const effectiveTo = data.effectiveTo ? new Date(data.effectiveTo) : null;

        if (effectiveFrom < ayStart || effectiveFrom > ayEnd || (effectiveTo && (effectiveTo < ayStart || effectiveTo > ayEnd))) {
          return reply.status(400).send({
            error: "Out of Bounds",
            message: "Les dates de la configuration doivent être comprises dans l'année académique active",
          });
        }

        // Check for overlapping configs
        const overlapCheck = await client.query(
          `SELECT id FROM teacher_payment_configs 
          WHERE tenant_id = $1 AND teacher_id = $2
          AND daterange($3::date, COALESCE($4::date, 'infinity'::date), '[]') && 
              daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')`,
          [request.tenantId, data.teacherId, data.effectiveFrom, data.effectiveTo]
        );

        if (overlapCheck.rows.length > 0) {
          return reply.status(400).send({
            error: "Overlapping Configuration",
            message: "Payment config overlaps with an existing configuration",
          });
        }

        // In dev/no-auth mode, ensure we have a created_by user: pick an existing one or create a test user
        let createdBy = (request as any).userId as string | undefined;
        if (!createdBy) {
          const existingUser = await client.query('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [request.tenantId]);
          if (existingUser.rows.length > 0) {
            createdBy = existingUser.rows[0].id;
          } else {
            const bcrypt = require('bcryptjs');
            const passwordHash = await bcrypt.hash('testpassword123', 10);
            const userResult = await client.query(
              'INSERT INTO users (email, first_name, last_name, password_hash, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [`test-${Date.now()}@example.com`, 'Test', 'User', passwordHash, request.tenantId]
            );
            createdBy = userResult.rows[0].id;
          }
        }

        const result = await client.query(
          `INSERT INTO teacher_payment_configs
          (tenant_id, academic_year_id, teacher_id, config_type, monthly_salary, annual_salary,
           default_hourly_rate, overtime_threshold, overtime_multiplier,
           effective_from, effective_to, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id, tenant_id, academic_year_id, teacher_id, config_type, monthly_salary, annual_salary,
                    default_hourly_rate, overtime_threshold, overtime_multiplier,
                    effective_from, effective_to, notes, created_by, created_at, updated_at`,
          [
            request.tenantId,
            activeAcademicYearId,
            data.teacherId,
            data.configType,
            data.monthlySalary,
            data.annualSalary,
            data.defaultHourlyRate,
            data.overtimeThreshold,
            data.overtimeMultiplier,
            data.effectiveFrom,
            data.effectiveTo,
            data.notes,
            createdBy,
          ]
        );

        const row = result.rows[0];
        return reply.status(201).send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            teacherId: row.teacher_id,
            configType: row.config_type,
            monthlySalary: row.monthly_salary ? parseFloat(row.monthly_salary) : undefined,
            annualSalary: row.annual_salary ? parseFloat(row.annual_salary) : undefined,
            defaultHourlyRate: row.default_hourly_rate ? parseFloat(row.default_hourly_rate) : undefined,
            overtimeThreshold: parseInt(row.overtime_threshold),
            overtimeMultiplier: parseFloat(row.overtime_multiplier),
            effectiveFrom: row.effective_from,
            effectiveTo: row.effective_to,
            notes: row.notes,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/teacher-payment-configs/:id - Update payment config
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
          configType: { type: "string", enum: ["salary", "hourly", "mixed"] },
          monthlySalary: { type: "number", minimum: 0 },
          annualSalary: { type: "number", minimum: 0 },
          defaultHourlyRate: { type: "number", minimum: 0 },
          overtimeThreshold: { type: "number", minimum: 1 },
          overtimeMultiplier: { type: "number", minimum: 1 },
          effectiveFrom: { type: "string", format: "date" },
          effectiveTo: { type: "string", format: "date" },
          notes: { type: "string" },
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
                teacherId: { type: "string" },
                configType: { type: "string" },
                monthlySalary: { type: "number" },
                annualSalary: { type: "number" },
                defaultHourlyRate: { type: "number" },
                overtimeThreshold: { type: "number" },
                overtimeMultiplier: { type: "number" },
                effectiveFrom: { type: "string" },
                effectiveTo: { type: "string" },
                notes: { type: "string" },
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
      const data = UpdateTeacherPaymentConfigSchema.parse(request.body);
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      if (!activeAcademicYearId) {
        return reply.status(400).send({
          error: "Academic Year Required",
          message: "Aucune année académique active détectée. Veuillez activer une année avant l'enregistrement.",
        });
      }

      const client = await fastify.pg.connect();
      try {
        // Check if config exists
        const existingResult = await client.query(
          `SELECT teacher_id, effective_from, effective_to FROM teacher_payment_configs 
          WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher payment config not found",
          });
        }

        const existing = existingResult.rows[0];

        // Build update query
        const updateFields = [];
        const params = [id, request.tenantId];
        let paramIndex = 3;

        if (data.configType !== undefined) {
          updateFields.push(`config_type = $${paramIndex}`);
          params.push(data.configType);
          paramIndex++;
        }

        if (data.monthlySalary !== undefined) {
          updateFields.push(`monthly_salary = $${paramIndex}`);
          params.push(data.monthlySalary);
          paramIndex++;
        }

        if (data.annualSalary !== undefined) {
          updateFields.push(`annual_salary = $${paramIndex}`);
          params.push(data.annualSalary);
          paramIndex++;
        }

        if (data.defaultHourlyRate !== undefined) {
          updateFields.push(`default_hourly_rate = $${paramIndex}`);
          params.push(data.defaultHourlyRate);
          paramIndex++;
        }

        if (data.overtimeThreshold !== undefined) {
          updateFields.push(`overtime_threshold = $${paramIndex}`);
          params.push(data.overtimeThreshold);
          paramIndex++;
        }

        if (data.overtimeMultiplier !== undefined) {
          updateFields.push(`overtime_multiplier = $${paramIndex}`);
          params.push(data.overtimeMultiplier);
          paramIndex++;
        }

        if (data.effectiveFrom !== undefined) {
          updateFields.push(`effective_from = $${paramIndex}`);
          params.push(data.effectiveFrom);
          paramIndex++;
        }

        if (data.effectiveTo !== undefined) {
          updateFields.push(`effective_to = $${paramIndex}`);
          params.push(data.effectiveTo);
          paramIndex++;
        }

        if (data.notes !== undefined) {
          updateFields.push(`notes = $${paramIndex}`);
          params.push(data.notes);
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

        const nextEffectiveFrom = data.effectiveFrom || existing.effective_from;
        const nextEffectiveTo = data.effectiveTo === undefined ? existing.effective_to : data.effectiveTo;
        const ayStart = new Date(academicYearResult.rows[0].start_date);
        const ayEnd = new Date(academicYearResult.rows[0].end_date);
        const effectiveFrom = new Date(nextEffectiveFrom);
        const effectiveTo = nextEffectiveTo ? new Date(nextEffectiveTo) : null;

        if (effectiveFrom < ayStart || effectiveFrom > ayEnd || (effectiveTo && (effectiveTo < ayStart || effectiveTo > ayEnd))) {
          return reply.status(400).send({
            error: "Out of Bounds",
            message: "Les dates de la configuration doivent être comprises dans l'année académique active",
          });
        }

        updateFields.push(`academic_year_id = $${paramIndex}`);
        params.push(activeAcademicYearId);
        paramIndex++;

        const result = await client.query(
          `UPDATE teacher_payment_configs 
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, tenant_id, academic_year_id, teacher_id, config_type, monthly_salary, annual_salary,
                    default_hourly_rate, overtime_threshold, overtime_multiplier,
                    effective_from, effective_to, notes, created_by, created_at, updated_at`,
          params
        );

        const row = result.rows[0];
        return {
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            teacherId: row.teacher_id,
            configType: row.config_type,
            monthlySalary: row.monthly_salary ? parseFloat(row.monthly_salary) : undefined,
            annualSalary: row.annual_salary ? parseFloat(row.annual_salary) : undefined,
            defaultHourlyRate: row.default_hourly_rate ? parseFloat(row.default_hourly_rate) : undefined,
            overtimeThreshold: parseInt(row.overtime_threshold),
            overtimeMultiplier: parseFloat(row.overtime_multiplier),
            effectiveFrom: row.effective_from,
            effectiveTo: row.effective_to,
            notes: row.notes,
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

  // DELETE /api/v1/teacher-payment-configs/:id - Delete payment config
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
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
        // Check if config has any payments
        const paymentsCheck = await client.query(
          `SELECT COUNT(*) FROM teacher_payments WHERE payment_config_id = $1`,
          [id]
        );

        if (parseInt(paymentsCheck.rows[0].count) > 0) {
          return reply.status(400).send({
            error: "Cannot Delete",
            message: "Cannot delete payment config with existing payments",
          });
        }

        const result = await client.query(
          `DELETE FROM teacher_payment_configs WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher payment config not found",
          });
        }

        return reply.status(204).send();
      } finally {
        client.release();
      }
    },
  });
}