"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportJobDto, ImportRowDto, ImportRunMode, ImporterDescriptor } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, LoadingBlock, Notice, QueryBoundary, StepUpDialog, useDescribeError, useStepUp } from "@/platform/ui";
import { downloadImportFile, reportPath, useImportPreview, useRunImport, useSetMapping } from "@/platform/v2/imports";
import { RowsList } from "./RowsList";

function Counter({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  const danger = tone === "danger" && value > 0;
  return (
    <div className={`rounded-2xl border p-4 ${danger ? "border-red-400/40 bg-red-400/10" : "border-white/10 bg-card/60"}`}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${danger ? "text-red-300" : ""}`}>{value}</dd>
    </div>
  );
}

function SampleList({ title, rows, columns }: { title: string; rows: ImportRowDto[]; columns: ImporterDescriptor["columns"] }) {
  const t = useTranslations("v2Imports.preview");
  if (rows.length === 0) return null;
  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title} ({rows.length})
      </summary>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.rowNo}>
            <span className="font-medium">{t("line", { n: r.rowNo })}</span> —{" "}
            {columns
              .map((c) => (r.values ? r.values[c.key] : null))
              .filter((v) => v !== null && v !== undefined && v !== "")
              .slice(0, 4)
              .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
              .join(" · ") || "—"}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Étapes 4 et 5 — Erreurs et Aperçu : décomptes de ce qui sera créé / mis à jour / ignoré / refusé (SANS écriture), tableau des
 * erreurs téléchargeable, choix du mode (tout ou rien / lignes valides seulement), lancement explicitement confirmé.
 */
export function PreviewStep({ job, importer }: { job: ImportJobDto; importer: ImporterDescriptor }) {
  const t = useTranslations("v2Imports.preview");
  const describe = useDescribeError();
  const preview = useImportPreview(job.id);
  const run = useRunImport(job.id);
  const stepUp = useStepUp();
  const back = useSetMapping(job.id);
  const [mode, setMode] = useState<ImportRunMode>(job.runMode);
  const [confirm, setConfirm] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function download(format: "csv" | "xlsx", kind: "errors" | "full") {
    setDownloadError(null);
    try {
      await downloadImportFile(reportPath(job.id), { format, kind }, `${job.fileName.replace(/\.[^.]+$/, "")}-${kind === "errors" ? "erreurs" : "rapport"}.${format}`);
    } catch (e) {
      setDownloadError(describe(e));
    }
  }

  return (
    <div className="space-y-6">
      <QueryBoundary query={preview}>
        {preview.data ? (
          <>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label={t("summary")}>
              <Counter label={t("willCreate")} value={preview.data.willCreate} />
              <Counter label={t("willUpdate")} value={preview.data.willUpdate} />
              <Counter label={t("willSkip")} value={preview.data.willSkip} />
              <Counter label={t("willFail")} value={preview.data.willFail} tone="danger" />
              <Counter label={t("warnings")} value={preview.data.warnings} tone="warning" />
            </dl>
            <Notice kind="info">{t("noWrite")}</Notice>

            {preview.data.topIssues.length > 0 ? (
              <section aria-labelledby="preview-top" className="space-y-2">
                <h2 id="preview-top" className="text-base font-semibold">
                  {t("topIssues")}
                </h2>
                <ul className="space-y-1 text-sm">
                  {preview.data.topIssues.map((i) => (
                    <li key={`${i.code}-${i.column ?? ""}`}>
                      <span className="font-medium tabular-nums">{i.count} ×</span> {i.example} <code className="text-xs text-muted-foreground">{i.code}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="preview-samples" className="space-y-2">
              <h2 id="preview-samples" className="text-base font-semibold">
                {t("samples")}
              </h2>
              <SampleList title={t("sampleCreate")} rows={preview.data.samples.create} columns={importer.columns} />
              <SampleList title={t("sampleUpdate")} rows={preview.data.samples.update} columns={importer.columns} />
              <SampleList title={t("sampleSkip")} rows={preview.data.samples.skip} columns={importer.columns} />
            </section>

            <section aria-labelledby="preview-errors" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="preview-errors" className="text-base font-semibold">
                  {t("errorsTitle")}
                </h2>
                {preview.data.invalidRows > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass.secondary} onClick={() => void download("xlsx", "errors")}>
                      {t("downloadXlsx")}
                    </button>
                    <button type="button" className={buttonClass.secondary} onClick={() => void download("csv", "errors")}>
                      {t("downloadCsv")}
                    </button>
                  </div>
                ) : null}
              </div>
              {downloadError ? <Notice kind="error">{downloadError}</Notice> : null}
              {preview.data.invalidRows === 0 ? <Notice kind="success">{t("noErrors")}</Notice> : <RowsList jobId={job.id} columns={importer.columns} headers={job.headers} base={{ validation: "INVALID" }} defaultOnlyProblems={false} />}
            </section>

            <form
              className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4"
              aria-label={t("launchTitle")}
              onSubmit={(e) => {
                e.preventDefault();
                // Import sensible (soldes) refusé en `imports.mfa_required` : confirmation d'identité puis relance unique.
                if (confirm) void stepUp.run(() => run.mutateAsync({ runMode: mode, onExisting: job.onExisting, confirm: true })).catch(() => undefined);
              }}
            >
              <h2 className="text-base font-semibold">{t("launchTitle")}</h2>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("modeLegend")}</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="runMode" checked={mode === "VALID_ONLY"} onChange={() => setMode("VALID_ONLY")} className="mt-1 h-4 w-4" />
                  <span>
                    <span className="font-medium">{t("modeValidOnly")}</span>
                    <span className="block text-muted-foreground">{t("modeValidOnlyHint")}</span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 text-sm ${preview.data.invalidRows > 0 ? "opacity-60" : ""}`}>
                  <input type="radio" name="runMode" checked={mode === "ALL_OR_NOTHING"} disabled={preview.data.invalidRows > 0} onChange={() => setMode("ALL_OR_NOTHING")} className="mt-1 h-4 w-4" />
                  <span>
                    <span className="font-medium">{t("modeAllOrNothing")}</span>
                    <span className="block text-muted-foreground">{preview.data.invalidRows > 0 ? t("modeAllOrNothingBlocked") : t("modeAllOrNothingHint")}</span>
                  </span>
                </label>
              </fieldset>
              {importer.sensitive ? <Notice kind="warning">{t("sensitive")}</Notice> : null}
              {preview.data.blockers.length > 0 && mode === job.runMode ? (
                <ul className="space-y-1 text-sm text-destructive" aria-label={t("blockers")}>
                  {preview.data.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 h-4 w-4" />
                {t("confirm")}
              </label>
              {run.isError ? <Notice kind="error">{describe(run.error)}</Notice> : null}
              {run.isPending ? <LoadingBlock label={t("launching")} /> : null}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={buttonClass.primary} disabled={!confirm || run.isPending || preview.data.validRows - preview.data.willSkip <= 0}>
                  {t("launch")}
                </button>
                <button
                  type="button"
                  className={buttonClass.secondary}
                  disabled={back.isPending}
                  onClick={() => {
                    if (job.mapping) back.mutate({ mapping: job.mapping, options: job.options as Record<string, string | number | boolean>, runMode: job.runMode, onExisting: job.onExisting });
                  }}
                >
                  {t("editMapping")}
                </button>
              </div>
              {back.isError ? <Notice kind="error">{describe(back.error)}</Notice> : null}
            </form>
            <StepUpDialog {...stepUp.dialogProps} />
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
