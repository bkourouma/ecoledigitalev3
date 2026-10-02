"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ADMISSION_ACCEPTED_MIME, type AdmissionsApplicationDetailDto, type AdmissionsApplicationDocumentDto } from "@ecoledigitale/contracts/v2/admissions";
import { fetchDocumentUrl, useReviewApplicationDocument, useUploadApplicationDocument } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";

const TONE: Record<AdmissionsApplicationDocumentDto["status"], Tone> = { MISSING: "warning", SUBMITTED: "info", ACCEPTED: "success", REJECTED: "danger" };

/** Pièces du dossier : dépôt par le secrétariat, contrôle (acceptation / rejet motivé), consultation par lien signé court et audité. */
export function DossierDocuments({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.documents");
  const ts = useTranslations("v2Admissions.documentStatus");
  const fmt = useDateFormat();
  const describe = useDescribeError();
  const upload = useUploadApplicationDocument(application.id);
  const review = useReviewApplicationDocument(application.id);
  const [rejecting, setRejecting] = useState<AdmissionsApplicationDocumentDto | null>(null);
  const [viewError, setViewError] = useState<unknown>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const rows = application.documents.filter((d) => d.applicable);

  async function view(doc: AdmissionsApplicationDocumentDto) {
    setViewError(null);
    try {
      const { url } = await fetchDocumentUrl(application.id, doc.requirementId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setViewError(error);
    }
  }

  return (
    <section aria-labelledby="dossier-documents" className="space-y-3 rounded-lg border p-4">
      <h2 id="dossier-documents" className="text-base font-semibold">
        {t("title")}
      </h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      {upload.error ? <Notice kind="error">{describe(upload.error)}</Notice> : null}
      {review.error ? <Notice kind="error">{describe(review.error)}</Notice> : null}
      {viewError ? <Notice kind="error">{describe(viewError)}</Notice> : null}
      <ul className="divide-y">
        {rows.map((doc) => (
          <li key={doc.requirementId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {doc.requirementLabel} {doc.required ? <span className="text-xs text-muted-foreground">({t("required")})</span> : null}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge label={ts(doc.status)} tone={TONE[doc.status]} />
                {doc.submittedAt ? <span>{t("submittedAt", { date: fmt.instant(doc.submittedAt) })}</span> : null}
                {doc.attempts > 1 ? <span>{t("attempts", { count: doc.attempts })}</span> : null}
              </p>
              {doc.rejectionReason ? <p className="mt-1 text-xs text-destructive">{t("rejectedFor", { reason: doc.rejectionReason })}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Can permission="admission.document.upload">
                <input
                  ref={(el) => {
                    inputs.current[doc.requirementId] = el;
                  }}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t("uploadAria", { label: doc.requirementLabel })}
                  id={`up-${doc.requirementId}`}
                  accept={ADMISSION_ACCEPTED_MIME.join(",")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate({ requirementId: doc.requirementId, file });
                    e.target.value = "";
                  }}
                />
                <button type="button" className={buttonClass.secondary} disabled={upload.isPending} onClick={() => inputs.current[doc.requirementId]?.click()} aria-label={t("uploadAria", { label: doc.requirementLabel })}>
                  {doc.status === "MISSING" ? t("upload") : t("replace")}
                </button>
              </Can>
              <Can permission="admission.document.review">
                {doc.status !== "MISSING" ? (
                  <button type="button" className={buttonClass.secondary} onClick={() => void view(doc)} aria-label={t("viewAria", { label: doc.requirementLabel })}>
                    {t("view")}
                  </button>
                ) : null}
                {doc.status === "SUBMITTED" ? (
                  <>
                    <button type="button" className={buttonClass.primary} disabled={review.isPending} onClick={() => review.mutate({ requirementId: doc.requirementId, decision: "ACCEPT" })} aria-label={t("acceptAria", { label: doc.requirementLabel })}>
                      {t("accept")}
                    </button>
                    <button type="button" className={buttonClass.secondary} onClick={() => setRejecting(doc)} aria-label={t("rejectAria", { label: doc.requirementLabel })}>
                      {t("reject")}
                    </button>
                  </>
                ) : null}
              </Can>
            </div>
          </li>
        ))}
      </ul>
      {rejecting ? (
        <ReasonDialog
          open
          onOpenChange={(open) => (!open ? setRejecting(null) : undefined)}
          title={t("rejectTitle", { label: rejecting.requirementLabel })}
          description={t("rejectDescription")}
          reasonLabel={t("rejectReason")}
          confirmLabel={t("reject")}
          destructive
          minLength={3}
          isPending={review.isPending}
          error={review.error}
          onConfirm={(reason) => review.mutate({ requirementId: rejecting.requirementId, decision: "REJECT", reason }, { onSuccess: () => setRejecting(null) })}
        />
      ) : null}
    </section>
  );
}
