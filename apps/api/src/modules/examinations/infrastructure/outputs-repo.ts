/**
 * Dépôt SQL des SORTIES : exécutions d'export (et lecture des faits à exporter), documents émis.
 * Les faits d'export sont lus en une passe (candidat + place + résultat + identifiants + notes par épreuve) ; la mise en
 * forme est faite par le domaine (`export-render.ts`), jamais en SQL.
 */
import type { Tx } from "@ecoledigitale/database";
import type { DocumentKind, ExportRunRow, IssuedDocumentRow, IssuedStatus } from "../domain/types";
import type { ExportFacts } from "../domain/export-render";

// ------------------------------------------------------------------ faits d'export

export interface ExportFactsFilter {
  sessionId: string;
  trackCode?: string | undefined;
  registrationStatus?: string | undefined;
  /** Nom (libellé) de l'établissement, déjà résolu par le port. */
  institutionName: string | null;
  limit: number;
}

interface FactSql {
  id: string; candidate_number: string | null; official_number: string | null; last_name: string | null; first_name: string | null; birth_date: string | null; birth_place: string | null;
  sex: string | null; track_code: string | null; grade_level_code: string | null; registration_status: string; cepe_code: string | null; national_id: string | null;
  center_code: string | null; center_name: string | null; room_code: string | null; seat_number: number | null; table_number: string | null;
  result_code: string | null; average: string | null; rank: number | null; mention_code: string | null; total_points: string | null;
}

export async function loadExportFacts(tx: Tx, f: ExportFactsFilter): Promise<Array<{ candidateId: string; facts: ExportFacts }>> {
  const rows = await tx.many<FactSql>(
    `SELECT c.id, c.candidate_number, c.last_name, c.first_name, c.birth_date::text AS birth_date, c.birth_place, c.sex, c.track_code, c.grade_level_code, c.registration_status,
            (SELECT i.value FROM examinations.candidate_identifiers i WHERE i.tenant_id = c.tenant_id AND i.candidate_id = c.id AND i.kind = 'OFFICIAL_NUMBER') AS official_number,
            (SELECT i.value FROM examinations.candidate_identifiers i WHERE i.tenant_id = c.tenant_id AND i.candidate_id = c.id AND i.kind = 'CEPE_CODE') AS cepe_code,
            (SELECT i.value FROM examinations.candidate_identifiers i WHERE i.tenant_id = c.tenant_id AND i.candidate_id = c.id AND i.kind = 'NATIONAL_ID') AS national_id,
            ce.code AS center_code, ce.name AS center_name, ro.code AS room_code, a.seat_number, a.table_number,
            r.result_code, r.average::text AS average, r.rank, r.mention_code, r.total_points::text AS total_points
       FROM examinations.candidates c
       LEFT JOIN examinations.seat_assignments a ON a.tenant_id = c.tenant_id AND a.candidate_id = c.id
       LEFT JOIN examinations.centers ce ON ce.tenant_id = a.tenant_id AND ce.id = a.center_id
       LEFT JOIN examinations.rooms ro ON ro.tenant_id = a.tenant_id AND ro.id = a.room_id
       LEFT JOIN examinations.candidate_results r ON r.tenant_id = c.tenant_id AND r.candidate_id = c.id
      WHERE c.session_id = $1 AND c.registration_status = COALESCE($2::text, 'REGISTERED') AND ($3::text IS NULL OR c.track_code = $3)
      ORDER BY c.candidate_seq NULLS LAST, c.id LIMIT $4`,
    [f.sessionId, f.registrationStatus ?? null, f.trackCode ?? null, f.limit],
  );
  const ids = rows.map((r) => r.id);
  const papers = new Map<string, Record<string, string | null>>();
  if (ids.length > 0) {
    const scores = await tx.many<{ candidate_id: string; code: string; status: string; score: string | null }>(
      `SELECT s.candidate_id, p.code, s.status, s.score::text AS score FROM examinations.paper_scores s JOIN examinations.session_papers p ON p.tenant_id = s.tenant_id AND p.id = s.paper_id
        WHERE s.candidate_id = ANY($1::uuid[])`,
      [ids],
    );
    for (const s of scores) {
      const m = papers.get(s.candidate_id) ?? {};
      m[s.code] = s.status === "ENTERED" ? s.score : null;
      papers.set(s.candidate_id, m);
    }
  }
  return rows.map((r) => ({
    candidateId: r.id,
    facts: {
      candidate: {
        number: r.candidate_number, officialNumber: r.official_number, lastName: r.last_name, firstName: r.first_name, birthDate: r.birth_date, birthPlace: r.birth_place, sex: r.sex,
        track: r.track_code, gradeLevel: r.grade_level_code, institution: f.institutionName, status: r.registration_status, cepeCode: r.cepe_code, nationalId: r.national_id,
      },
      assignment: { centerCode: r.center_code, centerName: r.center_name, roomCode: r.room_code, seatNumber: r.seat_number, tableNumber: r.table_number },
      result: { code: r.result_code, average: r.average, rank: r.rank, mention: r.mention_code, totalPoints: r.total_points },
      papers: papers.get(r.id) ?? {},
    },
  }));
}

// ------------------------------------------------------------------ exécutions d'export

const RUN_COLS = `id, session_id, format_id, format_version, filters, status, row_count, file_sha256, storage_key, error_code, requested_by, created_at, completed_at`;
interface RunSql { id: string; session_id: string; format_id: string; format_version: number; filters: Record<string, unknown>; status: ExportRunRow["status"]; row_count: number | null; file_sha256: string | null; storage_key: string | null; error_code: string | null; requested_by: string; created_at: Date; completed_at: Date | null }
const toRun = (r: RunSql): ExportRunRow => ({
  id: r.id, sessionId: r.session_id, formatId: r.format_id, formatVersion: r.format_version, filters: r.filters, status: r.status, rowCount: r.row_count, fileSha256: r.file_sha256, storageKey: r.storage_key,
  errorCode: r.error_code, requestedBy: r.requested_by, createdAt: r.created_at, completedAt: r.completed_at,
});

export async function insertExportRun(tx: Tx, tenantId: string, r: { id: string; sessionId: string; formatId: string; filters: Record<string, unknown>; requestedBy: string }): Promise<ExportRunRow> {
  // `format_version` est posée par le déclencheur depuis le format PUBLIÉ (la valeur fournie est ignorée).
  const row = await tx.queryOne<RunSql>(
    `INSERT INTO examinations.export_runs (id, tenant_id, session_id, format_id, format_version, filters, requested_by) VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6) RETURNING ${RUN_COLS}`,
    [r.id, tenantId, r.sessionId, r.formatId, JSON.stringify(r.filters), r.requestedBy],
  );
  return toRun(row as RunSql);
}
export async function completeExportRun(tx: Tx, id: string, c: { rowCount: number; sha256: string; storageKey: string }): Promise<ExportRunRow | null> {
  const row = await tx.queryOne<RunSql>(`UPDATE examinations.export_runs SET status = 'DONE', row_count = $2, file_sha256 = $3, storage_key = $4, completed_at = now() WHERE id = $1 AND status = 'RUNNING' RETURNING ${RUN_COLS}`, [id, c.rowCount, c.sha256, c.storageKey]);
  return row ? toRun(row) : null;
}
export async function failExportRun(tx: Tx, id: string, errorCode: string): Promise<ExportRunRow | null> {
  const row = await tx.queryOne<RunSql>(`UPDATE examinations.export_runs SET status = 'FAILED', error_code = $2, completed_at = now() WHERE id = $1 AND status = 'RUNNING' RETURNING ${RUN_COLS}`, [id, errorCode]);
  return row ? toRun(row) : null;
}
export async function getExportRun(tx: Tx, id: string): Promise<ExportRunRow | null> {
  const row = await tx.queryOne<RunSql>(`SELECT ${RUN_COLS} FROM examinations.export_runs WHERE id = $1`, [id]);
  return row ? toRun(row) : null;
}
export async function listExportRuns(tx: Tx, sessionId: string): Promise<Array<ExportRunRow & { formatCode: string | null }>> {
  const rows = await tx.many<RunSql & { format_code: string | null }>(
    `SELECT ${RUN_COLS.split(",").map((c) => `r.${c.trim()}`).join(", ")}, f.code AS format_code FROM examinations.export_runs r LEFT JOIN examinations.export_formats f ON f.tenant_id = r.tenant_id AND f.id = r.format_id
      WHERE r.session_id = $1 ORDER BY r.created_at DESC, r.id`,
    [sessionId],
  );
  return rows.map((r) => ({ ...toRun(r), formatCode: r.format_code }));
}

// ------------------------------------------------------------------ documents émis

const DOC_COLS = `id, session_id, candidate_id, kind, version, official_document_id, status, requested_by, issued_at, revoked_reason, created_at`;
interface DocSql { id: string; session_id: string; candidate_id: string; kind: DocumentKind; version: number; official_document_id: string | null; status: IssuedStatus; requested_by: string; issued_at: Date | null; revoked_reason: string | null; created_at: Date }
const toDoc = (r: DocSql): IssuedDocumentRow => ({
  id: r.id, sessionId: r.session_id, candidateId: r.candidate_id, kind: r.kind, version: r.version, officialDocumentId: r.official_document_id, status: r.status, requestedBy: r.requested_by, issuedAt: r.issued_at, revokedReason: r.revoked_reason, createdAt: r.created_at,
});

export async function nextDocumentVersion(tx: Tx, candidateId: string, kind: DocumentKind): Promise<number> {
  const r = await tx.queryOne<{ v: number }>(`SELECT COALESCE(max(version), 0)::int + 1 AS v FROM examinations.issued_documents WHERE candidate_id = $1 AND kind = $2`, [candidateId, kind]);
  return r?.v ?? 1;
}
export async function insertIssuedDocument(tx: Tx, tenantId: string, d: { id: string; sessionId: string; candidateId: string; kind: DocumentKind; version: number; requestedBy: string }): Promise<IssuedDocumentRow> {
  const r = await tx.queryOne<DocSql>(
    `INSERT INTO examinations.issued_documents (id, tenant_id, session_id, candidate_id, kind, version, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${DOC_COLS}`,
    [d.id, tenantId, d.sessionId, d.candidateId, d.kind, d.version, d.requestedBy],
  );
  return toDoc(r as DocSql);
}
export async function markDocumentIssued(tx: Tx, id: string, officialDocumentId: string): Promise<IssuedDocumentRow | null> {
  const r = await tx.queryOne<DocSql>(`UPDATE examinations.issued_documents SET status = 'ISSUED', official_document_id = $2, issued_at = now() WHERE id = $1 AND status = 'REQUESTED' RETURNING ${DOC_COLS}`, [id, officialDocumentId]);
  return r ? toDoc(r) : null;
}
export async function revokeDocument(tx: Tx, id: string, reason: string): Promise<IssuedDocumentRow | null> {
  const r = await tx.queryOne<DocSql>(`UPDATE examinations.issued_documents SET status = 'REVOKED', revoked_reason = $2 WHERE id = $1 AND status <> 'REVOKED' RETURNING ${DOC_COLS}`, [id, reason]);
  return r ? toDoc(r) : null;
}
export async function getIssuedDocument(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<IssuedDocumentRow | null> {
  const r = await tx.queryOne<DocSql>(`SELECT ${DOC_COLS} FROM examinations.issued_documents WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? toDoc(r) : null;
}
export async function getLiveDocument(tx: Tx, candidateId: string, kind: DocumentKind): Promise<IssuedDocumentRow | null> {
  const r = await tx.queryOne<DocSql>(`SELECT ${DOC_COLS} FROM examinations.issued_documents WHERE candidate_id = $1 AND kind = $2 AND status <> 'REVOKED'`, [candidateId, kind]);
  return r ? toDoc(r) : null;
}
export async function listDocumentsOfCandidate(tx: Tx, candidateId: string): Promise<IssuedDocumentRow[]> {
  return (await tx.many<DocSql>(`SELECT ${DOC_COLS} FROM examinations.issued_documents WHERE candidate_id = $1 ORDER BY created_at DESC, id`, [candidateId])).map(toDoc);
}
export async function listDocumentsOfCandidates(tx: Tx, candidateIds: readonly string[]): Promise<IssuedDocumentRow[]> {
  if (candidateIds.length === 0) return [];
  return (await tx.many<DocSql>(`SELECT ${DOC_COLS} FROM examinations.issued_documents WHERE candidate_id = ANY($1::uuid[]) ORDER BY created_at DESC, id`, [candidateIds])).map(toDoc);
}
export async function listIssuedDocuments(tx: Tx, f: { sessionId: string; kind?: string | undefined; status?: string | undefined; page: number; pageSize: number }): Promise<{ items: Array<IssuedDocumentRow & { candidateNumber: string | null }>; total: number }> {
  const params = [f.sessionId, f.kind ?? null, f.status ?? null];
  const where = `d.session_id = $1 AND ($2::text IS NULL OR d.kind = $2) AND ($3::text IS NULL OR d.status = $3)`;
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM examinations.issued_documents d WHERE ${where}`, params);
  const rows = await tx.many<DocSql & { candidate_number: string | null }>(
    `SELECT ${DOC_COLS.split(",").map((c) => `d.${c.trim()}`).join(", ")}, c.candidate_number FROM examinations.issued_documents d JOIN examinations.candidates c ON c.tenant_id = d.tenant_id AND c.id = d.candidate_id
      WHERE ${where} ORDER BY c.candidate_seq, d.kind, d.version DESC LIMIT $4 OFFSET $5`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize],
  );
  return { items: rows.map((r) => ({ ...toDoc(r), candidateNumber: r.candidate_number })), total: total?.n ?? 0 };
}
