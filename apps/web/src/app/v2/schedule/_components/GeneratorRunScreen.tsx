"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useApplyAutogenRun, useAutogenRun, useDiscardAutogenRun, useStartAutogenRun, useTimetables, type AutogenRunDetailDto } from "@/platform/v2/scheduling";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { autogenTone } from "./GeneratorRunsScreen";

type Result = NonNullable<AutogenRunDetailDto["result"]>;
type Placement = Result["placements"][number];
type ViewKind = "classroom" | "staff" | "room";

/** Proposition d'emploi du temps : état du calcul, aperçu par classe / enseignant / salle, points d'attention, application. */
export function GeneratorRunScreen({ id }: { id: string }) {
  const t = useTranslations("v2Schedule.generator.run");
  const tStatus = useTranslations("v2Schedule.generator.status");
  const router = useRouter();
  const flash = useFlash();
  const query = useAutogenRun(id);
  const discard = useDiscardAutogenRun();
  const restart = useStartAutogenRun();
  const [tab, setTab] = useState<"preview" | "issues">("preview");
  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  if (query.isLoading) return <LoadingBlock label={t("loading")} />;
  if (query.isError || !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  const { run, result } = query.data;
  const active = run.status === "QUEUED" || run.status === "RUNNING";
  const usable = run.status === "COMPLETED";

  function relaunch() {
    // Même demande, nouvelle graine : une autre proposition à comparer.
    const params = { ...(run.params as Record<string, unknown>) };
    delete params.seed;
    params.name = `${run.name} (bis)`;
    restart.mutate(params as never, { onSuccess: (r) => router.push(`/v2/schedule/generator/${r.run.id}`) });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={run.name}
        description={t("seedLine", { seed: run.seed })}
        actions={
          <>
            <StatusBadge label={tStatus(run.status)} tone={autogenTone(run.status)} />
            <Can permission="schedule.manage">
              {!active ? (
                <button type="button" className={buttonClass.secondary} onClick={relaunch} disabled={restart.isPending}>
                  {t("relaunch")}
                </button>
              ) : null}
              {run.status === "COMPLETED" || run.status === "FAILED" || run.status === "QUEUED" ? (
                <button type="button" className={buttonClass.secondary} onClick={() => setDiscarding(true)}>
                  {t("discard")}
                </button>
              ) : null}
              {usable ? (
                <button type="button" className={buttonClass.primary} onClick={() => setApplying(true)}>
                  {t("apply")}
                </button>
              ) : null}
            </Can>
          </>
        }
      />
      {flash.node}
      {restart.isError ? <Notice kind="error">{restart.error.message}</Notice> : null}

      {active ? (
        <Notice kind="info">{run.status === "QUEUED" ? t("queued") : t("running")}</Notice>
      ) : null}
      {run.status === "FAILED" ? (
        <Notice kind="error">
          {t("failed")} {run.errorMessage}
        </Notice>
      ) : null}
      {run.status === "DISCARDED" ? <Notice kind="info">{t("discarded")}</Notice> : null}
      {run.status === "APPLIED" && run.appliedTimetableId ? (
        <Notice kind="success">
          {t("applied")}{" "}
          <Link href={`/v2/schedule/timetables/${run.appliedTimetableId}`} className="font-medium underline">
            {t("openTimetable")}
          </Link>
        </Notice>
      ) : null}
      {usable ? <Notice kind="info">{t("proposalNotice")}</Notice> : null}

      {result ? (
        <>
          <Summary result={result} />
          <div role="tablist" aria-label={t("tabs.label")} className="flex gap-2 border-b">
            {(["preview", "issues"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                id={`gen-tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`gen-panel-${k}`}
                onClick={() => setTab(k)}
                className={`-mb-px h-11 border-b-2 px-4 text-sm font-medium ${tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {k === "issues" ? t("tabs.issues", { count: result.unplaced.reduce((n, u) => n + u.missing, 0) + result.warnings.length }) : t("tabs.preview")}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="gen-panel-preview" aria-labelledby="gen-tab-preview" hidden={tab !== "preview"}>
            {tab === "preview" ? <Preview result={result} /> : null}
          </div>
          <div role="tabpanel" id="gen-panel-issues" aria-labelledby="gen-tab-issues" hidden={tab !== "issues"}>
            {tab === "issues" ? <Issues result={result} /> : null}
          </div>
        </>
      ) : null}

      {applying && result ? <ApplyDialog runId={run.id} runName={run.name} validFrom={String(run.params.validFrom ?? "")} validTo={String(run.params.validTo ?? "")} academicYearId={run.academicYearId} result={result} onClose={() => setApplying(false)} /> : null}
      {discarding ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setDiscarding(false)}
          title={t("discardDialog.title")}
          description={t("discardDialog.description")}
          confirmLabel={t("discardDialog.confirm")}
          reasonLabel={t("discardDialog.reason")}
          reasonRequired={false}
          isPending={discard.isPending}
          error={discard.error}
          onConfirm={(reason) =>
            discard.mutate(
              { id: run.id, ...(reason ? { reason } : {}) },
              {
                onSuccess: () => {
                  setDiscarding(false);
                  flash.show(t("discardDialog.done"));
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function Summary({ result }: { result: Result }) {
  const t = useTranslations("v2Schedule.generator.summary");
  const unplaced = result.score.unplacedSessions;
  const items: Array<[string, string]> = [
    [t("sessions"), String(result.stats.sessions)],
    [t("placed"), String(result.stats.placed)],
    [t("unplaced"), String(unplaced)],
    [t("softCost"), String(result.score.softCost)],
    [t("improvement"), t("improvementValue", { from: result.score.initialSoftCost, to: result.score.softCost })],
    [t("elapsed"), t("elapsedValue", { ms: result.stats.elapsedMs, iterations: result.stats.iterations })],
  ];
  return (
    <section aria-label={t("title")} className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`text-lg font-semibold ${label === t("unplaced") && unplaced > 0 ? "text-destructive" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {result.stats.stoppedBy === "TIME_LIMIT" ? <Notice kind="warning">{t("timeLimit")}</Notice> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------

function Preview({ result }: { result: Result }) {
  const t = useTranslations("v2Schedule.generator.preview");
  const [kind, setKind] = useState<ViewKind>("classroom");
  const [subject, setSubject] = useState("");
  const idsOf = (k: ViewKind): string[] => {
    const set = new Set<string>();
    for (const p of result.placements) {
      const v = k === "classroom" ? p.classroomId : k === "staff" ? p.teacherId : p.roomId;
      if (v) set.add(v);
    }
    return [...set];
  };
  const labelOf = (k: ViewKind, v: string): string => (k === "classroom" ? result.labels.classrooms[v] : k === "staff" ? result.labels.staff[v] : result.labels.rooms[v]) ?? v;
  const options = idsOf(kind)
    .map((v) => ({ value: v, label: labelOf(kind, v) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const current = options.find((o) => o.value === subject)?.value ?? options[0]?.value ?? "";
  const shown = result.placements.filter((p) => (kind === "classroom" ? p.classroomId : kind === "staff" ? p.teacherId : p.roomId) === current);

  return (
    <section aria-label={t("title")} className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("view")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={kind}
              onChange={(v) => {
                setKind(v as ViewKind);
                setSubject("");
              }}
              options={[
                { value: "classroom", label: t("kinds.classroom") },
                { value: "staff", label: t("kinds.staff") },
                { value: "room", label: t("kinds.room") },
              ]}
            />
          )}
        </FormField>
        <FormField label={t("subject")}>{(c) => <NativeSelect {...c} value={current} onChange={setSubject} options={options} />}</FormField>
      </div>
      {options.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : <WeekGrid result={result} placements={shown} kind={kind} caption={t("caption", { name: options.find((o) => o.value === current)?.label ?? "" })} />}
    </section>
  );
}

function WeekGrid({ result, placements, kind, caption }: { result: Result; placements: Placement[]; kind: ViewKind; caption: string }) {
  const tDay = useTranslations("v2Schedule.weekdayLong");
  const t = useTranslations("v2Schedule.generator.preview");
  const { weekdays, periods } = result.grid;
  const start = new Map<string, Placement>();
  for (const p of placements) start.set(`${p.weekday}:${p.startPeriod}`, p);
  const covered = new Set<string>();
  const describe = (p: Placement): string[] => {
    const parts: string[] = [];
    if (kind !== "classroom") parts.push(result.labels.classrooms[p.classroomId] ?? p.classroomId);
    if (kind !== "staff") parts.push(p.teacherId ? (result.labels.staff[p.teacherId] ?? p.teacherId) : t("noTeacher"));
    if (kind !== "room") parts.push(p.roomId ? (result.labels.rooms[p.roomId] ?? p.roomId) : t("noRoom"));
    return parts;
  };
  return (
    <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-white/[0.04]">
          <tr>
            <th scope="col" className="w-24 px-2 py-2 text-left">
              {t("hour")}
            </th>
            {weekdays.map((d) => (
              <th key={d} scope="col" className="px-2 py-2 text-left">
                {tDay(String(d))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((per) => (
            <tr key={per.index} className="border-t align-top">
              <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-normal text-muted-foreground">
                {per.startTime} – {per.endTime}
              </th>
              {weekdays.map((d) => {
                const key = `${d}:${per.index}`;
                if (covered.has(key)) return null;
                const p = start.get(key);
                if (!p) return <td key={d} className="border-l px-2 py-2" />;
                for (let i = 1; i < p.periods; i++) covered.add(`${d}:${per.index + i}`);
                return (
                  <td key={d} rowSpan={p.periods} className="border-l bg-primary/5 px-2 py-2">
                    <p className="font-medium">{result.labels.nodes[p.curriculumNodeId] ?? p.curriculumNodeId}</p>
                    {describe(p).map((line) => (
                      <p key={line} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflits et points d'attention
// ---------------------------------------------------------------------------

function Issues({ result }: { result: Result }) {
  const t = useTranslations("v2Schedule.generator.issues");
  const tReason = useTranslations("v2Schedule.generator.reasons");
  const tWeights = useTranslations("v2Schedule.generator.weights");
  const unplacedTotal = result.unplaced.reduce((n, u) => n + u.missing, 0);
  return (
    <div className="space-y-6 pt-4">
      <section aria-labelledby="gen-hard" className="space-y-2">
        <h2 id="gen-hard" className="text-lg font-semibold">
          {t("hard.title")}
        </h2>
        <Notice kind="success">{t("hard.none")}</Notice>
      </section>

      <section aria-labelledby="gen-unplaced" className="space-y-2">
        <h2 id="gen-unplaced" className="text-lg font-semibold">
          {t("unplaced.title", { count: unplacedTotal })}
        </h2>
        {result.unplaced.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("unplaced.none")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">{t("unplaced.caption")}</caption>
              <thead className="bg-white/[0.04] text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">{t("unplaced.columns.need")}</th>
                  <th scope="col" className="px-3 py-2">{t("unplaced.columns.missing")}</th>
                  <th scope="col" className="px-3 py-2">{t("unplaced.columns.why")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.unplaced.map((u) => (
                  <tr key={u.requirementId} className="align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {u.label}
                    </th>
                    <td className="px-3 py-2">{t("unplaced.missingValue", { missing: u.missing, requested: u.requested })}</td>
                    <td className="px-3 py-2">
                      <ul className="space-y-1">
                        {u.reasons.slice(0, 4).map((r) => (
                          <li key={r.code}>
                            <span className="font-medium">{tReason(r.code)}</span>
                            {r.detail ? <span className="text-muted-foreground"> — {r.detail}</span> : r.count > 0 ? <span className="text-muted-foreground"> — {t("unplaced.count", { count: r.count })}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {result.warnings.length > 0 ? (
        <section aria-labelledby="gen-warnings" className="space-y-2">
          <h2 id="gen-warnings" className="text-lg font-semibold">
            {t("warnings.title")}
          </h2>
          <ul className="space-y-2">
            {result.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>
                <Notice kind="warning">{w.message}</Notice>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.publishedTimetable ? (
        <Notice kind="info">{t("published", { name: result.publishedTimetable.name })}</Notice>
      ) : null}

      <section aria-labelledby="gen-soft" className="space-y-2">
        <h2 id="gen-soft" className="text-lg font-semibold">
          {t("soft.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("soft.hint")}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(result.score.breakdown) as Array<keyof Result["score"]["breakdown"]>).map((k) => (
            <div key={k} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <dt className="text-xs text-muted-foreground">{tWeights(k)}</dt>
              <dd className="text-lg font-semibold">{result.score.breakdown[k]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application par un humain
// ---------------------------------------------------------------------------

function ApplyDialog({ runId, runName, validFrom, validTo, academicYearId, result, onClose }: { runId: string; runName: string; validFrom: string; validTo: string; academicYearId: string; result: Result; onClose: () => void }) {
  const t = useTranslations("v2Schedule.generator.apply");
  const date = useDateFormat();
  const router = useRouter();
  const apply = useApplyAutogenRun();
  const drafts = useTimetables({ academicYearId, status: "DRAFT" });
  const unplaced = result.score.unplacedSessions;
  const [mode, setMode] = useState<"NEW_DRAFT" | "REPLACE_DRAFT">("NEW_DRAFT");
  const [name, setName] = useState(runName);
  const [from, setFrom] = useState(validFrom);
  const [to, setTo] = useState(validTo);
  const [target, setTarget] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [acceptUnplaced, setAcceptUnplaced] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    if (mode === "REPLACE_DRAFT" && (!target || !confirmReplace)) {
      setLocalError(target ? t("confirmReplaceRequired") : t("targetRequired"));
      return;
    }
    if (unplaced > 0 && !acceptUnplaced) {
      setLocalError(t("confirmUnplacedRequired", { count: unplaced }));
      return;
    }
    setLocalError(null);
    apply.mutate(
      {
        id: runId,
        body: {
          mode,
          ...(mode === "NEW_DRAFT" ? { name: name.trim(), validFrom: from, validTo: to } : { targetTimetableId: target, confirmReplace }),
          acceptUnplaced,
        },
      },
      { onSuccess: (r) => router.push(`/v2/schedule/timetables/${r.timetable.id}`) },
    );
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={apply.isPending} error={apply.error} wide>
      {localError ? <Notice kind="error">{localError}</Notice> : null}
      <Notice kind="info">{t("neverPublishes")}</Notice>
      {result.publishedTimetable ? <Notice kind="warning">{t("publishedExists", { name: result.publishedTimetable.name })}</Notice> : null}
      <FormField label={t("mode")}>
        {(c) => (
          <NativeSelect
            {...c}
            value={mode}
            onChange={(v) => setMode(v as "NEW_DRAFT" | "REPLACE_DRAFT")}
            options={[
              { value: "NEW_DRAFT", label: t("modes.NEW_DRAFT") },
              { value: "REPLACE_DRAFT", label: t("modes.REPLACE_DRAFT") },
            ]}
          />
        )}
      </FormField>
      {mode === "NEW_DRAFT" ? (
        <>
          <FormField label={t("name")} required>
            {(c) => <TextControl {...c} value={name} onChange={setName} maxLength={200} />}
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("validFrom")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
            <FormField label={t("validTo")} hint={t("validity", { from: date.civil(from), to: date.civil(to) })}>
              {(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}
            </FormField>
          </div>
        </>
      ) : (
        <>
          <FormField label={t("target")} hint={t("targetHint")} required>
            {(c) => <NativeSelect {...c} value={target} onChange={setTarget} placeholder={t("targetPlaceholder")} options={(drafts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />}
          </FormField>
          <CheckControl checked={confirmReplace} onChange={setConfirmReplace} label={t("confirmReplace")} hint={t("confirmReplaceHint")} />
        </>
      )}
      {unplaced > 0 ? <CheckControl checked={acceptUnplaced} onChange={setAcceptUnplaced} label={t("acceptUnplaced", { count: unplaced })} hint={t("acceptUnplacedHint")} /> : null}
    </FormDialog>
  );
}
