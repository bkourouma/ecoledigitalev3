import { FastifyInstance } from "fastify";
import { z } from "zod";

const listQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  academicYear: z.string().optional(),
  semester: z.coerce.number().int().min(1).max(2).optional(),
  limit: z.coerce.number().min(1).max(500).default(100),
});

const validateAssignmentsSchema = z.object({
  assignments: z.array(z.object({
    assignmentId: z.string().uuid(),
    hoursValidated: z.number().positive(),
  })).min(1),
});

export async function courseAssignmentsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    try {
      let tenantId = (request as any).tenantId as string | undefined;
      if (!tenantId) {
        const headerTenant = (request.headers['x-tenant'] as string | undefined)?.trim();
        if (headerTenant) {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenant);
          if (uuidLike) tenantId = headerTenant; else {
            const tmp = await fastify.pg.connect();
            try {
              const t = await tmp.query('SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1', [headerTenant]);
              if (t.rows.length > 0) tenantId = t.rows[0].id;
            } finally { tmp.release(); }
          }
        }
      }
      if (!tenantId) return reply.status(400).send({ error: 'Tenant Required', message: 'Tenant missing' });

      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation Error', message: parsed.error.message });
      const { teacherId, academicYear, semester, limit } = parsed.data;

      const client = await fastify.pg.connect();
      try {
        let where = 'ca.tenant_id = $1';
        const params: any[] = [tenantId];
        let i = 2;
        if (teacherId) { where += ` AND ca.teacher_id = $${i++}`; params.push(teacherId); }
        if (academicYear) { where += ` AND ca.academic_year = $${i++}`; params.push(academicYear); }
        if (semester) { where += ` AND ca.semester = $${i++}`; params.push(semester); }

        const rows = await client.query(
          `-- Course assignments (existing system)
           SELECT ca.id, ca.teacher_id, ca.course_id, ca.academic_year, ca.semester,
                  ca.start_date, ca.end_date, ca.hours_assigned, ca.hours_validated,
                  ca.validated_by, ca.validated_at,
                  c.code as course_code, c.name as course_name,
                  COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
                  'course_assignment' as source_type
           FROM course_assignments ca
           JOIN courses c ON ca.course_id = c.id
           JOIN teachers t ON ca.teacher_id = t.id
           LEFT JOIN users u ON t.user_id = u.id
           WHERE ${where}

           UNION ALL

           -- Teacher assignments (converted to course assignment format)
           SELECT ta.id, ta.teacher_id, cc.course_id,
                  EXTRACT(YEAR FROM ta.datebut)::TEXT || '-' || EXTRACT(YEAR FROM ta.datefin)::TEXT as academic_year,
                  1 as semester,  -- Default to semester 1 for teacher assignments
                  ta.datebut as start_date, ta.datefin as end_date,
                  CASE
                    WHEN ta.course_amount IS NOT NULL THEN
                      ROUND((ta.datefin - ta.datebut) * 2)::INTEGER  -- Estimate 2 hours per day
                    ELSE 40  -- Default hours
                  END as hours_assigned,
                  NULL as hours_validated, NULL as validated_by, NULL as validated_at,
                  c.code as course_code, c.name as course_name,
                  COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name,
                  'teacher_assignment' as source_type
           FROM teacher_assignments ta
           JOIN class_courses cc ON ta.class_course_id = cc.id
           JOIN courses c ON cc.course_id = c.id
           JOIN teachers t ON ta.teacher_id = t.id
           LEFT JOIN users u ON t.user_id = u.id
           WHERE ta.tenant_id = $1 AND ta.status = 'active'
           ${teacherId ? `AND ta.teacher_id = $${params.findIndex(p => p === teacherId) + 1}` : ''}

           ORDER BY course_code, course_name
           LIMIT $${i}`,
          [...params, limit]
        );

        const data = rows.rows.map(r => ({
          id: r.id,
          teacherId: r.teacher_id,
          courseId: r.course_id,
          academicYear: r.academic_year,
          semester: r.semester,
          startDate: r.start_date,
          endDate: r.end_date,
          hoursAssigned: r.hours_assigned ? parseFloat(r.hours_assigned) : null,
          hoursValidated: r.hours_validated ? parseFloat(r.hours_validated) : null,
          validatedBy: r.validated_by,
          validatedAt: r.validated_at,
          course: { code: r.course_code, name: r.course_name },
          teacherName: r.teacher_name,
          sourceType: r.source_type, // Indicates if this comes from course_assignments or teacher_assignments
        }));

        return reply.send({ data });
      } finally { client.release(); }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch assignments' });
    }
  });

  // POST /api/v1/course-assignments/validate - Validate course assignments
  fastify.post('/validate', async (request, reply) => {
    try {
      let tenantId = (request as any).tenantId as string | undefined;
      let userId = (request as any).userId as string | undefined;

      if (!tenantId) {
        const headerTenant = (request.headers['x-tenant'] as string | undefined)?.trim();
        if (headerTenant) {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenant);
          if (uuidLike) tenantId = headerTenant; else {
            const tmp = await fastify.pg.connect();
            try {
              const t = await tmp.query('SELECT id FROM tenants WHERE slug = $1 OR code = $1 LIMIT 1', [headerTenant]);
              if (t.rows.length > 0) tenantId = t.rows[0].id;
            } finally { tmp.release(); }
          }
        }
      }
      if (!tenantId) return reply.status(400).send({ error: 'Tenant Required', message: 'Tenant missing' });

      // For now, use a default user ID if not provided by auth middleware
      if (!userId) {
        userId = '634a57fe-2007-4ecb-ae5b-f9e3152a24fb'; // Default admin user
      }

      const parsed = validateAssignmentsSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation Error', message: parsed.error.message });
      const { assignments } = parsed.data;

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        let updatedCount = 0;
        let teachingHoursCreated = 0;
        
        for (const assignment of assignments) {
          let courseAssignmentId: string | null = null;
          let sessionDate: string | null = null;
          
          // First, try to update existing course_assignment
          const updateResult = await client.query(
            `UPDATE course_assignments
             SET hours_validated = $1, validated_by = $2, validated_at = NOW(), updated_at = NOW()
             WHERE tenant_id = $3 AND id = $4
             RETURNING id, end_date`,
            [assignment.hoursValidated, userId, tenantId, assignment.assignmentId]
          );

          if (updateResult.rowCount && updateResult.rowCount > 0) {
            courseAssignmentId = updateResult.rows[0].id;
            sessionDate = updateResult.rows[0].end_date || new Date().toISOString().split('T')[0];
            updatedCount += updateResult.rowCount;
          } else {
            // If no course_assignment was updated, check if this is a teacher_assignment
            const teacherAssignmentCheck = await client.query(
              `SELECT ta.id, ta.teacher_id, cc.course_id, ta.datebut, ta.datefin,
                      EXTRACT(YEAR FROM ta.datebut)::TEXT || '-' || EXTRACT(YEAR FROM ta.datefin)::TEXT as academic_year,
                      CASE
                        WHEN ta.course_amount IS NOT NULL THEN
                          ROUND((ta.datefin - ta.datebut) * 2)::INTEGER
                        ELSE 40
                      END as hours_assigned
               FROM teacher_assignments ta
               JOIN class_courses cc ON ta.class_course_id = cc.id
               WHERE ta.tenant_id = $1 AND ta.id = $2 AND ta.status = 'active'`,
              [tenantId, assignment.assignmentId]
            );

            if (teacherAssignmentCheck.rows.length > 0) {
              const ta = teacherAssignmentCheck.rows[0];
              // Create a course_assignment record from the teacher_assignment
              const insertResult = await client.query(
                `INSERT INTO course_assignments
                 (tenant_id, teacher_id, course_id, academic_year, semester, hours_assigned,
                  start_date, end_date, hours_validated, validated_by, validated_at, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, NOW(), NOW(), NOW())
                 RETURNING id, end_date`,
                [tenantId, ta.teacher_id, ta.course_id, ta.academic_year, ta.hours_assigned,
                 ta.datebut, ta.datefin, assignment.hoursValidated, userId]
              );
              if (insertResult.rowCount && insertResult.rowCount > 0) {
                courseAssignmentId = insertResult.rows[0].id;
                sessionDate = insertResult.rows[0].end_date || ta.datefin;
                updatedCount += insertResult.rowCount;
              }
            }
          }
          
          // Create teaching_hours record if we have a course_assignment
          if (courseAssignmentId && sessionDate && assignment.hoursValidated > 0) {
            // Check if teaching_hours already exists for this assignment and date
            const existingHoursCheck = await client.query(
              `SELECT id FROM teaching_hours 
               WHERE tenant_id = $1 AND assignment_id = $2 AND session_date = $3`,
              [tenantId, courseAssignmentId, sessionDate]
            );
            
            if (existingHoursCheck.rows.length === 0) {
              // Create new teaching_hours record
              await client.query(
                `INSERT INTO teaching_hours 
                 (tenant_id, assignment_id, session_date, hours_taught, session_type, validated_by, validated_at)
                 VALUES ($1, $2, $3, $4, 'theory', $5, NOW())`,
                [tenantId, courseAssignmentId, sessionDate, assignment.hoursValidated, userId]
              );
              teachingHoursCreated++;
            } else {
              // Update existing teaching_hours record
              await client.query(
                `UPDATE teaching_hours 
                 SET hours_taught = $1, validated_by = $2, validated_at = NOW()
                 WHERE tenant_id = $3 AND assignment_id = $4 AND session_date = $5`,
                [assignment.hoursValidated, userId, tenantId, courseAssignmentId, sessionDate]
              );
            }
          }
        }

        await client.query('COMMIT');
        fastify.log.info(`Validation complete: ${updatedCount} assignment(s) updated, ${teachingHoursCreated} teaching_hours record(s) created`);
        return reply.send({ 
          data: { 
            updated: updatedCount,
            teachingHoursCreated 
          } 
        });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally { client.release(); }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to validate assignments' });
    }
  });
}

