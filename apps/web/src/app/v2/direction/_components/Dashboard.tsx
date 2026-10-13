"use client";

import Link from "next/link";
import { ArrowRight, Banknote, BarChart3, CalendarCheck, GraduationCap, Landmark, Percent, Receipt, Scale, UserCheck, Users, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAnalyticsFinanceSummary, useAnalyticsOverview } from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { DemoRulesBanner, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "../../owner/_components/kit";

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
          <DemoRulesBanner rulesSource={{ demonstration: data.results.demonstration }} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard icon={GraduationCap} label={t("headcount.label")} value={date.number(data.headcount.inSchooling)} detail={t("headcount.detail", { total: data.headcount.total, classrooms: data.headcount.classrooms })} />
            <KpiCard
              icon={CalendarCheck}
              label={t("attendance.label")}
              value={money.bps(data.attendanceToday.rateBps)}
              detail={t("attendance.detail", { present: data.attendanceToday.presentCount, records: data.attendanceToday.recordsCount, absent: data.attendanceToday.absentCount, late: data.attendanceToday.lateCount, day: date.civil(data.attendanceToday.day) })}
              status={data.attendanceToday.status}
              measured={data.attendanceToday.measured && data.attendanceToday.rateBps !== null}
            />
            <KpiCard
              icon={BarChart3}
              label={t("average.label")}
              value={data.results.generalAverage === null ? "—" : date.number(data.results.generalAverage)}
              detail={t("average.detail", { period: data.results.periodLabel ?? "—", cohort: data.results.cohortSize })}
              measured={data.results.measured && data.results.generalAverage !== null}
            />
            <KpiCard
              icon={Percent}
              label={t("validation.label")}
              value={money.bps(data.results.validationRateBps)}
              detail={t("validation.detail", { validated: data.results.validatedCount, cohort: data.results.cohortSize })}
              measured={data.results.measured && data.results.validationRateBps !== null}
            />
            <KpiCard
              icon={UserCheck}
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
                  icon={Percent}
                  label={t("finance.rate")}
                  value={money.bps(summary?.collectionRateBps ?? null)}
                  detail={summary ? t("finance.rateDetail", { collected: money.fmt(summary.collected, finance.data.data.currency ?? "XOF"), billed: money.fmt(summary.netBilled, finance.data.data.currency ?? "XOF") }) : undefined}
                  status={summary?.status}
                  measured={summary !== null && summary.collectionRateBps !== null}
                />
                <KpiCard icon={Banknote} label={t("finance.collected")} value={money.fmt(summary?.collected, finance.data.data.currency ?? "XOF")} measured={summary !== null} />
                <KpiCard
                  icon={Receipt}
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
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["analytics.read", "/v2/direction/effectifs", "enrollment", Users],
              ["analytics.pedagogy.read", "/v2/owner/pedagogie", "pedagogy", GraduationCap],
              ["analytics.finance.read", "/v2/owner/scolarite", "tuition", Receipt],
              ["analytics.treasury.read", "/v2/owner/tresorerie", "treasury", Wallet],
              ["analytics.payroll.read", "/v2/owner/paie", "payroll", Landmark],
              ["analytics.charges.read", "/v2/owner/charges", "charges", Scale],
            ] as const
          ).map(([permission, href, key, Icon]) => (
            <Can key={key} permission={permission}>
              <li>
                <Link
                  href={href}
                  className="group flex h-full items-start gap-4 rounded-2xl border border-white/10 bg-card/60 p-4 transition-colors hover:border-violet-400/40 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug">{t(`links.${key}.title`)}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{t(`links.${key}.hint`)}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
                </Link>
              </li>
            </Can>
          ))}
        </ul>
      </Section>
    </div>
  );
}
