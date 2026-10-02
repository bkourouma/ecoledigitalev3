"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { AnalyticsComparisonDomain, AnalyticsCompareQuery } from "@ecoledigitale/contracts/v2/analytics";
import { usePermission } from "@/platform/access";
import { useAnalyticsCompare, useAnalyticsScopes } from "@/platform/v2/analytics";
import { DataTable } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { DemoRulesBanner, FeatureGuard, FreshnessBar } from "../../owner/_components/kit";
import { useMeasure, type MeasureUnit } from "./measure";

const DOMAIN_PERMISSION: Record<AnalyticsComparisonDomain, string> = {
  enrollment: "analytics.read",
  attendance: "analytics.attendance.read",
  results: "analytics.pedagogy.read",
  finance: "analytics.finance.read",
};
const DOMAINS: readonly AnalyticsComparisonDomain[] = ["enrollment", "attendance", "results", "finance"];

interface Draft {
  domain: AnalyticsComparisonDomain;
  institutionId: string;
  campusId: string;
  baselineYearId: string;
  targetYearId: string;
  baselinePeriodId: string;
  targetPeriodId: string;
  baselineFrom: string;
  baselineTo: string;
  targetFrom: string;
  targetTo: string;
}

const EMPTY: Draft = { domain: "enrollment", institutionId: "", campusId: "", baselineYearId: "", targetYearId: "", baselinePeriodId: "", targetPeriodId: "", baselineFrom: "", baselineTo: "", targetFrom: "", targetTo: "" };

/** Requête de l'API pour le domaine choisi ; `null` tant que les deux côtés de la comparaison ne sont pas choisis. */
export function compareQueryOf(d: Draft): Partial<AnalyticsCompareQuery> | null {
  const scope = { ...(d.institutionId ? { institutionId: d.institutionId } : {}), ...(d.campusId ? { campusId: d.campusId } : {}) };
  switch (d.domain) {
    case "enrollment":
    case "finance":
      return d.baselineYearId && d.targetYearId ? { ...scope, baselineYearId: d.baselineYearId, targetYearId: d.targetYearId } : null;
    case "results":
      return d.baselinePeriodId && d.targetPeriodId ? { ...scope, baselinePeriodId: d.baselinePeriodId, targetPeriodId: d.targetPeriodId } : null;
    case "attendance":
      return d.baselineFrom && d.baselineTo && d.targetFrom && d.targetTo && d.baselineFrom <= d.baselineTo && d.targetFrom <= d.targetTo
        ? { ...scope, baselineFrom: d.baselineFrom, baselineTo: d.baselineTo, targetFrom: d.targetFrom, targetTo: d.targetTo }
        : null;
  }
}

/** Comparaison d'un indicateur entre deux périodes, deux années ou deux fenêtres de dates, avec écart absolu et variation relative. */
export function CompareScreen() {
  return (
    <FeatureGuard>
      <Compare />
    </FeatureGuard>
  );
}

function Compare() {
  const t = useTranslations("v2Analytics.compare");
  const date = useDateFormat();
  const format = useFormatter();
  const fmt = useMeasure();
  const scopes = useAnalyticsScopes();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const canEnrollment = usePermission(DOMAIN_PERMISSION.enrollment);
  const canAttendance = usePermission(DOMAIN_PERMISSION.attendance);
  const canResults = usePermission(DOMAIN_PERMISSION.results);
  const canFinance = usePermission(DOMAIN_PERMISSION.finance);
  const allowed: Record<AnalyticsComparisonDomain, boolean> = { enrollment: canEnrollment.allowed, attendance: canAttendance.allowed, results: canResults.allowed, finance: canFinance.allowed };
  const domains = DOMAINS.filter((d) => allowed[d]);
  const domain = allowed[draft.domain] ? draft.domain : (domains[0] ?? draft.domain);

  const years = scopes.data?.data.years ?? [];
  const periods = useMemo(() => {
    const label = new Map(years.map((y) => [y.id, y.label]));
    return (scopes.data?.data.periods ?? []).map((p) => ({ value: p.id, label: `${label.get(p.yearId) ?? ""} — ${p.label}` }));
  }, [scopes.data, years]);
  const campuses = (scopes.data?.data.campuses ?? []).filter((c) => !draft.institutionId || c.institutionId === draft.institutionId);
  const institutions = scopes.data?.data.institutions ?? [];

  const query = compareQueryOf({ ...draft, domain });
  const result = useAnalyticsCompare(domain, query ?? {}, { enabled: query !== null && allowed[domain] });
  const d = result.data?.data;

  const yearOptions = years.map((y) => ({ value: y.id, label: y.label }));
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {domains.length === 0 ? (
        <Notice kind="info">{t("noPermission")}</Notice>
      ) : (
        <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("form")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label={t("domain")}>
              {(c) => <NativeSelect {...c} value={domain} onChange={(v) => set({ domain: v as AnalyticsComparisonDomain })} options={domains.map((x) => ({ value: x, label: t(`domains.${x}`) }))} />}
            </FormField>
            {institutions.length > 1 ? (
              <FormField label={t("institution")}>
                {(c) => <NativeSelect {...c} value={draft.institutionId} onChange={(v) => set({ institutionId: v, campusId: "" })} placeholder={t("all")} options={institutions.map((i) => ({ value: i.id, label: i.label }))} />}
              </FormField>
            ) : null}
            {campuses.length > 1 ? (
              <FormField label={t("campus")} hint={domain === "finance" ? t("campusFinanceHint") : undefined}>
                {(c) => <NativeSelect {...c} value={draft.campusId} onChange={(v) => set({ campusId: v })} placeholder={t("all")} options={campuses.map((i) => ({ value: i.id, label: i.label }))} />}
              </FormField>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {domain === "enrollment" || domain === "finance" ? (
              <>
                <FormField label={t("baselineYear")} required>{(c) => <NativeSelect {...c} value={draft.baselineYearId} onChange={(v) => set({ baselineYearId: v })} placeholder={t("choose")} options={yearOptions} />}</FormField>
                <FormField label={t("targetYear")} required>{(c) => <NativeSelect {...c} value={draft.targetYearId} onChange={(v) => set({ targetYearId: v })} placeholder={t("choose")} options={yearOptions} />}</FormField>
              </>
            ) : null}
            {domain === "results" ? (
              <>
                <FormField label={t("baselinePeriod")} required>{(c) => <NativeSelect {...c} value={draft.baselinePeriodId} onChange={(v) => set({ baselinePeriodId: v })} placeholder={t("choose")} options={periods} />}</FormField>
                <FormField label={t("targetPeriod")} required>{(c) => <NativeSelect {...c} value={draft.targetPeriodId} onChange={(v) => set({ targetPeriodId: v })} placeholder={t("choose")} options={periods} />}</FormField>
              </>
            ) : null}
            {domain === "attendance" ? (
              <>
                <FormField label={t("baselineFrom")} required>{(c) => <TextControl {...c} type="date" value={draft.baselineFrom} onChange={(v) => set({ baselineFrom: v })} />}</FormField>
                <FormField label={t("baselineTo")} required>{(c) => <TextControl {...c} type="date" value={draft.baselineTo} onChange={(v) => set({ baselineTo: v })} />}</FormField>
                <FormField label={t("targetFrom")} required>{(c) => <TextControl {...c} type="date" value={draft.targetFrom} onChange={(v) => set({ targetFrom: v })} />}</FormField>
                <FormField label={t("targetTo")} required>{(c) => <TextControl {...c} type="date" value={draft.targetTo} onChange={(v) => set({ targetTo: v })} />}</FormField>
              </>
            ) : null}
          </div>
        </form>
      )}

      {query === null && domains.length > 0 ? <p className="text-sm text-muted-foreground">{t("pick")}</p> : null}
      {query !== null && result.isPending && result.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {result.isError ? <ErrorBlock error={result.error} onRetry={() => void result.refetch()} /> : null}
      {d ? (
        <section aria-label={t("result")} className="space-y-3">
          <FreshnessBar meta={result.data?.meta} />
          <DemoRulesBanner rulesSource={{ demonstration: d.baseline.demonstration || d.target.demonstration }} />
          <DataTable
            caption={t("caption", { baseline: d.baseline.label || "—", target: d.target.label || "—" })}
            columns={[
              { id: "metric", header: t("metric"), rowHeader: true, cell: (r) => t(`metrics.${d.domain}.${r.key}`) },
              { id: "baseline", header: d.baseline.label || t("baseline"), align: "right", cell: (r) => <span className="tabular-nums">{cell(r.baseline, r.unit)}</span> },
              { id: "target", header: d.target.label || t("target"), align: "right", cell: (r) => <span className="tabular-nums">{cell(r.target, r.unit)}</span> },
              { id: "delta", header: t("delta"), align: "right", cell: (r) => <span className="tabular-nums">{r.delta === null ? t("notMeasured") : signed(r.delta, r.unit)}</span> },
              { id: "change", header: t("change"), align: "right", cell: (r) => <span className="tabular-nums">{r.changeBps === null ? "—" : signedPercent(r.changeBps)}</span>, className: "hidden sm:table-cell" },
            ]}
            rows={d.metrics}
            getRowId={(r) => r.key}
            emptyTitle={t("empty")}
          />
          <p className="text-xs text-muted-foreground">{t("note")}</p>
        </section>
      ) : null}
    </div>
  );

  function cell(value: number | null, unit: MeasureUnit): string {
    return value === null ? t("notMeasured") : fmt(unit, value, d?.currency);
  }
  function signed(delta: number, unit: MeasureUnit): string {
    const text = unit === "BPS" ? `${delta > 0 ? "+" : ""}${format.number(delta / 100, { maximumFractionDigits: 2 })} ${t("points")}` : `${delta > 0 ? "+" : ""}${fmt(unit, delta, d?.currency)}`;
    return text;
  }
  function signedPercent(bps: number): string {
    return `${bps > 0 ? "+" : ""}${date.number(bps / 100)} %`;
  }
}
