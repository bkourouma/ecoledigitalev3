"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAnalyticsFinanceSummary, useAnalyticsOverview } from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "../../owner/_components/kit";

const FIELDS: readonly ScopeField[] = ["institution", "campus", "year"];

/**
 * Tableau de bord de la direction : effectifs, présence aujourd'hui, moyenne générale (dernière période clôturée), enseignants
 * présents, scolarité recouvrée et créances. Tout vient de `GET /analytics/overview` et `GET /analytics/finance/summary` ; la
 * partie financière n'est demandée que si l'utilisateur détient `analytics.finance.read`.
 */
export function DirectionDashboardScreen() {
  return (
    <FeatureGuard>
      <Dashboard />
    </FeatureGuard>
  );
}

function Dashboard() {
  const t = useTranslations("v2Direction.dashboard");
  const money = useMoney();
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  const overview = useAnalyticsOverview(filters);
  const canFinance = usePermission("analytics.finance.read");
  const finance = useAnalyticsFinanceSummary(filters, { enabled: canFinance.allowed });
  const data = overview.data?.data;
  const summary = finance.data?.data.summary ?? null;

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />
      {overview.isPending && overview.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {overview.isError ? <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={overview.data?.meta} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("headcount.label")} value={date.number(data.headcount.inSchooling)} detail={t("headcount.detail", { total: data.headcount.total, classrooms: data.headcount.classrooms })} />
            <KpiCard
              label={t("attendance.label")}
              value={money.bps(data.attendanceToday.rateBps)}
              detail={t("attendance.detail", { present: data.attendanceToday.presentCount, records: data.attendanceToday.recordsCount, absent: data.attendanceToday.absentCount, late: data.attendanceToday.lateCount, day: date.civil(data.attendanceToday.day) })}
              status={data.attendanceToday.status}
              measured={data.attendanceToday.measured && data.attendanceToday.rateBps !== null}
            />
            <KpiCard
              label={t("average.label")}
              value={data.results.generalAverage === null ? "—" : date.number(data.results.generalAverage)}
              detail={t("average.detail", { period: data.results.periodLabel ?? "—", cohort: data.results.cohortSize })}
              measured={data.results.measured && data.results.generalAverage !== null}
            />
            <KpiCard
              label={t("validation.label")}
              value={money.bps(data.results.validationRateBps)}
              detail={t("validation.detail", { validated: data.results.validatedCount, cohort: data.results.cohortSize })}
              measured={data.results.measured && data.results.validationRateBps !== null}
            />
            <KpiCard
              label={t("staff.label")}
              value={date.number(data.staffToday.present)}
              detail={t("staff.detail", { absent: data.staffToday.absent, leave: data.staffToday.onLeave, day: date.civil(data.staffToday.day) })}
              measured={data.staffToday.measured}
            />
          </KpiGrid>
        </>
      ) : null}

      <Can permission="analytics.finance.read">
        <Section id="dash-finance" title={t("finance.title")}>
          {finance.isPending && finance.fetchStatus !== "idle" ? <LoadingBlock /> : null}
          {finance.isError ? <ErrorBlock error={finance.error} onRetry={() => void finance.refetch()} /> : null}
          {finance.data ? (
            <>
              <FreshnessBar meta={finance.data.meta} />
              <KpiGrid label={t("finance.kpiLabel")}>
                <KpiCard
                  label={t("finance.rate")}
                  value={money.bps(summary?.collectionRateBps ?? null)}
                  detail={summary ? t("finance.rateDetail", { collected: money.fmt(summary.collected, finance.data.data.currency ?? "XOF"), billed: money.fmt(summary.netBilled, finance.data.data.currency ?? "XOF") }) : undefined}
                  status={summary?.status}
                  measured={summary !== null && summary.collectionRateBps !== null}
                />
                <KpiCard label={t("finance.collected")} value={money.fmt(summary?.collected, finance.data.data.currency ?? "XOF")} measured={summary !== null} />
                <KpiCard
                  label={t("finance.outstanding")}
                  value={money.fmt(summary?.outstanding, finance.data.data.currency ?? "XOF")}
                  detail={summary ? t("finance.overdueDetail", { overdue: money.fmt(summary.overdue, finance.data.data.currency ?? "XOF"), invoices: summary.overdueInvoiceCount }) : undefined}
                  measured={summary !== null}
                />
              </KpiGrid>
            </>
          ) : null}
        </Section>
      </Can>

      <Section id="dash-links" title={t("links.title")}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["analytics.read", "/v2/direction/effectifs", "enrollment"],
              ["analytics.pedagogy.read", "/v2/owner/pedagogie", "pedagogy"],
              ["analytics.finance.read", "/v2/owner/scolarite", "tuition"],
              ["analytics.treasury.read", "/v2/owner/tresorerie", "treasury"],
              ["analytics.payroll.read", "/v2/owner/paie", "payroll"],
              ["analytics.charges.read", "/v2/owner/charges", "charges"],
            ] as const
          ).map(([permission, href, key]) => (
            <Can key={key} permission={permission}>
              <li>
                <Link href={href} className="block rounded-lg border p-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block font-medium">{t(`links.${key}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`links.${key}.hint`)}</span>
                </Link>
              </li>
            </Can>
          ))}
        </ul>
      </Section>
    </div>
  );
}
