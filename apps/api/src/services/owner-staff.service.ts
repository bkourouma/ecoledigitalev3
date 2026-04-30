import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerStaffResponse } from "@ecoledigitale/contracts";
import { getTableName, usesSessionBasedProfessionalTraining } from "../utils/table-names";

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
    log.warn({ err: e, label }, "owner staff query failed");
    return [];
  }
}

export async function fetchOwnerStaff(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerStaffResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const teacherRows = await safeQuery<{
      teacher_id: string;
      status: string;
      email: string;
      first_name: string;
      last_name: string;
      hours_total: string | number | null;
      hours_validated: string | number | null;
    }>(
      client,
      `SELECT t.id AS teacher_id,
              t.status::text AS status,
              u.email,
              u.first_name,
              u.last_name,
              COALESCE(SUM(th.hours_taught), 0)::float8 AS hours_total,
              COALESCE(SUM(th.hours_taught) FILTER (WHERE th.validated_at IS NOT NULL), 0)::float8 AS hours_validated
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN teacher_assignments ta
         ON ta.teacher_id = t.id AND ta.tenant_id = t.tenant_id AND ta.status = 'active'::assignment_status
       LEFT JOIN teaching_hours th
         ON th.tenant_id = t.tenant_id AND th.assignment_id = ta.id
       WHERE t.tenant_id = $1::uuid
       GROUP BY t.id, t.status, u.email, u.first_name, u.last_name
       ORDER BY u.email
       LIMIT 200`,
      [tenantId],
      log,
      "staffTeachers"
    );

    const gapRows = await safeQuery<{
      class_course_id: string;
      class_name: string;
      course_name: string;
    }>(
      client,
      `SELECT cc.id AS class_course_id,
              c.name AS class_name,
              co.name AS course_name
       FROM class_courses cc
       JOIN classes c ON c.id = cc.class_id AND c.tenant_id = cc.tenant_id
       JOIN courses co ON co.id = cc.course_id AND co.tenant_id = cc.tenant_id
       LEFT JOIN teacher_assignments ta
         ON ta.class_course_id = cc.id AND ta.tenant_id = cc.tenant_id AND ta.status = 'active'::assignment_status
       WHERE cc.tenant_id = $1::uuid AND ta.id IS NULL
       ORDER BY c.name, co.name
       LIMIT 100`,
      [tenantId],
      log,
      "staffCourseGaps"
    );

    const payrollRows = await safeQuery<{
      id: string;
      teacher_name: string;
      period_name: string | null;
      amount: string | number;
      status: string;
      calculated_at: Date;
    }>(
      client,
      `SELECT tp.id,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name), u.email, 'Enseignant') AS teacher_name,
              pp.name AS period_name,
              tp.total_amount AS amount,
              tp.status::text AS status,
              tp.calculated_at
       FROM teacher_payments tp
       JOIN teachers t ON t.id = tp.teacher_id
       JOIN users u ON u.id = t.user_id
       LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
       WHERE tp.tenant_id = $1::uuid
         AND tp.status = 'calculated'::payment_status
         AND tp.approved_at IS NULL
       ORDER BY tp.calculated_at DESC
       LIMIT 50`,
      [tenantId],
      log,
      "staffPayrollPending"
    );

    let activeFormateurs = 0;
    if (usesSessionBasedProfessionalTraining(tenantId)) {
      const ft = getTableName(tenantId, "formateurs");
      const fr = await safeQuery<{ c: string }>(
        client,
        `SELECT COUNT(*)::text AS c FROM ${ft} WHERE tenant_id = $1::uuid AND actif = true`,
        [tenantId],
        log,
        "staffFormateurs"
      );
      if (fr.length) activeFormateurs = Math.round(parseFloat(fr[0].c) || 0);
    }

    return {
      teachers: teacherRows.map((r) => ({
        teacherId: r.teacher_id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        status: r.status,
        hoursTaught: Math.round((Number(r.hours_total) || 0) * 100) / 100,
        hoursValidated: Math.round((Number(r.hours_validated) || 0) * 100) / 100,
      })),
      coursesWithoutTeacher: gapRows.map((r) => ({
        classCourseId: r.class_course_id,
        className: r.class_name,
        courseName: r.course_name,
      })),
      payrollPending: payrollRows.map((r) => ({
        id: r.id,
        teacherName: r.teacher_name,
        periodLabel: r.period_name,
        amount: Number(r.amount) || 0,
        status: r.status,
        calculatedAt: new Date(r.calculated_at).toISOString(),
      })),
      activeFormateurs: usesSessionBasedProfessionalTraining(tenantId) ? activeFormateurs : undefined,
    };
  } finally {
    client.release();
  }
}
