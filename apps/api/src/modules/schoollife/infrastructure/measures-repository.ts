/**
 * Mesures (sanctions, avertissements, exclusions temporaires), recours, effets d'exclusion. Visibilité : fonction SQL unique
 * `schoollife.audience_may_see`. Le circuit (validation, quatre yeux, recours, chevauchement) est imposé par les déclencheurs.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AppealRow, EffectRow, MeasureRow } from "./rows";

const COLS = `m.id, m.institution_id AS "institutionId", m.academic_year_id AS "academicYearId", m.enrollment_id AS "enrollmentId", m.student_id AS "studentId",
  m.classroom_id AS "classroomId", m.type_id AS "typeId", m.kind, m.incident_id AS "incidentId", m.severity_code AS "severityCode", m.reason,
  m.starts_on::text AS "startsOn", m.ends_on::text AS "endsOn", m.status, m.proposed_by AS "proposedBy", m.proposed_by_name AS "proposedByName",
  m.proposed_at AS "proposedAt", m.validated_by AS "validatedBy", m.validated_by_name AS "validatedByName", m.validated_at AS "validatedAt",
  m.validation_note AS "validationNote", m.notified_at AS "notifiedAt", m.notification_ref AS "notificationRef", m.executed_at AS "executedAt",
  m.revoked_at AS "revokedAt", m.revoked_reason AS "revokedReason", m.cancel_reason AS "cancelReason", m.visible_to_guardians AS "visibleToGuardians",
  m.confidentiality`;

export interface NewMeasure {
  id: string;
  tenantId: string;
  institutionId: string;
  academicYearId: string;
  enrollmentId: string;
  studentId: string;
  classroomId: string | null;
  typeId: string;
  /** Recopiée du type par la base ; fournie pour satisfaire la contrainte NOT NULL de l'INSERT. */
  kind: string;
  incidentId: string | null;
  severityCode: string | null;
  reason: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "PROPOSED" | "VALIDATED";
  proposedBy: string;
  proposedByName: string;
  /** Avertissement validé d'emblée : le nom du validateur est celui du proposant. */
  validatedByName: string | null;
  visibleToGuardians: boolean;
  confidentiality: string;
}

export async function insertMeasure(tx: Tx, m: NewMeasure): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.measures (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, classroom_id, type_id, kind, incident_id, severity_code,
        reason, starts_on, ends_on, status, proposed_by, proposed_by_name, validated_by_name, visible_to_guardians, confidentiality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15,$16,$17,$18,$19,$20)`,
    [m.id, m.tenantId, m.institutionId, m.academicYearId, m.enrollmentId, m.studentId, m.classroomId, m.typeId, m.kind, m.incidentId, m.severityCode, m.reason, m.startsOn, m.endsOn, m.status, m.proposedBy, m.proposedByName, m.validatedByName, m.visibleToGuardians, m.confidentiality],
  );
}

export const getMeasure = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<MeasureRow | null> =>
  tx.queryOne<MeasureRow>(`SELECT ${COLS} FROM schoollife.measures m WHERE m.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export interface MeasureFilter {
  audience: string;
  status?: string | undefined;
  kind?: string | undefined;
  studentId?: string | undefined;
  enrollmentIds?: readonly string[] | undefined;
  proposedBy?: string | undefined;
  pendingOnly?: boolean | undefined;
  activeOn?: string | undefined;
  /** Famille/élève : ne retourne que ce que `audience_may_see` autorise (pas de filtre de statut libre). */
  limit: number;
  offset: number;
}

export async function listMeasures(tx: Tx, f: MeasureFilter): Promise<MeasureRow[]> {
  const where: string[] = [`schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)`];
  const params: unknown[] = [f.audience];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("m.status = ?", f.status);
  if (f.kind) add("m.kind = ?", f.kind);
  if (f.studentId) add("m.student_id = ?", f.studentId);
  if (f.enrollmentIds) add("m.enrollment_id = ANY(?::uuid[])", f.enrollmentIds);
  if (f.proposedBy) add("m.proposed_by = ?", f.proposedBy);
  if (f.pendingOnly) where.push(`m.status = 'PROPOSED'`);
  if (f.activeOn) {
    params.push(f.activeOn);
    const p = `$${params.length}::date`;
    where.push(`m.kind = 'TEMP_EXCLUSION' AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED') AND m.starts_on <= ${p} AND m.ends_on >= ${p}`);
  }
  params.push(f.limit, f.offset);
  return tx.many<MeasureRow>(
    `SELECT ${COLS} FROM schoollife.measures m WHERE ${where.join(" AND ")} ORDER BY m.proposed_at DESC, m.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export interface MeasureUpdate {
  status?: string;
  validatedByName?: string | null;
  validationNote?: string | null;
  notificationRef?: string | null;
  revokedReason?: string | null;
  cancelReason?: string | null;
}

export async function updateMeasure(tx: Tx, id: string, u: MeasureUpdate): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (u.status !== undefined) set("status", u.status);
  if (u.validatedByName !== undefined) set("validated_by_name", u.validatedByName);
  if (u.validationNote !== undefined) set("validation_note", u.validationNote);
  if (u.notificationRef !== undefined) set("notification_ref", u.notificationRef);
  if (u.revokedReason !== undefined) set("revoked_reason", u.revokedReason);
  if (u.cancelReason !== undefined) set("cancel_reason", u.cancelReason);
  if (sets.length === 0) return;
  await tx.query(`UPDATE schoollife.measures SET ${sets.join(", ")} WHERE id = $1`, params);
}

/** Exclusion en vigueur à une date pour une inscription (réponse à `isStudentExcludedOn`). */
export async function isExcludedOn(tx: Tx, enrollmentId: string, on: string): Promise<boolean> {
  const row = await tx.queryOne<{ n: number }>(
    `SELECT 1 AS n FROM schoollife.measures WHERE enrollment_id = $1 AND kind = 'TEMP_EXCLUSION' AND status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
        AND starts_on <= $2::date AND ends_on >= $2::date LIMIT 1`,
    [enrollmentId, on],
  );
  return row !== null;
}

// ---------------------------------------------------------------------------
// Recours
// ---------------------------------------------------------------------------

const APPEAL_COLS = `a.id, a.measure_id AS "measureId", a.filed_by AS "filedBy", a.filed_by_name AS "filedByName", a.filed_at AS "filedAt", a.reason, a.status,
  a.decided_by AS "decidedBy", a.decided_by_name AS "decidedByName", a.decided_at AS "decidedAt", a.decision_note AS "decisionNote"`;

export async function insertAppeal(tx: Tx, v: { id: string; tenantId: string; measureId: string; filedBy: string; filedByName: string; reason: string }): Promise<void> {
  await tx.query(`INSERT INTO schoollife.measure_appeals (id, tenant_id, measure_id, filed_by, filed_by_name, reason) VALUES ($1,$2,$3,$4,$5,$6)`, [v.id, v.tenantId, v.measureId, v.filedBy, v.filedByName, v.reason]);
}

export const getAppeal = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<AppealRow | null> =>
  tx.queryOne<AppealRow>(`SELECT ${APPEAL_COLS} FROM schoollife.measure_appeals a WHERE a.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export const listAppealsOf = (tx: Tx, measureIds: readonly string[]): Promise<AppealRow[]> =>
  measureIds.length === 0 ? Promise.resolve([]) : tx.many<AppealRow>(`SELECT ${APPEAL_COLS} FROM schoollife.measure_appeals a WHERE a.measure_id = ANY($1::uuid[]) ORDER BY a.filed_at, a.id`, [measureIds]);

export async function decideAppeal(tx: Tx, id: string, v: { status: "UPHELD" | "OVERTURNED" | "WITHDRAWN"; decidedBy: string; decidedByName: string; decisionNote: string | null }): Promise<void> {
  await tx.query(`UPDATE schoollife.measure_appeals SET status = $2, decided_by = $3, decided_by_name = $4, decision_note = $5 WHERE id = $1`, [id, v.status, v.decidedBy, v.decidedByName, v.decisionNote]);
}

// ---------------------------------------------------------------------------
// Effets d'une exclusion (en attente d'un humain)
// ---------------------------------------------------------------------------

const EFFECT_COLS = `e.id, e.measure_id AS "measureId", e.student_id AS "studentId", e.effect_kind AS "effectKind", e.status, e.applied_status AS "appliedStatus",
  e.last_error AS "lastError", e.applied_at AS "appliedAt", e.skipped_reason AS "skippedReason", e.revert_reason AS "revertReason", e.created_at AS "createdAt"`;

export const getEffect = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<EffectRow | null> =>
  tx.queryOne<EffectRow>(`SELECT ${EFFECT_COLS} FROM schoollife.measure_effects e WHERE e.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export const listEffectsOfMeasure = (tx: Tx, measureId: string): Promise<EffectRow[]> =>
  tx.many<EffectRow>(`SELECT ${EFFECT_COLS} FROM schoollife.measure_effects e WHERE e.measure_id = $1 ORDER BY e.created_at, e.id`, [measureId]);

export async function listEffects(tx: Tx, f: { status?: string | undefined; measureId?: string | undefined; limit: number; offset: number }): Promise<EffectRow[]> {
  const where: string[] = ["true"];
  const params: unknown[] = [];
  if (f.status) {
    params.push(f.status);
    where.push(`e.status = $${params.length}`);
  }
  if (f.measureId) {
    params.push(f.measureId);
    where.push(`e.measure_id = $${params.length}`);
  }
  params.push(f.limit, f.offset);
  return tx.many<EffectRow>(`SELECT ${EFFECT_COLS} FROM schoollife.measure_effects e WHERE ${where.join(" AND ")} ORDER BY e.created_at DESC, e.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}

export async function updateEffect(tx: Tx, id: string, u: { status?: string; appliedStatus?: string | null; lastError?: string | null; attempts?: number; skippedReason?: string | null; revertReason?: string | null }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (u.status !== undefined) set("status", u.status);
  if (u.appliedStatus !== undefined) set("applied_status", u.appliedStatus);
  if (u.lastError !== undefined) set("last_error", u.lastError);
  if (u.attempts !== undefined) set("attempts", u.attempts);
  if (u.skippedReason !== undefined) set("skipped_reason", u.skippedReason);
  if (u.revertReason !== undefined) set("revert_reason", u.revertReason);
  if (sets.length === 0) return;
  await tx.query(`UPDATE schoollife.measure_effects SET ${sets.join(", ")} WHERE id = $1`, params);
}
