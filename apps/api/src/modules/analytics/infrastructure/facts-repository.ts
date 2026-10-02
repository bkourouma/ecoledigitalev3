/**
 * Écriture des read-models : chaque fonction REMPLACE le contenu de son périmètre (suppression puis insertion dans la
 * même transaction) — rejouer une passe sur la même source donne exactement le même contenu (idempotence), et une
 * ligne disparue de la source disparaît du read-model.
 *
 * Aucune lecture d'un autre schéma : les faits arrivent par les ports de `application/ports.ts`.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  AttendanceDayFact,
  CashSessionFact,
  ClassPeriodResults,
  ClassroomFact,
  CollectionPointFact,
  EnrollmentFact,
  FinanceScopeFacts,
  PayrollStatusFact,
  PeriodFact,
  ScopeFact,
  StaffPresenceFact,
  TeachingLoadFact,
  YearFact,
} from "../domain/types";
import { AGING_BUCKET_KEYS } from "../domain/types";
import { big, bulkInsert } from "./sql";

// ------------------------------------------------------------------------------------------------------------------
// Dimensions
// ------------------------------------------------------------------------------------------------------------------

export async function replaceScopes(tx: Tx, tenantId: string, scopes: readonly ScopeFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.dim_scope`);
  return bulkInsert(
    tx,
    "analytics.dim_scope",
    ["tenant_id", "scope_kind", "scope_id", "parent_id", "label", "status", "refreshed_at"],
    scopes.map((s) => [tenantId, s.kind, s.id, s.parentId, s.label, s.status, now]),
  );
}

export interface CalendarFacts {
  years: readonly YearFact[];
  periods: readonly PeriodFact[];
  classrooms: readonly ClassroomFact[];
}

export async function replaceCalendar(tx: Tx, tenantId: string, facts: CalendarFacts, now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.dim_year`);
  await tx.query(`DELETE FROM analytics.dim_period`);
  await tx.query(`DELETE FROM analytics.dim_classroom`);
  let n = 0;
  n += await bulkInsert(
    tx,
    "analytics.dim_year",
    ["tenant_id", "year_id", "institution_id", "code", "label", "starts_on", "ends_on", "status", "is_current", "refreshed_at"],
    facts.years.map((y) => [tenantId, y.id, y.institutionId, y.code, y.label, y.startsOn, y.endsOn, y.status, y.isCurrent, now]),
  );
  n += await bulkInsert(
    tx,
    "analytics.dim_period",
    ["tenant_id", "period_id", "year_id", "code", "label", "ordinal", "starts_on", "ends_on", "status", "refreshed_at"],
    facts.periods.map((p) => [tenantId, p.id, p.yearId, p.code, p.label, p.ordinal, p.startsOn, p.endsOn, p.status, now]),
  );
  n += await bulkInsert(
    tx,
    "analytics.dim_classroom",
    ["tenant_id", "classroom_id", "institution_id", "campus_id", "year_id", "name", "grade_level_code", "grade_level_label", "education_level_code", "program_label", "kind", "status", "headcount", "refreshed_at"],
    facts.classrooms.map((c) => [tenantId, c.id, c.institutionId, c.campusId, c.yearId, c.name, c.gradeLevelCode, c.gradeLevelLabel, c.educationLevelCode, c.programLabel, c.kind, c.status, c.headcount, now]),
  );
  return n;
}

// ------------------------------------------------------------------------------------------------------------------
// Inscriptions
// ------------------------------------------------------------------------------------------------------------------

export async function replaceEnrollments(tx: Tx, tenantId: string, yearId: string | null, facts: readonly EnrollmentFact[], now: Date): Promise<number> {
  if (yearId === null) await tx.query(`DELETE FROM analytics.enrollment_facts`);
  else await tx.query(`DELETE FROM analytics.enrollment_facts WHERE year_id = $1`, [yearId]);
  return bulkInsert(
    tx,
    "analytics.enrollment_facts",
    ["tenant_id", "enrollment_id", "student_id", "institution_id", "campus_id", "year_id", "classroom_id", "status", "funding_type", "sex", "is_repeating", "in_schooling", "source_kind", "enrolled_on", "ended_on", "created_at", "confirmed_at", "cancelled_at", "refreshed_at"],
    facts.map((e) => [tenantId, e.enrollmentId, e.studentId, e.institutionId, e.campusId, e.yearId, e.classroomId, e.status, e.fundingType, e.sex, e.isRepeating, e.inSchooling, e.sourceKind, e.enrolledOn, e.endedOn, e.createdAt, e.confirmedAt, e.cancelledAt, now]),
    "ON CONFLICT (tenant_id, enrollment_id) DO UPDATE SET student_id = EXCLUDED.student_id, institution_id = EXCLUDED.institution_id, campus_id = EXCLUDED.campus_id, year_id = EXCLUDED.year_id, classroom_id = EXCLUDED.classroom_id, status = EXCLUDED.status, funding_type = EXCLUDED.funding_type, sex = EXCLUDED.sex, is_repeating = EXCLUDED.is_repeating, in_schooling = EXCLUDED.in_schooling, source_kind = EXCLUDED.source_kind, enrolled_on = EXCLUDED.enrolled_on, ended_on = EXCLUDED.ended_on, created_at = EXCLUDED.created_at, confirmed_at = EXCLUDED.confirmed_at, cancelled_at = EXCLUDED.cancelled_at, refreshed_at = EXCLUDED.refreshed_at",
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Résultats
// ------------------------------------------------------------------------------------------------------------------

/** Remplace les faits d'UNE (classe, période). Un état non FINAL retire les faits (période rouverte) et le consigne. */
export async function replaceClassPeriodResults(tx: Tx, tenantId: string, data: ClassPeriodResults, now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.result_line_facts WHERE classroom_id = $1 AND period_id = $2`, [data.classroomId, data.periodId]);
  await tx.query(`DELETE FROM analytics.result_facts WHERE classroom_id = $1 AND period_id = $2`, [data.classroomId, data.periodId]);
  await tx.query(
    `INSERT INTO analytics.result_scopes (tenant_id, classroom_id, period_id, year_id, state, results_count, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, classroom_id, period_id)
     DO UPDATE SET year_id = EXCLUDED.year_id, state = EXCLUDED.state, results_count = EXCLUDED.results_count, refreshed_at = EXCLUDED.refreshed_at`,
    [tenantId, data.classroomId, data.periodId, data.yearId, data.state, data.state === "FINAL" ? data.results.length : 0, now],
  );
  if (data.state !== "FINAL" || data.yearId === null) return 0;
  const yearId = data.yearId;
  let n = await bulkInsert(
    tx,
    "analytics.result_facts",
    ["tenant_id", "enrollment_id", "period_id", "student_id", "classroom_id", "year_id", "results_version", "average", "rank", "cohort_size", "mention_code", "decision_code", "decision_outcome", "year_decision_code", "year_decision_outcome", "validated", "credits_acquired", "credits_required", "finalized_at", "refreshed_at"],
    data.results.map((r) => [tenantId, r.enrollmentId, data.periodId, r.studentId, data.classroomId, yearId, r.resultsVersion, r.average, r.rank, r.cohortSize, r.mentionCode, r.decisionCode, r.decisionOutcome, r.yearDecisionCode, r.yearDecisionOutcome, r.validated, r.creditsAcquired, r.creditsRequired, r.finalizedAt, now]),
  );
  n += await bulkInsert(
    tx,
    "analytics.result_line_facts",
    ["tenant_id", "enrollment_id", "period_id", "node_id", "classroom_id", "year_id", "level", "node_code", "node_label", "value", "validated", "session_obtained", "resit_eligible", "refreshed_at"],
    data.lines.map((l) => [tenantId, l.enrollmentId, data.periodId, l.nodeId, data.classroomId, yearId, l.level, l.nodeCode, l.nodeLabel, l.value, l.validated, l.sessionObtained, l.resitEligible, now]),
    "ON CONFLICT (tenant_id, enrollment_id, period_id, node_id) DO NOTHING",
  );
  return n;
}

// ------------------------------------------------------------------------------------------------------------------
// Présences
// ------------------------------------------------------------------------------------------------------------------

export async function replaceAttendanceRange(tx: Tx, tenantId: string, range: { from: string; to: string }, facts: readonly AttendanceDayFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.attendance_daily WHERE day BETWEEN $1::date AND $2::date`, [range.from, range.to]);
  return bulkInsert(
    tx,
    "analytics.attendance_daily",
    ["tenant_id", "day", "classroom_id", "year_id", "institution_id", "campus_id", "sessions_count", "records_count", "present_count", "absent_count", "excused_count", "late_count", "absent_minutes", "refreshed_at"],
    facts.map((f) => [tenantId, f.day, f.classroomId, f.yearId, f.institutionId, f.campusId, f.sessionsCount, f.recordsCount, f.presentCount, f.absentCount, f.excusedCount, f.lateCount, f.absentMinutes, now]),
    "ON CONFLICT (tenant_id, day, classroom_id) DO NOTHING",
  );
}

export async function replaceStaffPresenceRange(tx: Tx, tenantId: string, range: { from: string; to: string }, facts: readonly StaffPresenceFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.staff_presence_facts WHERE day BETWEEN $1::date AND $2::date`, [range.from, range.to]);
  return bulkInsert(
    tx,
    "analytics.staff_presence_facts",
    ["tenant_id", "day", "staff_id", "status_code", "present", "absent", "on_leave", "refreshed_at"],
    facts.map((f) => [tenantId, f.day, f.staffId, f.statusCode, f.present, f.absent, f.onLeave, now]),
    "ON CONFLICT (tenant_id, day, staff_id) DO NOTHING",
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Finance
// ------------------------------------------------------------------------------------------------------------------

export async function replaceFinance(tx: Tx, tenantId: string, scopes: readonly FinanceScopeFacts[], now: Date): Promise<number> {
  for (const table of ["finance_summary", "finance_by_group", "finance_by_learner", "finance_aged", "finance_aged_learner"]) await tx.query(`DELETE FROM analytics.${table}`);
  let n = 0;
  for (const s of scopes) {
    const c = s.summary.currency;
    n += await bulkInsert(
      tx,
      "analytics.finance_summary",
      ["tenant_id", "year_key", "campus_key", "currency", "as_of_date", "invoice_count", "billed", "credited", "net_billed", "collected", "outstanding", "overdue", "overdue_invoice_count", "unallocated", "collection_rate_bps", "computed_at"],
      [[tenantId, s.yearKey, s.campusKey, c, s.summary.asOf, s.summary.invoiceCount, big(s.summary.billed), big(s.summary.credited), big(s.summary.netBilled), big(s.summary.collected), big(s.summary.outstanding), big(s.summary.overdue), s.summary.overdueInvoiceCount, big(s.summary.unallocated), s.summary.collectionRateBps, now]],
    );
    n += await bulkInsert(
      tx,
      "analytics.finance_by_group",
      ["tenant_id", "year_key", "campus_key", "group_key", "currency", "label", "invoice_count", "learner_count", "billed", "credited", "collected", "outstanding", "overdue", "collection_rate_bps", "computed_at"],
      s.byGroup.map((g) => [tenantId, s.yearKey, s.campusKey, g.groupKey, c, g.label, g.invoiceCount, g.learnerCount, big(g.billed), big(g.credited), big(g.collected), big(g.outstanding), big(g.overdue), g.collectionRateBps, now]),
      "ON CONFLICT DO NOTHING",
    );
    n += await bulkInsert(
      tx,
      "analytics.finance_by_learner",
      ["tenant_id", "year_key", "campus_key", "learner_id", "currency", "learner_name", "group_key", "label", "invoice_count", "billed", "credited", "collected", "outstanding", "overdue", "oldest_overdue_date", "collection_rate_bps", "computed_at"],
      s.byLearner.map((l) => [tenantId, s.yearKey, s.campusKey, l.learnerId, c, l.learnerName, l.groupKey, l.label, l.invoiceCount, big(l.billed), big(l.credited), big(l.collected), big(l.outstanding), big(l.overdue), l.oldestOverdueDate, l.collectionRateBps, now]),
      "ON CONFLICT DO NOTHING",
    );
    n += await bulkInsert(
      tx,
      "analytics.finance_aged",
      ["tenant_id", "year_key", "campus_key", "bucket", "currency", "amount", "invoice_count", "as_of_date", "computed_at"],
      AGING_BUCKET_KEYS.map((b) => [tenantId, s.yearKey, s.campusKey, b, s.aged.currency, big(s.aged.buckets[b].amount), s.aged.buckets[b].invoiceCount, s.aged.asOf, now]),
    );
    n += await bulkInsert(
      tx,
      "analytics.finance_aged_learner",
      ["tenant_id", "year_key", "campus_key", "learner_id", "currency", "not_due", "d1_30", "d31_60", "d61_90", "d91_plus", "total", "computed_at"],
      s.aged.learners.map((l) => [tenantId, s.yearKey, s.campusKey, l.learnerId, s.aged.currency, big(l.buckets.NOT_DUE), big(l.buckets.D1_30), big(l.buckets.D31_60), big(l.buckets.D61_90), big(l.buckets.D91_PLUS), big(l.total), now]),
      "ON CONFLICT DO NOTHING",
    );
  }
  return n;
}

export async function replaceCollectionsRange(tx: Tx, tenantId: string, range: { from: string; to: string }, points: readonly CollectionPointFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.collections_daily WHERE day BETWEEN $1::date AND $2::date`, [range.from, range.to]);
  return bulkInsert(
    tx,
    "analytics.collections_daily",
    ["tenant_id", "day", "currency", "collected", "refunded", "net", "payment_count", "computed_at"],
    points.map((p) => [tenantId, p.day, p.currency, big(p.collected), big(p.refunded), big(p.net), p.paymentCount, now]),
    "ON CONFLICT (tenant_id, day, currency) DO NOTHING",
  );
}

export async function replaceCashSessions(tx: Tx, tenantId: string, sessions: readonly CashSessionFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.cash_session_facts`);
  return bulkInsert(
    tx,
    "analytics.cash_session_facts",
    ["tenant_id", "session_id", "register_id", "cashier_id", "currency", "status", "opened_at", "closed_at", "opening_float", "expected", "counted", "variance", "refreshed_at"],
    sessions.map((s) => [tenantId, s.sessionId, s.registerId, s.cashierId, s.currency, s.status, s.openedAt, s.closedAt, big(s.openingFloat), big(s.expected), big(s.counted), big(s.variance), now]),
    "ON CONFLICT (tenant_id, session_id) DO NOTHING",
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Paie et charge d'enseignement
// ------------------------------------------------------------------------------------------------------------------

export async function replacePayroll(tx: Tx, tenantId: string, facts: readonly PayrollStatusFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.payroll_status_facts`);
  return bulkInsert(
    tx,
    "analytics.payroll_status_facts",
    ["tenant_id", "period_id", "status", "year_id", "period_name", "starts_on", "ends_on", "currency", "payslip_count", "total", "refreshed_at"],
    facts.map((f) => [tenantId, f.periodId, f.status, f.yearId, f.periodName, f.startsOn, f.endsOn, f.currency, f.payslipCount, big(f.total), now]),
    "ON CONFLICT (tenant_id, period_id, status) DO NOTHING",
  );
}

export async function replaceTeachingLoad(tx: Tx, tenantId: string, yearId: string, facts: readonly TeachingLoadFact[], now: Date): Promise<number> {
  await tx.query(`DELETE FROM analytics.teaching_load_facts WHERE year_id = $1`, [yearId]);
  return bulkInsert(
    tx,
    "analytics.teaching_load_facts",
    ["tenant_id", "staff_id", "year_id", "display_name", "status", "planned_hours", "classroom_count", "contractual_hours_per_week", "refreshed_at"],
    facts.map((f) => [tenantId, f.staffId, yearId, f.displayName, f.status, f.plannedHours, f.classroomCount, f.contractualHoursPerWeek, now]),
    "ON CONFLICT (tenant_id, staff_id, year_id) DO NOTHING",
  );
}
