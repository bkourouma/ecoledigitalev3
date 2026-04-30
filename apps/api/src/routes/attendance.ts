import { FastifyInstance } from "fastify";
import {
  AttendanceSessionSchema,
  CreateAttendanceSessionSchema,
  UpdateAttendanceSessionSchema,
  StudentAttendanceSchema,
  CreateStudentAttendanceSchema,
  UpdateStudentAttendanceSchema,
  AttendanceSessionQuerySchema,
  StudentAttendanceQuerySchema,
  AttendanceSummarySchema,
  ClassAttendanceSummarySchema,
} from "@ecoledigitale/contracts/src/attendance";

// Temporary inline schema until contracts build issue is resolved
import { z } from "zod";
const BatchAttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  attendanceStatus: z.enum(["present", "absent", "late", "excused", "medical_leave"]),
  arrivalTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  departureTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  excuseReason: z.string().optional(),
  notes: z.string().optional(),
});

const BatchAttendanceSchema = z.object({
  attendanceRecords: z.array(BatchAttendanceRecordSchema).min(1),
  notes: z.string().optional(),
});

export async function attendanceRoutes(fastify: FastifyInstance) {
  // Import session instances routes
  const { sessionInstancesRoutes } = await import('./session-instances');

  // Register session instances routes
  await fastify.register(sessionInstancesRoutes);

  // ========================================
  // ATTENDANCE SESSIONS ENDPOINTS
  // ========================================

  // GET /api/v1/attendance/sessions - List attendance sessions
  fastify.get("/sessions", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          classCourseId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          status: { type: "string", enum: ["scheduled", "in_progress", "completed", "cancelled"] },
          sessionType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"] },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
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

      const query = request.query as any;
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Build dynamic query
        let whereConditions = ["s.tenant_id = $1"];
        let queryParams = [request.tenantId];
        let paramIndex = 2;

        if (query.classCourseId) {
          whereConditions.push(`s.class_course_id = $${paramIndex}`);
          queryParams.push(query.classCourseId);
          paramIndex++;
        }

        if (query.teacherId) {
          whereConditions.push(`s.teacher_id = $${paramIndex}`);
          queryParams.push(query.teacherId);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`s.session_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`s.session_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        if (query.status) {
          whereConditions.push(`s.status = $${paramIndex}`);
          queryParams.push(query.status);
          paramIndex++;
        }

        if (query.sessionType) {
          whereConditions.push(`s.session_type = $${paramIndex}`);
          queryParams.push(query.sessionType);
          paramIndex++;
        }

        const sessionsQuery = `
          SELECT
            s.*,
            t.first_name || ' ' || t.last_name as teacher_name,
            cc.id as class_course_id,
            c.name as class_name,
            co.name as course_name
          FROM attendance_sessions s
          JOIN teachers t ON s.teacher_id = t.id
          JOIN class_courses cc ON s.class_course_id = cc.id
          JOIN classes c ON cc.class_id = c.id
          JOIN courses co ON cc.course_id = co.id
          WHERE ${whereConditions.join(" AND ")}
          ORDER BY s.session_date DESC, s.session_time DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(String(query.limit), String(offset));

        const result = await client.query(sessionsQuery, queryParams);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM attendance_sessions s
          JOIN teachers t ON s.teacher_id = t.id
          JOIN class_courses cc ON s.class_course_id = cc.id
          JOIN classes c ON cc.class_id = c.id
          JOIN courses co ON cc.course_id = co.id
          WHERE ${whereConditions.join(" AND ")}
        `;

        const countResult = await client.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        const sessions = result.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          classCourseId: row.class_course_id,
          teacherId: row.teacher_id,
          classroomId: row.classroom_id,
          sessionDate: row.session_date,
          sessionTime: row.session_time,
          durationMinutes: row.duration_minutes,
          sessionType: row.session_type,
          location: row.location,
          notes: row.notes,
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          // Additional info
          teacherName: row.teacher_name,
          className: row.class_name,
          courseName: row.course_name,
        }));

        return reply.send({
          data: sessions,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            pages: Math.ceil(total / query.limit),
          },
        });

      } catch (error) {
        fastify.log.error(`Error fetching attendance sessions: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch attendance sessions",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/attendance/sessions - Create attendance session
  fastify.post("/sessions", {
    schema: {
      body: {
        type: "object",
        required: ["classCourseId", "teacherId", "sessionDate", "sessionTime"],
        properties: {
          classCourseId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          classroomId: { type: "string", format: "uuid" },
          sessionDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          sessionTime: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$" },
          durationMinutes: { type: "number", minimum: 1, default: 120 },
          sessionType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"], default: "theory" },
          location: { type: "string" },
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

      const data = CreateAttendanceSessionSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Verify class course exists and belongs to tenant
        const classCourseQuery = `
          SELECT cc.id, cc.class_id, cc.course_id
          FROM class_courses cc
          WHERE cc.id = $1 AND cc.tenant_id = $2
        `;
        const classCourseResult = await client.query(classCourseQuery, [data.classCourseId, request.tenantId]);

        if (classCourseResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Class course not found",
          });
        }

        // Verify teacher exists and belongs to tenant
        const teacherQuery = `
          SELECT id FROM teachers
          WHERE id = $1 AND tenant_id = $2 AND status = 'active'
        `;
        const teacherResult = await client.query(teacherQuery, [data.teacherId, request.tenantId]);

        if (teacherResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher not found or inactive",
          });
        }

        // Verify classroom exists and belongs to tenant (if provided)
        if (data.classroomId) {
          const classroomQuery = `
            SELECT id FROM classrooms
            WHERE id = $1 AND tenant_id = $2 AND is_active = true
          `;
          const classroomResult = await client.query(classroomQuery, [data.classroomId, request.tenantId]);
          if (classroomResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Classroom not found or inactive",
            });
          }
        }


        // Create attendance session
        const insertQuery = `
          INSERT INTO attendance_sessions (
            tenant_id, class_course_id, teacher_id, classroom_id, session_date, session_time,
            duration_minutes, session_type, location, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `;

        const insertResult = await client.query(insertQuery, [
          request.tenantId,
          data.classCourseId,
          data.teacherId,
          data.classroomId || null,
          data.sessionDate,
          data.sessionTime,
          data.durationMinutes,
          data.sessionType,
          data.location || null,
          data.notes || null,
        ]);

        await client.query('COMMIT');

        const session = insertResult.rows[0];
        return reply.status(201).send({
          data: {
            id: session.id,
            tenantId: session.tenant_id,
            classCourseId: session.class_course_id,
            teacherId: session.teacher_id,
            classroomId: session.classroom_id,
            sessionDate: session.session_date,
            sessionTime: session.session_time,
            durationMinutes: session.duration_minutes,
            sessionType: session.session_type,
            location: session.location,
            notes: session.notes,
            status: session.status,
            startedAt: session.started_at,
            completedAt: session.completed_at,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
          },
        });

      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error creating attendance session: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create attendance session",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/attendance/sessions/:id - Get attendance session details
  fastify.get("/sessions/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
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
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        const sessionQuery = `
          SELECT
            s.*,
            t.first_name || ' ' || t.last_name as teacher_name,
            c.name as class_name,
            co.name as course_name,
            COUNT(sa.id) as total_students,
            COUNT(CASE WHEN sa.attendance_status = 'present' THEN 1 END) as present_count,
            COUNT(CASE WHEN sa.attendance_status = 'absent' THEN 1 END) as absent_count,
            COUNT(CASE WHEN sa.attendance_status = 'late' THEN 1 END) as late_count,
            COUNT(CASE WHEN sa.attendance_status = 'excused' THEN 1 END) as excused_count
          FROM attendance_sessions s
          JOIN teachers t ON s.teacher_id = t.id
          JOIN class_courses cc ON s.class_course_id = cc.id
          JOIN classes c ON cc.class_id = c.id
          JOIN courses co ON cc.course_id = co.id
          LEFT JOIN student_attendance sa ON s.id = sa.session_id
          WHERE s.id = $1 AND s.tenant_id = $2
          GROUP BY s.id, t.first_name, t.last_name, c.name, co.name
        `;

        const result = await client.query(sessionQuery, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Attendance session not found",
          });
        }

        const session = result.rows[0];
        return reply.send({
          data: {
            id: session.id,
            tenantId: session.tenant_id,
            classCourseId: session.class_course_id,
            teacherId: session.teacher_id,
            classroomId: session.classroom_id,
            sessionDate: session.session_date,
            sessionTime: session.session_time,
            durationMinutes: session.duration_minutes,
            sessionType: session.session_type,
            location: session.location,
            notes: session.notes,
            status: session.status,
            startedAt: session.started_at,
            completedAt: session.completed_at,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
            // Additional info
            teacherName: session.teacher_name,
            className: session.class_name,
            courseName: session.course_name,
            // Statistics
            totalStudents: parseInt(session.total_students),
            presentCount: parseInt(session.present_count),
            absentCount: parseInt(session.absent_count),
            lateCount: parseInt(session.late_count),
            excusedCount: parseInt(session.excused_count),
          },
        });

      } catch (error) {
        fastify.log.error(`Error fetching attendance session: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch attendance session",
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/attendance/sessions/:id - Update attendance session
  fastify.put("/sessions/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          sessionDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          sessionTime: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$" },
          durationMinutes: { type: "number", minimum: 1 },
          sessionType: { type: "string", enum: ["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"] },
          classroomId: { type: "string", format: "uuid" },
          location: { type: "string" },
          notes: { type: "string" },
          status: { type: "string", enum: ["scheduled", "in_progress", "completed", "cancelled"] },
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
      const data = UpdateAttendanceSessionSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Check if session exists
        const existsQuery = `
          SELECT id, status FROM attendance_sessions
          WHERE id = $1 AND tenant_id = $2
        `;
        const existsResult = await client.query(existsQuery, [id, request.tenantId]);

        if (existsResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Attendance session not found",
          });
        }

        // Build dynamic update query
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 3;

        if (data.sessionDate) {
          updateFields.push(`session_date = $${paramIndex}`);
          updateValues.push(data.sessionDate);
          paramIndex++;
        }

        if (data.sessionTime) {
          updateFields.push(`session_time = $${paramIndex}`);
          updateValues.push(data.sessionTime);
          paramIndex++;
        }

        if (data.durationMinutes) {
          updateFields.push(`duration_minutes = $${paramIndex}`);
          updateValues.push(data.durationMinutes);
          paramIndex++;
        }

        if (data.sessionType) {
          updateFields.push(`session_type = $${paramIndex}`);
          updateValues.push(data.sessionType);
          paramIndex++;
        }

        if (data.classroomId !== undefined) {
          updateFields.push(`classroom_id = $${paramIndex}`);
          updateValues.push(data.classroomId);
          paramIndex++;
        }

        if (data.location !== undefined) {
          updateFields.push(`location = $${paramIndex}`);
          updateValues.push(data.location);
          paramIndex++;
        }

        if (data.notes !== undefined) {
          updateFields.push(`notes = $${paramIndex}`);
          updateValues.push(data.notes);
          paramIndex++;
        }

        if (data.status) {
          updateFields.push(`status = $${paramIndex}`);
          updateValues.push(data.status);
          paramIndex++;

          // Handle status-specific timestamps
          if (data.status === 'in_progress') {
            updateFields.push(`started_at = NOW()`);
          } else if (data.status === 'completed') {
            updateFields.push(`completed_at = NOW()`);
          }
        }

        if (updateFields.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        const updateQuery = `
          UPDATE attendance_sessions
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
          RETURNING *
        `;

        const updateResult = await client.query(updateQuery, [id, request.tenantId, ...updateValues]);

        await client.query('COMMIT');

        const session = updateResult.rows[0];
        return reply.send({
          data: {
            id: session.id,
            tenantId: session.tenant_id,
            classCourseId: session.class_course_id,
            teacherId: session.teacher_id,
            sessionDate: session.session_date,
            sessionTime: session.session_time,
            durationMinutes: session.duration_minutes,
            sessionType: session.session_type,
            location: session.location,
            notes: session.notes,
            status: session.status,
            startedAt: session.started_at,
            completedAt: session.completed_at,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
          },
        });

      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error updating attendance session: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to update attendance session",
        });
      } finally {
        client.release();
      }
    },
  });

  // ========================================
  // STUDENT ATTENDANCE ENDPOINTS
  // ========================================

  // GET /api/v1/attendance/records - List attendance records
  fastify.get("/records", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          sessionId: { type: "string", format: "uuid" },
          studentId: { type: "string", format: "uuid" },
          attendanceStatus: { type: "string", enum: ["present", "absent", "late", "excused", "medical_leave"] },
          startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
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

      const query = request.query as any;
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Check if sessionId is from teacher_attendance_sessions or attendance_sessions
        let isTeacherSession = false;
        if (query.sessionId) {
          const teacherSessionCheck = await client.query(`
            SELECT id FROM teacher_attendance_sessions WHERE id = $1 AND tenant_id = $2 LIMIT 1
          `, [query.sessionId, request.tenantId]);
          isTeacherSession = teacherSessionCheck.rows.length > 0;
        }

        let result: any;
        let total: number;

        // Build dynamic query based on session type
        let whereConditions: string[] = [];
        let queryParams: any[] = [];
        let paramIndex = 1;

        if (isTeacherSession) {
          // Query from teacher_attendance_records
          whereConditions.push(`tar.tenant_id = $${paramIndex}`);
          queryParams.push(request.tenantId);
          paramIndex++;

          if (query.sessionId) {
            whereConditions.push(`tar.session_id = $${paramIndex}`);
            queryParams.push(query.sessionId);
            paramIndex++;
          }

          if (query.studentId) {
            whereConditions.push(`tar.student_id = $${paramIndex}`);
            queryParams.push(query.studentId);
            paramIndex++;
          }

          if (query.attendanceStatus) {
            whereConditions.push(`tar.attendance_status = $${paramIndex}`);
            queryParams.push(query.attendanceStatus);
            paramIndex++;
          }

          if (query.startDate) {
            whereConditions.push(`s.session_date >= $${paramIndex}`);
            queryParams.push(query.startDate);
            paramIndex++;
          }

          if (query.endDate) {
            whereConditions.push(`s.session_date <= $${paramIndex}`);
            queryParams.push(query.endDate);
            paramIndex++;
          }

          const recordsQuery = `
            SELECT
              tar.id,
              tar.tenant_id,
              tar.session_id,
              tar.student_id,
              tar.attendance_status,
              NULL as arrival_time,
              NULL as departure_time,
              NULL as excuse_reason,
              NULL as excuse_document_url,
              tar.marked_by,
              tar.marked_at,
              false as is_makeup,
              tar.notes,
              tar.created_at,
              tar.updated_at,
              s.session_date,
              s.time_slot as session_time,
              'teacher' as session_type,
              sp.student_number,
              u.first_name || ' ' || u.last_name as student_name,
              c.name as class_name,
              co.name as course_name
            FROM teacher_attendance_records tar
            JOIN teacher_attendance_sessions s ON tar.session_id = s.id
            JOIN student_profiles sp ON tar.student_id = sp.id
            JOIN users u ON sp.user_id = u.id
            LEFT JOIN teacher_assignments ta ON s.assignment_id = ta.id
            LEFT JOIN class_courses cc ON ta.class_course_id = cc.id
            LEFT JOIN classes c ON cc.class_id = c.id
            LEFT JOIN courses co ON cc.course_id = co.id
            WHERE ${whereConditions.join(" AND ")}
            ORDER BY s.session_date DESC, s.time_slot DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
          `;

          queryParams.push(String(query.limit), String(offset));

          result = await client.query(recordsQuery, queryParams);

          // Get total count
          const countQuery = `
            SELECT COUNT(*) as total
            FROM teacher_attendance_records tar
            JOIN teacher_attendance_sessions s ON tar.session_id = s.id
            WHERE ${whereConditions.join(" AND ")}
          `;

          const countResult = await client.query(countQuery, queryParams.slice(0, -2));
          total = parseInt(countResult.rows[0].total);
        } else {
          // Query from student_attendance (original logic)
          whereConditions.push(`sa.tenant_id = $${paramIndex}`);
          queryParams.push(request.tenantId);
          paramIndex++;

          if (query.sessionId) {
            whereConditions.push(`sa.session_id = $${paramIndex}`);
            queryParams.push(query.sessionId);
            paramIndex++;
          }

          if (query.studentId) {
            whereConditions.push(`sa.student_id = $${paramIndex}`);
            queryParams.push(query.studentId);
            paramIndex++;
          }

          if (query.attendanceStatus) {
            whereConditions.push(`sa.attendance_status = $${paramIndex}`);
            queryParams.push(query.attendanceStatus);
            paramIndex++;
          }

          if (query.startDate) {
            whereConditions.push(`s.session_date >= $${paramIndex}`);
            queryParams.push(query.startDate);
            paramIndex++;
          }

          if (query.endDate) {
            whereConditions.push(`s.session_date <= $${paramIndex}`);
            queryParams.push(query.endDate);
            paramIndex++;
          }

          const recordsQuery = `
            SELECT
              sa.*,
              s.session_date,
              s.session_time,
              s.session_type,
              sp.student_number,
              u.first_name || ' ' || u.last_name as student_name,
              c.name as class_name,
              co.name as course_name
            FROM student_attendance sa
            JOIN attendance_sessions s ON sa.session_id = s.id
            JOIN student_profiles sp ON sa.student_id = sp.id
            JOIN users u ON sp.user_id = u.id
            JOIN class_courses cc ON s.class_course_id = cc.id
            JOIN classes c ON cc.class_id = c.id
            JOIN courses co ON cc.course_id = co.id
            WHERE ${whereConditions.join(" AND ")}
            ORDER BY s.session_date DESC, s.session_time DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
          `;

          queryParams.push(String(query.limit), String(offset));

          result = await client.query(recordsQuery, queryParams);

          // Get total count
          const countQuery = `
            SELECT COUNT(*) as total
            FROM student_attendance sa
            JOIN attendance_sessions s ON sa.session_id = s.id
            WHERE ${whereConditions.join(" AND ")}
          `;

          const countResult = await client.query(countQuery, queryParams.slice(0, -2));
          total = parseInt(countResult.rows[0].total);
        }

        const records = result.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          sessionId: row.session_id,
          studentId: row.student_id,
          attendanceStatus: row.attendance_status,
          arrivalTime: row.arrival_time,
          departureTime: row.departure_time,
          excuseReason: row.excuse_reason,
          excuseDocumentUrl: row.excuse_document_url,
          markedBy: row.marked_by,
          markedAt: row.marked_at,
          isMakeup: row.is_makeup,
          notes: row.notes,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          // Additional info
          sessionDate: row.session_date,
          sessionTime: row.session_time,
          sessionType: row.session_type,
          studentNumber: row.student_number,
          studentName: row.student_name,
          className: row.class_name,
          courseName: row.course_name,
        }));

        return reply.send({
          data: records,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            pages: Math.ceil(total / query.limit),
          },
        });

      } catch (error) {
        fastify.log.error(`Error fetching attendance records: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch attendance records",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/attendance/sessions/:sessionId/batch - Batch mark attendance
  fastify.post("/sessions/:sessionId/batch", {
    schema: {
      params: {
        type: "object",
        required: ["sessionId"],
        properties: {
          sessionId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        required: ["attendanceRecords"],
        properties: {
          attendanceRecords: {
            type: "array",
            items: {
              type: "object",
              required: ["studentId", "attendanceStatus"],
              properties: {
                studentId: { type: "string", format: "uuid" },
                attendanceStatus: { type: "string", enum: ["present", "absent", "late", "excused", "medical_leave"] },
                arrivalTime: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$" },
                departureTime: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$" },
                excuseReason: { type: "string" },
                notes: { type: "string" },
              },
            },
          },
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

      const { sessionId } = request.params as { sessionId: string };
      const data = BatchAttendanceSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Verify session exists - check attendance_sessions first, then session_instances
        let sessionType: 'attendance_session' | 'session_instance' | null = null;
        
        // First check if it's an attendance_session
        const attendanceSessionQuery = `
          SELECT id FROM attendance_sessions
          WHERE id = $1 AND tenant_id = $2
        `;
        const attendanceSessionResult = await client.query(attendanceSessionQuery, [sessionId, request.tenantId]);
        
        if (attendanceSessionResult.rows.length > 0) {
          sessionType = 'attendance_session';
        } else {
          // Check if it's a session_instance
          const sessionInstanceCheckQuery = `
            SELECT id FROM session_instances
            WHERE id = $1 AND tenant_id = $2
          `;
          const sessionInstanceCheckResult = await client.query(sessionInstanceCheckQuery, [sessionId, request.tenantId]);
          
          if (sessionInstanceCheckResult.rows.length > 0) {
            sessionType = 'session_instance';
          } else {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Attendance session or session instance not found",
            });
          }
        }
        
        // If it's a session_instance, we need to find or create a corresponding attendance_session
        let actualSessionId = sessionId;
        if (sessionType === 'session_instance') {
          // For session_instances, we'll create a corresponding attendance_session
          // First, get the session_instance details
          const sessionInstanceQuery = `
            SELECT si.class_id, si.course_id, si.teacher_id, si.session_date, 
                   si.start_time as session_time,
                   si.duration_minutes,
                   si.classroom as location, si.notes
            FROM session_instances si
            WHERE si.id = $1 AND si.tenant_id = $2
          `;
          const sessionInstanceResult = await client.query(sessionInstanceQuery, [sessionId, request.tenantId]);
          
          if (sessionInstanceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Session instance not found",
            });
          }
          
          const si = sessionInstanceResult.rows[0];
          
          // Validate required fields
          if (!si.class_id || !si.course_id || !si.session_date || !si.session_time) {
            await client.query('ROLLBACK');
            return reply.status(400).send({
              error: "Bad Request",
              message: "Session instance is missing required fields (class_id, course_id, session_date, or session_time)",
            });
          }
          
          // teacher_id can be NULL, but attendance_sessions requires it, so we need to handle this
          if (!si.teacher_id) {
            await client.query('ROLLBACK');
            return reply.status(400).send({
              error: "Bad Request",
              message: "Session instance must have a teacher_id to create attendance session",
            });
          }
          
          // Find or create class_course_id
          const classCourseQuery = `
            SELECT id FROM class_courses
            WHERE class_id = $1 AND course_id = $2 AND tenant_id = $3
          `;
          const classCourseResult = await client.query(classCourseQuery, [si.class_id, si.course_id, request.tenantId]);
          
          let classCourseId;
          if (classCourseResult.rows.length > 0) {
            classCourseId = classCourseResult.rows[0].id;
          } else {
            // Create class_course if it doesn't exist
            try {
              const insertClassCourseQuery = `
                INSERT INTO class_courses (tenant_id, class_id, course_id)
                VALUES ($1, $2, $3)
                RETURNING id
              `;
              const insertResult = await client.query(insertClassCourseQuery, [request.tenantId, si.class_id, si.course_id]);
              classCourseId = insertResult.rows[0].id;
            } catch (insertError: any) {
              // If insert fails due to unique constraint, try to fetch again
              if (insertError.code === '23505') { // unique_violation
                const retryResult = await client.query(classCourseQuery, [si.class_id, si.course_id, request.tenantId]);
                if (retryResult.rows.length > 0) {
                  classCourseId = retryResult.rows[0].id;
                } else {
                  throw insertError;
                }
              } else {
                throw insertError;
              }
            }
          }
          
          // Check if attendance_session already exists for this session_instance (by matching details)
          const existingSessionQuery = `
            SELECT id FROM attendance_sessions
            WHERE class_course_id = $1 AND teacher_id = $2 AND session_date = $3 
              AND session_time = $4 AND tenant_id = $5
            LIMIT 1
          `;
          const existingSessionResult = await client.query(existingSessionQuery, [
            classCourseId, si.teacher_id, si.session_date, si.session_time, request.tenantId
          ]);
          
          if (existingSessionResult.rows.length > 0) {
            actualSessionId = existingSessionResult.rows[0].id;
          } else {
            // Create attendance_session from session_instance
            const createSessionQuery = `
              INSERT INTO attendance_sessions (
                tenant_id, class_course_id, teacher_id, session_date, session_time,
                duration_minutes, location, notes, status
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')
              RETURNING id
            `;
            const createResult = await client.query(createSessionQuery, [
              request.tenantId, classCourseId, si.teacher_id, si.session_date,
              si.session_time, si.duration_minutes, si.location, si.notes
            ]);
            actualSessionId = createResult.rows[0].id;
          }
        }

        // Get user ID from request (from JWT or header)
        const userId = (request as any).user?.id || (request.headers as any)['x-user-id'] || (request as any).userId;
        if (!userId) {
          await client.query('ROLLBACK');
          return reply.status(401).send({
            error: "Unauthorized",
            message: "User ID is required to mark attendance",
          });
        }
        const markedBy = userId;

        const insertedRecords = [];

        fastify.log.info(`Processing ${data.attendanceRecords.length} attendance records for session ${actualSessionId}`);

        for (const record of data.attendanceRecords) {
          // Validate excuse reason for excused/medical_leave status
          const requiresExcuseReason = record.attendanceStatus === 'excused' || record.attendanceStatus === 'medical_leave';
          
          // Determine excuse reason: use excuseReason if provided, otherwise fall back to notes
          let excuseReason: string | null = record.excuseReason;
          if (!excuseReason && record.notes) {
            excuseReason = record.notes.trim() || null;
          }
          
          // Validate that excuse reason is provided when required
          if (requiresExcuseReason && !excuseReason) {
            await client.query('ROLLBACK');
            fastify.log.error(`Missing excuse reason for student ${record.studentId} with status ${record.attendanceStatus}`);
            return reply.status(400).send({
              error: "Bad Request",
              message: `Une raison d'excuse est requise pour le statut "${record.attendanceStatus}". Veuillez fournir une excuseReason ou notes.`,
            });
          }

          // Check if attendance record already exists
          const existsQuery = `
            SELECT id FROM student_attendance
            WHERE session_id = $1 AND student_id = $2 AND tenant_id = $3
          `;
          const existsResult = await client.query(existsQuery, [actualSessionId, record.studentId, request.tenantId]);

          if (existsResult.rows.length > 0) {
            // Update existing record
            const updateQuery = `
              UPDATE student_attendance
              SET attendance_status = $1, arrival_time = $2, departure_time = $3,
                  excuse_reason = $4, notes = $5, marked_by = $6, marked_at = NOW(), updated_at = NOW()
              WHERE session_id = $7 AND student_id = $8 AND tenant_id = $9
              RETURNING *
            `;
            const updateResult = await client.query(updateQuery, [
              record.attendanceStatus,
              record.arrivalTime || null,
              record.departureTime || null,
              excuseReason,
              record.notes || null,
              markedBy,
              actualSessionId,
              record.studentId,
              request.tenantId,
            ]);
            
            if (updateResult.rows.length === 0) {
              fastify.log.error(`Failed to update attendance record for student ${record.studentId}`);
              throw new Error(`Failed to update attendance record for student ${record.studentId}`);
            }
            
            insertedRecords.push(updateResult.rows[0]);
            fastify.log.info(`Updated attendance record for student ${record.studentId} with status ${record.attendanceStatus}`);
          } else {
            // Insert new record
            const insertQuery = `
              INSERT INTO student_attendance (
                tenant_id, session_id, student_id, attendance_status,
                arrival_time, departure_time, excuse_reason, notes, marked_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING *
            `;
            const insertResult = await client.query(insertQuery, [
              request.tenantId,
              actualSessionId,
              record.studentId,
              record.attendanceStatus,
              record.arrivalTime || null,
              record.departureTime || null,
              excuseReason,
              record.notes || null,
              markedBy,
            ]);
            
            if (insertResult.rows.length === 0) {
              fastify.log.error(`Failed to insert attendance record for student ${record.studentId}`);
              throw new Error(`Failed to insert attendance record for student ${record.studentId}`);
            }
            
            insertedRecords.push(insertResult.rows[0]);
            fastify.log.info(`Inserted attendance record for student ${record.studentId} with status ${record.attendanceStatus}`);
          }
        }

        if (insertedRecords.length === 0) {
          await client.query('ROLLBACK');
          fastify.log.error('No attendance records were inserted or updated');
          return reply.status(400).send({
            error: "Bad Request",
            message: "Aucun enregistrement de présence n'a été traité",
          });
        }

        // Update session status to completed after marking attendance
        // For 'completed' status, we need both started_at and completed_at
        const updateSessionStatusQuery = `
          UPDATE attendance_sessions
          SET status = 'completed', 
              started_at = COALESCE(started_at, NOW()),
              completed_at = NOW(), 
              updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        `;
        const updateSessionResult = await client.query(updateSessionStatusQuery, [actualSessionId, request.tenantId]);
        
        if (updateSessionResult.rowCount === 0) {
          fastify.log.warn(`Session ${actualSessionId} not found when updating status, but attendance records were saved`);
        } else {
          fastify.log.info(`Updated session ${actualSessionId} status to completed`);
        }

        await client.query('COMMIT');
        
        fastify.log.info(`Successfully committed ${insertedRecords.length} attendance records for session ${actualSessionId}`);

        return reply.status(201).send({
          data: insertedRecords.map(row => ({
            id: row.id,
            tenantId: row.tenant_id,
            sessionId: row.session_id,
            studentId: row.student_id,
            attendanceStatus: row.attendance_status,
            arrivalTime: row.arrival_time,
            departureTime: row.departure_time,
            excuseReason: row.excuse_reason,
            excuseDocumentUrl: row.excuse_document_url,
            markedBy: row.marked_by,
            markedAt: row.marked_at,
            isMakeup: row.is_makeup,
            notes: row.notes,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
          message: `Successfully processed ${insertedRecords.length} attendance records`,
        });

      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        fastify.log.error(`Error batch marking attendance: ${error}`);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('Batch attendance error details:', {
          error: errorMessage,
          stack: errorStack,
          sessionId,
          tenantId: request.tenantId
        });
        return reply.status(500).send({
          error: "Internal Server Error",
          message: errorMessage || "Failed to batch mark attendance",
        });
      } finally {
        client.release();
      }
    },
  });
}
