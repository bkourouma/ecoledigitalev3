/**
 * Séances d'appel et pointages. Aucune règle métier ici : de la persistance fidèle, avec les verrous de ligne qui
 * sérialisent deux enseignants sur la même séance (marquage = FOR SHARE, changement d'état = FOR UPDATE).
 */
import type { Tx } from "@ecoledigitale/database";
import type { FinalMark } from "../domain/records";
import type { AttendanceSession, IsoDate, RecordSource, SessionScope, SessionSource, SessionStatus, StudentRecord, Uuid } from "../domain/types";
import { RECORD_COLUMNS, SESSION_COLUMNS, decodeCursor, encodeCursor, toRecord, toSession, type RecordRow, type SessionRow } from "./rows";

export interface NewSession {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly classroomId: Uuid;
  readonly curriculumNodeId: Uuid | null;
  readonly offeringId: Uuid | null;
  readonly occurrenceId: Uuid | null;
  readonly scope: SessionScope;
  readonly sessionDate: IsoDate;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly durationMinutes: number | null;
  readonly takenByStaffId: Uuid | null;
  readonly takenByUserId: Uuid | null;
  readonly source: SessionSource;
  readonly clientId: Uuid | null;
}

/** Insère la séance ; renvoie `null` si une contrainte d'unicité (occurrence, jour, clientId) la rend inutile. */
export async function insertSessionIfAbsent(tx: Tx, s: NewSession): Promise<AttendanceSession | null> {
  const rows = await tx.many<SessionRow>(
    `WITH ins AS (
       INSERT INTO attendance.sessions (id, tenant_id, institution_id, academic_year_id, classroom_id, curriculum_node_id, offering_id, occurrence_id,
                                        scope, session_date, starts_at, ends_at, duration_minutes, taken_by_staff_id, taken_by_user_id, source, client_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT DO NOTHING
       RETURNING *)
     SELECT ${SESSION_COLUMNS} FROM ins s`,
    [
      s.id, s.tenantId, s.institutionId, s.academicYearId, s.classroomId, s.curriculumNodeId, s.offeringId, s.occurrenceId,
      s.scope, s.sessionDate, s.startsAt, s.endsAt, s.durationMinutes, s.takenByStaffId, s.takenByUserId, s.source, s.clientId,
    ],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export type SessionLock = "UPDATE" | "SHARE" | "NONE";

export async function getSession(tx: Tx, id: Uuid, lock: SessionLock = "NONE"): Promise<AttendanceSession | null> {
  const suffix = lock === "UPDATE" ? "FOR UPDATE OF s" : lock === "SHARE" ? "FOR SHARE OF s" : "";
  const r = await tx.queryOne<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM attendance.sessions s WHERE s.id = $1 ${suffix}`, [id]);
  return r ? toSession(r) : null;
}

export async function findSessionByOccurrence(tx: Tx, occurrenceId: Uuid): Promise<AttendanceSession | null> {
  const r = await tx.queryOne<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM attendance.sessions s WHERE s.occurrence_id = $1 AND s.status <> 'CANCELLED'`,
    [occurrenceId],
  );
  return r ? toSession(r) : null;
}

export async function findDailySession(tx: Tx, classroomId: Uuid, date: IsoDate): Promise<AttendanceSession | null> {
  const r = await tx.queryOne<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM attendance.sessions s WHERE s.scope = 'DAILY' AND s.classroom_id = $1 AND s.session_date = $2 AND s.status <> 'CANCELLED'`,
    [classroomId, date],
  );
  return r ? toSession(r) : null;
}

export async function findSessionByClientId(tx: Tx, clientId: Uuid): Promise<AttendanceSession | null> {
  const r = await tx.queryOne<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM attendance.sessions s WHERE s.client_id = $1`, [clientId]);
  return r ? toSession(r) : null;
}

export interface SessionFilter {
  classroomId?: Uuid | undefined;
  date?: IsoDate | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  status?: SessionStatus | undefined;
  staffId?: Uuid | undefined;
  occurrenceId?: Uuid | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function listSessions(tx: Tx, f: SessionFilter): Promise<{ items: AttendanceSession[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.classroomId) add("s.classroom_id = ?", f.classroomId);
  if (f.date) add("s.session_date = ?", f.date);
  if (f.from) add("s.session_date >= ?", f.from);
  if (f.to) add("s.session_date <= ?", f.to);
  if (f.status) add("s.status = ?", f.status);
  if (f.staffId) add("s.taken_by_staff_id = ?", f.staffId);
  if (f.occurrenceId) add("s.occurrence_id = ?", f.occurrenceId);
  const cursor = decodeCursor<{ d: string; i: string }>(f.cursor);
  if (cursor) {
    params.push(cursor.d, cursor.i);
    where.push(`(s.session_date, s.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM attendance.sessions s ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.session_date DESC, s.id DESC LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit).map(toSession);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? encodeCursor({ d: last.sessionDate, i: last.id }) : null };
}

export interface SessionPatch {
  status?: SessionStatus;
  submittedAt?: Date | null;
  validatedAt?: Date | null;
  validatedBy?: Uuid | null;
  incrementReopened?: boolean;
  note?: string | null;
  takenByStaffId?: Uuid | null;
  takenByUserId?: Uuid | null;
}

/** Met à jour une séance (le déclencheur `sessions_guard` impose les transitions légales). */
export async function updateSession(tx: Tx, id: Uuid, patch: SessionPatch): Promise<AttendanceSession> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  const set = (col: string, value: unknown): void => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.submittedAt !== undefined) set("submitted_at", patch.submittedAt);
  if (patch.validatedAt !== undefined) set("validated_at", patch.validatedAt);
  if (patch.validatedBy !== undefined) set("validated_by", patch.validatedBy);
  if (patch.note !== undefined) set("note", patch.note);
  if (patch.takenByStaffId !== undefined) set("taken_by_staff_id", patch.takenByStaffId);
  if (patch.takenByUserId !== undefined) set("taken_by_user_id", patch.takenByUserId);
  if (patch.incrementReopened) sets.push("reopened_count = reopened_count + 1");
  const rows = await tx.many<SessionRow>(
    `WITH upd AS (UPDATE attendance.sessions SET ${sets.join(", ")} WHERE id = $1 RETURNING *) SELECT ${SESSION_COLUMNS} FROM upd s`,
    params,
  );
  return toSession(rows[0] as SessionRow);
}

/** Réglage de transaction qui lève le verrou de réouverture (posé par `reopenAttendanceSession` seulement). */
export async function setReopenAllowed(tx: Tx, on: boolean): Promise<void> {
  await tx.query("SELECT set_config('attendance.reopen', $1, true)", [on ? "on" : "off"]);
}

/** Réglage de transaction pour appliquer / révoquer une EXCUSE sur un appel validé (décision de justificatif). */
export async function setExcuseApplyAllowed(tx: Tx, on: boolean): Promise<void> {
  await tx.query("SELECT set_config('attendance.excuse_apply', $1, true)", [on ? "on" : "off"]);
}

// ---------------------------------------------------------------------------
// Pointages
// ---------------------------------------------------------------------------

export async function listRecords(tx: Tx, sessionId: Uuid): Promise<StudentRecord[]> {
  return (await tx.many<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM attendance.student_records r WHERE r.session_id = $1 ORDER BY r.enrollment_id`, [sessionId])).map(toRecord);
}

export async function getRecord(tx: Tx, id: Uuid): Promise<StudentRecord | null> {
  const r = await tx.queryOne<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM attendance.student_records r WHERE r.id = $1`, [id]);
  return r ? toRecord(r) : null;
}

export async function getRecordsByEnrollments(tx: Tx, sessionId: Uuid, enrollmentIds: readonly Uuid[]): Promise<StudentRecord[]> {
  if (enrollmentIds.length === 0) return [];
  return (
    await tx.many<RecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM attendance.student_records r WHERE r.session_id = $1 AND r.enrollment_id = ANY($2::uuid[])`,
      [sessionId, [...enrollmentIds]],
    )
  ).map(toRecord);
}

/** Justificatifs ACCEPTÉS couvrant une date pour des élèves : `studentId -> justificationId` (le plus ancien décidé gagne). */
export async function findCoveringJustifications(tx: Tx, studentIds: readonly Uuid[], date: IsoDate): Promise<Map<Uuid, Uuid>> {
  const out = new Map<Uuid, Uuid>();
  if (studentIds.length === 0) return out;
  const rows = await tx.many<{ student_id: Uuid; id: Uuid }>(
    `SELECT DISTINCT ON (student_id) student_id, id
       FROM attendance.justifications
      WHERE status = 'ACCEPTED' AND student_id = ANY($1::uuid[]) AND $2::date BETWEEN from_date AND to_date
      ORDER BY student_id, decided_at, id`,
    [[...studentIds], date],
  );
  for (const r of rows) out.set(r.student_id, r.id);
  return out;
}

export interface RecordWrite extends FinalMark {
  readonly id: Uuid;
  readonly enrollmentId: Uuid;
  readonly markedBy: Uuid;
  readonly sourceDetail: RecordSource;
  readonly clientId: Uuid | null;
  readonly clientMarkedAt: Date | null;
}

export interface UpsertOutcome {
  readonly created: Array<{ id: Uuid; enrollmentId: Uuid }>;
  readonly updated: Array<{ id: Uuid; enrollmentId: Uuid }>;
  readonly unchanged: Uuid[];
}

/**
 * Écrit un lot de pointages en UNE requête : insertion ou mise à jour par (séance, inscription), « dernier arrivé
 * gagne », triés par inscription (ordre de verrouillage identique pour deux lots concurrents : pas d'interblocage).
 * Une ligne dont le contenu est identique n'est PAS réécrite (ni `marked_at`, ni historique, ni `updated_at`).
 */
export async function upsertRecords(tx: Tx, tenantId: Uuid, sessionId: Uuid, writes: readonly RecordWrite[], now: Date): Promise<UpsertOutcome> {
  if (writes.length === 0) return { created: [], updated: [], unchanged: [] };
  const payload = [...writes]
    .sort((a, b) => (a.enrollmentId < b.enrollmentId ? -1 : a.enrollmentId > b.enrollmentId ? 1 : 0))
    .map((w) => ({
      id: w.id,
      enrollment_id: w.enrollmentId,
      student_id: w.studentId,
      status_code: w.statusCode,
      original_status_code: w.originalStatusCode,
      excused: w.excused,
      minutes_late: w.minutesLate,
      counted_minutes: w.countedMinutes,
      arrived_at: w.arrivedAt?.toISOString() ?? null,
      left_at: w.leftAt?.toISOString() ?? null,
      justification_id: w.justificationId,
      note: w.note,
      marked_by: w.markedBy,
      source_detail: w.sourceDetail,
      client_id: w.clientId,
      client_marked_at: w.clientMarkedAt?.toISOString() ?? null,
    }));
  const rows = await tx.many<{ id: Uuid; enrollment_id: Uuid; inserted: boolean }>(
    `INSERT INTO attendance.student_records (id, tenant_id, session_id, enrollment_id, student_id, status_code, original_status_code, excused,
                                             minutes_late, counted_minutes, arrived_at, left_at, justification_id, note, marked_by, marked_at,
                                             source_detail, client_id, client_marked_at, updated_at)
     SELECT x.id, $1, $2, x.enrollment_id, x.student_id, x.status_code, x.original_status_code, x.excused,
            x.minutes_late, x.counted_minutes, x.arrived_at, x.left_at, x.justification_id, x.note, x.marked_by, $4::timestamptz,
            x.source_detail, x.client_id, x.client_marked_at, $4::timestamptz
       FROM jsonb_to_recordset($3::jsonb) AS x(id uuid, enrollment_id uuid, student_id uuid, status_code text, original_status_code text, excused boolean,
              minutes_late integer, counted_minutes integer, arrived_at timestamptz, left_at timestamptz, justification_id uuid, note text,
              marked_by uuid, source_detail text, client_id uuid, client_marked_at timestamptz)
      ORDER BY x.enrollment_id
     ON CONFLICT (tenant_id, session_id, enrollment_id) DO UPDATE SET
            status_code = EXCLUDED.status_code, original_status_code = EXCLUDED.original_status_code, excused = EXCLUDED.excused,
            minutes_late = EXCLUDED.minutes_late, counted_minutes = EXCLUDED.counted_minutes, arrived_at = EXCLUDED.arrived_at,
            left_at = EXCLUDED.left_at, justification_id = EXCLUDED.justification_id, note = EXCLUDED.note,
            marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at, source_detail = EXCLUDED.source_detail,
            client_id = COALESCE(EXCLUDED.client_id, attendance.student_records.client_id),
            client_marked_at = EXCLUDED.client_marked_at, updated_at = EXCLUDED.updated_at
        WHERE (attendance.student_records.status_code, attendance.student_records.original_status_code, attendance.student_records.excused,
               attendance.student_records.minutes_late, attendance.student_records.counted_minutes, attendance.student_records.arrived_at,
               attendance.student_records.left_at, attendance.student_records.justification_id, attendance.student_records.note)
              IS DISTINCT FROM
              (EXCLUDED.status_code, EXCLUDED.original_status_code, EXCLUDED.excused, EXCLUDED.minutes_late, EXCLUDED.counted_minutes,
               EXCLUDED.arrived_at, EXCLUDED.left_at, EXCLUDED.justification_id, EXCLUDED.note)
     RETURNING id, enrollment_id, (xmax = 0) AS inserted`,
    [tenantId, sessionId, JSON.stringify(payload), now.toISOString()],
  );
  const touched = new Set(rows.map((r) => r.enrollment_id));
  return {
    created: rows.filter((r) => r.inserted).map((r) => ({ id: r.id, enrollmentId: r.enrollment_id })),
    updated: rows.filter((r) => !r.inserted).map((r) => ({ id: r.id, enrollmentId: r.enrollment_id })),
    unchanged: writes.filter((w) => !touched.has(w.enrollmentId)).map((w) => w.enrollmentId),
  };
}

/** Ids des pointages justifiés par un justificatif ACCEPTÉ mais retirés de sa couverture (re-saisie) : ménage de `justification_records`. */
export async function pruneStaleCoverage(tx: Tx, sessionId: Uuid): Promise<void> {
  await tx.query(
    `DELETE FROM attendance.justification_records jr
      USING attendance.student_records r, attendance.justifications j
      WHERE r.session_id = $1 AND jr.record_id = r.id AND j.id = jr.justification_id AND j.status = 'ACCEPTED'
        AND r.justification_id IS DISTINCT FROM jr.justification_id`,
    [sessionId],
  );
}

/** Rattache les pointages excusés à leur justificatif (liste conservée pour la révocation). */
export async function linkCoverage(tx: Tx, tenantId: Uuid, sessionId: Uuid): Promise<void> {
  await tx.query(
    `INSERT INTO attendance.justification_records (tenant_id, justification_id, record_id)
     SELECT $1, r.justification_id, r.id FROM attendance.student_records r
      WHERE r.session_id = $2 AND r.justification_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [tenantId, sessionId],
  );
}

export interface HistoryRow {
  id: Uuid;
  record_id: Uuid;
  from_status: string | null;
  to_status: string | null;
  actor_id: Uuid | null;
  reason: string | null;
  changed_at: Date;
}

export async function listRecordHistory(tx: Tx, recordId: Uuid): Promise<HistoryRow[]> {
  return tx.many<HistoryRow>(
    "SELECT id, record_id, from_status, to_status, actor_id, reason, changed_at FROM attendance.record_history WHERE record_id = $1 ORDER BY seq",
    [recordId],
  );
}

/** Pointages d'un élève (portails, fiche d'absences), plus récents d'abord. */
export async function listStudentRecordRows(
  tx: Tx,
  studentId: Uuid,
  f: { from?: IsoDate | undefined; to?: IsoDate | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: AbsenceRow[]; nextCursor: string | null }> {
  return listAbsences(tx, { studentId, from: f.from, to: f.to, limit: f.limit, cursor: f.cursor });
}

// ---------------------------------------------------------------------------
// Rapport d'absences (liste paginée)
// ---------------------------------------------------------------------------

export interface AbsenceRow {
  recordId: Uuid;
  sessionId: Uuid;
  studentId: Uuid;
  enrollmentId: Uuid;
  classroomId: Uuid;
  sessionDate: IsoDate;
  statusCode: string;
  excused: boolean;
  countedMinutes: number | null;
  minutesLate: number | null;
  justificationId: Uuid | null;
}

export interface AbsenceFilter {
  studentId?: Uuid | undefined;
  classroomId?: Uuid | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  statusCode?: string | undefined;
  excused?: boolean | undefined;
  /** Seulement les statuts qui comptent comme absence ou retard (défaut : oui pour les rapports). */
  onlyAbsences?: boolean | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function listAbsences(tx: Tx, f: AbsenceFilter): Promise<{ items: AbsenceRow[]; nextCursor: string | null }> {
  const where: string[] = ["s.status IN ('SUBMITTED', 'VALIDATED')"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.onlyAbsences !== false) where.push("(d.counts_as_absence OR d.counts_as_late OR r.status_code = 'EARLY_LEAVE')");
  if (f.studentId) add("r.student_id = ?", f.studentId);
  if (f.classroomId) add("s.classroom_id = ?", f.classroomId);
  if (f.from) add("s.session_date >= ?", f.from);
  if (f.to) add("s.session_date <= ?", f.to);
  if (f.statusCode) add("r.status_code = ?", f.statusCode);
  if (f.excused !== undefined) add("r.excused = ?", f.excused);
  const cursor = decodeCursor<{ d: string; i: string }>(f.cursor);
  if (cursor) {
    params.push(cursor.d, cursor.i);
    where.push(`(s.session_date, r.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<{
    id: Uuid; session_id: Uuid; student_id: Uuid; enrollment_id: Uuid; classroom_id: Uuid; session_date: string;
    status_code: string; excused: boolean; counted_minutes: number | null; minutes_late: number | null; justification_id: Uuid | null;
  }>(
    `SELECT r.id, r.session_id, r.student_id, r.enrollment_id, s.classroom_id, s.session_date::text AS session_date,
            r.status_code, r.excused, r.counted_minutes, r.minutes_late, r.justification_id
       FROM attendance.student_records r
       JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
       JOIN attendance.status_definitions d ON d.tenant_id = r.tenant_id AND d.subject_kind = r.subject_kind AND d.code = r.status_code
      WHERE ${where.join(" AND ")}
      ORDER BY s.session_date DESC, r.id DESC
      LIMIT $${params.length}`,
    params,
  );
  const items: AbsenceRow[] = rows.slice(0, limit).map((r) => ({
    recordId: r.id,
    sessionId: r.session_id,
    studentId: r.student_id,
    enrollmentId: r.enrollment_id,
    classroomId: r.classroom_id,
    sessionDate: r.session_date,
    statusCode: r.status_code,
    excused: r.excused,
    countedMinutes: r.counted_minutes,
    minutesLate: r.minutes_late,
    justificationId: r.justification_id,
  }));
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ d: last.sessionDate, i: last.recordId }) : null };
}

/** Séances soumises ou validées par occurrence (conformité de l'appel). */
export async function listTakenOccurrenceIds(tx: Tx, occurrenceIds: readonly Uuid[]): Promise<Set<Uuid>> {
  if (occurrenceIds.length === 0) return new Set();
  const rows = await tx.many<{ occurrence_id: Uuid }>(
    "SELECT occurrence_id FROM attendance.sessions WHERE occurrence_id = ANY($1::uuid[]) AND status IN ('SUBMITTED', 'VALIDATED')",
    [[...occurrenceIds]],
  );
  return new Set(rows.map((r) => r.occurrence_id));
}
