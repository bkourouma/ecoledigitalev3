/**
 * Récapitulatifs par (inscription, période) : recalcul idempotent par la fonction SQL `summarize_enrollment`
 * (même logique que le domaine, vérifié par un test de conformité), surcharges tracées, état des alertes.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AlertMetric, AlertState } from "../domain/alerts";
import type { IsoDate, SummaryCounts, SummaryOverride, Uuid } from "../domain/types";
import { SUMMARY_COLUMNS, toCounts, type SummaryRow } from "./rows";

export interface StoredSummary {
  readonly enrollmentId: Uuid;
  readonly periodId: Uuid;
  readonly studentId: Uuid;
  readonly windowFrom: IsoDate;
  readonly windowTo: IsoDate;
  readonly counts: SummaryCounts;
  readonly computedAt: Date;
}

const toStored = (r: SummaryRow): StoredSummary => ({
  enrollmentId: r.enrollment_id,
  periodId: r.period_id,
  studentId: r.student_id,
  windowFrom: r.window_from,
  windowTo: r.window_to,
  counts: toCounts(r),
  computedAt: r.computed_at,
});

export async function getStoredSummaries(tx: Tx, enrollmentIds: readonly Uuid[], periodId: Uuid): Promise<StoredSummary[]> {
  if (enrollmentIds.length === 0) return [];
  return (
    await tx.many<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM attendance.period_summaries WHERE period_id = $1 AND enrollment_id = ANY($2::uuid[])`,
      [periodId, [...enrollmentIds]],
    )
  ).map(toStored);
}

/** Récapitulatifs déjà calculés pour des inscriptions (toutes périodes) : fenêtres à rafraîchir sans port. */
export async function listStoredForEnrollments(tx: Tx, enrollmentIds: readonly Uuid[]): Promise<StoredSummary[]> {
  if (enrollmentIds.length === 0) return [];
  return (
    await tx.many<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} FROM attendance.period_summaries WHERE enrollment_id = ANY($1::uuid[])`, [[...enrollmentIds]])
  ).map(toStored);
}

/** Récapitulatifs périmés : un pointage ou une séance a changé depuis `computed_at` (filet de sécurité du job). */
export async function listStaleSummaries(tx: Tx, limit: number): Promise<StoredSummary[]> {
  return (
    await tx.many<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM attendance.period_summaries ps
        WHERE EXISTS (
          SELECT 1 FROM attendance.student_records r
            JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
           WHERE r.enrollment_id = ps.enrollment_id AND s.session_date BETWEEN ps.window_from AND ps.window_to
             AND GREATEST(r.updated_at, s.updated_at) > ps.computed_at)
        ORDER BY ps.computed_at LIMIT $1`,
      [Math.max(1, limit)],
    )
  ).map(toStored);
}

export async function listStoredForPeriod(tx: Tx, periodId: Uuid): Promise<StoredSummary[]> {
  return (await tx.many<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} FROM attendance.period_summaries WHERE period_id = $1`, [periodId])).map(toStored);
}

/** Inscriptions ayant au moins un pointage dans la fenêtre (reconstruction complète d'une période). */
export async function listEnrollmentsWithRecords(tx: Tx, from: IsoDate, to: IsoDate, classroomIds?: readonly Uuid[]): Promise<Uuid[]> {
  const rows = await tx.many<{ enrollment_id: Uuid }>(
    `SELECT DISTINCT r.enrollment_id FROM attendance.student_records r
       JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
      WHERE s.session_date BETWEEN $1::date AND $2::date AND s.status IN ('SUBMITTED', 'VALIDATED')
        AND ($3::uuid[] IS NULL OR s.classroom_id = ANY($3::uuid[]))`,
    [from, to, classroomIds ? [...classroomIds] : null],
  );
  return rows.map((r) => r.enrollment_id);
}

/**
 * Recalcule et enregistre les récapitulatifs de `enrollmentIds` pour la fenêtre d'une période. Idempotent : rejouer
 * ne change aucune valeur. Les inscriptions sans aucun pointage n'ont pas de ligne (le dérivé est alors vide).
 */
export async function recomputeForPeriod(
  tx: Tx,
  tenantId: Uuid,
  enrollmentIds: readonly Uuid[],
  period: { periodId: Uuid; from: IsoDate; to: IsoDate },
): Promise<StoredSummary[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.many<SummaryRow>(
    `WITH enr AS (
       SELECT r.enrollment_id, (array_agg(r.student_id))[1] AS student_id
         FROM attendance.student_records r WHERE r.enrollment_id = ANY($5::uuid[]) GROUP BY r.enrollment_id
     ), ins AS (
       INSERT INTO attendance.period_summaries (tenant_id, enrollment_id, period_id, student_id, window_from, window_to, sessions_total, present_count,
                                                absent_count, excused_count, late_count, excused_late_count, early_leave_count, unmarked_count,
                                                absent_minutes, excused_minutes, late_minutes, computed_at)
       SELECT $1, e.enrollment_id, $2, e.student_id, $3::date, $4::date, s.sessions_total, s.present_count, s.absent_count, s.excused_count,
              s.late_count, s.excused_late_count, s.early_leave_count, 0, s.absent_minutes, s.excused_minutes, s.late_minutes, now()
         FROM enr e CROSS JOIN LATERAL attendance.summarize_enrollment(e.enrollment_id, $3::date, $4::date) s
        ORDER BY e.enrollment_id
       ON CONFLICT (tenant_id, enrollment_id, period_id) DO UPDATE SET
              student_id = EXCLUDED.student_id, window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to,
              sessions_total = EXCLUDED.sessions_total, present_count = EXCLUDED.present_count, absent_count = EXCLUDED.absent_count,
              excused_count = EXCLUDED.excused_count, late_count = EXCLUDED.late_count, excused_late_count = EXCLUDED.excused_late_count,
              early_leave_count = EXCLUDED.early_leave_count, unmarked_count = EXCLUDED.unmarked_count,
              absent_minutes = EXCLUDED.absent_minutes, excused_minutes = EXCLUDED.excused_minutes, late_minutes = EXCLUDED.late_minutes,
              computed_at = EXCLUDED.computed_at
       RETURNING *)
     SELECT ${SUMMARY_COLUMNS} FROM ins`,
    [tenantId, period.periodId, period.from, period.to, [...enrollmentIds]],
  );
  return rows.map(toStored);
}

/** Dérivé calculé À LA VOLÉE (aucune écriture : un GET n'écrit jamais). */
export async function computeOnTheFly(tx: Tx, enrollmentId: Uuid, from: IsoDate, to: IsoDate): Promise<SummaryCounts> {
  const r = await tx.queryOne<{
    sessions_total: number; present_count: number; absent_count: number; excused_count: number; late_count: number;
    excused_late_count: number; early_leave_count: number; absent_minutes: number; excused_minutes: number; late_minutes: number;
  }>("SELECT * FROM attendance.summarize_enrollment($1, $2::date, $3::date)", [enrollmentId, from, to]);
  return {
    sessionsTotal: r?.sessions_total ?? 0,
    presentCount: r?.present_count ?? 0,
    absentCount: r?.absent_count ?? 0,
    excusedCount: r?.excused_count ?? 0,
    lateCount: r?.late_count ?? 0,
    excusedLateCount: r?.excused_late_count ?? 0,
    earlyLeaveCount: r?.early_leave_count ?? 0,
    unmarkedCount: 0,
    absentMinutes: r?.absent_minutes ?? 0,
    excusedMinutes: r?.excused_minutes ?? 0,
    lateMinutes: r?.late_minutes ?? 0,
  };
}

// --- surcharges -------------------------------------------------------------

interface OverrideRow {
  id: Uuid;
  enrollment_id: Uuid;
  period_id: Uuid;
  absent_minutes: number;
  excused_minutes: number;
  reason: string;
  set_by: Uuid;
  set_at: Date;
}
const OVERRIDE_COLUMNS = "id, enrollment_id, period_id, absent_minutes, excused_minutes, reason, set_by, set_at";
const toOverride = (r: OverrideRow): SummaryOverride => ({
  id: r.id,
  enrollmentId: r.enrollment_id,
  periodId: r.period_id,
  absentMinutes: r.absent_minutes,
  excusedMinutes: r.excused_minutes,
  reason: r.reason,
  setBy: r.set_by,
  setAt: r.set_at,
});

export async function getLiveOverrides(tx: Tx, enrollmentIds: readonly Uuid[], periodId: Uuid): Promise<Map<Uuid, SummaryOverride>> {
  const out = new Map<Uuid, SummaryOverride>();
  if (enrollmentIds.length === 0) return out;
  const rows = await tx.many<OverrideRow>(
    `SELECT ${OVERRIDE_COLUMNS} FROM attendance.summary_overrides WHERE period_id = $1 AND enrollment_id = ANY($2::uuid[]) AND removed_at IS NULL`,
    [periodId, [...enrollmentIds]],
  );
  for (const r of rows) out.set(r.enrollment_id, toOverride(r));
  return out;
}

/** Remplace la surcharge vivante (l'ancienne est retirée mais conservée : historique). */
export async function replaceOverride(
  tx: Tx,
  o: { id: Uuid; tenantId: Uuid; enrollmentId: Uuid; periodId: Uuid; absentMinutes: number; excusedMinutes: number; reason: string; setBy: Uuid; at: Date },
): Promise<{ override: SummaryOverride; replaced: SummaryOverride | null }> {
  const old = await tx.queryOne<OverrideRow>(
    `UPDATE attendance.summary_overrides SET removed_at = $3, removed_by = $4
      WHERE enrollment_id = $1 AND period_id = $2 AND removed_at IS NULL RETURNING ${OVERRIDE_COLUMNS}`,
    [o.enrollmentId, o.periodId, o.at.toISOString(), o.setBy],
  );
  const rows = await tx.many<OverrideRow>(
    `INSERT INTO attendance.summary_overrides (id, tenant_id, enrollment_id, period_id, absent_minutes, excused_minutes, reason, set_by, set_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${OVERRIDE_COLUMNS}`,
    [o.id, o.tenantId, o.enrollmentId, o.periodId, o.absentMinutes, o.excusedMinutes, o.reason, o.setBy, o.at.toISOString()],
  );
  return { override: toOverride(rows[0] as OverrideRow), replaced: old ? toOverride(old) : null };
}

export async function removeOverride(tx: Tx, enrollmentId: Uuid, periodId: Uuid, by: Uuid, at: Date): Promise<SummaryOverride | null> {
  const r = await tx.queryOne<OverrideRow>(
    `UPDATE attendance.summary_overrides SET removed_at = $3, removed_by = $4
      WHERE enrollment_id = $1 AND period_id = $2 AND removed_at IS NULL RETURNING ${OVERRIDE_COLUMNS}`,
    [enrollmentId, periodId, at.toISOString(), by],
  );
  return r ? toOverride(r) : null;
}

// --- état des alertes -------------------------------------------------------

interface AlertStateRow {
  enrollment_id: Uuid;
  rule_code: string;
  metric: AlertMetric;
  threshold: number;
  last_value: number;
  cleared_at: Date | null;
}

export async function getAlertStates(tx: Tx, enrollmentIds: readonly Uuid[], periodId: Uuid): Promise<Map<Uuid, AlertState[]>> {
  const out = new Map<Uuid, AlertState[]>();
  if (enrollmentIds.length === 0) return out;
  const rows = await tx.many<AlertStateRow>(
    "SELECT enrollment_id, rule_code, metric, threshold, last_value, cleared_at FROM attendance.alert_states WHERE period_id = $1 AND enrollment_id = ANY($2::uuid[])",
    [periodId, [...enrollmentIds]],
  );
  for (const r of rows) {
    const list = out.get(r.enrollment_id) ?? [];
    list.push({ ruleCode: r.rule_code, metric: r.metric, threshold: r.threshold, lastValue: r.last_value, active: r.cleared_at === null });
    out.set(r.enrollment_id, list);
  }
  return out;
}

export async function saveAlertState(
  tx: Tx,
  s: { tenantId: Uuid; enrollmentId: Uuid; periodId: Uuid; studentId: Uuid; ruleCode: string; metric: AlertMetric; threshold: number; value: number; kind: "TRIGGER" | "CLEAR" | "UPDATE"; at: Date },
): Promise<void> {
  if (s.kind === "CLEAR") {
    await tx.query(
      `UPDATE attendance.alert_states SET cleared_at = $4, last_value = $5, updated_at = $4
        WHERE enrollment_id = $1 AND period_id = $2 AND rule_code = $3`,
      [s.enrollmentId, s.periodId, s.ruleCode, s.at.toISOString(), s.value],
    );
    return;
  }
  await tx.query(
    `INSERT INTO attendance.alert_states (tenant_id, enrollment_id, period_id, rule_code, student_id, metric, threshold, last_value, triggered_at, cleared_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$9)
     ON CONFLICT (tenant_id, enrollment_id, period_id, rule_code) DO UPDATE
       SET metric = EXCLUDED.metric, threshold = EXCLUDED.threshold, last_value = EXCLUDED.last_value, updated_at = EXCLUDED.updated_at,
           triggered_at = CASE WHEN attendance.alert_states.cleared_at IS NOT NULL AND $10 = 'TRIGGER' THEN EXCLUDED.triggered_at ELSE attendance.alert_states.triggered_at END,
           cleared_at = CASE WHEN $10 = 'TRIGGER' THEN NULL ELSE attendance.alert_states.cleared_at END`,
    [s.tenantId, s.enrollmentId, s.periodId, s.ruleCode, s.studentId, s.metric, s.threshold, s.value, s.at.toISOString(), s.kind],
  );
}

// --- journées (appel journalier) ---------------------------------------------

export interface DailyDaysRow {
  readonly enrollmentId: Uuid;
  readonly calledDays: number;
  readonly presentDays: number;
  readonly absentDays: number;
  readonly excusedAbsentDays: number;
  readonly lateDays: number;
}

/**
 * JOURNÉES par inscription sur `[from, to]` : seuls les appels `DAILY` soumis ou validés comptent (un appel par classe et par
 * jour) ; une journée est comptée une fois même si l'élève a changé de classe. Lecture seule, aucune minute supposée.
 */
export async function countDailyDays(tx: Tx, enrollmentIds: readonly Uuid[], from: IsoDate, to: IsoDate): Promise<Map<Uuid, DailyDaysRow>> {
  const rows = await tx.many<{ enrollment_id: Uuid; called_days: number; present_days: number; absent_days: number; excused_absent_days: number; late_days: number }>(
    `SELECT r.enrollment_id,
            count(DISTINCT s.session_date)::integer AS called_days,
            count(DISTINCT s.session_date) FILTER (WHERE d.counts_as_present)::integer AS present_days,
            count(DISTINCT s.session_date) FILTER (WHERE d.counts_as_absence)::integer AS absent_days,
            count(DISTINCT s.session_date) FILTER (WHERE d.counts_as_absence AND r.excused)::integer AS excused_absent_days,
            count(DISTINCT s.session_date) FILTER (WHERE d.counts_as_late)::integer AS late_days
       FROM attendance.student_records r
       JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
       JOIN attendance.status_definitions d ON d.tenant_id = r.tenant_id AND d.subject_kind = r.subject_kind AND d.code = r.status_code
      WHERE r.tenant_id = kernel.current_tenant_id()
        AND r.enrollment_id = ANY($1::uuid[])
        AND s.scope = 'DAILY'
        AND s.status IN ('SUBMITTED', 'VALIDATED')
        AND s.session_date BETWEEN $2::date AND $3::date
      GROUP BY r.enrollment_id`,
    [[...enrollmentIds], from, to],
  );
  const out = new Map<Uuid, DailyDaysRow>();
  for (const r of rows) {
    out.set(r.enrollment_id, {
      enrollmentId: r.enrollment_id,
      calledDays: r.called_days,
      presentDays: r.present_days,
      absentDays: r.absent_days,
      excusedAbsentDays: r.excused_absent_days,
      lateDays: r.late_days,
    });
  }
  return out;
}
