"use client";

import { ANALYTICS_FEATURES } from "@ecoledigitale/contracts/v2/analytics";
import { useTranslations } from "next-intl";
import { useAnalyticsCharges, useAnalyticsFreshness, useAnalyticsPayroll, useAnalyticsRebuild } from "@/platform/v2/analytics";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { ExportButton, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "./kit";

const FIELDS: readonly ScopeField[] = ["year"];

/**
 * Masse salariale par période de paie (lecture seule, MFA exigée côté API) : bulletins comptés (calculés + arrêtés + payés),
 * annulés et contestés à part. La validation d'une paie reste dans le module de paie.
 */
export function PayrollMassScreen() {
  return (
    <FeatureGuard feature={ANALYTICS_FEATURES.payroll}>
      <PayrollMass />
    </FeatureGuard>
  );
}

function PayrollMass() {
  const t = useTranslations("v2Owner.payroll");
  const money = useMoney();
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  const query = useAnalyticsPayroll(filters);
  const data = query.data?.data;
  const currency = data?.currency ?? "XOF";
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} actions={<ExportButton dataset="payroll-mass" query={filters as Record<string, string>} />} />
      <Notice kind="info">{t("sensitive")}</Notice>
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("kpi.counted")} value={money.fmt(data.counted.total, currency)} detail={t("kpi.countedDetail", { count: data.counted.payslips })} measured={data.periods.length > 0} />
            <KpiCard label={t("kpi.periods")} value={date.number(data.periods.length)} />
          </KpiGrid>
          <p className="text-sm text-muted-foreground">{t("definition")}</p>
          <DataTable
            caption={t("caption")}
            columns={[
              { id: "name", header: t("columns.period"), rowHeader: true, cell: (r) => <span>{r.name}<span className="block text-xs text-muted-foreground">{t("columns.range", { from: date.civil(r.startsOn), to: date.civil(r.endsOn) })}</span></span> },
              { id: "counted", header: t("columns.counted"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.fmt(r.counted.total, currency)}</span> },
              { id: "payslips", header: t("columns.payslips"), align: "right", cell: (r) => <span className="tabular-nums">{r.counted.payslips}</span>, className: "hidden sm:table-cell" },
              { id: "status", header: t("columns.byStatus"), cell: (r) => <StatusList statuses={r.byStatus} currency={currency} />, className: "hidden lg:table-cell" },
              { id: "cancelled", header: t("columns.cancelled"), align: "right", cell: (r) => <span className="tabular-nums">{r.cancelled.payslips} · {money.fmt(r.cancelled.total, currency)}</span>, className: "hidden md:table-cell" },
              { id: "disputed", header: t("columns.disputed"), align: "right", cell: (r) => <span className="tabular-nums">{r.disputed.payslips} · {money.fmt(r.disputed.total, currency)}</span>, className: "hidden md:table-cell" },
            ]}
            rows={data.periods}
            getRowId={(r) => r.periodId}
            emptyTitle={t("empty")}
          />
        </>
      ) : null}
    </div>
  );
}

const STATUSES = ["CALCULATED", "APPROVED", "PAID", "DISPUTED", "CANCELLED"];

function StatusList({ statuses, currency }: { statuses: Record<string, { payslips: number; total: number }>; currency: string }) {
  const t = useTranslations("v2Owner.payroll.status");
  const money = useMoney();
  return (
    <ul className="space-y-1">
      {Object.entries(statuses).map(([status, v]) => (
        <li key={status} className="flex items-center gap-2 text-xs">
          <StatusBadge label={t(STATUSES.includes(status) ? status : "OTHER")} tone={status === "PAID" ? "success" : status === "CANCELLED" || status === "DISPUTED" ? "warning" : "neutral"} />
          <span className="tabular-nums">
            {v.payslips} · {money.fmt(v.total, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Charges et résultat : aucun module de charges en v2 — l'écran le dit au lieu d'afficher des zéros. */
export function ChargesScreen() {
  return (
    <FeatureGuard>
      <Charges />
    </FeatureGuard>
  );
}

function Charges() {
  const t = useTranslations("v2Owner.charges");
  const query = useAnalyticsCharges();
  const data = query.data?.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <Notice kind="warning">
            <p className="font-medium">{t("missingTitle")}</p>
            <p>{data.message}</p>
          </Notice>
          <Section id="chg-missing" title={t("notMeasured.title")}>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {(["charges", "result", "margins", "retention"] as const).map((k) => (
                <li key={k}>{t(`notMeasured.${k}`)}</li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}
    </div>
  );
}

/** Fraîcheur des read-models et reconstruction à la demande (l'exécution est faite par le worker). */
export function FreshnessScreen() {
  return (
    <FeatureGuard>
      <Freshness />
    </FeatureGuard>
  );
}

function Freshness() {
  const t = useTranslations("v2Owner.hub");
  const date = useDateFormat();
  const query = useAnalyticsFreshness();
  const rebuild = useAnalyticsRebuild();
  const flash = useFlash();
  const data = query.data?.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="analytics.rebuild">
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={rebuild.isPending}
              onClick={() => rebuild.mutate({}, { onSuccess: (r) => flash.show(r.queued ? t("rebuild.queued") : t("rebuild.alreadyQueued")) })}
            >
              {t("rebuild.action")}
            </button>
          </Can>
        }
      />
      {flash.node}
      {rebuild.isError ? <ErrorBlock error={rebuild.error} /> : null}
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={query.data?.meta} />
          <p className="text-sm text-muted-foreground">{t("queue", { pending: data.queue.PENDING ?? 0, failed: data.queue.FAILED ?? 0, unavailable: data.queue.UNAVAILABLE ?? 0 })}</p>
          <DataTable
            caption={t("caption")}
            columns={[
              { id: "kind", header: t("columns.kind"), rowHeader: true, cell: (r) => t(`kinds.${r.kind}`) },
              { id: "scope", header: t("columns.scope"), cell: (r) => <span className="break-all text-xs">{r.scopeKey}</span>, className: "hidden md:table-cell" },
              { id: "last", header: t("columns.lastSuccess"), cell: (r) => (r.lastSuccessAt ? date.instant(r.lastSuccessAt) : t("never")) },
              { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={t(`state.${r.lastStatus}`)} tone={r.lastStatus === "OK" ? "success" : "warning"} /> },
              { id: "rows", header: t("columns.rows"), align: "right", cell: (r) => <span className="tabular-nums">{r.rowsWritten}</span>, className: "hidden sm:table-cell" },
            ]}
            rows={data.states}
            getRowId={(r) => `${r.kind}|${r.scopeKey}`}
            emptyTitle={t("empty")}
          />
        </>
      ) : null}
    </div>
  );
}
