import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerAcademicResponse } from "@ecoledigitale/contracts";

/** Seuil documenté : moyenne générale de classe sous ce seuil ⇒ « à risque » (lecture seule). */
export const OWNER_ACADEMIC_RISK_GRADE_THRESHOLD = 10;

async function safeQuery<T>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner academic query failed");
    return [];
  }
}

export async function fetchOwnerAcademic(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerAcademicResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const avgClassRows = await safeQuery<{
      class_id: string;
      class_name: string;
      student_count: string | number;
      avg_grade: string | number | null;
    }>(
      client,
      `SELECT c.id AS class_id,
              c.name AS class_name,
              COUNT(DISTINCT spca.student_id)::int AS student_count,
              AVG(spca.average)::float8 AS avg_grade
       FROM student_period_course_averages spca
       JOIN classes c ON c.id = spca.class_id AND c.tenant_id = spca.tenant_id
       WHERE spca.tenant_id = $1::uuid
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [tenantId],
      log,
      "averagesByClass"
    );

    const semesterRows = await safeQuery<{
      period_id: string;
      period_name: string;
      sort_order: number;
      avg_grade: string | number | null;
    }>(
      client,
      `SELECT ayp.id AS period_id,
              ayp.name AS period_name,
              ayp.sort_order,
              AVG(spca.average)::float8 AS avg_grade
       FROM student_period_course_averages spca
       JOIN academic_year_periods ayp
         ON ayp.id = spca.academic_year_period_id AND ayp.tenant_id = spca.tenant_id
       WHERE spca.tenant_id = $1::uuid
       GROUP BY ayp.id, ayp.name, ayp.sort_order
       ORDER BY ayp.sort_order, ayp.name`,
      [tenantId],
      log,
      "semesterAverages"
    );

    const progRows = await safeQuery<{
      programme_id: string;
      programme_name: string;
      student_count: string | number;
      success_rate: string | number | null;
    }>(
      client,
      `WITH per_student_prog AS (
         SELECT spca.student_id,
                p.id AS programme_id,
                p.name AS programme_name,
                AVG(spca.average)::float8 AS m
         FROM student_period_course_averages spca
         JOIN classes c ON c.id = spca.class_id AND c.tenant_id = spca.tenant_id
         JOIN programmes p ON p.id = c.programme_id AND p.tenant_id = c.tenant_id
         WHERE spca.tenant_id = $1::uuid
         GROUP BY spca.student_id, p.id, p.name
       )
       SELECT programme_id,
              programme_name,
              COUNT(*)::int AS student_count,
              CASE WHEN COUNT(*) > 0
                THEN (100.0 * COUNT(*) FILTER (WHERE m >= 10) / COUNT(*))::float8
                ELSE 0::float8 END AS success_rate
       FROM per_student_prog
       GROUP BY programme_id, programme_name
       ORDER BY programme_name`,
      [tenantId],
      log,
      "successByProgram"
    );

    const attRows = await safeQuery<{
      class_id: string;
      class_name: string;
      week_start: Date;
      total_records: string | number;
      presentish: string | number;
    }>(
      client,
      `SELECT c.id AS class_id,
              c.name AS class_name,
              date_trunc('week', tas.session_date::timestamp)::date AS week_start,
              COUNT(*)::int AS total_records,
              COUNT(*) FILTER (
                WHERE tar.attendance_status IN ('present'::attendance_status, 'late'::attendance_status)
              )::int AS presentish
       FROM teacher_attendance_records tar
       JOIN teacher_attendance_sessions tas
         ON tas.id = tar.session_id AND tas.tenant_id = tar.tenant_id
       JOIN teacher_assignments tassign
         ON tassign.id = tas.assignment_id AND tassign.tenant_id = tas.tenant_id
       JOIN class_courses cc ON cc.id = tassign.class_course_id AND cc.tenant_id = tas.tenant_id
       JOIN classes c ON c.id = cc.class_id AND c.tenant_id = tas.tenant_id
       WHERE tar.tenant_id = $1::uuid
         AND tas.session_date >= (CURRENT_DATE - INTERVAL '56 days')
       GROUP BY c.id, c.name, date_trunc('week', tas.session_date::timestamp)
       ORDER BY week_start DESC, c.name`,
      [tenantId],
      log,
      "attendanceByClassWeek"
    );

    const assignRow = await client
      .query<{
        total: string | number;
        graded: string | number;
        graded_rate: string | number | null;
      }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'graded')::int AS graded,
                CASE WHEN COUNT(*) > 0
                  THEN (100.0 * COUNT(*) FILTER (WHERE status = 'graded') / COUNT(*))::float8
                  ELSE 0::float8 END AS graded_rate
         FROM assignment_submissions
         WHERE tenant_id = $1::uuid`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner academic assignments aggregate failed");
        return { rows: [{ total: 0 as const, graded: 0 as const, graded_rate: 0 as const }] };
      });

    const ar = assignRow.rows[0] ?? { total: 0, graded: 0, graded_rate: 0 };
    const totalSubmissions = Number(ar.total) || 0;
    const gradedSubmissions = Number(ar.graded) || 0;
    const gradedRate = Number(ar.graded_rate) || 0;

    const riskRows = await safeQuery<{
      class_id: string;
      class_name: string;
      average_grade: string | number | null;
    }>(
      client,
      `SELECT c.id AS class_id,
              c.name AS class_name,
              AVG(spca.average)::float8 AS average_grade
       FROM student_period_course_averages spca
       JOIN classes c ON c.id = spca.class_id AND c.tenant_id = spca.tenant_id
       WHERE spca.tenant_id = $1::uuid
       GROUP BY c.id, c.name
       HAVING AVG(spca.average) < $2::float8
       ORDER BY average_grade ASC NULLS LAST`,
      [tenantId, OWNER_ACADEMIC_RISK_GRADE_THRESHOLD],
      log,
      "atRiskClasses"
    );

    return {
      riskGradeThreshold: OWNER_ACADEMIC_RISK_GRADE_THRESHOLD,
      averagesByClass: avgClassRows.map((r) => ({
        classId: r.class_id,
        className: r.class_name,
        studentCount: Math.round(Number(r.student_count)) || 0,
        averageGrade: Math.round((Number(r.avg_grade) || 0) * 100) / 100,
      })),
      semesterAverages: semesterRows.map((r) => ({
        periodId: r.period_id,
        periodName: r.period_name,
        sortOrder: r.sort_order,
        averageGrade: Math.round((Number(r.avg_grade) || 0) * 100) / 100,
      })),
      successByProgram: progRows.map((r) => ({
        programmeId: r.programme_id,
        programmeName: r.programme_name,
        studentCount: Math.round(Number(r.student_count)) || 0,
        successRate: Math.round((Number(r.success_rate) || 0) * 10) / 10,
      })),
      attendanceByClassWeek: attRows.map((r) => {
        const total = Number(r.total_records) || 0;
        const pres = Number(r.presentish) || 0;
        const presentRate = total > 0 ? Math.round((pres * 1000) / total) / 10 : 0;
        return {
          classId: r.class_id,
          className: r.class_name,
          weekStart: r.week_start instanceof Date ? r.week_start.toISOString().slice(0, 10) : String(r.week_start),
          presentRate,
          totalRecords: total,
        };
      }),
      assignments: {
        gradedRate: Math.round(gradedRate * 10) / 10,
        totalSubmissions,
        gradedSubmissions,
      },
      atRiskClasses: riskRows.map((r) => ({
        classId: r.class_id,
        className: r.class_name,
        averageGrade: Math.round((Number(r.average_grade) || 0) * 100) / 100,
        threshold: OWNER_ACADEMIC_RISK_GRADE_THRESHOLD,
      })),
    };
  } finally {
    client.release();
  }
}
