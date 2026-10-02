/**
 * Dépôt SQL des candidats : fiche, identifiants, journal d'éligibilité, pièces, historique. SQL paramétré uniquement.
 * Le numéro de candidat, l'éligibilité dérivée et l'issue dérivée sont posés par les déclencheurs de la base (jamais ici).
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  CandidatePieceRow,
  CandidateRow,
  EligibilityCheckRow,
  EligibilityResult,
  EligibilityStatus,
  HistoryRow,
  IdentifierRow,
  Outcome,
  PieceStatus,
  RegistrationStatus,
} from "../domain/types";

const CAND_COLS = `id, session_id, institution_id, student_id, enrollment_id, grade_level_code, track_code, last_name, first_name, birth_date::text AS birth_date, birth_place, sex, snapshot_taken_at,
  registration_status, eligibility_status, outcome, candidate_seq::text AS candidate_seq, candidate_number, registered_at, withdrawn_at, withdrawn_reason, created_by, row_version, created_at, updated_at`;

interface CandSql {
  id: string; session_id: string; institution_id: string; student_id: string; enrollment_id: string | null; grade_level_code: string | null; track_code: string | null; last_name: string | null;
  first_name: string | null; birth_date: string | null; birth_place: string | null; sex: "F" | "M" | null; snapshot_taken_at: Date | null; registration_status: RegistrationStatus;
  eligibility_status: EligibilityStatus; outcome: Outcome; candidate_seq: string | null; candidate_number: string | null; registered_at: Date | null; withdrawn_at: Date | null;
  withdrawn_reason: string | null; created_by: string | null; row_version: number; created_at: Date; updated_at: Date;
}
const toCandidate = (r: CandSql): CandidateRow => ({
  id: r.id, sessionId: r.session_id, institutionId: r.institution_id, studentId: r.student_id, enrollmentId: r.enrollment_id, gradeLevelCode: r.grade_level_code, trackCode: r.track_code,
  lastName: r.last_name, firstName: r.first_name, birthDate: r.birth_date, birthPlace: r.birth_place, sex: r.sex, snapshotTakenAt: r.snapshot_taken_at, registrationStatus: r.registration_status,
  eligibilityStatus: r.eligibility_status, outcome: r.outcome, candidateSeq: r.candidate_seq, candidateNumber: r.candidate_number, registeredAt: r.registered_at, withdrawnAt: r.withdrawn_at,
  withdrawnReason: r.withdrawn_reason, createdBy: r.created_by, rowVersion: r.row_version, createdAt: r.created_at, updatedAt: r.updated_at,
});

export interface CandidateFilter {
  sessionId: string;
  registrationStatus?: string | undefined;
  eligibilityStatus?: string | undefined;
  outcome?: string | undefined;
  trackCode?: string | undefined;
  /** Recherche par numéro ou nom (le nom n'existe qu'après l'inscription : identité figée). */
  q?: string | undefined;
  page: number;
  pageSize: number;
}

export async function listCandidates(tx: Tx, f: CandidateFilter): Promise<{ items: CandidateRow[]; total: number }> {
  const q = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const params = [f.sessionId, f.registrationStatus ?? null, f.eligibilityStatus ?? null, f.outcome ?? null, f.trackCode ?? null, q];
  const where = `session_id = $1 AND ($2::text IS NULL OR registration_status = $2) AND ($3::text IS NULL OR eligibility_status = $3) AND ($4::text IS NULL OR outcome = $4)
    AND ($5::text IS NULL OR track_code = $5)
    AND ($6::text IS NULL OR candidate_number ILIKE $6 OR last_name ILIKE $6 OR first_name ILIKE $6)`;
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM examinations.candidates WHERE ${where}`, params);
  const rows = await tx.many<CandSql>(
    `SELECT ${CAND_COLS} FROM examinations.candidates WHERE ${where} ORDER BY candidate_seq NULLS LAST, last_name NULLS LAST, created_at, id LIMIT $7 OFFSET $8`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize],
  );
  return { items: rows.map(toCandidate), total: total?.n ?? 0 };
}

export async function getCandidate(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<CandidateRow | null> {
  const r = await tx.queryOne<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? toCandidate(r) : null;
}

export async function getCandidateByNumber(tx: Tx, sessionId: string, number: string): Promise<CandidateRow | null> {
  const r = await tx.queryOne<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE session_id = $1 AND candidate_number = $2`, [sessionId, number]);
  return r ? toCandidate(r) : null;
}

export async function getCandidateByIdentifier(tx: Tx, sessionId: string, kind: string, value: string): Promise<CandidateRow | null> {
  const r = await tx.queryOne<CandSql>(
    `SELECT ${CAND_COLS} FROM examinations.candidates
      WHERE id IN (SELECT candidate_id FROM examinations.candidate_identifiers WHERE session_id = $1 AND kind = $2 AND value = $3)`,
    [sessionId, kind, value],
  );
  return r ? toCandidate(r) : null;
}

export async function listCandidatesByIds(tx: Tx, ids: readonly string[]): Promise<CandidateRow[]> {
  if (ids.length === 0) return [];
  return (await tx.many<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE id = ANY($1::uuid[]) ORDER BY candidate_seq NULLS LAST, id`, [ids])).map(toCandidate);
}

export async function listCandidatesOfEnrollment(tx: Tx, enrollmentId: string): Promise<CandidateRow[]> {
  return (await tx.many<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE enrollment_id = $1 AND registration_status <> 'WITHDRAWN' ORDER BY created_at`, [enrollmentId])).map(toCandidate);
}

export async function listCandidatesOfStudent(tx: Tx, studentId: string): Promise<CandidateRow[]> {
  return (await tx.many<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE student_id = $1 AND registration_status IN ('REGISTERED', 'PRE_REGISTERED', 'DRAFT') ORDER BY created_at DESC`, [studentId])).map(toCandidate);
}

/** Tous les candidats INSCRITS d'une session (jeux de calcul, exports) ; ordre stable par numéro. */
export async function listRegistered(tx: Tx, sessionId: string): Promise<CandidateRow[]> {
  return (await tx.many<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE session_id = $1 AND registration_status = 'REGISTERED' ORDER BY candidate_seq, id`, [sessionId])).map(toCandidate);
}

export async function listEligibleToEvaluate(tx: Tx, sessionId: string): Promise<CandidateRow[]> {
  return (await tx.many<CandSql>(`SELECT ${CAND_COLS} FROM examinations.candidates WHERE session_id = $1 AND registration_status IN ('DRAFT', 'PRE_REGISTERED') ORDER BY created_at, id`, [sessionId])).map(toCandidate);
}

export async function insertCandidate(tx: Tx, tenantId: string, c: { id: string; sessionId: string; institutionId: string; studentId: string; enrollmentId: string | null; gradeLevelCode: string | null; trackCode: string | null; createdBy: string | null }): Promise<CandidateRow> {
  const r = await tx.queryOne<CandSql>(
    `INSERT INTO examinations.candidates (id, tenant_id, session_id, institution_id, student_id, enrollment_id, grade_level_code, track_code, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${CAND_COLS}`,
    [c.id, tenantId, c.sessionId, c.institutionId, c.studentId, c.enrollmentId, c.gradeLevelCode, c.trackCode, c.createdBy],
  );
  return toCandidate(r as CandSql);
}

export async function setCandidateTrack(tx: Tx, id: string, trackCode: string | null): Promise<CandidateRow | null> {
  const r = await tx.queryOne<CandSql>(`UPDATE examinations.candidates SET track_code = $2 WHERE id = $1 RETURNING ${CAND_COLS}`, [id, trackCode]);
  return r ? toCandidate(r) : null;
}

/** Inscription : l'identité est figée ; le numéro, `registered_at` et `snapshot_taken_at` sont posés par le déclencheur. */
export async function registerCandidate(
  tx: Tx,
  id: string,
  identity: { lastName: string; firstName: string; birthDate: string; birthPlace: string | null; sex: "F" | "M" },
): Promise<CandidateRow | null> {
  const r = await tx.queryOne<CandSql>(
    `UPDATE examinations.candidates SET registration_status = 'REGISTERED', last_name = $2, first_name = $3, birth_date = $4::date, birth_place = $5, sex = $6 WHERE id = $1 RETURNING ${CAND_COLS}`,
    [id, identity.lastName, identity.firstName, identity.birthDate, identity.birthPlace, identity.sex],
  );
  return r ? toCandidate(r) : null;
}

export async function withdrawCandidate(tx: Tx, id: string, reason: string): Promise<CandidateRow | null> {
  const r = await tx.queryOne<CandSql>(`UPDATE examinations.candidates SET registration_status = 'WITHDRAWN', withdrawn_reason = $2 WHERE id = $1 RETURNING ${CAND_COLS}`, [id, reason]);
  return r ? toCandidate(r) : null;
}

/** Nombre de candidatures ANTÉRIEURES du même élève au même type d'examen (entrée `nombre_tentatives` de la règle d'éligibilité). */
export async function countPriorAttempts(tx: Tx, studentId: string, examTypeId: string, sessionId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM examinations.candidates c JOIN examinations.sessions s ON s.tenant_id = c.tenant_id AND s.id = c.session_id
      WHERE c.student_id = $1 AND s.exam_type_id = $2 AND s.session_kind = 'OFFICIAL' AND c.session_id <> $3 AND c.registration_status = 'REGISTERED'`,
    [studentId, examTypeId, sessionId],
  );
  return r?.n ?? 0;
}

export async function missingRequiredPieces(tx: Tx, candidateId: string): Promise<string[]> {
  const r = await tx.queryOne<{ codes: string[] }>(`SELECT examinations.missing_required_documents($1) AS codes`, [candidateId]);
  return r?.codes ?? [];
}

/** Pièces manquantes de plusieurs candidats en une requête (liste de candidats). */
export async function missingPiecesOf(tx: Tx, candidateIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (candidateIds.length === 0) return out;
  const rows = await tx.many<{ candidate_id: string; codes: string[] }>(
    `SELECT id AS candidate_id, examinations.missing_required_documents(id) AS codes FROM examinations.candidates WHERE id = ANY($1::uuid[])`,
    [candidateIds],
  );
  for (const r of rows) out.set(r.candidate_id, r.codes);
  return out;
}

// ------------------------------------------------------------------ identifiants

interface IdentifierSql { id: string; session_id: string; candidate_id: string; kind: string; value: string; source: IdentifierRow["source"]; created_at: Date }
const toIdentifier = (r: IdentifierSql): IdentifierRow => ({ id: r.id, sessionId: r.session_id, candidateId: r.candidate_id, kind: r.kind, value: r.value, source: r.source, createdAt: r.created_at });

export async function listIdentifiers(tx: Tx, candidateIds: readonly string[]): Promise<IdentifierRow[]> {
  if (candidateIds.length === 0) return [];
  return (await tx.many<IdentifierSql>(`SELECT id, session_id, candidate_id, kind, value, source, created_at FROM examinations.candidate_identifiers WHERE candidate_id = ANY($1::uuid[]) ORDER BY kind`, [candidateIds])).map(toIdentifier);
}

export async function upsertIdentifier(tx: Tx, tenantId: string, i: { id: string; sessionId: string; candidateId: string; kind: string; value: string; source: IdentifierRow["source"] }): Promise<IdentifierRow> {
  const r = await tx.queryOne<IdentifierSql>(
    `INSERT INTO examinations.candidate_identifiers (id, tenant_id, session_id, candidate_id, kind, value, source) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, candidate_id, kind) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source
     RETURNING id, session_id, candidate_id, kind, value, source, created_at`,
    [i.id, tenantId, i.sessionId, i.candidateId, i.kind, i.value, i.source],
  );
  return toIdentifier(r as IdentifierSql);
}

// ------------------------------------------------------------------ éligibilité (journal en ajout seul)

interface CheckSql { id: string; candidate_id: string; rule_version_ref: string | null; result: EligibilityResult; reasons: string[]; inputs_hash: string | null; evaluated_by: string | null; evaluated_at: Date; overridden_by: string | null; override_reason: string | null }
const toCheck = (r: CheckSql): EligibilityCheckRow => ({
  id: r.id, candidateId: r.candidate_id, ruleVersionRef: r.rule_version_ref, result: r.result, reasons: r.reasons, inputsHash: r.inputs_hash, evaluatedBy: r.evaluated_by, evaluatedAt: r.evaluated_at, overriddenBy: r.overridden_by, overrideReason: r.override_reason,
});

export async function listChecks(tx: Tx, candidateId: string): Promise<EligibilityCheckRow[]> {
  return (await tx.many<CheckSql>(`SELECT id, candidate_id, rule_version_ref, result, reasons, inputs_hash, evaluated_by, evaluated_at, overridden_by, override_reason FROM examinations.eligibility_checks WHERE candidate_id = $1 ORDER BY evaluated_at DESC, id`, [candidateId])).map(toCheck);
}

export async function insertCheck(
  tx: Tx,
  tenantId: string,
  c: { id: string; candidateId: string; ruleVersionRef: string | null; result: EligibilityResult; reasons: readonly string[]; inputsHash: string | null; evaluatedBy: string | null; overriddenBy: string | null; overrideReason: string | null },
): Promise<EligibilityCheckRow> {
  const r = await tx.queryOne<CheckSql>(
    `INSERT INTO examinations.eligibility_checks (id, tenant_id, candidate_id, rule_version_ref, result, reasons, inputs_hash, evaluated_by, overridden_by, override_reason)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING id, candidate_id, rule_version_ref, result, reasons, inputs_hash, evaluated_by, evaluated_at, overridden_by, override_reason`,
    [c.id, tenantId, c.candidateId, c.ruleVersionRef, c.result, JSON.stringify(c.reasons), c.inputsHash, c.evaluatedBy, c.overriddenBy, c.overrideReason],
  );
  return toCheck(r as CheckSql);
}

// ------------------------------------------------------------------ pièces

interface PieceSql {
  id: string | null; candidate_id: string; requirement_id: string; code: string; label: string; required: boolean; status: PieceStatus | null; document_ref: string | null;
  rejection_reason: string | null; reviewed_by: string | null; reviewed_at: Date | null; updated_at: Date | null;
}

/** Pièces d'un candidat : toutes les exigences ACTIVES du type, avec l'état de dépôt (MISSING si aucune ligne). */
export async function listPieces(tx: Tx, candidateId: string): Promise<CandidatePieceRow[]> {
  const rows = await tx.many<PieceSql>(
    `SELECT d.id, c.id AS candidate_id, r.id AS requirement_id, r.code, r.label, r.required, d.status, d.document_ref, d.rejection_reason, d.reviewed_by, d.reviewed_at, d.updated_at
       FROM examinations.candidates c
       JOIN examinations.sessions s ON s.tenant_id = c.tenant_id AND s.id = c.session_id
       JOIN examinations.document_requirements r ON r.tenant_id = c.tenant_id AND r.exam_type_id = s.exam_type_id AND r.active
       LEFT JOIN examinations.candidate_documents d ON d.tenant_id = c.tenant_id AND d.candidate_id = c.id AND d.requirement_id = r.id
      WHERE c.id = $1 ORDER BY r.sort_order, r.code`,
    [candidateId],
  );
  return rows.map((r) => ({
    id: r.id ?? "", candidateId: r.candidate_id, requirementId: r.requirement_id, requirementCode: r.code, requirementLabel: r.label, required: r.required, status: r.status ?? "MISSING",
    documentRef: r.document_ref, rejectionReason: r.rejection_reason, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, updatedAt: r.updated_at,
  }));
}

export async function getPiece(tx: Tx, candidateId: string, requirementId: string): Promise<{ id: string; status: PieceStatus; documentRef: string | null } | null> {
  const r = await tx.queryOne<{ id: string; status: PieceStatus; document_ref: string | null }>(`SELECT id, status, document_ref FROM examinations.candidate_documents WHERE candidate_id = $1 AND requirement_id = $2`, [candidateId, requirementId]);
  return r ? { id: r.id, status: r.status, documentRef: r.document_ref } : null;
}

export async function submitPiece(tx: Tx, tenantId: string, p: { id: string; candidateId: string; requirementId: string; documentRef: string }): Promise<void> {
  await tx.query(
    `INSERT INTO examinations.candidate_documents (id, tenant_id, candidate_id, requirement_id, status, document_ref)
     VALUES ($1, $2, $3, $4, 'SUBMITTED', $5)
     ON CONFLICT (tenant_id, candidate_id, requirement_id) DO UPDATE SET status = 'SUBMITTED', document_ref = EXCLUDED.document_ref, rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()`,
    [p.id, tenantId, p.candidateId, p.requirementId, p.documentRef],
  );
}

export async function reviewPiece(tx: Tx, candidateId: string, requirementId: string, r: { status: "ACCEPTED" | "REJECTED"; rejectionReason: string | null; reviewedBy: string }): Promise<boolean> {
  const res = await tx.query(
    `UPDATE examinations.candidate_documents SET status = $3, rejection_reason = $4, reviewed_by = $5, reviewed_at = now(), updated_at = now() WHERE candidate_id = $1 AND requirement_id = $2`,
    [candidateId, requirementId, r.status, r.rejectionReason, r.reviewedBy],
  );
  return res.rowCount > 0;
}

// ------------------------------------------------------------------ historique

export async function listHistory(tx: Tx, candidateId: string): Promise<HistoryRow[]> {
  const rows = await tx.many<{ id: string; candidate_id: string; kind: HistoryRow["kind"]; from_value: string | null; to_value: string | null; reason: string | null; actor_id: string | null; occurred_at: Date }>(
    `SELECT id, candidate_id, kind, from_value, to_value, reason, actor_id, occurred_at FROM examinations.candidate_history WHERE candidate_id = $1 ORDER BY occurred_at, id`,
    [candidateId],
  );
  return rows.map((r) => ({ id: r.id, candidateId: r.candidate_id, kind: r.kind, fromValue: r.from_value, toValue: r.to_value, reason: r.reason, actorId: r.actor_id, occurredAt: r.occurred_at }));
}

export async function insertHistoryNote(tx: Tx, tenantId: string, h: { id: string; candidateId: string; kind: HistoryRow["kind"]; fromValue: string | null; toValue: string | null; reason: string | null; actorId: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, reason, actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [h.id, tenantId, h.candidateId, h.kind, h.fromValue, h.toValue, h.reason, h.actorId],
  );
}
