"use client";

import { useTranslations } from "next-intl";
import { BadgeCheck, CalendarDays, FileText, GraduationCap, Megaphone, Percent, School, Shield, Users } from "lucide-react";
import { ANALYTICS_ADMISSION_STATUSES } from "@ecoledigitale/contracts/v2/analytics";
import { useAnalyticsAdmissionsFunnel, useAnalyticsSchoolLife } from "@/platform/v2/analytics";
import { DataTable } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { BarChart } from "../../owner/_components/charts";
import { ExportButton, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "../../owner/_components/kit";

const FIELDS: readonly ScopeField[] = ["institution", "year"];

/** Entonnoir d'admission : répartition À CE JOUR des dossiers par statut et par étape de chaque campagne. Des comptages, jamais un candidat. */
export function AdmissionsFunnelScreen() {
  return (
    <FeatureGuard>
      <Funnel />
    </FeatureGuard>
  );
}

function Funnel() {
  const t = useTranslations("v2Analytics.admissions");
  const date = useDateFormat();
  const money = useMoney();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  // L'année de l'entonnoir est celle de la CAMPAGNE (souvent l'année à venir) : aucune année n'est imposée par défaut.
  const query = useAnalyticsAdmissionsFunnel({ ...(filters.institutionId ? { institutionId: filters.institutionId } : {}), ...(filters.yearId ? { yearId: filters.yearId } : {}) });
  const d = query.data?.data;
  const exportQuery = { ...(filters.institutionId ? { institutionId: filters.institutionId } : {}), ...(filters.yearId ? { yearId: filters.yearId } : {}) };
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} actions={<ExportButton dataset="admissions-funnel" query={exportQuery} />} />
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {d ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <Notice kind="info">{t("snapshot")}</Notice>
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard icon={FileText} label={t("kpi.submitted")} value={date.number(d.totals.submitted)} detail={t("kpi.submittedDetail", { total: d.totals.applications })} measured={d.campaigns.length > 0} />
            <KpiCard icon={BadgeCheck} label={t("kpi.accepted")} value={date.number(d.totals.accepted)} detail={t("kpi.acceptedDetail")} measured={d.campaigns.length > 0} />
            <KpiCard icon={School} label={t("kpi.enrolled")} value={date.number(d.totals.enrolled)} measured={d.campaigns.length > 0} />
            <KpiCard icon={Percent} label={t("kpi.acceptanceRate")} value={money.bps(d.totals.acceptanceRateBps)} measured={d.totals.acceptanceRateBps !== null} />
            <KpiCard icon={GraduationCap} label={t("kpi.enrollmentRate")} value={money.bps(d.totals.enrollmentRateBps)} detail={t("kpi.enrollmentRateDetail")} measured={d.totals.enrollmentRateBps !== null} />
            <KpiCard icon={Users} label={t("kpi.seats")} value={date.number(d.totals.seats)} detail={d.totals.seatsLeft === null ? undefined : t("kpi.seatsLeft", { count: d.totals.seatsLeft })} measured={d.totals.seats !== null} />
          </KpiGrid>

          <Section id="adm-status" icon={Megaphone} title={t("byStatus.title")}>
            <BarChart
              title={t("byStatus.chart")}
              rows={ANALYTICS_ADMISSION_STATUSES.map((s) => {
                const count = d.byStatus.find((x) => x.status === s)?.count ?? 0;
                return { key: s, label: t(`status.${s}`), value: count, display: String(count) };
              })}
              valueHeader={t("byStatus.applications")}
              empty={t("empty")}
            />
          </Section>

          <Section id="adm-campaigns" icon={CalendarDays} title={t("campaigns.title")}>
            {d.campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              d.campaigns.map((c) => (
                <div key={c.campaignId} className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4 sm:p-5">
                  <h3 className="text-base font-semibold">
                    {c.label} <span className="text-sm font-normal text-muted-foreground">({c.code})</span>
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`campaignStatus.${c.status === "DRAFT" || c.status === "OPEN" || c.status === "CLOSED" || c.status === "ARCHIVED" ? c.status : "OTHER"}`)}
                    {c.seats === null ? "" : ` · ${t("campaigns.seats", { seats: c.seats, left: c.seatsLeft ?? 0 })}`}
                    {` · ${t("campaigns.applications", { count: c.applications })}`}
                  </p>
                  <DataTable
                    caption={t("campaigns.caption", { label: c.label })}
                    columns={[
                      { id: "stage", header: t("campaigns.stage"), rowHeader: true, cell: (r) => r.label },
                      { id: "status", header: t("campaigns.status"), cell: (r) => t(`status.${r.canonicalStatus}`), className: "hidden sm:table-cell" },
                      { id: "applications", header: t("campaigns.count"), align: "right", cell: (r) => <span className="tabular-nums">{r.applications}</span> },
                    ]}
                    rows={c.stages}
                    getRowId={(r) => r.code}
                    emptyTitle={t("empty")}
                  />
                </div>
              ))
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}

/** Vie scolaire AGRÉGÉE : quatre comptages. Ni élève, ni motif, ni élément restreint ou confidentiel. */
export function SchoolLifeScreen() {
  return (
    <FeatureGuard>
      <SchoolLife />
    </FeatureGuard>
  );
}

function SchoolLife() {
  const t = useTranslations("v2Analytics.schoollife");
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, ["institution"]);
  const query = useAnalyticsSchoolLife({ ...(filters.institutionId ? { institutionId: filters.institutionId } : {}) });
  const d = query.data?.data;
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} actions={<ExportButton dataset="schoollife-summary" query={filters.institutionId ? { institutionId: filters.institutionId } : {}} />} />
      <ScopeFilters value={scope} onChange={setScope} fields={["institution"]} />
      <Notice kind="info">{t("privacy")}</Notice>
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {d ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <KpiGrid label={t("kpiLabel")}>
            {d.indicators.map((i) => (
              <KpiCard key={i.indicator} icon={Shield} label={t(`indicators.${i.indicator}.label`)} value={date.number(i.value)} detail={t(`indicators.${i.indicator}.detail`)} measured={i.measured} />
            ))}
          </KpiGrid>
        </>
      ) : null}
    </div>
  );
}
