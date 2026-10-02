/**
 * Lectures des read-models : TOUTE l'agrégation se fait en SQL sur le schéma `analytics` (jamais en JavaScript, jamais
 * dans le navigateur). Aucune requête vers le schéma d'un autre module. La RLS isole le tenant.
 *
 * Les décimaux (moyennes) reviennent en `numeric` -> chaîne : ils ne sont que PRÉSENTÉS (2 décimales), jamais recombinés
 * dans une formule scolaire.
 */
import type { Tx } from "@ecoledigitale/database";
import { binCount, buildBins, presentDecimal, rateBps, type HistogramBin } from "../domain/metrics";
import { num, numOrNull } from "./sql";

/** Filtres résolus (voir `application/scope.ts`). `null` = pas de filtre. */
export interface ReadScope {
  institutionId: string | null;
  campusId: string | null;
  yearId: string | null;
  periodId: string | null;
  classroomId: string | null;
  gradeLevelCode?: string | null;
  from: string | null;
  to: string | null;
}

const n = (v: unknown): number => Number(v ?? 0);

// ------------------------------------------------------------------------------------------------------------------
// Effectifs
// ------------------------------------------------------------------------------------------------------------------

export interface CountRow {
  key: string;
  label: string;
  count: number;
  inSchooling: number;
}

export interface EnrollmentBreakdown {
  totals: { total: number; inSchooling: number; repeaters: number; repeaterRateBps: number | null };
  byStatus: CountRow[];
  bySex: CountRow[];
  byGradeLevel: CountRow[];
  byFunding: CountRow[];
  byCampus: CountRow[];
  byClassroom: Array<{ classroomId: string; name: string; gradeLevelLabel: string; count: number; inSchooling: number; male: number; female: number }>;
  admissions: {
    created: number;
    confirmed: number;
    cancelled: number;
    confirmationRateBps: number | null;
    bySource: Array<{ sourceKind: string; created: number; confirmed: number }>;
    monthly: Array<{ month: string; created: number; confirmed: number }>;
  };
}

/** Filtre des inscriptions : institution $1, campus $2, année $3, classe $4 (alias `e`, classes `dc`). */
const ENROLLMENT_WHERE = `($1::uuid IS NULL OR e.institution_id = $1) AND ($2::uuid IS NULL OR e.campus_id = $2)
   AND ($3::uuid IS NULL OR e.year_id = $3) AND ($4::uuid IS NULL OR e.classroom_id = $4)`;
const enrollmentParams = (s: ReadScope): unknown[] => [s.institutionId, s.campusId, s.yearId, s.classroomId];

export async function enrollmentBreakdown(tx: Tx, s: ReadScope): Promise<EnrollmentBreakdown> {
  const p = enrollmentParams(s);
  const rows = (sql: string): Promise<Array<{ key: string | null; label: string | null; c: string; s: string }>> =>
    tx.many(sql, p);

  const totalsRow = await tx.queryOne<{ total: string; in_schooling: string; repeaters: string }>(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE e.in_schooling)::text AS in_schooling,
            count(*) FILTER (WHERE e.in_schooling AND e.is_repeating)::text AS repeaters
       FROM analytics.enrollment_facts e WHERE ${ENROLLMENT_WHERE}`,
    p,
  );
  const group = async (keyExpr: string, labelExpr: string, join = ""): Promise<CountRow[]> =>
    (await rows(
      `SELECT ${keyExpr} AS key, max(${labelExpr}) AS label, count(*)::text AS c, count(*) FILTER (WHERE e.in_schooling)::text AS s
         FROM analytics.enrollment_facts e ${join} WHERE ${ENROLLMENT_WHERE} GROUP BY 1 ORDER BY count(*) DESC, 1`,
    )).map((r) => ({ key: r.key ?? "UNKNOWN", label: r.label ?? r.key ?? "UNKNOWN", count: n(r.c), inSchooling: n(r.s) }));

  const byClassroom = await tx.many<{ id: string; name: string | null; gl: string | null; c: string; s: string; m: string; f: string }>(
    `SELECT e.classroom_id AS id, max(dc.name) AS name, max(dc.grade_level_label) AS gl, count(*)::text AS c,
            count(*) FILTER (WHERE e.in_schooling)::text AS s,
            count(*) FILTER (WHERE e.in_schooling AND e.sex = 'M')::text AS m, count(*) FILTER (WHERE e.in_schooling AND e.sex = 'F')::text AS f
       FROM analytics.enrollment_facts e LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id = e.classroom_id
      WHERE ${ENROLLMENT_WHERE} GROUP BY e.classroom_id ORDER BY max(dc.grade_level_label) NULLS LAST, max(dc.name) NULLS LAST, e.classroom_id`,
    p,
  );

  const adm = await tx.queryOne<{ created: string; confirmed: string; cancelled: string }>(
    `SELECT count(*)::text AS created, count(*) FILTER (WHERE e.confirmed_at IS NOT NULL)::text AS confirmed,
            count(*) FILTER (WHERE e.cancelled_at IS NOT NULL)::text AS cancelled
       FROM analytics.enrollment_facts e WHERE ${ENROLLMENT_WHERE}`,
    p,
  );
  const bySource = await tx.many<{ k: string; c: string; f: string }>(
    `SELECT COALESCE(e.source_kind, 'UNKNOWN') AS k, count(*)::text AS c, count(*) FILTER (WHERE e.confirmed_at IS NOT NULL)::text AS f
       FROM analytics.enrollment_facts e WHERE ${ENROLLMENT_WHERE} GROUP BY 1 ORDER BY count(*) DESC, 1`,
    p,
  );
  const monthly = await tx.many<{ month: string; created: string; confirmed: string }>(
    `WITH c AS (SELECT to_char(date_trunc('month', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month, count(*) AS n
                  FROM analytics.enrollment_facts e WHERE e.created_at IS NOT NULL AND ${ENROLLMENT_WHERE} GROUP BY 1),
          f AS (SELECT to_char(date_trunc('month', e.confirmed_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month, count(*) AS n
                  FROM analytics.enrollment_facts e WHERE e.confirmed_at IS NOT NULL AND ${ENROLLMENT_WHERE} GROUP BY 1)
     SELECT COALESCE(c.month, f.month) AS month, COALESCE(c.n, 0)::text AS created, COALESCE(f.n, 0)::text AS confirmed
       FROM c FULL JOIN f USING (month) ORDER BY 1`,
    p,
  );

  const total = n(totalsRow?.total);
  const inSchooling = n(totalsRow?.in_schooling);
  const repeaters = n(totalsRow?.repeaters);
  const created = n(adm?.created);
  const confirmed = n(adm?.confirmed);
  return {
    totals: { total, inSchooling, repeaters, repeaterRateBps: rateBps(repeaters, inSchooling) },
    byStatus: await group("e.status", "e.status"),
    bySex: await group("COALESCE(e.sex, 'UNKNOWN')", "COALESCE(e.sex, 'UNKNOWN')"),
    byGradeLevel: await group("COALESCE(dc.grade_level_code, 'UNKNOWN')", "COALESCE(dc.grade_level_label, 'UNKNOWN')", "LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id = e.classroom_id"),
    byFunding: await group("e.funding_type", "e.funding_type"),
    byCampus: await group("COALESCE(e.campus_id::text, 'NONE')", "COALESCE(sc.label, 'Sans campus')", "LEFT JOIN analytics.dim_scope sc ON sc.scope_kind = 'CAMPUS' AND sc.scope_id = e.campus_id"),
    byClassroom: byClassroom.map((r) => ({ classroomId: r.id, name: r.name ?? r.id, gradeLevelLabel: r.gl ?? "", count: n(r.c), inSchooling: n(r.s), male: n(r.m), female: n(r.f) })),
    admissions: {
      created,
      confirmed,
      cancelled: n(adm?.cancelled),
      confirmationRateBps: rateBps(confirmed, created),
      bySource: bySource.map((r) => ({ sourceKind: r.k, created: n(r.c), confirmed: n(r.f) })),
      monthly: monthly.map((r) => ({ month: r.month, created: n(r.created), confirmed: n(r.confirmed) })),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Présences
// ------------------------------------------------------------------------------------------------------------------

export interface AttendanceCounts {
  recordsCount: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  absentMinutes: number;
  rateBps: number | null;
}

const toCounts = (r: Record<string, any>): AttendanceCounts => {
  const recordsCount = n(r.records);
  const presentCount = n(r.present);
  return { recordsCount, presentCount, absentCount: n(r.absent), excusedCount: n(r.excused), lateCount: n(r.late), absentMinutes: n(r.minutes), rateBps: rateBps(presentCount, recordsCount) };
};

const ATT_SUMS = `sum(a.records_count)::text AS records, sum(a.present_count)::text AS present, sum(a.absent_count)::text AS absent,
       sum(a.excused_count)::text AS excused, sum(a.late_count)::text AS late, sum(a.absent_minutes)::text AS minutes, sum(a.sessions_count)::text AS sessions`;
/** Filtre des présences : institution $1, campus $2, classe $3, du $4 au $5. */
const ATT_WHERE = `($1::uuid IS NULL OR a.institution_id = $1) AND ($2::uuid IS NULL OR a.campus_id = $2)
   AND ($3::uuid IS NULL OR a.classroom_id = $3) AND a.day BETWEEN $4::date AND $5::date`;
const attParams = (s: ReadScope, from: string, to: string): unknown[] => [s.institutionId, s.campusId, s.classroomId, from, to];

export interface AttendanceBreakdown {
  totals: AttendanceCounts & { sessionsCount: number };
  byDay: Array<{ day: string } & AttendanceCounts>;
  byClassroom: Array<{ classroomId: string; name: string; gradeLevelLabel: string } & AttendanceCounts>;
}

export async function attendanceBreakdown(tx: Tx, s: ReadScope, range: { from: string; to: string }): Promise<AttendanceBreakdown> {
  const p = attParams(s, range.from, range.to);
  const t = await tx.queryOne<Record<string, any>>(
    `SELECT COALESCE(sum(a.records_count),0)::text AS records, COALESCE(sum(a.present_count),0)::text AS present, COALESCE(sum(a.absent_count),0)::text AS absent,
            COALESCE(sum(a.excused_count),0)::text AS excused, COALESCE(sum(a.late_count),0)::text AS late, COALESCE(sum(a.absent_minutes),0)::text AS minutes,
            COALESCE(sum(a.sessions_count),0)::text AS sessions
       FROM analytics.attendance_daily a WHERE ${ATT_WHERE}`,
    p,
  );
  const byDay = await tx.many<Record<string, any>>(`SELECT a.day::text AS day, ${ATT_SUMS} FROM analytics.attendance_daily a WHERE ${ATT_WHERE} GROUP BY a.day ORDER BY a.day`, p);
  const byClassroom = await tx.many<Record<string, any>>(
    `SELECT a.classroom_id AS id, max(dc.name) AS name, max(dc.grade_level_label) AS gl, ${ATT_SUMS}
       FROM analytics.attendance_daily a LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id = a.classroom_id
      WHERE ${ATT_WHERE} GROUP BY a.classroom_id ORDER BY max(dc.grade_level_label) NULLS LAST, max(dc.name) NULLS LAST, a.classroom_id`,
    p,
  );
  return {
    totals: { ...toCounts(t ?? {}), sessionsCount: n(t?.sessions) },
    byDay: byDay.map((r) => ({ day: r.day, ...toCounts(r) })),
    byClassroom: byClassroom.map((r) => ({ classroomId: r.id, name: r.name ?? r.id, gradeLevelLabel: r.gl ?? "", ...toCounts(r) })),
  };
}

export async function staffPresenceByDay(tx: Tx, range: { from: string; to: string }): Promise<Array<{ day: string; present: number; absent: number; onLeave: number }>> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT day::text AS day, count(*) FILTER (WHERE present)::text AS present, count(*) FILTER (WHERE absent AND NOT on_leave)::text AS absent,
            count(*) FILTER (WHERE on_leave)::text AS on_leave
       FROM analytics.staff_presence_facts WHERE day BETWEEN $1::date AND $2::date GROUP BY day ORDER BY day`,
    [range.from, range.to],
  );
  return rows.map((r) => ({ day: r.day, present: n(r.present), absent: n(r.absent), onLeave: n(r.on_leave) }));
}

// ------------------------------------------------------------------------------------------------------------------
// Résultats
// ------------------------------------------------------------------------------------------------------------------

export interface ResultStats {
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
  validatedCount: number;
  validationRateBps: number | null;
}

const statsOf = (r: Record<string, any>): ResultStats => {
  const validated = n(r.validated);
  const decided = n(r.decided);
  return { count: n(r.cnt), average: presentDecimal(r.avg), min: presentDecimal(r.min), max: presentDecimal(r.max), validatedCount: validated, validationRateBps: rateBps(validated, decided) };
};

const RESULT_SUMS = `count(rf.average)::text AS cnt, avg(rf.average)::text AS avg, min(rf.average)::text AS min, max(rf.average)::text AS max,
       count(*) FILTER (WHERE rf.validated)::text AS validated, count(*) FILTER (WHERE rf.validated IS NOT NULL)::text AS decided`;
/** Filtre des résultats : année $1, période $2, classe $3, institution $4, campus $5, niveau $6 (alias `rf`, classes `dc`). */
const RESULT_WHERE = `($1::uuid IS NULL OR rf.year_id = $1) AND ($2::uuid IS NULL OR rf.period_id = $2) AND ($3::uuid IS NULL OR rf.classroom_id = $3)
   AND ($4::uuid IS NULL OR dc.institution_id = $4) AND ($5::uuid IS NULL OR dc.campus_id = $5) AND ($6::text IS NULL OR dc.grade_level_code = $6)`;
const resultParams = (s: ReadScope, withPeriod = true): unknown[] => [s.yearId, withPeriod ? s.periodId : null, s.classroomId, s.institutionId, s.campusId, s.gradeLevelCode ?? null];
const RESULT_FROM = `analytics.result_facts rf LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id = rf.classroom_id`;

export interface ResultsBreakdown {
  totals: ResultStats & { classPeriodsFinal: number; classPeriodsNotFinal: number };
  byClassroom: Array<{ classroomId: string; name: string; gradeLevelLabel: string } & ResultStats>;
  bySubject: Array<{ nodeId: string; code: string; label: string; level: string; resitEligibleCount: number; session2Count: number } & ResultStats>;
  byPeriod: Array<{ periodId: string; label: string; ordinal: number } & ResultStats>;
  distribution: { scaleMax: number; binWidth: number; bins: HistogramBin[] };
  decisions: { period: Array<{ code: string; outcome: string | null; count: number }>; year: Array<{ code: string; outcome: string | null; count: number }> };
}

export async function resultsTotals(tx: Tx, s: ReadScope): Promise<ResultStats> {
  const r = await tx.queryOne<Record<string, any>>(`SELECT ${RESULT_SUMS} FROM ${RESULT_FROM} WHERE ${RESULT_WHERE}`, resultParams(s));
  return statsOf(r ?? {});
}

export async function resultsBreakdown(tx: Tx, s: ReadScope, display: { scaleMax: number; binWidth: number }): Promise<ResultsBreakdown> {
  const p = resultParams(s);
  const totals = await tx.queryOne<Record<string, any>>(`SELECT ${RESULT_SUMS} FROM ${RESULT_FROM} WHERE ${RESULT_WHERE}`, p);
  const scopesRow = await tx.queryOne<Record<string, any>>(
    `SELECT count(*) FILTER (WHERE rs.state = 'FINAL')::text AS final, count(*) FILTER (WHERE rs.state <> 'FINAL')::text AS not_final
       FROM analytics.result_scopes rs LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id = rs.classroom_id
      WHERE ($1::uuid IS NULL OR rs.year_id = $1) AND ($2::uuid IS NULL OR rs.period_id = $2) AND ($3::uuid IS NULL OR rs.classroom_id = $3)
        AND ($4::uuid IS NULL OR dc.institution_id = $4) AND ($5::uuid IS NULL OR dc.campus_id = $5) AND ($6::text IS NULL OR dc.grade_level_code = $6)`,
    p,
  );
  const byClassroom = await tx.many<Record<string, any>>(
    `SELECT rf.classroom_id AS id, max(dc.name) AS name, max(dc.grade_level_label) AS gl, ${RESULT_SUMS}
       FROM ${RESULT_FROM} WHERE ${RESULT_WHERE} GROUP BY rf.classroom_id ORDER BY max(dc.grade_level_label) NULLS LAST, max(dc.name) NULLS LAST, rf.classroom_id`,
    p,
  );
  const bySubject = await tx.many<Record<string, any>>(
    `SELECT min(rlf.node_id::text) AS id, rlf.node_code AS code, rlf.node_label AS label, rlf.level,
            count(rlf.value)::text AS cnt, avg(rlf.value)::text AS avg, min(rlf.value)::text AS min, max(rlf.value)::text AS max,
            count(*) FILTER (WHERE rlf.validated)::text AS validated, count(*) FILTER (WHERE rlf.validated IS NOT NULL)::text AS decided,
            count(*) FILTER (WHERE rlf.resit_eligible)::text AS resit, count(*) FILTER (WHERE rlf.session_obtained = 2)::text AS s2
       FROM analytics.result_line_facts rlf LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id = rlf.classroom_id
      WHERE rlf.level IN ('SUBJECT','ECUE','UE')
        AND ($1::uuid IS NULL OR rlf.year_id = $1) AND ($2::uuid IS NULL OR rlf.period_id = $2) AND ($3::uuid IS NULL OR rlf.classroom_id = $3)
        AND ($4::uuid IS NULL OR dc.institution_id = $4) AND ($5::uuid IS NULL OR dc.campus_id = $5) AND ($6::text IS NULL OR dc.grade_level_code = $6)
      GROUP BY rlf.node_code, rlf.node_label, rlf.level ORDER BY rlf.level, rlf.node_label, rlf.node_code`,
    p,
  );
  const byPeriod = await tx.many<Record<string, any>>(
    `SELECT rf.period_id AS id, max(dp.label) AS label, max(dp.ordinal) AS ordinal, max(dp.starts_on)::text AS starts, ${RESULT_SUMS}
       FROM ${RESULT_FROM} LEFT JOIN analytics.dim_period dp ON dp.period_id = rf.period_id
      WHERE ${RESULT_WHERE} GROUP BY rf.period_id ORDER BY max(dp.starts_on) NULLS LAST, max(dp.ordinal) NULLS LAST, rf.period_id`,
    resultParams(s, false),
  );
  const bins = binCount(display.scaleMax, display.binWidth);
  const distRows = await tx.many<{ bin: number; c: string }>(
    `SELECT LEAST($7::int - 1, FLOOR(LEAST(GREATEST(rf.average, 0), $8::numeric) / $9::numeric))::int AS bin, count(*)::text AS c
       FROM ${RESULT_FROM} WHERE rf.average IS NOT NULL AND ${RESULT_WHERE} GROUP BY 1`,
    [...p, Math.max(1, bins), display.scaleMax, display.binWidth],
  );
  const decisionsPeriod = await tx.many<{ code: string; outcome: string | null; c: string }>(
    `SELECT rf.decision_code AS code, rf.decision_outcome AS outcome, count(*)::text AS c
       FROM ${RESULT_FROM} WHERE rf.decision_code IS NOT NULL AND ${RESULT_WHERE} GROUP BY 1, 2 ORDER BY count(*) DESC, 1`,
    p,
  );
  const decisionsYear = await tx.many<{ code: string; outcome: string | null; c: string }>(
    `SELECT rf.year_decision_code AS code, rf.year_decision_outcome AS outcome, count(*)::text AS c
       FROM ${RESULT_FROM} WHERE rf.year_decision_code IS NOT NULL AND ${RESULT_WHERE} GROUP BY 1, 2 ORDER BY count(*) DESC, 1`,
    p,
  );
  return {
    totals: { ...statsOf(totals ?? {}), classPeriodsFinal: n(scopesRow?.final), classPeriodsNotFinal: n(scopesRow?.not_final) },
    byClassroom: byClassroom.map((r) => ({ classroomId: r.id, name: r.name ?? r.id, gradeLevelLabel: r.gl ?? "", ...statsOf(r) })),
    bySubject: bySubject.map((r) => ({ nodeId: r.id, code: r.code, label: r.label, level: r.level, resitEligibleCount: n(r.resit), session2Count: n(r.s2), ...statsOf(r) })),
    byPeriod: byPeriod.map((r) => ({ periodId: r.id, label: r.label ?? r.id, ordinal: n(r.ordinal), ...statsOf(r) })),
    distribution: { scaleMax: display.scaleMax, binWidth: display.binWidth, bins: buildBins(new Map(distRows.map((r) => [r.bin, n(r.c)])), display.scaleMax, display.binWidth) },
    decisions: {
      period: decisionsPeriod.map((r) => ({ code: r.code, outcome: r.outcome, count: n(r.c) })),
      year: decisionsYear.map((r) => ({ code: r.code, outcome: r.outcome, count: n(r.c) })),
    },
  };
}

/** Dernière période de l'année qui a des résultats FINAL (par date de fin) : la période « courante » des indicateurs. */
export async function latestFinalPeriod(tx: Tx, yearId: string | null): Promise<{ periodId: string; label: string } | null> {
  const r = await tx.queryOne<{ id: string; label: string | null }>(
    `SELECT rf.period_id AS id, max(dp.label) AS label
       FROM analytics.result_facts rf LEFT JOIN analytics.dim_period dp ON dp.period_id = rf.period_id
      WHERE ($1::uuid IS NULL OR rf.year_id = $1)
      GROUP BY rf.period_id ORDER BY max(dp.ends_on) DESC NULLS LAST, rf.period_id LIMIT 1`,
    [yearId],
  );
  return r ? { periodId: r.id, label: r.label ?? r.id } : null;
}

export async function teachingLoad(tx: Tx, yearId: string | null): Promise<Array<{ staffId: string; displayName: string; status: string | null; plannedHours: number; classroomCount: number; contractualHoursPerWeek: number | null }>> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT staff_id, display_name, status, planned_hours::text AS planned, classroom_count, contractual_hours_per_week::text AS contractual
       FROM analytics.teaching_load_facts WHERE ($1::uuid IS NULL OR year_id = $1) ORDER BY planned_hours DESC, display_name, staff_id`,
    [yearId],
  );
  return rows.map((r) => ({ staffId: r.staff_id, displayName: r.display_name, status: r.status, plannedHours: n(r.planned), classroomCount: n(r.classroom_count), contractualHoursPerWeek: r.contractual === null ? null : n(r.contractual) }));
}

// ------------------------------------------------------------------------------------------------------------------
// Finance
// ------------------------------------------------------------------------------------------------------------------

export interface FinanceKeys {
  yearKey: string;
  campusKey: string;
}

export async function financeSummaryRow(tx: Tx, k: FinanceKeys): Promise<Record<string, any> | null> {
  return await tx.queryOne<Record<string, any>>(
    `SELECT currency, as_of_date::text AS as_of, invoice_count, billed::text AS billed, credited::text AS credited, net_billed::text AS net_billed,
            collected::text AS collected, outstanding::text AS outstanding, overdue::text AS overdue, overdue_invoice_count,
            unallocated::text AS unallocated, collection_rate_bps
       FROM analytics.finance_summary WHERE year_key = $1 AND campus_key = $2 ORDER BY invoice_count DESC, currency LIMIT 1`,
    [k.yearKey, k.campusKey],
  );
}

export interface ReceivableRowOut {
  id: string;
  label: string | null;
  groupLabel: string | null;
  learnerCount: number;
  oldestOverdueDate: string | null;
  invoiceCount: number;
  billed: number;
  credited: number;
  collected: number;
  outstanding: number;
  overdue: number;
  collectionRateBps: number | null;
}

export async function receivablesByGroup(tx: Tx, k: FinanceKeys, input: { onlyOutstanding: boolean; limit: number; offset: number }): Promise<{ rows: ReceivableRowOut[]; total: number; currency: string | null }> {
  const where = `g.year_key = $1 AND g.campus_key = $2 AND ($3::boolean IS NOT TRUE OR g.outstanding > 0)`;
  const params = [k.yearKey, k.campusKey, input.onlyOutstanding];
  const rows = await tx.many<Record<string, any>>(
    `SELECT g.group_key AS id, COALESCE(g.label, dc.name) AS label, g.currency, g.invoice_count, g.learner_count, g.billed::text AS billed, g.credited::text AS credited,
            g.collected::text AS collected, g.outstanding::text AS outstanding, g.overdue::text AS overdue, g.collection_rate_bps
       FROM analytics.finance_by_group g LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id::text = g.group_key
      WHERE ${where} ORDER BY g.outstanding DESC, g.group_key LIMIT $4 OFFSET $5`,
    [...params, input.limit, input.offset],
  );
  const total = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM analytics.finance_by_group g WHERE ${where}`, params);
  return {
    total: n(total?.n),
    currency: rows[0]?.currency ?? null,
    rows: rows.map((r) => ({
      id: r.id,
      label: r.label,
      groupLabel: r.label,
      learnerCount: n(r.learner_count),
      oldestOverdueDate: null,
      invoiceCount: n(r.invoice_count),
      billed: num(r.billed),
      credited: num(r.credited),
      collected: num(r.collected),
      outstanding: num(r.outstanding),
      overdue: num(r.overdue),
      collectionRateBps: r.collection_rate_bps,
    })),
  };
}

export async function receivablesByLearner(tx: Tx, k: FinanceKeys, input: { onlyOutstanding: boolean; limit: number; offset: number }): Promise<{ rows: ReceivableRowOut[]; total: number; currency: string | null }> {
  const where = `l.year_key = $1 AND l.campus_key = $2 AND ($3::boolean IS NOT TRUE OR l.outstanding > 0)`;
  const params = [k.yearKey, k.campusKey, input.onlyOutstanding];
  const rows = await tx.many<Record<string, any>>(
    `SELECT l.learner_id AS id, l.learner_name AS name, COALESCE(l.label, dc.name) AS group_label, l.currency, l.invoice_count, l.billed::text AS billed, l.credited::text AS credited,
            l.collected::text AS collected, l.outstanding::text AS outstanding, l.overdue::text AS overdue, l.oldest_overdue_date::text AS oldest, l.collection_rate_bps
       FROM analytics.finance_by_learner l LEFT JOIN analytics.dim_classroom dc ON dc.classroom_id::text = l.group_key
      WHERE ${where} ORDER BY l.outstanding DESC, l.learner_id LIMIT $4 OFFSET $5`,
    [...params, input.limit, input.offset],
  );
  const total = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM analytics.finance_by_learner l WHERE ${where}`, params);
  return {
    total: n(total?.n),
    currency: rows[0]?.currency ?? null,
    rows: rows.map((r) => ({
      id: r.id,
      label: r.name,
      groupLabel: r.group_label,
      learnerCount: 1,
      oldestOverdueDate: r.oldest,
      invoiceCount: n(r.invoice_count),
      billed: num(r.billed),
      credited: num(r.credited),
      collected: num(r.collected),
      outstanding: num(r.outstanding),
      overdue: num(r.overdue),
      collectionRateBps: r.collection_rate_bps,
    })),
  };
}

export async function collectionsSeries(
  tx: Tx,
  input: { from: string; to: string; granularity: "day" | "week" | "month" },
): Promise<{ currency: string | null; points: Array<{ bucket: string; collected: number; refunded: number; net: number; paymentCount: number }> }> {
  if (!["day", "week", "month"].includes(input.granularity)) throw new Error("Granularité invalide.");
  const cur = await tx.queryOne<{ currency: string }>(`SELECT currency FROM analytics.collections_daily GROUP BY currency ORDER BY sum(collected) DESC, currency LIMIT 1`);
  const currency = cur?.currency ?? null;
  const rows = await tx.many<Record<string, any>>(
    `WITH buckets AS (
       SELECT generate_series(date_trunc($3, $1::date::timestamp), $2::date::timestamp, ('1 ' || $3)::interval)::date AS bucket
     ), agg AS (
       SELECT date_trunc($3, d.day::timestamp)::date AS bucket, sum(d.collected) AS collected, sum(d.refunded) AS refunded, sum(d.net) AS net, sum(d.payment_count) AS n
         FROM analytics.collections_daily d WHERE d.day BETWEEN $1::date AND $2::date AND ($4::text IS NULL OR d.currency = $4) GROUP BY 1
     )
     SELECT b.bucket::text AS bucket, COALESCE(a.collected, 0)::text AS collected, COALESCE(a.refunded, 0)::text AS refunded, COALESCE(a.net, 0)::text AS net, COALESCE(a.n, 0)::text AS n
       FROM buckets b LEFT JOIN agg a USING (bucket) ORDER BY b.bucket`,
    [input.from, input.to, input.granularity, currency],
  );
  return { currency, points: rows.map((r) => ({ bucket: r.bucket, collected: num(r.collected), refunded: num(r.refunded), net: num(r.net), paymentCount: n(r.n) })) };
}

export async function agedRows(tx: Tx, k: FinanceKeys, learnerLimit: number): Promise<{
  currency: string | null;
  asOf: string | null;
  buckets: Array<{ bucket: string; amount: number; invoiceCount: number }>;
  learners: Array<{ learnerId: string; learnerName: string | null; notDue: number; d1_30: number; d31_60: number; d61_90: number; d91_plus: number; total: number }>;
}> {
  const buckets = await tx.many<Record<string, any>>(
    `SELECT bucket, currency, amount::text AS amount, invoice_count, as_of_date::text AS as_of FROM analytics.finance_aged
      WHERE year_key = $1 AND campus_key = $2 ORDER BY CASE bucket WHEN 'NOT_DUE' THEN 0 WHEN 'D1_30' THEN 1 WHEN 'D31_60' THEN 2 WHEN 'D61_90' THEN 3 ELSE 4 END`,
    [k.yearKey, k.campusKey],
  );
  const learners = await tx.many<Record<string, any>>(
    `SELECT a.learner_id, l.learner_name AS name, a.not_due::text AS not_due, a.d1_30::text AS d1_30, a.d31_60::text AS d31_60, a.d61_90::text AS d61_90, a.d91_plus::text AS d91_plus, a.total::text AS total
       FROM analytics.finance_aged_learner a
       LEFT JOIN analytics.finance_by_learner l ON l.year_key = a.year_key AND l.campus_key = a.campus_key AND l.learner_id = a.learner_id AND l.currency = a.currency
      WHERE a.year_key = $1 AND a.campus_key = $2 ORDER BY a.total DESC, a.learner_id LIMIT $3`,
    [k.yearKey, k.campusKey, learnerLimit],
  );
  return {
    currency: buckets[0]?.currency ?? null,
    asOf: buckets[0]?.as_of ?? null,
    buckets: buckets.map((b) => ({ bucket: b.bucket, amount: num(b.amount), invoiceCount: n(b.invoice_count) })),
    learners: learners.map((l) => ({ learnerId: l.learner_id, learnerName: l.name, notDue: num(l.not_due), d1_30: num(l.d1_30), d31_60: num(l.d31_60), d61_90: num(l.d61_90), d91_plus: num(l.d91_plus), total: num(l.total) })),
  };
}

export async function cashSessions(tx: Tx, input: { from: string | null; to: string | null; limit: number }): Promise<{
  currency: string | null;
  totals: { sessions: number; closed: number; withVariance: number; netVariance: number; absoluteVariance: number };
  sessions: Array<{ sessionId: string; registerId: string | null; cashierId: string | null; status: "OPEN" | "CLOSED"; openedAt: string | null; closedAt: string | null; openingFloat: number; expected: number | null; counted: number | null; variance: number | null }>;
}> {
  const where = `($1::date IS NULL OR COALESCE(closed_at, opened_at) >= $1::date) AND ($2::date IS NULL OR COALESCE(closed_at, opened_at) < ($2::date + 1))`;
  const params = [input.from, input.to];
  const totals = await tx.queryOne<Record<string, any>>(
    `SELECT count(*)::text AS sessions, count(*) FILTER (WHERE status = 'CLOSED')::text AS closed,
            count(*) FILTER (WHERE variance IS NOT NULL AND variance <> 0)::text AS with_variance,
            COALESCE(sum(variance), 0)::text AS net, COALESCE(sum(abs(variance)), 0)::text AS abs, max(currency) AS currency
       FROM analytics.cash_session_facts WHERE ${where}`,
    params,
  );
  const rows = await tx.many<Record<string, any>>(
    `SELECT session_id, register_id, cashier_id, status, opened_at, closed_at, opening_float::text AS opening, expected::text AS expected, counted::text AS counted, variance::text AS variance
       FROM analytics.cash_session_facts WHERE ${where} ORDER BY COALESCE(closed_at, opened_at) DESC NULLS LAST, session_id LIMIT $3`,
    [...params, input.limit],
  );
  return {
    currency: totals?.currency ?? null,
    totals: { sessions: n(totals?.sessions), closed: n(totals?.closed), withVariance: n(totals?.with_variance), netVariance: num(totals?.net), absoluteVariance: num(totals?.abs) },
    sessions: rows.map((r) => ({
      sessionId: r.session_id,
      registerId: r.register_id,
      cashierId: r.cashier_id,
      status: r.status,
      openedAt: r.opened_at ? new Date(r.opened_at).toISOString() : null,
      closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
      openingFloat: num(r.opening),
      expected: numOrNull(r.expected),
      counted: numOrNull(r.counted),
      variance: numOrNull(r.variance),
    })),
  };
}

export async function payrollFacts(tx: Tx, input: { yearId: string | null; periodId: string | null }): Promise<Array<{ periodId: string; status: string; yearId: string | null; periodName: string; startsOn: string; endsOn: string; currency: string; payslipCount: number; total: number }>> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT period_id, status, year_id, period_name, starts_on::text AS starts_on, ends_on::text AS ends_on, currency, payslip_count, total::text AS total
       FROM analytics.payroll_status_facts WHERE ($1::uuid IS NULL OR year_id = $1) AND ($2::uuid IS NULL OR period_id = $2)
      ORDER BY starts_on DESC, period_id, status`,
    [input.yearId, input.periodId],
  );
  return rows.map((r) => ({ periodId: r.period_id, status: r.status, yearId: r.year_id, periodName: r.period_name, startsOn: r.starts_on, endsOn: r.ends_on, currency: r.currency, payslipCount: n(r.payslip_count), total: num(r.total) }));
}

// ------------------------------------------------------------------------------------------------------------------
// Réglages
// ------------------------------------------------------------------------------------------------------------------

export interface SettingsRow {
  collectionGoodBps: number | null;
  collectionWarningBps: number | null;
  attendanceGoodBps: number | null;
  attendanceWarningBps: number | null;
  staleAfterSeconds: number | null;
}

export async function selectSettings(tx: Tx): Promise<SettingsRow | null> {
  const r = await tx.queryOne<Record<string, any>>(`SELECT collection_good_bps, collection_warning_bps, attendance_good_bps, attendance_warning_bps, stale_after_seconds FROM analytics.settings LIMIT 1`);
  return r
    ? { collectionGoodBps: r.collection_good_bps, collectionWarningBps: r.collection_warning_bps, attendanceGoodBps: r.attendance_good_bps, attendanceWarningBps: r.attendance_warning_bps, staleAfterSeconds: r.stale_after_seconds }
    : null;
}

export async function upsertSettings(tx: Tx, input: { tenantId: string; userId: string | null; now: Date; values: Record<string, number> }): Promise<void> {
  const v = input.values;
  await tx.query(
    `INSERT INTO analytics.settings (tenant_id, collection_good_bps, collection_warning_bps, attendance_good_bps, attendance_warning_bps, stale_after_seconds, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id) DO UPDATE SET collection_good_bps = EXCLUDED.collection_good_bps, collection_warning_bps = EXCLUDED.collection_warning_bps,
       attendance_good_bps = EXCLUDED.attendance_good_bps, attendance_warning_bps = EXCLUDED.attendance_warning_bps, stale_after_seconds = EXCLUDED.stale_after_seconds,
       updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [input.tenantId, v.collectionGoodBps ?? null, v.collectionWarningBps ?? null, v.attendanceGoodBps ?? null, v.attendanceWarningBps ?? null, v.staleAfterSeconds ?? null, input.userId, input.now],
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Aperçu de la direction : instantanés du jour
// ------------------------------------------------------------------------------------------------------------------

export async function headcountOverview(tx: Tx, s: ReadScope): Promise<{ inSchooling: number; total: number; classrooms: number }> {
  const r = await tx.queryOne<Record<string, any>>(
    `SELECT count(*) FILTER (WHERE e.in_schooling)::text AS in_schooling, count(*)::text AS total,
            count(DISTINCT e.classroom_id) FILTER (WHERE e.in_schooling)::text AS classrooms
       FROM analytics.enrollment_facts e WHERE ${ENROLLMENT_WHERE}`,
    enrollmentParams(s),
  );
  return { inSchooling: n(r?.in_schooling), total: n(r?.total), classrooms: n(r?.classrooms) };
}

export async function attendanceOfDay(tx: Tx, s: ReadScope, day: string): Promise<AttendanceCounts & { measured: boolean }> {
  const r = await tx.queryOne<Record<string, any>>(
    `SELECT COALESCE(sum(a.records_count),0)::text AS records, COALESCE(sum(a.present_count),0)::text AS present, COALESCE(sum(a.absent_count),0)::text AS absent,
            COALESCE(sum(a.excused_count),0)::text AS excused, COALESCE(sum(a.late_count),0)::text AS late, COALESCE(sum(a.absent_minutes),0)::text AS minutes,
            count(*)::text AS rows
       FROM analytics.attendance_daily a WHERE ${ATT_WHERE}`,
    attParams(s, day, day),
  );
  return { ...toCounts(r ?? {}), measured: n(r?.rows) > 0 };
}

export async function staffOfDay(tx: Tx, day: string): Promise<{ present: number; absent: number; onLeave: number; measured: boolean }> {
  const r = await staffPresenceByDay(tx, { from: day, to: day });
  const d = r[0];
  return { present: d?.present ?? 0, absent: d?.absent ?? 0, onLeave: d?.onLeave ?? 0, measured: r.length > 0 };
}
