"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportJobDto } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, Notice, useDescribeError } from "@/platform/ui";
import { useCancelImport } from "@/platform/v2/imports";
import { ProgressBar } from "./ProgressBar";

/** Étape 6 — Import : exécution par le worker, progression en direct, annulation possible. */
export function RunStep({ job, canCancel }: { job: ImportJobDto; canCancel: boolean }) {
  const t = useTranslations("v2Imports.run");
  const describe = useDescribeError();
  const cancel = useCancelImport(job.id);
  const [asked, setAsked] = useState(false);
  const total = Math.max(job.validRows, job.processedCount);
  return (
    <section aria-label={t("title")} className="space-y-4">
      <ProgressBar label={t("progress")} done={job.processedCount} total={total} />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("counts")}>
        {(
          [
            ["created", job.createdCount],
            ["updated", job.updatedCount],
            ["skipped", job.skippedCount],
            ["failed", job.failedCount],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-white/10 bg-card/60 p-4">
            <dt className="text-sm font-medium text-muted-foreground">{t(k)}</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{v}</dd>
          </div>
        ))}
      </dl>
      <Notice kind="info">{job.status === "QUEUED" ? t("queued") : job.cancelRequested ? t("cancelling") : t("running")}</Notice>
      {cancel.isError ? <Notice kind="error">{describe(cancel.error)}</Notice> : null}
      {canCancel && !job.cancelRequested ? (
        asked ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("cancelConfirmTitle")}>
            <p className="text-sm">{t("cancelConfirm")}</p>
            <button type="button" className={buttonClass.danger} disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {t("cancelYes")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setAsked(false)}>
              {t("cancelNo")}
            </button>
          </div>
        ) : (
          <button type="button" className={buttonClass.secondary} onClick={() => setAsked(true)}>
            {t("cancel")}
          </button>
        )
      ) : null}
    </section>
  );
}
