"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { RulesSimulationDto, RulesVersionDetailDto } from "@ecoledigitale/contracts/v2/rules";
import { RulesRequestSimulationBodySchema } from "@ecoledigitale/contracts/v2/rules";
import { useFeature, usePermission } from "@/platform/access";
import { useRequestSimulation, useSimulation } from "@/platform/v2/rules";
import { FeatureNotice } from "@/platform/ui/AccessGate";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, QueryBoundary } from "@/platform/ui/states";
import { ClassroomPicker, PeriodPicker, toneOfStatus } from "../../assessments/_components/shared";

type Target = { classroomId: string; periodId: string };

/** Simulation de l'impact d'une version sur les données réelles de l'établissement (tâche de fond, rapport de différences). */
export function SimulationPanel({ version }: { version: RulesVersionDetailDto }) {
  const t = useTranslations("v2Rules.simulation");
  const feature = useFeature("rules.simulation");
  const canSimulate = usePermission("rules.version.simulate");
  const request = useRequestSimulation();
  const [classroomId, setClassroomId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const activeId = simulationId ?? version.lastSimulationId;
  const simulation = useSimulation(canSimulate.allowed && feature.allowed ? activeId : null);

  if (!feature.allowed && !feature.isLoading) return <FeatureNotice />;
  if (!canSimulate.allowed && !canSimulate.isLoading) return <Notice kind="info">{t("noRight")}</Notice>;

  function addTarget() {
    if (!classroomId || !periodId) return setError(t("chooseBoth"));
    setError(null);
    if (!targets.some((x) => x.classroomId === classroomId && x.periodId === periodId)) setTargets((l) => [...l, { classroomId, periodId }]);
    setClassroomId("");
    setPeriodId("");
  }

  async function launch() {
    const body = {
      dataset: {
        periodIds: [...new Set(targets.map((x) => x.periodId))],
        classroomIds: [...new Set(targets.map((x) => x.classroomId))],
      },
    };
    const v = RulesRequestSimulationBodySchema.safeParse(body);
    if (!v.success) return setError(t("needTarget"));
    setError(null);
    try {
      const accepted = await request.mutateAsync({ versionId: version.id, body: v.data });
      setSimulationId(accepted.simulationId);
    } catch {
      /* affichée ci-dessous */
    }
  }

  return (
    <div className="space-y-4">
      <section aria-label={t("datasetTitle")} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h3 className="text-base font-semibold">{t("datasetTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("datasetHint")}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <FormField label={t("classroom")}>{(c) => <ClassroomPicker {...c} value={classroomId} onChange={(v) => { setClassroomId(v); setPeriodId(""); }} />}</FormField>
          <FormField label={t("period")}>{(c) => <PeriodPicker {...c} classroomId={classroomId} value={periodId} onChange={setPeriodId} />}</FormField>
          <div className="flex items-end">
            <button type="button" className={buttonClass.secondary} onClick={addTarget}>
              {t("add")}
            </button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
        {targets.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t("targets")}>
            {targets.map((x) => (
              <li key={`${x.classroomId}-${x.periodId}`} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                <span className="font-mono">
                  {x.classroomId.slice(0, 6)} · {x.periodId.slice(0, 6)}
                </span>
                <button type="button" className="font-medium underline" onClick={() => setTargets((l) => l.filter((y) => y !== x))} aria-label={t("removeTarget", { classroom: x.classroomId.slice(0, 6), period: x.periodId.slice(0, 6) })}>
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className={buttonClass.primary} onClick={() => void launch()} disabled={request.isPending || targets.length === 0}>
          {t("launch")}
        </button>
        {request.error ? <ErrorBlock error={request.error} /> : null}
      </section>

      {activeId ? (
        <QueryBoundary query={simulation}>{simulation.data ? <SimulationReport simulation={simulation.data} /> : null}</QueryBoundary>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}
    </div>
  );
}

function SimulationReport({ simulation: s }: { simulation: RulesSimulationDto }) {
  const t = useTranslations("v2Rules.simulation");
  const tStatus = useTranslations("v2Rules.simulationStatus");
  const tKind = useTranslations("v2Rules.differenceKind");
  const running = s.status === "PENDING" || s.status === "RUNNING";
  const show = (o: RulesSimulationDto["differences"][number]["old"]): string => (o.status === "ok" ? (o.value === null ? "—" : String(o.value)) : o.status === "error" ? t("outcomeError", { code: o.code }) : t("outcomeAbsent"));
  return (
    <section aria-label={t("reportTitle")} className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t("reportTitle")}</h3>
        <StatusBadge label={tStatus(s.status)} tone={s.status === "COMPLETED" ? "success" : s.status === "FAILED" || s.status === "CANCELLED" ? "danger" : toneOfStatus("PENDING")} />
      </div>
      {running ? (
        <div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.progressPercent} aria-label={t("progress")} className="h-2 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${s.progressPercent}%` }} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {t("running", { percent: s.progressPercent })}
          </p>
        </div>
      ) : null}
      {s.error ? <Notice kind="error">{s.error}</Notice> : null}
      {s.summary ? (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("summary.cases")} value={s.summary.cases} />
            <Stat label={t("summary.evaluations")} value={s.summary.evaluations} />
            <Stat label={t("summary.changed")} value={`${s.summary.changed} (${s.summary.changedPercent} %)`} />
            <Stat label={t("summary.unchanged")} value={s.summary.unchanged} />
            <Stat label={t("summary.newErrors")} value={s.summary.newErrors} danger={s.summary.newErrors > 0} />
            <Stat label={t("summary.resolvedErrors")} value={s.summary.resolvedErrors} />
            <Stat label={t("summary.changedErrors")} value={s.summary.changedErrors} />
            {s.decisionChangedPercent !== null ? <Stat label={t("summary.decisionChanged")} value={`${s.decisionChangedPercent} %`} danger={Number(s.decisionChangedPercent) > 0} /> : null}
          </dl>
          {s.rules.length > 0 ? (
            <div role="region" aria-label={t("rulesTable")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">{t("rulesTable")}</caption>
                <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t("columns.rule")}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t("columns.evaluated")}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t("columns.changed")}</th>
                    <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">{t("columns.newErrors")}</th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("columns.maxDelta")}</th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("columns.meanDelta")}</th>
                    <th scope="col" className="px-3 py-2">{t("columns.transitions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rules.map((r) => (
                    <tr key={r.key} className="border-t align-top">
                      <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-normal">
                        {r.key}
                        {r.presence !== "both" ? <span className="ml-1 font-sans text-muted-foreground">({t(`presence.${r.presence}`)})</span> : null}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{r.evaluated}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.changed}</td>
                      <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{r.newErrors}</td>
                      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{r.maxAbsDelta ?? "—"}</td>
                      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{r.meanDelta ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.transitions.length === 0 ? "—" : r.transitions.map((x) => `${x.from} → ${x.to} (${x.count})`).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <section aria-labelledby="diff-h" className="space-y-2">
            <h4 id="diff-h" className="text-sm font-semibold">
              {t("differences", { count: s.differences.length })}
            </h4>
            {s.differencesTruncated ? <Notice kind="info">{t("truncated")}</Notice> : null}
            {s.differences.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDifference")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {s.differences.map((d, i) => (
                  <li key={`${d.caseRef}-${d.ruleKey}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span className="font-mono text-xs">{d.caseRef}</span> · <span className="font-mono text-xs">{d.ruleKey}</span> · {tKind(d.kind)} : {show(d.old)} → {show(d.new)}
                    {d.delta ? <span className="text-muted-foreground"> (Δ {d.delta})</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${danger ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

