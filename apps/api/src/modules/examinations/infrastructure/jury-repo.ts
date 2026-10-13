/**
 * Dépôt SQL du jury d'un examen blanc : un jury par session blanche, une décision par candidat. Les gardes (examen blanc seulement,
 * jury clos figé, justification de l'écart) sont des déclencheurs et contraintes de la base (migration 2008).
 */
import type { Tx } from "@ecoledigitale/database";
import type { ResultCode } from "../domain/types";

export interface JuryRow {
  id: string;
  sessionId: string;
  status: "OPEN" | "CLOSED";
  heldOn: string | null;
  note: string | null;
  openedBy: string;
  openedAt: Date;
  closedBy: string | null;
  closedAt: Date | null;
}
interface JurySql { id: string; session_id: string; status: "OPEN" | "CLOSED"; held_on: string | null; note: string | null; opened_by: string; opened_at: Date; closed_by: string | null; closed_at: Date | null }
const JURY_COLS = `id, session_id, status, to_char(held_on, 'YYYY-MM-DD') AS held_on, note, opened_by, opened_at, closed_by, closed_at`;
const toJury = (r: JurySql): JuryRow => ({ id: r.id, sessionId: r.session_id, status: r.status, heldOn: r.held_on, note: r.note, openedBy: r.opened_by, openedAt: r.opened_at, closedBy: r.closed_by, closedAt: r.closed_at });

export async function getJuryOfSession(tx: Tx, sessionId: string, options: { forUpdate?: boolean } = {}): Promise<JuryRow | null> {
  const r = await tx.queryOne<JurySql>(`SELECT ${JURY_COLS} FROM examinations.mock_juries WHERE session_id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [sessionId]);
  return r ? toJury(r) : null;
}

export async function insertJury(tx: Tx, tenantId: string, j: { id: string; sessionId: string; heldOn: string | null; note: string | null; openedBy: string }): Promise<JuryRow> {
  const r = await tx.queryOne<JurySql>(
    `INSERT INTO examinations.mock_juries (id, tenant_id, session_id, held_on, note, opened_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${JURY_COLS}`,
    [j.id, tenantId, j.sessionId, j.heldOn, j.note, j.openedBy],
  );
  return toJury(r as JurySql);
}

export async function closeJury(tx: Tx, id: string, by: string): Promise<JuryRow | null> {
  const r = await tx.queryOne<JurySql>(`UPDATE examinations.mock_juries SET status = 'CLOSED', closed_by = $2, closed_at = now() WHERE id = $1 AND status = 'OPEN' RETURNING ${JURY_COLS}`, [id, by]);
  return r ? toJury(r) : null;
}

export interface JuryLine {
  candidateId: string;
  candidateNumber: string | null;
  lastName: string | null;
  firstName: string | null;
  proposedCode: ResultCode;
  average: string | null;
  rank: number | null;
  decision: { finalCode: "ADMITTED" | "FAILED" | "DEFERRED"; justification: string | null; decidedAt: Date; proposedCode: ResultCode } | null;
}
interface LineSql {
  candidate_id: string; candidate_number: string | null; last_name: string | null; first_name: string | null; result_code: ResultCode; average: string | null; rank: number | null;
  final_code: "ADMITTED" | "FAILED" | "DEFERRED" | null; justification: string | null; decided_at: Date | null; decision_proposed: ResultCode | null;
}

/** Candidats ayant un résultat calculé, avec leur décision de jury éventuelle (la proposition affichée est celle de la règle COURANTE). */
export async function listJuryLines(tx: Tx, sessionId: string, juryId: string): Promise<JuryLine[]> {
  const rows = await tx.many<LineSql>(
    `SELECT r.candidate_id, c.candidate_number, c.last_name, c.first_name, r.result_code, r.average::text AS average, r.rank,
            d.final_code, d.justification, d.decided_at, d.proposed_code AS decision_proposed
       FROM examinations.candidate_results r
       JOIN examinations.candidates c ON c.tenant_id = r.tenant_id AND c.id = r.candidate_id
       LEFT JOIN examinations.mock_jury_decisions d ON d.tenant_id = r.tenant_id AND d.candidate_id = r.candidate_id AND d.jury_id = $2
      WHERE r.session_id = $1 AND r.source = 'COMPUTED'
      ORDER BY c.candidate_seq, r.id`,
    [sessionId, juryId],
  );
  return rows.map((r) => ({
    candidateId: r.candidate_id,
    candidateNumber: r.candidate_number,
    lastName: r.last_name,
    firstName: r.first_name,
    proposedCode: r.result_code,
    average: r.average,
    rank: r.rank,
    decision: r.final_code && r.decided_at && r.decision_proposed ? { finalCode: r.final_code, justification: r.justification, decidedAt: r.decided_at, proposedCode: r.decision_proposed } : null,
  }));
}

export async function upsertDecision(
  tx: Tx,
  tenantId: string,
  d: { id: string; sessionId: string; juryId: string; candidateId: string; proposedCode: ResultCode; proposedAverage: string | null; finalCode: "ADMITTED" | "FAILED" | "DEFERRED"; justification: string | null; decidedBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO examinations.mock_jury_decisions (id, tenant_id, session_id, jury_id, candidate_id, proposed_code, proposed_average, final_code, justification, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, jury_id, candidate_id)
     DO UPDATE SET proposed_code = EXCLUDED.proposed_code, proposed_average = EXCLUDED.proposed_average, final_code = EXCLUDED.final_code,
                   justification = EXCLUDED.justification, decided_by = EXCLUDED.decided_by, decided_at = now()`,
    [d.id, tenantId, d.sessionId, d.juryId, d.candidateId, d.proposedCode, d.proposedAverage, d.finalCode, d.justification, d.decidedBy],
  );
}
