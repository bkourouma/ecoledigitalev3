"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAnalyticsAttendance, useAnalyticsEnrollment } from "@/platform/v2/analytics";
import { DataTable } from "@/platform/ui/DataTable";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { Can } from "@/platform/ui/AccessGate";
import { BarChart, ColumnChart, type ChartRow } from "../../owner/_components/charts";
import { ExportButton, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, StatusLabel, useScopeState, type ScopeField } from "../../owner/_components/kit";

const FIELDS: readonly ScopeField[] = ["institution", "campus", "year", "classroom"];

/** Effectifs, répartitions, admissions et présences : mêmes périmètres, une réponse d'API par bloc. */
export function EnrollmentScreen() {
  return (
    <FeatureGuard>
      <Enrollment />
    </FeatureGuard>
  );
}

function Enrollment() {
  const t = useTranslations("v2Direction.enrollment");
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  const query = useAnalyticsEnrollment(filters);
  const data = query.data?.data;

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("kpi.inSchooling")} value={date.number(data.totals.inSchooling)} detail={t("kpi.inSchoolingDetail", { total: data.totals.total })} />
            <KpiCard label={t("kpi.repeaters")} value={date.number(data.totals.repeaters)} detail={t("kpi.repeatersDetail")} />
            <KpiCard label={t("kpi.repeaterRate")} value={<Pct bps={data.totals.repeaterRateBps} />} measured={data.totals.repeaterRateBps !== null} />
          </KpiGrid>

          <Section id="enr-split" title={t("split.title")} actions={<ExportButton dataset="enrollment-by-classroom" query={filters as Record<string, string>} />}>
            <div className="grid gap-4 lg:grid-cols-2">
              <BarChart title={t("split.sex")} rows={countRows(data.bySex, (k) => t(`sex.${k === "M" || k === "F" ? k : "UNKNOWN"}`))} valueHeader={t("split.count")} noteHeader={t("split.inSchooling")} empty={t("split.empty")} />
              <BarChart title={t("split.gradeLevel")} rows={countRows(data.byGradeLevel, (k, label) => (k === "UNKNOWN" ? t("split.unknown") : label))} valueHeader={t("split.count")} noteHeader={t("split.inSchooling")} empty={t("split.empty")} />
              <BarChart title={t("split.funding")} rows={countRows(data.byFunding, (k) => t(`funding.${FUNDING_KEYS.includes(k) ? k : "OTHER"}`))} valueHeader={t("split.count")} noteHeader={t("split.inSchooling")} empty={t("split.empty")} />
              <BarChart title={t("split.status")} rows={countRows(data.byStatus, (k) => t(`status.${STATUS_KEYS.includes(k) ? k : "OTHER"}`))} valueHeader={t("split.count")} noteHeader={t("split.inSchooling")} empty={t("split.empty")} />
              {data.byCampus.length > 1 ? <BarChart title={t("split.campus")} rows={countRows(data.byCampus, (k, label) => (k === "NONE" ? t("split.noCampus") : label))} valueHeader={t("split.count")} noteHeader={t("split.inSchooling")} empty={t("split.empty")} /> : null}
            </div>
            <DataTable
              caption={t("classrooms.caption")}
              columns={[
                { id: "name", header: t("classrooms.name"), rowHeader: true, cell: (r) => r.name },
                { id: "level", header: t("classrooms.level"), cell: (r) => r.gradeLevelLabel, className: "hidden sm:table-cell" },
                { id: "inSchooling", header: t("classrooms.inSchooling"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{r.inSchooling}</span> },
                { id: "female", header: t("classrooms.female"), align: "right", cell: (r) => <span className="tabular-nums">{r.female}</span>, className: "hidden md:table-cell" },
                { id: "male", header: t("classrooms.male"), align: "right", cell: (r) => <span className="tabular-nums">{r.male}</span>, className: "hidden md:table-cell" },
                { id: "count", header: t("classrooms.count"), align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span>, className: "hidden lg:table-cell" },
              ]}
              rows={data.byClassroom}
              getRowId={(r) => r.classroomId}
              emptyTitle={t("classrooms.empty")}
            />
          </Section>

          <Section id="enr-admissions" title={t("admissions.title")}>
            <KpiGrid label={t("admissions.kpiLabel")}>
              <KpiCard label={t("admissions.created")} value={date.number(data.admissions.created)} />
              <KpiCard label={t("admissions.confirmed")} value={date.number(data.admissions.confirmed)} />
              <KpiCard label={t("admissions.cancelled")} value={date.number(data.admissions.cancelled)} />
              <KpiCard label={t("admissions.rate")} value={<Pct bps={data.admissions.confirmationRateBps} />} measured={data.admissions.confirmationRateBps !== null} />
            </KpiGrid>
            <div className="grid gap-4 lg:grid-cols-2">
              <ColumnChart
                title={t("admissions.monthly")}
                summary={t("admissions.monthlySummary", { count: data.admissions.monthly.length })}
                rows={data.admissions.monthly.map((m) => ({ key: m.month, label: m.month, value: m.created, display: String(m.created), note: t("admissions.confirmedNote", { count: m.confirmed }) }))}
                valueHeader={t("admissions.created")}
                noteHeader={t("admissions.confirmed")}
                empty={t("admissions.empty")}
              />
              <BarChart
                title={t("admissions.bySource")}
                rows={data.admissions.bySource.map((s) => ({ key: s.sourceKind, label: t(`source.${SOURCE_KEYS.includes(s.sourceKind) ? s.sourceKind : "OTHER"}`), value: s.created, display: String(s.created), note: t("admissions.confirmedNote", { count: s.confirmed }) }))}
                valueHeader={t("admissions.created")}
                noteHeader={t("admissions.confirmed")}
                empty={t("admissions.empty")}
              />
            </div>
          </Section>
        </>
      ) : null}

      <Can permission="analytics.attendance.read">
        <AttendanceSection filters={filters} />
      </Can>
    </div>
  );
}

const FUNDING_KEYS = ["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"];
const STATUS_KEYS = ["PENDING", "ACTIVE", "CONFIRMED", "SUSPENDED", "WITHDRAWN", "CANCELLED", "COMPLETED", "OTHER"];
const SOURCE_KEYS = ["ADMISSION", "IMPORT", "MANUAL", "ROLLOVER", "ONLINE", "UNKNOWN", "OTHER"];

function Pct({ bps }: { bps: number | null }) {
  const money = useMoney();
  return <>{money.bps(bps)}</>;
}

function countRows(rows: ReadonlyArray<{ key: string; label: string; count: number; inSchooling: number }>, label: (key: string, original: string) => string): ChartRow[] {
  return rows.map((r) => ({ key: r.key, label: label(r.key, r.label), value: r.count, display: String(r.count), note: String(r.inSchooling) }));
}

function AttendanceSection({ filters }: { filters: ReturnType<typeof scopeFilters> }) {
  const t = useTranslations("v2Direction.attendance");
  const money = useMoney();
  const date = useDateFormat();
  const allowed = usePermission("analytics.attendance.read");
  const [range, setRange] = useState({ from: "", to: "" });
  const query = useAnalyticsAttendance({ ...filters, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) }, { enabled: allowed.allowed });
  const data = query.data?.data;
  const exportQuery = { ...(filters as Record<string, string>), ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  return (
    <Section id="att" title={t("title")} actions={<ExportButton dataset="attendance-by-classroom" query={exportQuery} />}>
      <form className="grid gap-3 sm:grid-cols-3" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("range.label")}>
        <FormField label={t("range.from")} hint={t("range.hint")}>
          {(c) => <TextControl {...c} type="date" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />}
        </FormField>
        <FormField label={t("range.to")}>{(c) => <TextControl {...c} type="date" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />}</FormField>
      </form>
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard
              label={t("kpi.rate")}
              value={money.bps(data.totals.rateBps)}
              detail={t("kpi.rateDetail", { present: data.totals.presentCount, records: data.totals.recordsCount, from: date.civil(data.range.from), to: date.civil(data.range.to) })}
              status={data.totals.status}
              measured={data.totals.rateBps !== null}
            />
            <KpiCard label={t("kpi.absent")} value={date.number(data.totals.absentCount)} detail={t("kpi.absentDetail", { excused: data.totals.excusedCount, minutes: data.totals.absentMinutes })} />
            <KpiCard label={t("kpi.late")} value={date.number(data.totals.lateCount)} />
            <KpiCard label={t("kpi.sessions")} value={date.number(data.totals.sessionsCount)} />
          </KpiGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <ColumnChart
              title={t("byDay.title")}
              summary={t("byDay.summary", { count: data.byDay.length })}
              rows={data.byDay.map((d) => ({ key: d.day, label: d.day.slice(5), value: d.rateBps ?? 0, display: money.bps(d.rateBps), note: t("byDay.note", { present: d.presentCount, records: d.recordsCount }) }))}
              valueHeader={t("byDay.rate")}
              noteHeader={t("byDay.counts")}
              empty={t("empty")}
            />
            <BarChart
              title={t("staff.title")}
              rows={data.staff.byDay.map((d) => ({ key: d.day, label: date.civil(d.day), value: d.present, display: String(d.present), note: t("staff.note", { absent: d.absent, leave: d.onLeave }) }))}
              valueHeader={t("staff.present")}
              noteHeader={t("staff.others")}
              empty={data.staff.measured ? t("empty") : t("staff.notMeasured")}
            />
          </div>
          <DataTable
            caption={t("byClassroom.caption")}
            columns={[
              { id: "name", header: t("byClassroom.name"), rowHeader: true, cell: (r) => r.name },
              { id: "rate", header: t("byClassroom.rate"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.bps(r.rateBps)}</span> },
              { id: "status", header: t("byClassroom.status"), cell: (r) => <StatusLabel status={r.status} /> },
              { id: "absent", header: t("byClassroom.absent"), align: "right", cell: (r) => <span className="tabular-nums">{r.absentCount}</span>, className: "hidden sm:table-cell" },
              { id: "late", header: t("byClassroom.late"), align: "right", cell: (r) => <span className="tabular-nums">{r.lateCount}</span>, className: "hidden md:table-cell" },
              { id: "records", header: t("byClassroom.records"), align: "right", cell: (r) => <span className="tabular-nums">{r.recordsCount}</span>, className: "hidden lg:table-cell" },
            ]}
            rows={data.byClassroom}
            getRowId={(r) => r.classroomId}
            emptyTitle={t("empty")}
          />
        </>
      ) : null}
    </Section>
  );
}
