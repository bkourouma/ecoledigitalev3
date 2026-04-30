import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerPayrollValidateResponse } from "@ecoledigitale/contracts";

export type OwnerPayrollValidateResult =
  | { ok: true; payment: OwnerPayrollValidateResponse }
  | { ok: false; reason: "not_found" | "conflict" };

/**
 * Owner-only transition: teacher_payments.status calculated → approved.
 * Audit is handled by trigger `audit_teacher_payments_trigger` on UPDATE.
 */
export async function validateTeacherPaymentAsOwner(
  pool: Pool,
  tenantId: string,
  paymentId: string,
  approverUserId: string,
  log?: FastifyBaseLogger
): Promise<OwnerPayrollValidateResult> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const sel = await client.query<{
      id: string;
      status: string;
      calculated_at: Date;
      amount: string | number;
      period_name: string | null;
      teacher_name: string;
    }>(
      `SELECT tp.id, tp.status::text AS status, tp.calculated_at,
              tp.total_amount AS amount,
              pp.name AS period_name,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name), u.email, 'Enseignant') AS teacher_name
       FROM teacher_payments tp
       JOIN teachers t ON t.id = tp.teacher_id
       JOIN users u ON u.id = t.user_id
       LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
       WHERE tp.tenant_id = $1::uuid AND tp.id = $2::uuid`,
      [tenantId, paymentId]
    );

    if (sel.rows.length === 0) {
      return { ok: false, reason: "not_found" };
    }

    const row = sel.rows[0];
    if (row.status !== "calculated") {
      return { ok: false, reason: "conflict" };
    }

    const upd = await client.query<{
      id: string;
      status: string;
      calculated_at: Date;
      approved_at: Date | null;
      approved_by: string | null;
    }>(
      `UPDATE teacher_payments
       SET status = 'approved'::payment_status,
           approved_by = $3::uuid,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $2::uuid AND tenant_id = $1::uuid AND status = 'calculated'::payment_status
       RETURNING id, status::text AS status, calculated_at, approved_at, approved_by`,
      [tenantId, paymentId, approverUserId]
    );

    if (upd.rowCount === 0) {
      return { ok: false, reason: "conflict" };
    }

    const u = upd.rows[0];
    const payment: OwnerPayrollValidateResponse = {
      id: u.id,
      teacherName: row.teacher_name,
      periodLabel: row.period_name,
      amount: Number(row.amount) || 0,
      status: u.status,
      calculatedAt: new Date(u.calculated_at).toISOString(),
      approvedAt: u.approved_at ? new Date(u.approved_at).toISOString() : null,
      approvedByUserId: u.approved_by ?? null,
    };

    return { ok: true, payment };
  } catch (e) {
    log?.error({ err: e, paymentId }, "owner payroll validate query failed");
    throw e;
  } finally {
    client.release();
  }
}
