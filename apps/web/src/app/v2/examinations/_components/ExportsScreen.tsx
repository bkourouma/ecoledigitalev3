"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EXAM_COUNT_GROUPS, EXAM_DOCUMENT_KINDS, type ExamCountGroup, type ExamDocumentKind, type ExamExportRunDto, type ExamIssuedDocumentDto, type ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { PdfButton } from "@/platform/ui/PdfButton";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useDateFormat } from "@/platform/ui/format";
import { fetchExportDownload, issuedDocumentFilePath, useExportFormats, useExportRuns, useIssueBatch, useIssuedDocuments, useRevokeDocument, useRunExport } from "@/platform/v2/examinations";
import { BatchReport, SessionScope, StatusPill, useExamLabels } from "./shared";

const runTone = (s: string) => (s === "DONE" ? "success" : s === "FAILED" ? "danger" : "warning");

function RunRow({ run }: { run: ExamExportRunDto }) {
  const t = useTranslations("v2Examinations.exports.runs");
  const date = useDateFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      // URL signée COURTE : suivie aussitôt, jamais conservée ni affichée ; la demande est journalisée par l'API.
      const out = await fetchExportDownload(run.id);
      window.open(out.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{run.formatCode ?? "—"} v{run.formatVersion}</p>
        <p className="text-sm text-muted-foreground">{date.instant(run.createdAt)}{run.rowCount !== null ? ` — ${t("rows", { count: run.rowCount })}` : ""}</p>
        {run.fileSha256 ? <p className="break-all font-mono text-xs text-muted-foreground">{run.fileSha256}</p> : null}
        {run.errorCode ? <p className="text-sm text-destructive">{run.errorCode}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <StatusPill label={t(`status.${run.status}` as never)} tone={runTone(run.status)} />
        {run.status === "DONE" ? <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => void download()}>{t("download")}</button> : null}
      </div>
      {error ? <ErrorBlock error={error} /> : null}
    </li>
  );
}

function ExportsSection({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.exports");
  const labels = useExamLabels();
  const formats = useExportFormats();
  const runs = useExportRuns(session.id);
  const run = useRunExport(session.id);
  const [formatId, setFormatId] = useState("");
  const [groupBy, setGroupBy] = useState<"" | ExamCountGroup>("");
  const options = (formats.data ?? []).filter((f) => f.examTypeId === null || f.examTypeId === session.examTypeId);
  const chosen = options.find((f) => f.id === formatId);
  return (
    <section aria-labelledby="exports-title" className="space-y-3">
      <h2 id="exports-title" className="text-lg font-semibold">{t("title")}</h2>
      <Notice kind="info">{t("notice")}</Notice>
      <div className="grid gap-3 md:grid-cols-3">
        <FormField label={t("format")} required hint={options.length === 0 ? t("noFormat") : undefined}>{(c) => <NativeSelect {...c} value={formatId} placeholder={t("chooseFormat")} options={options.map((f) => ({ value: f.id, label: `${f.label} (${f.fileFormat}, v${f.version})${f.placeholder ? ` — ${t("demo")}` : ""}` }))} onChange={setFormatId} />}</FormField>
        {chosen?.kind === "STATISTICS" ? <FormField label={t("groupBy")}>{(c) => <NativeSelect {...c} value={groupBy} placeholder={t("groupByDefault")} options={EXAM_COUNT_GROUPS.map((g) => ({ value: g, label: labels.countGroup(g) }))} onChange={(v) => setGroupBy(v as ExamCountGroup | "")} />}</FormField> : null}
      </div>
      <button type="button" className={buttonClass.primary} disabled={!formatId || run.isPending} onClick={() => run.mutate({ formatId, ...(groupBy ? { filters: { groupBy } } : {}) })}>{t("run")}</button>
      {run.isError ? <ErrorBlock error={run.error} /> : null}
      {runs.isPending ? <LoadingBlock /> : runs.isError ? <ErrorBlock error={runs.error} onRetry={() => void runs.refetch()} /> : runs.data.length === 0 ? <EmptyBlock title={t("runs.empty")} description={t("runs.emptyHint")} /> : (
        <>
          <ul className="space-y-2" aria-label={t("runs.label")}>{runs.data.map((r) => <RunRow key={r.id} run={r} />)}</ul>
          <button type="button" className={buttonClass.ghost} onClick={() => void runs.refetch()}>{t("runs.refresh")}</button>
        </>
      )}
    </section>
  );
}

function DocumentRow({ d, onRevoke }: { d: ExamIssuedDocumentDto; onRevoke: (d: ExamIssuedDocumentDto) => void }) {
  const t = useTranslations("v2Examinations.documents");
  const labels = useExamLabels();
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{labels.docKind(d.kind)} v{d.version} — {d.candidateNumber ?? d.candidateId.slice(0, 8)}</p>
        <p className="text-sm text-muted-foreground">{labels.docStatus(d.status)}{d.revokedReason ? ` — ${d.revokedReason}` : ""}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {d.status === "ISSUED" ? <PdfButton path={issuedDocumentFilePath(d.id)} fileName={`${d.kind}-${d.candidateNumber ?? d.id}.pdf`} label={t("download")} ariaLabel={t("downloadAria", { kind: labels.docKind(d.kind), number: d.candidateNumber ?? "" })} /> : null}
        {d.status === "ISSUED" ? <button type="button" className={buttonClass.ghost} onClick={() => onRevoke(d)}>{t("revoke")}</button> : null}
      </div>
    </li>
  );
}

function DocumentsSection({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.documents");
  const labels = useExamLabels();
  const [kind, setKind] = useState<ExamDocumentKind>("CONVOCATION");
  const docs = useIssuedDocuments(session.id);
  const issue = useIssueBatch(session.id);
  const revoke = useRevokeDocument();
  const [revoking, setRevoking] = useState<ExamIssuedDocumentDto | null>(null);
  return (
    <section aria-labelledby="docs-title" className="space-y-3">
      <h2 id="docs-title" className="text-lg font-semibold">{t("title")}</h2>
      {session.sessionKind === "MOCK" ? <Notice kind="info">{t("mockNone")}</Notice> : (
        <>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField label={t("kind")} className="sm:w-72">{(c) => <NativeSelect {...c} value={kind} options={EXAM_DOCUMENT_KINDS.map((k) => ({ value: k, label: labels.docKind(k) }))} onChange={(v) => setKind(v as ExamDocumentKind)} />}</FormField>
            <button type="button" className={buttonClass.primary} disabled={issue.isPending} onClick={() => issue.mutate({ kind })}>{t("issueBatch")}</button>
          </div>
          {issue.isError ? <ErrorBlock error={issue.error} /> : null}
          {issue.data ? <BatchReport summary={t("report", { issued: issue.data.issued, skipped: issue.data.skipped.length })} failures={[...issue.data.failed.map((f) => ({ id: f.candidateId, message: f.message, code: f.code })), ...issue.data.skipped.map((s) => ({ id: `s-${s.candidateId}`, message: labels.reason(s.reason) }))]} /> : null}
          {docs.isPending ? <LoadingBlock /> : docs.isError ? <ErrorBlock error={docs.error} onRetry={() => void docs.refetch()} /> : docs.data.items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : <ul className="space-y-2" aria-label={t("listLabel")}>{docs.data.items.map((d) => <DocumentRow key={d.id} d={d} onRevoke={setRevoking} />)}</ul>}
        </>
      )}
      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t("revokeDialog.title")}
        description={t("revokeDialog.description")}
        reasonLabel={t("revokeDialog.reason")}
        confirmLabel={t("revokeDialog.confirm")}
        minLength={10}
        destructive
        isPending={revoke.isPending}
        error={revoke.error}
        onConfirm={async (reason) => {
          if (!revoking) return;
          try {
            await revoke.mutateAsync({ id: revoking.id, reason });
            setRevoking(null);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
    </section>
  );
}

/** Exports officiels paramétrables (formats = données) et documents scellés (convocation, attestation, relevé). */
export function ExportsScreen() {
  const t = useTranslations("v2Examinations.exports");
  return (
    <div>
      <PageHeader title={t("pageTitle")} description={t("pageDescription")} />
      <SessionScope>
        {(session) => (
          <div className="space-y-8">
            <Can permission="exam.export.run"><ExportsSection session={session} /></Can>
            <Can permission="exam.document.issue"><DocumentsSection session={session} /></Can>
          </div>
        )}
      </SessionScope>
    </div>
  );
}
