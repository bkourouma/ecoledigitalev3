/** Années académiques, périodes typées, états de période par classe. */
import type { Tx } from "@ecoledigitale/database";
import type { AcademicClassroomPeriodStatus, AcademicPeriodStatus, AcademicYearStatus } from "@ecoledigitale/contracts/src/v2/academic";
import type { AcademicPeriod, AcademicYear } from "../domain/records";
import { PERIOD_COLS, YEAR_COLS, mapPeriod, mapYear } from "./mappers";

// ---------------------------------------------------------------------------
// Années
// ---------------------------------------------------------------------------

export async function listYears(tx: Tx, filter: { institutionId?: string | null; status?: AcademicYearStatus | null }): Promise<AcademicYear[]> {
  const rows = await tx.many(
    `SELECT ${YEAR_COLS} FROM academic.academic_years
      WHERE ($1::uuid IS NULL OR institution_id = $1) AND ($2::text IS NULL OR status = $2)
      ORDER BY institution_id, starts_on DESC`,
    [filter.institutionId ?? null, filter.status ?? null],
  );
  return rows.map(mapYear);
}

export async function getYear(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<AcademicYear | null> {
  const r = await tx.queryOne(`SELECT ${YEAR_COLS} FROM academic.academic_years WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? mapYear(r) : null;
}

export async function getCurrentYear(tx: Tx, institutionId: string): Promise<AcademicYear | null> {
  const r = await tx.queryOne(`SELECT ${YEAR_COLS} FROM academic.academic_years WHERE institution_id = $1 AND is_current`, [institutionId]);
  return r ? mapYear(r) : null;
}

export async function listYearRanges(tx: Tx, institutionId: string): Promise<Array<{ id: string; startsOn: string; endsOn: string }>> {
  const rows = await tx.many<{ id: string; starts_on: string; ends_on: string }>(
    `SELECT id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM academic.academic_years WHERE institution_id = $1 ORDER BY starts_on`,
    [institutionId],
  );
  return rows.map((r) => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on }));
}

export async function insertYear(
  tx: Tx,
  v: { id: string; institutionId: string; code: string; label: string; startsOn: string; endsOn: string },
): Promise<AcademicYear> {
  const r = await tx.queryOne(
    `INSERT INTO academic.academic_years (id, tenant_id, institution_id, code, label, starts_on, ends_on)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5::date, $6::date) RETURNING ${YEAR_COLS}`,
    [v.id, v.institutionId, v.code, v.label, v.startsOn, v.endsOn],
  );
  return mapYear(r as Record<string, unknown>);
}

export async function updateYearFields(tx: Tx, id: string, v: { label?: string; startsOn?: string; endsOn?: string }): Promise<AcademicYear> {
  const r = await tx.queryOne(
    `UPDATE academic.academic_years SET label = COALESCE($2, label), starts_on = COALESCE($3::date, starts_on), ends_on = COALESCE($4::date, ends_on), updated_at = now()
      WHERE id = $1 RETURNING ${YEAR_COLS}`,
    [id, v.label ?? null, v.startsOn ?? null, v.endsOn ?? null],
  );
  return mapYear(r as Record<string, unknown>);
}

export async function setYearStatus(tx: Tx, id: string, status: AcademicYearStatus): Promise<AcademicYear> {
  const r = await tx.queryOne(
    `UPDATE academic.academic_years SET status = $2, is_current = CASE WHEN $2 = 'OPEN' THEN is_current ELSE false END,
        opened_at = CASE WHEN $2 = 'OPEN' THEN now() ELSE opened_at END,
        closed_at = CASE WHEN $2 = 'CLOSED' THEN now() ELSE closed_at END,
        archived_at = CASE WHEN $2 = 'ARCHIVED' THEN now() ELSE archived_at END,
        updated_at = now()
      WHERE id = $1 RETURNING ${YEAR_COLS}`,
    [id, status],
  );
  return mapYear(r as Record<string, unknown>);
}

/** Bascule atomique de l'année courante d'un établissement (l'index unique partiel garantit l'unicité). */
export async function switchCurrentYear(tx: Tx, institutionId: string, yearId: string): Promise<AcademicYear> {
  await tx.query("UPDATE academic.academic_years SET is_current = false, updated_at = now() WHERE institution_id = $1 AND is_current AND id <> $2", [institutionId, yearId]);
  const r = await tx.queryOne(`UPDATE academic.academic_years SET is_current = true, updated_at = now() WHERE id = $1 RETURNING ${YEAR_COLS}`, [yearId]);
  return mapYear(r as Record<string, unknown>);
}

export async function findYearGaps(tx: Tx): Promise<Array<{ institutionId: string; previousYearId: string; nextYearId: string; gapDays: number }>> {
  const rows = await tx.many<{ institution_id: string; previous_year_id: string; next_year_id: string; gap_days: number }>("SELECT * FROM academic.find_year_gaps()");
  return rows.map((r) => ({ institutionId: r.institution_id, previousYearId: r.previous_year_id, nextYearId: r.next_year_id, gapDays: r.gap_days }));
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

export async function listPeriods(tx: Tx, yearId: string): Promise<AcademicPeriod[]> {
  const rows = await tx.many(`SELECT ${PERIOD_COLS} FROM academic.academic_periods WHERE academic_year_id = $1 ORDER BY starts_on, ordinal, code`, [yearId]);
  return rows.map(mapPeriod);
}

export async function getPeriod(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<AcademicPeriod | null> {
  const r = await tx.queryOne(`SELECT ${PERIOD_COLS} FROM academic.academic_periods WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return r ? mapPeriod(r) : null;
}

export async function insertPeriod(
  tx: Tx,
  v: { id: string; academicYearId: string; parentPeriodId: string | null; periodTypeCode: string; ordinal: number; code: string; label: string; startsOn: string; endsOn: string },
): Promise<AcademicPeriod> {
  const r = await tx.queryOne(
    `INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, parent_period_id, period_type_code, ordinal, code, label, starts_on, ends_on)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8::date, $9::date) RETURNING ${PERIOD_COLS}`,
    [v.id, v.academicYearId, v.parentPeriodId, v.periodTypeCode, v.ordinal, v.code, v.label, v.startsOn, v.endsOn],
  );
  return mapPeriod(r as Record<string, unknown>);
}

export async function updatePeriodFields(tx: Tx, id: string, v: { label?: string; startsOn?: string; endsOn?: string }): Promise<AcademicPeriod> {
  const r = await tx.queryOne(
    `UPDATE academic.academic_periods SET label = COALESCE($2, label), starts_on = COALESCE($3::date, starts_on), ends_on = COALESCE($4::date, ends_on), updated_at = now()
      WHERE id = $1 RETURNING ${PERIOD_COLS}`,
    [id, v.label ?? null, v.startsOn ?? null, v.endsOn ?? null],
  );
  return mapPeriod(r as Record<string, unknown>);
}

export async function deletePeriod(tx: Tx, id: string): Promise<void> {
  await tx.query("DELETE FROM academic.academic_periods WHERE id = $1", [id]);
}

export async function setPeriodState(
  tx: Tx,
  id: string,
  v: {
    status: AcademicPeriodStatus;
    openedAt?: "now" | "keep";
    gradingClosedAt?: "now" | "clear" | "keep";
    closedAt?: "now" | "clear" | "keep";
    closedBy?: string | null | "keep";
    incrementReopened?: boolean;
  },
): Promise<AcademicPeriod> {
  const closedByKeep = v.closedBy === undefined || v.closedBy === "keep";
  const r = await tx.queryOne(
    `UPDATE academic.academic_periods SET status = $2,
        opened_at = CASE WHEN $3::text = 'now' AND opened_at IS NULL THEN now() ELSE opened_at END,
        grading_closed_at = CASE $4::text WHEN 'now' THEN now() WHEN 'clear' THEN NULL ELSE grading_closed_at END,
        closed_at = CASE $5::text WHEN 'now' THEN now() WHEN 'clear' THEN NULL ELSE closed_at END,
        closed_by = CASE WHEN $6::boolean THEN closed_by ELSE $7::uuid END,
        reopened_count = reopened_count + CASE WHEN $8::boolean THEN 1 ELSE 0 END,
        updated_at = now()
      WHERE id = $1 RETURNING ${PERIOD_COLS}`,
    [id, v.status, v.openedAt ?? "keep", v.gradingClosedAt ?? "keep", v.closedAt ?? "keep", closedByKeep, closedByKeep ? null : (v.closedBy as string | null), v.incrementReopened === true],
  );
  return mapPeriod(r as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// États de période par classe (clôture par classe)
// ---------------------------------------------------------------------------

export async function listClassroomStates(tx: Tx, periodId: string): Promise<Array<{ classroomId: string; status: AcademicClassroomPeriodStatus }>> {
  const rows = await tx.many<{ classroom_id: string; status: AcademicClassroomPeriodStatus }>("SELECT classroom_id, status FROM academic.classroom_period_states WHERE period_id = $1", [periodId]);
  return rows.map((r) => ({ classroomId: r.classroom_id, status: r.status }));
}

export async function getClassroomState(tx: Tx, classroomId: string, periodId: string): Promise<AcademicClassroomPeriodStatus | null> {
  const r = await tx.queryOne<{ status: AcademicClassroomPeriodStatus }>("SELECT status FROM academic.classroom_period_states WHERE classroom_id = $1 AND period_id = $2", [classroomId, periodId]);
  return r ? r.status : null;
}

export async function upsertClassroomState(
  tx: Tx,
  v: { classroomId: string; periodId: string; status: AcademicClassroomPeriodStatus; changedBy: string | null; reason: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.classroom_period_states (tenant_id, classroom_id, period_id, status, changed_by, reason)
     VALUES (kernel.current_tenant_id(), $1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, classroom_id, period_id) DO UPDATE SET status = EXCLUDED.status, changed_at = now(), changed_by = EXCLUDED.changed_by, reason = EXCLUDED.reason`,
    [v.classroomId, v.periodId, v.status, v.changedBy, v.reason],
  );
}

/** État effectif (SQL `effective_period_status`) : explicite de la classe sinon celui de la période. */
export async function effectiveState(tx: Tx, classroomId: string, periodId: string): Promise<{ state: AcademicPeriodStatus; explicit: boolean } | null> {
  const r = await tx.queryOne<{ state: AcademicPeriodStatus | null; explicit: boolean }>(
    `SELECT academic.effective_period_status($1, $2) AS state,
            EXISTS (SELECT 1 FROM academic.classroom_period_states s WHERE s.classroom_id = $1 AND s.period_id = $2) AS explicit`,
    [classroomId, periodId],
  );
  return r && r.state ? { state: r.state, explicit: r.explicit } : null;
}

/** Offres vivantes d'une année (clôture d'année). */
export async function countLiveOfferingsOfYear(tx: Tx, yearId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM academic.classroom_offerings o JOIN academic.classrooms c ON c.tenant_id = o.tenant_id AND c.id = o.classroom_id
      WHERE c.academic_year_id = $1 AND o.status IN ('OPEN','FULL','IN_PROGRESS')`,
    [yearId],
  );
  return r?.n ?? 0;
}
