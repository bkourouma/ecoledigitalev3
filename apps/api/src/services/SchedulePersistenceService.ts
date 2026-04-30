import { Pool } from 'pg';

interface ScheduleSession {
  id: string;
  courseId: string;
  courseName: string;
  teacherId?: string;
  teacherName?: string;
  timeSlotId: string;
  timeSlotName: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  classroom: string;
  weekPattern?: string;
}

interface ApprovalData {
  requestId: string;
  classId: string;
  sessions: ScheduleSession[];
  startDate: string;
  endDate?: string;
  approvedBy: string;
  tenantId: string;
}

interface SessionInstance {
  sessionDate: string;
  startDatetime: string;
  endDatetime: string;
}

export class SchedulePersistenceService {
  constructor(private pool: Pool) {}

  async persistApprovedSchedule(approvalData: ApprovalData): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // 1. Create approved schedule record
      const approvedScheduleId = await this.createApprovedSchedule(client, approvalData);

      // 2. Create scheduled sessions
      const scheduledSessionIds = await this.createScheduledSessions(client, approvalData, approvedScheduleId);

      // 3. Generate and create session instances
      await this.generateSessionInstances(client, approvalData, scheduledSessionIds);

      await client.query('COMMIT');
      console.log(`✅ Schedule ${approvalData.requestId} persisted successfully`);

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error persisting schedule:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async createApprovedSchedule(client: any, approvalData: ApprovalData): Promise<string> {
    const totalHours = approvalData.sessions.reduce((sum, session) => sum + (session.durationMinutes / 60), 0);
    
    const sql = `
      INSERT INTO approved_schedules (
        tenant_id, generation_request_id, class_id, approved_by,
        academic_start_date, academic_end_date, total_sessions, total_hours
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const result = await client.query(sql, [
      approvalData.tenantId,
      approvalData.requestId,
      approvalData.classId,
      approvalData.approvedBy,
      approvalData.startDate,
      approvalData.endDate || null,
      approvalData.sessions.length,
      totalHours
    ]);

    return result.rows[0].id;
  }

  private async createScheduledSessions(client: any, approvalData: ApprovalData, approvedScheduleId: string): Promise<Map<string, string>> {
    const scheduledSessionIds = new Map<string, string>();

    for (const session of approvalData.sessions) {
      const sql = `
        INSERT INTO scheduled_sessions (
          tenant_id, generation_request_id, class_id, course_id, teacher_id,
          classroom_name, day_of_week, start_time, end_time, duration_minutes,
          start_date, end_date, approved_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `;

      const result = await client.query(sql, [
        approvalData.tenantId,
        approvalData.requestId,
        approvalData.classId,
        session.courseId,
        session.teacherId || null,
        session.classroom,
        session.dayOfWeek,
        session.startTime,
        session.endTime,
        session.durationMinutes,
        approvalData.startDate,
        approvalData.endDate || null,
        approvalData.approvedBy
      ]);

      scheduledSessionIds.set(session.id, result.rows[0].id);
    }

    return scheduledSessionIds;
  }

  private async generateSessionInstances(client: any, approvalData: ApprovalData, scheduledSessionIds: Map<string, string>): Promise<void> {
    const startDate = new Date(approvalData.startDate);
    
    // Calculate intelligent end date based on sessions needed
    const endDate = approvalData.endDate 
      ? new Date(approvalData.endDate) 
      : this.calculateSmartEndDate(startDate, approvalData.sessions);

    console.log(`📅 Generating session instances from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    for (const session of approvalData.sessions) {
      const scheduledSessionId = scheduledSessionIds.get(session.id);
      if (!scheduledSessionId) continue;

      const instances = this.generateDateInstances(session, startDate, endDate);
      
      for (const instance of instances) {
        const sql = `
          INSERT INTO session_instances (
            tenant_id, class_id, course_id, teacher_id,
            session_date, start_time, end_time, start_datetime, end_datetime,
            classroom, duration_minutes, status, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;

        await client.query(sql, [
          approvalData.tenantId,
          approvalData.classId,
          session.courseId,
          session.teacherId || null,
          instance.sessionDate,
          session.startTime,
          session.endTime,
          instance.startDatetime,
          instance.endDatetime,
          session.classroom || 'TBD',
          session.durationMinutes,
          'scheduled',
          approvalData.approvedBy,
        ]);
      }

      console.log(`📚 Generated ${instances.length} instances for ${session.courseName} (${session.dayOfWeek})`);
    }
  }

  private generateDateInstances(session: ScheduleSession, startDate: Date, endDate: Date): SessionInstance[] {
    const instances: SessionInstance[] = [];
    const dayOfWeekMap = {
      'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
      'friday': 5, 'saturday': 6, 'sunday': 0
    };

    const targetDayOfWeek = dayOfWeekMap[session.dayOfWeek as keyof typeof dayOfWeekMap];
    
    // Find first occurrence of the target day
    let currentDate = new Date(startDate);
    while (currentDate.getDay() !== targetDayOfWeek) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Generate weekly instances
    while (currentDate <= endDate) {
      const sessionDate = currentDate.toISOString().split('T')[0];
      
      // Create start and end datetime
      const [startHour, startMinute] = session.startTime.split(':').map(Number);
      const [endHour, endMinute] = session.endTime.split(':').map(Number);
      
      const startDatetime = new Date(currentDate);
      startDatetime.setHours(startHour, startMinute, 0, 0);
      
      const endDatetime = new Date(currentDate);
      endDatetime.setHours(endHour, endMinute, 0, 0);

      instances.push({
        sessionDate,
        startDatetime: startDatetime.toISOString(),
        endDatetime: endDatetime.toISOString()
      });

      // Move to next week
      currentDate.setDate(currentDate.getDate() + 7);
    }

    return instances;
  }

  private calculateSmartEndDate(startDate: Date, sessions: ScheduleSession[]): Date {
    // Group sessions by day of week
    const sessionsByDay = new Map<string, ScheduleSession[]>();
    
    sessions.forEach(session => {
      const existing = sessionsByDay.get(session.dayOfWeek) || [];
      sessionsByDay.set(session.dayOfWeek, [...existing, session]);
    });
    
    // Calculate how many weeks needed based on sessions count
    // Each day can have sessions once per week, so max sessions on one day = weeks needed
    const maxSessionsPerDay = Math.max(...Array.from(sessionsByDay.values()).map(s => s.length));
    
    // No buffer - exact weeks needed
    const weeksNeeded = maxSessionsPerDay;
    
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (weeksNeeded * 7) - 1); // -1 to stay within the last week
    
    console.log(`📅 Smart end date calculation:`);
    console.log(`   Sessions distribution: ${JSON.stringify(Object.fromEntries(
      Array.from(sessionsByDay.entries()).map(([day, sess]) => [day, sess.length])
    ))}`);
    console.log(`   Weeks needed: ${weeksNeeded}`);
    console.log(`   End date: ${endDate.toISOString().split('T')[0]}`);
    
    return endDate;
  }
  
  private getDefaultEndDate(startDate: Date): Date {
    // Default to 4 months (one semester)
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 4);
    return endDate;
  }

  async getScheduleCalendar(classId: string, tenantId: string, startDate?: string, endDate?: string): Promise<any[]> {
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
        si.course_id,
        co.name as course_name,
        co.code as course_code,
        COALESCE(si.teacher_id, fallback_assignment.teacher_id) as teacher_id,
        COALESCE(
          NULLIF(TRIM(CONCAT(u_direct.first_name, ' ', u_direct.last_name)), ''),
          NULLIF(TRIM(CONCAT(t_direct.first_name, ' ', t_direct.last_name)), ''),
          NULLIF(TRIM(CONCAT(u_fallback.first_name, ' ', u_fallback.last_name)), ''),
          NULLIF(TRIM(CONCAT(t_fallback.first_name, ' ', t_fallback.last_name)), ''),
          'TBD'
        ) as teacher_name,
        EXTRACT(DOW FROM si.session_date) as day_of_week,
        si.duration_minutes
      FROM session_instances si
      JOIN classes c ON si.class_id = c.id AND c.tenant_id = si.tenant_id
      JOIN courses co ON si.course_id = co.id AND co.tenant_id = si.tenant_id
      LEFT JOIN teachers t_direct ON si.teacher_id = t_direct.id AND t_direct.tenant_id = si.tenant_id
      LEFT JOIN users u_direct ON t_direct.user_id = u_direct.id AND u_direct.tenant_id = si.tenant_id
      LEFT JOIN LATERAL (
        SELECT ta.teacher_id
        FROM teacher_assignments ta
        JOIN class_courses cc ON cc.id = ta.class_course_id AND cc.tenant_id = ta.tenant_id
        WHERE ta.tenant_id = si.tenant_id
          AND cc.class_id = si.class_id
          AND cc.course_id = si.course_id
          AND si.session_date BETWEEN ta.datebut::date AND ta.datefin::date
        ORDER BY
          CASE ta.status
            WHEN 'active' THEN 0
            WHEN 'paused' THEN 1
            WHEN 'ended' THEN 2
            WHEN 'cancelled' THEN 3
            ELSE 4
          END,
          ta.created_at DESC
        LIMIT 1
      ) fallback_assignment ON si.teacher_id IS NULL
      LEFT JOIN teachers t_fallback ON fallback_assignment.teacher_id = t_fallback.id AND t_fallback.tenant_id = si.tenant_id
      LEFT JOIN users u_fallback ON t_fallback.user_id = u_fallback.id AND u_fallback.tenant_id = si.tenant_id
      WHERE si.tenant_id = $1 AND si.class_id = $2
    `;

    const params = [tenantId, classId];
    let paramIndex = 3;

    if (startDate) {
      sql += ` AND si.session_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND si.session_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY si.session_date, si.start_time`;

    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async getScheduleStats(classId: string, tenantId: string): Promise<any> {
    const sql = `
      SELECT
        COUNT(*) as total_sessions,
        COUNT(DISTINCT si.course_id) as total_courses,
        SUM(si.duration_minutes) / 60.0 as total_hours,
        MIN(si.session_date) as first_session,
        MAX(si.session_date) as last_session,
        COUNT(*) FILTER (WHERE si.status = 'completed') as completed_sessions,
        COUNT(*) FILTER (WHERE si.status = 'cancelled') as cancelled_sessions
      FROM session_instances si
      WHERE si.tenant_id = $1 AND si.class_id = $2
    `;

    const result = await this.pool.query(sql, [tenantId, classId]);
    return result.rows[0] || {
      total_sessions: 0,
      total_courses: 0,
      total_hours: 0,
      first_session: null,
      last_session: null,
      completed_sessions: 0,
      cancelled_sessions: 0
    };
  }
}
