import { FastifyInstance } from 'fastify';

export async function sessionsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/sessions?start&end - returns sessions for current teacher (if resolvable)
  fastify.get('/', async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: 'Tenant Required', message: 'This endpoint requires tenant context' });
    }
    const { start, end } = request.query as { start?: string; end?: string };
    try {
      await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

      const params: any[] = [request.tenantId];
      let i = 2;
      let where = 'si.tenant_id = $1';
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      // Resolve teacher to scope results
      const userIdHeader = request.headers['x-user-id'] as string | undefined;
      const possibleIds: string[] = [];
      if (userIdHeader) possibleIds.push(userIdHeader);
      if (request.user?.id) possibleIds.push(request.user.id);
      let teacherFilterId: string | undefined;
      for (const candidate of possibleIds) {
        const asTeacher = await pool.query('SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2', [candidate, request.tenantId]);
        if (asTeacher.rows.length > 0) { teacherFilterId = asTeacher.rows[0].id; break; }
        const asUser = await pool.query('SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2', [candidate, request.tenantId]);
        if (asUser.rows.length > 0) { teacherFilterId = asUser.rows[0].id; break; }
      }
      if (teacherFilterId) {
        where += ` AND teacher_id = $${i}`;
        params.push(teacherFilterId);
        i++;
      }
      if (activeAcademicYearId) {
        where += ` AND c.academic_year_id = $${i}`;
        params.push(activeAcademicYearId);
        i++;
      }
      if (start) { where += ` AND start_datetime >= $${i}`; params.push(start); i++; }
      if (end) { where += ` AND end_datetime <= $${i}`; params.push(end); i++; }

      const sql = `
        SELECT 
          si.id,
          si.teacher_id,
          si.class_id,
          c.name as class_name,
          c.code as class_code,
          si.course_id,
          co.name as course_name,
          co.code as course_code,
          si.start_datetime::text as start_datetime,
          si.end_datetime::text as end_datetime,
          COALESCE(si.notes, '') as notes
        FROM session_instances si
        JOIN classes c ON si.class_id = c.id AND c.tenant_id = si.tenant_id
        JOIN courses co ON si.course_id = co.id AND co.tenant_id = si.tenant_id
        WHERE ${where}
        ORDER BY si.start_datetime ASC
      `;

      const res = await pool.query(sql, params);
      return reply.send({ data: res.rows.map((r: any) => ({
        id: r.id,
        teacherId: r.teacher_id,
        classId: r.class_id,
        className: r.class_name,
        classCode: r.class_code,
        courseId: r.course_id,
        courseName: r.course_name,
        courseCode: r.course_code,
        startDateTime: r.start_datetime,
        endDateTime: r.end_datetime,
        notes: r.notes ?? undefined,
      })) });
    } catch (err: any) {
      fastify.log.error('Error in /sessions GET:', err);
      console.error('Detailed error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list sessions', details: errorMessage });
    }
  });

  // POST /api/v1/sessions
  fastify.post('/', async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: 'Tenant Required', message: 'This endpoint requires tenant context' });
    }
    const body = request.body as { classId: string; courseId: string; startDateTime: string; endDateTime: string; notes?: string };
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
    try {
      await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

      // Resolve teacher_id from either x-user-id header or authenticated user
      const userIdHeader = request.headers['x-user-id'] as string | undefined;
      const possibleIds: string[] = [];
      if (userIdHeader) possibleIds.push(userIdHeader);
      if (request.user?.id) possibleIds.push(request.user.id);
      let teacherId: string | undefined;
      for (const candidate of possibleIds) {
        // Try as teacher_id directly
        const asTeacher = await pool.query('SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2', [candidate, request.tenantId]);
        if (asTeacher.rows.length > 0) { teacherId = asTeacher.rows[0].id; break; }
        // Try as user_id mapping to teacher
        const asUser = await pool.query('SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2', [candidate, request.tenantId]);
        if (asUser.rows.length > 0) { teacherId = asUser.rows[0].id; break; }
      }
      if (!teacherId) {
        return reply.status(401).send({ error: 'Authentication Required', message: 'Unable to resolve teacher from user context' });
      }

      if (activeAcademicYearId) {
        const classYearCheck = await pool.query(
          `SELECT 1 FROM classes WHERE id = $1 AND tenant_id = $2 AND academic_year_id = $3`,
          [body.classId, request.tenantId, activeAcademicYearId]
        );
        if (classYearCheck.rows.length === 0) {
          return reply.status(400).send({
            error: 'Academic Year Mismatch',
            message: "La classe sélectionnée n'appartient pas à l'année académique active",
          });
        }
      }

      // Parse start/end to extract date and time
      const startDt = new Date(body.startDateTime);
      const endDt = new Date(body.endDateTime);
      const sessionDate = startDt.toISOString().split('T')[0];
      const startTime = startDt.toTimeString().split(' ')[0];
      const endTime = endDt.toTimeString().split(' ')[0];
      const durationMinutes = Math.round((endDt.getTime() - startDt.getTime()) / 60000);

      // Validate no overlaps - check for same teacher or class on same date/time
      const overlap = await pool.query(
        `SELECT 1 FROM session_instances si
         WHERE si.tenant_id = $1 AND (si.teacher_id = $2 OR si.class_id = $3)
           AND si.session_date = $4
           AND (
             (si.start_time < $5 AND si.end_time > $6) OR
             (si.start_time >= $6 AND si.start_time < $5)
           )
         LIMIT 1`,
        [request.tenantId, teacherId, body.classId, sessionDate, endTime, startTime]
      );
      if (overlap.rows.length > 0) {
        return reply.status(409).send({ error: 'Conflict', message: 'Overlapping session exists for teacher or class' });
      }

      const ins = await pool.query(
        `INSERT INTO session_instances 
         (tenant_id, class_id, course_id, teacher_id, session_date, start_time, end_time, start_datetime, end_datetime, duration_minutes, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11)
         RETURNING id`,
        [request.tenantId, body.classId, body.courseId, teacherId, sessionDate, startTime, endTime, body.startDateTime, body.endDateTime, durationMinutes, body.notes || null]
      );

      return reply.status(201).send({
        id: ins.rows[0].id,
        teacherId: teacherId,
        classId: body.classId,
        courseId: body.courseId,
        startDateTime: body.startDateTime,
        endDateTime: body.endDateTime,
        notes: body.notes ?? undefined,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create session' });
    }
  });

  // Mount update route
  fastify.register(async function (child) {
    const { sessionsUpdateRoutes } = await import('./sessions.update');
    await sessionsUpdateRoutes(child);
  });

  // DELETE /api/v1/sessions/:id
  fastify.delete('/:id', async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: 'Tenant Required', message: 'This endpoint requires tenant context' });
    }
    const { id } = request.params as { id: string };
    try {
      const del = await pool.query('DELETE FROM session_instances WHERE id = $1 AND tenant_id = $2', [id, request.tenantId]);
      if ((del.rowCount || 0) === 0) return reply.status(404).send({ error: 'Not Found', message: 'Session not found' });
      return reply.status(204).send();
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to delete session' });
    }
  });
}


