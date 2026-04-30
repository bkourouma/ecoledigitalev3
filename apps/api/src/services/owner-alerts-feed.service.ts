import type { PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";

async function countMetric(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<number> {
  try {
    const r = await client.query<{ v: string | null }>(sql, params);
    const raw = r.rows[0]?.v;
    return Math.round(parseFloat(raw != null ? String(raw) : "0") || 0);
  } catch (e) {
    log.warn({ err: e, label }, "owner alerts feed metric skipped");
    return 0;
  }
}

/**
 * Règles métier simples : insère au plus une alerte non acquittée par domaine `auto_*`
 * si la condition est vraie (tant qu’une alerte du même domaine reste ouverte, pas de doublon).
 */
export async function syncOwnerPilotageAlerts(
  client: PoolClient,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const tuitionOverdue = await countMetric(
    client,
    `SELECT COUNT(DISTINCT student_id)::text AS v
     FROM student_tuition_installments
     WHERE tenant_id = $1::uuid
       AND status = 'overdue'::installment_status
       AND due_date < (CURRENT_DATE - INTERVAL '60 days')`,
    [tenantId],
    log,
    "tuitionOverdue"
  );

  const coursesGap = await countMetric(
    client,
    `SELECT COUNT(DISTINCT cc.course_id)::text AS v
     FROM class_courses cc
     LEFT JOIN teacher_assignments ta
       ON ta.class_course_id = cc.id AND ta.tenant_id = cc.tenant_id AND ta.status = 'active'::assignment_status
     WHERE cc.tenant_id = $1::uuid AND ta.id IS NULL`,
    [tenantId],
    log,
    "coursesGap"
  );

  const payrollPending = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
     FROM teacher_payments
     WHERE tenant_id = $1::uuid
       AND status = 'calculated'::payment_status
       AND approved_at IS NULL`,
    [tenantId],
    log,
    "payrollPending"
  );

  const inserts: Array<{ domain: string; severity: string; message: string }> = [];
  if (tuitionOverdue > 0) {
    inserts.push({
      domain: "auto_tuition_overdue",
      severity: "high",
      message: `${tuitionOverdue} impayé(s) scolarité en retard de plus de 60 jours (élèves distincts).`,
    });
  }
  if (coursesGap > 0) {
    inserts.push({
      domain: "auto_courses_unassigned",
      severity: "medium",
      message: `${coursesGap} cours (références distinctes) sans enseignant titulaire actif sur des classes.`,
    });
  }
  if (payrollPending > 0) {
    inserts.push({
      domain: "auto_payroll_pending",
      severity: "medium",
      message: `${payrollPending} fiche(s) de rémunération enseignant en attente de validation.`,
    });
  }

  for (const row of inserts) {
    try {
      await client.query(
        `INSERT INTO owner_pilotage_alerts (tenant_id, severity, message, domain)
         SELECT $1::uuid, $2::varchar(10), $3::text, $4::varchar(64)
         WHERE NOT EXISTS (
           SELECT 1 FROM owner_pilotage_alerts a
           WHERE a.tenant_id = $1::uuid
             AND a.domain = $4::varchar(64)
             AND a.acknowledged_at IS NULL
         )`,
        [tenantId, row.severity, row.message, row.domain]
      );
    } catch (e) {
      log.warn({ err: e, domain: row.domain }, "owner pilotage alert insert skipped");
    }
  }
}
