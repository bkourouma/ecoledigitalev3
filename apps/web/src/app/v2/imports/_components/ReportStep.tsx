"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ImportJobDto, ImporterDescriptor } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, Notice, QueryBoundary, StatusBadge, useDateFormat, useDescribeError } from "@/platform/ui";
import { downloadImportFile, reportPath, useImportSummary } from "@/platform/v2/imports";
import { RowsList } from "./RowsList";
import { formatDuration, toneOf } from "./import-utils";

/**
 * Étape 7 — Rapport : créés, mis à jour, ignorés, en erreur, durée, auteur ; erreurs par ligne et par colonne (liste lisible
 * sur mobile) ; téléchargement du rapport (CSV, Excel). Les valeurs sont neutralisées par le serveur à l'écriture du fichier.
 */
export function ReportStep({ job, importer }: { job: ImportJobDto; importer: ImporterDescriptor }) {
  const t = useTranslations("v2Imports.report");
  const dates = useDateFormat();
  const describe = useDescribeError();
  const summary = useImportSummary(job.id);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "csv" | "xlsx", kind: "errors" | "full") {
    setError(null);
    try {
      await downloadImportFile(reportPath(job.id), { format, kind }, `${job.fileName.replace(/\.[^.]+$/, "")}-${kind === "errors" ? "erreurs" : "rapport"}.${format}`);
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge label={t(`outcome.${job.status}`)} tone={toneOf(job.status)} />
        {job.status === "FAILED" && job.errorMessage ? <p className="text-sm text-destructive">{job.errorMessage}</p> : null}
      </div>
      {job.status === "CANCELLED" ? <Notice kind="info">{t("cancelledNote", { n: job.processedCount })}</Notice> : null}
      {job.status === "FAILED" && job.runMode === "ALL_OR_NOTHING" ? <Notice kind="warning">{t("allOrNothingNote")}</Notice> : null}

      <QueryBoundary query={summary}>
        {summary.data ? (
          <>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("totals")}>
              {(
                [
                  ["created", summary.data.totals.created],
                  ["updated", summary.data.totals.updated],
                  ["skipped", summary.data.totals.skipped],
                  ["failed", summary.data.totals.failed],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/10 bg-card/60 p-4">
                  <dt className="text-sm font-medium text-muted-foreground">{t(`totalsLabel.${k}`)}</dt>
                  <dd className={`mt-1 text-2xl font-bold tabular-nums ${k === "failed" && v > 0 ? "text-destructive" : ""}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" aria-label={t("details")}>
              <dt className="font-medium">{t("file")}</dt>
              <dd className="break-words">{summary.data.job.fileName}</dd>
              <dt className="font-medium">{t("importer")}</dt>
              <dd>{importer.label}</dd>
              <dt className="font-medium">{t("author")}</dt>
              <dd>{summary.data.author.displayName ?? summary.data.author.userId}</dd>
              <dt className="font-medium">{t("started")}</dt>
              <dd>{dates.instant(summary.data.job.startedAt)}</dd>
              <dt className="font-medium">{t("duration")}</dt>
              <dd>{formatDuration(summary.data.job.durationMs)}</dd>
              <dt className="font-medium">{t("mode")}</dt>
              <dd>{t(`modes.${summary.data.job.runMode}`)}</dd>
            </dl>
            {summary.data.topIssues.length > 0 ? (
              <section aria-labelledby="report-top" className="space-y-2">
                <h2 id="report-top" className="text-base font-semibold">
                  {t("topIssues")}
                </h2>
                <ul className="space-y-1 text-sm">
                  {summary.data.topIssues.map((i) => (
                    <li key={`${i.code}-${i.column ?? ""}`}>
                      <span className="font-medium tabular-nums">{i.count} ×</span> {i.example} <code className="text-xs text-muted-foreground">{i.code}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </QueryBoundary>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={() => void download("xlsx", "full")}>
          {t("downloadFullXlsx")}
        </button>
        <button type="button" className={buttonClass.secondary} onClick={() => void download("csv", "full")}>
          {t("downloadFullCsv")}
        </button>
        {job.failedCount > 0 ? (
          <button type="button" className={buttonClass.secondary} onClick={() => void download("csv", "errors")}>
            {t("downloadErrorsCsv")}
          </button>
        ) : null}
        <Link href="/v2/imports/new" className={buttonClass.primary}>
          {t("newImport")}
        </Link>
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}

      {job.failedCount > 0 ? (
        <section aria-labelledby="report-errors" className="space-y-2">
          <h2 id="report-errors" className="text-base font-semibold">
            {t("errorsTitle")}
          </h2>
          <RowsList jobId={job.id} columns={importer.columns} headers={job.headers} base={{}} defaultOnlyProblems />
        </section>
      ) : null}
    </div>
  );
}
