"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ASSESS_REVISION_STATUSES, type AssessRevisionDto } from "@ecoledigitale/contracts/v2/assess";
import { usePermission } from "@/platform/access";
import { useApplyRevision, useApproveRevision, useAssessment, useRejectRevision, useRevisions } from "@/platform/v2/assess";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { toneOfStatus, useStudentNames } from "./shared";

export function RevisionsScreen({ initialStatus = "REQUESTED" }: { initialStatus?: string }) {
  const t = useTranslations("v2Assess.revisions");
  const tStatus = useTranslations("v2Assess.revisionStatus");
  const [status, setStatus] = useState(initialStatus);
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <form className="mb-4 max-w-xs" onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("allStatuses")} options={ASSESS_REVISION_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
      </form>
      <RevisionList status={status || undefined} />
    </div>
  );
}

/** Liste des demandes de révision de notes publiées (filtrable par statut ou par évaluation). */
export function RevisionList({ status, assessmentId, compact = false }: { status?: string; assessmentId?: string; compact?: boolean }) {
  const t = useTranslations("v2Assess.revisions");
  const query = useRevisions({ status, assessmentId });
  const flash = useFlash();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (query.isPending && query.fetchStatus !== "idle") return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-3">
      {flash.node}
      {items.length === 0 ? (
        <EmptyBlock title={t("empty")} description={compact ? undefined : t("emptyHint")} />
      ) : (
        <ul className="space-y-3" aria-label={t("listLabel")}>
          {items.map((r) => (
            <li key={r.id}>
              <RevisionCard revision={r} showAssessment={!assessmentId} onMessage={flash.show} />
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function valueText(status: string | null, score: string | null, tEntry: (k: string) => string): string {
  if (status === "ENTERED") return (score ?? "").replace(".", ",");
  return status ? tEntry(status) : "—";
}

function RevisionCard({ revision: r, showAssessment, onMessage }: { revision: AssessRevisionDto; showAssessment: boolean; onMessage: (m: string) => void }) {
  const t = useTranslations("v2Assess.revisions");
  const tKind = useTranslations("v2Assess.revisionKind");
  const tStatus = useTranslations("v2Assess.revisionStatus");
  const tEntry = useTranslations("v2Assess.entryStatus");
  const date = useDateFormat();
  const canApprove = usePermission("grade.revise.approve");
  const approve = useApproveRevision();
  const reject = useRejectRevision();
  const apply = useApplyRevision();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const assessment = useAssessment(r.assessmentId);
  const { byEnrollment } = useStudentNames(assessment.data?.classroomId ?? null);
  const who = byEnrollment.get(r.enrollmentId)?.name ?? t("studentFallback", { id: r.enrollmentId.slice(0, 4) });
  const entry = (k: string) => tEntry(k as never);

  return (
    <article className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm" aria-label={t("cardLabel", { name: who })}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {who}
          {showAssessment && assessment.data ? (
            <>
              {" — "}
              <Link href={`/v2/assessments/${assessment.data.id}`} className="text-primary underline-offset-4 hover:underline">
                {assessment.data.title}
              </Link>
            </>
          ) : null}
        </h3>
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={tKind(r.kind)} tone="neutral" />
          <StatusBadge label={tStatus(r.status)} tone={toneOfStatus(r.status)} />
          {r.fourEyesWaived ? <StatusBadge label={t("waived")} tone="info" /> : null}
        </span>
      </header>
      <p className="text-base font-medium tabular-nums">
        {valueText(r.oldEntryStatus, r.oldScore, entry)} → {valueText(r.newEntryStatus, r.newScore, entry)}
      </p>
      <p>{r.reason}</p>
      <p className="text-muted-foreground">{t("requestedBy", { name: r.requestedByName, date: date.instant(r.requestedAt) })}</p>
      {r.decidedByName ? (
        <p className="text-muted-foreground">
          {t("decidedBy", { name: r.decidedByName, date: date.instant(r.decidedAt) })}
          {r.decisionComment ? ` — ${r.decisionComment}` : ""}
        </p>
      ) : null}
      {r.appliedAt ? <p className="text-muted-foreground">{t("appliedAt", { date: date.instant(r.appliedAt) })}</p> : null}
      {r.status === "APPROVED" && !r.appliedAt ? <Notice kind="info">{t("approvedPending")}</Notice> : null}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {canApprove.allowed && (r.status === "REQUESTED" || (r.status === "APPROVED" && !r.appliedAt)) ? (
        <div className="flex flex-wrap gap-2">
          {r.status === "REQUESTED" ? (
            <>
              <button type="button" className={buttonClass.primary} onClick={() => setDialog("approve")} aria-label={t("approveOf", { name: who })}>
                {t("approve")}
              </button>
              <button type="button" className={buttonClass.secondary} onClick={() => setDialog("reject")} aria-label={t("rejectOf", { name: who })}>
                {t("reject")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={async () => {
                setActionError(null);
                try {
                  await apply.mutateAsync({ id: r.id });
                  onMessage(t("applied"));
                } catch (e) {
                  setActionError(e);
                }
              }}
              disabled={apply.isPending}
            >
              {t("apply")}
            </button>
          )}
        </div>
      ) : null}
      {dialog === "approve" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("approveTitle", { name: who })}
          description={t("approveDescription")}
          reasonLabel={t("commentOptional")}
          reasonRequired={false}
          maxLength={1000}
          confirmLabel={t("approve")}
          isPending={approve.isPending}
          error={approve.error}
          onConfirm={async (comment) => {
            try {
              const out = await approve.mutateAsync({ id: r.id, comment: comment || undefined });
              onMessage(t(out.applied ? "approvedApplied" : "approvedWaiting"));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
      {dialog === "reject" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("rejectTitle", { name: who })}
          reasonLabel={t("rejectReason")}
          maxLength={1000}
          confirmLabel={t("reject")}
          destructive
          isPending={reject.isPending}
          error={reject.error}
          onConfirm={async (comment) => {
            try {
              await reject.mutateAsync({ id: r.id, comment });
              onMessage(t("rejected"));
              setDialog(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </article>
  );
}
