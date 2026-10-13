"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportUploadResult, ImporterKey } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, LoadingBlock, Notice, QueryBoundary, StatusBadge, useDescribeError } from "@/platform/ui";
import { downloadImportFile, templatePath, useImporters, useUploadImport } from "@/platform/v2/imports";
import { ACCEPT, INPUT_CLASS, formatBytes, visibleImporters } from "./import-utils";

/** Étape 1 — Fichier : choix de l'importeur, modèle à télécharger, envoi du fichier (corps brut ; type réel contrôlé par le serveur). */
export function UploadStep({ onUploaded }: { onUploaded: (result: ImportUploadResult) => void }) {
  const t = useTranslations("v2Imports.upload");
  const describe = useDescribeError();
  const importers = useImporters();
  const upload = useUploadImport();
  const [importer, setImporter] = useState<ImporterKey | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState("");
  const [touched, setTouched] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = importers.data?.items.find((i) => i.key === importer) ?? null;

  const importerError = touched && !importer ? t("importerRequired") : null;
  const fileError = touched && !file ? t("fileRequired") : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!importer || !file) return;
    const result = await upload.mutateAsync({ importer, file, ...(sheet.trim() ? { sheet: sheet.trim() } : {}) }).catch(() => null);
    if (result) onUploaded(result);
  }

  async function template(format: "csv" | "xlsx") {
    if (!importer) return;
    setDownloadError(null);
    try {
      await downloadImportFile(templatePath(importer), { format }, `modele-import-${importer}.${format}`);
    } catch (err) {
      setDownloadError(describe(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={t("title")} className="space-y-6">
      <QueryBoundary query={importers} isEmpty={(importers.data?.items.length ?? 0) === 0}>
        <fieldset className="space-y-3">
          <legend className="text-base font-semibold">{t("importerLegend")}</legend>
          <p className="text-sm text-muted-foreground">{t("importerHint")}</p>
          <div role="radiogroup" aria-describedby={importerError ? "upload-importer-error" : undefined} className="grid gap-3 md:grid-cols-2">
            {visibleImporters(importers.data?.items ?? []).map((i) => (
              <label
                key={i.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm focus-within:ring-2 focus-within:ring-ring ${importer === i.key ? "border-violet-400/60 bg-violet-500/15" : "border-white/10 hover:bg-white/[0.04]"} ${i.canUse ? "" : "cursor-not-allowed opacity-60"}`}
              >
                <input type="radio" name="importer" value={i.key} checked={importer === i.key} disabled={!i.canUse} onChange={() => setImporter(i.key)} className="mt-1 h-4 w-4" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {i.label}
                    {i.sensitive ? <StatusBadge label={t("sensitive")} tone="warning" /> : null}
                  </span>
                  <span className="block text-muted-foreground">{i.description}</span>
                  {!i.canUse ? <span className="mt-1 block text-xs">{t("notAllowed", { permissions: i.targetPermissions.join(", ") })}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {importerError ? (
            <p id="upload-importer-error" role="alert" className="text-sm text-destructive">
              {importerError}
            </p>
          ) : null}
        </fieldset>

        {selected ? (
          <section aria-labelledby="upload-columns" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h2 id="upload-columns" className="text-base font-semibold">
              {t("columnsTitle", { importer: selected.label })}
            </h2>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {selected.columns.map((c) => (
                <li key={c.key}>
                  <span className="font-medium">{c.label}</span>
                  {c.required ? <span className="text-destructive"> ({t("required")})</span> : null} <span className="text-muted-foreground">— {c.description}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => void template("xlsx")}>
                {t("templateXlsx")}
              </button>
              <button type="button" className={buttonClass.secondary} onClick={() => void template("csv")}>
                {t("templateCsv")}
              </button>
            </div>
            {downloadError ? <Notice kind="error">{downloadError}</Notice> : null}
          </section>
        ) : null}

        <div className="space-y-4">
          <div>
            <label htmlFor="upload-file" className="mb-1 block text-sm font-medium">
              {t("file")}
              <span className="sr-only"> ({t("required")})</span>
            </label>
            <input
              ref={fileRef}
              id="upload-file"
              type="file"
              accept={ACCEPT}
              className={`${INPUT_CLASS} h-auto py-2`}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={["upload-file-hint", fileError ? "upload-file-error" : ""].filter(Boolean).join(" ")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p id="upload-file-hint" className="mt-1 text-xs text-muted-foreground">
              {t("fileHint")}
              {file ? ` ${t("chosen", { name: file.name, size: formatBytes(file.size) })}` : ""}
            </p>
            {fileError ? (
              <p id="upload-file-error" role="alert" className="mt-1 text-sm text-destructive">
                {fileError}
              </p>
            ) : null}
          </div>
          <div className="max-w-sm">
            <label htmlFor="upload-sheet" className="mb-1 block text-sm font-medium">
              {t("sheet")}
            </label>
            <input id="upload-sheet" type="text" className={INPUT_CLASS} value={sheet} onChange={(e) => setSheet(e.target.value)} maxLength={100} aria-describedby="upload-sheet-hint" />
            <p id="upload-sheet-hint" className="mt-1 text-xs text-muted-foreground">
              {t("sheetHint")}
            </p>
          </div>
        </div>

        {upload.isError ? <Notice kind="error">{describe(upload.error)}</Notice> : null}
        {upload.isPending ? <LoadingBlock label={t("sending")} /> : null}
        <div>
          <button type="submit" className={buttonClass.primary} disabled={upload.isPending}>
            {t("submit")}
          </button>
        </div>
      </QueryBoundary>
    </form>
  );
}
