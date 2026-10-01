/**
 * Accès SQL : en-têtes de résultats (versionnés) et lignes. Les écritures de masse passent par `unnest`.
 */
import type { Tx } from "@ecoledigitale/database";
import type { LineRecord, ResultHeader } from "../domain/records";
import type { ComputedHeader, ComputedLine, ResultStatus } from "../domain/types";
import { HEADER_COLUMNS, LINE_COLUMNS, toHeader, toLine } from "./rows";

/**
 * Résultats COURANTS d'une période.
 *  - `LATEST` (vues de travail) : la version la plus récente non remplacée — après une réouverture, le brouillon de correction
 *    prime sur le FINAL qu'il remplacera ; période clôturée, c'est le FINAL (aucun brouillon plus récent n'existe) ;
 *  - `FINAL` (résultat OFFICIEL) : le FINAL s'il existe, sinon la version la plus récente.
 */
export async function listCurrentHeaders(tx: Tx, stateId: string, prefer: "LATEST" | "FINAL" = "LATEST"): Promise<ResultHeader[]> {
  const rows = await tx.many(
    `SELECT DISTINCT ON (r.enrollment_id) ${HEADER_COLUMNS}
       FROM results.period_results r
      WHERE r.state_id = $1 AND r.status IN ('FINAL', 'DRAFT', 'ERROR')
      ORDER BY r.enrollment_id, ${prefer === "FINAL" ? "CASE r.status WHEN 'FINAL' THEN 0 ELSE 1 END," : ""} r.version DESC`,
    [stateId],
  );
  return rows.map(toHeader);
}

export async function listDraftHeaders(tx: Tx, stateId: string): Promise<ResultHeader[]> {
  const rows = await tx.many(`SELECT ${HEADER_COLUMNS} FROM results.period_results r WHERE r.state_id = $1 AND r.status IN ('DRAFT', 'ERROR')`, [stateId]);
  return rows.map(toHeader);
}

export async function listFinalHeaders(tx: Tx, stateId: string): Promise<ResultHeader[]> {
  const rows = await tx.many(`SELECT ${HEADER_COLUMNS} FROM results.period_results r WHERE r.state_id = $1 AND r.status = 'FINAL' ORDER BY r.enrollment_id`, [stateId]);
  return rows.map(toHeader);
}

export async function getHeaderById(tx: Tx, id: string): Promise<ResultHeader | null> {
  const row = await tx.queryOne(`SELECT ${HEADER_COLUMNS} FROM results.period_results r WHERE r.id = $1`, [id]);
  return row ? toHeader(row) : null;
}

export async function listHeadersOfEnrollment(tx: Tx, enrollmentId: string, stateId?: string): Promise<ResultHeader[]> {
  const rows = stateId
    ? await tx.many(`SELECT ${HEADER_COLUMNS} FROM results.period_results r WHERE r.enrollment_id = $1 AND r.state_id = $2 ORDER BY r.version`, [enrollmentId, stateId])
    : await tx.many(`SELECT ${HEADER_COLUMNS} FROM results.period_results r WHERE r.enrollment_id = $1 ORDER BY r.computed_at, r.version`, [enrollmentId]);
  return rows.map(toHeader);
}

export async function maxVersion(tx: Tx, stateId: string, enrollmentId: string): Promise<number> {
  const row = await tx.queryOne<{ v: number | null }>("SELECT max(version) AS v FROM results.period_results WHERE state_id = $1 AND enrollment_id = $2", [stateId, enrollmentId]);
  return row?.v ?? 0;
}

export interface HeaderInsert {
  id: string;
  tenantId: string;
  stateId: string;
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  academicPeriodId: string | null;
  academicYearId: string;
  scope: "PERIOD" | "YEAR";
  version: number;
  status: ResultStatus;
  contractId: string;
  ruleVersionKind: string;
  ruleVersionId: string;
  ruleSetCode: string;
  ruleVersionNo: number;
  definitionHash: string;
  engineVersion: string;
  inputsHash: string;
  outputsHash: string | null;
  inputs: unknown | null;
  error: unknown | null;
  header: ComputedHeader | null;
  closureId: string | null;
  lineCount: number | null;
  finalizedAt: Date | null;
  supersedesId: string | null;
  now: Date;
}

export async function insertHeader(tx: Tx, h: HeaderInsert): Promise<void> {
  const c = h.header;
  await tx.query(
    `INSERT INTO results.period_results (id, tenant_id, state_id, enrollment_id, student_id, classroom_id, academic_period_id, academic_year_id, scope, version, status,
        contract_id, rule_version_kind, rule_version_id, rule_set_code, rule_version_no, definition_hash, engine_version, inputs_hash, outputs_hash, inputs, error,
        average, average_display, rank, cohort_size, mention_code, decision_code, decision_outcome, credits_acquired, credits_required, validated, summary,
        closure_id, line_count, computed_at, finalized_at, supersedes_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::numeric,$24::numeric,$25,$26,$27,$28,$29,$30::numeric,$31::numeric,$32,$33::jsonb,
        $34,$35,$36,$37,$38)`,
    [
      h.id, h.tenantId, h.stateId, h.enrollmentId, h.studentId, h.classroomId, h.academicPeriodId, h.academicYearId, h.scope, h.version, h.status,
      h.contractId, h.ruleVersionKind, h.ruleVersionId, h.ruleSetCode, h.ruleVersionNo, h.definitionHash, h.engineVersion, h.inputsHash, h.outputsHash,
      h.inputs === null ? null : JSON.stringify(h.inputs), h.error === null ? null : JSON.stringify(h.error),
      c?.average ?? null, c?.averageDisplay ?? null, c?.rank ?? null, c?.cohortSize ?? null, c?.mentionCode ?? null, c?.decisionCode ?? null, c?.decisionOutcome ?? null,
      c?.creditsAcquired ?? null, c?.creditsRequired ?? null, c?.validated ?? null, JSON.stringify(c?.summary ?? {}),
      h.closureId, h.lineCount, h.now, h.finalizedAt, h.supersedesId,
    ],
  );
}

/** Met à jour EN PLACE un brouillon (même version : seules les valeurs de rang / de synthèse ont changé). */
export async function updateDraftSummary(tx: Tx, id: string, outputsHash: string | null, c: ComputedHeader | null, now: Date): Promise<void> {
  await tx.query(
    `UPDATE results.period_results SET outputs_hash = $2, average = $3::numeric, average_display = $4::numeric, rank = $5, cohort_size = $6, mention_code = $7,
        decision_code = $8, decision_outcome = $9, credits_acquired = $10::numeric, credits_required = $11::numeric, validated = $12, summary = $13::jsonb, computed_at = $14
      WHERE id = $1`,
    [id, outputsHash, c?.average ?? null, c?.averageDisplay ?? null, c?.rank ?? null, c?.cohortSize ?? null, c?.mentionCode ?? null, c?.decisionCode ?? null, c?.decisionOutcome ?? null, c?.creditsAcquired ?? null, c?.creditsRequired ?? null, c?.validated ?? null, JSON.stringify(c?.summary ?? {}), now],
  );
}

export async function markSuperseded(tx: Tx, ids: readonly string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx.query("UPDATE results.period_results SET status = 'SUPERSEDED', superseded_at = $2 WHERE id = ANY($1::uuid[])", [[...ids], at]);
}

export async function insertLines(tx: Tx, tenantId: string, resultId: string, lines: readonly ComputedLine[], newId: () => string): Promise<void> {
  if (lines.length === 0) return;
  await tx.query(
    `INSERT INTO results.line_results (id, tenant_id, period_result_id, level, curriculum_node_id, parent_node_id, value, display_value, credits, coefficient, validated,
        status_code, session_obtained, resit_eligible, rank, cohort_size, overridden, override_id, outputs, trace, position)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::uuid[], $6::uuid[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::boolean[],
        $12::text[], $13::smallint[], $14::boolean[], $15::int[], $16::int[], $17::boolean[], $18::uuid[], $19::jsonb[], $20::jsonb[], $21::int[])`,
    [
      lines.map(() => newId()),
      lines.map(() => tenantId),
      lines.map(() => resultId),
      lines.map((l) => l.level),
      lines.map((l) => l.curriculumNodeId),
      lines.map((l) => l.parentNodeId),
      lines.map((l) => l.value),
      lines.map((l) => l.displayValue),
      lines.map((l) => l.credits),
      lines.map((l) => l.coefficient),
      lines.map((l) => l.validated),
      lines.map((l) => l.statusCode),
      lines.map((l) => l.sessionObtained),
      lines.map((l) => l.resitEligible),
      lines.map((l) => l.rank),
      lines.map((l) => l.cohortSize),
      lines.map((l) => l.overridden),
      lines.map((l) => l.overrideId),
      lines.map((l) => JSON.stringify(l.outputs)),
      lines.map((l) => (l.trace === null ? null : JSON.stringify(l.trace))),
      lines.map((l) => l.position),
    ],
  );
}

export async function deleteLines(tx: Tx, resultId: string): Promise<void> {
  await tx.query("DELETE FROM results.line_results WHERE period_result_id = $1", [resultId]);
}

export async function listLines(tx: Tx, resultId: string): Promise<LineRecord[]> {
  const rows = await tx.many(`SELECT ${LINE_COLUMNS} FROM results.line_results l WHERE l.period_result_id = $1 ORDER BY l.position, l.id`, [resultId]);
  return rows.map(toLine);
}

export async function listLinesOfHeaders(tx: Tx, resultIds: readonly string[]): Promise<LineRecord[]> {
  if (resultIds.length === 0) return [];
  const rows = await tx.many(`SELECT ${LINE_COLUMNS} FROM results.line_results l WHERE l.period_result_id = ANY($1::uuid[]) ORDER BY l.period_result_id, l.position, l.id`, [[...resultIds]]);
  return rows.map(toLine);
}

export async function purgeStaleDrafts(tx: Tx, before: Date): Promise<number> {
  const where = "finalized_at IS NULL AND status = 'SUPERSEDED' AND superseded_at < $1";
  await tx.query(`DELETE FROM results.line_results WHERE period_result_id IN (SELECT id FROM results.period_results WHERE ${where})`, [before]);
  const res = await tx.query(`DELETE FROM results.period_results WHERE ${where}`, [before]);
  return res.rowCount;
}
