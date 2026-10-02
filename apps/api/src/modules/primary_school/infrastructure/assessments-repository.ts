/** Évaluation par compétences : lignes, révisions, synthèse (fonction SQL `summarize_competencies`), verrous de période. */
import type { Tx } from "@ecoledigitale/database";
import type { CompetencyAssessment, CompetencyRevision, Uuid } from "../domain/types";
import { ASSESSMENT_COLUMNS, REVISION_COLUMNS, toAssessment, toRevision } from "./rows";

export async function listAssessmentsOfClass(tx: Tx, f: { classroomId: Uuid; periodId: Uuid; frameworkId?: Uuid | undefined }): Promise<CompetencyAssessment[]> {
  const params: unknown[] = [f.classroomId, f.periodId];
  let extra = "";
  if (f.frameworkId) {
    params.push(f.frameworkId);
    extra = `AND a.framework_id = $3`;
  }
  const rows = await tx.many(
    `SELECT ${ASSESSMENT_COLUMNS} FROM primary_school.competency_assessments a WHERE a.classroom_id = $1 AND a.academic_period_id = $2 ${extra} ORDER BY a.enrollment_id, a.competency_id`,
    params,
  );
  return rows.map(toAssessment);
}

export async function getAssessmentRow(tx: Tx, id: Uuid, forUpdate = false): Promise<CompetencyAssessment | null> {
  const r = await tx.queryOne(`SELECT ${ASSESSMENT_COLUMNS} FROM primary_school.competency_assessments a WHERE a.id = $1 ${forUpdate ? "FOR UPDATE OF a" : ""}`, [id]);
  return r ? toAssessment(r) : null;
}

export interface InsertAssessment {
  id: Uuid;
  tenantId: Uuid;
  classroomId: Uuid;
  periodId: Uuid;
  enrollmentId: Uuid;
  studentId: Uuid;
  frameworkId: Uuid;
  competencyId: Uuid;
  scaleId: Uuid;
  ratingLevelId: Uuid;
  observedOn: string;
  staffId: Uuid;
  note: string | null;
}

export async function insertAssessmentRow(tx: Tx, a: InsertAssessment): Promise<void> {
  await tx.query(
    `INSERT INTO primary_school.competency_assessments (id, tenant_id, classroom_id, academic_period_id, enrollment_id, student_id, framework_id, competency_id, scale_id, rating_level_id, observed_on, recorded_by_staff_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [a.id, a.tenantId, a.classroomId, a.periodId, a.enrollmentId, a.studentId, a.frameworkId, a.competencyId, a.scaleId, a.ratingLevelId, a.observedOn, a.staffId, a.note],
  );
}

/** Met à jour une ligne en BROUILLON (le verrou de ligne a déjà été pris par l'appelant). */
export async function updateDraftAssessment(tx: Tx, id: Uuid, p: { ratingLevelId: Uuid; observedOn: string; note: string | null; staffId: Uuid }): Promise<void> {
  await tx.query(`UPDATE primary_school.competency_assessments SET rating_level_id = $2, observed_on = $3, note = $4, recorded_by_staff_id = $5 WHERE id = $1`, [id, p.ratingLevelId, p.observedOn, p.note, p.staffId]);
}

export async function validateClassPeriod(tx: Tx, f: { classroomId: Uuid; periodId: Uuid; frameworkId?: Uuid | undefined; by: Uuid; now: Date }): Promise<number> {
  const params: unknown[] = [f.classroomId, f.periodId, f.by, f.now.toISOString()];
  let extra = "";
  if (f.frameworkId) {
    params.push(f.frameworkId);
    extra = `AND framework_id = $5`;
  }
  const rows = await tx.many(
    `UPDATE primary_school.competency_assessments SET status = 'VALIDATED', validated_by = $3, validated_at = $4
      WHERE classroom_id = $1 AND academic_period_id = $2 AND status = 'DRAFT' ${extra} RETURNING id`,
    params,
  );
  return rows.length;
}

export async function countByStatus(tx: Tx, f: { classroomId: Uuid; periodId: Uuid; frameworkId?: Uuid | undefined }): Promise<{ draft: number; validated: number }> {
  const params: unknown[] = [f.classroomId, f.periodId];
  let extra = "";
  if (f.frameworkId) {
    params.push(f.frameworkId);
    extra = `AND framework_id = $3`;
  }
  const r = await tx.queryOne(
    `SELECT count(*) FILTER (WHERE status = 'DRAFT')::int AS draft, count(*) FILTER (WHERE status = 'VALIDATED')::int AS validated
       FROM primary_school.competency_assessments WHERE classroom_id = $1 AND academic_period_id = $2 ${extra}`,
    params,
  );
  return { draft: r?.draft ?? 0, validated: r?.validated ?? 0 };
}

export async function insertRevisionRow(tx: Tx, r: { id: Uuid; tenantId: Uuid; assessmentId: Uuid; fromLevelId: Uuid; toLevelId: Uuid; reason: string; requestedBy: Uuid }): Promise<CompetencyRevision> {
  const row = await tx.queryOne(
    `INSERT INTO primary_school.competency_revisions (id, tenant_id, assessment_id, from_level_id, to_level_id, reason, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, assessment_id, from_level_id, to_level_id, reason, requested_by, created_at`,
    [r.id, r.tenantId, r.assessmentId, r.fromLevelId, r.toLevelId, r.reason, r.requestedBy],
  );
  return toRevision(row);
}

/** Applique la correction d'une appréciation validée : la révision a été insérée AVANT, dans la même transaction. */
export async function applyRevision(tx: Tx, id: Uuid, toLevelId: Uuid): Promise<CompetencyAssessment> {
  const r = await tx.queryOne(`UPDATE primary_school.competency_assessments a SET rating_level_id = $2 WHERE a.id = $1 RETURNING ${ASSESSMENT_COLUMNS}`, [id, toLevelId]);
  return toAssessment(r);
}

export async function listRevisionsOf(tx: Tx, assessmentId: Uuid): Promise<CompetencyRevision[]> {
  const rows = await tx.many(`SELECT ${REVISION_COLUMNS} FROM primary_school.competency_revisions r WHERE r.assessment_id = $1 ORDER BY r.created_at, r.id`, [assessmentId]);
  return rows.map(toRevision);
}

/** Synthèse par COMPTEURS (fonction SQL) : `{ domaine: { niveau: n } }` sur les lignes validées. */
export async function summarizeInSql(tx: Tx, enrollmentId: Uuid, periodIds: readonly Uuid[] | null): Promise<Record<string, Record<string, number>>> {
  const r = await tx.queryOne(`SELECT primary_school.summarize_competencies($1::uuid, $2::uuid[]) AS s`, [enrollmentId, periodIds && periodIds.length > 0 ? periodIds : null]);
  return (r?.s as Record<string, Record<string, number>>) ?? {};
}

export async function summaryRowsOf(tx: Tx, enrollmentId: Uuid, periodIds: readonly Uuid[] | null): Promise<Array<{ domainCode: string; levelCode: string; status: "DRAFT" | "VALIDATED" }>> {
  const rows = await tx.many(
    `SELECT d.code AS domain_code, l.code AS level_code, a.status
       FROM primary_school.competency_assessments a
       JOIN primary_school.competencies c ON c.tenant_id = a.tenant_id AND c.id = a.competency_id
       JOIN primary_school.competency_domains d ON d.tenant_id = c.tenant_id AND d.id = c.domain_id
       JOIN primary_school.rating_levels l ON l.tenant_id = a.tenant_id AND l.id = a.rating_level_id
      WHERE a.enrollment_id = $1 AND ($2::uuid[] IS NULL OR a.academic_period_id = ANY($2::uuid[]))`,
    [enrollmentId, periodIds && periodIds.length > 0 ? periodIds : null],
  );
  return rows.map((r) => ({ domainCode: r.domain_code, levelCode: r.level_code, status: r.status }));
}

/** Libellés (code -> libellé) des domaines et des niveaux concernés par les lignes d'une inscription (affichage de la synthèse). */
export async function labelsOfEnrollment(tx: Tx, enrollmentId: Uuid): Promise<{ domains: Record<string, string>; levels: Array<{ code: string; label: string; ordinal: number }> }> {
  const domains = await tx.many(
    `SELECT DISTINCT d.code, d.label FROM primary_school.competency_assessments a
       JOIN primary_school.competencies c ON c.tenant_id = a.tenant_id AND c.id = a.competency_id
       JOIN primary_school.competency_domains d ON d.tenant_id = c.tenant_id AND d.id = c.domain_id
      WHERE a.enrollment_id = $1`,
    [enrollmentId],
  );
  const levels = await tx.many(
    `SELECT DISTINCT l.code, l.label, l.ordinal FROM primary_school.competency_assessments a
       JOIN primary_school.rating_levels l ON l.tenant_id = a.tenant_id AND l.id = a.rating_level_id
      WHERE a.enrollment_id = $1 ORDER BY l.ordinal`,
    [enrollmentId],
  );
  return { domains: Object.fromEntries(domains.map((d) => [d.code, d.label])), levels: levels.map((l) => ({ code: l.code, label: l.label, ordinal: l.ordinal })) };
}

// ---------------------------------------------------------------------------
// Verrous de période (miroir des événements academic)
// ---------------------------------------------------------------------------

export async function upsertPeriodLock(tx: Tx, l: { tenantId: Uuid; classroomId: Uuid; periodId: Uuid; status: "LOCKED" | "OPEN"; sourceEventId: Uuid | null; at: Date }): Promise<void> {
  await tx.query(
    `INSERT INTO primary_school.period_locks (tenant_id, classroom_id, academic_period_id, status, changed_at, source_event_id) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, classroom_id, academic_period_id) DO UPDATE SET status = EXCLUDED.status, changed_at = EXCLUDED.changed_at, source_event_id = EXCLUDED.source_event_id
       WHERE primary_school.period_locks.changed_at <= EXCLUDED.changed_at`,
    [l.tenantId, l.classroomId, l.periodId, l.status, l.at.toISOString(), l.sourceEventId],
  );
}

export async function getPeriodLock(tx: Tx, classroomId: Uuid, periodId: Uuid): Promise<"LOCKED" | "OPEN" | null> {
  const r = await tx.queryOne(`SELECT status FROM primary_school.period_locks WHERE classroom_id = $1 AND academic_period_id = $2`, [classroomId, periodId]);
  return (r?.status as "LOCKED" | "OPEN" | undefined) ?? null;
}

/** Aligne le miroir local sur l'état effectif lu auprès d'academic (défense en profondeur avant une écriture). */
export async function syncPeriodLock(tx: Tx, l: { tenantId: Uuid; classroomId: Uuid; periodId: Uuid; locked: boolean; now: Date }): Promise<void> {
  await tx.query(
    `INSERT INTO primary_school.period_locks (tenant_id, classroom_id, academic_period_id, status, changed_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, classroom_id, academic_period_id) DO UPDATE SET status = EXCLUDED.status, changed_at = EXCLUDED.changed_at WHERE primary_school.period_locks.status <> EXCLUDED.status`,
    [l.tenantId, l.classroomId, l.periodId, l.locked ? "LOCKED" : "OPEN", l.now.toISOString()],
  );
}
