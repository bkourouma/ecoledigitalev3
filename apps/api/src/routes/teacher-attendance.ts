import { FastifyInstance } from "fastify";
import { z } from "zod";

const AttendanceStatusSchema = z.enum(["present", "absent", "late", "excused"]);

const AttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  status: AttendanceStatusSchema,
  notes: z.string().optional(),
});

const CreateAttendanceSchema = z.object({
  assignmentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionTitle: z.string().min(1),
  records: z.array(AttendanceRecordSchema),
});

const ListAttendanceQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assignmentId: z.string().uuid().optional(),
  status: z.enum(["draft", "pending", "completed", "rejected", "cancelled"]).optional(),
});

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
  headers: any;
  body: any;
  params: any;
}

const ensureTeacherAttendanceTables = async (client: any, fastify?: any) => {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

  // Create table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS teacher_attendance_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      assignment_id UUID NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
      class_course_id UUID REFERENCES class_courses(id) ON DELETE SET NULL,
      session_date DATE NOT NULL,
      time_slot VARCHAR(20) NOT NULL CHECK (time_slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9](-([01][0-9]|2[0-3]):[0-5][0-9])?$'),
      session_title VARCHAR(255) NOT NULL,
      duration_hours INTEGER NOT NULL,
      teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      status VARCHAR(50) DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, assignment_id, session_date, time_slot)
    )
  `);

  // Migrate old fixed-slot constraint to a flexible hour/slot format.
  try {
    await client.query(`
      ALTER TABLE teacher_attendance_sessions
      DROP CONSTRAINT IF EXISTS teacher_attendance_sessions_time_slot_check
    `);
  } catch (error) {
    if (fastify?.log) fastify.log.warn(`Could not drop time_slot constraint: ${error}`);
  }

  try {
    await client.query(`
      ALTER TABLE teacher_attendance_sessions
      ADD CONSTRAINT teacher_attendance_sessions_time_slot_check
      CHECK (time_slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9](-([01][0-9]|2[0-3]):[0-5][0-9])?$')
    `);
  } catch (error: any) {
    if (!error.message?.includes('already exists') && fastify?.log) {
      fastify.log.warn(`Could not add time_slot constraint: ${error}`);
    }
  }

  // Update the status constraint to include all statuses
  // Find and drop any existing status constraint, then recreate it
  const constraintCheck = await client.query(`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'teacher_attendance_sessions' 
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%status%'
  `);

  // Drop existing status constraints
  for (const row of constraintCheck.rows) {
    try {
      await client.query(`
        ALTER TABLE teacher_attendance_sessions 
        DROP CONSTRAINT IF EXISTS ${row.constraint_name}
      `);
    } catch (error) {
      // Ignore errors if constraint doesn't exist
      if (fastify?.log) {
        fastify.log.warn(`Could not drop constraint ${row.constraint_name}: ${error}`);
      }
    }
  }

  // Add the new constraint with all statuses
  try {
    await client.query(`
      ALTER TABLE teacher_attendance_sessions 
      ADD CONSTRAINT teacher_attendance_sessions_status_check 
      CHECK (status IN ('draft', 'pending', 'completed', 'rejected', 'cancelled'))
    `);
  } catch (error: any) {
    // If constraint already exists, that's fine
      if (!error.message?.includes('already exists')) {
        if (fastify?.log) {
          fastify.log.warn(`Could not add status constraint: ${error}`);
        }
      }
  }

  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_att_sessions_tenant ON teacher_attendance_sessions(tenant_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_att_sessions_assignment ON teacher_attendance_sessions(assignment_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_att_sessions_teacher ON teacher_attendance_sessions(teacher_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_att_sessions_date ON teacher_attendance_sessions(session_date)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS teacher_attendance_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES teacher_attendance_sessions(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
      attendance_status attendance_status NOT NULL,
      notes TEXT,
      marked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marked_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, session_id, student_id)
    )
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_att_records_session ON teacher_attendance_records(session_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_att_records_student ON teacher_attendance_records(student_id)`);

  await client.query(
    `ALTER TABLE teacher_attendance_sessions ADD COLUMN IF NOT EXISTS course_name_snapshot VARCHAR(500)`
  );
  await client.query(
    `ALTER TABLE teacher_attendance_sessions ADD COLUMN IF NOT EXISTS course_code_snapshot VARCHAR(120)`
  );
  await client.query(
    `ALTER TABLE teacher_attendance_sessions ADD COLUMN IF NOT EXISTS class_name_snapshot VARCHAR(255)`
  );
  await client.query(
    `ALTER TABLE teacher_attendance_sessions ADD COLUMN IF NOT EXISTS teacher_name_snapshot VARCHAR(255)`
  );
  await client.query(
    `ALTER TABLE teacher_attendance_sessions ADD COLUMN IF NOT EXISTS teacher_email_snapshot VARCHAR(320)`
  );
};

export async function teacherAttendanceRoutes(fastify: FastifyInstance) {
  // GET /api/v1/teacher/attendance - list attendance sessions for teacher (aggregated hours)
  fastify.get("/", {
    schema: {
      tags: ["Teacher Attendance"],
      summary: "List attendance sessions for teacher",
      querystring: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          fromDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          toDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          assignmentId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["draft", "pending", "completed", "rejected", "cancelled"] },
        }
      },
      headers: {
        type: "object",
        properties: {
          "x-user-id": { type: "string" }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const parsedQuery = ListAttendanceQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: "Validation Error",
          message: parsedQuery.error.message,
        });
      }

      const { teacherId, fromDate, toDate, assignmentId, status } = parsedQuery.data;
      const userHeaderId = request.headers['x-user-id'] as string | undefined;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      const client = await fastify.pg.connect();
      try {
        await ensureTeacherAttendanceTables(client, fastify);

        let effectiveTeacherId: string | null = null;
        let params: any[] = [request.tenantId];
        let idx = 2;
        let conditions = "s.tenant_id = $1";

        // If teacherId is provided in query params, use it directly (for admin payment calculation)
        if (teacherId) {
          // Verify the teacher exists and belongs to the tenant
          const teacherCheck = await client.query(
            `SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            [teacherId, request.tenantId]
          );

          if (teacherCheck.rows.length === 0) {
            return reply.status(404).send({
              error: "Teacher Not Found",
              message: "Teacher not found or does not belong to this tenant",
            });
          }

          effectiveTeacherId = teacherId;
          conditions += ` AND ta.teacher_id = $${idx}`;
          params.push(effectiveTeacherId);
          idx++;
        } else if (userHeaderId) {
          // If no teacherId but userHeaderId is provided, try to resolve teacher (for teacher viewing their own attendance)
          const teacherRes = await client.query(
            `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
            [userHeaderId, request.tenantId]
          );

          if (teacherRes.rows.length > 0) {
            effectiveTeacherId = teacherRes.rows[0].id as string;
            conditions += ` AND ta.teacher_id = $${idx}`;
            params.push(effectiveTeacherId);
            idx++;
          }
          // If no teacher found but userHeaderId exists, allow admin to see all sessions (no teacher filter)
        }
        // If neither teacherId nor userHeaderId, allow admin to see all sessions (no teacher filter)

        if (fromDate) {
          conditions += ` AND s.session_date >= $${idx}`;
          params.push(fromDate);
          idx++;
        }

        if (toDate) {
          conditions += ` AND s.session_date <= $${idx}`;
          params.push(toDate);
          idx++;
        }

        if (assignmentId) {
          conditions += ` AND s.assignment_id = $${idx}`;
          params.push(assignmentId);
          idx++;
        }

        // Add status filter if provided
        if (status) {
          conditions += ` AND s.status = $${idx}`;
          params.push(status);
          idx++;
        }

        if (activeAcademicYearId) {
          conditions += ` AND cl.academic_year_id = $${idx}`;
          params.push(activeAcademicYearId);
          idx++;
        }

        // Optional param reused by hourly-rate subquery to select the config of the active academic year.
        let rateConfigAcademicYearParamIndex: number | null = null;
        if (activeAcademicYearId) {
          rateConfigAcademicYearParamIndex = idx;
          params.push(activeAcademicYearId);
          idx++;
        }

        // Debug: Check if there are any sessions at all
        const debugConditions = effectiveTeacherId 
          ? `s.tenant_id = $1 AND ta.teacher_id = $2`
          : `s.tenant_id = $1`;
        const debugParams = effectiveTeacherId 
          ? [request.tenantId, effectiveTeacherId]
          : [request.tenantId];
        const debugQuery = await client.query(
          `SELECT COUNT(*) as total FROM teacher_attendance_sessions s
           JOIN teacher_assignments ta ON s.assignment_id = ta.id
           WHERE ${debugConditions}`,
          debugParams
        );
        fastify.log.info(`Teacher attendance debug: Found ${debugQuery.rows[0]?.total || 0} total sessions${effectiveTeacherId ? ` for teacher ${effectiveTeacherId}` : ' (all teachers)'}`);

        const sessionsQuery = await client.query(
          `SELECT
             s.id,
             s.assignment_id,
             s.session_date,
             s.time_slot,
             s.session_title,
             s.duration_hours,
             s.status,
             s.created_at,
             s.updated_at,
             ta.class_course_id,
             cc.class_id,
             cc.course_id,
             c.name AS course_name,
             c.code AS course_code,
             cl.name AS class_name,
             COALESCE(
               (
                 SELECT tpc.default_hourly_rate
                 FROM teacher_payment_configs tpc
                 WHERE tpc.tenant_id = s.tenant_id
                   AND (
                     tpc.teacher_id = t.id
                     OR (
                       t.user_id IS NOT NULL
                       AND tpc.teacher_id IN (
                         SELECT t2.id
                         FROM teachers t2
                         WHERE t2.tenant_id = s.tenant_id
                           AND t2.user_id = t.user_id
                       )
                     )
                   )
                   AND tpc.effective_from <= s.session_date
                   AND (tpc.effective_to IS NULL OR tpc.effective_to >= s.session_date)
                   ${rateConfigAcademicYearParamIndex ? `AND tpc.academic_year_id = $${rateConfigAcademicYearParamIndex}` : ''}
                 ORDER BY tpc.effective_from DESC
                 LIMIT 1
               ),
               t.hourly_rate,
               0
             ) AS hourly_rate,
             COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') AS teacher_name,
             t.id AS teacher_id
           FROM teacher_attendance_sessions s
           JOIN teacher_assignments ta ON s.assignment_id = ta.id
           JOIN class_courses cc ON ta.class_course_id = cc.id
           JOIN courses c ON cc.course_id = c.id
           JOIN classes cl ON cc.class_id = cl.id
           JOIN teachers t ON ta.teacher_id = t.id
           LEFT JOIN users u ON t.user_id = u.id
           WHERE ${conditions}
           ORDER BY s.session_date DESC, s.created_at DESC`,
          params
        );

        fastify.log.info(`Teacher attendance query: Found ${sessionsQuery.rows.length} sessions with filters fromDate=${fromDate}, toDate=${toDate}`);

        const sessions = sessionsQuery.rows.map(row => {
          const timeParts = (row.time_slot || '').split('-').map((value: string) => value?.trim() || null);
          const startTime = timeParts[0] || null;
          const endTime = timeParts[1] || null;
          const duration = Number(row.duration_hours) || 0;
          const hourlyRate = Number(row.hourly_rate) || 0;
          const amount = duration * hourlyRate;
        const normalizedStatus = (row.status || '').toLowerCase();
        const validated = normalizedStatus === 'completed'; // Seules les heures 'completed' sont validées

          return {
            id: row.id,
            assignmentId: row.assignment_id,
            classCourseId: row.class_course_id,
            classId: row.class_id,
            courseId: row.course_id,
            date: row.session_date,
            timeSlot: row.time_slot,
            startTime,
            endTime,
            duration,
            sessionTitle: row.session_title,
            sessionType: 'theory',
            status: normalizedStatus,
            validated,
            hourlyRate,
            amount,
            courseName: row.course_name,
            courseCode: row.course_code,
            className: row.class_name,
            teacherName: row.teacher_name,
            teacherId: row.teacher_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });

        const totals = sessions.reduce(
          (acc, session) => {
            acc.totalHours += session.duration || 0;
            if (session.validated) {
              acc.validatedHours += session.duration || 0;
              acc.validatedAmount += session.amount || 0;
            } else {
              acc.pendingHours += session.duration || 0;
            }
            acc.totalAmount += session.amount || 0;
            return acc;
          },
          { totalHours: 0, validatedHours: 0, pendingHours: 0, totalAmount: 0, validatedAmount: 0 }
        );

        return reply.send({ data: sessions, totals });
      } catch (error) {
        fastify.log.error(`List attendance sessions error: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch attendance sessions",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teacher/attendance - Save attendance records
  fastify.post("/", {
    schema: {
      tags: ["Teacher Attendance"],
      summary: "Save attendance records for a session",
      body: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          timeSlot: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9](-([01][0-9]|2[0-3]):[0-5][0-9])?$" },
          sessionTitle: { type: "string", minLength: 1 },
          durationHours: { type: "number", minimum: 1, maximum: 12 },
          records: {
            type: "array",
            items: {
              type: "object",
              properties: {
                studentId: { type: "string", format: "uuid" },
                status: { type: "string", enum: ["present", "absent", "late", "excused", "medical_leave"] },
                notes: { type: "string" }
              },
              required: ["studentId", "status"]
            }
          },
          courseNameSnapshot: { type: "string", maxLength: 500 },
          courseCodeSnapshot: { type: "string", maxLength: 120 },
          classNameSnapshot: { type: "string", maxLength: 255 },
          teacherNameSnapshot: { type: "string", maxLength: 255 },
          teacherEmailSnapshot: { type: "string", maxLength: 320 }
        },
        required: ["assignmentId", "date", "timeSlot", "sessionTitle", "durationHours", "records"]
      },
      headers: {
        type: "object",
        properties: {
          "x-user-id": { type: "string" }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const teacherId = request.headers['x-user-id'] as string || request.user?.id;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
      
      if (!teacherId) {
        return reply.status(401).send({
          error: "Authentication Required",
          message: "Teacher ID is required",
        });
      }

      const body = request.body as any;
      const { assignmentId, date, timeSlot, sessionTitle, durationHours, records } = body;

      const trimSnapshot = (v: unknown, max: number): string | null => {
        if (typeof v !== "string") return null;
        const t = v.trim();
        return t ? t.slice(0, max) : null;
      };

      const courseNameSnapshot = trimSnapshot(body.courseNameSnapshot, 500);
      const courseCodeSnapshot = trimSnapshot(body.courseCodeSnapshot, 120);
      const classNameSnapshot = trimSnapshot(body.classNameSnapshot, 255);
      const teacherNameSnapshot = trimSnapshot(body.teacherNameSnapshot, 255);
      const teacherEmailSnapshot = trimSnapshot(body.teacherEmailSnapshot, 320);

      try {
        // Verify that the assignment belongs to the teacher
        const assignmentCheck = await fastify.pg.query(`
          SELECT ta.id, ta.class_course_id, c.academic_year_id
          FROM teacher_assignments ta
          JOIN class_courses cc ON ta.class_course_id = cc.id
          JOIN classes c ON cc.class_id = c.id
          JOIN teachers t ON t.id = ta.teacher_id
          WHERE ta.id = $1 AND t.user_id = $2 AND ta.tenant_id = $3
        `, [assignmentId, teacherId, request.tenantId]);


        if (assignmentCheck.rows.length === 0) {
          return reply.status(404).send({
            error: "Assignment Not Found",
            message: "Assignment not found or access denied",
          });
        }

        const classCourseId = assignmentCheck.rows[0].class_course_id as string | null;
        const assignmentAcademicYearId = assignmentCheck.rows[0].academic_year_id as string | undefined;
        if (activeAcademicYearId && assignmentAcademicYearId && activeAcademicYearId !== assignmentAcademicYearId) {
          return reply.status(400).send({
            error: "Academic Year Mismatch",
            message: "La séance ne peut pas être enregistrée hors de l'année académique active.",
          });
        }

        const client = await fastify.pg.connect();

        try {
          await client.query('BEGIN');

          await ensureTeacherAttendanceTables(client, fastify);

          // Resolve teacher DB id from user id
          const teacherRow = await client.query(
            `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
            [teacherId, request.tenantId]
          );
          if (teacherRow.rows.length === 0) {
            throw new Error('Teacher not found for user');
          }
          const teacherDbId = teacherRow.rows[0].id;

          // Check if session already exists for this assignment, date, and time slot
          const existingSession = await client.query(
            `SELECT id FROM teacher_attendance_sessions
             WHERE tenant_id = $1 AND assignment_id = $2 AND session_date = $3 AND time_slot = $4`,
            [request.tenantId, assignmentId, date, timeSlot]
          );

          let sessionId: string;
          if (existingSession.rows.length > 0) {
            // Update existing session
            const updateRes = await client.query(
              `UPDATE teacher_attendance_sessions
               SET session_title = $1, duration_hours = $2,
                   course_name_snapshot = COALESCE($5, course_name_snapshot),
                   course_code_snapshot = COALESCE($6, course_code_snapshot),
                   class_name_snapshot = COALESCE($7, class_name_snapshot),
                   teacher_name_snapshot = COALESCE($8, teacher_name_snapshot),
                   teacher_email_snapshot = COALESCE($9, teacher_email_snapshot),
                   updated_at = NOW()
               WHERE id = $3 AND tenant_id = $4
               RETURNING id`,
              [
                sessionTitle,
                durationHours,
                existingSession.rows[0].id,
                request.tenantId,
                courseNameSnapshot,
                courseCodeSnapshot,
                classNameSnapshot,
                teacherNameSnapshot,
                teacherEmailSnapshot,
              ]
            );
            sessionId = updateRes.rows[0].id;
          } else {
            // Create new session
            const insertRes = await client.query(
              `INSERT INTO teacher_attendance_sessions (
                 tenant_id, assignment_id, class_course_id, session_date, time_slot, session_title,
                 duration_hours, teacher_id, status,
                 course_name_snapshot, course_code_snapshot, class_name_snapshot, teacher_name_snapshot, teacher_email_snapshot,
                 created_at, updated_at
               ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8, 'draft',
                 $9, $10, $11, $12, $13,
                 NOW(), NOW()
               )
               RETURNING id`,
              [
                request.tenantId,
                assignmentId,
                classCourseId,
                date,
                timeSlot,
                sessionTitle,
                durationHours,
                teacherDbId,
                courseNameSnapshot,
                courseCodeSnapshot,
                classNameSnapshot,
                teacherNameSnapshot,
                teacherEmailSnapshot,
              ]
            );
            sessionId = insertRes.rows[0].id;
          }

          // Delete existing attendance records for this session
          await client.query(`
            DELETE FROM teacher_attendance_records
            WHERE session_id = $1 AND tenant_id = $2
          `, [sessionId, request.tenantId]);

          // Insert new attendance records
          for (const record of records) {
            await client.query(`
              INSERT INTO teacher_attendance_records (
                tenant_id, session_id, student_id, attendance_status, notes, marked_by, marked_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, NOW()
              )
              ON CONFLICT (tenant_id, session_id, student_id) 
              DO UPDATE SET
                attendance_status = EXCLUDED.attendance_status,
                notes = EXCLUDED.notes,
                marked_by = EXCLUDED.marked_by,
                marked_at = NOW(),
                updated_at = NOW()
            `, [
              request.tenantId,
              sessionId,
              record.studentId,
              record.status,
              record.notes || null,
              teacherId
            ]);
          }

          await client.query('COMMIT');

          return reply.status(201).send({
            message: "Attendance saved successfully",
            sessionId,
            recordsCount: records.length,
          });

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

      } catch (error: any) {
        fastify.log.error(`Save attendance error: ${error}`);
        console.error('Detailed error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDetails = error?.detail || error?.code || errorMessage;
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to save attendance",
          details: errorDetails,
        });
      }
    },
  });

  // GET /api/v1/teacher/attendance/:assignmentId - Get attendance history for an assignment
  fastify.get("/:assignmentId", {
    schema: {
      tags: ["Teacher Attendance"],
      summary: "Get attendance history for an assignment",
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" }
        },
        required: ["assignmentId"]
      },
      headers: {
        type: "object",
        properties: {
          "x-user-id": { type: "string" }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { assignmentId } = request.params as { assignmentId: string };
      const userIdHeader = request.headers['x-user-id'] as string || request.user?.id;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
      
      if (!userIdHeader) {
        return reply.status(401).send({
          error: "Authentication Required",
          message: "User ID is required",
        });
      }

      try {
        const client = await fastify.pg.connect();
        try {
          await ensureTeacherAttendanceTables(client, fastify);

          // First, check if assignment exists and get its tenant_id
          const assignmentExistsCheck = await client.query(`
            SELECT ta.id, ta.teacher_id, ta.tenant_id, c.academic_year_id
            FROM teacher_assignments ta
            JOIN class_courses cc ON ta.class_course_id = cc.id
            JOIN classes c ON cc.class_id = c.id
            WHERE ta.id = $1
          `, [assignmentId]);

          if (assignmentExistsCheck.rows.length === 0) {
            return reply.status(404).send({
              error: "Assignment Not Found",
              message: "Assignment not found",
            });
          }

          const assignment = assignmentExistsCheck.rows[0];
          if (activeAcademicYearId && assignment.academic_year_id && activeAcademicYearId !== assignment.academic_year_id) {
            return reply.status(404).send({
              error: "Assignment Not Found",
              message: "Assignment not found for the active academic year",
            });
          }

          // Resolve user_id to teacher_id (similar to other endpoints)
          // First check if the provided ID is already a teacher_id
          // Use request.tenantId for resolution, but we'll verify against assignment.tenant_id later
          const teacherCheckResult = await client.query(`
            SELECT id, user_id FROM teachers WHERE id = $1 AND tenant_id = $2
          `, [userIdHeader, request.tenantId]);

          let resolvedTeacherId: string | null = null;

          if (teacherCheckResult.rows.length > 0) {
            // It's already a teacher_id
            resolvedTeacherId = teacherCheckResult.rows[0].id;
            fastify.log.info(`[GET /:assignmentId] Provided ID is teacher_id: ${resolvedTeacherId}`);
          } else {
            // Try to resolve from user_id
            const userTeacherResult = await client.query(`
              SELECT t.id FROM teachers t WHERE t.user_id = $1 AND t.tenant_id = $2
            `, [userIdHeader, request.tenantId]);

            if (userTeacherResult.rows.length > 0) {
              resolvedTeacherId = userTeacherResult.rows[0].id;
              fastify.log.info(`[GET /:assignmentId] Resolved user_id ${userIdHeader} to teacher_id ${resolvedTeacherId}`);
            } else {
              fastify.log.warn(`[GET /:assignmentId] Teacher not found for user_id: ${userIdHeader} in tenant: ${request.tenantId}`);
              return reply.status(404).send({
                error: "Teacher Not Found",
                message: "Teacher not found for the given user ID",
              });
            }
          }

          // Verify that the assignment belongs to the teacher
          // Check both tenant_id possibilities: assignment's tenant_id and request tenant_id
          // This handles cases where tenant resolution might differ slightly
          const assignmentCheck = await client.query(`
            SELECT ta.id
            FROM teacher_assignments ta
            WHERE ta.id = $1 
              AND ta.teacher_id = $2 
              AND (ta.tenant_id = $3 OR ta.tenant_id = $4)
          `, [assignmentId, resolvedTeacherId, assignment.tenant_id, request.tenantId]);

          if (assignmentCheck.rows.length === 0) {
            fastify.log.warn(`[GET /:assignmentId] Access denied:`, {
              assignmentId,
              userIdHeader,
              resolvedTeacherId,
              assignmentTenantId: assignment.tenant_id,
              assignmentTeacherId: assignment.teacher_id,
              requestTenantId: request.tenantId
            });
            return reply.status(404).send({
              error: "Assignment Not Found",
              message: "Assignment not found or access denied",
            });
          }

          // Get attendance sessions with summary - use assignment_id directly
          // Use the assignment's tenant_id to ensure we're querying the correct tenant
          const sessionsQuery = await client.query(`
            SELECT
              s.id,
              s.session_date,
              s.session_title,
              s.time_slot,
              s.duration_hours,
              s.created_at,
              COUNT(r.id) as total_records,
              COUNT(CASE WHEN r.attendance_status = 'present' THEN 1 END) as present_count,
              COUNT(CASE WHEN r.attendance_status = 'absent' THEN 1 END) as absent_count,
              COUNT(CASE WHEN r.attendance_status = 'late' THEN 1 END) as late_count,
              COUNT(CASE WHEN r.attendance_status = 'excused' THEN 1 END) as excused_count
            FROM teacher_attendance_sessions s
            LEFT JOIN teacher_attendance_records r ON s.id = r.session_id AND r.tenant_id = s.tenant_id
            WHERE s.assignment_id = $1 AND s.tenant_id = $2
            GROUP BY s.id, s.session_date, s.session_title, s.time_slot, s.duration_hours, s.created_at
            ORDER BY s.session_date DESC
          `, [assignmentId, assignment.tenant_id]);

          const sessions = sessionsQuery.rows.map(row => {
            const toInt = (value: any) => (value === null || value === undefined ? 0 : parseInt(value, 10));
            return {
              id: row.id,
              sessionDate: row.session_date,
              sessionTitle: row.session_title,
              timeSlot: row.time_slot,
              durationHours: row.duration_hours,
              createdAt: row.created_at,
              summary: {
                total: toInt(row.total_records),
                present: toInt(row.present_count),
                absent: toInt(row.absent_count),
                late: toInt(row.late_count),
                excused: toInt(row.excused_count),
              }
            };
          });

          return reply.send(sessions);
        } finally {
          client.release();
        }

      } catch (error: any) {
        fastify.log.error(`Get attendance history error: ${error}`);
        console.error('Detailed error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDetails = error?.detail || error?.code || errorMessage;
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch attendance history",
          details: errorDetails,
        });
      }
    },
  });

  // POST /api/v1/teacher/attendance/submit - Submit hours for validation (draft -> pending)
  fastify.post("/submit", {
    schema: {
      tags: ["Teacher Attendance"],
      summary: "Submit hours for validation",
      body: {
        type: "object",
        properties: {
          sessionIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1
          }
        },
        required: ["sessionIds"]
      },
      headers: {
        type: "object",
        properties: {
          "x-user-id": { type: "string" }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { sessionIds } = request.body as { sessionIds: string[] };
      const userHeaderId = request.headers['x-user-id'] as string | undefined;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      if (!userHeaderId) {
        return reply.status(401).send({
          error: "Authentication Required",
          message: "User ID header is required",
        });
      }

      const client = await fastify.pg.connect();
      try {
        await ensureTeacherAttendanceTables(client, fastify);

        // Verify teacher exists
        const teacherRes = await client.query(
          `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
          [userHeaderId, request.tenantId]
        );

        if (teacherRes.rows.length === 0) {
          return reply.status(404).send({
            error: "Teacher Not Found",
            message: "No teacher found for current user",
          });
        }

        const teacherId = teacherRes.rows[0].id as string;

        // Update sessions from 'draft' to 'pending'
        // Use IN clause instead of ANY for better compatibility
        const placeholders = sessionIds.map((_, index) => `$${index + 3}`).join(', ');
        const updateResult = await client.query(
          `UPDATE teacher_attendance_sessions
           SET status = 'pending', updated_at = NOW()
           WHERE tenant_id = $1 
           AND teacher_id = $2
           AND id IN (${placeholders})
           AND status = 'draft'
           ${activeAcademicYearId ? `AND EXISTS (
             SELECT 1
             FROM teacher_assignments ta
             JOIN class_courses cc ON ta.class_course_id = cc.id
             JOIN classes cl ON cc.class_id = cl.id
             WHERE ta.id = teacher_attendance_sessions.assignment_id
               AND cl.academic_year_id = $${sessionIds.length + 3}
           )` : ""}
           RETURNING id, status`,
          activeAcademicYearId
            ? [request.tenantId, teacherId, ...sessionIds, activeAcademicYearId]
            : [request.tenantId, teacherId, ...sessionIds]
        );

        if (updateResult.rows.length === 0) {
          return reply.status(400).send({
            error: "No Sessions Updated",
            message: "No draft sessions found to submit, or sessions don't belong to this teacher",
          });
        }

        return reply.send({
          data: {
            submitted: updateResult.rows.length,
            sessions: updateResult.rows.map(row => ({
              id: row.id,
              status: row.status
            }))
          }
        });
      } catch (error: any) {
        fastify.log.error(`Submit hours error: ${error}`);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("Submit hours error details:", { errorMessage, errorStack, error });
        return reply.status(500).send({
          error: "Internal Server Error",
          message: errorMessage || "Failed to submit hours for validation",
          ...(process.env.NODE_ENV === 'development' && { stack: errorStack }),
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teacher/attendance/validate - Validate hours (pending -> completed) - Admin only
  fastify.post("/validate", {
    schema: {
      tags: ["Teacher Attendance"],
      summary: "Validate hours (Admin only)",
      body: {
        type: "object",
        properties: {
          sessionIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1
          }
        },
        required: ["sessionIds"]
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { sessionIds } = request.body as { sessionIds: string[] };
      const userHeaderId = request.headers['x-user-id'] as string | undefined;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      if (!userHeaderId) {
        return reply.status(401).send({
          error: "Authentication Required",
          message: "User ID header is required",
        });
      }

      // TODO: Add admin role check here
      // For now, allow any authenticated user to validate

      const client = await fastify.pg.connect();
      try {
        await ensureTeacherAttendanceTables(client, fastify);

        // Update sessions from 'pending' or 'draft' to 'completed'
        // Use IN clause instead of ANY for better compatibility
        const placeholders = sessionIds.map((_, index) => `$${index + 2}`).join(', ');
        const updateResult = await client.query(
          `UPDATE teacher_attendance_sessions
           SET status = 'completed', updated_at = NOW()
           WHERE tenant_id = $1 
           AND id IN (${placeholders})
           AND status IN ('pending', 'draft')
           ${activeAcademicYearId ? `AND EXISTS (
             SELECT 1
             FROM teacher_assignments ta
             JOIN class_courses cc ON ta.class_course_id = cc.id
             JOIN classes cl ON cc.class_id = cl.id
             WHERE ta.id = teacher_attendance_sessions.assignment_id
               AND cl.academic_year_id = $${sessionIds.length + 2}
           )` : ""}
           RETURNING id, status, teacher_id`,
          activeAcademicYearId
            ? [request.tenantId, ...sessionIds, activeAcademicYearId]
            : [request.tenantId, ...sessionIds]
        );

        if (updateResult.rows.length === 0) {
          return reply.status(400).send({
            error: "No Sessions Updated",
            message: "No pending or draft sessions found to validate",
          });
        }

        return reply.send({
          data: {
            validated: updateResult.rows.length,
            sessions: updateResult.rows.map(row => ({
              id: row.id,
              status: row.status,
              teacherId: row.teacher_id
            }))
          }
        });
      } catch (error) {
        fastify.log.error(`Validate hours error: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to validate hours",
        });
      } finally {
        client.release();
      }
    },
  });
}
