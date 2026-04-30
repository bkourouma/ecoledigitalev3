import { FastifyInstance } from 'fastify';

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

interface TimeSlotSelection {
  day: string; // monday, tuesday, etc.
  timeSlot: '08:00-10:00' | '10:00-12:00' | '14:00-16:00' | '16:00-18:00' | '08:00-12:00' | '13:00-17:00' | '18:00-20:00';
  courseId: string;
  teacherId: string;
}

interface SimpleScheduleRequest {
  classId: string;
  startDate: string; // YYYY-MM-DD
  timeSlotSelections: TimeSlotSelection[];
}

const TIME_SLOT_CONFIG = {
  // Nouveaux horaires de 2 heures
  '08:00-10:00': { start: '08:00:00', end: '10:00:00', duration: 120 },
  '10:00-12:00': { start: '10:00:00', end: '12:00:00', duration: 120 },
  '14:00-16:00': { start: '14:00:00', end: '16:00:00', duration: 120 },
  '16:00-18:00': { start: '16:00:00', end: '18:00:00', duration: 120 },
  // Anciens horaires
  '08:00-12:00': { start: '08:00:00', end: '12:00:00', duration: 240 },
  '13:00-17:00': { start: '13:00:00', end: '17:00:00', duration: 240 },
  '18:00-20:00': { start: '18:00:00', end: '20:00:00', duration: 120 },
};

export async function simpleScheduleRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // POST /api/v1/simple-schedule/generate
  fastify.post('/generate', {
    schema: {
      tags: ['Simple Schedule'],
      summary: 'Generate schedule directly to session_instances',
      body: {
        type: 'object',
        required: ['classId', 'startDate', 'timeSlotSelections'],
        properties: {
          classId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          timeSlotSelections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['day', 'timeSlot', 'courseId', 'teacherId'],
              properties: {
                day: { 
                  type: 'string',
                  enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                },
                timeSlot: {
                  type: 'string',
                  enum: ['08:00-10:00', '10:00-12:00', '14:00-16:00', '16:00-18:00', '08:00-12:00', '13:00-17:00', '18:00-20:00']
                },
                courseId: { type: 'string', format: 'uuid' },
                teacherId: { type: 'string', format: 'uuid' }
              }
            }
          }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const userId = (request.headers as any)['x-user-id'] || request.user?.id;
      
      if (!tenantId) {
        return reply.status(400).send({
          error: 'Tenant Required',
          message: 'This endpoint requires a tenant',
        });
      }

      const body = request.body as SimpleScheduleRequest;

      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get course hours for each course
        const courseIds = [...new Set(body.timeSlotSelections.map(ts => ts.courseId))];
        const coursesQuery = await pool.query(
          'SELECT id, name, hours_total FROM courses WHERE id = ANY($1) AND tenant_id = $2',
          [courseIds, tenantId]
        );

        const courseHours = new Map<string, { name: string; total: number; used: number }>();
        coursesQuery.rows.forEach((row: any) => {
          courseHours.set(row.id, { name: row.name, total: row.hours_total, used: 0 });
        });

        console.log(`📅 Generating simplified schedule starting ${body.startDate}`);
        console.log(`📚 Courses: ${JSON.stringify(Object.fromEntries(
          Array.from(courseHours.entries()).map(([id, info]) => [info.name, `${info.total}h`])
        ))}`);
        console.log(`👥 Using teachers provided by user selection`);

        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const startDate = new Date(body.startDate);
        const createdSessions: any[] = [];

        // Sort time slot selections by day order
        const sortedSelections = [...body.timeSlotSelections].sort((a, b) => {
          return dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
        });

        // Generate sessions week by week until all courses are satisfied
        let currentWeekStart = new Date(startDate);
        const MAX_WEEKS = 52; // Safety limit
        let weekCount = 0;

        while (weekCount < MAX_WEEKS) {
          let anyHoursRemaining = false;
          
          // Check if any course still needs hours
          for (const [courseId, info] of courseHours.entries()) {
            if (info.used < info.total) {
              anyHoursRemaining = true;
              break;
            }
          }

          if (!anyHoursRemaining) {
            console.log(`✅ All courses satisfied after ${weekCount} weeks`);
            break;
          }

          // For each time slot selection, create a session if course needs hours
          for (const selection of sortedSelections) {
            const courseInfo = courseHours.get(selection.courseId);
            if (!courseInfo || courseInfo.used >= courseInfo.total) {
              continue; // Skip if course is complete
            }

            // Use teacher ID from user selection
            const teacherId = selection.teacherId;
            if (!teacherId) {
              console.warn(`⚠️  No teacher assigned for course ${selection.courseId}, skipping session`);
              continue;
            }

            const config = TIME_SLOT_CONFIG[selection.timeSlot];
            const sessionHours = config.duration / 60;

            // Find the date for this day in the current week
            const targetDay = dayOrder.indexOf(selection.day);
            const sessionDate = new Date(currentWeekStart);
            const currentDay = sessionDate.getDay();
            const daysToAdd = (targetDay + 1 - currentDay + 7) % 7;
            sessionDate.setDate(sessionDate.getDate() + daysToAdd);

            // Create start and end datetime
            const startDatetime = new Date(sessionDate);
            const [startHour, startMin] = config.start.split(':').map(Number);
            startDatetime.setHours(startHour, startMin, 0, 0);

            const endDatetime = new Date(sessionDate);
            const [endHour, endMin] = config.end.split(':').map(Number);
            endDatetime.setHours(endHour, endMin, 0, 0);

            // Insert session instance
            const result = await pool.query(
              `INSERT INTO session_instances (
                tenant_id, class_id, course_id, teacher_id,
                session_date, start_time, end_time, start_datetime, end_datetime,
                classroom, duration_minutes, status, created_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              RETURNING id`,
              [
                tenantId,
                body.classId,
                selection.courseId,
                teacherId,
                sessionDate.toISOString().split('T')[0],
                config.start,
                config.end,
                startDatetime.toISOString(),
                endDatetime.toISOString(),
                'TBD',
                config.duration,
                'scheduled',
                userId
              ]
            );

            // Update hours used
            courseInfo.used += sessionHours;
            
            createdSessions.push({
              id: result.rows[0].id,
              courseName: courseInfo.name,
              date: sessionDate.toISOString().split('T')[0],
              timeSlot: selection.timeSlot,
              hoursUsed: sessionHours,
              hoursRemaining: Math.max(0, courseInfo.total - courseInfo.used)
            });

            console.log(`✅ ${courseInfo.name}: ${sessionDate.toISOString().split('T')[0]} ${selection.timeSlot} (${sessionHours}h, remaining: ${Math.max(0, courseInfo.total - courseInfo.used)}h)`);
          }

          // Move to next week
          currentWeekStart.setDate(currentWeekStart.getDate() + 7);
          weekCount++;
        }

        console.log(`📊 Total sessions created: ${createdSessions.length}`);
        
        return reply.status(201).send({
          success: true,
          message: 'Schedule generated successfully',
          sessions: createdSessions,
          summary: Object.fromEntries(
            Array.from(courseHours.entries()).map(([id, info]) => [
              info.name,
              { required: info.total, scheduled: info.used }
            ])
          )
        });

      } catch (error) {
        console.error('Error generating simple schedule:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to generate schedule',
        });
      }
    }
  });

  // GET /api/v1/simple-schedule/calendar/:classId
  fastify.get('/calendar/:classId', {
    schema: {
      tags: ['Simple Schedule'],
      summary: 'Get calendar for a class',
      params: {
        type: 'object',
        properties: {
          classId: { type: 'string', format: 'uuid' }
        },
        required: ['classId']
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const { classId } = request.params as { classId: string };

      if (!tenantId) {
        return reply.status(400).send({
          error: 'Tenant Required',
          message: 'This endpoint requires a tenant',
        });
      }

      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const result = await pool.query(
          `SELECT 
            si.id as instance_id,
            si.session_date,
            si.start_datetime,
            si.end_datetime,
            si.status,
            si.classroom,
            si.duration_minutes,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            cl.id as class_id,
            cl.name as class_name,
            COALESCE(
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
              NULLIF(TRIM(CONCAT(t.first_name, ' ', t.last_name)), ''),
              'TBD'
            ) as teacher_name,
            t.id as teacher_id
          FROM session_instances si
          JOIN courses c ON si.course_id = c.id
          JOIN classes cl ON si.class_id = cl.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE si.tenant_id = $1 AND si.class_id = $2
          ORDER BY si.session_date, si.start_time`,
          [tenantId, classId]
        );

        return reply.send({
          success: true,
          sessions: result.rows
        });

      } catch (error) {
        console.error('Error fetching calendar:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch calendar',
        });
      }
    }
  });
}

