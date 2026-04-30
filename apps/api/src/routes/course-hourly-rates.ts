import { FastifyInstance } from "fastify";
import { 
  CourseHourlyRateSchema,
  CreateCourseHourlyRateSchema,
  UpdateCourseHourlyRateSchema,
  RateTypeSchema
} from "@ecoledigitale/contracts/src/payments";

export async function courseHourlyRatesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/course-hourly-rates - List course hourly rates
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          courseId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          rateType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "supervision"] },
          active: { type: "boolean" }, // Only active rates (no end date or future end date)
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
                  courseId: { type: "string" },
                  teacherId: { type: "string" },
                  rateAmount: { type: "number" },
                  rateType: { type: "string" },
                  effectiveFrom: { type: "string" },
                  effectiveTo: { type: "string" },
                  notes: { type: "string" },
                  createdBy: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  // Include related data
                  courseTitle: { type: "string" },
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
        courseId?: string;
        teacherId?: string;
        rateType?: string;
        active?: boolean;
        limit: number;
        cursor?: string;
      };

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause
        let whereClause = "WHERE chr.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.courseId) {
          whereClause += ` AND chr.course_id = $${paramIndex}`;
          params.push(query.courseId);
          paramIndex++;
        }

        if (query.teacherId) {
          whereClause += ` AND chr.teacher_id = $${paramIndex}`;
          params.push(query.teacherId);
          paramIndex++;
        }

        if (query.rateType) {
          whereClause += ` AND chr.rate_type = $${paramIndex}`;
          params.push(query.rateType);
          paramIndex++;
        }

        if (query.active) {
          whereClause += ` AND (chr.effective_to IS NULL OR chr.effective_to >= CURRENT_DATE)`;
        }

        if (query.cursor) {
          whereClause += ` AND chr.created_at < $${paramIndex}`;
          params.push(query.cursor);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) 
          FROM course_hourly_rates chr 
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get rates with related data
        const ratesQuery = `
          SELECT 
            chr.id, chr.tenant_id, chr.course_id, chr.teacher_id,
            chr.rate_amount, chr.rate_type, chr.effective_from, chr.effective_to,
            chr.notes, chr.created_by, chr.created_at, chr.updated_at,
            c.title as course_title,
            u.first_name || ' ' || u.last_name as teacher_name,
            u.email as teacher_email
          FROM course_hourly_rates chr
          LEFT JOIN courses c ON chr.course_id = c.id
          LEFT JOIN teachers t ON chr.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          ${whereClause}
          ORDER BY chr.created_at DESC
          LIMIT $${paramIndex}
        `;
        params.push(query.limit + 1); // Get one extra to check if there are more

        const result = await client.query(ratesQuery, params);
        const hasMore = result.rows.length > query.limit;
        const rates = result.rows.slice(0, query.limit);

        const data = rates.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          courseId: row.course_id,
          teacherId: row.teacher_id,
          rateAmount: parseFloat(row.rate_amount),
          rateType: row.rate_type,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          notes: row.notes,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          courseTitle: row.course_title,
          teacherName: row.teacher_name,
          teacherEmail: row.teacher_email,
        }));

        return {
          data,
          pagination: {
            cursor: hasMore ? rates[rates.length - 1].created_at : undefined,
            hasMore,
            total,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/course-hourly-rates/:id - Get rate by ID
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
                courseId: { type: "string" },
                teacherId: { type: "string" },
                rateAmount: { type: "number" },
                rateType: { type: "string" },
                effectiveFrom: { type: "string" },
                effectiveTo: { type: "string" },
                notes: { type: "string" },
                createdBy: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
                courseTitle: { type: "string" },
                teacherName: { type: "string" },
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
            chr.id, chr.tenant_id, chr.course_id, chr.teacher_id,
            chr.rate_amount, chr.rate_type, chr.effective_from, chr.effective_to,
            chr.notes, chr.created_by, chr.created_at, chr.updated_at,
            c.title as course_title,
            u.first_name || ' ' || u.last_name as teacher_name
          FROM course_hourly_rates chr
          LEFT JOIN courses c ON chr.course_id = c.id
          LEFT JOIN teachers t ON chr.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE chr.id = $1 AND chr.tenant_id = $2`,
          [id, request.tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Course hourly rate not found",
          });
        }

        const row = result.rows[0];
        return {
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            courseId: row.course_id,
            teacherId: row.teacher_id,
            rateAmount: parseFloat(row.rate_amount),
            rateType: row.rate_type,
            effectiveFrom: row.effective_from,
            effectiveTo: row.effective_to,
            notes: row.notes,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            courseTitle: row.course_title,
            teacherName: row.teacher_name,
          },
        };
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/course-hourly-rates/effective - Get effective rates for course/teacher/type
  fastify.get("/effective", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          courseId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          rateType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "supervision"] },
          date: { type: "string", format: "date" }, // Check rates for specific date
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
                  courseId: { type: "string" },
                  teacherId: { type: "string" },
                  rateAmount: { type: "number" },
                  rateType: { type: "string" },
                  effectiveFrom: { type: "string" },
                  effectiveTo: { type: "string" },
                  priority: { type: "number" }, // 1 = teacher-specific, 2 = course-specific, 3 = default
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
          message: "This endpoint requires tenant context",
        });
      }

      const { courseId, teacherId, rateType, date } = request.query as {
        courseId?: string;
        teacherId?: string;
        rateType?: string;
        date?: string;
      };

      const checkDate = date ? new Date(date) : new Date();

      const client = await fastify.pg.connect();
      try {
        let whereClause = "WHERE chr.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        whereClause += ` AND chr.effective_from <= $${paramIndex}`;
        params.push(checkDate);
        paramIndex++;

        whereClause += ` AND (chr.effective_to IS NULL OR chr.effective_to >= $${paramIndex})`;
        params.push(checkDate);
        paramIndex++;

        if (rateType) {
          whereClause += ` AND chr.rate_type = $${paramIndex}`;
          params.push(rateType);
          paramIndex++;
        }

        // Build conditions for priority matching
        let priorityConditions = [];
        
        if (courseId && teacherId) {
          priorityConditions.push(`(chr.course_id = '${courseId}' AND chr.teacher_id = '${teacherId}')`);
        }
        
        if (courseId) {
          priorityConditions.push(`(chr.course_id = '${courseId}' AND chr.teacher_id IS NULL)`);
        }
        
        if (teacherId) {
          priorityConditions.push(`(chr.course_id IS NULL AND chr.teacher_id = '${teacherId}')`);
        }
        
        // Always include default rates
        priorityConditions.push(`(chr.course_id IS NULL AND chr.teacher_id IS NULL)`);

        if (priorityConditions.length > 0) {
          whereClause += ` AND (${priorityConditions.join(' OR ')})`;
        }

        const result = await client.query(
          `SELECT 
            chr.id, chr.course_id, chr.teacher_id, chr.rate_amount, chr.rate_type,
            chr.effective_from, chr.effective_to,
            CASE 
              WHEN chr.course_id IS NOT NULL AND chr.teacher_id IS NOT NULL THEN 1
              WHEN chr.course_id IS NOT NULL AND chr.teacher_id IS NULL THEN 2
              WHEN chr.course_id IS NULL AND chr.teacher_id IS NOT NULL THEN 2
              ELSE 3
            END as priority
          FROM course_hourly_rates chr
          ${whereClause}
          ORDER BY priority ASC, chr.effective_from DESC`,
          params
        );

        const data = result.rows.map(row => ({
          id: row.id,
          courseId: row.course_id,
          teacherId: row.teacher_id,
          rateAmount: parseFloat(row.rate_amount),
          rateType: row.rate_type,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          priority: parseInt(row.priority),
        }));

        return { data };
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/course-hourly-rates - Create hourly rate
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          courseId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          rateAmount: { type: "number", minimum: 0 },
          rateType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "supervision"] },
          effectiveFrom: { type: "string", format: "date" },
          effectiveTo: { type: "string", format: "date" },
          notes: { type: "string" },
        },
        required: ["rateAmount", "rateType", "effectiveFrom"],
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
                courseId: { type: "string" },
                teacherId: { type: "string" },
                rateAmount: { type: "number" },
                rateType: { type: "string" },
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
      if (!request.tenantId || !request.userId) {
        return reply.status(400).send({
          error: "Authentication Required",
          message: "This endpoint requires authentication and tenant context",
        });
      }

      const data = CreateCourseHourlyRateSchema.parse(request.body);

      // Validate date range
      if (data.effectiveTo && new Date(data.effectiveFrom) >= new Date(data.effectiveTo)) {
        return reply.status(400).send({
          error: "Invalid Date Range",
          message: "Effective from date must be before effective to date",
        });
      }

      const client = await fastify.pg.connect();
      try {
        // Validate course and teacher exist if provided
        if (data.courseId) {
          const courseCheck = await client.query(
            `SELECT id FROM courses WHERE id = $1 AND tenant_id = $2`,
            [data.courseId, request.tenantId]
          );
          if (courseCheck.rows.length === 0) {
            return reply.status(400).send({
              error: "Course Not Found",
              message: "Course not found in this tenant",
            });
          }
        }

        if (data.teacherId) {
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
        }

        // Check for overlapping rates
        const overlapCheck = await client.query(
          `SELECT id FROM course_hourly_rates 
          WHERE tenant_id = $1 
          AND COALESCE(course_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2, '00000000-0000-0000-0000-000000000000'::uuid)
          AND COALESCE(teacher_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)
          AND rate_type = $4
          AND daterange($5::date, COALESCE($6::date, 'infinity'::date), '[]') && 
              daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')`,
          [request.tenantId, data.courseId, data.teacherId, data.rateType, data.effectiveFrom, data.effectiveTo]
        );

        if (overlapCheck.rows.length > 0) {
          return reply.status(400).send({
            error: "Overlapping Rate",
            message: "Hourly rate overlaps with an existing rate for the same course/teacher/type combination",
          });
        }

        const result = await client.query(
          `INSERT INTO course_hourly_rates 
          (tenant_id, course_id, teacher_id, rate_amount, rate_type, 
           effective_from, effective_to, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, tenant_id, course_id, teacher_id, rate_amount, rate_type,
                    effective_from, effective_to, notes, created_by, created_at, updated_at`,
          [
            request.tenantId,
            data.courseId,
            data.teacherId,
            data.rateAmount,
            data.rateType,
            data.effectiveFrom,
            data.effectiveTo,
            data.notes,
            request.userId,
          ]
        );

        const row = result.rows[0];
        return reply.status(201).send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            courseId: row.course_id,
            teacherId: row.teacher_id,
            rateAmount: parseFloat(row.rate_amount),
            rateType: row.rate_type,
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

  // PUT /api/v1/course-hourly-rates/:id - Update hourly rate
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
          rateAmount: { type: "number", minimum: 0 },
          rateType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "supervision"] },
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
                courseId: { type: "string" },
                teacherId: { type: "string" },
                rateAmount: { type: "number" },
                rateType: { type: "string" },
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
      if (!request.tenantId || !request.userId) {
        return reply.status(400).send({
          error: "Authentication Required",
          message: "This endpoint requires authentication and tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const data = UpdateCourseHourlyRateSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        // Check if rate exists
        const existingResult = await client.query(
          `SELECT course_id, teacher_id, rate_type FROM course_hourly_rates 
          WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Course hourly rate not found",
          });
        }

        // Build update query
        const updateFields = [];
        const params = [id, request.tenantId];
        let paramIndex = 3;

        if (data.rateAmount !== undefined) {
          updateFields.push(`rate_amount = $${paramIndex}`);
          params.push(data.rateAmount);
          paramIndex++;
        }

        if (data.rateType !== undefined) {
          updateFields.push(`rate_type = $${paramIndex}`);
          params.push(data.rateType);
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

        const result = await client.query(
          `UPDATE course_hourly_rates 
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, tenant_id, course_id, teacher_id, rate_amount, rate_type,
                    effective_from, effective_to, notes, created_by, created_at, updated_at`,
          params
        );

        const row = result.rows[0];
        return {
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            courseId: row.course_id,
            teacherId: row.teacher_id,
            rateAmount: parseFloat(row.rate_amount),
            rateType: row.rate_type,
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

  // DELETE /api/v1/course-hourly-rates/:id - Delete hourly rate
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
        204: {},
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
      if (!request.tenantId || !request.userId) {
        return reply.status(400).send({
          error: "Authentication Required",
          message: "This endpoint requires authentication and tenant context",
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        // Check if rate is used in any payment calculations
        const usageCheck = await client.query(
          `SELECT COUNT(*) FROM payment_hour_details phd
          JOIN teaching_hours th ON phd.teaching_hours_id = th.id
          JOIN course_assignments ca ON th.assignment_id = ca.id
          WHERE phd.tenant_id = $1 
          AND EXISTS (
            SELECT 1 FROM course_hourly_rates chr 
            WHERE chr.id = $2 
            AND chr.course_id = ca.course_id
          )`,
          [request.tenantId, id]
        );

        if (parseInt(usageCheck.rows[0].count) > 0) {
          return reply.status(400).send({
            error: "Cannot Delete",
            message: "Cannot delete hourly rate that has been used in payment calculations",
          });
        }

        const result = await client.query(
          `DELETE FROM course_hourly_rates WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Course hourly rate not found",
          });
        }

        return reply.status(204).send();
      } finally {
        client.release();
      }
    },
  });
}