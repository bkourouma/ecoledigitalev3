"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import { useDocumentCategories } from "@/platform/v2/documents";
import { useAttachToStudentFile, type AdmissionsAttachToStudentFileResultDto } from "@/platform/v2/admissions-attach";
import { usePermission } from "@/platform/access";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDescribeError } from "@/platform/ui/errors";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

const OUTCOME_TONE: Record<"ATTACHED" | "ALREADY_PRESENT" | "FAILED", Tone> = { ATTACHED: "success", ALREADY_PRESENT: "neutral", FAILED: "danger" };

/**
 * Dossier ENROLLED : rattachement des pièces ACCEPTÉES au dossier permanent de l'élève (GED). Aucune copie automatique :
 * la personne choisit la catégorie GED puis confirme explicitement, et devient le déposant dans l'historique de la GED. Le
 * rapport (rattachées / déjà présentes / en échec) est celui de l'API ; les droits GED réels sont relus côté serveur.
 */
export function DossierAttach({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2AdmissionsAttach");
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<AdmissionsAttachToStudentFileResultDto | null>(null);
  const upload = usePermission("documents.upload");
  if (application.status !== "ENROLLED") return null;
  const accepted = application.documents.filter((d) => d.applicable && d.status === "ACCEPTED");
  const labels = new Map(application.documents.map((d) => [d.requirementId, d.requirementLabel]));

  return (
    <Can permission="admission.document.attach">
      <section aria-labelledby="dossier-attach" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
        <h2 id="dossier-attach" className="text-base font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {accepted.length === 0 ? <Notice kind="info">{t("noneAccepted")}</Notice> : <p className="text-sm">{t("acceptedCount", { count: accepted.length })}</p>}
        {!upload.allowed && !upload.isLoading ? <Notice kind="warning">{t("needsUpload")}</Notice> : null}
        {report ? <AttachReport report={report} labels={labels} /> : null}
        <button type="button" className={buttonClass.secondary} disabled={accepted.length === 0 || !upload.allowed} onClick={() => setOpen(true)}>
          {t("action")}
        </button>
        {open ? (
          <AttachDialog
            applicationId={application.id}
            count={accepted.length}
            onClose={() => setOpen(false)}
            onDone={(r) => {
              setOpen(false);
              setReport(r);
            }}
          />
        ) : null}
      </section>
    </Can>
  );
}

function AttachDialog({ applicationId, count, onClose, onDone }: { applicationId: string; count: number; onClose: () => void; onDone: (report: AdmissionsAttachToStudentFileResultDto) => void }) {
  const t = useTranslations("v2AdmissionsAttach.dialog");
  const describe = useDescribeError();
  const categories = useDocumentCategories({ kind: "STUDENT" });
  const attach = useAttachToStudentFile(applicationId);
  const [categoryId, setCategoryId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const options = (categories.data?.items ?? []).filter((c) => c.status === "ACTIVE" && c.canUpload);
  const categoryError = submitted && categoryId === "" ? t("errors.category") : null;
  const confirmError = submitted && !confirmed ? t("errors.confirm") : null;

  function submit() {
    setSubmitted(true);
    if (categoryId === "" || !confirmed) return;
    attach.mutate({ categoryId }, { onSuccess: onDone });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description", { count })} submitLabel={t("submit")} isPending={attach.isPending} error={attach.error} onSubmit={submit}>
      {categories.error ? <Notice kind="error">{describe(categories.error)}</Notice> : null}
      <FormField label={t("category")} hint={t("categoryHint")} error={categoryError} required>
        {(c) => (
          <NativeSelect
            {...c}
            value={categoryId}
            onChange={setCategoryId}
            options={[{ value: "", label: categories.isPending && categories.fetchStatus !== "idle" ? t("loading") : t("choose") }, ...options.map((o) => ({ value: o.id, label: o.label }))]}
          />
        )}
      </FormField>
      {!categories.isPending && !categories.error && options.length === 0 ? <Notice kind="warning">{t("noCategory")}</Notice> : null}
      <Notice kind="info">{t("depositor")}</Notice>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-describedby={confirmError ? "attach-confirm-error" : undefined} />
          <span>{t("confirm")}</span>
        </label>
        {confirmError ? <p id="attach-confirm-error" className="mt-1 text-sm text-destructive">{confirmError}</p> : null}
      </div>
    </FormDialog>
  );
}

function AttachReport({ report, labels }: { report: AdmissionsAttachToStudentFileResultDto; labels: Map<string, string> }) {
  const t = useTranslations("v2AdmissionsAttach.report");
  const skipped = report.items.filter((i) => i.outcome === "ALREADY_PRESENT").length;
  return (
    <div role="status" className="space-y-2">
      <Notice kind={report.failed > 0 ? "warning" : "success"}>{t("summary", { attached: report.attached, skipped, failed: report.failed })}</Notice>
      <ul className="divide-y rounded-md border text-sm">
        {report.items.map((i) => (
          <li key={i.requirementId} className="flex flex-wrap items-center justify-between gap-2 p-2">
            <span>{labels.get(i.requirementId) ?? t("unknownRequirement")}</span>
            <span className="flex items-center gap-2">
              <StatusBadge label={t(`outcome.${i.outcome}`)} tone={OUTCOME_TONE[i.outcome]} />
              {i.code ? <code className="text-xs text-muted-foreground">{i.code}</code> : null}
            </span>
          </li>
        ))}
      </ul>
      {report.failed > 0 ? <p className="text-xs text-muted-foreground">{t("retryHint")}</p> : null}
    </div>
  );
}
