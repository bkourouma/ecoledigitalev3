"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAnalyticsResults, useAnalyticsTeachingLoad } from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { BarChart, ColumnChart } from "./charts";
import { DemoRulesBanner, ExportButton, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "./kit";

const FIELDS: readonly ScopeField[] = ["institution", "campus", "year", "period", "classroom"];
const OUTCOMES = ["ADMITTED", "RESIT", "ADJOURNED", "PROMOTED", "REPEAT", "PENDING", "EXAM_REFERRAL", "COUNCIL_REVIEW", "OTHER"];

/**
 * Pédagogie : résultats FINAL de `results` (moyennes, validation, décisions) par classe, matière et période, histogramme des
 * moyennes, charge d'enseignement. Les valeurs sont celles que `results` a calculées avec les règles de l'établissement ;
 * l'écran n'applique ni seuil de réussite ni formule.
 */
export function PedagogyScreen() {
  return (
    <FeatureGuard>
      <Pedagogy />
    </FeatureGuard>
  );
}

function Pedagogy() {
  const t = useTranslations("v2Owner.pedagogy");
  const money = useMoney();
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  const query = useAnalyticsResults(filters);
  const data = query.data?.data;
  // Matières à faible validation : tri de PRÉSENTATION (les taux viennent de l'API) ; seules les lignes mesurées sont classées.
  const struggling = useMemo(
    () =>
      (data?.bySubject ?? [])
        .filter((s) => s.level !== "UE" && s.validationRateBps !== null && s.count > 0)
        .sort((a, b) => (a.validationRateBps as number) - (b.validationRateBps as number))
        .slice(0, 10),
    [data],
  );
  const outcomeLabel = (outcome: string | null) => (outcome ? t(`outcome.${OUTCOMES.includes(outcome) ? outcome : "OTHER"}`) : t("outcome.none"));

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <DemoRulesBanner rulesSource={data.rulesSource} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("kpi.average")} value={data.totals.average === null ? "—" : date.number(data.totals.average)} detail={t("kpi.averageDetail", { min: date.number(data.totals.min), max: date.number(data.totals.max) })} measured={data.totals.count > 0 && data.totals.average !== null} />
            <KpiCard label={t("kpi.validation")} value={money.bps(data.totals.validationRateBps)} detail={t("kpi.validationDetail", { validated: data.totals.validatedCount, count: data.totals.count })} measured={data.totals.validationRateBps !== null} />
            <KpiCard label={t("kpi.cohort")} value={date.number(data.totals.count)} detail={t("kpi.cohortDetail")} />
            <KpiCard label={t("kpi.closed")} value={date.number(data.totals.classPeriodsFinal)} detail={t("kpi.closedDetail", { open: data.totals.classPeriodsNotFinal })} />
          </KpiGrid>

          <Section id="ped-distribution" title={t("distribution.title")}>
            <p className="text-sm text-muted-foreground">{t("distribution.note", { max: data.distribution.scaleMax, width: data.distribution.binWidth })}</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <ColumnChart
                title={t("distribution.chart")}
                summary={t("distribution.summary", { count: data.totals.count })}
                rows={data.distribution.bins.map((b) => ({ key: String(b.index), label: `${b.from}-${b.to}`, value: b.count, display: String(b.count) }))}
                valueHeader={t("distribution.count")}
                empty={t("empty")}
              />
              <ColumnChart
                title={t("byPeriod.title")}
                summary={t("byPeriod.summary", { count: data.byPeriod.length })}
                rows={data.byPeriod.map((p) => ({ key: p.periodId, label: p.demonstration ? `${p.label} (${t("byPeriod.demo")})` : p.label, value: p.average ?? 0, display: p.average === null ? "—" : date.number(p.average), note: money.bps(p.validationRateBps) }))}
                valueHeader={t("byPeriod.average")}
                noteHeader={t("byPeriod.validation")}
                empty={t("empty")}
              />
            </div>
          </Section>

          <Section id="ped-classrooms" title={t("classrooms.title")} actions={<ExportButton dataset="results-by-classroom" query={filters as Record<string, string>} />}>
            <DataTable
              caption={t("classrooms.caption")}
              columns={[
                { id: "name", header: t("classrooms.name"), rowHeader: true, cell: (r) => r.name },
                { id: "level", header: t("classrooms.level"), cell: (r) => r.gradeLevelLabel, className: "hidden md:table-cell" },
                { id: "count", header: t("classrooms.count"), align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span>, className: "hidden sm:table-cell" },
                { id: "average", header: t("classrooms.average"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{r.average === null ? "—" : date.number(r.average)}</span> },
                { id: "validation", header: t("classrooms.validation"), align: "right", cell: (r) => <span className="tabular-nums">{money.bps(r.validationRateBps)}</span> },
                { id: "range", header: t("classrooms.range"), align: "right", cell: (r) => <span className="tabular-nums">{r.min === null ? "—" : `${r.min} – ${r.max}`}</span>, className: "hidden lg:table-cell" },
              ]}
              rows={data.byClassroom}
              getRowId={(r) => r.classroomId}
              emptyTitle={t("empty")}
            />
          </Section>

          <Section id="ped-subjects" title={t("subjects.title")} actions={<ExportButton dataset="results-by-subject" query={filters as Record<string, string>} />}>
            <BarChart
              title={t("subjects.struggling")}
              rows={struggling.map((s) => ({ key: `${s.level}-${s.code}-${s.label}`, label: s.label || s.code, value: s.validationRateBps ?? 0, display: money.bps(s.validationRateBps), note: t("subjects.note", { validated: s.validatedCount, count: s.count }) }))}
              valueHeader={t("subjects.validation")}
              noteHeader={t("subjects.counts")}
              empty={t("subjects.noneMeasured")}
            />
            <DataTable
              caption={t("subjects.caption")}
              columns={[
                { id: "label", header: t("subjects.name"), rowHeader: true, cell: (r) => r.label || r.code },
                { id: "level", header: t("subjects.level"), cell: (r) => t(`level.${r.level === "UE" || r.level === "ECUE" ? r.level : "SUBJECT"}`), className: "hidden sm:table-cell" },
                { id: "average", header: t("subjects.average"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{r.average === null ? "—" : date.number(r.average)}</span> },
                { id: "validation", header: t("subjects.validation"), align: "right", cell: (r) => <span className="tabular-nums">{money.bps(r.validationRateBps)}</span> },
                { id: "resit", header: t("subjects.resit"), align: "right", cell: (r) => <span className="tabular-nums">{r.resitEligibleCount}</span>, className: "hidden md:table-cell" },
                { id: "session2", header: t("subjects.session2"), align: "right", cell: (r) => <span className="tabular-nums">{r.session2Count}</span>, className: "hidden md:table-cell" },
              ]}
              rows={data.bySubject}
              getRowId={(r) => `${r.level}-${r.code}-${r.label}`}
              emptyTitle={t("empty")}
            />
          </Section>

          <Section id="ped-decisions" title={t("decisions.title")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <BarChart
                title={t("decisions.period")}
                rows={data.decisions.period.map((d) => ({ key: `${d.code}-${d.outcome}`, label: `${outcomeLabel(d.outcome)} (${d.code})`, value: d.count, display: String(d.count) }))}
                valueHeader={t("decisions.count")}
                empty={t("decisions.none")}
              />
              <BarChart
                title={t("decisions.year")}
                rows={data.decisions.year.map((d) => ({ key: `${d.code}-${d.outcome}`, label: `${outcomeLabel(d.outcome)} (${d.code})`, value: d.count, display: String(d.count) }))}
                valueHeader={t("decisions.count")}
                empty={t("decisions.none")}
              />
            </div>
          </Section>
        </>
      ) : null}

      <Can permission="analytics.pedagogy.read">
        <TeachingLoadSection filters={filters} />
      </Can>
    </div>
  );
}

function TeachingLoadSection({ filters }: { filters: ReturnType<typeof scopeFilters> }) {
  const t = useTranslations("v2Owner.pedagogy.load");
  const date = useDateFormat();
  const allowed = usePermission("analytics.pedagogy.read");
  const query = useAnalyticsTeachingLoad(filters, { enabled: allowed.allowed });
  const data = query.data?.data;
  return (
    <Section id="ped-load" title={t("title")} actions={<ExportButton dataset="teaching-load" query={filters as Record<string, string>} />}>
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <p className="text-sm text-muted-foreground">{t("totals", { staff: data.totals.staffCount, hours: date.number(data.totals.plannedHours) })}</p>
          <DataTable
            caption={t("caption")}
            columns={[
              { id: "name", header: t("name"), rowHeader: true, cell: (r) => r.displayName },
              { id: "hours", header: t("hours"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{date.number(r.plannedHours)}</span> },
              { id: "classes", header: t("classes"), align: "right", cell: (r) => <span className="tabular-nums">{r.classroomCount}</span>, className: "hidden sm:table-cell" },
              { id: "contract", header: t("contract"), align: "right", cell: (r) => <span className="tabular-nums">{r.contractualHoursPerWeek === null ? "—" : date.number(r.contractualHoursPerWeek)}</span>, className: "hidden md:table-cell" },
            ]}
            rows={data.rows}
            getRowId={(r) => r.staffId}
            emptyTitle={t("empty")}
          />
        </>
      ) : null}
    </Section>
  );
}
