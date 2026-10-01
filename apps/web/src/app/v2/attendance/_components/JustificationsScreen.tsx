"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ATTENDANCE_JUSTIFICATION_STATUSES, type attendanceJustificationDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import type { z } from "zod";
import { ApiError } from "@/platform/api/errors";
import { fetchAttachmentUrl, useAcceptJustification, useJustification, useJustificationReasons, useJustifications, useRejectJustification, useRevokeJustification } from "@/platform/v2/attendance";
import { useStudent } from "@/platform/v2/people";
import { useStudentOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { JustificationForm } from "./JustificationForm";

type Justification = z.infer<typeof attendanceJustificationDtoSchema>;

export function justificationTone(status: string): Tone {
  if (status === "ACCEPTED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED" || status === "REVOKED") return "danger";
  return "neutral";
}

/** Nom d'un élève par son identifiant (lecture à la demande, partagée par le cache) ; identifiant abrégé sinon. */
export function StudentName({ id }: { id: string }) {
  const q = useStudent(id);
  return <>{q.data?.displayName ?? `…${id.slice(-4)}`}</>;
}

/** File de décision des justificatifs : filtres, détail avec pièces, acceptation, rejet motivé, révocation motivée, dépôt. */
export function JustificationsScreen() {
  const t = useTranslations("v2Attendance.justifications");
  const date = useDateFormat();
  const flash = useFlash();
  const [status, setStatus] = useState<string>("PENDING");
  const [student, setStudent] = useState<SelectOption | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [depositing, setDepositing] = useState(false);

  const list = useJustifications({ status: (status || undefined) as Justification["status"] | undefined, studentId: student?.value, from: from || undefined, to: to || undefined, limit: 25 });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: DataTableColumn<Justification>[] = [
    {
      id: "student",
      header: t("columns.student"),
      rowHeader: true,
      cell: (j) => (
        <button type="button" onClick={() => setOpenId(j.id)} className="text-left font-medium text-primary underline-offset-4 hover:underline">
          <StudentName id={j.studentId} />
        </button>
      ),
    },
    { id: "window", header: t("columns.window"), cell: (j) => (j.fromDate === j.toDate ? date.civil(j.fromDate) : t("windowRange", { from: date.civil(j.fromDate), to: date.civil(j.toDate) })) },
    { id: "reason", header: t("columns.reason"), cell: (j) => j.reasonCode, className: "hidden md:table-cell" },
    { id: "by", header: t("columns.by"), cell: (j) => t(`submitter.${j.submittedByKind}`), className: "hidden lg:table-cell" },
    { id: "files", header: t("columns.files"), align: "right", cell: (j) => j.attachments.length, className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (j) => <StatusBadge label={t(`status.${j.status}`)} tone={justificationTone(j.status)} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="attendance.justification.submit">
            <button type="button" className={buttonClass.primary} onClick={() => setDepositing(true)}>
              {t("deposit")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("statusFilter")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("all")} options={ATTENDANCE_JUSTIFICATION_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />}
        </FormField>
        <FormField label={t("studentFilter")}>
          {(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudentOptions} ariaLabel={t("studentFilter")} placeholder={t("anyStudent")} />}
        </FormField>
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={rows}
        getRowId={(j) => j.id}
        isLoading={list.isFetching && !list.isFetchingNextPage}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {list.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t("loadMore")}
          </button>
        </div>
      ) : null}
      {openId ? <JustificationDetail id={openId} onClose={() => setOpenId(null)} onDone={(m) => flash.show(m)} /> : null}
      {depositing ? <JustificationForm onClose={() => setDepositing(false)} onDone={() => flash.show(t("deposited"))} /> : null}
    </div>
  );
}

type Action = "accept" | "reject" | "revoke";

export function JustificationDetail({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Attendance.justifications.detail");
  const tStatus = useTranslations("v2Attendance.justifications.status");
  const tSubmitter = useTranslations("v2Attendance.justifications.submitter");
  const date = useDateFormat();
  const q = useJustification(id);
  const reasons = useJustificationReasons();
  const accept = useAcceptJustification();
  const reject = useRejectJustification();
  const revoke = useRevokeJustification();
  const [action, setAction] = useState<Action | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const j = q.data;
  const reasonLabel = (code: string) => (reasons.data ?? []).find((r) => r.code === code)?.label ?? code;

  async function openAttachment(attachmentId: string) {
    setFileError(null);
    try {
      const signed = await fetchAttachmentUrl(id, attachmentId);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setFileError(e instanceof ApiError ? e.message : t("fileError"));
    }
  }

  const done = (message: string) => () => {
    setAction(null);
    onDone(message);
  };

  return (
    <>
      <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} className="sm:max-w-2xl">
        {q.isPending ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
        ) : j ? (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
              <dt className="font-medium">{t("student")}</dt>
              <dd>
                <StudentName id={j.studentId} />
              </dd>
              <dt className="font-medium">{t("window")}</dt>
              <dd>{t("windowValue", { from: date.civil(j.fromDate), to: date.civil(j.toDate) })}</dd>
              <dt className="font-medium">{t("reason")}</dt>
              <dd>{reasonLabel(j.reasonCode)}</dd>
              {j.comment ? (
                <>
                  <dt className="font-medium">{t("comment")}</dt>
                  <dd className="whitespace-pre-wrap">{j.comment}</dd>
                </>
              ) : null}
              <dt className="font-medium">{t("submitted")}</dt>
              <dd>{t("submittedValue", { by: tSubmitter(j.submittedByKind), at: date.instant(j.submittedAt) })}</dd>
              <dt className="font-medium">{t("status")}</dt>
              <dd>
                <StatusBadge label={tStatus(j.status)} tone={justificationTone(j.status)} />
                {j.status === "ACCEPTED" ? <span className="ml-2 text-muted-foreground">{t("covered", { count: j.coveredRecordCount })}</span> : null}
              </dd>
              {j.decidedAt ? (
                <>
                  <dt className="font-medium">{t("decision")}</dt>
                  <dd>
                    {date.instant(j.decidedAt)}
                    {j.decisionNote ? ` — ${j.decisionNote}` : ""}
                  </dd>
                </>
              ) : null}
              {j.revokedAt ? (
                <>
                  <dt className="font-medium">{t("revocation")}</dt>
                  <dd>
                    {date.instant(j.revokedAt)}
                    {j.revocationReason ? ` — ${j.revocationReason}` : ""}
                  </dd>
                </>
              ) : null}
            </dl>
            <section aria-labelledby="files-title">
              <h3 id="files-title" className="mb-1 font-semibold">
                {t("files")}
              </h3>
              {j.attachments.length === 0 ? (
                <p className="text-muted-foreground">{t("noFiles")}</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {j.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate">
                        {a.fileName} <span className="text-muted-foreground">({Math.max(1, Math.round(a.sizeBytes / 1024))} Ko)</span>
                      </span>
                      <button type="button" className={buttonClass.ghost} onClick={() => void openAttachment(a.id)}>
                        {t("openFile")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {fileError ? <Notice kind="error" className="mt-2">{fileError}</Notice> : null}
              <p className="mt-1 text-xs text-muted-foreground">{t("filesHint")}</p>
            </section>
            <Can permission="attendance.justification.decide">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {j.status === "PENDING" ? (
                  <>
                    <button type="button" className={buttonClass.secondary} onClick={() => setAction("reject")}>
                      {t("reject")}
                    </button>
                    <button type="button" className={buttonClass.primary} onClick={() => setAction("accept")}>
                      {t("accept")}
                    </button>
                  </>
                ) : null}
                {j.status === "ACCEPTED" ? (
                  <button type="button" className={buttonClass.danger} onClick={() => setAction("revoke")}>
                    {t("revoke")}
                  </button>
                ) : null}
              </div>
            </Can>
          </div>
        ) : null}
      </ModalDialog>
      {action === "accept" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={t("acceptTitle")}
          description={t("acceptDescription")}
          reasonLabel={t("noteOptional")}
          confirmLabel={t("accept")}
          reasonRequired={false}
          isPending={accept.isPending}
          error={accept.error}
          onConfirm={(note) => accept.mutate({ id, ...(note ? { note } : {}) }, { onSuccess: done(t("accepted")) })}
        />
      ) : null}
      {action === "reject" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={t("rejectTitle")}
          description={t("rejectDescription")}
          reasonLabel={t("rejectReason")}
          confirmLabel={t("reject")}
          destructive
          minLength={3}
          isPending={reject.isPending}
          error={reject.error}
          onConfirm={(note) => reject.mutate({ id, note }, { onSuccess: done(t("rejected")) })}
        />
      ) : null}
      {action === "revoke" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={t("revokeTitle")}
          description={t("revokeDescription")}
          reasonLabel={t("revokeReason")}
          confirmLabel={t("revoke")}
          destructive
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={(reason) => revoke.mutate({ id, reason }, { onSuccess: done(t("revoked")) })}
        />
      ) : null}
    </>
  );
}
