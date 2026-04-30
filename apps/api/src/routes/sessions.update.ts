import { FastifyInstance } from 'fastify';

export async function sessionsUpdateRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  fastify.patch('/:id', async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: 'Tenant Required', message: 'This endpoint requires tenant context' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { startDateTime?: string; endDateTime?: string; notes?: string };
    try {
      await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

      const currentRes = await pool.query(`
        SELECT *
        FROM session_instances
        WHERE id = $1 AND tenant_id = $2
      `, [id, request.tenantId]);
      if (currentRes.rows.length === 0) return reply.status(404).send({ error: 'Not Found', message: 'Session not found' });
      const current = currentRes.rows[0];

      // Parse times if updating
      let sessionDate = current.session_date;
      let startTime = current.start_time;
      let endTime = current.end_time;
      let startDatetime = current.start_datetime;
      let endDatetime = current.end_datetime;
      
      if (body.startDateTime) {
        const dt = new Date(body.startDateTime);
        sessionDate = dt.toISOString().split('T')[0];
        startTime = dt.toTimeString().split(' ')[0];
        startDatetime = body.startDateTime;
      }
      if (body.endDateTime) {
        const dt = new Date(body.endDateTime);
        endTime = dt.toTimeString().split(' ')[0];
        endDatetime = body.endDateTime;
      }

      // Overlap check - simplified for same date
      const overlap = await pool.query(
        `SELECT 1 FROM session_instances si
         WHERE si.tenant_id = $1 AND si.id <> $2 AND (si.teacher_id = $3 OR si.class_id = $4)
           AND si.session_date = $5
           AND (si.start_time < $6 AND si.end_time > $7)
         LIMIT 1`,
        [request.tenantId, id, current.teacher_id, current.class_id, sessionDate, endTime, startTime]
      );
      if (overlap.rows.length > 0) {
        return reply.status(409).send({ error: 'Conflict', message: 'Overlapping session exists for teacher or class' });
      }

      const fields: string[] = [];
      const vals: any[] = [];
      let i = 1;
      if (body.startDateTime) { 
        fields.push(`session_date = $${i}`); vals.push(sessionDate); i++; 
        fields.push(`start_time = $${i}`); vals.push(startTime); i++; 
        fields.push(`start_datetime = $${i}`); vals.push(startDatetime); i++; 
      }
      if (body.endDateTime) { 
        fields.push(`end_time = $${i}`); vals.push(endTime); i++; 
        fields.push(`end_datetime = $${i}`); vals.push(endDatetime); i++;
        // Update duration
        const dur = Math.round((new Date(`2000-01-01 ${endTime}`).getTime() - new Date(`2000-01-01 ${startTime}`).getTime()) / 60000);
        fields.push(`duration_minutes = $${i}`); vals.push(dur); i++;
      }
      if (body.notes !== undefined) {
        fields.push(`notes = $${i}`); vals.push(body.notes); i++;
      }
      if (fields.length === 0) return reply.status(400).send({ error: 'Bad Request', message: 'No changes provided' });

      vals.push(id, request.tenantId);
      const sql = `UPDATE session_instances SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`;
      const up = await pool.query(sql, vals);
      return reply.send({ success: true, data: up.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update session' });
    }
  });
}


