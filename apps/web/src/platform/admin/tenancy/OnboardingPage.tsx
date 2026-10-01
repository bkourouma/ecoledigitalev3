"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle, MinusCircle, Rocket } from "lucide-react";
import { Button, ConfirmDialog, LoadingState, Notice, PageHeader, ProgressBar, StatusBadge, type StatusTone } from "@ecoledigitale/ui";
import type { OnboardingState, OnboardingStep, OnboardingStepKey, OnboardingStepStatus } from "@ecoledigitale/contracts/v2/tenancy";
import { usePermission } from "@/platform/access";
import { ApiErrorState, useDateOnly } from "../common";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useOnboarding, useOnboardingStep } from "./hooks";

const TONE: Record<OnboardingStepStatus, StatusTone> = { PENDING: "neutral", COMPLETED: "success", SKIPPED: "warning" };
const ICON = { PENDING: Circle, COMPLETED: CheckCircle2, SKIPPED: MinusCircle } as const;

/** `/v2/settings/onboarding` : parcours de mise en service (étapes, progression, GO LIVE). */
export function OnboardingPage() {
  const t = useTranslations("settings.onboarding");
  const tu = useTranslations("ui");
  const state = useOnboarding();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {state.isPending ? <LoadingState label={tu("loading")} rows={5} /> : null}
      {state.isError ? <ApiErrorState error={state.error} onRetry={() => void state.refetch()} /> : null}
      {state.data ? <OnboardingView state={state.data} /> : null}
    </div>
  );
}

function OnboardingView({ state }: { state: OnboardingState }) {
  const t = useTranslations("settings.onboarding");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const date = useDateOnly();
  const manage = usePermission("tenancy.institution.manage");
  const complete = useOnboardingStep("complete");
  const skip = useOnboardingStep("skip");
  const [confirmGoLive, setConfirmGoLive] = useState(false);
  const [pendingStep, setPendingStep] = useState<OnboardingStepKey | null>(null);

  const live = state.status === "LIVE";
  const stepLabel = (key: OnboardingStepKey) => t(`steps.${key}`);
  const error = complete.error ?? skip.error;

  const run = (action: "complete" | "skip", step: OnboardingStepKey) => {
    setPendingStep(step);
    const mutation = action === "complete" ? complete : skip;
    mutation.mutate(
      { step },
      {
        onSuccess: () => {
          notifySuccess(step === "GO_LIVE" ? t("goLiveDone") : t("stepDone"));
          setConfirmGoLive(false);
        },
        onSettled: () => setPendingStep(null),
      },
    );
  };

  const busy = complete.isPending || skip.isPending;

  return (
    <div className="space-y-6">
      <section aria-labelledby="onboarding-progress" className="space-y-3 rounded-lg border p-4">
        <h2 id="onboarding-progress" className="text-base font-semibold">
          {live ? t("live") : t("inProgress")}
        </h2>
        <ProgressBar value={state.progress.percent} label={t("progressLabel")} />
        <p className="text-sm text-muted-foreground">{t("progress", { done: state.progress.done, total: state.progress.total })}</p>
        {live ? (
          <Notice tone="success">{t("liveBody")}</Notice>
        ) : state.currentStep ? (
          <p className="text-sm">{t("next", { step: stepLabel(state.currentStep) })}</p>
        ) : null}
      </section>

      <ol aria-label={t("stepsCaption")} className="space-y-3">
        {[...state.steps]
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <StepRow
              key={step.key}
              step={step}
              label={stepLabel(step.key)}
              live={live}
              canManage={manage.allowed}
              busy={busy}
              working={busy && pendingStep === step.key}
              completedAt={step.completedAt ? date(step.completedAt) : null}
              onComplete={() => (step.key === "GO_LIVE" ? setConfirmGoLive(true) : run("complete", step.key))}
              onSkip={() => run("skip", step.key)}
            />
          ))}
      </ol>

      {error && !confirmGoLive ? <Notice tone="danger">{message(error)}</Notice> : null}

      <ConfirmDialog
        open={confirmGoLive}
        onOpenChange={(open) => {
          setConfirmGoLive(open);
          if (!open) complete.reset();
        }}
        title={t("goLiveTitle")}
        description={t("goLiveBody")}
        confirmLabel={t("goLive")}
        cancelLabel={tu("cancel")}
        closeLabel={tu("close")}
        pending={complete.isPending}
        onConfirm={() => run("complete", "GO_LIVE")}
      >
        {complete.error ? <Notice tone="danger">{message(complete.error)}</Notice> : null}
      </ConfirmDialog>
    </div>
  );
}

function StepRow({
  step,
  label,
  live,
  canManage,
  busy,
  working,
  completedAt,
  onComplete,
  onSkip,
}: {
  step: OnboardingStep;
  label: string;
  live: boolean;
  canManage: boolean;
  busy: boolean;
  working: boolean;
  completedAt: string | null;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("settings.onboarding");
  const tu = useTranslations("ui");
  const Icon = ICON[step.status];
  const isGoLive = step.key === "GO_LIVE";
  const actionable = canManage && !live && step.status === "PENDING" && step.available;

  return (
    <li className={`rounded-lg border p-4 ${isGoLive ? "border-primary" : ""}`} aria-current={!live && step.available && step.status === "PENDING" ? "step" : undefined}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">{label}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge tone={TONE[step.status]}>{t(`status.${step.status}`)}</StatusBadge>
              <span className="text-xs text-muted-foreground">{step.optional ? t("optional") : t("required")}</span>
              {completedAt ? <span className="text-xs text-muted-foreground">{t("completedAt", { date: completedAt })}</span> : null}
            </div>
            {step.status === "PENDING" && !step.available && !live ? <p className="mt-1 text-xs text-muted-foreground">{t("blocked")}</p> : null}
          </div>
        </div>
        {actionable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={isGoLive ? "default" : "outline"}
              className="min-h-11 sm:min-h-10"
              disabled={busy}
              aria-label={isGoLive ? undefined : t("completeStep", { step: label })}
              onClick={onComplete}
            >
              {isGoLive ? <Rocket className="mr-1 h-4 w-4" aria-hidden="true" /> : null}
              {working ? tu("loading") : isGoLive ? t("goLive") : t("complete")}
            </Button>
            {step.optional && !isGoLive ? (
              <Button type="button" variant="ghost" className="min-h-11 sm:min-h-10" disabled={busy} aria-label={t("skipStep", { step: label })} onClick={onSkip}>
                {t("skip")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
