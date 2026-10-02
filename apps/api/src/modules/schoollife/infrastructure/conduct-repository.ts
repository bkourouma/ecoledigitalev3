/**
 * Barèmes de points de conduite (PARAMÈTRES), valeurs, registre en ajout seul. Le solde est DÉRIVÉ par la fonction SQL
 * `schoollife.conduct_balance` (miroir pur : `domain/conduct.ts`) ; la note de bulletin n'est jamais calculée ici.
 */
import type { Tx } from "@ecoledigitale/database";
import type { MovementRow, ScaleItemRow, ScaleRow } from "./rows";

const SCALE_COLS = `s.id, s.institution_id AS "institutionId", s.code, s.label, s.grade_level_id AS "gradeLevelId", s.initial_points AS "initialPoints", s.min_points AS "minPoints",
  s.max_points AS "maxPoints", s.reset_scope AS "resetScope", s.effective_from::text AS "effectiveFrom", s.effective_to::text AS "effectiveTo", s.status, s.source_kind AS "sourceKind"`;

export async function insertScale(
  tx: Tx,
  s: { id: string; tenantId: string; institutionId: string; code: string; label: string; gradeLevelId: string | null; initialPoints: number; minPoints: number | null; maxPoints: number | null; resetScope: string; effectiveFrom: string; effectiveTo: string | null; sourceKind: string; createdBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.conduct_scales (id, tenant_id, institution_id, code, label, grade_level_id, initial_points, min_points, max_points, reset_scope, effective_from, effective_to, source_kind, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::date,$13,$14)`,
    [s.id, s.tenantId, s.institutionId, s.code, s.label, s.gradeLevelId, s.initialPoints, s.minPoints, s.maxPoints, s.resetScope, s.effectiveFrom, s.effectiveTo, s.sourceKind, s.createdBy],
  );
}

export const getScale = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<ScaleRow | null> =>
  tx.queryOne<ScaleRow>(`SELECT ${SCALE_COLS} FROM schoollife.conduct_scales s WHERE s.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export const listScales = (tx: Tx, f: { institutionId?: string | undefined; status?: string | undefined } = {}): Promise<ScaleRow[]> =>
  tx.many<ScaleRow>(
    `SELECT ${SCALE_COLS} FROM schoollife.conduct_scales s WHERE ($1::uuid IS NULL OR s.institution_id = $1) AND ($2::text IS NULL OR s.status = $2) ORDER BY s.effective_from DESC, s.code`,
    [f.institutionId ?? null, f.status ?? null],
  );

export const listActiveScales = (tx: Tx, institutionId: string): Promise<ScaleRow[]> => listScales(tx, { institutionId, status: "ACTIVE" });

export async function setScaleStatus(tx: Tx, id: string, status: "ACTIVE" | "RETIRED", effectiveTo?: string): Promise<void> {
  if (effectiveTo !== undefined) {
    await tx.query(`UPDATE schoollife.conduct_scales SET status = $2, effective_to = $3::date WHERE id = $1`, [id, status, effectiveTo]);
  } else {
    await tx.query(`UPDATE schoollife.conduct_scales SET status = $2 WHERE id = $1`, [id, status]);
  }
}

export const listScaleItems = (tx: Tx, scaleIds: readonly string[]): Promise<ScaleItemRow[]> =>
  scaleIds.length === 0
    ? Promise.resolve([])
    : tx.many<ScaleItemRow>(`SELECT scale_id AS "scaleId", event_type_id AS "eventTypeId", points_delta AS "pointsDelta" FROM schoollife.conduct_scale_items WHERE scale_id = ANY($1::uuid[]) ORDER BY created_at, id`, [scaleIds]);

export async function getScaleItem(tx: Tx, scaleId: string, eventTypeId: string): Promise<ScaleItemRow | null> {
  return tx.queryOne<ScaleItemRow>(`SELECT scale_id AS "scaleId", event_type_id AS "eventTypeId", points_delta AS "pointsDelta" FROM schoollife.conduct_scale_items WHERE scale_id = $1 AND event_type_id = $2`, [scaleId, eventTypeId]);
}

/** Remplace les valeurs d'un barème BROUILLON (les déclencheurs refusent toute modification d'un barème actif ou retiré). */
export async function replaceScaleItems(tx: Tx, tenantId: string, scaleId: string, items: ReadonlyArray<{ id: string; eventTypeId: string; pointsDelta: number }>): Promise<void> {
  await tx.query(`DELETE FROM schoollife.conduct_scale_items WHERE scale_id = $1`, [scaleId]);
  for (const it of items) {
    await tx.query(`INSERT INTO schoollife.conduct_scale_items (id, tenant_id, scale_id, event_type_id, points_delta) VALUES ($1,$2,$3,$4,$5)`, [it.id, tenantId, scaleId, it.eventTypeId, it.pointsDelta]);
  }
}

const MOVE_COLS = `m.id, m.scale_id AS "scaleId", m.enrollment_id AS "enrollmentId", m.student_id AS "studentId", m.academic_year_id AS "academicYearId", m.academic_period_id AS "academicPeriodId",
  m.delta, m.reason, m.source_kind AS "sourceKind", m.source_id AS "sourceId", m.reverses_id AS "reversesId", m.created_by AS "createdBy", m.created_at AS "createdAt"`;

export async function insertMovement(
  tx: Tx,
  m: { id: string; tenantId: string; scaleId: string; enrollmentId: string; studentId: string; academicYearId: string; academicPeriodId: string | null; delta: number; reason: string; sourceKind: string; sourceId: string | null; reversesId: string | null; createdBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.conduct_movements (id, tenant_id, scale_id, enrollment_id, student_id, academic_year_id, academic_period_id, delta, reason, source_kind, source_id, reverses_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [m.id, m.tenantId, m.scaleId, m.enrollmentId, m.studentId, m.academicYearId, m.academicPeriodId, m.delta, m.reason, m.sourceKind, m.sourceId, m.reversesId, m.createdBy],
  );
}

/** Mouvement non inversé d'une source (mesure ou note), pour l'inverser si la source est révoquée ou retirée. */
export const findMovementOfSource = (tx: Tx, sourceKind: string, sourceId: string): Promise<MovementRow | null> =>
  tx.queryOne<MovementRow>(
    `SELECT ${MOVE_COLS} FROM schoollife.conduct_movements m WHERE m.source_kind = $1 AND m.source_id = $2 AND m.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM schoollife.conduct_movements r WHERE r.tenant_id = m.tenant_id AND r.reverses_id = m.id)
      ORDER BY m.created_at DESC LIMIT 1`,
    [sourceKind, sourceId],
  );

export const listMovements = (tx: Tx, f: { studentId: string; scaleId?: string | undefined; academicYearId?: string | undefined; limit: number }): Promise<MovementRow[]> =>
  tx.many<MovementRow>(
    `SELECT ${MOVE_COLS} FROM schoollife.conduct_movements m WHERE m.student_id = $1 AND ($2::uuid IS NULL OR m.scale_id = $2) AND ($3::uuid IS NULL OR m.academic_year_id = $3)
      ORDER BY m.created_at DESC, m.id LIMIT $4`,
    [f.studentId, f.scaleId ?? null, f.academicYearId ?? null, f.limit],
  );

export async function conductBalance(tx: Tx, studentId: string, scaleId: string, academicYearId: string, periodId: string | null): Promise<number> {
  const row = await tx.queryOne<{ b: number }>(`SELECT schoollife.conduct_balance($1, $2, $3, $4) AS b`, [studentId, scaleId, academicYearId, periodId]);
  return row?.b ?? 0;
}
