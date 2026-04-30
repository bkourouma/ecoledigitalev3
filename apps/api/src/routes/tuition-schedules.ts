import { FastifyInstance } from "fastify";
import { Pool } from "pg";

export async function tuitionSchedulesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as Pool;

  // GET /api/v1/tuition-schedules - List tuition payment schedules
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          // Back-compat: accept cycleId but map to classId internally
          cycleId: { type: "string", format: "uuid" },
          isActive: { type: "boolean" },
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

      const { academicYearId, classId, cycleId, isActive, limit = 20, offset = 0 } = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;
      const client = await pool.connect();

      // Ensure tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

      try {
        // Build WHERE clause with tenant filtering
        let whereConditions: string[] = ["tps.tenant_id = $1"];
        let queryParams: any[] = [request.tenantId];
        let paramIndex = 2;

        if (effectiveAcademicYearId) {
          whereConditions.push(`tps.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (classId || cycleId) {
          whereConditions.push(`tps.class_id = $${paramIndex}`);
          queryParams.push(classId || cycleId);
          paramIndex++;
        }

        if (isActive !== undefined) {
          whereConditions.push(`tps.is_active = $${paramIndex}`);
          queryParams.push(isActive);
          paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Add limit and offset parameters
        const limitParam = paramIndex;
        const offsetParam = paramIndex + 1;
        queryParams.push(limit, offset);

        const schedulesQuery = `
          SELECT
            tps.*,
            ay.name as academic_year_name,
            cl.name as class_name
          FROM tuition_payment_schedules tps
          JOIN academic_years ay ON tps.academic_year_id = ay.id
          LEFT JOIN classes cl ON tps.class_id = cl.id
          ${whereClause}
          ORDER BY tps.created_at DESC
          LIMIT $${limitParam} OFFSET $${offsetParam}
        `;

        const schedulesResult = await client.query(schedulesQuery, queryParams);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM tuition_payment_schedules tps
          ${whereClause}
        `;

        const countResult = await client.query(countQuery, queryParams.slice(0, -2));

        // Calculate students count for each schedule
        const schedulesWithCounts = await Promise.all(
          schedulesResult.rows.map(async (row) => {
            // Count eligible students for this schedule
            let studentsCountQuery = `
              SELECT COUNT(DISTINCT se.student_id) as students_count
              FROM student_enrollments se
              WHERE se.tenant_id = $1
                AND se.academic_year_id = $2
                AND se.status = 'active'
            `;
            let studentsCountParams: any[] = [request.tenantId, row.academic_year_id];

            if (row.class_id) {
              studentsCountQuery += `
                AND se.class_id IN (
                  SELECT c2.id
                  FROM classes c2
                  WHERE c2.tenant_id = $1
                    AND c2.programme_id = (
                      SELECT c1.programme_id
                      FROM classes c1
                      WHERE c1.id = $3
                    )
                )
              `;
              studentsCountParams.push(row.class_id);
            }

            const studentsCountResult = await client.query(studentsCountQuery, studentsCountParams);
            const studentsCount = parseInt(studentsCountResult.rows[0]?.students_count || '0', 10);

            return {
              ...row,
              studentsCount,
            };
          })
        );

        const schedules = schedulesWithCounts.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          academicYearId: row.academic_year_id,
          // Primary (new) fields
          classId: row.class_id,
          className: row.class_name,
          // Back-compat fields for frontend expecting cycle*
          cycleId: row.class_id,
          cycleName: row.class_name,
          scheduleName: row.schedule_name,
          installments: row.installments,
          isActive: row.is_active,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          academicYearName: row.academic_year_name,
          studentsCount: row.studentsCount,
        }));

        return reply.send({
          data: schedules,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + limit < parseInt(countResult.rows[0].total),
          },
        });
      } catch (error) {
        console.error("Error fetching tuition schedules:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch tuition schedules",
        });
      } finally {
        client.release();
      }
    },
  });


  // GET /api/v1/tuition-schedules/:scheduleId - Get a single tuition payment schedule
  fastify.get<{
    Params: { scheduleId: string }
  }>("/:scheduleId", {
    schema: {
      params: {
        type: "object",
        required: ["scheduleId"],
        properties: {
          scheduleId: { type: "string", format: "uuid" },
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

      const { scheduleId } = request.params as { scheduleId: string };
      const client = await pool.connect();
      // Ensure tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);
      try {
        const sql = `
          SELECT
            tps.*,
            ay.name as academic_year_name,
            cl.name as class_name
          FROM tuition_payment_schedules tps
          JOIN academic_years ay ON tps.academic_year_id = ay.id
          LEFT JOIN classes cl ON tps.class_id = cl.id
          WHERE tps.id = $1 AND tps.tenant_id = $2
        `;
        const res = await client.query(sql, [scheduleId, request.tenantId]);
        if (res.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Tuition schedule not found",
          });
        }
        const row = res.rows[0];
        return reply.send({
          data: {
            id: row.id,
            tenantId: row.tenant_id,
            academicYearId: row.academic_year_id,
            // Primary (new) fields
            classId: row.class_id,
            className: row.class_name,
            // Back-compat
            cycleId: row.class_id,
            cycleName: row.class_name,
            scheduleName: row.schedule_name,
            installments: row.installments,
            isActive: row.is_active,
            createdBy: row.created_by,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            academicYearName: row.academic_year_name,
          },
        });
      } catch (error) {
        request.log.error(error, "Error fetching tuition schedule by id");
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch tuition schedule",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/tuition-schedules - Create tuition payment schedule
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["academicYearId", "scheduleName", "installments"],
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          programmeId: { type: "string", format: "uuid" },
          // Back-compat: accept cycleId but map to classId internally
          cycleId: { type: "string", format: "uuid" },
          scheduleName: { type: "string", minLength: 1, maxLength: 100 },
          installments: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["percentage", "dueDate", "label"],
              properties: {
                percentage: { type: "number", minimum: 0, maximum: 100 },
                dueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                label: { type: "string", minLength: 1, maxLength: 100 },
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

      const scheduleData = request.body as any;
      const client = await pool.connect();

      // Ensure tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

      try {


        // Validate installments total percentage
        const totalPercentage = scheduleData.installments.reduce(
          (sum: number, inst: any) => sum + inst.percentage,
          0
        );

        if (Math.abs(totalPercentage - 100) > 0.01) {
          return reply.status(400).send({
            error: "Invalid Installments",
            message: "Total percentage of installments must equal 100%",
          });
        }

        // Resolve a userId to use for created_by when auth is not wired
        let effectiveUserId: string | null = (request as any).userId || (request as any).user?.id || null;
        if (!effectiveUserId) {
          try {
            const ures = await client.query('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [request.tenantId]);
            if (ures.rows.length > 0) {
              effectiveUserId = ures.rows[0].id;
            } else {
              const bcrypt = require('bcryptjs');
              const passwordHash = await bcrypt.hash('testpassword123', 10);
              const ui = await client.query(
                'INSERT INTO users (email, name, password_hash, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id',
                [`tuition-${Date.now()}@example.com`, 'Tuition User', passwordHash, request.tenantId]
              );
              effectiveUserId = ui.rows[0].id;
            }
          } catch (e) {
            fastify.log.warn(`Unable to resolve user for created_by: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Check for duplicate schedule name
        let effectiveClassId = scheduleData.classId ?? null;
        
        // If programmeId is provided, find the first class for that programme
        if (scheduleData.programmeId && !effectiveClassId) {
          try {
            const programmeClassQuery = `
              SELECT c.id
              FROM classes c
              WHERE c.programme_id = $1 AND c.tenant_id = $2
              ORDER BY c.created_at ASC
              LIMIT 1
            `;
            const programmeClassResult = await client.query(programmeClassQuery, [scheduleData.programmeId, request.tenantId]);
            if (programmeClassResult.rows.length > 0) {
              effectiveClassId = programmeClassResult.rows[0].id;
              fastify.log.info(`Mapped programmeId ${scheduleData.programmeId} to classId ${effectiveClassId}`);
            } else {
              fastify.log.warn(`No classes found for programmeId ${scheduleData.programmeId} for tenant ${request.tenantId}; defaulting to NULL`);
              effectiveClassId = null;
            }
          } catch (e) {
            fastify.log.warn(`Programme to class mapping failed: ${e instanceof Error ? e.message : String(e)}`);
            effectiveClassId = null;
          }
        }

        // If cycleId is provided, find the first class for that cycle (back-compat)
        if (scheduleData.cycleId && !effectiveClassId) {
          try {
            const cycleClassQuery = `
              SELECT c.id
              FROM classes c
              JOIN programmes p ON c.programme_id = p.id
              WHERE p.cycle_id = $1 AND c.tenant_id = $2
              LIMIT 1
            `;
            const cycleClassResult = await client.query(cycleClassQuery, [scheduleData.cycleId, request.tenantId]);
            if (cycleClassResult.rows.length > 0) {
              effectiveClassId = cycleClassResult.rows[0].id;
              fastify.log.info(`Mapped cycleId ${scheduleData.cycleId} to classId ${effectiveClassId}`);
            } else {
              fastify.log.warn(`No classes found for cycleId ${scheduleData.cycleId} for tenant ${request.tenantId}; defaulting to NULL`);
              effectiveClassId = null;
            }
          } catch (e) {
            fastify.log.warn(`Cycle to class mapping failed: ${e instanceof Error ? e.message : String(e)}`);
            effectiveClassId = null;
          }
        }
        
        // Back-compat guard: if provided classId is not a valid class for this tenant, default to NULL (applies to all classes)
        if (effectiveClassId) {
          try {
            const cls = await client.query('SELECT 1 FROM classes WHERE id = $1 AND tenant_id = $2', [effectiveClassId, request.tenantId]);
            if (cls.rowCount === 0) {
              fastify.log.warn(`Provided classId ${effectiveClassId} not found for tenant ${request.tenantId}; defaulting to NULL`);
              effectiveClassId = null;
            }
          } catch (e) {
            fastify.log.warn(`Class validation failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const duplicateCheck = await client.query(
          `SELECT id, schedule_name FROM tuition_payment_schedules
           WHERE tenant_id = $1 AND academic_year_id = $2 AND (class_id = $3 OR ($3 IS NULL AND class_id IS NULL)) AND schedule_name = $4`,
          [request.tenantId, scheduleData.academicYearId, effectiveClassId, scheduleData.scheduleName]
        );

        if (duplicateCheck.rows.length > 0) {
          return reply.status(409).send({
            error: "Duplicate Schedule",
            message: "A schedule with this name already exists for the specified academic year and cycle",
            existingScheduleId: duplicateCheck.rows[0].id,
            existingScheduleName: duplicateCheck.rows[0].schedule_name,
          });
        }

        const insertQuery = `
          INSERT INTO tuition_payment_schedules (
            tenant_id, academic_year_id, class_id, schedule_name,
            installments, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `;

        const result = await client.query(insertQuery, [
          request.tenantId,
          scheduleData.academicYearId,
          effectiveClassId,
          scheduleData.scheduleName,
          JSON.stringify(scheduleData.installments),
          effectiveUserId,
        ]);

        const schedule = result.rows[0];

        return reply.status(201).send({
          data: {
            id: schedule.id,
            tenantId: schedule.tenant_id,
            academicYearId: schedule.academic_year_id,
            // Primary (new) fields
            classId: schedule.class_id,
            // Back-compat
            cycleId: schedule.class_id,
            scheduleName: schedule.schedule_name,
            installments: schedule.installments,
            isActive: schedule.is_active,
            createdBy: schedule.created_by,
            createdAt: new Date(schedule.created_at),
            updatedAt: new Date(schedule.updated_at),
          },
        });
      } catch (error) {
        console.error("Error creating tuition schedule:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create tuition schedule",
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/tuition-schedules/:scheduleId - Update tuition payment schedule
  fastify.put("/:scheduleId", {
    schema: {
      params: {
        type: "object",
        required: ["scheduleId"],
        properties: {
          scheduleId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          // Back-compat: accept cycleId but map to classId internally
          cycleId: { type: "string", format: "uuid" },
          scheduleName: { type: "string", minLength: 1, maxLength: 100 },
          installments: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["percentage", "dueDate", "label"],
              properties: {
                percentage: { type: "number", minimum: 0, maximum: 100 },
                dueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                label: { type: "string", minLength: 1, maxLength: 100 },
              },
            },
          },
          isActive: { type: "boolean" },
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

      const { scheduleId } = request.params as { scheduleId: string };
      const updateData = request.body as any;
      const client = await pool.connect();

      try {


        // Check if schedule exists
        const existingSchedule = await client.query(
          "SELECT * FROM tuition_payment_schedules WHERE id = $1 AND tenant_id = $2",
          [scheduleId, request.tenantId]
        );

        if (existingSchedule.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Tuition schedule not found",
          });
        }

        // Validate installments if provided
        if (updateData.installments) {
          const totalPercentage = updateData.installments.reduce(
            (sum: number, inst: any) => sum + inst.percentage,
            0
          );

          if (Math.abs(totalPercentage - 100) > 0.01) {
            return reply.status(400).send({
              error: "Invalid Installments",
              message: "Total percentage of installments must equal 100%",
            });
          }
        }

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (updateData.scheduleName) {
          updateFields.push(`schedule_name = $${paramIndex}`);
          updateValues.push(updateData.scheduleName);
          paramIndex++;
        }

        if (updateData.installments) {
          updateFields.push(`installments = $${paramIndex}`);
          updateValues.push(JSON.stringify(updateData.installments));
          paramIndex++;
        }

        if (updateData.isActive !== undefined) {
          updateFields.push(`is_active = $${paramIndex}`);
          updateValues.push(updateData.isActive);
          paramIndex++;
        }

        updateFields.push(`updated_at = NOW()`);
        updateValues.push(scheduleId, request.tenantId);

        const updateQuery = `
          UPDATE tuition_payment_schedules
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING *
        `;

        const result = await client.query(updateQuery, updateValues);
        const schedule = result.rows[0];

        return reply.send({
          data: {
            id: schedule.id,
            tenantId: schedule.tenant_id,
            academicYearId: schedule.academic_year_id,
            // Primary (new) fields
            classId: schedule.class_id,
            // Back-compat
            cycleId: schedule.class_id,
            scheduleName: schedule.schedule_name,
            installments: schedule.installments,
            isActive: schedule.is_active,
            createdBy: schedule.created_by,
            createdAt: new Date(schedule.created_at),
            updatedAt: new Date(schedule.updated_at),
          },
        });
      } catch (error) {
        console.error("Error updating tuition schedule:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to update tuition schedule",
        });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/tuition-schedules/:scheduleId - Delete tuition payment schedule
  fastify.delete("/:scheduleId", {
    schema: {
      params: {
        type: "object",
        required: ["scheduleId"],
        properties: {
          scheduleId: { type: "string", format: "uuid" },
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

      const { scheduleId } = request.params as { scheduleId: string };
      const client = await pool.connect();

      // Ensure tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

      try {
        await client.query("BEGIN");

        // Ensure schedule exists for tenant
        const scheduleResult = await client.query(
          "SELECT id FROM tuition_payment_schedules WHERE id = $1 AND tenant_id = $2",
          [scheduleId, request.tenantId]
        );

        if (scheduleResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Tuition schedule not found",
          });
        }

        // Check if schedule has associated installments
        const installmentsCheck = await client.query(
          "SELECT COUNT(*) as count FROM student_tuition_installments WHERE schedule_id = $1 AND tenant_id = $2",
          [scheduleId, request.tenantId]
        );

        const installmentsCount = parseInt(installmentsCheck.rows[0].count, 10);

        if (installmentsCount > 0) {
          // Block deletion only if installments are referenced by payment data.
          // Otherwise, remove installments first then delete schedule.
          const paymentTxCheck = await client.query(
            `SELECT COUNT(*) as count
             FROM payment_transactions pt
             JOIN student_tuition_installments sti ON sti.id = pt.tuition_installment_id
             WHERE sti.schedule_id = $1 AND sti.tenant_id = $2`,
            [scheduleId, request.tenantId]
          );

          const paymentNotifCheck = await client.query(
            `SELECT COUNT(*) as count
             FROM payment_notifications pn
             JOIN student_tuition_installments sti ON sti.id = pn.tuition_installment_id
             WHERE sti.schedule_id = $1 AND sti.tenant_id = $2`,
            [scheduleId, request.tenantId]
          );

          const paymentTxCount = parseInt(paymentTxCheck.rows[0].count, 10);
          const paymentNotifCount = parseInt(paymentNotifCheck.rows[0].count, 10);

          if (paymentTxCount > 0 || paymentNotifCount > 0) {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              error: "Cannot Delete",
              message: `Impossible de supprimer cet echeancier: ${paymentTxCount} transaction(s) et ${paymentNotifCount} notification(s) sont liees aux echeances generees.`,
            });
          }

          await client.query(
            "DELETE FROM student_tuition_installments WHERE schedule_id = $1 AND tenant_id = $2",
            [scheduleId, request.tenantId]
          );
        }

        const deleteResult = await client.query(
          "DELETE FROM tuition_payment_schedules WHERE id = $1 AND tenant_id = $2 RETURNING id",
          [scheduleId, request.tenantId]
        );

        if (deleteResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Tuition schedule not found",
          });
        }

        await client.query("COMMIT");
        return reply.status(204).send();
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Error deleting tuition schedule:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to delete tuition schedule",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/tuition-schedules/generate-installments - Generate per-student installments from a schedule
  fastify.post("/generate-installments", {
    schema: {
      body: {
        type: "object",
        required: ["scheduleId"],
        properties: {
          scheduleId: { type: "string", format: "uuid" },
          enrollmentIds: {
            type: "array",
            items: { type: "string", format: "uuid" }
          },
          overwriteExisting: { type: "boolean", default: false },
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

      const { scheduleId, enrollmentIds, overwriteExisting = false } = request.body as any;
      const client = await pool.connect();

      // Ensure tenant context for RLS
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Load schedule
        const scheduleRes = await client.query(
          `SELECT id, tenant_id, academic_year_id, class_id, installments
           FROM tuition_payment_schedules
           WHERE id = $1 AND tenant_id = $2`,
          [scheduleId, request.tenantId]
        );

        if (scheduleRes.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Tuition schedule not found",
          });
        }

        const schedule = scheduleRes.rows[0];
        const installments: Array<{ percentage: number; dueDate: string; label: string }> = schedule.installments || [];
        if (!installments.length) {
          return reply.status(400).send({
            error: "Invalid Schedule",
            message: "Schedule has no installments to generate",
          });
        }

        // Fetch eligible enrollments
        // If schedule has a class_id, we find all classes in the same programme (filiere)
        let programmeId: string | null = null;
        if (schedule.class_id) {
          const programmeQuery = `
            SELECT c.programme_id
            FROM classes c
            WHERE c.id = $1 AND c.tenant_id = $2
          `;
          const programmeResult = await client.query(programmeQuery, [schedule.class_id, request.tenantId]);
          if (programmeResult.rows.length > 0) {
            programmeId = programmeResult.rows[0].programme_id;
          }
        }

        let paramIndex = 1;
        const whereParts: string[] = [];
        const params: any[] = [];
        whereParts.push(`se.tenant_id = $${paramIndex++}`); params.push(request.tenantId);
        whereParts.push(`se.academic_year_id = $${paramIndex++}`); params.push(schedule.academic_year_id);
        whereParts.push(`se.status = 'active'`);
        
        if (schedule.class_id && programmeId) {
          // If schedule has a class_id, find all enrollments in classes of the same programme
          whereParts.push(`c.programme_id = $${paramIndex}`);
          params.push(programmeId);
          paramIndex++;
        } else if (schedule.class_id) {
          // Fallback: exact class match if programme not found
          whereParts.push(`se.class_id = $${paramIndex++}`);
          params.push(schedule.class_id);
        }
        
        if (enrollmentIds && enrollmentIds.length > 0) {
          whereParts.push(`se.id = ANY($${paramIndex++})`);
          params.push(enrollmentIds);
        }

        const enrollmentsQuery = `
          SELECT se.id, se.student_id, se.fees
          FROM student_enrollments se
          ${schedule.class_id && programmeId ? 'JOIN classes c ON se.class_id = c.id' : ''}
          WHERE ${whereParts.join(' AND ')}
        `;
        
        const enrollmentsRes = await client.query(enrollmentsQuery, params);

        if (enrollmentsRes.rows.length === 0) {
          return reply.send({ data: { scheduleId, processedEnrollments: 0, createdCount: 0, overwritten: false } });
        }

        await client.query('BEGIN');

        // Optionally remove existing installments for these enrollments
        if (overwriteExisting) {
          const delParams: any[] = [request.tenantId, scheduleId];
          let delQuery = `DELETE FROM student_tuition_installments WHERE tenant_id = $1 AND schedule_id = $2`;
          if (enrollmentIds && enrollmentIds.length > 0) {
            delParams.push(enrollmentIds);
            delQuery += ` AND enrollment_id = ANY($3)`;
          }
          await client.query(delQuery, delParams);
        }

        // Build a map of existing installments to allow updating (or skipping if overwriting)
        const existingSet = new Set<string>();
        const existingMap = new Map<string, string>(); // key -> installment id
        if (!overwriteExisting) {
          const exParams: any[] = [request.tenantId, scheduleId];
          let exQuery = `SELECT id, enrollment_id, installment_number FROM student_tuition_installments WHERE tenant_id = $1 AND schedule_id = $2`;
          if (enrollmentIds && enrollmentIds.length > 0) {
            exParams.push(enrollmentIds);
            exQuery += ` AND enrollment_id = ANY($3)`;
          }
          const exRes = await client.query(exQuery, exParams);
          for (const row of exRes.rows) {
            const key = `${row.enrollment_id}:${row.installment_number}`;
            existingSet.add(key);
            existingMap.set(key, row.id);
          }
        }

        // Prepare bulk insert and updates
        const insertValues: any[] = [];
        const tuples: string[] = [];
        const updates: Array<{ id: string; amount: number; label: string; dueDate: string }> = [];
        let i = 1;

        for (const enr of enrollmentsRes.rows) {
          const scolarite = parseFloat(enr.fees?.scolarite ?? enr.fees?.scolarité ?? enr.fees?.SCOLARITE ?? 0);
          if (!scolarite || scolarite <= 0) continue;

          for (let idx = 0; idx < installments.length; idx++) {
            const inst = installments[idx];
            const installmentNumber = idx + 1;
            const key = `${enr.id}:${installmentNumber}`;
            // Compute amount = (scolarite * percentage) / 100, rounded to 2 decimals
            const rawAmount = (scolarite * Number(inst.percentage)) / 100;
            const amount = Math.round(rawAmount * 100) / 100;

            if (existingMap.has(key)) {
              // Update existing installment (label, amount, due_date)
              updates.push({ id: existingMap.get(key)!, amount, label: inst.label, dueDate: inst.dueDate });
            } else {
              tuples.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
              insertValues.push(
                request.tenantId,
                enr.student_id,
                enr.id,
                scheduleId,
                installmentNumber,
                inst.label,
                amount,
                inst.dueDate
              );
            }
          }
        }

        let createdCount = 0;
        if (tuples.length > 0) {
          const insertSql = `INSERT INTO student_tuition_installments (
              tenant_id, student_id, enrollment_id, schedule_id,
              installment_number, installment_label, amount, due_date
            ) VALUES ${tuples.join(', ')}`;
          const insRes = await client.query(insertSql, insertValues);
          createdCount = insRes.rowCount || 0;
        }

        let updatedCount = 0;
        if (updates.length > 0) {
          for (const u of updates) {
            const res = await client.query(
              `UPDATE student_tuition_installments
               SET installment_label = $1, amount = $2, due_date = $3, updated_at = NOW()
               WHERE id = $4`,
              [u.label, u.amount, u.dueDate, u.id]
            );
            updatedCount += res.rowCount || 0;
          }
        }

        await client.query('COMMIT');

        return reply.send({
          data: {
            scheduleId,
            processedEnrollments: enrollmentsRes.rows.length,
            createdCount,
            updatedCount,
            overwritten: !!overwriteExisting,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error("Error generating tuition installments:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to generate tuition installments",
        });
      } finally {
        client.release();
      }
    },
  });
}
