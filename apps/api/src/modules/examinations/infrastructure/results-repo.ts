/**
 * Dépôt SQL des notes, résultats, révisions, demandes de révision, lots d'import et leurs lignes.
 * Les gardes (session en cours, barème, série, révision de la même transaction, résultat officiel jamais calculé) sont des
 * déclencheurs de la base : ce dépôt n'en contourne aucune.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  BatchKind,
  BatchRow,
  BatchStatus,
  ImportRowRecord,
  ResultCode,
  ResultRow,
  ResultSource,
  ResultStatus,
  RevisionRequestRow,
  RevisionRequestStatus,
  RevisionTarget,
  ScoreRow,
  ScoreStatus,
} from "../domain/types";

// ------------------------------------------------------------------ notes d'épreuves

const SCORE_COLS = `id, session_id, candidate_id, paper_id, status, score::text AS score, source, source_ref, entered_by, row_version, updated_at`;
interface ScoreSql { id: string; session_id: string; candidate_id: string; paper_id: string; status: ScoreStatus; score: string | null; source: ScoreRow["source"]; source_ref: string | null; entered_by: string | null; row_version: number; updated_at: Date }
const toScore = (r: ScoreSql): ScoreRow => ({ id: r.id, sessionId: r.session_id, candidateId: r.candidate_id, paperId: r.paper_id, status: r.status, score: r.score, source: r.source, sourceRef: r.source_ref, enteredBy: r.entered_by, rowVersion: r.row_version, updatedAt: r.updated_at });

export async function listScores(tx: Tx, sessionId: string, paperId?: string): Promise<ScoreRow[]> {
  return (await tx.many<ScoreSql>(`SELECT ${SCORE_COLS} FROM examinations.paper_scores WHERE session_id = $1 AND ($2::uuid IS NULL OR paper_id = $2) ORDER BY candidate_id, paper_id`, [sessionId, paperId ?? null])).map(toScore);
}
export async function listScoresOfCandidate(tx: Tx, candidateId: string): Promise<ScoreRow[]> {
  return (await tx.many<ScoreSql>(`SELECT ${SCORE_COLS} FROM examinations.paper_scores WHERE candidate_id = $1 ORDER BY paper_id`, [candidateId])).map(toScore);
}
export async function getScore(tx: Tx, id: string): Promise<ScoreRow | null> {
  const r = await tx.queryOne<ScoreSql>(`SELECT ${SCORE_COLS} FROM examinations.paper_scores WHERE id = $1`, [id]);
  return r ? toScore(r) : null;
}
export async function getScoreOf(tx: Tx, candidateId: string, paperId: string): Promise<ScoreRow | null> {
  const r = await tx.queryOne<ScoreSql>(`SELECT ${SCORE_COLS} FROM examinations.paper_scores WHERE candidate_id = $1 AND paper_id = $2`, [candidateId, paperId]);
  return r ? toScore(r) : null;
}

export async function insertScore(tx: Tx, tenantId: string, s: { id: string; sessionId: string; candidateId: string; paperId: string; status: ScoreStatus; score: string | null; source: ScoreRow["source"]; sourceRef: string | null; enteredBy: string | null }): Promise<ScoreRow> {
  const r = await tx.queryOne<ScoreSql>(
    `INSERT INTO examinations.paper_scores (id, tenant_id, session_id, candidate_id, paper_id, status, score, source, source_ref, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10) RETURNING ${SCORE_COLS}`,
    [s.id, tenantId, s.sessionId, s.candidateId, s.paperId, s.status, s.score, s.source, s.sourceRef, s.enteredBy],
  );
  return toScore(r as ScoreSql);
}

export async function updateScore(tx: Tx, id: string, s: { status: ScoreStatus; score: string | null; source: ScoreRow["source"]; sourceRef: string | null; enteredBy: string | null }): Promise<ScoreRow | null> {
  const r = await tx.queryOne<ScoreSql>(
    `UPDATE examinations.paper_scores SET status = $2, score = $3::numeric, source = $4, source_ref = $5, entered_by = $6 WHERE id = $1 RETURNING ${SCORE_COLS}`,
    [id, s.status, s.score, s.source, s.sourceRef, s.enteredBy],
  );
  return r ? toScore(r) : null;
}

export async function insertScoreRevision(
  tx: Tx,
  tenantId: string,
  r: { id: string; scoreId: string; fromStatus: ScoreStatus; fromScore: string | null; toStatus: ScoreStatus; toScore: string | null; reason: string; requestedBy: string; approvedBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO examinations.score_revisions (id, tenant_id, score_id, from_status, from_score, to_status, to_score, reason, requested_by, approved_by) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7::numeric, $8, $9, $10)`,
    [r.id, tenantId, r.scoreId, r.fromStatus, r.fromScore, r.toStatus, r.toScore, r.reason, r.requestedBy, r.approvedBy],
  );
}

// ------------------------------------------------------------------ résultats

const RESULT_COLS = `id, session_id, candidate_id, result_code, average::text AS average, total_points::text AS total_points, rank, mention_code, source, rule_version_ref, inputs_hash, import_batch_id, status, published_at, published_by, entered_by, row_version, updated_at`;
interface ResultSql {
  id: string; session_id: string; candidate_id: string; result_code: ResultCode; average: string | null; total_points: string | null; rank: number | null; mention_code: string | null; source: ResultSource;
  rule_version_ref: string | null; inputs_hash: string | null; import_batch_id: string | null; status: ResultStatus; published_at: Date | null; published_by: string | null; entered_by: string | null; row_version: number; updated_at: Date;
}
const toResult = (r: ResultSql): ResultRow => ({
  id: r.id, sessionId: r.session_id, candidateId: r.candidate_id, resultCode: r.result_code, average: r.average, totalPoints: r.total_points, rank: r.rank, mentionCode: r.mention_code, source: r.source,
  ruleVersionRef: r.rule_version_ref, inputsHash: r.inputs_hash, importBatchId: r.import_batch_id, status: r.status, publishedAt: r.published_at, publishedBy: r.published_by, enteredBy: r.entered_by, rowVersion: r.row_version, updatedAt: r.updated_at,
});

export interface ResultListFilter { sessionId: string; resultCode?: string | undefined; status?: string | undefined; q?: string | undefined; page: number; pageSize: number }

export async function listResults(tx: Tx, f: ResultListFilter): Promise<{ items: Array<ResultRow & { candidateNumber: string | null; lastName: string | null; firstName: string | null }>; total: number }> {
  const q = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const params = [f.sessionId, f.resultCode ?? null, f.status ?? null, q];
  const where = `r.session_id = $1 AND ($2::text IS NULL OR r.result_code = $2) AND ($3::text IS NULL OR r.status = $3) AND ($4::text IS NULL OR c.candidate_number ILIKE $4 OR c.last_name ILIKE $4 OR c.first_name ILIKE $4)`;
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM examinations.candidate_results r JOIN examinations.candidates c ON c.tenant_id = r.tenant_id AND c.id = r.candidate_id WHERE ${where}`, params);
  const rows = await tx.many<ResultSql & { candidate_number: string | null; last_name: string | null; first_name: string | null }>(
    `SELECT ${RESULT_COLS.split(",").map((c) => `r.${c.trim()}`).join(", ")}, c.candidate_number, c.last_name, c.first_name
       FROM examinations.candidate_results r JOIN examinations.candidates c ON c.tenant_id = r.tenant_id AND c.id = r.candidate_id
      WHERE ${where} ORDER BY c.candidate_seq, r.id LIMIT $5 OFFSET $6`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize],
  );
  return { items: rows.map((r) => ({ ...toResult(r), candidateNumber: r.candidate_number, lastName: r.last_name, firstName: r.first_name })), total: total?.n ?? 0 };
}

export async function listResultsOfSession(tx: Tx, sessionId: string): Promise<ResultRow[]> {
  return (await tx.many<ResultSql>(`SELECT ${RESULT_COLS} FROM examinations.candidate_results WHERE session_id = $1 ORDER BY candidate_id`, [sessionId])).map(toResult);
}
export async function getResult(tx: Tx, id: string): Promise<ResultRow | null> {
  const r = await tx.queryOne<ResultSql>(`SELECT ${RESULT_COLS} FROM examinations.candidate_results WHERE id = $1`, [id]);
  return r ? toResult(r) : null;
}
export async function getResultOfCandidate(tx: Tx, candidateId: string): Promise<ResultRow | null> {
  const r = await tx.queryOne<ResultSql>(`SELECT ${RESULT_COLS} FROM examinations.candidate_results WHERE candidate_id = $1`, [candidateId]);
  return r ? toResult(r) : null;
}

export interface ResultWrite {
  id: string;
  sessionId: string;
  candidateId: string;
  resultCode: ResultCode;
  average: string | null;
  totalPoints: string | null;
  rank: number | null;
  mentionCode: string | null;
  source: ResultSource;
  ruleVersionRef: string | null;
  inputsHash: string | null;
  importBatchId: string | null;
  enteredBy: string | null;
}

export async function insertResult(tx: Tx, tenantId: string, w: ResultWrite): Promise<ResultRow> {
  const r = await tx.queryOne<ResultSql>(
    `INSERT INTO examinations.candidate_results (id, tenant_id, session_id, candidate_id, result_code, average, total_points, rank, mention_code, source, rule_version_ref, inputs_hash, import_batch_id, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10, $11, $12, $13, $14) RETURNING ${RESULT_COLS}`,
    [w.id, tenantId, w.sessionId, w.candidateId, w.resultCode, w.average, w.totalPoints, w.rank, w.mentionCode, w.source, w.ruleVersionRef, w.inputsHash, w.importBatchId, w.enteredBy],
  );
  return toResult(r as ResultSql);
}

/** Remplace le contenu d'un résultat NON publié (DRAFT) ; un résultat publié n'est jamais touché ici (révision). */
export async function replaceDraftResult(tx: Tx, id: string, w: Omit<ResultWrite, "id" | "sessionId" | "candidateId">): Promise<ResultRow | null> {
  const r = await tx.queryOne<ResultSql>(
    `UPDATE examinations.candidate_results SET result_code = $2, average = $3::numeric, total_points = $4::numeric, rank = $5, mention_code = $6, source = $7, rule_version_ref = $8, inputs_hash = $9, import_batch_id = $10, entered_by = $11
      WHERE id = $1 AND status = 'DRAFT' RETURNING ${RESULT_COLS}`,
    [id, w.resultCode, w.average, w.totalPoints, w.rank, w.mentionCode, w.source, w.ruleVersionRef, w.inputsHash, w.importBatchId, w.enteredBy],
  );
  return r ? toResult(r) : null;
}

export async function publishResult(tx: Tx, id: string, by: string): Promise<ResultRow | null> {
  const r = await tx.queryOne<ResultSql>(
    `UPDATE examinations.candidate_results SET status = 'PUBLISHED', published_at = now(), published_by = $2 WHERE id = $1 AND status = 'DRAFT' RETURNING ${RESULT_COLS}`,
    [id, by],
  );
  return r ? toResult(r) : null;
}

export async function publishAllDraft(tx: Tx, sessionId: string, by: string): Promise<ResultRow[]> {
  const rows = await tx.many<ResultSql>(
    `UPDATE examinations.candidate_results SET status = 'PUBLISHED', published_at = now(), published_by = $2 WHERE session_id = $1 AND status = 'DRAFT' RETURNING ${RESULT_COLS}`,
    [sessionId, by],
  );
  return rows.map(toResult);
}

/** Correction d'un résultat PUBLIÉ : valable seulement avec sa révision insérée dans la MÊME transaction (déclencheur). */
export async function applyResultCorrection(tx: Tx, id: string, c: { resultCode: ResultCode; average: string | null }): Promise<ResultRow | null> {
  const noAverage = c.resultCode === "ABSENT" || c.resultCode === "EXCLUDED" || c.resultCode === "DEFERRED";
  const r = await tx.queryOne<ResultSql>(
    `UPDATE examinations.candidate_results SET result_code = $2, average = $3::numeric, rank = CASE WHEN $4::boolean THEN NULL ELSE rank END, mention_code = CASE WHEN $4::boolean THEN NULL ELSE mention_code END
      WHERE id = $1 RETURNING ${RESULT_COLS}`,
    [id, c.resultCode, noAverage ? null : c.average, noAverage],
  );
  return r ? toResult(r) : null;
}

export async function insertResultRevision(
  tx: Tx,
  tenantId: string,
  r: { id: string; resultId: string; fromCode: ResultCode; toCode: ResultCode; fromAverage: string | null; toAverage: string | null; reason: string; requestedBy: string; approvedBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO examinations.result_revisions (id, tenant_id, result_id, from_code, to_code, from_average, to_average, reason, requested_by, approved_by) VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10)`,
    [r.id, tenantId, r.resultId, r.fromCode, r.toCode, r.fromAverage, r.toAverage, r.reason, r.requestedBy, r.approvedBy],
  );
}

// ------------------------------------------------------------------ demandes de révision

const REQ_COLS = `id, session_id, target_kind, score_id, result_id, proposed, reason, requested_by, requested_at, status, decided_by, decided_at, decision_note, revision_id`;
interface ReqSql { id: string; session_id: string; target_kind: RevisionTarget; score_id: string | null; result_id: string | null; proposed: Record<string, unknown>; reason: string; requested_by: string; requested_at: Date; status: RevisionRequestStatus; decided_by: string | null; decided_at: Date | null; decision_note: string | null; revision_id: string | null }
const toReq = (r: ReqSql): RevisionRequestRow => ({
  id: r.id, sessionId: r.session_id, targetKind: r.target_kind, scoreId: r.score_id, resultId: r.result_id, proposed: r.proposed, reason: r.reason, requestedBy: r.requested_by, requestedAt: r.requested_at,
  status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note, revisionId: r.revision_id,
});

export async function insertRevisionRequest(tx: Tx, tenantId: string, q: { id: string; sessionId: string; targetKind: RevisionTarget; scoreId: string | null; resultId: string | null; proposed: Record<string, unknown>; reason: string; requestedBy: string }): Promise<RevisionRequestRow> {
  const r = await tx.queryOne<ReqSql>(
    `INSERT INTO examinations.revision_requests (id, tenant_id, session_id, target_kind, score_id, result_id, proposed, reason, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING ${REQ_COLS}`,
    [q.id, tenantId, q.sessionId, q.targetKind, q.scoreId, q.resultId, JSON.stringify(q.proposed), q.reason, q.requestedBy],
  );
  return toReq(r as ReqSql);
}

export async function getRevisionRequest(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<RevisionRequestRow | null> {
  const r = await tx.queryOne<ReqSql>(`SELECT ${REQ_COLS} FROM examinations.revision_requests WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? toReq(r) : null;
}

export async function listRevisionRequests(tx: Tx, f: { sessionId: string; status?: string | undefined; page: number; pageSize: number }): Promise<{ items: RevisionRequestRow[]; total: number }> {
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM examinations.revision_requests WHERE session_id = $1 AND ($2::text IS NULL OR status = $2)`, [f.sessionId, f.status ?? null]);
  const rows = await tx.many<ReqSql>(`SELECT ${REQ_COLS} FROM examinations.revision_requests WHERE session_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY requested_at DESC, id LIMIT $3 OFFSET $4`, [f.sessionId, f.status ?? null, f.pageSize, (f.page - 1) * f.pageSize]);
  return { items: rows.map(toReq), total: total?.n ?? 0 };
}

export async function decideRevisionRequest(tx: Tx, id: string, d: { status: "APPROVED" | "REJECTED"; decidedBy: string; decisionNote: string | null; revisionId: string | null }): Promise<RevisionRequestRow | null> {
  const r = await tx.queryOne<ReqSql>(
    `UPDATE examinations.revision_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, revision_id = $5 WHERE id = $1 AND status = 'PENDING' RETURNING ${REQ_COLS}`,
    [id, d.status, d.decidedBy, d.decisionNote, d.revisionId],
  );
  return r ? toReq(r) : null;
}

// ------------------------------------------------------------------ lots d'import

const BATCH_COLS = `id, session_id, kind, file_name, sha256, format_code, row_count, ok_count, error_count, status, uploaded_by, applied_by, applied_at, created_at`;
interface BatchSql { id: string; session_id: string; kind: BatchKind; file_name: string; sha256: string; format_code: string | null; row_count: number; ok_count: number; error_count: number; status: BatchStatus; uploaded_by: string; applied_by: string | null; applied_at: Date | null; created_at: Date }
const toBatch = (r: BatchSql): BatchRow => ({
  id: r.id, sessionId: r.session_id, kind: r.kind, fileName: r.file_name, sha256: r.sha256, formatCode: r.format_code, rowCount: r.row_count, okCount: r.ok_count, errorCount: r.error_count, status: r.status,
  uploadedBy: r.uploaded_by, appliedBy: r.applied_by, appliedAt: r.applied_at, createdAt: r.created_at,
});

export async function insertBatch(tx: Tx, tenantId: string, b: { id: string; sessionId: string; kind: BatchKind; fileName: string; sha256: string; formatCode: string; uploadedBy: string }): Promise<BatchRow> {
  const r = await tx.queryOne<BatchSql>(
    `INSERT INTO examinations.import_batches (id, tenant_id, session_id, kind, file_name, sha256, format_code, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${BATCH_COLS}`,
    [b.id, tenantId, b.sessionId, b.kind, b.fileName, b.sha256, b.formatCode, b.uploadedBy],
  );
  return toBatch(r as BatchSql);
}
export async function getBatch(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<BatchRow | null> {
  const r = await tx.queryOne<BatchSql>(`SELECT ${BATCH_COLS} FROM examinations.import_batches WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? toBatch(r) : null;
}
export async function listBatches(tx: Tx, sessionId: string): Promise<BatchRow[]> {
  return (await tx.many<BatchSql>(`SELECT ${BATCH_COLS} FROM examinations.import_batches WHERE session_id = $1 ORDER BY created_at DESC, id`, [sessionId])).map(toBatch);
}
export async function setBatchValidated(tx: Tx, id: string, c: { rowCount: number; okCount: number; errorCount: number; status: "VALIDATED" | "REJECTED" }): Promise<BatchRow | null> {
  const r = await tx.queryOne<BatchSql>(`UPDATE examinations.import_batches SET row_count = $2, ok_count = $3, error_count = $4, status = $5 WHERE id = $1 RETURNING ${BATCH_COLS}`, [id, c.rowCount, c.okCount, c.errorCount, c.status]);
  return r ? toBatch(r) : null;
}
export async function setBatchApplied(tx: Tx, id: string, by: string): Promise<BatchRow | null> {
  const r = await tx.queryOne<BatchSql>(`UPDATE examinations.import_batches SET status = 'APPLIED', applied_by = $2, applied_at = now() WHERE id = $1 RETURNING ${BATCH_COLS}`, [id, by]);
  return r ? toBatch(r) : null;
}
export async function setBatchRejected(tx: Tx, id: string): Promise<BatchRow | null> {
  const r = await tx.queryOne<BatchSql>(`UPDATE examinations.import_batches SET status = 'REJECTED' WHERE id = $1 RETURNING ${BATCH_COLS}`, [id]);
  return r ? toBatch(r) : null;
}

export async function insertImportRows(tx: Tx, tenantId: string, batchId: string, rows: ReadonlyArray<{ id: string; lineNo: number; status: "OK" | "ERROR" | "SKIPPED"; errorCode: string | null; candidateId: string | null; payload: Record<string, unknown> }>): Promise<void> {
  // Insertion par paquets : une seule requête par centaine de lignes.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values: string[] = [];
    const params: unknown[] = [tenantId, batchId];
    chunk.forEach((r, j) => {
      const o = 3 + j * 6;
      values.push(`($${o}, $1, $2, $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}::jsonb)`);
      params.push(r.id, r.lineNo, r.status, r.errorCode, r.candidateId, JSON.stringify(r.payload));
    });
    await tx.query(`INSERT INTO examinations.import_rows (id, tenant_id, batch_id, line_no, status, error_code, candidate_id, payload) VALUES ${values.join(", ")}`, params);
  }
}

export async function listImportRows(tx: Tx, f: { batchId: string; status?: string | undefined; page: number; pageSize: number }): Promise<{ items: ImportRowRecord[]; total: number }> {
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM examinations.import_rows WHERE batch_id = $1 AND ($2::text IS NULL OR status = $2)`, [f.batchId, f.status ?? null]);
  const rows = await tx.many<{ id: string; batch_id: string; line_no: number; status: ImportRowRecord["status"]; error_code: string | null; candidate_id: string | null; payload: Record<string, unknown> }>(
    `SELECT id, batch_id, line_no, status, error_code, candidate_id, payload FROM examinations.import_rows WHERE batch_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY line_no LIMIT $3 OFFSET $4`,
    [f.batchId, f.status ?? null, f.pageSize, (f.page - 1) * f.pageSize],
  );
  return { items: rows.map((r) => ({ id: r.id, batchId: r.batch_id, lineNo: r.line_no, status: r.status, errorCode: r.error_code, candidateId: r.candidate_id, payload: r.payload })), total: total?.n ?? 0 };
}

export async function listOkImportRows(tx: Tx, batchId: string): Promise<ImportRowRecord[]> {
  const rows = await tx.many<{ id: string; batch_id: string; line_no: number; status: ImportRowRecord["status"]; error_code: string | null; candidate_id: string | null; payload: Record<string, unknown> }>(
    `SELECT id, batch_id, line_no, status, error_code, candidate_id, payload FROM examinations.import_rows WHERE batch_id = $1 AND status = 'OK' ORDER BY line_no`,
    [batchId],
  );
  return rows.map((r) => ({ id: r.id, batchId: r.batch_id, lineNo: r.line_no, status: r.status, errorCode: r.error_code, candidateId: r.candidate_id, payload: r.payload }));
}
