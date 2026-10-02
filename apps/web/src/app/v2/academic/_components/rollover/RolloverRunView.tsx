"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AcademicRolloverRunDto, AcademicRolloverRunReport } from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears } from "@/platform/v2/academic";
import { isLiveRun, useRetryRollover, useRolloverRun } from "@/platform/v2/rollover";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { AnomalyGroups, RolloverWarnings } from "./RolloverPlanView";
import { runTone, stepTone } from "./labels";

/** Barre de progression d'une étape : `done` / `total` tels que renvoyés par l'API (aucun calcul de règle, seulement un rapport d'affichage). */
function StepProgress({ step }: { step: AcademicRolloverRunDto["progress"]["steps"][number] }) {
  const t = useTranslations("v2Rollover.run");
  const tStep = useTranslations("v2Rollover.step");
  const tStatus = useTranslations("v2Rollover.stepStatus");
  const { number } = useDateFormat();
  const percent = step.total > 0 ? Math.min(100, Math.round((step.done / step.total) * 100)) : step.status === "DONE" ? 100 : 0;
  return (
    <li className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{tStep(step.key)}</span>
        <StatusBadge label={tStatus(step.status)} tone={stepTone(step.status)} />
      </div>
      <div
        role="progressbar"
        aria-label={t("progressLabel", { step: tStep(step.key) })}
        aria-valuemin={0}
        aria-valuemax={step.total}
        aria-valuenow={step.done}
        aria-valuetext={t("progressText", { done: step.done, total: step.total })}
        className="h-2 overflow-hidden rounded bg-muted"
      >
        <div className={`h-full transition-all ${step.status === "FAILED" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("progressText", { done: number(step.done), total: number(step.total) })}
        {step.message ? ` — ${step.message}` : ""}
      </p>
    </li>
  );
}

/** Rapport d'une exécution terminée : créés / déjà présents / ignorés, avertissements, anomalies avec lien. */
export function RolloverReport({ report }: { report: AcademicRolloverRunReport }) {
  const t = useTranslations("v2Rollover.report");
  const tStep = useTranslations("v2Rollover.step");
  const { number } = useDateFormat();
  const created: Array<[string, number]> = [
    [tStep("PERIODS"), report.periodsCreated],
    [tStep("HOLIDAYS"), report.holidaysCreated],
    [tStep("CURRICULUM"), report.curriculumVersionsCreated],
    [tStep("CLASSROOMS"), report.classroomsCreated],
    [tStep("OFFERINGS"), report.offeringsCreated],
    [tStep("ENROLLMENTS"), report.enrollmentsCreated],
  ];
  return (
    <section aria-labelledby="rollover-report" className="space-y-4">
      <h2 id="rollover-report" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {created.map(([label, value]) => (
          <div key={label} className="rounded-md border p-3">
            <dt className="text-xs text-muted-foreground">{t("created", { step: label })}</dt>
            <dd className="text-xl font-semibold">{number(value)}</dd>
          </div>
        ))}
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">{t("alreadyRolledOver")}</dt>
          <dd className="text-xl font-semibold">{number(report.alreadyRolledOver)}</dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">{t("skipped")}</dt>
          <dd className="text-xl font-semibold">{number(report.skipped)}</dd>
        </div>
      </dl>
      <RolloverWarnings warnings={report.warnings} titleKey="report" />
      {report.anomalies.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-base font-semibold">{t("anomalies", { count: report.anomalies.length })}</h3>
          <AnomalyGroups anomalies={report.anomalies} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noAnomaly")}</p>
      )}
    </section>
  );
}

/** Suivi d'une exécution : état, progression par étape (relue toutes les 2 s), reprise après échec, rapport final. */
export function RolloverRunView({ runId }: { runId: string }) {
  const t = useTranslations("v2Rollover.run");
  const tStatus = useTranslations("v2Rollover.runStatus");
  const date = useDateFormat();
  const run = useRolloverRun(runId);
  const years = useAcademicYears();
  const retry = useRetryRollover();
  const yearLabel = (id: string) => (years.data ?? []).find((y) => y.id === id)?.label ?? id.slice(0, 8);

  const data = run.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={data ? t("subtitle", { from: yearLabel(data.fromAcademicYearId), to: yearLabel(data.toAcademicYearId) }) : undefined}
        actions={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => void run.refetch()} disabled={run.isFetching}>
              {t("refresh")}
            </button>
            <Link href={data ? `/v2/academic/rollover/runs?from=${data.fromAcademicYearId}` : "/v2/academic/rollover/runs"} className={buttonClass.secondary}>
              {t("history")}
            </Link>
          </>
        }
      />
      {run.isPending && run.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {run.isError ? <ErrorBlock error={run.error} onRetry={() => void run.refetch()} /> : null}
      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <StatusBadge label={tStatus(data.status)} tone={runTone(data.status)} />
            <span className="text-sm text-muted-foreground">
              {t("requestedAt", { date: date.instant(data.requestedAt) })}
              {data.finishedAt ? ` — ${t("finishedAt", { date: date.instant(data.finishedAt) })}` : ""}
              {data.attempts > 1 ? ` — ${t("attempts", { count: data.attempts })}` : ""}
            </span>
          </div>

          {data.status === "PENDING" ? <Notice kind="info">{t("pendingHint")}</Notice> : null}
          {isLiveRun(data) ? <p className="text-sm text-muted-foreground">{t("autoRefresh")}</p> : null}

          {data.status === "FAILED" ? (
            <Notice kind="error">
              <p className="font-medium">{t("failedTitle")}</p>
              <p>{data.errorMessage ?? t("failedUnknown")}</p>
              <p className="mt-1 text-xs">{t("failedHint")}</p>
              {retry.error ? <ErrorBlock error={retry.error} className="mt-2" /> : null}
              <button type="button" className={`${buttonClass.primary} mt-3`} disabled={retry.isPending} onClick={() => retry.mutate({ runId: data.id })}>
                {t("retry")}
              </button>
            </Notice>
          ) : null}

          <section aria-labelledby="rollover-steps" className="space-y-2">
            <h2 id="rollover-steps" className="text-lg font-semibold">
              {t("stepsTitle")}
            </h2>
            {data.progress.steps.length === 0 ? <p className="text-sm text-muted-foreground">{t("noProgress")}</p> : null}
            <ul className="space-y-2" aria-label={t("stepsTitle")}>
              {data.progress.steps.map((s) => (
                <StepProgress key={s.key} step={s} />
              ))}
            </ul>
          </section>

          {data.status === "COMPLETED" && data.report ? <RolloverReport report={data.report} /> : null}
          {data.status === "COMPLETED" && !data.report ? <Notice kind="info">{t("noReport")}</Notice> : null}
        </>
      ) : null}
    </div>
  );
}
