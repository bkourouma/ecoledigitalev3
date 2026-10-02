"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ASSIGNMENT_DOCUMENT_KINDS, type AssignmentDetailDto, type AssignmentDocumentDto } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { useAddAssignmentDocument, useWithdrawAssignmentDocument } from "@/platform/v2/stateassign";
import { DocumentPicker, type DocumentRef } from "@/platform/ui/DocumentPicker";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock } from "@/platform/ui/states";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { PERM, isIsoDate } from "./stateassign-utils";

function AddDialog({ assignmentId, open, onOpenChange }: { assignmentId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Stateassign.documents.add");
  const tKind = useTranslations("v2Stateassign.documentKind");
  const mutation = useAddAssignmentDocument();
  const [kind, setKind] = useState("ASSIGNMENT_ORDER");
  const [document, setDocument] = useState<DocumentRef | null>(null);
  const [label, setLabel] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const problems = { document: document ? null : t("errors.document"), date: receivedOn && !isIsoDate(receivedOn) ? t("errors.date") : null };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      onSubmit={() => {
        setSubmitted(true);
        if (problems.document || problems.date || !document) return;
        mutation.mutate({ assignmentId, kind, documentRef: document.id, label: label.trim() || null, receivedOn: receivedOn || null }, { onSuccess: () => onOpenChange(false) });
      }}
    >
      <FormField label={t("kind")} required>{(c) => <NativeSelect {...c} value={kind} onChange={setKind} options={ASSIGNMENT_DOCUMENT_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}</FormField>
      <DocumentPicker value={document} onChange={setDocument} label={t("document")} hint={t("documentHint")} required error={submitted ? problems.document : (errors.documentRef ?? null)} />
      <FormField label={t("label")}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}</FormField>
      <FormField label={t("receivedOn")} error={submitted ? problems.date : (errors.receivedOn ?? null)}>{(c) => <TextControl {...c} type="date" value={receivedOn} onChange={setReceivedOn} />}</FormField>
    </FormDialog>
  );
}

/** Pièces du dossier : des RÉFÉRENCES vers la gestion documentaire (acte d'affectation, certificat de présence, reçu, courrier), jamais le fichier. */
export function DocumentsPanel({ detail }: { detail: AssignmentDetailDto }) {
  const t = useTranslations("v2Stateassign.documents");
  const tKind = useTranslations("v2Stateassign.documentKind");
  const date = useDateFormat();
  const canManage = usePermission(PERM.documentManage).allowed;
  const withdraw = useWithdrawAssignmentDocument();
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState<AssignmentDocumentDto | null>(null);
  const status = detail.assignment.status;
  const open = status !== "REJECTED" && status !== "SUPERSEDED";
  return (
    <section aria-labelledby="documents-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="documents-title" className="text-base font-semibold">{t("title")}</h2>
        {canManage && open ? <button type="button" onClick={() => setAdding(true)} className={buttonClass.secondary}>{t("add.button")}</button> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      {detail.documents.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="divide-y rounded-md border" aria-label={t("list")}>
          {detail.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{d.label ?? tKind(d.kind)}</p>
                <p className="text-xs text-muted-foreground">
                  {tKind(d.kind)}
                  {d.receivedOn ? ` · ${t("receivedOn", { date: date.civil(d.receivedOn) })}` : ""}
                </p>
                {d.status === "WITHDRAWN" ? <p className="text-xs text-muted-foreground">{t("withdrawnReason", { reason: d.withdrawnReason ?? "—" })}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={t(`status.${d.status}`)} tone={d.status === "ACTIVE" ? "success" : "neutral"} />
                {canManage && d.status === "ACTIVE" ? (
                  <button type="button" onClick={() => setWithdrawing(d)} className={buttonClass.ghost}>
                    {t("withdraw.button")}
                    <span className="sr-only"> — {d.label ?? tKind(d.kind)}</span>
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? <AddDialog assignmentId={detail.assignment.id} open onOpenChange={(o) => !o && setAdding(false)} /> : null}
      <ReasonDialog
        open={withdrawing !== null}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title={t("withdraw.title")}
        description={t("withdraw.description")}
        reasonLabel={t("withdraw.reason")}
        confirmLabel={t("withdraw.submit")}
        destructive
        isPending={withdraw.isPending}
        error={withdraw.error}
        onConfirm={(reason) => withdrawing && withdraw.mutate({ id: withdrawing.id, reason }, { onSuccess: () => setWithdrawing(null) })}
      />
    </section>
  );
}
