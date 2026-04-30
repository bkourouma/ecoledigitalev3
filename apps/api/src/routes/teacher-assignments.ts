import { FastifyInstance } from "fastify";
import { z } from "zod";

// Temporary inline schemas to fix the import issue
const AssignmentContractTypeSchema = z.enum(["salarie", "vacataire"]);
const AssignmentStatusSchema = z.enum(["active", "paused", "ended", "cancelled"]);

const CreateTeacherAssignmentSchema = z.object({
  classCourseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid(),
  contractType: AssignmentContractTypeSchema,
  datebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  datefin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  courseAmount: z.number().nonnegative().optional(),
  status: AssignmentStatusSchema.default("active"),
  notes: z.string().optional(),
})
.refine((data) => !!data.classCourseId || (!!data.classId && !!data.courseId), {
  message: "Provide either classCourseId or classId + courseId",
  path: ["classCourseId"],
})
.refine((data) => {
  if (data.contractType === "vacataire") {
    return typeof data.courseAmount === "number" && data.courseAmount > 0;
  }
  return true;
}, { message: "courseAmount is required and must be > 0 for vacataire", path: ["courseAmount"] });

// Create UpdateTeacherAssignmentSchema separately to avoid issues
const UpdateTeacherAssignmentSchema = z.object({
  classCourseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  contractType: AssignmentContractTypeSchema.optional(),
  datebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  datefin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  courseAmount: z.number().nonnegative().optional(),
  status: AssignmentStatusSchema.optional(),
  notes: z.string().optional(),
});

const GenerateMissingSessionsSchema = z.object({
  assignmentIds: z.array(z.string().uuid()).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const DEFAULT_WEEKLY_SLOTS = [
  { dayOffset: 0, start: "08:00:00", end: "10:00:00", duration: 120 },
  { dayOffset: 0, start: "10:00:00", end: "12:00:00", duration: 120 },
  { dayOffset: 1, start: "08:00:00", end: "10:00:00", duration: 120 },
  { dayOffset: 1, start: "10:00:00", end: "12:00:00", duration: 120 },
  { dayOffset: 2, start: "08:00:00", end: "10:00:00", duration: 120 },
  { dayOffset: 2, start: "10:00:00", end: "12:00:00", duration: 120 },
  { dayOffset: 3, start: "08:00:00", end: "10:00:00", duration: 120 },
  { dayOffset: 3, start: "10:00:00", end: "12:00:00", duration: 120 },
  { dayOffset: 4, start: "08:00:00", end: "10:00:00", duration: 120 },
  { dayOffset: 4, start: "10:00:00", end: "12:00:00", duration: 120 },
];

function toDateOnly(value: Date): string {
  return value.toISOString().split("T")[0];
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function combineDateAndTime(date: Date, time: string): Date {
  const d = new Date(date);
  const [hour, minute, second] = time.split(":").map(Number);
  d.setHours(hour, minute, second || 0, 0);
  return d;
}

export async function teacherAssignmentsRoutes(fastify: FastifyInstance) {
  // POST /api/v1/teacher-assignments - Create assignment
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["teacherId", "contractType", "datebut", "datefin"],
        properties: {
          classCourseId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          courseId: { type: "string", format: "uuid" },
          teacherId: { type: "string", format: "uuid" },
          contractType: { type: "string", enum: ["salarie", "vacataire"] },
          datebut: { type: "string", format: "date" },
          datefin: { type: "string", format: "date" },
          courseAmount: { type: "number" },
          status: { type: "string", enum: ["active", "paused", "ended", "cancelled"] },
          notes: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const payload = request.body as any;

      // Domain validation using Zod
      const parsed = CreateTeacherAssignmentSchema.safeParse(payload);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation Error", message: parsed.error.errors.map(e => e.message).join(", ") });
      }

      const { classCourseId, classId, courseId, teacherId, contractType, datebut, datefin, courseAmount, status, notes } = parsed.data;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        // Resolve class_course if not provided
        let resolvedClassCourseId = classCourseId;
        if (!resolvedClassCourseId) {
          const ccRes = await client.query(
            `SELECT cc.id
             FROM class_courses cc
             WHERE cc.tenant_id = $1 AND cc.class_id = $2 AND cc.course_id = $3`,
            [request.tenantId, classId, courseId]
          );
          if (ccRes.rows.length > 0) {
            resolvedClassCourseId = ccRes.rows[0].id;
          } else {
            const insertCc = await client.query(
              `INSERT INTO class_courses (tenant_id, class_id, course_id, is_required)
               SELECT $1::uuid, c.id, $2::uuid, true
               FROM classes c
               INNER JOIN courses co ON co.id = $2::uuid
                 AND co.programme_id = c.programme_id
                 AND co.tenant_id = $1::uuid
               WHERE c.id = $3::uuid AND c.tenant_id = $1::uuid
               ON CONFLICT (tenant_id, class_id, course_id) DO NOTHING
               RETURNING id`,
              [request.tenantId, courseId, classId]
            );
            if (insertCc.rows.length > 0) {
              resolvedClassCourseId = insertCc.rows[0].id;
            } else {
              const again = await client.query(
                `SELECT id FROM class_courses
                 WHERE tenant_id = $1 AND class_id = $2 AND course_id = $3`,
                [request.tenantId, classId, courseId]
              );
              if (again.rows.length === 0) {
                await client.query('ROLLBACK');
                return reply.status(404).send({
                  error: "Not Found",
                  message:
                    "Aucune liaison classe–cours : le cours n'appartient pas au programme de cette classe ou est introuvable.",
                });
              }
              resolvedClassCourseId = again.rows[0].id;
            }
          }
        }

        // Validate teacher belongs to tenant
        const teacherRes = await client.query(
          `SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2`,
          [teacherId, request.tenantId]
        );
        if (teacherRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: "Invalid Teacher", message: "Teacher does not belong to tenant" });
        }

        // Get academic year bounds for date validation
        const ayRes = await client.query(
          `SELECT ay.start_date, ay.end_date
           FROM class_courses cc
           JOIN classes c ON c.id = cc.class_id
           JOIN academic_years ay ON ay.id = c.academic_year_id
           WHERE cc.id = $1 AND cc.tenant_id = $2`,
          [resolvedClassCourseId, request.tenantId]
        );
        if (ayRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: "Invalid Class Course", message: "Class course not found for tenant" });
        }
        const ayStart = ayRes.rows[0].start_date as Date;
        const ayEnd = ayRes.rows[0].end_date as Date;
        const assignmentAcademicYearId = ayRes.rows[0].academic_year_id as string | undefined;

        if (activeAcademicYearId && assignmentAcademicYearId && activeAcademicYearId !== assignmentAcademicYearId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({
            error: "Academic Year Mismatch",
            message: "La classe sélectionnée n'appartient pas à l'année académique active.",
          });
        }

        const start = new Date(datebut);
        const end = new Date(datefin);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: "Invalid Dates", message: "Invalid date format" });
        }
        if (end < start) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: "Invalid Dates", message: "datefin must be >= datebut" });
        }
        if (start < ayStart || end > ayEnd) {
          await client.query('ROLLBACK');
          const formatDate = (date: Date) => date.toLocaleDateString('fr-FR');
          return reply.status(400).send({
            error: "Out of Bounds",
            message: `Dates must be within academic year (${formatDate(ayStart)} - ${formatDate(ayEnd)})`
          });
        }

        if (contractType === "vacataire") {
          if (typeof courseAmount !== "number" || courseAmount <= 0) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: "Invalid Amount", message: "courseAmount required for vacataire and must be > 0" });
          }
        }

        // Check overlap manually to return graceful 409 before hitting constraint
        // DISABLED: Allow overlapping assignments
        // const overlapCheck = await client.query(
        //   `SELECT 1 FROM teacher_assignments
        //    WHERE tenant_id = $1 AND class_course_id = $2 AND teacher_id = $3
        //      AND daterange(datebut, datefin, '[]') && daterange($4::date, $5::date, '[]')
        //    LIMIT 1`,
        //   [request.tenantId, resolvedClassCourseId, teacherId, datebut, datefin]
        // );
        // if (overlapCheck.rows.length > 0) {
        //   await client.query('ROLLBACK');
        //   return reply.status(409).send({ error: "Overlap", message: "Overlapping assignment exists for this teacher and course" });
        // }

        const insertRes = await client.query(
          `INSERT INTO teacher_assignments
           (tenant_id, class_course_id, teacher_id, contract_type, datebut, datefin, course_amount, status, notes)
           VALUES ($1, $2, $3, $4::assignment_contract_type, $5, $6, $7, COALESCE($8::assignment_status, 'active'::assignment_status), $9)
           RETURNING *`,
          [request.tenantId, resolvedClassCourseId, teacherId, contractType, datebut, datefin, courseAmount ?? null, status ?? 'active', notes ?? null]
        );

        await client.query('COMMIT');
        return reply.status(201).send({ data: insertRes.rows[0] });
      } catch (error: any) {
        try { await client.query('ROLLBACK'); } catch {}
        // DISABLED: Allow overlapping assignments
        // if (error?.constraint === 'teacher_assignments_no_overlap') {
        //   return reply.status(409).send({ error: "Overlap", message: "Overlapping assignment exists" });
        // }
        console.error('Database error details:', error);
        fastify.log.error(`Error creating teacher assignment: ${error.message || error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: `Failed to create assignment: ${error.message || error}` });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-assignments - List with filters
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          courseId: { type: "string", format: "uuid" },
          academicYearId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["active", "paused", "ended", "cancelled"] },
          fromDate: { type: "string" },
          toDate: { type: "string" },
          validated: { type: "string" },
          showAll: { type: "boolean" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      // If X-User-Id header is provided, use it to resolve teacherId filter
      const userIdHeader = request.headers['x-user-id'] as string;

      const query = request.query as any;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = query.academicYearId || activeAcademicYearId;

      const client = await fastify.pg.connect();
      try {
        // Always resolve teacher_id from X-User-Id header if provided (security: prevent access to other teachers' data)
        // This ensures the teacher can only see their own assignments, even if a different teacherId is passed in query
        let resolvedTeacherId: string | null = null;
        
        if (userIdHeader && !query.showAll) {
          const teacherRes = await client.query(
            `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
            [userIdHeader, request.tenantId]
          );
          if (teacherRes.rows.length > 0) {
            resolvedTeacherId = teacherRes.rows[0].id;
            // Override any teacherId from query params with the resolved one for security
            query.teacherId = resolvedTeacherId;
            fastify.log.info(`[GET /teacher-assignments] Resolved teacher_id from X-User-Id ${userIdHeader}: ${resolvedTeacherId} (ignoring query param teacherId: ${query.teacherId || 'none'})`);
          } else {
            fastify.log.warn(`[GET /teacher-assignments] Teacher not found for user_id: ${userIdHeader} in tenant: ${request.tenantId}`);
            // If teacher not found, don't allow access to any assignments
            if (!query.showAll) {
              return reply.status(200).send({
                data: [],
                pagination: {
                  page: 1,
                  limit: 20,
                  total: 0,
                  totalPages: 0,
                },
              });
            }
          }
        } else if (query.teacherId && !query.showAll) {
          // If no X-User-Id but teacherId in query, use it (for admin/backward compatibility)
          resolvedTeacherId = query.teacherId;
          fastify.log.info(`[GET /teacher-assignments] Using teacherId from query params: ${resolvedTeacherId} (no X-User-Id header)`);
        }

        // Debug logging
        fastify.log.info(`Teacher assignments request - tenantId: ${request.tenantId}, teacherId: ${query.teacherId}`);
        const page = Number(query.page || 1);
        const limit = Math.min(Number(query.limit || 20), 100);
        const offset = (page - 1) * limit;

        const filters: string[] = ["ta.tenant_id = $1"];
        const params: any[] = [request.tenantId];
        let i = 2;
        if (query.teacherId) { filters.push(`ta.teacher_id = $${i}`); params.push(query.teacherId); i++; }
        if (query.status) { filters.push(`ta.status = $${i}`); params.push(query.status); i++; }
        if (query.classId) { filters.push(`cc.class_id = $${i}`); params.push(query.classId); i++; }
        if (query.courseId) { filters.push(`cc.course_id = $${i}`); params.push(query.courseId); i++; }
        if (effectiveAcademicYearId) {
          filters.push(`cc.class_id IN (SELECT id FROM classes WHERE tenant_id = $1 AND academic_year_id = $${i})`);
          params.push(effectiveAcademicYearId);
          i++;
        }
        // Date range filter: find assignments where the payment period [fromDate, toDate] 
        // is entirely contained within the assignment period [datebut, datefin]
        // This means: datebut <= fromDate AND datefin >= toDate
        if (query.fromDate && query.toDate) {
          filters.push(`(ta.datebut <= $${i} AND ta.datefin >= $${i+1})`);
          params.push(query.fromDate, query.toDate);
          i += 2;
        } else if (query.fromDate) {
          // If only fromDate: assignment must end after or on fromDate
          filters.push(`ta.datefin >= $${i}`);
          params.push(query.fromDate);
          i++;
        } else if (query.toDate) {
          // If only toDate: assignment must start before or on toDate
          filters.push(`ta.datebut <= $${i}`);
          params.push(query.toDate);
          i++;
        }
        if (query.validated === "true") { filters.push(`ta.validated_at IS NOT NULL AND ta.hours_validated IS NOT NULL`); }
        if (query.validated === "false") { filters.push(`(ta.validated_at IS NULL OR ta.hours_validated IS NULL)`); }

        const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

        const countRes = await client.query(
          `SELECT COUNT(*)
           FROM teacher_assignments ta
           LEFT JOIN class_courses cc ON cc.id = ta.class_course_id
           LEFT JOIN teachers t ON t.id = ta.teacher_id
           ${where}`,
          params
        );
        const total = parseInt(countRes.rows[0].count, 10) || 0;

        const rowsRes = await client.query(
          `SELECT ta.*,
                  cc.class_id,
                  cc.course_id,
                  c.name as course_name,
                  c.code as course_code,
                  cl.name as class_name,
                  cl.code as class_code,
                  COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Unknown Teacher') as teacher_name
           FROM teacher_assignments ta
           LEFT JOIN class_courses cc ON cc.id = ta.class_course_id
           LEFT JOIN courses c ON c.id = cc.course_id
           LEFT JOIN classes cl ON cl.id = cc.class_id
           LEFT JOIN teachers t ON t.id = ta.teacher_id
           LEFT JOIN users u ON u.id = t.user_id
           ${where}
           ORDER BY ta.created_at DESC
           LIMIT $${i} OFFSET $${i+1}`,
          [...params, limit, offset]
        );

        // Format data for client (attendance creation, validations, etc.)
        const formattedData = rowsRes.rows.map(row => ({
          id: row.id,
          // keys used by /attendance create form
          classCourseId: row.class_course_id,
          teacherId: row.teacher_id,
          // course and class IDs for evaluation creation
          courseId: row.course_id,
          classId: row.class_id,
          // human readable fields
          teacherName: row.teacher_name,
          courseName: row.course_name,
          courseCode: row.course_code,
          className: row.class_name,
          classCode: row.class_code,
          // additional metadata
          datebut: row.datebut,
          datefin: row.datefin,
          contractType: row.contract_type,
          courseAmount: row.course_amount,
          status: row.status,
          hoursValidated: row.hours_validated,
          validatedBy: row.validated_by,
          validatedAt: row.validated_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));

        return reply.send({ data: formattedData, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
      } catch (error) {
        fastify.log.error(`Error listing teacher assignments: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to list assignments" });
      } finally {
        client.release();
      }
    }
  });

  // POST /api/v1/teacher-assignments/generate-missing-sessions - Create schedule slots for active assignments
  fastify.post("/generate-missing-sessions", {
    schema: {
      body: {
        type: "object",
        properties: {
          assignmentIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
          startDate: { type: "string", format: "date" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const parsed = GenerateMissingSessionsSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten() });
      }

      const requestedStartDate = parsed.data.startDate || toDateOnly(new Date());
      const requestedStart = new Date(`${requestedStartDate}T00:00:00`);
      const assignmentIds = parsed.data.assignmentIds || [];
      const createdBy = (request.headers["x-user-id"] as string | undefined) || null;

      const client = await fastify.pg.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        const params: any[] = [request.tenantId];
        let idFilter = "";
        if (assignmentIds.length > 0) {
          params.push(assignmentIds);
          idFilter = `AND ta.id = ANY($${params.length}::uuid[])`;
        }

        const assignmentsRes = await client.query(
          `SELECT
             ta.id,
             ta.teacher_id,
             ta.datebut,
             ta.datefin,
             cc.class_id,
             cc.course_id,
             COALESCE(c.hours_total, 2) as hours_total,
             c.name as course_name,
             c.code as course_code,
             cl.name as class_name,
             cl.code as class_code,
             COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name
           FROM teacher_assignments ta
           JOIN class_courses cc ON cc.id = ta.class_course_id
           JOIN courses c ON c.id = cc.course_id
           JOIN classes cl ON cl.id = cc.class_id
           JOIN teachers t ON t.id = ta.teacher_id
           LEFT JOIN users u ON u.id = t.user_id
           WHERE ta.tenant_id = $1
             AND ta.status = 'active'
             AND cc.class_id IS NOT NULL
             AND cc.course_id IS NOT NULL
             ${idFilter}
           ORDER BY cl.name, c.name, ta.created_at`,
          params
        );

        const summaries: any[] = [];
        let totalCreated = 0;
        let totalSkipped = 0;

        for (const [assignmentIndex, assignment] of assignmentsRes.rows.entries()) {
          const existingRes = await client.query(
            `SELECT COUNT(*)::int as count
             FROM session_instances
             WHERE tenant_id = $1
               AND teacher_id = $2
               AND class_id = $3
               AND course_id = $4
               AND status <> 'cancelled'`,
            [request.tenantId, assignment.teacher_id, assignment.class_id, assignment.course_id]
          );

          if ((existingRes.rows[0]?.count || 0) > 0) {
            totalSkipped += 1;
            summaries.push({
              assignmentId: assignment.id,
              courseName: assignment.course_name,
              className: assignment.class_name,
              teacherName: assignment.teacher_name,
              created: 0,
              skipped: true,
              reason: "Des créneaux existent déjà",
            });
            continue;
          }

          const assignmentStart = new Date(assignment.datebut);
          const assignmentEnd = new Date(assignment.datefin);
          const effectiveStart = requestedStart > assignmentStart ? requestedStart : assignmentStart;
          if (effectiveStart > assignmentEnd) {
            totalSkipped += 1;
            summaries.push({
              assignmentId: assignment.id,
              courseName: assignment.course_name,
              className: assignment.class_name,
              teacherName: assignment.teacher_name,
              created: 0,
              skipped: true,
              reason: "La date de début demandée est après la fin de l'affectation",
            });
            continue;
          }

          const hoursTotal = Math.max(Number(assignment.hours_total || 2), 2);
          let createdForAssignment = 0;
          let createdMinutes = 0;
          let currentWeekStart = mondayOf(effectiveStart);
          let weekCount = 0;

          while (createdMinutes < hoursTotal * 60 && currentWeekStart <= assignmentEnd && weekCount < 80) {
            let insertedThisWeek = false;

            for (let offset = 0; offset < DEFAULT_WEEKLY_SLOTS.length; offset++) {
              const slot = DEFAULT_WEEKLY_SLOTS[(assignmentIndex + offset) % DEFAULT_WEEKLY_SLOTS.length];
              const sessionDate = new Date(currentWeekStart);
              sessionDate.setDate(currentWeekStart.getDate() + slot.dayOffset);

              if (sessionDate < effectiveStart || sessionDate > assignmentEnd) {
                continue;
              }

              const sessionDateOnly = toDateOnly(sessionDate);
              const conflictRes = await client.query(
                `SELECT 1
                 FROM session_instances
                 WHERE tenant_id = $1
                   AND session_date = $2::date
                   AND status <> 'cancelled'
                   AND (teacher_id = $3 OR class_id = $4)
                   AND start_time < $5::time
                   AND end_time > $6::time
                 LIMIT 1`,
                [request.tenantId, sessionDateOnly, assignment.teacher_id, assignment.class_id, slot.end, slot.start]
              );

              if (conflictRes.rows.length > 0) {
                continue;
              }

              const startDatetime = combineDateAndTime(sessionDate, slot.start);
              const endDatetime = combineDateAndTime(sessionDate, slot.end);

              await client.query(
                `INSERT INTO session_instances (
                  tenant_id, class_id, course_id, teacher_id,
                  session_date, start_time, end_time, start_datetime, end_datetime,
                  classroom, duration_minutes, status, created_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                  request.tenantId,
                  assignment.class_id,
                  assignment.course_id,
                  assignment.teacher_id,
                  sessionDateOnly,
                  slot.start,
                  slot.end,
                  startDatetime.toISOString(),
                  endDatetime.toISOString(),
                  "TBD",
                  slot.duration,
                  "scheduled",
                  createdBy,
                ]
              );

              createdForAssignment += 1;
              createdMinutes += slot.duration;
              totalCreated += 1;
              insertedThisWeek = true;
              break;
            }

            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            weekCount += 1;

            if (!insertedThisWeek && currentWeekStart > assignmentEnd) {
              break;
            }
          }

          summaries.push({
            assignmentId: assignment.id,
            courseName: assignment.course_name,
            courseCode: assignment.course_code,
            className: assignment.class_name,
            classCode: assignment.class_code,
            teacherName: assignment.teacher_name,
            created: createdForAssignment,
            skipped: createdForAssignment === 0,
            hoursScheduled: createdMinutes / 60,
          });
        }

        await client.query("COMMIT");
        return reply.send({
          success: true,
          data: {
            created: totalCreated,
            skipped: totalSkipped,
            assignments: summaries,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        fastify.log.error(`Error generating missing sessions: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to generate missing sessions" });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-assignments/:id - Get assignment by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { id } = request.params as { id: string };
      const userIdHeader = request.headers['x-user-id'] as string;

      const client = await fastify.pg.connect();
      try {
        // Build query with optional teacher filtering
        let resolvedTeacherId: string | null = null;
        
        if (userIdHeader) {
          const teacherRes = await client.query(
            `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
            [userIdHeader, request.tenantId]
          );
          if (teacherRes.rows.length > 0) {
            resolvedTeacherId = teacherRes.rows[0].id;
          }
        }

        // Query with tenant and optional teacher filter
        const filters: string[] = ["ta.id = $1", "ta.tenant_id = $2"];
        const params: any[] = [id, request.tenantId];
        
        // If user is a teacher, only allow access to their own assignments
        // If user is admin (no teacher found), allow access to all assignments
        if (resolvedTeacherId) {
          filters.push(`ta.teacher_id = $3`);
          params.push(resolvedTeacherId);
        }

        const where = filters.join(" AND ");

        const result = await client.query(
          `SELECT ta.*,
                  cc.class_id,
                  cc.course_id,
                  c.name as course_name,
                  c.code as course_code,
                  cl.name as class_name,
                  cl.code as class_code,
                  COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Unknown Teacher') as teacher_name
           FROM teacher_assignments ta
           LEFT JOIN class_courses cc ON cc.id = ta.class_course_id
           LEFT JOIN courses c ON c.id = cc.course_id
           LEFT JOIN classes cl ON cl.id = cc.class_id
           LEFT JOIN teachers t ON t.id = ta.teacher_id
           LEFT JOIN users u ON u.id = t.user_id
           WHERE ${where}`,
          params
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ 
            error: "Not Found", 
            message: "Assignment not found or you don't have permission to access it" 
          });
        }

        const row = result.rows[0];
        const assignment = {
          id: row.id,
          tenantId: row.tenant_id,
          classCourseId: row.class_course_id,
          classId: row.class_id,
          courseId: row.course_id,
          teacherId: row.teacher_id,
          contractType: row.contract_type,
          datebut: row.datebut,
          datefin: row.datefin,
          courseAmount: row.course_amount,
          status: row.status,
          notes: row.notes,
          hoursValidated: row.hours_validated,
          validatedBy: row.validated_by,
          validatedAt: row.validated_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          teacherName: row.teacher_name,
          courseName: row.course_name,
          courseCode: row.course_code,
          className: row.class_name,
          classCode: row.class_code,
        };

        return reply.send(assignment);
      } catch (error) {
        fastify.log.error(`Error fetching teacher assignment: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to fetch assignment" });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/teacher-assignments/:id - Update
  fastify.put("/:id", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object" },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }
      const { id } = request.params as any;
      const payload = request.body as any;

      const parsed = UpdateTeacherAssignmentSchema.safeParse(payload);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation Error", message: parsed.error.errors.map(e => e.message).join(", ") });
      }

      const client = await fastify.pg.connect();
      try {
        // Build dynamic update
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const add = (sql: string, val: any) => { fields.push(`${sql} = $${i}`); values.push(val); i++; };

        if (payload.teacherId) add("teacher_id", payload.teacherId);
        if (payload.classCourseId) add("class_course_id", payload.classCourseId);
        if (payload.contractType) add("contract_type", payload.contractType);
        if (payload.datebut) add("datebut", payload.datebut);
        if (payload.datefin) add("datefin", payload.datefin);
        if (payload.courseAmount !== undefined) add("course_amount", payload.courseAmount);
        if (payload.status) add("status", payload.status);
        if (payload.notes !== undefined) add("notes", payload.notes);

        if (fields.length === 0) {
          return reply.status(400).send({ error: "No Changes", message: "No valid fields to update" });
        }

        // If date range or teacher/class_course changed, verify overlap and academic year bounds
        if (payload.teacherId || payload.classCourseId || payload.datebut || payload.datefin) {
          // Fetch current row to know composite
          const currentRes = await client.query(`SELECT * FROM teacher_assignments WHERE id = $1 AND tenant_id = $2`, [id, request.tenantId]);
          if (currentRes.rows.length === 0) return reply.status(404).send({ error: "Not Found", message: "Assignment not found" });
          const current = currentRes.rows[0];
          const tId = payload.teacherId || current.teacher_id;
          const ccId = payload.classCourseId || current.class_course_id;
          const start = payload.datebut || current.datebut;
          const end = payload.datefin || current.datefin;

          // Validate dates against academic year bounds if dates are being changed
          if (payload.datebut || payload.datefin) {
            const ayRes = await client.query(
          `SELECT ay.id as academic_year_id, ay.start_date, ay.end_date
               FROM class_courses cc
               JOIN classes c ON c.id = cc.class_id
               JOIN academic_years ay ON ay.id = c.academic_year_id
               WHERE cc.id = $1 AND cc.tenant_id = $2`,
              [ccId, request.tenantId]
            );
            if (ayRes.rows.length === 0) {
              return reply.status(400).send({ error: "Invalid Class Course", message: "Class course not found for tenant" });
            }
            const ayStart = ayRes.rows[0].start_date as Date;
            const ayEnd = ayRes.rows[0].end_date as Date;

            const startDate = new Date(start);
            const endDate = new Date(end);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
              return reply.status(400).send({ error: "Invalid Dates", message: "Invalid date format" });
            }
            if (endDate < startDate) {
              return reply.status(400).send({ error: "Invalid Dates", message: "datefin must be >= datebut" });
            }
            if (startDate < ayStart || endDate > ayEnd) {
              const formatDate = (date: Date) => date.toLocaleDateString('fr-FR');
              return reply.status(400).send({
                error: "Out of Bounds",
                message: `Dates must be within academic year (${formatDate(ayStart)} - ${formatDate(ayEnd)})`
              });
            }
          }

          // DISABLED: Allow overlapping assignments
          // const overlapCheck = await client.query(
          //   `SELECT 1 FROM teacher_assignments
          //    WHERE tenant_id = $1 AND class_course_id = $2 AND teacher_id = $3 AND id <> $4
          //      AND daterange(datebut, datefin, '[]') && daterange($5::date, $6::date, '[]')
          //    LIMIT 1`,
          //   [request.tenantId, ccId, tId, id, start, end]
          // );
          // if (overlapCheck.rows.length > 0) {
          //   return reply.status(409).send({ error: "Overlap", message: "Overlapping assignment exists" });
          // }
        }

        const sql = `UPDATE teacher_assignments SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`;
        const res = await client.query(sql, [...values, id, request.tenantId]);
        if (res.rows.length === 0) return reply.status(404).send({ error: "Not Found", message: "Assignment not found" });
        return reply.send({ data: res.rows[0] });
      } catch (error: any) {
        // DISABLED: Allow overlapping assignments
        // if (error?.constraint === 'teacher_assignments_no_overlap') {
        //   return reply.status(409).send({ error: "Overlap", message: "Overlapping assignment exists" });
        // }
        fastify.log.error(`Error updating teacher assignment: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to update assignment" });
      } finally {
        client.release();
      }
    }
  });

  // DELETE /api/v1/teacher-assignments/:id
  fastify.delete("/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }
      const { id } = request.params as any;
      const client = await fastify.pg.connect();
      try {
        const res = await client.query(`DELETE FROM teacher_assignments WHERE id = $1 AND tenant_id = $2`, [id, request.tenantId]);
        if (res.rowCount === 0) return reply.status(404).send({ error: "Not Found", message: "Assignment not found" });
        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(`Error deleting teacher assignment: ${error}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to delete assignment" });
      } finally {
        client.release();
      }
    }
  });

  // POST /api/v1/teacher-assignments/validate - Validate assignments for payment
  fastify.post("/validate", {
    schema: {
      body: {
        type: "object",
        required: ["assignments"],
        properties: {
          assignments: {
            type: "array",
            items: {
              type: "object",
              required: ["assignmentId", "hoursValidated"],
              properties: {
                assignmentId: { type: "string", format: "uuid" },
                hoursValidated: { type: "number", minimum: 0 }
              }
            }
          }
        }
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { assignments } = request.body as { assignments: { assignmentId: string; hoursValidated: number }[] };
      const userId = "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"; // TODO: Get from auth

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);

        let updatedCount = 0;
        let teachingHoursCreated = 0;
        
        for (const assignment of assignments) {
          // Update teacher_assignment
          const result = await client.query(
            `UPDATE teacher_assignments
             SET hours_validated = $1, validated_by = $2, validated_at = NOW(), updated_at = NOW()
             WHERE tenant_id = $3 AND id = $4
             RETURNING id, teacher_id, class_course_id, datebut, datefin`,
            [assignment.hoursValidated, userId, request.tenantId, assignment.assignmentId]
          );
          
          if (result.rowCount && result.rowCount > 0) {
            updatedCount += result.rowCount;
            const ta = result.rows[0];
            
            // Get course_id from class_course
            const ccRes = await client.query(
              `SELECT course_id FROM class_courses WHERE id = $1 AND tenant_id = $2`,
              [ta.class_course_id, request.tenantId]
            );
            
            if (ccRes.rows.length > 0 && assignment.hoursValidated > 0) {
              const courseId = ccRes.rows[0].course_id;
              
              // Create or get course_assignment
              const academicYear = `${new Date(ta.datebut).getFullYear()}-${new Date(ta.datefin).getFullYear()}`;
              const hoursAssigned = ta.course_amount ? Math.round((new Date(ta.datefin) - new Date(ta.datebut)) / (1000 * 60 * 60 * 24) * 2) : 40;
              
              // Check if course_assignment exists
              let courseAssignmentId: string | null = null;
              const existingCARes = await client.query(
                `SELECT id FROM course_assignments 
                 WHERE tenant_id = $1 AND teacher_id = $2 AND course_id = $3 
                   AND academic_year = $4 AND semester = 1`,
                [request.tenantId, ta.teacher_id, courseId, academicYear]
              );
              
              if (existingCARes.rows.length > 0) {
                courseAssignmentId = existingCARes.rows[0].id;
                // Update it
                await client.query(
                  `UPDATE course_assignments 
                   SET hours_validated = $1, validated_by = $2, validated_at = NOW(), updated_at = NOW()
                   WHERE id = $3`,
                  [assignment.hoursValidated, userId, courseAssignmentId]
                );
              } else {
                // Create new course_assignment
                const insertCARes = await client.query(
                  `INSERT INTO course_assignments
                   (tenant_id, teacher_id, course_id, academic_year, semester, hours_assigned,
                    start_date, end_date, hours_validated, validated_by, validated_at, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, NOW(), NOW(), NOW())
                   RETURNING id`,
                  [request.tenantId, ta.teacher_id, courseId, academicYear, hoursAssigned,
                   ta.datebut, ta.datefin, assignment.hoursValidated, userId]
                );
                if (insertCARes.rows.length > 0) {
                  courseAssignmentId = insertCARes.rows[0].id;
                }
              }
              
              // Create teaching_hours record
              if (courseAssignmentId) {
                // Use datefin as session_date (or we could use period end date if provided)
                const sessionDate = ta.datefin;
                
                // Check if teaching_hours already exists
                const existingHoursCheck = await client.query(
                  `SELECT id FROM teaching_hours 
                   WHERE tenant_id = $1 AND assignment_id = $2 AND session_date = $3`,
                  [request.tenantId, courseAssignmentId, sessionDate]
                );
                
                if (existingHoursCheck.rows.length === 0) {
                  // Create new teaching_hours record
                  await client.query(
                    `INSERT INTO teaching_hours 
                     (tenant_id, assignment_id, session_date, hours_taught, session_type, validated_by, validated_at)
                     VALUES ($1, $2, $3, $4, 'theory', $5, NOW())`,
                    [request.tenantId, courseAssignmentId, sessionDate, assignment.hoursValidated, userId]
                  );
                  teachingHoursCreated++;
                } else {
                  // Update existing teaching_hours record
                  await client.query(
                    `UPDATE teaching_hours 
                     SET hours_taught = $1, validated_by = $2, validated_at = NOW()
                     WHERE tenant_id = $3 AND assignment_id = $4 AND session_date = $5`,
                    [assignment.hoursValidated, userId, request.tenantId, courseAssignmentId, sessionDate]
                  );
                }
              }
            }
          }
        }

        await client.query('COMMIT');
        fastify.log.info(`Validation complete: ${updatedCount} teacher assignment(s) updated, ${teachingHoursCreated} teaching_hours record(s) created`);
        return reply.send({ data: { updated: updatedCount, teachingHoursCreated } });
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(error);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to validate assignments" });
      } finally {
        client.release();
      }
    }
  });



  // GET /api/v1/teacher/assignments/:assignmentId/students - Get students for an assignment
  fastify.get("/:assignmentId/students", {
    schema: {
      tags: ["Teacher Assignments"],
      summary: "Get students for a teacher assignment",
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
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { assignmentId } = request.params as { assignmentId: string };
      const userIdHeader = request.headers['x-user-id'] as string;

      if (!userIdHeader) {
        return reply.status(401).send({
          error: "Authentication Required",
          message: "User ID is required",
        });
      }

      try {
        // Debug: Log the parameters
        fastify.log.info(`[GET /:assignmentId/students] Checking assignment:`, {
          assignmentId,
          userIdHeader,
          tenantId: request.tenantId,
          tenantSlug: request.tenantSlug
        });

        // First, check if assignment exists at all
        const assignmentExistsCheck = await fastify.pg.query(`
          SELECT ta.id, ta.teacher_id, ta.tenant_id
          FROM teacher_assignments ta
          WHERE ta.id = $1
        `, [assignmentId]);

        if (assignmentExistsCheck.rows.length === 0) {
          fastify.log.warn(`[GET /:assignmentId/students] Assignment not found: ${assignmentId}`);
          return reply.status(404).send({
            error: "Assignment Not Found",
            message: "Assignment not found",
          });
        }

        const assignment = assignmentExistsCheck.rows[0];
        fastify.log.info(`[GET /:assignmentId/students] Assignment found:`, {
          assignmentId: assignment.id,
          assignmentTeacherId: assignment.teacher_id,
          assignmentTenantId: assignment.tenant_id,
          requestTenantId: request.tenantId,
          userIdHeader
        });

        // Resolve user_id to teacher_id (similar to other endpoints)
        // First check if the provided ID is already a teacher_id
        // Use request.tenantId for resolution, but we'll verify against assignment.tenant_id later
        const teacherCheckResult = await fastify.pg.query(`
          SELECT id, user_id FROM teachers WHERE id = $1 AND tenant_id = $2
        `, [userIdHeader, request.tenantId]);

        let resolvedTeacherId: string | null = null;
        let resolvedUserId: string | null = null;

        if (teacherCheckResult.rows.length > 0) {
          // It's already a teacher_id
          resolvedTeacherId = teacherCheckResult.rows[0].id;
          resolvedUserId = teacherCheckResult.rows[0].user_id;
          fastify.log.info(`[GET /:assignmentId/students] Provided ID is teacher_id: ${resolvedTeacherId}`);
        } else {
          // Try to resolve from user_id
          const userTeacherResult = await fastify.pg.query(`
            SELECT t.id, t.user_id FROM teachers t WHERE t.user_id = $1 AND t.tenant_id = $2
          `, [userIdHeader, request.tenantId]);

          if (userTeacherResult.rows.length > 0) {
            resolvedTeacherId = userTeacherResult.rows[0].id;
            resolvedUserId = userTeacherResult.rows[0].user_id;
            fastify.log.info(`[GET /:assignmentId/students] Resolved user_id ${userIdHeader} to teacher_id ${resolvedTeacherId}`);
          } else {
            fastify.log.warn(`[GET /:assignmentId/students] Teacher not found for user_id: ${userIdHeader} in tenant: ${request.tenantId}`);
            return reply.status(404).send({
              error: "Teacher Not Found",
              message: "Teacher not found for the given user ID",
            });
          }
        }

        // Verify that the assignment belongs to the teacher
        // Check both tenant_id possibilities: assignment's tenant_id and request tenant_id
        // This handles cases where tenant resolution might differ slightly
        const assignmentCheck = await fastify.pg.query(`
          SELECT ta.id
          FROM teacher_assignments ta
          WHERE ta.id = $1 
            AND ta.teacher_id = $2 
            AND (ta.tenant_id = $3 OR ta.tenant_id = $4)
        `, [assignmentId, resolvedTeacherId, assignment.tenant_id, request.tenantId]);

        if (assignmentCheck.rows.length === 0) {
          // Additional debug: Check teacher-assignment relationship
          const relationshipCheck = await fastify.pg.query(`
            SELECT ta.id, ta.teacher_id, ta.tenant_id, t.id as teacher_table_id, t.user_id, u.id as user_table_id
            FROM teacher_assignments ta
            LEFT JOIN teachers t ON t.id = ta.teacher_id
            LEFT JOIN users u ON t.user_id = u.id
            WHERE ta.id = $1
          `, [assignmentId]);

          // Also check if there are multiple teachers with the same user_id
          const allTeachersForUser = await fastify.pg.query(`
            SELECT id, user_id, tenant_id FROM teachers WHERE user_id = $1
          `, [userIdHeader]);

          fastify.log.warn(`[GET /:assignmentId/students] Access denied:`, {
            assignmentId,
            userIdHeader,
            resolvedTeacherId,
            resolvedUserId,
            requestTenantId: request.tenantId,
            assignmentTenantId: assignment.tenant_id,
            assignmentTeacherId: assignment.teacher_id,
            tenantMatch: assignment.tenant_id === request.tenantId,
            teacherMatch: assignment.teacher_id === resolvedTeacherId,
            relationshipData: relationshipCheck.rows.length > 0 ? relationshipCheck.rows[0] : null,
            allTeachersForUser: allTeachersForUser.rows,
            queryUsed: `ta.id = '${assignmentId}' AND ta.teacher_id = '${resolvedTeacherId}' AND (ta.tenant_id = '${assignment.tenant_id}' OR ta.tenant_id = '${request.tenantId}')`
          });

          return reply.status(404).send({
            error: "Assignment Not Found",
            message: "Assignment not found or access denied",
          });
        }

        // Get the class from the assignment
        const classQuery = await fastify.pg.query(`
          SELECT cc.class_id
          FROM teacher_assignments ta
          JOIN class_courses cc ON ta.class_course_id = cc.id
          WHERE ta.id = $1 AND ta.tenant_id = $2
        `, [assignmentId, request.tenantId]);

        if (classQuery.rows.length === 0) {
          return reply.status(404).send({
            error: "Class Not Found",
            message: "Class not found for this assignment",
          });
        }

        const classId = classQuery.rows[0].class_id;

        // Get students enrolled in the class
        const studentsQuery = await fastify.pg.query(`
          SELECT
            sp.id,
            u.first_name,
            u.last_name,
            u.email,
            'STU' || LPAD(EXTRACT(YEAR FROM sp.created_at)::text, 4, '0') || LPAD(ROW_NUMBER() OVER (ORDER BY sp.created_at)::text, 4, '0') as matricule
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          JOIN student_enrollments se ON sp.id = se.student_id
          WHERE se.class_id = $1 AND sp.tenant_id = $2
          ORDER BY u.last_name, u.first_name
        `, [classId, request.tenantId]);

        const students = studentsQuery.rows.map(row => ({
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          matricule: row.matricule,
          email: row.email,
        }));

        return reply.send(students);

      } catch (error) {
        fastify.log.error(`Assignment students error: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch assignment students",
        });
      }
    },
  });

  // GET /api/v1/teacher-assignments/scheduled-sessions - Get scheduled sessions for teacher
  fastify.get("/scheduled-sessions", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const query = request.query as any;
      const userIdHeader = request.headers['x-user-id'] as string;
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;

      // Use teacherId from query or header
      let teacherId = query.teacherId || userIdHeader;

      if (!teacherId) {
        return reply.status(400).send({ error: "Bad Request", message: "teacherId is required" });
      }

      const client = await fastify.pg.connect();
      try {
        // Check if the provided ID is a user_id (not a teacher_id)
        // If it's a user_id, resolve it to the actual teacher_id
        const teacherCheckResult = await client.query(
          `SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2`,
          [teacherId, request.tenantId]
        );

        if (teacherCheckResult.rows.length === 0) {
          // Not a teacher_id, try to resolve from user_id
          const userTeacherResult = await client.query(
            `SELECT t.id FROM teachers t WHERE t.user_id = $1 AND t.tenant_id = $2`,
            [teacherId, request.tenantId]
          );

          if (userTeacherResult.rows.length === 0) {
            return reply.status(404).send({ error: "Not Found", message: "Teacher not found for the given user ID" });
          }

          // Use the resolved teacher_id
          teacherId = userTeacherResult.rows[0].id;
          console.log(`✅ Resolved user_id ${userIdHeader} to teacher_id ${teacherId}`);
        }

        // Get scheduled sessions for the teacher from the current session_instances table.
        let sql = `
          SELECT
            si.id,
            si.session_date,
            EXTRACT(DOW FROM si.session_date) as day_of_week,
            si.start_time,
            si.end_time,
            si.duration_minutes,
            COALESCE(si.classroom, 'TBD') as room,
            si.class_id,
            c.name as class_name,
            c.code as class_code,
            si.course_id,
            co.name as course_name,
            co.code as course_code,
            si.teacher_id,
            COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'TBD') as teacher_name,
            COALESCE(si.status, 'scheduled') as status,
            si.created_at,
            si.updated_at
          FROM session_instances si
          JOIN classes c ON si.class_id = c.id AND c.tenant_id = si.tenant_id
          JOIN courses co ON si.course_id = co.id AND co.tenant_id = si.tenant_id
          LEFT JOIN teachers t ON si.teacher_id = t.id AND t.tenant_id = si.tenant_id
          LEFT JOIN users u ON t.user_id = u.id AND u.tenant_id = t.tenant_id
          WHERE si.tenant_id = $1
            AND si.teacher_id = $2
        `;

        const params: any[] = [request.tenantId, teacherId];
        let paramIndex = 3;

        if (query.startDate) {
          sql += ` AND si.session_date >= $${paramIndex}`;
          params.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          sql += ` AND si.session_date <= $${paramIndex}`;
          params.push(query.endDate);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          sql += ` AND c.academic_year_id = $${paramIndex}`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        sql += ` ORDER BY si.session_date ASC, si.start_time ASC`;

        const result = await client.query(sql, params);

        // Format the response to match what the frontend expects
        const formattedData = result.rows.map(row => ({
          id: row.id,
          sessionDate: row.session_date,
          dayOfWeek: row.day_of_week,
          startTime: row.start_time,
          endTime: row.end_time,
          durationMinutes: row.duration_minutes,
          room: row.room,
          classId: row.class_id,
          className: row.class_name,
          classCode: row.class_code,
          courseId: row.course_id,
          courseName: row.course_name,
          courseCode: row.course_code,
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));

        return reply.send({ data: formattedData });

      } catch (error) {
        fastify.log.error(`Scheduled sessions error: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch scheduled sessions",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teacher-assignments/calendar - Get calendar view of teacher's scheduled sessions
  fastify.get("/calendar", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          teacherId: { type: "string", format: "uuid" },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          view: { type: "string", enum: ["week", "month", "semester"] },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const query = request.query as any;
      const userIdHeader = request.headers['x-user-id'] as string;

      // Use teacherId from query or header
      let teacherId = query.teacherId || userIdHeader;

      if (!teacherId) {
        return reply.status(400).send({ error: "Bad Request", message: "teacherId is required" });
      }

      const client = await fastify.pg.connect();
      try {
        // Check if the provided ID is a user_id (not a teacher_id)
        // If it's a user_id, resolve it to the actual teacher_id
        const teacherCheckResult = await client.query(
          `SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2`,
          [teacherId, request.tenantId]
        );

        if (teacherCheckResult.rows.length === 0) {
          // Not a teacher_id, try to resolve from user_id
          const userTeacherResult = await client.query(
            `SELECT t.id FROM teachers t WHERE t.user_id = $1 AND t.tenant_id = $2`,
            [teacherId, request.tenantId]
          );

          if (userTeacherResult.rows.length === 0) {
            return reply.status(404).send({ error: "Not Found", message: "Teacher not found for the given user ID" });
          }

          // Use the resolved teacher_id
          teacherId = userTeacherResult.rows[0].id;
          console.log(`✅ Resolved user_id ${userIdHeader} to teacher_id ${teacherId}`);
        }

        // Get all scheduled sessions for the teacher
        let sql = `
          SELECT
            si.id as instance_id,
            si.session_date,
            si.start_datetime,
            si.end_datetime,
            si.status,
            COALESCE(si.classroom, 'TBD') as classroom,
            si.class_id,
            c.name as class_name,
            c.code as class_code,
            si.course_id,
            co.name as course_name,
            co.code as course_code,
            si.teacher_id,
            COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'TBD') as teacher_name,
            EXTRACT(DOW FROM si.session_date) as day_of_week,
            si.duration_minutes
          FROM session_instances si
          JOIN classes c ON si.class_id = c.id
          JOIN courses co ON si.course_id = co.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE si.tenant_id = $1
            AND si.teacher_id = $2
        `;

        const params = [request.tenantId, teacherId];
        let paramIndex = 3;

        if (query.startDate) {
          sql += ` AND si.session_date >= $${paramIndex}`;
          params.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          sql += ` AND si.session_date <= $${paramIndex}`;
          params.push(query.endDate);
          paramIndex++;
        }

        if (activeAcademicYearId) {
          sql += ` AND c.academic_year_id = $${paramIndex}`;
          params.push(activeAcademicYearId);
          paramIndex++;
        }

        sql += ` ORDER BY si.session_date, si.start_time`;

        const result = await client.query(sql, params);

        // Get statistics for the teacher's schedule
        let statsSql = `
          SELECT
            COUNT(*) as total_sessions,
            COUNT(DISTINCT si.course_id) as total_courses,
            COUNT(DISTINCT si.class_id) as total_classes,
            SUM(si.duration_minutes) / 60.0 as total_hours,
            MIN(si.session_date) as first_session,
            MAX(si.session_date) as last_session,
            COUNT(*) FILTER (WHERE si.status = 'completed') as completed_sessions,
            COUNT(*) FILTER (WHERE si.status = 'cancelled') as cancelled_sessions
          FROM session_instances si
          WHERE si.tenant_id = $1
            AND si.teacher_id = $2
        `;
        const statsParams: any[] = [request.tenantId, teacherId];
        if (activeAcademicYearId) {
          statsSql += ` AND si.class_id IN (
            SELECT id FROM classes WHERE tenant_id = $1 AND academic_year_id = $3
          )`;
          statsParams.push(activeAcademicYearId);
        }
        const statsResult = await client.query(statsSql, statsParams);
        const stats = statsResult.rows[0] || {
          total_sessions: 0,
          total_courses: 0,
          total_classes: 0,
          total_hours: 0,
          first_session: null,
          last_session: null,
          completed_sessions: 0,
          cancelled_sessions: 0
        };

        return reply.status(200).send({
          teacherId,
          sessions: result.rows,
          stats,
          view: query.view || "month",
          dateRange: {
            startDate: query.startDate || stats.first_session,
            endDate: query.endDate || stats.last_session
          }
        });

      } catch (error) {
        fastify.log.error(`Teacher calendar error: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch teacher calendar",
        });
      } finally {
        client.release();
      }
    },
  });
}
