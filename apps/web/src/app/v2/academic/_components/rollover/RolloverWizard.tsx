"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ACADEMIC_ROLLOVER_STEPS, type AcademicRolloverRunBody, type AcademicRolloverStep, type AcademicYearDto } from "@ecoledigitale/contracts/v2/academic";
import { useFeature } from "@/platform/access";
import { useAcademicYears } from "@/platform/v2/academic";
import { useRolloverPlan, useStartRollover } from "@/platform/v2/rollover";
import { CheckControl, FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useIdempotentRunner } from "@/platform/ui/idempotency";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { Wizard, type WizardStep } from "@/platform/ui/Wizard";
import { RolloverPlanView } from "./RolloverPlanView";

/** Années proposées comme cible : brouillon ou ouvertes, postérieures à la source (filtre d'affichage ; l'API revalide). */
export function targetYearsOf(years: ReadonlyArray<AcademicYearDto>, from: AcademicYearDto | undefined): AcademicYearDto[] {
  if (!from) return [];
  return years.filter((y) => y.id !== from.id && (y.status === "DRAFT" || y.status === "OPEN") && y.startsOn > from.startsOn);
}

export function RolloverWizard() {
  const t = useTranslations("v2Rollover.wizard");
  const tStep = useTranslations("v2Rollover.step");
  const tStepHint = useTranslations("v2Rollover.stepHint");
  const tStatus = useTranslations("v2Academic.status.year");
  const router = useRouter();
  const date = useDateFormat();
  const years = useAcademicYears();
  const alaCarte = useFeature("academic.a-la-carte");
  const start = useStartRollover();
  const runner = useIdempotentRunner<string>((fingerprint) => fingerprint, "rollover");

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [unchecked, setUnchecked] = useState<ReadonlySet<AcademicRolloverStep>>(new Set());
  const [createMissing, setCreateMissing] = useState(true);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [errors, setErrors] = useState<{ from?: string; to?: string; steps?: string; reviewed?: string }>({});

  const all = useMemo(() => years.data ?? [], [years.data]);
  const from = all.find((y) => y.id === fromId);
  const to = all.find((y) => y.id === toId);
  const targets = targetYearsOf(all, from);
  const selected = ACADEMIC_ROLLOVER_STEPS.filter((s) => !unchecked.has(s) && (s !== "OFFERINGS" || alaCarte.allowed));
  const withEnrollments = selected.includes("ENROLLMENTS");

  const planQuery = fromId && toId && selected.length > 0 ? { toAcademicYearId: toId, steps: selected, ...(withEnrollments ? { createMissingClassrooms: createMissing } : {}) } : null;
  const plan = useRolloverPlan(fromId || null, previewRequested ? planQuery : null);

  /** Tout changement de saisie invalide l'aperçu et la case « j'ai vérifié ». */
  function edit(change: () => void) {
    change();
    setPreviewRequested(false);
    setReviewed(false);
  }

  const body: AcademicRolloverRunBody | null = toId
    ? { toAcademicYearId: toId, steps: selected, ...(withEnrollments ? { createMissingClassrooms: createMissing } : {}) }
    : null;

  async function launch() {
    if (!body || !fromId) return;
    try {
      const run = await runner.run(JSON.stringify({ fromId, body }), (key) => start.mutateAsync({ fromYearId: fromId, body, idempotencyKey: key }));
      if (run) router.push(`/v2/academic/rollover/runs/${run.id}`);
    } catch {
      /* l'erreur est affichée au-dessus des boutons ; la même clé sera rejouée */
    }
  }

  const yearLabel = (y: AcademicYearDto) => `${y.label} (${tStatus(y.status)}, ${date.civil(y.startsOn)} → ${date.civil(y.endsOn)})`;

  const steps: WizardStep[] = [
    {
      id: "years",
      title: t("years.title"),
      description: t("years.description"),
      validate: () => {
        const next: typeof errors = {};
        if (!fromId) next.from = t("years.fromRequired");
        if (!toId) next.to = t("years.toRequired");
        setErrors(next);
        return Object.keys(next).length === 0;
      },
      content: (
        <div className="space-y-4">
          {years.isError ? <ErrorBlock error={years.error} onRetry={() => void years.refetch()} /> : null}
          {years.isPending && years.fetchStatus !== "idle" ? <LoadingBlock /> : null}
          <FormField label={t("years.from")} required error={errors.from}>
            {(c) => (
              <NativeSelect
                {...c}
                value={fromId}
                placeholder={t("choose")}
                onChange={(v) =>
                  edit(() => {
                    setFromId(v);
                    setToId("");
                  })
                }
                options={all.map((y) => ({ value: y.id, label: yearLabel(y) }))}
              />
            )}
          </FormField>
          <FormField label={t("years.to")} hint={t("years.toHint")} required error={errors.to}>
            {(c) => <NativeSelect {...c} value={toId} placeholder={t("choose")} disabled={!fromId} onChange={(v) => edit(() => setToId(v))} options={targets.map((y) => ({ value: y.id, label: yearLabel(y) }))} />}
          </FormField>
          {fromId && targets.length === 0 ? <Notice kind="info">{t("years.noTarget")}</Notice> : null}
        </div>
      ),
    },
    {
      id: "steps",
      title: t("steps.title"),
      description: t("steps.description"),
      validate: () => {
        if (selected.length === 0) {
          setErrors({ steps: t("steps.required") });
          return false;
        }
        setErrors({});
        setPreviewRequested(true);
        return true;
      },
      content: (
        <fieldset className="space-y-1">
          <legend className="sr-only">{t("steps.title")}</legend>
          {ACADEMIC_ROLLOVER_STEPS.filter((s) => s !== "OFFERINGS" || alaCarte.allowed).map((s) => (
            <CheckControl
              key={s}
              label={tStep(s)}
              hint={tStepHint(s)}
              checked={!unchecked.has(s)}
              onChange={(v) =>
                edit(() =>
                  setUnchecked((prev) => {
                    const next = new Set(prev);
                    if (v) next.delete(s);
                    else next.add(s);
                    return next;
                  }),
                )
              }
            />
          ))}
          {withEnrollments ? <CheckControl label={t("steps.createMissing")} hint={t("steps.createMissingHint")} checked={createMissing} onChange={(v) => edit(() => setCreateMissing(v))} /> : null}
          {errors.steps ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.steps}
            </p>
          ) : null}
        </fieldset>
      ),
    },
    {
      id: "preview",
      title: t("preview.title"),
      description: t("preview.description"),
      validate: () => plan.isSuccess,
      content: (
        <div className="space-y-4">
          {plan.isFetching && !plan.data ? <LoadingBlock label={t("preview.loading")} /> : null}
          {plan.isError ? <ErrorBlock error={plan.error} onRetry={() => void plan.refetch()} /> : null}
          {plan.data?.liveRunId ? (
            <Notice kind="warning">
              <p className="font-medium">{t("preview.liveRun")}</p>
              <Link href={`/v2/academic/rollover/runs/${plan.data.liveRunId}`} className="text-sm font-medium underline underline-offset-4">
                {t("preview.resume")}
              </Link>
            </Notice>
          ) : null}
          {plan.data ? <RolloverPlanView plan={plan.data} /> : null}
          {plan.data ? (
            <button type="button" className={buttonClass.secondary} onClick={() => void plan.refetch()} disabled={plan.isFetching}>
              {t("preview.refresh")}
            </button>
          ) : null}
        </div>
      ),
    },
    {
      id: "confirm",
      title: t("confirm.title"),
      description: t("confirm.description"),
      validate: () => {
        if (!reviewed) {
          setErrors({ reviewed: t("confirm.reviewedRequired") });
          return false;
        }
        setErrors({});
        return true;
      },
      content: (
        <div className="space-y-4">
          <dl className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("confirm.from")}</dt>
              <dd className="font-medium">{from?.label ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("confirm.to")}</dt>
              <dd className="font-medium">{to?.label ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t("confirm.steps")}</dt>
              <dd>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {selected.map((s) => (
                    <li key={s} className="rounded-full border px-2 py-0.5 text-xs font-medium">
                      {tStep(s)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          {plan.data && plan.data.warnings.length > 0 ? <Notice kind="warning">{t("confirm.warnings", { count: plan.data.warnings.length })}</Notice> : null}
          {plan.data?.liveRunId ? <Notice kind="info">{t("confirm.liveRun")}</Notice> : null}
          <CheckControl label={t("confirm.reviewed")} hint={t("confirm.reviewedHint")} checked={reviewed} onChange={(v) => setReviewed(v)} />
          {errors.reviewed ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.reviewed}
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/v2/academic/rollover/runs" className={buttonClass.secondary}>
            {t("history")}
          </Link>
        }
      />
      <Wizard
        label={t("title")}
        steps={steps}
        finishLabel={t("confirm.launch")}
        isSubmitting={start.isPending}
        onFinish={launch}
        footerNotice={start.error ? <ErrorBlock error={start.error} /> : null}
      />
    </div>
  );
}
