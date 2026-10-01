/** Justificatifs, pièces jointes et application / révocation de l'excuse sur les pointages couverts. */
import type { Tx } from "@ecoledigitale/database";
import type { IsoDate, Justification, JustificationStatus, SubmitterKind, Uuid } from "../domain/types";
import {
  ATTACHMENT_COLUMNS,
  JUSTIFICATION_COLUMNS,
  decodeCursor,
  encodeCursor,
  toAttachment,
  toJustification,
  type Attachment,
  type AttachmentRow,
  type JustificationRow,
} from "./rows";

export interface NewJustification {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly fromDate: IsoDate;
  readonly toDate: IsoDate;
  readonly reasonCode: string;
  readonly comment: string | null;
  readonly submittedByKind: SubmitterKind;
  readonly submittedByUser: Uuid;
  readonly submittedAt: Date;
}

export async function insertJustification(tx: Tx, j: NewJustification): Promise<Justification> {
  const rows = await tx.many<JustificationRow>(
    `WITH ins AS (
       INSERT INTO attendance.justifications (id, tenant_id, student_id, enrollment_id, from_date, to_date, reason_code, comment,
                                              submitted_by_kind, submitted_by_user, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *)
     SELECT ${JUSTIFICATION_COLUMNS} FROM ins j`,
    [j.id, j.tenantId, j.studentId, j.enrollmentId, j.fromDate, j.toDate, j.reasonCode, j.comment, j.submittedByKind, j.submittedByUser, j.submittedAt.toISOString()],
  );
  return toJustification(rows[0] as JustificationRow);
}

export async function getJustification(tx: Tx, id: Uuid, forUpdate = false): Promise<Justification | null> {
  const r = await tx.queryOne<JustificationRow>(
    `SELECT ${JUSTIFICATION_COLUMNS} FROM attendance.justifications j WHERE j.id = $1 ${forUpdate ? "FOR UPDATE OF j" : ""}`,
    [id],
  );
  return r ? toJustification(r) : null;
}

export interface JustificationFilter {
  studentId?: Uuid | undefined;
  studentIds?: readonly Uuid[] | undefined;
  status?: JustificationStatus | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  submittedByUser?: Uuid | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function listJustifications(tx: Tx, f: JustificationFilter): Promise<{ items: Justification[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.studentId) add("j.student_id = ?", f.studentId);
  if (f.studentIds) add("j.student_id = ANY(?::uuid[])", [...f.studentIds]);
  if (f.status) add("j.status = ?", f.status);
  if (f.from) add("j.to_date >= ?", f.from);
  if (f.to) add("j.from_date <= ?", f.to);
  if (f.submittedByUser) add("j.submitted_by_user = ?", f.submittedByUser);
  const cursor = decodeCursor<{ t: string; i: string }>(f.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.i);
    where.push(`(j.submitted_at, j.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<JustificationRow>(
    `SELECT ${JUSTIFICATION_COLUMNS} FROM attendance.justifications j ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY j.submitted_at DESC, j.id DESC LIMIT $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(toJustification);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ t: last.submittedAt.toISOString(), i: last.id }) : null };
}

export async function decideJustification(
  tx: Tx,
  id: Uuid,
  patch: { status: JustificationStatus; decidedBy: Uuid | null; decidedAt: Date | null; decisionNote: string | null },
): Promise<Justification> {
  const rows = await tx.many<JustificationRow>(
    `WITH upd AS (
       UPDATE attendance.justifications SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5, updated_at = now()
        WHERE id = $1 RETURNING *)
     SELECT ${JUSTIFICATION_COLUMNS} FROM upd j`,
    [id, patch.status, patch.decidedBy, patch.decidedAt?.toISOString() ?? null, patch.decisionNote],
  );
  return toJustification(rows[0] as JustificationRow);
}

/** Révocation tracée à part : la décision d'acceptation (auteur, date, note) est conservée. */
export async function markJustificationRevoked(tx: Tx, id: Uuid, by: Uuid, at: Date, reason: string): Promise<Justification> {
  const rows = await tx.many<JustificationRow>(
    `WITH upd AS (
       UPDATE attendance.justifications SET status = 'REVOKED', revoked_by = $2, revoked_at = $3, revocation_reason = $4, updated_at = now()
        WHERE id = $1 RETURNING *)
     SELECT ${JUSTIFICATION_COLUMNS} FROM upd j`,
    [id, by, at.toISOString(), reason],
  );
  return toJustification(rows[0] as JustificationRow);
}

/** Demande identique déjà en attente (double envoi depuis un téléphone) : on la renvoie au lieu d'en créer une seconde. */
export async function findPendingDuplicate(tx: Tx, studentId: Uuid, fromDate: IsoDate, toDate: IsoDate, reasonCode: string, submittedByUser: Uuid): Promise<Justification | null> {
  const r = await tx.queryOne<JustificationRow>(
    `SELECT ${JUSTIFICATION_COLUMNS} FROM attendance.justifications j
      WHERE j.student_id = $1 AND j.from_date = $2 AND j.to_date = $3 AND j.reason_code = $4 AND j.submitted_by_user = $5 AND j.status = 'PENDING'
      ORDER BY j.submitted_at LIMIT 1`,
    [studentId, fromDate, toDate, reasonCode, submittedByUser],
  );
  return r ? toJustification(r) : null;
}

// --- pièces jointes ---------------------------------------------------------

export async function insertAttachment(
  tx: Tx,
  a: { id: Uuid; tenantId: Uuid; justificationId: Uuid; storageKey: string; fileName: string; detectedMime: string; sizeBytes: number; sha256: string; uploadedBy: Uuid; uploadedAt: Date },
): Promise<Attachment> {
  const rows = await tx.many<AttachmentRow>(
    `INSERT INTO attendance.justification_attachments (id, tenant_id, justification_id, storage_key, file_name, detected_mime, size_bytes, sha256, uploaded_by, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${ATTACHMENT_COLUMNS}`,
    [a.id, a.tenantId, a.justificationId, a.storageKey, a.fileName, a.detectedMime, a.sizeBytes, a.sha256, a.uploadedBy, a.uploadedAt.toISOString()],
  );
  return toAttachment(rows[0] as AttachmentRow);
}

export async function listAttachments(tx: Tx, justificationIds: readonly Uuid[], includeRemoved = false): Promise<Map<Uuid, Attachment[]>> {
  const out = new Map<Uuid, Attachment[]>();
  if (justificationIds.length === 0) return out;
  const rows = await tx.many<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attendance.justification_attachments
      WHERE justification_id = ANY($1::uuid[]) ${includeRemoved ? "" : "AND removed_at IS NULL"} ORDER BY uploaded_at, id`,
    [[...justificationIds]],
  );
  for (const r of rows) {
    const list = out.get(r.justification_id) ?? [];
    list.push(toAttachment(r));
    out.set(r.justification_id, list);
  }
  return out;
}

export async function getAttachment(tx: Tx, justificationId: Uuid, attachmentId: Uuid): Promise<Attachment | null> {
  const r = await tx.queryOne<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attendance.justification_attachments WHERE id = $2 AND justification_id = $1 AND removed_at IS NULL`,
    [justificationId, attachmentId],
  );
  return r ? toAttachment(r) : null;
}

export async function markAttachmentRemoved(tx: Tx, attachmentId: Uuid, at: Date): Promise<void> {
  await tx.query("UPDATE attendance.justification_attachments SET removed_at = $2 WHERE id = $1 AND removed_at IS NULL", [attachmentId, at.toISOString()]);
}

// --- application / révocation de l'excuse -----------------------------------

export interface CoveredRecord {
  readonly recordId: Uuid;
  readonly enrollmentId: Uuid;
  readonly sessionId: Uuid;
  readonly sessionDate: IsoDate;
  readonly academicYearId: Uuid;
}

/**
 * Applique l'excuse de `justificationId` à tous les pointages ABSENT / LATE / EARLY_LEAVE (ou statuts d'absence /
 * de retard personnalisés) de l'élève dans la fenêtre, hors séances annulées et hors pointages déjà couverts.
 * `ABSENT` devient `EXCUSED` (statut d'origine conservé) ; les autres gardent leur statut avec `excused = true`.
 * L'appelant a posé `attendance.excuse_apply = on` (appel validé). Renvoie les pointages couverts.
 */
export async function applyExcuse(tx: Tx, tenantId: Uuid, justificationId: Uuid, studentId: Uuid, fromDate: IsoDate, toDate: IsoDate): Promise<CoveredRecord[]> {
  const rows = await tx.many<{ id: Uuid; enrollment_id: Uuid; session_id: Uuid; session_date: string; academic_year_id: Uuid }>(
    `WITH target AS (
       SELECT r.id
         FROM attendance.student_records r
         JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
         JOIN attendance.status_definitions d ON d.tenant_id = r.tenant_id AND d.subject_kind = r.subject_kind AND d.code = r.status_code
        WHERE r.student_id = $3 AND s.session_date BETWEEN $4::date AND $5::date AND s.status <> 'CANCELLED'
          AND r.justification_id IS NULL AND NOT d.is_justified
          AND (d.counts_as_absence OR d.counts_as_late OR r.status_code = 'EARLY_LEAVE')
     ), upd AS (
       UPDATE attendance.student_records r
          SET original_status_code = CASE WHEN r.status_code = 'ABSENT' THEN 'ABSENT' ELSE r.original_status_code END,
              status_code = CASE WHEN r.status_code = 'ABSENT' THEN 'EXCUSED' ELSE r.status_code END,
              excused = true, justification_id = $2, updated_at = now()
         FROM target t
        WHERE r.id = t.id
        RETURNING r.id, r.enrollment_id, r.session_id
     ), link AS (
       INSERT INTO attendance.justification_records (tenant_id, justification_id, record_id)
       SELECT $1, $2, u.id FROM upd u ON CONFLICT DO NOTHING
     )
     SELECT u.id, u.enrollment_id, u.session_id, s.session_date::text AS session_date, s.academic_year_id
       FROM upd u JOIN attendance.sessions s ON s.id = u.session_id`,
    [tenantId, justificationId, studentId, fromDate, toDate],
  );
  return rows.map((r) => ({ recordId: r.id, enrollmentId: r.enrollment_id, sessionId: r.session_id, sessionDate: r.session_date, academicYearId: r.academic_year_id }));
}

/**
 * Révoque l'excuse : `EXCUSED` redevient son statut d'origine, le drapeau et le lien tombent. La liste des pointages
 * couverts (`justification_records`) est CONSERVÉE (historique de ce que le justificatif couvrait).
 */
export async function revokeExcuse(tx: Tx, justificationId: Uuid): Promise<CoveredRecord[]> {
  const rows = await tx.many<{ id: Uuid; enrollment_id: Uuid; session_id: Uuid; session_date: string; academic_year_id: Uuid }>(
    `WITH upd AS (
       UPDATE attendance.student_records r
          SET status_code = CASE WHEN r.status_code = 'EXCUSED' THEN COALESCE(r.original_status_code, 'ABSENT') ELSE r.status_code END,
              original_status_code = NULL, excused = false, justification_id = NULL, updated_at = now()
        WHERE r.justification_id = $1
        RETURNING r.id, r.enrollment_id, r.session_id)
     SELECT u.id, u.enrollment_id, u.session_id, s.session_date::text AS session_date, s.academic_year_id
       FROM upd u JOIN attendance.sessions s ON s.id = u.session_id`,
    [justificationId],
  );
  return rows.map((r) => ({ recordId: r.id, enrollmentId: r.enrollment_id, sessionId: r.session_id, sessionDate: r.session_date, academicYearId: r.academic_year_id }));
}

/** Autres justificatifs ACCEPTÉS de l'élève qui recoupent une fenêtre (ré-application après une révocation). */
export async function listOtherAcceptedOverlapping(tx: Tx, studentId: Uuid, from: IsoDate, to: IsoDate, excludeId: Uuid): Promise<Justification[]> {
  const rows = await tx.many<JustificationRow>(
    `SELECT ${JUSTIFICATION_COLUMNS} FROM attendance.justifications j
      WHERE j.student_id = $1 AND j.status = 'ACCEPTED' AND j.id <> $4 AND j.from_date <= $3::date AND j.to_date >= $2::date
      ORDER BY j.decided_at, j.id`,
    [studentId, from, to, excludeId],
  );
  return rows.map(toJustification);
}

export async function countCoveredRecords(tx: Tx, justificationIds: readonly Uuid[]): Promise<Map<Uuid, number>> {
  const out = new Map<Uuid, number>();
  if (justificationIds.length === 0) return out;
  const rows = await tx.many<{ justification_id: Uuid; n: number }>(
    "SELECT justification_id, count(*)::int AS n FROM attendance.justification_records WHERE justification_id = ANY($1::uuid[]) GROUP BY justification_id",
    [[...justificationIds]],
  );
  for (const r of rows) out.set(r.justification_id, r.n);
  return out;
}
