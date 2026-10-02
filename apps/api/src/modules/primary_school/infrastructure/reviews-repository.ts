/** Bilans annuels (instantané scellé, versionné) et archives d'année. */
import type { Tx } from "@ecoledigitale/database";
import type { AnnualReview, YearArchive, Uuid } from "../domain/types";
import { ARCHIVE_COLUMNS, REVIEW_COLUMNS, toArchive, toReview } from "./rows";

export async function getReviewRow(tx: Tx, id: Uuid, forUpdate = false): Promise<AnnualReview | null> {
  const r = await tx.queryOne(`SELECT ${REVIEW_COLUMNS} FROM primary_school.annual_reviews v WHERE v.id = $1 ${forUpdate ? "FOR UPDATE OF v" : ""}`, [id]);
  return r ? toReview(r) : null;
}

/** Version VIVANTE (non remplacée) d'une inscription pour une année. */
export async function getLiveReview(tx: Tx, enrollmentId: Uuid, yearId: Uuid, forUpdate = false): Promise<AnnualReview | null> {
  const r = await tx.queryOne(
    `SELECT ${REVIEW_COLUMNS} FROM primary_school.annual_reviews v WHERE v.enrollment_id = $1 AND v.academic_year_id = $2 AND v.status <> 'SUPERSEDED' ${forUpdate ? "FOR UPDATE OF v" : ""}`,
    [enrollmentId, yearId],
  );
  return r ? toReview(r) : null;
}

export async function listReviewRows(tx: Tx, f: { classroomId?: Uuid | undefined; yearId?: Uuid | undefined; status?: AnnualReview["status"] | undefined; studentId?: Uuid | undefined; liveOnly?: boolean | undefined; sealedOnly?: boolean | undefined; limit?: number | undefined }): Promise<AnnualReview[]> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.classroomId) { params.push(f.classroomId); where.push(`v.classroom_id = $${params.length}`); }
  if (f.yearId) { params.push(f.yearId); where.push(`v.academic_year_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`v.status = $${params.length}`); }
  if (f.studentId) { params.push(f.studentId); where.push(`v.student_id = $${params.length}`); }
  if (f.liveOnly) where.push(`v.status <> 'SUPERSEDED'`);
  if (f.sealedOnly) where.push(`v.status = 'SEALED'`);
  params.push(Math.min(f.limit ?? 2000, 5000));
  const rows = await tx.many(`SELECT ${REVIEW_COLUMNS} FROM primary_school.annual_reviews v WHERE ${where.join(" AND ")} ORDER BY v.classroom_id, v.enrollment_id, v.version LIMIT $${params.length}`, params);
  return rows.map(toReview);
}

export async function insertReviewRow(
  tx: Tx,
  v: {
    id: Uuid; tenantId: Uuid; institutionId: Uuid; yearId: Uuid; enrollmentId: Uuid; studentId: Uuid; classroomId: Uuid; gradeLevelCode: string; version: number;
    yearResultRef: Uuid | null; decisionRef: Uuid | null; outcomeCode: string | null; competencySummary: unknown; attendanceSummary: unknown; ruleVersionRef: string | null;
    status?: "DRAFT" | "READY"; supersedesId?: Uuid | null; supersedeReason?: string | null;
  },
): Promise<AnnualReview> {
  const r = await tx.queryOne(
    `INSERT INTO primary_school.annual_reviews (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, grade_level_code, version, status,
        year_result_ref, decision_ref, outcome_code, competency_summary, attendance_summary, rule_version_ref, supersedes_id, supersede_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${REVIEW_COLUMNS.replace(/v\./g, "")}`,
    [
      v.id, v.tenantId, v.institutionId, v.yearId, v.enrollmentId, v.studentId, v.classroomId, v.gradeLevelCode, v.version, v.status ?? "DRAFT",
      v.yearResultRef, v.decisionRef, v.outcomeCode, JSON.stringify(v.competencySummary), JSON.stringify(v.attendanceSummary), v.ruleVersionRef, v.supersedesId ?? null, v.supersedeReason ?? null,
    ],
  );
  return toReview(r);
}

/** Rafraîchit le contenu d'un bilan NON scellé (brouillon / prêt). */
export async function refreshDraftReview(
  tx: Tx,
  id: Uuid,
  v: { classroomId: Uuid; gradeLevelCode: string; yearResultRef: Uuid | null; decisionRef: Uuid | null; outcomeCode: string | null; competencySummary: unknown; attendanceSummary: unknown; ruleVersionRef: string | null },
): Promise<AnnualReview> {
  const r = await tx.queryOne(
    `UPDATE primary_school.annual_reviews v SET classroom_id = $2, grade_level_code = $3, year_result_ref = $4, decision_ref = $5, outcome_code = $6,
        competency_summary = $7, attendance_summary = $8, rule_version_ref = $9, status = 'DRAFT'
      WHERE v.id = $1 RETURNING ${REVIEW_COLUMNS}`,
    [id, v.classroomId, v.gradeLevelCode, v.yearResultRef, v.decisionRef, v.outcomeCode, JSON.stringify(v.competencySummary), JSON.stringify(v.attendanceSummary), v.ruleVersionRef],
  );
  return toReview(r);
}

export async function sealReviewRow(tx: Tx, id: Uuid, s: { contentHash: string; by: Uuid; at: Date; yearResultRef: Uuid | null; decisionRef: Uuid | null; outcomeCode: string | null; competencySummary: unknown; attendanceSummary: unknown; ruleVersionRef: string | null }): Promise<AnnualReview> {
  const r = await tx.queryOne(
    `UPDATE primary_school.annual_reviews v SET status = 'SEALED', content_hash = $2, sealed_by = $3, sealed_at = $4, year_result_ref = $5, decision_ref = $6,
        outcome_code = $7, competency_summary = $8, attendance_summary = $9, rule_version_ref = $10
      WHERE v.id = $1 RETURNING ${REVIEW_COLUMNS}`,
    [id, s.contentHash, s.by, s.at.toISOString(), s.yearResultRef, s.decisionRef, s.outcomeCode, JSON.stringify(s.competencySummary), JSON.stringify(s.attendanceSummary), s.ruleVersionRef],
  );
  return toReview(r);
}

/** `DRAFT` <-> `READY` (un bilan prêt à sceller). Les états scellés sont hors de portée (déclencheur SQL). */
export async function setReviewDraftOrReady(tx: Tx, id: Uuid, status: "DRAFT" | "READY"): Promise<void> {
  await tx.query(`UPDATE primary_school.annual_reviews SET status = $2 WHERE id = $1 AND status IN ('DRAFT','READY') AND status <> $2`, [id, status]);
}

export async function supersedeReviewRow(tx: Tx, id: Uuid): Promise<AnnualReview> {
  const r = await tx.queryOne(`UPDATE primary_school.annual_reviews v SET status = 'SUPERSEDED' WHERE v.id = $1 RETURNING ${REVIEW_COLUMNS}`, [id]);
  return toReview(r);
}

export async function setReviewReportcard(tx: Tx, id: Uuid, reportcardId: Uuid): Promise<boolean> {
  const rows = await tx.many(`UPDATE primary_school.annual_reviews SET reportcard_id = $2 WHERE id = $1 AND status = 'SEALED' AND reportcard_id IS NULL RETURNING id`, [id, reportcardId]);
  return rows.length > 0;
}

export async function deleteStaleDraftReviews(tx: Tx, olderThan: Date): Promise<number> {
  const rows = await tx.many(`DELETE FROM primary_school.annual_reviews WHERE status = 'DRAFT' AND created_at < $1 AND updated_at < $1 RETURNING id`, [olderThan.toISOString()]);
  return rows.length;
}

export async function reviewCounts(tx: Tx, f: { classroomId: Uuid; yearId: Uuid }): Promise<{ total: number; sealed: number }> {
  const r = await tx.queryOne(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'SEALED')::int AS sealed FROM primary_school.annual_reviews WHERE classroom_id = $1 AND academic_year_id = $2 AND status <> 'SUPERSEDED'`,
    [f.classroomId, f.yearId],
  );
  return { total: r?.total ?? 0, sealed: r?.sealed ?? 0 };
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

export async function getArchiveRow(tx: Tx, id: Uuid, forUpdate = false): Promise<YearArchive | null> {
  const r = await tx.queryOne(`SELECT ${ARCHIVE_COLUMNS} FROM primary_school.year_archives y WHERE y.id = $1 ${forUpdate ? "FOR UPDATE OF y" : ""}`, [id]);
  return r ? toArchive(r) : null;
}

export async function getArchiveOf(tx: Tx, institutionId: Uuid, yearId: Uuid, forUpdate = false): Promise<YearArchive | null> {
  const r = await tx.queryOne(`SELECT ${ARCHIVE_COLUMNS} FROM primary_school.year_archives y WHERE y.institution_id = $1 AND y.academic_year_id = $2 ${forUpdate ? "FOR UPDATE OF y" : ""}`, [institutionId, yearId]);
  return r ? toArchive(r) : null;
}

export async function listArchiveRows(tx: Tx, yearId?: Uuid): Promise<YearArchive[]> {
  const rows = await tx.many(`SELECT ${ARCHIVE_COLUMNS} FROM primary_school.year_archives y ${yearId ? "WHERE y.academic_year_id = $1" : ""} ORDER BY y.created_at DESC`, yearId ? [yearId] : []);
  return rows.map(toArchive);
}

export async function insertArchiveRow(tx: Tx, a: { id: Uuid; tenantId: Uuid; institutionId: Uuid; yearId: Uuid }): Promise<YearArchive> {
  const r = await tx.queryOne(
    `INSERT INTO primary_school.year_archives (id, tenant_id, institution_id, academic_year_id) VALUES ($1,$2,$3,$4) RETURNING ${ARCHIVE_COLUMNS.replace(/y\./g, "")}`,
    [a.id, a.tenantId, a.institutionId, a.yearId],
  );
  return toArchive(r);
}

/** Met à jour le comptage et, si possible, le manifeste ; l'état passe `PREPARING` -> `READY` seulement si `ready`. */
export async function updateArchiveRow(
  tx: Tx,
  id: Uuid,
  u: { reviewsTotal: number; reviewsSealed: number; manifest: unknown | null; manifestHash: string | null; status: "PREPARING" | "READY"; preparedBy: Uuid | null; preparedAt: Date },
): Promise<YearArchive> {
  const r = await tx.queryOne(
    `UPDATE primary_school.year_archives y SET reviews_total = $2, reviews_sealed = $3, manifest = $4, manifest_hash = $5, status = $6, prepared_by = $7, prepared_at = $8
      WHERE y.id = $1 RETURNING ${ARCHIVE_COLUMNS}`,
    [id, u.reviewsTotal, u.reviewsSealed, u.manifest === null ? null : JSON.stringify(u.manifest), u.manifestHash, u.status, u.preparedBy, u.preparedAt.toISOString()],
  );
  return toArchive(r);
}

export async function freezeArchiveRow(tx: Tx, id: Uuid, by: Uuid, at: Date): Promise<YearArchive> {
  const r = await tx.queryOne(`UPDATE primary_school.year_archives y SET status = 'FROZEN', frozen_by = $2, frozen_at = $3 WHERE y.id = $1 RETURNING ${ARCHIVE_COLUMNS}`, [id, by, at.toISOString()]);
  return toArchive(r);
}
