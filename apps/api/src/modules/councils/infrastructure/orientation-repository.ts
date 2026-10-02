/**
 * Orientation : parcours autorisés (VIDE par défaut), dossiers, vœux, transferts de série. Les séries, options et langues sont des
 * données d'`academic` (identifiants) : aucune liste n'est figée ici.
 */
import type { Tx } from "@ecoledigitale/database";
import type { OrientationFileRow, OrientationPathRow, TransferRow, WishRow } from "./rows";

// ---------------------------------------------------------------------------------------------------------------------
// Parcours autorisés
// ---------------------------------------------------------------------------------------------------------------------

const PATH_COLS = `id, institution_id AS "institutionId", kind, from_program_id AS "fromProgramId", from_grade_level_id AS "fromGradeLevelId",
  to_program_id AS "toProgramId", to_grade_level_id AS "toGradeLevelId", label, requires_council_opinion AS "requiresCouncilOpinion",
  requires_guardian_consent AS "requiresGuardianConsent", active, source_kind AS "sourceKind"`;

export const listPaths = (tx: Tx, options: { activeOnly?: boolean } = {}): Promise<OrientationPathRow[]> =>
  tx.many<OrientationPathRow>(`SELECT ${PATH_COLS} FROM councils.orientation_paths${options.activeOnly ? " WHERE active" : ""} ORDER BY kind, from_grade_level_id, to_grade_level_id, id`);
export const getPath = (tx: Tx, id: string): Promise<OrientationPathRow | null> => tx.queryOne<OrientationPathRow>(`SELECT ${PATH_COLS} FROM councils.orientation_paths WHERE id = $1`, [id]);

/** Parcours actif qui autorise ce passage (série de départ précise, ou « toute série » = NULL). */
export const findMatchingPath = (tx: Tx, m: { fromProgramId: string | null; fromGradeLevelId: string; toProgramId: string; toGradeLevelId: string; institutionId: string }): Promise<OrientationPathRow | null> =>
  tx.queryOne<OrientationPathRow>(
    `SELECT ${PATH_COLS} FROM councils.orientation_paths
      WHERE active AND from_grade_level_id = $2 AND to_program_id = $3 AND to_grade_level_id = $4
        AND (from_program_id IS NULL OR from_program_id = $1) AND (institution_id IS NULL OR institution_id = $5)
      ORDER BY (from_program_id IS NULL), id LIMIT 1`,
    [m.fromProgramId, m.fromGradeLevelId, m.toProgramId, m.toGradeLevelId, m.institutionId],
  );

export type PathValues = Omit<OrientationPathRow, "id">;

export async function upsertPath(tx: Tx, tenantId: string, id: string, v: PathValues): Promise<OrientationPathRow> {
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM councils.orientation_paths
      WHERE coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND kind = $2 AND coalesce(from_program_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND from_grade_level_id = $4 AND to_program_id = $5 AND to_grade_level_id = $6`,
    [v.institutionId, v.kind, v.fromProgramId, v.fromGradeLevelId, v.toProgramId, v.toGradeLevelId],
  );
  if (existing) {
    await tx.query(
      `UPDATE councils.orientation_paths SET label = $2, requires_council_opinion = $3, requires_guardian_consent = $4, active = $5, source_kind = $6, updated_at = now() WHERE id = $1`,
      [existing.id, v.label, v.requiresCouncilOpinion, v.requiresGuardianConsent, v.active, v.sourceKind],
    );
    return (await getPath(tx, existing.id)) as OrientationPathRow;
  }
  await tx.query(
    `INSERT INTO councils.orientation_paths (id, tenant_id, institution_id, kind, from_program_id, from_grade_level_id, to_program_id, to_grade_level_id, label,
        requires_council_opinion, requires_guardian_consent, active, source_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, tenantId, v.institutionId, v.kind, v.fromProgramId, v.fromGradeLevelId, v.toProgramId, v.toGradeLevelId, v.label, v.requiresCouncilOpinion, v.requiresGuardianConsent, v.active, v.sourceKind],
  );
  return (await getPath(tx, id)) as OrientationPathRow;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dossiers et vœux
// ---------------------------------------------------------------------------------------------------------------------

const FILE_COLS = `id, institution_id AS "institutionId", academic_year_id AS "academicYearId", enrollment_id AS "enrollmentId", student_id AS "studentId",
  current_program_id AS "currentProgramId", current_grade_level_id AS "currentGradeLevelId", status, guardian_consent AS "guardianConsent",
  consent_recorded_by AS "consentRecordedBy", consent_recorded_at AS "consentRecordedAt", decision_id AS "decisionId", notes, created_at AS "createdAt"`;

export const getFile = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<OrientationFileRow | null> =>
  tx.queryOne<OrientationFileRow>(`SELECT ${FILE_COLS} FROM councils.orientation_files WHERE id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
export const getFileByEnrollment = (tx: Tx, enrollmentId: string): Promise<OrientationFileRow | null> =>
  tx.queryOne<OrientationFileRow>(`SELECT ${FILE_COLS} FROM councils.orientation_files WHERE enrollment_id = $1`, [enrollmentId]);

export async function listFiles(tx: Tx, f: { academicYearId?: string | undefined; status?: string | undefined; studentId?: string | undefined }, page: { limit: number; offset: number }): Promise<{ rows: OrientationFileRow[]; total: number }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (f.academicYearId) add("academic_year_id = ?", f.academicYearId);
  if (f.status) add("status = ?", f.status);
  if (f.studentId) add("student_id = ?", f.studentId);
  const w = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await tx.many<OrientationFileRow>(`SELECT ${FILE_COLS} FROM councils.orientation_files ${w} ORDER BY created_at DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, page.limit, page.offset]);
  const total = (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM councils.orientation_files ${w}`, params))?.n ?? 0;
  return { rows, total };
}

export async function insertFile(tx: Tx, f: { id: string; tenantId: string; institutionId: string; academicYearId: string; enrollmentId: string; studentId: string; currentProgramId: string; currentGradeLevelId: string; notes: string | null; createdBy: string }): Promise<void> {
  await tx.query(
    `INSERT INTO councils.orientation_files (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, current_program_id, current_grade_level_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [f.id, f.tenantId, f.institutionId, f.academicYearId, f.enrollmentId, f.studentId, f.currentProgramId, f.currentGradeLevelId, f.notes, f.createdBy],
  );
}

export async function updateFile(tx: Tx, id: string, p: { status?: string | undefined; guardianConsent?: string | undefined; consentRecordedBy?: string | null | undefined; consentRecordedAt?: Date | null | undefined; decisionId?: string | null | undefined }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (p.status !== undefined) add("status", p.status);
  if (p.guardianConsent !== undefined) add("guardian_consent", p.guardianConsent);
  if (p.consentRecordedBy !== undefined) add("consent_recorded_by", p.consentRecordedBy);
  if (p.consentRecordedAt !== undefined) add("consent_recorded_at", p.consentRecordedAt);
  if (p.decisionId !== undefined) add("decision_id", p.decisionId);
  if (sets.length === 0) return;
  await tx.query(`UPDATE councils.orientation_files SET ${sets.join(", ")} WHERE id = $1`, params);
}

const WISH_COLS = `id, file_id AS "fileId", rank, to_program_id AS "toProgramId", to_grade_level_id AS "toGradeLevelId", option_ids AS "optionIds", source,
  expressed_by AS "expressedBy", expressed_at AS "expressedAt", comment, withdrawn_at AS "withdrawnAt"`;

export const listWishes = (tx: Tx, fileIds: readonly string[]): Promise<WishRow[]> =>
  fileIds.length === 0 ? Promise.resolve([]) : tx.many<WishRow>(`SELECT ${WISH_COLS} FROM councils.orientation_wishes WHERE file_id = ANY($1::uuid[]) ORDER BY rank, expressed_at, id`, [fileIds]);

export const insertWish = (tx: Tx, w: { id: string; tenantId: string; fileId: string; rank: number; toProgramId: string; toGradeLevelId: string; optionIds: readonly string[]; source: string; expressedBy: string; comment: string | null }): Promise<unknown> =>
  tx.query(
    `INSERT INTO councils.orientation_wishes (id, tenant_id, file_id, rank, to_program_id, to_grade_level_id, option_ids, source, expressed_by, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
    [w.id, w.tenantId, w.fileId, w.rank, w.toProgramId, w.toGradeLevelId, JSON.stringify(w.optionIds), w.source, w.expressedBy, w.comment],
  );

/** Un vœu se retire (il n'est jamais supprimé) : il libère son rang. */
export const withdrawWishAtRank = (tx: Tx, fileId: string, rank: number, at: Date): Promise<unknown> => tx.query("UPDATE councils.orientation_wishes SET withdrawn_at = $3 WHERE file_id = $1 AND rank = $2 AND withdrawn_at IS NULL", [fileId, rank, at]);

// ---------------------------------------------------------------------------------------------------------------------
// Transferts de série
// ---------------------------------------------------------------------------------------------------------------------

const TR_COLS = `id, institution_id AS "institutionId", enrollment_id AS "enrollmentId", student_id AS "studentId", from_program_id AS "fromProgramId",
  from_grade_level_id AS "fromGradeLevelId", to_program_id AS "toProgramId", to_grade_level_id AS "toGradeLevelId", effective_kind AS "effectiveKind",
  effective_on::text AS "effectiveOn", decided_via AS "decidedVia", decision_id AS "decisionId", act_reference AS "actReference", act_issued_by AS "actIssuedBy",
  path_id AS "pathId", path_override_reason AS "pathOverrideReason", status, applied_at AS "appliedAt", applied_ref AS "appliedRef", last_error AS "lastError",
  cancel_reason AS "cancelReason", created_at AS "createdAt"`;

export const getTransfer = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<TransferRow | null> =>
  tx.queryOne<TransferRow>(`SELECT ${TR_COLS} FROM councils.series_transfers WHERE id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
export const listTransfers = (tx: Tx, f: { enrollmentId?: string | undefined; status?: string | undefined } = {}): Promise<TransferRow[]> =>
  tx.many<TransferRow>(`SELECT ${TR_COLS} FROM councils.series_transfers WHERE ($1::uuid IS NULL OR enrollment_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC, id LIMIT 500`, [f.enrollmentId ?? null, f.status ?? null]);
export const findLiveTransferOfDecision = (tx: Tx, decisionId: string): Promise<TransferRow | null> =>
  tx.queryOne<TransferRow>(`SELECT ${TR_COLS} FROM councils.series_transfers WHERE decision_id = $1 AND status IN ('PLANNED','APPLIED') ORDER BY created_at LIMIT 1`, [decisionId]);

export async function insertTransfer(
  tx: Tx,
  t: {
    id: string;
    tenantId: string;
    institutionId: string;
    enrollmentId: string;
    studentId: string;
    fromProgramId: string;
    fromGradeLevelId: string;
    toProgramId: string;
    toGradeLevelId: string;
    effectiveKind: string;
    effectiveOn: string | null;
    decidedVia: string;
    decisionId: string | null;
    actReference: string | null;
    actIssuedBy: string | null;
    pathId: string | null;
    pathOverrideReason: string | null;
    pathOverrideBy: string | null;
    createdBy: string;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO councils.series_transfers (id, tenant_id, institution_id, enrollment_id, student_id, from_program_id, from_grade_level_id, to_program_id, to_grade_level_id,
        effective_kind, effective_on, decided_via, decision_id, act_reference, act_issued_by, path_id, path_override_reason, path_override_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [t.id, t.tenantId, t.institutionId, t.enrollmentId, t.studentId, t.fromProgramId, t.fromGradeLevelId, t.toProgramId, t.toGradeLevelId, t.effectiveKind, t.effectiveOn, t.decidedVia, t.decisionId, t.actReference, t.actIssuedBy, t.pathId, t.pathOverrideReason, t.pathOverrideBy, t.createdBy],
  );
}

export const markTransferApplied = (tx: Tx, id: string, ref: string, at: Date): Promise<unknown> => tx.query("UPDATE councils.series_transfers SET status = 'APPLIED', applied_at = $3, applied_ref = $2, last_error = NULL WHERE id = $1", [id, ref, at]);
export const markTransferFailed = (tx: Tx, id: string, error: string): Promise<unknown> => tx.query("UPDATE councils.series_transfers SET status = 'FAILED', last_error = $2 WHERE id = $1", [id, error.slice(0, 1000)]);
export const requeueTransfer = (tx: Tx, id: string): Promise<unknown> => tx.query("UPDATE councils.series_transfers SET status = 'PLANNED' WHERE id = $1", [id]);
export const cancelTransfer = (tx: Tx, id: string, reason: string): Promise<unknown> => tx.query("UPDATE councils.series_transfers SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1", [id, reason]);
