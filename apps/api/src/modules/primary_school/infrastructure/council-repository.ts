/** Conseil des maîtres : dossiers de séance, feuille de présence, procès-verbal figé. */
import type { Tx } from "@ecoledigitale/database";
import type { CouncilAttendanceRow, CouncilCase, CouncilRole, Uuid } from "../domain/types";
import { ATTENDANCE_COLUMNS, CASE_COLUMNS, toAttendance, toCase } from "./rows";

type CaseWithPeriod = CouncilCase & { academicPeriodId: string | null };

export async function listCasesOf(tx: Tx, deliberationId: Uuid): Promise<CaseWithPeriod[]> {
  const rows = await tx.many(`SELECT ${CASE_COLUMNS} FROM primary_school.council_cases c WHERE c.deliberation_id = $1 ORDER BY c.created_at, c.id`, [deliberationId]);
  return rows.map(toCase);
}

export async function getCaseRow(tx: Tx, id: Uuid, forUpdate = false): Promise<CaseWithPeriod | null> {
  const r = await tx.queryOne(`SELECT ${CASE_COLUMNS} FROM primary_school.council_cases c WHERE c.id = $1 ${forUpdate ? "FOR UPDATE OF c" : ""}`, [id]);
  return r ? toCase(r) : null;
}

export async function insertCaseIfAbsent(
  tx: Tx,
  c: { id: Uuid; tenantId: Uuid; deliberationId: Uuid; classroomId: Uuid; periodId: Uuid; enrollmentId: Uuid; studentId: Uuid; reasonCodes: readonly string[]; proposalCode: string | null },
): Promise<boolean> {
  const rows = await tx.many(
    `INSERT INTO primary_school.council_cases (id, tenant_id, deliberation_id, classroom_id, academic_period_id, enrollment_id, student_id, reason_codes, proposal_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id, deliberation_id, enrollment_id) DO NOTHING RETURNING id`,
    [c.id, c.tenantId, c.deliberationId, c.classroomId, c.periodId, c.enrollmentId, c.studentId, [...c.reasonCodes], c.proposalCode],
  );
  return rows.length > 0;
}

export async function updateCaseRow(
  tx: Tx,
  id: Uuid,
  p: { proposalCode?: string | null | undefined; proposalNote?: string | null | undefined; discussionNote?: string | null | undefined; status?: "OPEN" | "DEFERRED" | undefined; reasonCodes?: readonly string[] | undefined; proposedByStaffId?: Uuid | null | undefined },
): Promise<CaseWithPeriod> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (p.proposalCode !== undefined) add("proposal_code", p.proposalCode);
  if (p.proposalNote !== undefined) add("proposal_note", p.proposalNote);
  if (p.discussionNote !== undefined) add("discussion_note", p.discussionNote);
  if (p.status !== undefined) add("status", p.status);
  if (p.reasonCodes !== undefined) add("reason_codes", [...p.reasonCodes]);
  if (p.proposedByStaffId !== undefined) add("proposed_by_staff_id", p.proposedByStaffId);
  const r = await tx.queryOne(`UPDATE primary_school.council_cases c SET ${sets.join(", ")} WHERE c.id = $1 RETURNING ${CASE_COLUMNS}`, params);
  return toCase(r);
}

export async function markCaseDecided(tx: Tx, id: Uuid, decisionRef: Uuid): Promise<CaseWithPeriod> {
  const r = await tx.queryOne(`UPDATE primary_school.council_cases c SET status = 'DECIDED', decision_ref = $2, updated_at = now() WHERE c.id = $1 RETURNING ${CASE_COLUMNS}`, [id, decisionRef]);
  return toCase(r);
}

export async function listCasesByDecisionRef(tx: Tx, decisionRef: Uuid): Promise<CaseWithPeriod[]> {
  const rows = await tx.many(`SELECT ${CASE_COLUMNS} FROM primary_school.council_cases c WHERE c.decision_ref = $1`, [decisionRef]);
  return rows.map(toCase);
}

export async function listCouncilSummaries(tx: Tx, f: { classroomId?: Uuid | undefined; periodId?: Uuid | undefined }): Promise<Array<{ deliberationId: Uuid; classroomId: Uuid; periodId: Uuid | null; total: number; open: number; decided: number }>> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.classroomId) { params.push(f.classroomId); where.push(`classroom_id = $${params.length}`); }
  if (f.periodId) { params.push(f.periodId); where.push(`academic_period_id = $${params.length}`); }
  const rows = await tx.many(
    `SELECT deliberation_id, classroom_id, academic_period_id, count(*)::int AS total,
            count(*) FILTER (WHERE status <> 'DECIDED')::int AS open, count(*) FILTER (WHERE status = 'DECIDED')::int AS decided
       FROM primary_school.council_cases WHERE ${where.join(" AND ")}
      GROUP BY deliberation_id, classroom_id, academic_period_id ORDER BY max(created_at) DESC`,
    params,
  );
  return rows.map((r) => ({ deliberationId: r.deliberation_id, classroomId: r.classroom_id, periodId: r.academic_period_id, total: r.total, open: r.open, decided: r.decided }));
}

// ---------------------------------------------------------------------------
// Feuille de présence
// ---------------------------------------------------------------------------

export async function listAttendanceOf(tx: Tx, deliberationId: Uuid): Promise<CouncilAttendanceRow[]> {
  const rows = await tx.many(`SELECT ${ATTENDANCE_COLUMNS} FROM primary_school.council_attendance a WHERE a.deliberation_id = $1 ORDER BY a.created_at, a.staff_id`, [deliberationId]);
  return rows.map(toAttendance);
}

export async function upsertAttendanceRow(
  tx: Tx,
  a: { tenantId: Uuid; deliberationId: Uuid; staffId: Uuid; roleCode: CouncilRole; convened: boolean; present: boolean | null; note: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO primary_school.council_attendance (tenant_id, deliberation_id, staff_id, role_code, convened, present, note) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, deliberation_id, staff_id) DO UPDATE SET role_code = EXCLUDED.role_code, convened = EXCLUDED.convened, present = EXCLUDED.present, note = EXCLUDED.note`,
    [a.tenantId, a.deliberationId, a.staffId, a.roleCode, a.convened, a.present, a.note],
  );
}

export async function deleteUnsignedAttendanceNotIn(tx: Tx, deliberationId: Uuid, keep: readonly Uuid[]): Promise<void> {
  await tx.query(`DELETE FROM primary_school.council_attendance WHERE deliberation_id = $1 AND signed_at IS NULL AND NOT (staff_id = ANY($2::uuid[]))`, [deliberationId, [...keep]]);
}

export async function signAttendance(tx: Tx, deliberationId: Uuid, staffIds: readonly Uuid[], at: Date): Promise<void> {
  if (staffIds.length === 0) return;
  await tx.query(`UPDATE primary_school.council_attendance SET signed_at = $3 WHERE deliberation_id = $1 AND staff_id = ANY($2::uuid[]) AND signed_at IS NULL`, [deliberationId, [...staffIds], at.toISOString()]);
}

// ---------------------------------------------------------------------------
// Procès-verbal figé
// ---------------------------------------------------------------------------

export interface MinutesRow {
  id: Uuid;
  deliberationId: Uuid;
  version: number;
  contentHash: string;
  ruleSourceKind: string | null;
  documentId: Uuid | null;
  requestedAt: Date;
}

const toMinutes = (r: any): MinutesRow => ({ id: r.id, deliberationId: r.deliberation_id, version: r.version, contentHash: r.content_hash, ruleSourceKind: r.rule_source_kind, documentId: r.document_id, requestedAt: r.requested_at });
const MINUTES_COLUMNS = `id, deliberation_id, version, content_hash, rule_source_kind, document_id, requested_at`;

export async function latestMinutes(tx: Tx, deliberationId: Uuid): Promise<MinutesRow | null> {
  const r = await tx.queryOne(`SELECT ${MINUTES_COLUMNS} FROM primary_school.council_minutes WHERE deliberation_id = $1 ORDER BY version DESC LIMIT 1`, [deliberationId]);
  return r ? toMinutes(r) : null;
}

export async function findMinutesByHash(tx: Tx, deliberationId: Uuid, contentHash: string): Promise<MinutesRow | null> {
  const r = await tx.queryOne(`SELECT ${MINUTES_COLUMNS} FROM primary_school.council_minutes WHERE deliberation_id = $1 AND content_hash = $2`, [deliberationId, contentHash]);
  return r ? toMinutes(r) : null;
}

export async function insertMinutes(
  tx: Tx,
  m: { id: Uuid; tenantId: Uuid; deliberationId: Uuid; classroomId: Uuid; periodId: Uuid | null; version: number; content: unknown; contentHash: string; ruleSourceKind: string | null; requestedBy: Uuid },
): Promise<MinutesRow> {
  const r = await tx.queryOne(
    `INSERT INTO primary_school.council_minutes (id, tenant_id, deliberation_id, classroom_id, academic_period_id, version, content, content_hash, rule_source_kind, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${MINUTES_COLUMNS}`,
    [m.id, m.tenantId, m.deliberationId, m.classroomId, m.periodId, m.version, JSON.stringify(m.content), m.contentHash, m.ruleSourceKind, m.requestedBy],
  );
  return toMinutes(r);
}

export async function setMinutesDocument(tx: Tx, id: Uuid, documentId: Uuid): Promise<void> {
  await tx.query(`UPDATE primary_school.council_minutes SET document_id = $2 WHERE id = $1 AND document_id IS NULL`, [id, documentId]);
}
