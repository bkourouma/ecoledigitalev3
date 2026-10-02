"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ExamBatchDto, ExamBatchKind, ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { UploadDropzone } from "@/platform/ui/UploadDropzone";
import { useDateFormat } from "@/platform/ui/format";
import { useApplyImport, useCreateImport, useImportBatch, useImportBatches, useImportFormats, useValidateImport } from "@/platform/v2/examinations";
import { SessionScope, StatusPill, useExamLabels } from "./shared";

const KINDS: readonly ExamBatchKind[] = ["OFFICIAL_NUMBERS", "SCORES", "RESULTS"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Lit un fichier en base64 (le contenu part tel quel : l'API décode, analyse et garde l'empreinte). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

const batchTone = (s: string) => (s === "APPLIED" ? "success" : s === "REJECTED" ? "danger" : s === "VALIDATED" ? "info" : "neutral");

function BatchDetail({ batch }: { batch: ExamBatchDto }) {
  const t = useTranslations("v2Examinations.imports.detail");
  const labels = useExamLabels();
  const flash = useFlash();
  const detail = useImportBatch(batch.id, "ERROR");
  const validate = useValidateImport();
  const apply = useApplyImport();

  async function runValidate() {
    flash.show(null);
    try {
      await validate.mutateAsync(batch.id);
    } catch {
      /* erreur affichée */
    }
  }
  async function runApply() {
    flash.show(null);
    try {
      await apply.mutateAsync(batch.id);
      flash.show(t("applied"));
    } catch {
      /* erreur affichée */
    }
  }
  const report = validate.data;
  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="batch-detail">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{batch.fileName}</h3>
        <StatusPill label={labels.batchStatus(batch.status)} tone={batchTone(batch.status)} />
      </div>
      <p className="text-sm text-muted-foreground" data-testid="batch-counts">{t("counts", { rows: batch.rowCount, ok: batch.okCount, errors: batch.errorCount })}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">{t("sha", { sha: batch.sha256 })}</p>
      {flash.node}
      <div className="flex flex-wrap gap-2">
        {batch.status === "UPLOADED" || batch.status === "VALIDATED" ? <button type="button" className={buttonClass.secondary} disabled={validate.isPending} onClick={() => void runValidate()}>{t("validate")}</button> : null}
        {batch.status === "VALIDATED" ? (
          <Can permission="exam.result.release">
            <button type="button" className={buttonClass.primary} disabled={apply.isPending || batch.errorCount > 0} onClick={() => void runApply()}>{t("apply")}</button>
          </Can>
        ) : null}
      </div>
      {batch.status === "VALIDATED" && batch.errorCount > 0 ? <Notice kind="warning">{t("applyBlocked")}</Notice> : null}
      {validate.isError ? <ErrorBlock error={validate.error} /> : null}
      {apply.isError ? <ErrorBlock error={apply.error} /> : null}
      {report?.fileError ? <Notice kind="error">{labels.importError(report.fileError)}</Notice> : null}
      {report && report.ignoredHeaders.length > 0 ? <Notice kind="info">{t("ignoredHeaders", { headers: report.ignoredHeaders.join(", ") })}</Notice> : null}
      {report && Object.keys(report.errorsByCode).length > 0 ? (
        <ul aria-label={t("errorsByCode")} className="list-disc pl-5 text-sm">
          {Object.entries(report.errorsByCode).map(([code, n]) => <li key={code}>{labels.importError(code)} : {n}</li>)}
        </ul>
      ) : null}
      {detail.isPending ? <LoadingBlock /> : detail.isError ? <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} /> : detail.data.rows.items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("errorRows")}>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("errorRows")}</caption>
            <thead className="bg-muted/50 text-left"><tr><th scope="col" className="px-3 py-2">{t("line")}</th><th scope="col" className="px-3 py-2">{t("error")}</th><th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("candidate")}</th></tr></thead>
            <tbody>
              {detail.data.rows.items.map((r) => (
                <tr key={r.id} className="border-t"><th scope="row" className="px-3 py-2 text-left">{r.lineNo}</th><td className="px-3 py-2">{r.errorCode ? labels.importError(r.errorCode) : "—"}</td><td className="hidden px-3 py-2 sm:table-cell">{r.candidateNumber ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.imports");
  const labels = useExamLabels();
  const date = useDateFormat();
  const batches = useImportBatches(session.id);
  const create = useCreateImport(session.id);
  const [kind, setKind] = useState<ExamBatchKind>("RESULTS");
  const [formatId, setFormatId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const formats = useImportFormats(kind);
  const formatOptions = (formats.data ?? []).filter((f) => f.examTypeId === null || f.examTypeId === session.examTypeId).map((f) => ({ value: f.id, label: `${f.label} (v${f.version})${f.placeholder ? ` — ${t("demo")}` : ""}` }));

  async function onFile(file: File) {
    setReadError(false);
    setFileName(file.name);
    let contentBase64: string;
    try {
      contentBase64 = await fileToBase64(file);
    } catch {
      setReadError(true);
      return;
    }
    try {
      const out = await create.mutateAsync({ kind, formatId, fileName: file.name, contentBase64 });
      setSelected(out.id);
    } catch {
      /* erreur de l'API affichée sous la zone de dépôt */
    }
  }

  const items = batches.data ?? [];
  const current = items.find((b) => b.id === selected) ?? null;
  return (
    <div className="space-y-4">
      <Notice kind="info">{t("notice")}</Notice>
      <section aria-labelledby="upload-title" className="space-y-3 rounded-md border p-4">
        <h2 id="upload-title" className="text-base font-semibold">{t("upload.title")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label={t("upload.kind")} required>{(c) => <NativeSelect {...c} value={kind} options={KINDS.map((k) => ({ value: k, label: labels.batchKind(k) }))} onChange={(v) => { setKind(v as ExamBatchKind); setFormatId(""); }} />}</FormField>
          <FormField label={t("upload.format")} required hint={formatOptions.length === 0 ? t("upload.noFormat") : undefined}>{(c) => <NativeSelect {...c} value={formatId} placeholder={t("upload.chooseFormat")} options={formatOptions} onChange={setFormatId} />}</FormField>
        </div>
        <UploadDropzone onFile={(f) => void onFile(f)} extensions={["csv", "txt", "xlsx"]} maxBytes={MAX_BYTES} busy={create.isPending} disabled={formatId === ""} selectedName={fileName} />
        {formatId === "" ? <p className="text-xs text-muted-foreground">{t("upload.needFormat")}</p> : null}
        {readError ? <Notice kind="error">{t("upload.readError")}</Notice> : null}
        {create.isError ? <ErrorBlock error={create.error} /> : null}
      </section>

      <section aria-labelledby="batches-title" className="space-y-3">
        <h2 id="batches-title" className="text-lg font-semibold">{t("batches.title")}</h2>
        {batches.isPending ? <LoadingBlock /> : batches.isError ? <ErrorBlock error={batches.error} onRetry={() => void batches.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("batches.empty")} description={t("batches.emptyHint")} /> : (
          <ul className="space-y-2">
            {items.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{b.fileName}</p>
                  <p className="text-sm text-muted-foreground">{labels.batchKind(b.kind)} — {date.instant(b.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill label={labels.batchStatus(b.status)} tone={batchTone(b.status)} />
                  <button type="button" className={buttonClass.secondary} aria-expanded={selected === b.id} onClick={() => setSelected(selected === b.id ? null : b.id)}>{selected === b.id ? t("batches.hide") : t("batches.open")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {current ? <BatchDetail batch={current} /> : null}
      </section>
    </div>
  );
}

/** Imports de l'autorité (numéros officiels, notes, résultats) : analyse, rapport d'erreurs ligne par ligne, application atomique. */
export function ImportsScreen() {
  const t = useTranslations("v2Examinations.imports");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope kind="OFFICIAL">{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
