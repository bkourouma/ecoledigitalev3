"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useBatch, useCreateBatch, usePreflight, usePublishMany, useRetryBatch, combinedDownloadPath } from "@/platform/v2/reportcards";
import { CheckControl, FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { toneOfStatus } from "../../assessments/_components/shared";
import { ClassPeriodSelector, useClassPeriodSelection } from "../../results/_components/shared";
import { DownloadButton } from "./shared";

/** Génération par lot : contrôle préalable (manques listés avec lien de correction), lot idempotent, progression, reprise. */
export function IssueScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Reportcards.issue");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const [provisional, setProvisional] = useState(false);
  const [reissue, setReissue] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const create = useCreateBatch();
  const hasSelection = Boolean(sel.classroomId && sel.periodId);
  const pre = usePreflight(hasSelection ? { classroomId: sel.classroomId, academicPeriodId: sel.periodId, kind: "REPORT_CARD", provisional } : null);

  const vars = { classroomId: sel.classroomId, academicPeriodId: sel.periodId, kind: "REPORT_CARD" as const, provisional, ...(reissue ? { reissueReason: reason.trim() } : {}) };

  async function generate() {
    if (reissue && reason.trim().length < 5) return setReasonError(t("reasonTooShort"));
    setReasonError(null);
    try {
      const batch = await create.mutateAsync(vars);
      setBatchId(batch.id);
    } catch {
      /* affichée sous le bouton */
    }
  }

  const blocking = pre.data ? pre.data.issues.some((i) => i.blocking) || !pre.data.ok : false;

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClassPeriodSelector
        classroomId={sel.classroomId}
        periodId={sel.periodId}
        onClassroom={(id) => {
          sel.setClassroom(id);
          setBatchId(null);
        }}
        onPeriod={(id) => {
          sel.setPeriod(id);
          setBatchId(null);
        }}
      />
      {!hasSelection ? (
        <Notice kind="info">{t("choose")}</Notice>
      ) : (
        <div className="space-y-6">
          <CheckControl checked={provisional} onChange={setProvisional} label={t("provisional")} hint={t("provisionalHint")} />

          <section aria-label={t("preflightTitle")} className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">{t("preflightTitle")}</h2>
            {pre.isPending && pre.fetchStatus !== "idle" ? <LoadingBlock /> : null}
            {pre.isError ? <ErrorBlock error={pre.error} onRetry={() => void pre.refetch()} /> : null}
            {pre.data ? (
              <>
                <Notice kind={blocking ? "error" : "success"}>{t(blocking ? "preflightBlocked" : "preflightOk")}</Notice>
                <p className="text-sm" data-testid="preflight-counts">
                  {t("enrollments", { total: pre.data.enrollments.total, eligible: pre.data.enrollments.eligible, excluded: pre.data.enrollments.excluded })}
                </p>
                {pre.data.issues.length > 0 ? (
                  <ul className="space-y-2" aria-label={t("issues")}>
                    {pre.data.issues.map((i, n) => (
                      <li key={`${i.code}-${n}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm">
                        <span>
                          <StatusBadge label={t(i.blocking ? "blocking" : "warning")} tone={i.blocking ? "danger" : "warning"} /> <span className="ml-1">{i.message}</span>
                        </span>
                        {i.fixHref ? (
                          <Link href={i.fixHref} className={buttonClass.secondary}>
                            {t("fix")}
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {pre.data.resultsVersion !== null ? <p className="text-xs text-muted-foreground">{t("resultsVersion", { version: pre.data.resultsVersion })}</p> : null}
              </>
            ) : null}
          </section>

          <section aria-label={t("generateTitle")} className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">{t("generateTitle")}</h2>
            <CheckControl checked={reissue} onChange={setReissue} label={t("reissue")} hint={t("reissueHint")} />
            {reissue ? (
              <FormField label={t("reissueReason")} required error={reasonError} hint={t("reasonHint")}>
                {(c) => <TextControl {...c} value={reason} onChange={setReason} maxLength={500} />}
              </FormField>
            ) : null}
            <p className="text-sm text-muted-foreground">{t("idempotent")}</p>
            <button type="button" className={buttonClass.primary} onClick={() => void generate()} disabled={create.isPending || blocking || !pre.data}>
              {create.isPending ? t("generating") : t("generate")}
            </button>
            {create.error ? <ErrorBlock error={create.error} /> : null}
          </section>

          {batchId ? <BatchProgress batchId={batchId} resume={() => create.mutateAsync(vars).then((b) => setBatchId(b.id))} classroomId={sel.classroomId} periodId={sel.periodId} /> : null}
        </div>
      )}
    </div>
  );
}

function BatchProgress({ batchId, resume, classroomId, periodId }: { batchId: string; resume: () => Promise<unknown>; classroomId: string; periodId: string }) {
  const t = useTranslations("v2Reportcards.issue");
  const tBatch = useTranslations("v2Reportcards.batchStatus");
  const tOutcome = useTranslations("v2Reportcards.batchOutcome");
  const batch = useBatch(batchId);
  const retry = useRetryBatch();
  const publish = usePublishMany();
  const canPublish = usePermission("reportcard.publish");
  const flash = useFlash();
  const [actionError, setActionError] = useState<unknown>(null);
  const [resuming, setResuming] = useState(false);
  const b = batch.data;
  if (batch.isPending && batch.fetchStatus !== "idle") return <LoadingBlock />;
  if (batch.isError) return <ErrorBlock error={batch.error} onRetry={() => void batch.refetch()} />;
  if (!b) return null;
  const running = b.status === "PENDING" || b.status === "SNAPSHOTTING" || b.status === "RENDERING";
  const percent = b.total > 0 ? Math.round(((b.issued + b.excluded + b.failed) / b.total) * 100) : 0;
  const renderPercent = b.issued > 0 ? Math.round((b.rendered / b.issued) * 100) : 0;
  const problems = (b.items ?? []).filter((i) => i.outcome !== "ISSUED");
  const renderFailed = b.issued > b.rendered && !running;

  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setActionError(null);
    try {
      flash.show(done(await fn()));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <section aria-label={t("progressTitle")} className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("progressTitle")}</h2>
        <StatusBadge label={tBatch(b.status)} tone={b.status === "COMPLETED" ? "success" : b.status === "FAILED" || b.status === "CANCELLED" ? "danger" : toneOfStatus(b.status === "COMPLETED_WITH_ERRORS" ? "COMPLETED_WITH_ERRORS" : "PENDING")} />
      </div>
      {flash.node}
      <div>
        <div role="progressbar" aria-label={t("issuedProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-sm" role="status" data-testid="batch-counts">
          {t("counts", { issued: b.issued, total: b.total, excluded: b.excluded, failed: b.failed })}
        </p>
        <div role="progressbar" aria-label={t("renderProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={renderPercent} className="mt-3 h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${renderPercent}%` }} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="render-counts">
          {t("rendered", { rendered: b.rendered, issued: b.issued })}
        </p>
      </div>
      {problems.length > 0 ? (
        <section aria-label={t("problems")} className="space-y-2">
          <h3 className="text-sm font-semibold">{t("problems")}</h3>
          <ul className="space-y-1 text-sm">
            {problems.map((i) => (
              <li key={i.enrollmentId} className="rounded-md border px-3 py-2">
                <StatusBadge label={tOutcome(i.outcome)} tone={i.outcome === "FAILED" ? "danger" : "warning"} /> <span className="font-mono text-xs">{i.enrollmentId.slice(0, 8)}</span> {i.message ?? i.reasonCode}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!running && (b.excluded > 0 || b.failed > 0) ? (
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={resuming}
            onClick={() => {
              setResuming(true);
              void run(resume, () => t("resumed")).finally(() => setResuming(false));
            }}
          >
            {t("resume")}
          </button>
        ) : null}
        {renderFailed ? (
          <button type="button" className={buttonClass.secondary} disabled={retry.isPending} onClick={() => void run(() => retry.mutateAsync({ id: b.id }), () => t("retried"))}>
            {t("retryRenders")}
          </button>
        ) : null}
        {canPublish.allowed && !running && b.issued > 0 ? (
          <button
            type="button"
            className={buttonClass.primary}
            disabled={publish.isPending}
            onClick={() => void run(() => publish.mutateAsync({ batchId: b.id }), (r) => t("published", { published: r.published, already: r.alreadyPublished, skipped: r.skipped.length }))}
          >
            {t("publishBatch")}
          </button>
        ) : null}
        {b.combinedPdfReady ? <DownloadButton path={combinedDownloadPath(classroomId, periodId)} label={t("combinedPdf")} /> : null}
        <Link href={`/v2/reportcards?classroom=${classroomId}&period=${periodId}`} className={buttonClass.ghost}>
          {t("seeList")}
        </Link>
      </div>
      {actionError ? <ErrorBlock error={actionError} /> : null}
    </section>
  );
}
