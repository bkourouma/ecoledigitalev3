"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EXPORT_DATASETS, type ExportDataset, type ExportMeta } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { fetchStateassignExport, useExportFormats, useGatewayStatus, useStateassignSummary } from "@/platform/v2/stateassign";
import { downloadTextFile } from "@/platform/ui/download";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, QueryBoundary } from "@/platform/ui/states";
import { PERM, ScopeFilters, scopeQuery, type Scope } from "./stateassign-utils";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold">{value}</dd>
    </div>
  );
}

function Summary({ scope }: { scope: Scope }) {
  const t = useTranslations("v2Stateassign.reportsScreen.summary");
  const tStatus = useTranslations("v2Stateassign.status");
  const tRecon = useTranslations("v2Stateassign.reconciliation");
  const money = useMoney();
  const date = useDateFormat();
  const query = useStateassignSummary(scopeQuery(scope));
  return (
    <QueryBoundary query={query}>
      {query.data ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("asOf", { date: date.civil(query.data.asOf) })}</p>
          <section aria-labelledby="sum-assignments" className="space-y-2">
            <h2 id="sum-assignments" className="text-base font-semibold">{t("assignments")}</h2>
            <dl className="grid gap-3 sm:grid-cols-4">
              {Object.entries(query.data.assignmentsByStatus).map(([status, n]) => <Stat key={status} label={tStatus(status as never)} value={n} />)}
              <Stat label={t("declaredState")} value={money.of(query.data.declaredState)} />
              <Stat label={t("declaredParent")} value={money.of(query.data.declaredParent)} />
            </dl>
          </section>
          <section aria-labelledby="sum-receivables" className="space-y-2">
            <h2 id="sum-receivables" className="text-base font-semibold">{t("receivables")}</h2>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Stat label={t("expected")} value={money.of(query.data.receivables.expected)} />
              <Stat label={t("received")} value={money.of(query.data.receivables.received)} />
              <Stat label={t("outstanding")} value={money.of(query.data.receivables.outstanding)} />
              <Stat label={t("overdue")} value={money.of(query.data.receivables.overdue)} />
            </dl>
          </section>
          <section aria-labelledby="sum-follow" className="space-y-2">
            <h2 id="sum-follow" className="text-base font-semibold">{t("follow")}</h2>
            <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t("controlsPending")} value={query.data.controls.pending} />
              <Stat label={t("controlsOverdue")} value={query.data.controls.overdue} />
              <Stat label={t("controlsAnomalies")} value={query.data.controls.anomalies} />
              <Stat label={tRecon("NEVER")} value={query.data.reconciliation.never} />
              <Stat label={tRecon("BALANCED")} value={query.data.reconciliation.balanced} />
              <Stat label={tRecon("DISCREPANCY")} value={query.data.reconciliation.discrepancy} />
            </dl>
          </section>
        </div>
      ) : null}
    </QueryBoundary>
  );
}

/** Exports pour l'administration : le fichier est celui que produit l'API (format de l'établissement, cellules neutralisées). */
function Exports({ scope }: { scope: Scope }) {
  const t = useTranslations("v2Stateassign.reportsScreen.exports");
  const tDataset = useTranslations("v2Stateassign.dataset");
  const canExport = usePermission(PERM.export).allowed;
  const [dataset, setDataset] = useState<ExportDataset>("ASSIGNMENTS");
  const [formatId, setFormatId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [meta, setMeta] = useState<ExportMeta | null>(null);
  const formats = useExportFormats({ ...(scope.institutionId ? { institutionId: scope.institutionId } : {}), dataset }, canExport);
  if (!canExport) return null;

  async function run(): Promise<void> {
    setPending(true);
    setError(null);
    setMeta(null);
    try {
      const out = await fetchStateassignExport({ dataset, ...(formatId ? { formatId } : {}), ...scopeQuery(scope) });
      setMeta(out.meta);
      downloadTextFile(out.filename, out.csv, "text/csv");
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="exports-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="exports-title" className="text-base font-semibold">{t("title")}</h2>
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("dataset")}>
          {(c) => <NativeSelect {...c} value={dataset} onChange={(v) => { setDataset(EXPORT_DATASETS.find((d) => d === v) ?? "ASSIGNMENTS"); setFormatId(""); setMeta(null); }} options={EXPORT_DATASETS.map((d) => ({ value: d, label: tDataset(d) }))} />}
        </FormField>
        <FormField label={t("format")} hint={t("formatHint")}>
          {(c) => <NativeSelect {...c} value={formatId} onChange={setFormatId} placeholder={t("standard")} options={(formats.data ?? []).filter((f) => f.active).map((f) => ({ value: f.id, label: f.label }))} />}
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void run()} disabled={pending} className={buttonClass.primary}>{pending ? t("running") : t("download")}</button>
        {pending ? <LoadingBlock className="py-0" /> : null}
      </div>
      {error ? <ErrorBlock error={error} /> : null}
      {meta ? <Notice kind={meta.truncated ? "warning" : "success"}>{meta.truncated ? t("truncated", { rows: meta.rowCount, total: meta.totalCount, max: meta.maxRows }) : t("done", { rows: meta.rowCount })}</Notice> : null}
    </section>
  );
}

/** La passerelle vers une plateforme publique d'affectation n'existe pas encore : l'écran le dit, sans rien appeler à l'extérieur. */
function Gateway() {
  const t = useTranslations("v2Stateassign.reportsScreen.gateway");
  const status = useGatewayStatus();
  if (!status.data) return null;
  return (
    <section aria-labelledby="gateway-title" className="space-y-2 rounded-lg border p-4">
      <h2 id="gateway-title" className="text-base font-semibold">{t("title")}</h2>
      <Notice kind={status.data.configured ? "success" : "info"}>{status.data.configured ? t("configured", { adapter: status.data.adapter }) : t("notConfigured")}</Notice>
    </section>
  );
}

export function ReportsScreen() {
  const t = useTranslations("v2Stateassign.reportsScreen");
  const [scope, setScope] = useState<Scope>({ institutionId: "", academicYearId: "" });
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters value={scope} onChange={setScope} />
      <Summary scope={scope} />
      <Exports scope={scope} />
      <Gateway />
    </div>
  );
}
