/** Convocations des tuteurs. Visibilité : `audience_may_see` ; machine à états et gel après envoi : déclencheurs de la base. */
import type { Tx } from "@ecoledigitale/database";
import type { ConvocationRow } from "./rows";

const COLS = `c.id, c.institution_id AS "institutionId", c.academic_year_id AS "academicYearId", c.enrollment_id AS "enrollmentId", c.student_id AS "studentId",
  c.guardian_ids AS "guardianIds", c.reason_kind AS "reasonKind", c.reason, c.related_measure_id AS "relatedMeasureId", c.related_incident_id AS "relatedIncidentId",
  c.scheduled_at AS "scheduledAt", c.location, c.status, c.convened_by AS "convenedBy", c.convened_by_name AS "convenedByName", c.sent_at AS "sentAt",
  c.notification_ref AS "notificationRef", c.acknowledged_at AS "acknowledgedAt", c.acknowledged_by_guardian_id AS "acknowledgedByGuardianId", c.held_at AS "heldAt",
  c.outcome_note AS "outcomeNote", c.cancel_reason AS "cancelReason", c.rescheduled_from_id AS "rescheduledFromId", c.confidentiality`;

export async function insertConvocation(
  tx: Tx,
  c: {
    id: string; tenantId: string; institutionId: string; academicYearId: string; enrollmentId: string; studentId: string; guardianIds: readonly string[];
    reasonKind: string; reason: string; relatedMeasureId: string | null; relatedIncidentId: string | null; scheduledAt: Date; location: string | null;
    convenedBy: string; convenedByName: string; rescheduledFromId: string | null; confidentiality: string;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.convocations (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, guardian_ids, reason_kind, reason,
        related_measure_id, related_incident_id, scheduled_at, location, convened_by, convened_by_name, rescheduled_from_id, confidentiality)
     VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [c.id, c.tenantId, c.institutionId, c.academicYearId, c.enrollmentId, c.studentId, c.guardianIds, c.reasonKind, c.reason, c.relatedMeasureId, c.relatedIncidentId, c.scheduledAt, c.location, c.convenedBy, c.convenedByName, c.rescheduledFromId, c.confidentiality],
  );
}

export const getConvocation = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<ConvocationRow | null> =>
  tx.queryOne<ConvocationRow>(`SELECT ${COLS} FROM schoollife.convocations c WHERE c.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export interface ConvocationFilter {
  audience: string;
  status?: string | undefined;
  studentId?: string | undefined;
  enrollmentIds?: readonly string[] | undefined;
  convenedBy?: string | undefined;
  /** Convocations à tenir : envoyées ou accusées dont l'échéance n'est pas passée (`from`). */
  upcomingFrom?: Date | undefined;
  limit: number;
  offset: number;
}

export async function listConvocations(tx: Tx, f: ConvocationFilter): Promise<ConvocationRow[]> {
  const where: string[] = [`schoollife.audience_may_see($1, 'CONVOCATION', c.confidentiality, true, c.status, NULL)`];
  const params: unknown[] = [f.audience];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("c.status = ?", f.status);
  if (f.studentId) add("c.student_id = ?", f.studentId);
  if (f.enrollmentIds) add("c.enrollment_id = ANY(?::uuid[])", f.enrollmentIds);
  if (f.convenedBy) add("c.convened_by = ?", f.convenedBy);
  if (f.upcomingFrom) {
    where.push(`c.status IN ('SENT', 'ACKNOWLEDGED')`);
    add("c.scheduled_at >= ?", f.upcomingFrom);
  }
  params.push(f.limit, f.offset);
  return tx.many<ConvocationRow>(
    `SELECT ${COLS} FROM schoollife.convocations c WHERE ${where.join(" AND ")} ORDER BY c.scheduled_at DESC, c.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export interface ConvocationUpdate {
  status?: string;
  notificationRef?: string | null;
  acknowledgedByGuardianId?: string | null;
  outcomeNote?: string | null;
  cancelReason?: string | null;
}

export async function updateConvocation(tx: Tx, id: string, u: ConvocationUpdate): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (u.status !== undefined) set("status", u.status);
  if (u.notificationRef !== undefined) set("notification_ref", u.notificationRef);
  if (u.acknowledgedByGuardianId !== undefined) set("acknowledged_by_guardian_id", u.acknowledgedByGuardianId);
  if (u.outcomeNote !== undefined) set("outcome_note", u.outcomeNote);
  if (u.cancelReason !== undefined) set("cancel_reason", u.cancelReason);
  if (sets.length === 0) return;
  await tx.query(`UPDATE schoollife.convocations SET ${sets.join(", ")} WHERE id = $1`, params);
}
