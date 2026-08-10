import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import {
  OwnerDashboardResponseSchema,
  type OwnerDashboardResponse,
} from "@ecoledigitale/contracts/src/owner.schema";

async function safeNum(client: PoolClient, sql: string, params: unknown[], log: FastifyBaseLogger, label: string): Promise<number> {
  try {
    const r = await client.query<{ v: string | number | null }>(sql, params);
    const raw = r.rows[0]?.v;
    if (raw === null || raw === undefined) return 0;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    log.warn({ err: e, label }, "owner dashboard metric query failed");
    return 0;
  }
}

async function safeQuery<T>(client: PoolClient, sql: string, params: unknown[], log: FastifyBaseLogger, label: string): Promise<T[]> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner dashboard query failed");
    return [];
  }
}

/**
 * Aggregates tenant-scoped KPIs for the Owner dashboard.
 * Queries are best-effort: failures yield zeros / empty arrays.
 */
export async function fetchOwnerDashboardKpis(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerDashboardResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const revenueCurrentMonth = await safeNum(
      client,
      `SELECT COALESCE(SUM(amount), 0)::float8 AS v
       FROM payment_transactions
       WHERE tenant_id = $1
         AND status = 'completed'::transaction_status
         AND date_trunc('month', COALESCE(processed_at, created_at)) = date_trunc('month', CURRENT_TIMESTAMP::timestamptz)`,
      [tenantId],
      log,
      "revenueCurrentMonth"
    );

    const recoveryRate = await safeNum(
      client,
      `SELECT CASE WHEN COALESCE(SUM(amount), 0) > 0
              THEN (100.0 * COALESCE(SUM(amount_paid), 0) / SUM(amount))::float8
              ELSE 0::float8 END AS v
       FROM student_tuition_installments
       WHERE tenant_id = $1`,
      [tenantId],
      log,
      "recoveryRate"
    );

    const recoveryRows = await safeQuery<{ cycle: string; rate: string | number }>(
      client,
      `SELECT cy.name AS cycle,
              CASE WHEN COALESCE(SUM(sti.amount), 0) > 0
                THEN (100.0 * COALESCE(SUM(sti.amount_paid), 0) / SUM(sti.amount))::float8
                ELSE 0::float8 END AS rate
       FROM student_tuition_installments sti
       JOIN student_enrollments se ON se.id = sti.enrollment_id AND se.tenant_id = sti.tenant_id
       JOIN classes cl ON cl.id = se.class_id AND cl.tenant_id = sti.tenant_id
       JOIN programmes p ON p.id = cl.programme_id AND p.tenant_id = sti.tenant_id
       JOIN cycles cy ON cy.id = p.cycle_id AND cy.tenant_id = sti.tenant_id
       WHERE sti.tenant_id = $1
       GROUP BY cy.id, cy.name
       ORDER BY cy.name`,
      [tenantId],
      log,
      "recoveryByCycle"
    );

    const teacherPaymentRate = await safeNum(
      client,
      `SELECT CASE WHEN COUNT(*) > 0
              THEN (100.0 * COUNT(*) FILTER (WHERE status = 'paid'::payment_status) / COUNT(*))::float8
              ELSE 0::float8 END AS v
       FROM teacher_payments
       WHERE tenant_id = $1
         AND date_trunc('month', COALESCE(calculated_at, created_at)) = date_trunc('month', CURRENT_TIMESTAMP::timestamptz)`,
      [tenantId],
      log,
      "teacherPaymentRate"
    );

    const overdueCount = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(DISTINCT student_id)::float8 AS v
         FROM student_tuition_installments
         WHERE tenant_id = $1
           AND status = 'overdue'::installment_status
           AND due_date < (CURRENT_DATE - INTERVAL '60 days')`,
        [tenantId],
        log,
        "overdueCount"
      )
    );

    const totalStudents = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(*)::float8 AS v FROM student_profiles WHERE tenant_id = $1`,
        [tenantId],
        log,
        "totalStudents"
      )
    );

    const totalClasses = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(*)::float8 AS v FROM classes WHERE tenant_id = $1`,
        [tenantId],
        log,
        "totalClasses"
      )
    );

    const averageGrade = await safeNum(
      client,
      `SELECT COALESCE(AVG(average), 0)::float8 AS v
       FROM student_period_course_averages
       WHERE tenant_id = $1`,
      [tenantId],
      log,
      "averageGrade"
    );

    const successRate = await safeNum(
      client,
      `WITH per_student AS (
         SELECT student_id, AVG(average) AS m
         FROM student_period_course_averages
         WHERE tenant_id = $1
         GROUP BY student_id
       )
       SELECT CASE WHEN COUNT(*) > 0
              THEN (100.0 * COUNT(*) FILTER (WHERE m >= 10) / COUNT(*))::float8
              ELSE 0::float8 END AS v
       FROM per_student`,
      [tenantId],
      log,
      "successRate"
    );

    const attendanceRate = await safeNum(
      client,
      `SELECT CASE WHEN COUNT(*) > 0
              THEN (100.0 * COUNT(*) FILTER (WHERE attendance_status IN ('present'::attendance_status, 'late'::attendance_status)) / COUNT(*))::float8
              ELSE 0::float8 END AS v
       FROM teacher_attendance_records tar
       JOIN teacher_attendance_sessions tas ON tas.id = tar.session_id AND tas.tenant_id = tar.tenant_id
       WHERE tar.tenant_id = $1
         AND tas.session_date >= (CURRENT_DATE - INTERVAL '30 days')`,
      [tenantId],
      log,
      "attendanceRate"
    );

    const assignmentsGradedRate = await safeNum(
      client,
      `SELECT CASE WHEN COUNT(*) > 0
              THEN (100.0 * COUNT(*) FILTER (WHERE status = 'graded') / COUNT(*))::float8
              ELSE 0::float8 END AS v
       FROM assignment_submissions
       WHERE tenant_id = $1`,
      [tenantId],
      log,
      "assignmentsGradedRate"
    );

    const activeTeachers = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(*)::float8 AS v FROM teachers WHERE tenant_id = $1 AND status = 'active'::teacher_status`,
        [tenantId],
        log,
        "activeTeachers"
      )
    );

    const totalHoursTaught = await safeNum(
      client,
      `SELECT COALESCE(SUM(hours_taught), 0)::float8 AS v
       FROM teaching_hours
       WHERE tenant_id = $1`,
      [tenantId],
      log,
      "totalHoursTaught"
    );

    const coursesWithoutTeacher = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(DISTINCT cc.course_id)::float8 AS v
         FROM class_courses cc
         LEFT JOIN teacher_assignments ta
           ON ta.class_course_id = cc.id AND ta.tenant_id = cc.tenant_id AND ta.status = 'active'::assignment_status
         WHERE cc.tenant_id = $1 AND ta.id IS NULL`,
        [tenantId],
        log,
        "coursesWithoutTeacher"
      )
    );

    const pendingPayrollValidations = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(*)::float8 AS v
         FROM teacher_payments
         WHERE tenant_id = $1
           AND status = 'calculated'::payment_status
           AND approved_at IS NULL`,
        [tenantId],
        log,
        "pendingPayrollValidations"
      )
    );

    let activeSessions = 0;
    let totalEnrollments = 0;
    let revenueFormations = 0;
    let clientCompanies = 0;
    const proRows = await safeQuery<{ c: string | number }>(
      client,
      `SELECT COUNT(*)::float8 AS c FROM sessions_professionnelles WHERE tenant_id = $1`,
      [tenantId],
      log,
      "formationsSessions"
    );
    if (proRows.length) activeSessions = Math.round(Number(proRows[0].c));

    const enrollRows = await safeQuery<{ c: string | number }>(
      client,
      `SELECT COUNT(*)::float8 AS c FROM inscriptions_professionnelles WHERE tenant_id = $1`,
      [tenantId],
      log,
      "formationsEnrollments"
    );
    if (enrollRows.length) totalEnrollments = Math.round(Number(enrollRows[0].c));

    const revRows = await safeQuery<{ c: string | number }>(
      client,
      `SELECT COALESCE(SUM(montant), 0)::float8 AS c
       FROM paiements_professionnels
       WHERE tenant_id = $1 AND statut = 'valide'::payment_professional_status`,
      [tenantId],
      log,
      "formationsRevenue"
    );
    if (revRows.length) revenueFormations = Number(revRows[0].c);

    const compRows = await safeQuery<{ c: string | number }>(
      client,
      `SELECT COUNT(DISTINCT id)::float8 AS c FROM entreprises_clientes WHERE tenant_id = $1`,
      [tenantId],
      log,
      "formationsCompanies"
    );
    if (compRows.length) clientCompanies = Math.round(Number(compRows[0].c));

    /* ---------------- Module professionnel (LMD) ---------------- */

    /**
     * Étudiants distincts ayant une inscription active à une UE.
     * Piège : `professional_payments` et `professional_enrollments` n'exposent pas
     * l'étudiant de la même façon — ici on part des inscriptions, qui portent
     * `student_id` en direct.
     */
    const proEnrolledStudents = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(DISTINCT en.student_id)::float8 AS v
         FROM professional_enrollments en
         WHERE en.tenant_id = $1::uuid
           AND en.statut IN ('confirmee', 'terminee')`,
        [tenantId],
        log,
        "proEnrolledStudents"
      )
    );

    /** Même mesure arrêtée à la fin du mois précédent, pour la variation. */
    const proEnrolledStudentsPrev = Math.round(
      await safeNum(
        client,
        `SELECT COUNT(DISTINCT en.student_id)::float8 AS v
         FROM professional_enrollments en
         WHERE en.tenant_id = $1::uuid
           AND en.statut IN ('confirmee', 'terminee')
           AND en.created_at < date_trunc('month', CURRENT_DATE)`,
        [tenantId],
        log,
        "proEnrolledStudentsPrev"
      )
    );

    /**
     * Taux de recouvrement des UE.
     * §4.4-3 : le statut « payee » d'une commande ne prouve aucun encaissement,
     * l'encaissé vient toujours de la somme des paiements confirmés. Les paiements
     * sont agrégés par commande avant toute jointure pour éviter de multiplier les
     * montants par le nombre d'inscriptions du lot.
     */
    const proRecoveryRate = await safeNum(
      client,
      `WITH paid_per_order AS (
         SELECT p.order_id, SUM(p.montant)::float8 AS paid
         FROM professional_payments p
         WHERE p.tenant_id = $1::uuid AND p.statut = 'confirme'
         GROUP BY p.order_id
       )
       SELECT CASE WHEN COALESCE(SUM(o.montant_total), 0) > 0
                   THEN (100.0 * COALESCE(SUM(pp.paid), 0) / SUM(o.montant_total))::float8
                   ELSE 0::float8 END AS v
       FROM professional_orders o
       LEFT JOIN paid_per_order pp ON pp.order_id = o.id
       WHERE o.tenant_id = $1::uuid
         AND o.statut <> 'annulee'`,
      [tenantId],
      log,
      "proRecoveryRate"
    );

    /**
     * Taux de réussite du dernier semestre portant des bulletins.
     * On lit `data->>'decision'`, déjà produit par la règle du service de bulletins.
     * ⚠️ `professional_bulletins` n'a pas de RLS : le filtre tenant est la seule
     * isolation sur cette table.
     */
    const proSuccessRows = await safeQuery<{ rate: string | number | null }>(
      client,
      `WITH last_semestre AS (
         SELECT b.semestre_id
         FROM professional_bulletins b
         WHERE b.tenant_id = $1::uuid
         GROUP BY b.semestre_id
         ORDER BY MAX(b.generated_at) DESC
         LIMIT 1
       )
       SELECT CASE WHEN COUNT(*) > 0
                   THEN (100.0 * COUNT(*) FILTER (WHERE b.data->>'decision' = 'admis')
                         / COUNT(*))::float8
                   ELSE NULL END AS rate
       FROM professional_bulletins b
       JOIN last_semestre ls ON ls.semestre_id = b.semestre_id
       WHERE b.tenant_id = $1::uuid`,
      [tenantId],
      log,
      "proSuccessRate"
    );
    const rawSuccess = proSuccessRows[0]?.rate;
    const proSuccessRate =
      rawSuccess === null || rawSuccess === undefined
        ? null
        : Math.round((Number(rawSuccess) || 0) * 10) / 10;

    /** Présence sur les séances des 30 derniers jours. Retards comptés présents. */
    const proAttendanceRate = await safeNum(
      client,
      `SELECT CASE WHEN COUNT(*) > 0
                   THEN (100.0 * COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))
                         / COUNT(*))::float8
                   ELSE 0::float8 END AS v
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances s
         ON s.id = a.seance_id AND s.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1::uuid
         AND s.date >= CURRENT_DATE - INTERVAL '30 days'`,
      [tenantId],
      log,
      "proAttendanceRate"
    );

    const payload: OwnerDashboardResponse = {
      finances: {
        revenueCurrentMonth,
        recoveryRate,
        recoveryByCycle: recoveryRows.map((row) => ({
          cycle: row.cycle,
          rate: typeof row.rate === "number" ? row.rate : parseFloat(String(row.rate)) || 0,
        })),
        teacherPaymentRate,
        overdueCount,
      },
      academic: {
        totalStudents,
        totalClasses,
        averageGrade,
        successRate,
        attendanceRate,
        assignmentsGradedRate,
      },
      staff: {
        activeTeachers,
        totalHoursTaught,
        coursesWithoutTeacher,
        pendingPayrollValidations,
      },
      formations: {
        activeSessions,
        totalEnrollments,
        revenueFormations,
        clientCompanies,
      },
      professional: {
        enrolledStudents: proEnrolledStudents,
        enrolledStudentsPrevMonth: proEnrolledStudentsPrev,
        recoveryRate: Math.round(proRecoveryRate * 10) / 10,
        successRateLastSemester: proSuccessRate,
        attendanceRate30d: Math.round(proAttendanceRate * 10) / 10,
      },
      alerts: [],
    };

    return OwnerDashboardResponseSchema.parse(payload);
  } finally {
    client.release();
  }
}
