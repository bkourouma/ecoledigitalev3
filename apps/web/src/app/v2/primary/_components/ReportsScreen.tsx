"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ResponsiveTable, type Column } from "@ecoledigitale/ui";
import type { PrimaryReportDto, PrimaryReportKey } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { downloadTextFile } from "@/platform/ui/download";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { fetchPrimaryReportCsv, useMyPrimaryClassrooms, usePrimaryCouncils, usePrimaryReport, type PrimaryReportParams } from "@/platform/v2/primary";
import { csvFileName, missingParams, REPORT_PARAMS, visibleReports, type ReportParam } from "./reports-model";
import { classLabel, FeatureGate, PrimaryError, RuleBanner, useCodeLabels, useYearOptions } from "./shared";

/**
 * États du primaire : aperçu en tableau et export CSV (téléchargement du fichier, jamais une URL affichée). Les rapports réservés à
 * la direction sont masqués aux autres profils ; les paramètres du rapport sont rappelés avec le résultat (rapport reproductible).
 */
export function ReportsScreen() {
  return (
    <FeatureGate feature="primary.reports">
      <ReportsBody />
    </FeatureGate>
  );
}

function ReportsBody() {
  const t = useTranslations("v2PrimaryReports");
  const label = useCodeLabels();
  const dateFmt = useDateFormat();
  const canAll = usePermission("primary.class.read_all").allowed;
  const keys = visibleReports(canAll);
  const classes = useMyPrimaryClassrooms();
  const years = useYearOptions(classes.data ?? []);
  const councils = usePrimaryCouncils({});
  const [key, setKey] = useState<PrimaryReportKey | "">("");
  const [params, setParams] = useState<Partial<Record<ReportParam, string>>>({});
  const [requested, setRequested] = useState<{ key: PrimaryReportKey; params: PrimaryReportParams } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const report = usePrimaryReport(requested?.key ?? null, requested?.params ?? {});
  const set = (p: ReportParam, v: string) => setParams((prev) => ({ ...prev, [p]: v }));
  const classroom = classes.data?.find((c) => c.classroomId === params.classroomId);
  const spec = key ? REPORT_PARAMS[key] : null;
  const wanted = spec ? [...spec.required, ...spec.optional] : [];
  const missing = key ? missingParams(key, params) : [];

  const cleanParams = (): PrimaryReportParams => Object.fromEntries(Object.entries(params).filter(([k, v]) => v && wanted.includes(k as ReportParam))) as PrimaryReportParams;

  async function exportCsv() {
    if (!key) return;
    setExporting(true);
    setExportError(null);
    try {
      const csv = await fetchPrimaryReportCsv(key, cleanParams());
      downloadTextFile(csvFileName(key), csv, "text/csv", { bom: true });
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  }

  const data: PrimaryReportDto | undefined = report.data;
  type Row = Record<string, string | number | boolean | null>;
  const rows: Row[] = useMemo(() => (data?.rows ?? []).map((r, i) => ({ ...r, __row: i })), [data]);
  const columns: Column<Row>[] = useMemo(
    () =>
      (data?.columns ?? []).map((c) => ({
        key: c.key,
        header: c.label,
        label: c.label,
        cell: (row: Row) => {
          const v = row[c.key];
          return v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? t("yes") : t("no")) : String(v);
        },
      })),
    [data, t],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner />
      <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <legend className="px-1 text-sm font-medium">{t("form.legend")}</legend>
        <FormField label={t("form.report")} required>
          {(c) => (
            <NativeSelect
              {...c}
              value={key}
              onChange={(v) => {
                setKey(v as PrimaryReportKey | "");
                setRequested(null);
              }}
              placeholder={t("form.choose")}
              options={keys.map((k) => ({ value: k, label: label("reportKey", k) }))}
            />
          )}
        </FormField>
        {wanted.includes("classroomId") ? (
          <FormField label={t("form.classroom")} required={spec?.required.includes("classroomId")}>
            {(c) => <NativeSelect {...c} value={params.classroomId ?? ""} onChange={(v) => setParams((p) => ({ ...p, classroomId: v, periodId: "" }))} placeholder={t("form.choose")} options={(classes.data ?? []).map((x) => ({ value: x.classroomId, label: classLabel(x) }))} />}
          </FormField>
        ) : null}
        {wanted.includes("periodId") ? (
          <FormField label={t("form.period")} required={spec?.required.includes("periodId")}>
            {(c) => <NativeSelect {...c} value={params.periodId ?? ""} onChange={(v) => set("periodId", v)} disabled={!classroom} placeholder={t("form.choose")} options={(classroom?.periods ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
          </FormField>
        ) : null}
        {wanted.includes("yearId") ? (
          <FormField label={t("form.year")}>{(c) => <NativeSelect {...c} value={params.yearId ?? ""} onChange={(v) => set("yearId", v)} placeholder={t("form.yearDefault")} options={years} />}</FormField>
        ) : null}
        {wanted.includes("month") ? (
          <FormField label={t("form.month")} required hint={t("form.monthHint")}>
            {(c) => <TextControl {...c} type="text" value={params.month ?? ""} onChange={(v) => set("month", v)} placeholder="AAAA-MM" maxLength={7} />}
          </FormField>
        ) : null}
        {wanted.includes("deliberationId") ? (
          <FormField label={t("form.council")} required>
            {(c) => (
              <NativeSelect
                {...c}
                value={params.deliberationId ?? ""}
                onChange={(v) => set("deliberationId", v)}
                placeholder={t("form.choose")}
                options={(councils.data ?? []).map((x) => {
                  const cls = classes.data?.find((k) => k.classroomId === x.classroomId);
                  const period = cls?.periods.find((p) => p.id === x.periodId)?.label ?? x.periodId.slice(0, 8);
                  return { value: x.deliberationId, label: `${cls ? classLabel(cls) : x.classroomId.slice(0, 8)} · ${period}` };
                })}
              />
            )}
          </FormField>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.primary} disabled={!key || missing.length > 0} onClick={() => key && setRequested({ key, params: cleanParams() })}>
            {t("form.show")}
          </button>
          <button type="button" className={buttonClass.secondary} disabled={!key || missing.length > 0 || exporting} onClick={() => void exportCsv()}>
            {exporting ? t("form.exporting") : t("form.exportCsv")}
          </button>
        </div>
        {key && missing.length > 0 ? <p className="text-xs text-muted-foreground">{t("form.missing")}</p> : null}
        <PrimaryError error={exportError} />
      </fieldset>

      {requested ? (
        report.isPending ? (
          <LoadingBlock />
        ) : report.isError ? (
          <PrimaryError error={report.error} />
        ) : data ? (
          <section aria-label={t("result.label")} className="space-y-3">
            <h2 className="text-lg font-semibold">{data.title}</h2>
            <p className="text-xs text-muted-foreground">{t("result.generatedAt", { date: dateFmt.instant(data.generatedAt) })}</p>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs" aria-label={t("result.parameters")}>
              {Object.entries(data.parameters)
                .filter(([, v]) => v !== null)
                .map(([k, v]) => (
                  <div key={k} className="flex gap-1">
                    <dt className="font-medium text-muted-foreground">{t(`result.param.${k}`)}</dt>
                    <dd className="font-mono">{String(v)}</dd>
                  </div>
                ))}
            </dl>
            {data.rows.length === 0 ? <EmptyBlock title={t("result.empty")} /> : <ResponsiveTable columns={columns} rows={rows} rowKey={(r) => String(r.__row)} caption={data.title} />}
          </section>
        ) : null
      ) : (
        <Notice kind="info">{t("result.hint")}</Notice>
      )}
    </div>
  );
}
