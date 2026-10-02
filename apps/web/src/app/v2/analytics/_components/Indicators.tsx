"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import {
  useAnalyticsAdmissionsFunnel,
  useAnalyticsAlerts,
  useAnalyticsAttendance,
  useAnalyticsEnrollment,
  useAnalyticsFinanceSummary,
  useAnalyticsPayroll,
  useAnalyticsResults,
  useAnalyticsSchoolLife,
} from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { DemoRulesBanner, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "../../owner/_components/kit";

const FIELDS: readonly ScopeField[] = ["institution", "campus", "year"];

/**
 * Indicateurs transverses de la direction : effectifs et inscriptions, assiduité, résultats par période, recouvrement et impayés,
 * admissions, vie scolaire agrégée, alertes ouvertes et charge de paie. Chaque bloc ne s'affiche (et ne se lit) que si
 * l'utilisateur détient la permission de ses données ; chaque réponse porte sa fraîcheur et ses manques (jamais un zéro inventé).
 * Aucune donnée nominative : des comptages, des taux et des montants.
 */
export function IndicatorsScreen() {
  return (
    <FeatureGuard>
      <Indicators />
    </FeatureGuard>
  );
}

function Indicators() {
  const t = useTranslations("v2Analytics.hub");
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />
      <EnrollmentBlock filters={filters} />
      <Can permission="analytics.attendance.read">
        <AttendanceBlock filters={filters} />
      </Can>
      <Can permission="analytics.pedagogy.read">
        <ResultsBlock filters={filters} />
      </Can>
      <Can permission="analytics.finance.read">
        <FinanceBlock filters={filters} />
      </Can>
      <Can permission="analytics.admissions.read">
        <AdmissionsBlock filters={filters} />
      </Can>
      <Can permission="analytics.schoollife.read">
        <SchoolLifeBlock filters={filters} />
      </Can>
      <Can permission="analytics.alerts.read">
        <AlertsBlock />
      </Can>
      <Can permission="analytics.payroll.read">
        <PayrollBlock filters={filters} />
      </Can>
    </div>
  );
}

type Filters = ReturnType<typeof scopeFilters>;

function Pct({ bps }: { bps: number | null }) {
  const money = useMoney();
  return <>{money.bps(bps)}</>;
}

function Query({ q, children }: { q: { isPending: boolean; fetchStatus: string; isError: boolean; error: unknown; refetch: () => unknown }; children: React.ReactNode }) {
  return (
    <>
      {q.isPending && q.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : null}
      {children}
    </>
  );
}

function EnrollmentBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.enrollment");
  const date = useDateFormat();
  const query = useAnalyticsEnrollment(filters);
  const d = query.data?.data;
  return (
    <Section id="hub-enrollment" title={t("title")} actions={<Link href="/v2/direction/effectifs" className={buttonClass.secondary}>{t("more")}</Link>}>
      <Query q={query}>
        {d ? (
          <>
            <FreshnessBar meta={query.data?.meta} />
            <KpiGrid label={t("kpiLabel")}>
              <KpiCard label={t("inSchooling")} value={date.number(d.totals.inSchooling)} detail={t("inSchoolingDetail", { total: d.totals.total })} />
              <KpiCard label={t("created")} value={date.number(d.admissions.created)} detail={t("createdDetail", { cancelled: d.admissions.cancelled })} />
              <KpiCard label={t("confirmed")} value={date.number(d.admissions.confirmed)} />
              <KpiCard label={t("confirmationRate")} value={<Pct bps={d.admissions.confirmationRateBps} />} measured={d.admissions.confirmationRateBps !== null} />
            </KpiGrid>
          </>
        ) : null}
      </Query>
    </Section>
  );
}

function AttendanceBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.attendance");
  const date = useDateFormat();
  const query = useAnalyticsAttendance(filters);
  const d = query.data?.data;
  return (
    <Section id="hub-attendance" title={t("title")} actions={<Link href="/v2/direction/effectifs" className={buttonClass.secondary}>{t("more")}</Link>}>
      <Query q={query}>
        {d ? (
          <>
            <FreshnessBar meta={query.data?.meta} />
            <KpiGrid label={t("kpiLabel")}>
              <KpiCard
                label={t("rate")}
                value={<Pct bps={d.totals.rateBps} />}
                detail={t("rateDetail", { from: date.civil(d.range.from), to: date.civil(d.range.to) })}
                status={d.totals.status}
                measured={d.totals.rateBps !== null}
              />
              <KpiCard label={t("absent")} value={date.number(d.totals.absentCount)} detail={t("absentDetail", { excused: d.totals.excusedCount })} measured={d.totals.recordsCount > 0} />
              <KpiCard label={t("late")} value={date.number(d.totals.lateCount)} measured={d.totals.recordsCount > 0} />
            </KpiGrid>
          </>
        ) : null}
      </Query>
    </Section>
  );
}

function ResultsBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.results");
  const date = useDateFormat();
  const money = useMoney();
  const query = useAnalyticsResults(filters);
  const d = query.data?.data;
  return (
    <Section id="hub-results" title={t("title")} actions={<Link href="/v2/owner/pedagogie" className={buttonClass.secondary}>{t("more")}</Link>}>
      <Query q={query}>
        {d ? (
          <>
            <FreshnessBar meta={query.data?.meta} />
            <DemoRulesBanner rulesSource={d.rulesSource} />
            <DataTable
              caption={t("caption")}
              columns={[
                { id: "period", header: t("period"), rowHeader: true, cell: (r) => r.label },
                { id: "count", header: t("count"), align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span>, className: "hidden sm:table-cell" },
                { id: "average", header: t("average"), align: "right", cell: (r) => <span className="tabular-nums">{r.average === null ? t("notMeasured") : date.number(r.average)}</span> },
                { id: "validation", header: t("validation"), align: "right", cell: (r) => <span className="tabular-nums">{r.validationRateBps === null ? t("notMeasured") : money.bps(r.validationRateBps)}</span> },
                { id: "rules", header: t("rules"), cell: (r) => (r.demonstration ? t("demo") : t("official")), className: "hidden md:table-cell" },
              ]}
              rows={d.byPeriod}
              getRowId={(r) => r.periodId}
              emptyTitle={t("empty")}
            />
          </>
        ) : null}
      </Query>
    </Section>
  );
}

function FinanceBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.finance");
  const money = useMoney();
  const query = useAnalyticsFinanceSummary(filters);
  const d = query.data?.data;
  const s = d?.summary ?? null;
  const cur = d?.currency ?? "XOF";
  return (
    <Section id="hub-finance" title={t("title")} actions={<Link href="/v2/owner/scolarite" className={buttonClass.secondary}>{t("more")}</Link>}>
      <Query q={query}>
        {d ? (
          <>
            <FreshnessBar meta={query.data?.meta} />
            <KpiGrid label={t("kpiLabel")}>
              <KpiCard label={t("rate")} value={<Pct bps={s?.collectionRateBps ?? null} />} detail={s ? t("rateDetail", { collected: money.fmt(s.collected, cur), billed: money.fmt(s.netBilled, cur) }) : undefined} status={s?.status} measured={s !== null && s.collectionRateBps !== null} />
              <KpiCard label={t("outstanding")} value={money.fmt(s?.outstanding, cur)} measured={s !== null} />
              <KpiCard label={t("overdue")} value={money.fmt(s?.overdue, cur)} detail={s ? t("overdueDetail", { invoices: s.overdueInvoiceCount }) : undefined} measured={s !== null} />
            </KpiGrid>
          </>
        ) : null}
      </Query>
    </Section>
  );
}

function AdmissionsBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.admissions");
  const date = useDateFormat();
  const query = useAnalyticsAdmissionsFunnel({ ...(filters.institutionId ? { institutionId: filters.institutionId } : {}) });
  const d = query.data?.data;
  return (
    <Section id="hub-admissions" title={t("title")} actions={<Link href="/v2/analytics/admissions" className={buttonClass.secondary}>{t("more")}</Link>}>
      <Query q={query}>
        {d ? (
          <>
            <FreshnessBar meta={query.data?.meta} />
            <KpiGrid label={t("kpiLabel")}>
              <KpiCard label={t("submitted")} value={date.number(d.totals.submitted)} measured={d.campaigns.length > 0} />
              <KpiCard label={t("accepted")} value={date.number(d.totals.accepted)} measured={d.campaigns.length > 0} />
              <KpiCard label={t("enrolled")} value={date.number(d.totals.enrolled)} measured={d.campaigns.length > 0} />
              <KpiCard label={t("seats")} value={date.number(d.totals.seats)} detail={d.totals.seatsLeft === null ? undefined : t("seatsLeft", { count: d.totals.seatsLeft })} measured={d.totals.seats !== null} />
            </KpiGrid>
          </>
        ) : null}
      </Query>
    </Section>
  );
}

function SchoolLifeBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.schoollife");
  const date = useDateFormat();
  const query = useAnalyticsSchoolLife({ ...(filters.institutionId ? { institutionId: filters.institutionId } : {}) });
  const d = query.data?.data;
  return (
    <Section id="hub-schoollife" title={t("title")} actions={<Link href="/v2/analytics/vie-scolaire" className={buttonClass.secondary}>{t("more")}</Link>}>
      <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      <Query q={query}>
        {d ? (
          <>
            <FreshnessBar meta={query.data?.meta} />
            <KpiGrid label={t("kpiLabel")}>
              {d.indicators.map((i) => (
                <KpiCard key={i.indicator} label={t(`indicators.${i.indicator}`)} value={date.number(i.value)} measured={i.measured} />
              ))}
            </KpiGrid>
          </>
        ) : null}
      </Query>
    </Section>
  );
}

function AlertsBlock() {
  const t = useTranslations("v2Analytics.hub.alerts");
  const date = useDateFormat();
  const query = useAnalyticsAlerts({ limit: 1 });
  const d = query.data;
  return (
    <Section id="hub-alerts" title={t("title")} actions={<Link href="/v2/analytics/alertes" className={buttonClass.secondary}>{t("more")}</Link>}>
      <Query q={query}>
        {d ? (
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("open")} value={date.number(d.counts.open)} detail={d.counts.open > 0 ? t("openDetail") : undefined} />
            <KpiCard label={t("acknowledged")} value={date.number(d.counts.acknowledged)} />
            <KpiCard label={t("resolved")} value={date.number(d.counts.resolved)} />
          </KpiGrid>
        ) : null}
      </Query>
    </Section>
  );
}

/** Masse salariale : donnée sensible (MFA, lecture auditée) — lue seulement après une action explicite de l'utilisateur. */
function PayrollBlock({ filters }: { filters: Filters }) {
  const t = useTranslations("v2Analytics.hub.payroll");
  const money = useMoney();
  const date = useDateFormat();
  const allowed = usePermission("analytics.payroll.read");
  const [shown, setShown] = useState(false);
  const query = useAnalyticsPayroll(filters, { enabled: shown && allowed.allowed });
  const d = query.data?.data;
  return (
    <Section id="hub-payroll" title={t("title")} actions={<Link href="/v2/owner/paie" className={buttonClass.secondary}>{t("more")}</Link>}>
      <p className="text-sm text-muted-foreground">{t("sensitive")}</p>
      {!shown ? (
        <button type="button" className={buttonClass.secondary} onClick={() => setShown(true)}>
          {t("show")}
        </button>
      ) : (
        <Query q={query}>
          {d ? (
            <>
              <FreshnessBar meta={query.data?.meta} />
              <KpiGrid label={t("kpiLabel")}>
                <KpiCard label={t("counted")} value={money.fmt(d.counted.total, d.currency ?? "XOF")} detail={t("countedDetail", { payslips: d.counted.payslips })} measured={d.periods.length > 0} />
                <KpiCard label={t("periods")} value={date.number(d.periods.length)} />
                <KpiCard
                  label={t("disputed")}
                  value={date.number(d.periods.reduce((n, p) => n + p.disputed.payslips, 0))}
                  detail={t("disputedDetail")}
                  measured={d.periods.length > 0}
                />
              </KpiGrid>
            </>
          ) : null}
        </Query>
      )}
    </Section>
  );
}

