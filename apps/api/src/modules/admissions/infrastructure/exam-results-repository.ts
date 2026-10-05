/**
 * Dépôt SQL des résultats d'examen reçus de `examinations` (Q-E18) : réception idempotente et ordonnée par version, lecture par
 * dossier de candidature (élève lié ou rapprochement CONFIRMÉ seulement). SQL paramétré uniquement ; aucune donnée nominative.
 */
import type { Tx } from "@ecoledigitale/database";
import { ts } from "./sql";

export interface ExamResultRow {
  readonly id: string;
  readonly studentId: string;
  readonly examTypeCode: string;
  readonly sessionYear: number;
  readonly outcome: "ADMITTED" | "FAILED" | "ABSENT" | "EXCLUDED" | "DEFERRED";
  readonly admitted: boolean;
  /** Décimal exact en chaîne (`numeric(7,3)`), ou `null` (absent, exclu, ajourné ou moyenne non transmise). */
  readonly average: string | null;
  readonly revision: number;
  readonly receivedAt: string;
  readonly matchedBy: "STUDENT" | "CONFIRMED_DUPLICATE";
}

export interface ReceivedExamResult {
  readonly id: string;
  readonly institutionId: string;
  readonly studentId: string;
  readonly sourceCandidateId: string;
  readonly sourceResultId: string;
  readonly examTypeCode: string;
  readonly sessionYear: number;
  readonly outcome: ExamResultRow["outcome"];
  readonly admitted: boolean;
  readonly average: string | null;
  readonly revision: number;
  readonly sourceEventId: string;
}

/**
 * Range le résultat reçu. IDEMPOTENT et ORDONNÉ : une version plus grande remplace la ligne, une version égale ou plus petite
 * (événement rejoué ou tardif) ne change RIEN. Rend `true` quand la ligne a été créée ou remplacée.
 */
export async function upsertReceivedResult(tx: Tx, tenantId: string, r: ReceivedExamResult): Promise<boolean> {
  const row = await tx.queryOne<{ id: string }>(
    `INSERT INTO admissions.exam_results (id, tenant_id, institution_id, student_id, source_candidate_id, source_result_id, exam_type_code, session_year, outcome, admitted, average, revision, source_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12, $13)
     ON CONFLICT (tenant_id, source_result_id) DO UPDATE
       SET outcome = EXCLUDED.outcome, admitted = EXCLUDED.admitted, average = EXCLUDED.average, revision = EXCLUDED.revision, source_event_id = EXCLUDED.source_event_id
     WHERE admissions.exam_results.revision < EXCLUDED.revision
     RETURNING id`,
    [r.id, tenantId, r.institutionId, r.studentId, r.sourceCandidateId, r.sourceResultId, r.examTypeCode, r.sessionYear, r.outcome, r.admitted, r.average, r.revision, r.sourceEventId],
  );
  return row !== null;
}

/**
 * Résultats d'examen d'un dossier : ceux de SON élève (`applications.student_id`) et ceux d'un élève RAPPROCHÉ ET CONFIRMÉ par une
 * personne (`duplicate_candidates.status = 'CONFIRMED_DUPLICATE'`). Un rapprochement seulement ouvert ne donne jamais accès.
 */
export async function listForApplication(tx: Tx, applicationId: string): Promise<ExamResultRow[]> {
  const rows = await tx.many<{
    id: string; student_id: string; exam_type_code: string; session_year: number; outcome: ExamResultRow["outcome"]; admitted: boolean; average: string | null; revision: number; received_at: string; matched_by: ExamResultRow["matchedBy"];
  }>(
    `SELECT r.id, r.student_id, r.exam_type_code, r.session_year, r.outcome, r.admitted, r.average::text AS average, r.revision, ${ts("r.received_at", "received_at")},
            CASE WHEN a.student_id = r.student_id THEN 'STUDENT' ELSE 'CONFIRMED_DUPLICATE' END AS matched_by
       FROM admissions.applications a
       JOIN admissions.exam_results r ON r.tenant_id = a.tenant_id
      WHERE a.id = $1
        AND (r.student_id = a.student_id
             OR r.student_id IN (SELECT d.matched_id FROM admissions.duplicate_candidates d
                                  WHERE d.tenant_id = a.tenant_id AND d.application_id = a.id AND d.matched_kind = 'STUDENT' AND d.status = 'CONFIRMED_DUPLICATE'))
      ORDER BY r.session_year DESC, r.exam_type_code, r.received_at DESC, r.id`,
    [applicationId],
  );
  return rows.map((r) => ({
    id: r.id, studentId: r.student_id, examTypeCode: r.exam_type_code, sessionYear: r.session_year, outcome: r.outcome, admitted: r.admitted, average: r.average,
    revision: r.revision, receivedAt: r.received_at, matchedBy: r.matched_by,
  }));
}

export async function applicationExists(tx: Tx, applicationId: string): Promise<boolean> {
  return (await tx.queryOne<{ n: number }>(`SELECT 1 AS n FROM admissions.applications WHERE id = $1`, [applicationId])) !== null;
}
