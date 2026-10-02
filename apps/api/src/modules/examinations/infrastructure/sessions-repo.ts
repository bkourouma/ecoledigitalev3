/**
 * Dépôt SQL des sessions : sessions, définition figée (séries, épreuves copiées), centres de la session, répartition des
 * places, liens avec les évaluations (examens blancs), compteurs d'avancement. SQL paramétré, `Tx` de `TenantDb.run`.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AssignmentRow, CountsRow, PaperLinkRow, SessionPaperRow, SessionRow, SessionStatus, SessionTrackRow, SourceKind } from "../domain/types";

const SESSION_COLS = `id, exam_type_id, institution_id, academic_year_id, code, label, session_kind, attempt_kind, session_year, mock_of_session_id,
  registration_opens_on::text AS registration_opens_on, registration_closes_on::text AS registration_closes_on, starts_on::text AS starts_on, ends_on::text AS ends_on,
  status, definition_locked_at, rule_version_ref, source_kind, created_at, updated_at`;

interface SessionSql {
  id: string; exam_type_id: string; institution_id: string; academic_year_id: string | null; code: string; label: string; session_kind: SessionRow["sessionKind"]; attempt_kind: SessionRow["attemptKind"];
  session_year: number; mock_of_session_id: string | null; registration_opens_on: string | null; registration_closes_on: string | null; starts_on: string | null; ends_on: string | null;
  status: SessionStatus; definition_locked_at: Date | null; rule_version_ref: string | null; source_kind: SourceKind; created_at: Date; updated_at: Date;
}
const toSession = (r: SessionSql): SessionRow => ({
  id: r.id, examTypeId: r.exam_type_id, institutionId: r.institution_id, academicYearId: r.academic_year_id, code: r.code, label: r.label, sessionKind: r.session_kind, attemptKind: r.attempt_kind,
  sessionYear: r.session_year, mockOfSessionId: r.mock_of_session_id, registrationOpensOn: r.registration_opens_on, registrationClosesOn: r.registration_closes_on, startsOn: r.starts_on, endsOn: r.ends_on,
  status: r.status, definitionLockedAt: r.definition_locked_at, ruleVersionRef: r.rule_version_ref, sourceKind: r.source_kind, createdAt: r.created_at, updatedAt: r.updated_at,
});

export interface SessionFilter {
  status?: SessionStatus | undefined;
  sessionKind?: string | undefined;
  examTypeId?: string | undefined;
  institutionId?: string | undefined;
  sessionYear?: number | undefined;
  page: number;
  pageSize: number;
}

export async function listSessions(tx: Tx, f: SessionFilter): Promise<{ items: SessionRow[]; total: number }> {
  const params = [f.status ?? null, f.sessionKind ?? null, f.examTypeId ?? null, f.institutionId ?? null, f.sessionYear ?? null];
  const where = `($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR session_kind = $2) AND ($3::uuid IS NULL OR exam_type_id = $3) AND ($4::uuid IS NULL OR institution_id = $4) AND ($5::int IS NULL OR session_year = $5)`;
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM examinations.sessions WHERE ${where}`, params);
  const rows = await tx.many<SessionSql>(`SELECT ${SESSION_COLS} FROM examinations.sessions WHERE ${where} ORDER BY session_year DESC, created_at DESC, id LIMIT $6 OFFSET $7`, [...params, f.pageSize, (f.page - 1) * f.pageSize]);
  return { items: rows.map(toSession), total: total?.n ?? 0 };
}

export async function getSession(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<SessionRow | null> {
  const r = await tx.queryOne<SessionSql>(`SELECT ${SESSION_COLS} FROM examinations.sessions WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? toSession(r) : null;
}

export async function insertSession(tx: Tx, tenantId: string, s: Pick<SessionRow, "id" | "examTypeId" | "institutionId" | "academicYearId" | "code" | "label" | "sessionKind" | "attemptKind" | "sessionYear" | "mockOfSessionId" | "registrationOpensOn" | "registrationClosesOn" | "startsOn" | "endsOn" | "ruleVersionRef" | "sourceKind">): Promise<SessionRow> {
  const r = await tx.queryOne<SessionSql>(
    `INSERT INTO examinations.sessions (id, tenant_id, exam_type_id, institution_id, academic_year_id, code, label, session_kind, attempt_kind, session_year, mock_of_session_id,
       registration_opens_on, registration_closes_on, starts_on, ends_on, rule_version_ref, source_kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14::date, $15::date, $16, $17) RETURNING ${SESSION_COLS}`,
    [s.id, tenantId, s.examTypeId, s.institutionId, s.academicYearId, s.code, s.label, s.sessionKind, s.attemptKind, s.sessionYear, s.mockOfSessionId, s.registrationOpensOn, s.registrationClosesOn, s.startsOn, s.endsOn, s.ruleVersionRef, s.sourceKind],
  );
  return toSession(r as SessionSql);
}

export interface SessionPatch {
  label?: string;
  academicYearId?: string | null;
  attemptKind?: "NORMAL" | "MAKEUP";
  registrationOpensOn?: string | null;
  registrationClosesOn?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  ruleVersionRef?: string | null;
}

export async function updateSession(tx: Tx, id: string, p: SessionPatch): Promise<SessionRow | null> {
  const r = await tx.queryOne<SessionSql>(
    `UPDATE examinations.sessions SET
       label = COALESCE($2, label),
       academic_year_id = CASE WHEN $3::boolean THEN $4::uuid ELSE academic_year_id END,
       attempt_kind = COALESCE($5, attempt_kind),
       registration_opens_on = CASE WHEN $6::boolean THEN $7::date ELSE registration_opens_on END,
       registration_closes_on = CASE WHEN $8::boolean THEN $9::date ELSE registration_closes_on END,
       starts_on = CASE WHEN $10::boolean THEN $11::date ELSE starts_on END,
       ends_on = CASE WHEN $12::boolean THEN $13::date ELSE ends_on END,
       rule_version_ref = CASE WHEN $14::boolean THEN $15::uuid ELSE rule_version_ref END
     WHERE id = $1 RETURNING ${SESSION_COLS}`,
    [id, p.label ?? null, "academicYearId" in p, p.academicYearId ?? null, p.attemptKind ?? null, "registrationOpensOn" in p, p.registrationOpensOn ?? null, "registrationClosesOn" in p, p.registrationClosesOn ?? null, "startsOn" in p, p.startsOn ?? null, "endsOn" in p, p.endsOn ?? null, "ruleVersionRef" in p, p.ruleVersionRef ?? null],
  );
  return r ? toSession(r) : null;
}

export async function setSessionStatus(tx: Tx, id: string, status: SessionStatus): Promise<SessionRow | null> {
  const r = await tx.queryOne<SessionSql>(`UPDATE examinations.sessions SET status = $2 WHERE id = $1 RETURNING ${SESSION_COLS}`, [id, status]);
  return r ? toSession(r) : null;
}

/** Copie et fige la définition (fonction SQL de référence). Renvoie le nombre d'épreuves copiées. */
export async function instantiateDefinition(tx: Tx, sessionId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(`SELECT examinations.instantiate_session_definition($1) AS n`, [sessionId]);
  return r?.n ?? 0;
}

export async function listSessionTracks(tx: Tx, sessionId: string): Promise<SessionTrackRow[]> {
  const rows = await tx.many<{ id: string; session_id: string; code: string; label: string }>(`SELECT id, session_id, code, label FROM examinations.session_tracks WHERE session_id = $1 ORDER BY code`, [sessionId]);
  return rows.map((r) => ({ id: r.id, sessionId: r.session_id, code: r.code, label: r.label }));
}

interface SessionPaperSql { id: string; session_id: string; track_code: string | null; code: string; label: string; coefficient: string; scale_max: string; is_optional: boolean; ordinal: number; source_kind: SourceKind }
const toSessionPaper = (r: SessionPaperSql): SessionPaperRow => ({
  id: r.id, sessionId: r.session_id, trackCode: r.track_code, code: r.code, label: r.label, coefficient: r.coefficient, scaleMax: r.scale_max, isOptional: r.is_optional, ordinal: r.ordinal, sourceKind: r.source_kind,
});
const SESSION_PAPER_COLS = `id, session_id, track_code, code, label, coefficient::text AS coefficient, scale_max::text AS scale_max, is_optional, ordinal, source_kind`;

export async function listSessionPapers(tx: Tx, sessionId: string): Promise<SessionPaperRow[]> {
  return (await tx.many<SessionPaperSql>(`SELECT ${SESSION_PAPER_COLS} FROM examinations.session_papers WHERE session_id = $1 ORDER BY ordinal, code`, [sessionId])).map(toSessionPaper);
}

export async function getSessionPaper(tx: Tx, sessionId: string, paperId: string): Promise<SessionPaperRow | null> {
  const r = await tx.queryOne<SessionPaperSql>(`SELECT ${SESSION_PAPER_COLS} FROM examinations.session_papers WHERE session_id = $1 AND id = $2`, [sessionId, paperId]);
  return r ? toSessionPaper(r) : null;
}

// ------------------------------------------------------------------ centres de la session et répartition

export async function listSessionCenterIds(tx: Tx, sessionId: string): Promise<string[]> {
  return (await tx.many<{ center_id: string }>(`SELECT center_id FROM examinations.session_centers WHERE session_id = $1 ORDER BY center_id`, [sessionId])).map((r) => r.center_id);
}

export async function addSessionCenter(tx: Tx, tenantId: string, sessionId: string, centerId: string): Promise<void> {
  await tx.query(`INSERT INTO examinations.session_centers (tenant_id, session_id, center_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [tenantId, sessionId, centerId]);
}

export async function removeSessionCenter(tx: Tx, sessionId: string, centerId: string): Promise<void> {
  await tx.query(`DELETE FROM examinations.session_centers WHERE session_id = $1 AND center_id = $2`, [sessionId, centerId]);
}

interface AssignmentSql { id: string; session_id: string; candidate_id: string; center_id: string; room_id: string; seat_number: number; table_number: string | null; assigned_by: string | null; assigned_at: Date }
const toAssignment = (r: AssignmentSql): AssignmentRow => ({
  id: r.id, sessionId: r.session_id, candidateId: r.candidate_id, centerId: r.center_id, roomId: r.room_id, seatNumber: r.seat_number, tableNumber: r.table_number, assignedBy: r.assigned_by, assignedAt: r.assigned_at,
});
const ASSIGNMENT_COLS = `id, session_id, candidate_id, center_id, room_id, seat_number, table_number, assigned_by, assigned_at`;

export interface AssignmentView extends AssignmentRow {
  candidateNumber: string | null;
  lastName: string | null;
  firstName: string | null;
  centerCode: string;
  centerName: string;
  roomCode: string;
}

export async function listAssignmentViews(tx: Tx, sessionId: string): Promise<AssignmentView[]> {
  const rows = await tx.many<AssignmentSql & { candidate_number: string | null; last_name: string | null; first_name: string | null; center_code: string; center_name: string; room_code: string }>(
    `SELECT a.id, a.session_id, a.candidate_id, a.center_id, a.room_id, a.seat_number, a.table_number, a.assigned_by, a.assigned_at,
            c.candidate_number, c.last_name, c.first_name, ce.code AS center_code, ce.name AS center_name, r.code AS room_code
       FROM examinations.seat_assignments a
       JOIN examinations.candidates c ON c.tenant_id = a.tenant_id AND c.id = a.candidate_id
       JOIN examinations.centers ce ON ce.tenant_id = a.tenant_id AND ce.id = a.center_id
       JOIN examinations.rooms r ON r.tenant_id = a.tenant_id AND r.id = a.room_id
      WHERE a.session_id = $1 ORDER BY ce.code, r.code, a.seat_number`,
    [sessionId],
  );
  return rows.map((r) => ({ ...toAssignment(r), candidateNumber: r.candidate_number, lastName: r.last_name, firstName: r.first_name, centerCode: r.center_code, centerName: r.center_name, roomCode: r.room_code }));
}

export async function getAssignmentOfCandidate(tx: Tx, candidateId: string): Promise<AssignmentRow | null> {
  const r = await tx.queryOne<AssignmentSql>(`SELECT ${ASSIGNMENT_COLS} FROM examinations.seat_assignments WHERE candidate_id = $1`, [candidateId]);
  return r ? toAssignment(r) : null;
}

export async function upsertAssignment(tx: Tx, tenantId: string, a: { id: string; sessionId: string; candidateId: string; centerId: string; roomId: string; seatNumber: number; tableNumber: string | null; assignedBy: string | null }): Promise<AssignmentRow> {
  const r = await tx.queryOne<AssignmentSql>(
    `INSERT INTO examinations.seat_assignments (id, tenant_id, session_id, candidate_id, center_id, room_id, seat_number, table_number, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, session_id, candidate_id) DO UPDATE SET center_id = EXCLUDED.center_id, room_id = EXCLUDED.room_id, seat_number = EXCLUDED.seat_number,
       table_number = EXCLUDED.table_number, assigned_by = EXCLUDED.assigned_by, assigned_at = now()
     RETURNING ${ASSIGNMENT_COLS}`,
    [a.id, tenantId, a.sessionId, a.candidateId, a.centerId, a.roomId, a.seatNumber, a.tableNumber, a.assignedBy],
  );
  return toAssignment(r as AssignmentSql);
}

export async function deleteAssignment(tx: Tx, candidateId: string): Promise<boolean> {
  const r = await tx.query(`DELETE FROM examinations.seat_assignments WHERE candidate_id = $1`, [candidateId]);
  return r.rowCount > 0;
}

export async function deleteAllAssignments(tx: Tx, sessionId: string): Promise<number> {
  const r = await tx.query(`DELETE FROM examinations.seat_assignments WHERE session_id = $1`, [sessionId]);
  return r.rowCount;
}

/** Places libres d'une salle (numéros non attribués jusqu'à la capacité), dans l'ordre. */
export async function freeSeats(tx: Tx, sessionId: string, roomId: string, capacity: number): Promise<number[]> {
  const taken = await tx.many<{ seat_number: number }>(`SELECT seat_number FROM examinations.seat_assignments WHERE session_id = $1 AND room_id = $2`, [sessionId, roomId]);
  const used = new Set(taken.map((t) => t.seat_number));
  const free: number[] = [];
  for (let s = 1; s <= capacity; s += 1) if (!used.has(s)) free.push(s);
  return free;
}

export interface RoomUsage { roomId: string; centerId: string; code: string; capacity: number; active: boolean; used: number; centerCode: string; centerName: string }

/** Occupation des salles des centres de la session (toutes salles, actives ou non). */
export async function roomUsage(tx: Tx, sessionId: string): Promise<RoomUsage[]> {
  const rows = await tx.many<{ room_id: string; center_id: string; code: string; capacity: number; active: boolean; used: number; center_code: string; center_name: string }>(
    `SELECT r.id AS room_id, r.center_id, r.code, r.capacity, r.active, ce.code AS center_code, ce.name AS center_name,
            (SELECT count(*)::int FROM examinations.seat_assignments a WHERE a.tenant_id = r.tenant_id AND a.session_id = $1 AND a.room_id = r.id) AS used
       FROM examinations.session_centers sc
       JOIN examinations.centers ce ON ce.tenant_id = sc.tenant_id AND ce.id = sc.center_id
       JOIN examinations.rooms r ON r.tenant_id = sc.tenant_id AND r.center_id = sc.center_id
      WHERE sc.session_id = $1 ORDER BY ce.code, r.code`,
    [sessionId],
  );
  return rows.map((r) => ({ roomId: r.room_id, centerId: r.center_id, code: r.code, capacity: r.capacity, active: r.active, used: r.used, centerCode: r.center_code, centerName: r.center_name }));
}

// ------------------------------------------------------------------ liens avec les évaluations (examens blancs)

interface LinkSql { id: string; session_id: string; paper_id: string; classroom_id: string; assessment_id: string; linked_by: string | null; linked_at: Date }
const toLink = (r: LinkSql): PaperLinkRow => ({ id: r.id, sessionId: r.session_id, paperId: r.paper_id, classroomId: r.classroom_id, assessmentId: r.assessment_id, linkedBy: r.linked_by, linkedAt: r.linked_at });

export async function listLinks(tx: Tx, sessionId: string): Promise<PaperLinkRow[]> {
  return (await tx.many<LinkSql>(`SELECT id, session_id, paper_id, classroom_id, assessment_id, linked_by, linked_at FROM examinations.paper_assessment_links WHERE session_id = $1 ORDER BY linked_at, id`, [sessionId])).map(toLink);
}
export async function insertLink(tx: Tx, tenantId: string, l: { id: string; sessionId: string; paperId: string; classroomId: string; assessmentId: string; linkedBy: string | null }): Promise<PaperLinkRow> {
  const r = await tx.queryOne<LinkSql>(
    `INSERT INTO examinations.paper_assessment_links (id, tenant_id, session_id, paper_id, classroom_id, assessment_id, linked_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, session_id, paper_id, classroom_id, assessment_id, linked_by, linked_at`,
    [l.id, tenantId, l.sessionId, l.paperId, l.classroomId, l.assessmentId, l.linkedBy],
  );
  return toLink(r as LinkSql);
}
export async function getLink(tx: Tx, sessionId: string, id: string): Promise<PaperLinkRow | null> {
  const r = await tx.queryOne<LinkSql>(`SELECT id, session_id, paper_id, classroom_id, assessment_id, linked_by, linked_at FROM examinations.paper_assessment_links WHERE session_id = $1 AND id = $2`, [sessionId, id]);
  return r ? toLink(r) : null;
}
export async function deleteLink(tx: Tx, sessionId: string, id: string): Promise<boolean> {
  const r = await tx.query(`DELETE FROM examinations.paper_assessment_links WHERE session_id = $1 AND id = $2`, [sessionId, id]);
  return r.rowCount > 0;
}

// ------------------------------------------------------------------ compteurs et statistiques

export interface SessionCounts { candidates: number; registered: number; withdrawn: number; eligible: number; withResult: number; published: number; assigned: number }

export async function sessionCounts(tx: Tx, sessionId: string): Promise<SessionCounts> {
  const r = await tx.queryOne<SessionCounts>(
    `SELECT (SELECT count(*)::int FROM examinations.candidates c WHERE c.session_id = $1) AS candidates,
            (SELECT count(*)::int FROM examinations.candidates c WHERE c.session_id = $1 AND c.registration_status = 'REGISTERED') AS registered,
            (SELECT count(*)::int FROM examinations.candidates c WHERE c.session_id = $1 AND c.registration_status = 'WITHDRAWN') AS withdrawn,
            (SELECT count(*)::int FROM examinations.candidates c WHERE c.session_id = $1 AND c.registration_status <> 'WITHDRAWN' AND c.eligibility_status = 'ELIGIBLE') AS eligible,
            (SELECT count(*)::int FROM examinations.candidate_results r WHERE r.session_id = $1) AS "withResult",
            (SELECT count(*)::int FROM examinations.candidate_results r WHERE r.session_id = $1 AND r.status = 'PUBLISHED') AS published,
            (SELECT count(*)::int FROM examinations.seat_assignments a WHERE a.session_id = $1) AS assigned`,
    [sessionId],
  );
  return r ?? { candidates: 0, registered: 0, withdrawn: 0, eligible: 0, withResult: 0, published: 0, assigned: 0 };
}

export async function resultCounts(tx: Tx, sessionId: string, groupBy: string): Promise<CountsRow[]> {
  const rows = await tx.many<{ group_key: string; registered: number; present: number; admitted: number; failed: number; absent: number; excluded: number; deferred: number }>(
    `SELECT * FROM examinations.result_counts($1, $2)`,
    [sessionId, groupBy],
  );
  return rows.map((r) => ({ groupKey: r.group_key, registered: r.registered, present: r.present, admitted: r.admitted, failed: r.failed, absent: r.absent, excluded: r.excluded, deferred: r.deferred }));
}

/** Autre session du même type, de l'année précédente et du même établissement (comparaison des statistiques). */
export async function findPreviousSession(tx: Tx, s: { examTypeId: string; institutionId: string; sessionYear: number; id: string; sessionKind: string }): Promise<SessionRow | null> {
  const r = await tx.queryOne<SessionSql>(
    `SELECT ${SESSION_COLS} FROM examinations.sessions WHERE exam_type_id = $1 AND institution_id = $2 AND session_kind = $3 AND session_year < $4 AND id <> $5 AND status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED')
     ORDER BY session_year DESC, created_at DESC LIMIT 1`,
    [s.examTypeId, s.institutionId, s.sessionKind, s.sessionYear, s.id],
  );
  return r ? toSession(r) : null;
}

/** Examen blanc le plus récent qui prépare la session officielle. */
export async function findMockOf(tx: Tx, sessionId: string): Promise<SessionRow | null> {
  const r = await tx.queryOne<SessionSql>(`SELECT ${SESSION_COLS} FROM examinations.sessions WHERE mock_of_session_id = $1 ORDER BY created_at DESC LIMIT 1`, [sessionId]);
  return r ? toSession(r) : null;
}
