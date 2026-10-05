/** Dispenses d'UE (O-14) et paramètre `exemption_credit_policy` (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import { DEFAULT_EXEMPTION_CREDIT_POLICY, isExemptionCreditPolicy, type ExemptionCreditPolicy, type ExemptionStatus, type UeExemption } from "../domain/exemption";
import type { Uuid } from "../domain/types";

interface Row {
  id: Uuid;
  student_id: Uuid;
  enrollment_id: Uuid;
  ue_node_id: Uuid;
  academic_year_id: Uuid;
  academic_period_id: Uuid;
  credits: string;
  reason: string;
  credit_policy: ExemptionCreditPolicy;
  ledger_id: Uuid | null;
  status: ExemptionStatus;
  granted_by: Uuid;
  granted_at: Date;
  revoked_by: Uuid | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

const COLS = `id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits::text AS credits, reason, credit_policy, ledger_id, status,
  granted_by, granted_at, revoked_by, revoked_at, revoke_reason`;

const toExemption = (r: Row): UeExemption => ({
  id: r.id,
  studentId: r.student_id,
  enrollmentId: r.enrollment_id,
  ueNodeId: r.ue_node_id,
  academicYearId: r.academic_year_id,
  academicPeriodId: r.academic_period_id,
  credits: Number(r.credits),
  reason: r.reason,
  creditPolicy: r.credit_policy,
  ledgerId: r.ledger_id,
  status: r.status,
  grantedBy: r.granted_by,
  grantedAt: r.granted_at,
  revokedBy: r.revoked_by,
  revokedAt: r.revoked_at,
  revokeReason: r.revoke_reason,
});

export async function insertExemption(tx: Tx, tenantId: Uuid, e: Omit<UeExemption, "status" | "revokedBy" | "revokedAt" | "revokeReason">): Promise<void> {
  await tx.query(
    `INSERT INTO higher.ue_exemptions (id, tenant_id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits, reason, credit_policy, ledger_id, status, granted_by, granted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$13)`,
    [e.id, tenantId, e.studentId, e.enrollmentId, e.ueNodeId, e.academicYearId, e.academicPeriodId, e.credits, e.reason, e.creditPolicy, e.ledgerId, e.grantedBy, e.grantedAt.toISOString()],
  );
}

export async function getExemption(tx: Tx, id: Uuid, forUpdate = false): Promise<UeExemption | null> {
  const r = await tx.queryOne<Row>(`SELECT ${COLS} FROM higher.ue_exemptions WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toExemption(r) : null;
}

export async function findActive(tx: Tx, studentId: Uuid, ueNodeId: Uuid): Promise<UeExemption | null> {
  const r = await tx.queryOne<Row>(`SELECT ${COLS} FROM higher.ue_exemptions WHERE student_id = $1 AND ue_node_id = $2 AND status = 'ACTIVE'`, [studentId, ueNodeId]);
  return r ? toExemption(r) : null;
}

export async function listExemptions(tx: Tx, f: { studentId?: Uuid | undefined; ueNodeId?: Uuid | undefined; status?: ExemptionStatus | undefined; limit?: number | undefined }): Promise<UeExemption[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.studentId) { params.push(f.studentId); where.push(`student_id = $${params.length}`); }
  if (f.ueNodeId) { params.push(f.ueNodeId); where.push(`ue_node_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  params.push(Math.min(Math.max(f.limit ?? 100, 1), 500));
  const rows = await tx.many<Row>(`SELECT ${COLS} FROM higher.ue_exemptions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY granted_at DESC, id DESC LIMIT $${params.length}`, params);
  return rows.map(toExemption);
}

export async function markRevoked(tx: Tx, id: Uuid, by: Uuid, at: Date, reason: string): Promise<boolean> {
  const res = await tx.query(
    `UPDATE higher.ue_exemptions SET status = 'REVOKED', revoked_by = $2, revoked_at = $3, revoke_reason = $4 WHERE id = $1 AND status = 'ACTIVE'`,
    [id, by, at.toISOString(), reason],
  );
  return res.rowCount > 0;
}

// --- paramètre d'établissement ----------------------------------------------------------------------------------------

export async function getPolicy(tx: Tx): Promise<ExemptionCreditPolicy> {
  const r = await tx.queryOne<{ exemption_credit_policy: string }>("SELECT exemption_credit_policy FROM higher.settings");
  return r && isExemptionCreditPolicy(r.exemption_credit_policy) ? r.exemption_credit_policy : DEFAULT_EXEMPTION_CREDIT_POLICY;
}

export async function setPolicy(tx: Tx, tenantId: Uuid, policy: ExemptionCreditPolicy, userId: Uuid | null, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO higher.settings (tenant_id, exemption_credit_policy, updated_by, updated_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET exemption_credit_policy = EXCLUDED.exemption_credit_policy, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, policy, userId, at.toISOString()],
  );
}
