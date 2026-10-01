"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFeature, usePermission } from "@/platform/access";
import { useClosePeriod, useDeliberatePeriod, useLockPeriod, usePeriodView, useRecompute, useReopenPeriod, useRepinPeriod, useResultsSettings, type PeriodView, type RepinResult } from "@/platform/v2/results";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { toneOfStatus } from "../../assessments/_components/shared";
import { ClassPeriodSelector, shortHash, useClassPeriodSelection } from "./shared";

const STEPS = ["OPEN", "GRADING_LOCKED", "DELIBERATED", "CLOSED"] as const;

export function PeriodScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Results.period");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const view = usePeriodView(sel.classroomId || null, sel.periodId || null);
  const hasSelection = Boolean(sel.classroomId && sel.periodId);
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClassPeriodSelector classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroom} onPeriod={sel.setPeriod} />
      {!hasSelection ? <Notice kind="info">{t("choose")}</Notice> : <QueryBoundary query={view}>{view.data ? <PeriodDetail view={view.data} classroomId={sel.classroomId} periodId={sel.periodId} /> : null}</QueryBoundary>}
    </div>
  );
}

function PeriodDetail({ view, classroomId, periodId }: { view: PeriodView; classroomId: string; periodId: string }) {
  const t = useTranslations("v2Results.period");
  const tStatus = useTranslations("v2Results.periodStatus");
  const date = useDateFormat();
  const flash = useFlash();
  const state = view.state;
  const qs = `classroom=${classroomId}&period=${periodId}`;
  const [dialog, setDialog] = useState<"lock" | "deliberate" | "close" | "reopen" | "repin" | null>(null);
  const [repin, setRepin] = useState<RepinResult | null>(null);
  const recompute = useRecompute();
  const [actionError, setActionError] = useState<unknown>(null);
  const settings = useResultsSettings();
  const deliberationFeature = useFeature("results.deliberation");
  const canLock = usePermission("period.lock");
  const canClose = usePermission("period.close");
  const canDeliberate = usePermission("decision.record");
  const canReopen = usePermission("period.reopen");
  const canRepin = usePermission("period.repin");
  const canRecompute = usePermission("result.recompute");
  const currentIndex = STEPS.indexOf(state.status);
  const needsDeliberation = settings.data?.requireDeliberation === true;

  async function runRecompute() {
    setActionError(null);
    try {
      await recompute.mutateAsync({ classroomId, periodId });
      flash.show(t("recomputed"));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div className="space-y-6">
      {flash.node}
      <section aria-label={t("stateTitle")} className="space-y-3 rounded-md border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("stateTitle")}</h2>
          <StatusBadge label={tStatus(state.status)} tone={toneOfStatus(state.status)} />
        </div>
        <ol aria-label={t("steps")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={s === state.status ? "step" : undefined} className={s === state.status ? "font-semibold text-primary" : i < currentIndex ? "text-emerald-700" : "text-muted-foreground"}>
              {i > 0 ? <span aria-hidden="true"> › </span> : null}
              {tStatus(s)}
              {s === state.status ? <span className="sr-only"> ({t("current")})</span> : null}
            </li>
          ))}
        </ol>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label={t("ruleSet")}>{`${state.ruleSetCode} · v${state.ruleVersionNo}`}</Info>
          <Info label={t("definitionHash")}>
            <span title={state.definitionHash} className="font-mono text-xs">
              {shortHash(state.definitionHash)}
            </span>
          </Info>
          <Info label={t("resultsVersion")}>{state.resultsVersion}</Info>
          <Info label={t("lockedAt")}>{date.instant(state.lockedAt)}</Info>
          <Info label={t("deliberatedAt")}>{date.instant(state.deliberatedAt)}</Info>
          <Info label={t("closedAt")}>{date.instant(state.closedAt)}</Info>
        </dl>
        {state.reopenCount > 0 ? <p className="text-sm text-muted-foreground">{t("reopened", { count: state.reopenCount, reason: state.lastReopenReason ?? "—" })}</p> : null}
      </section>

      {view.ruleLag.behind ? (
        <Notice kind="warning">
          <p className="font-medium">{t("lagTitle")}</p>
          <p>{t("lagBody", { pinned: `${view.ruleLag.pinned.ruleSetCode} v${view.ruleLag.pinned.ruleVersionNo}`, active: view.ruleLag.active ? `${view.ruleLag.active.ruleSetCode} v${view.ruleLag.active.ruleVersionNo}` : "—" })}</p>
          {state.status === "OPEN" && canRepin.allowed ? (
            <button type="button" className={`${buttonClass.secondary} mt-2`} onClick={() => setDialog("repin")}>
              {t("repin")}
            </button>
          ) : (
            <p className="mt-1 text-xs">{t(state.status === "OPEN" ? "lagNoRight" : "lagNotOpen")}</p>
          )}
        </Notice>
      ) : null}

      {repin ? <RepinReport result={repin} /> : null}

      <section aria-label={t("countsTitle")} className="grid gap-3 sm:grid-cols-4">
        <Count label={t("counts.total")} value={view.counts.total} />
        <Count label={t("counts.draft")} value={view.counts.draft} />
        <Count label={t("counts.final")} value={view.counts.final} />
        <Count label={t("counts.error")} value={view.counts.error} danger={view.counts.error > 0} />
      </section>
      {view.counts.error > 0 ? <Notice kind="error">{t("errorsHint", { count: view.counts.error })}</Notice> : null}

      {view.pendingAssessments.length > 0 && state.status === "OPEN" ? (
        <section aria-label={t("pendingLabel")} className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <h2 className="font-semibold">{t("pendingTitle", { count: view.pendingAssessments.length })}</h2>
          <ul className="list-disc pl-5">
            {view.pendingAssessments.map((a) => (
              <li key={a.id}>
                <Link href={`/v2/assessments/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                  {a.title}
                </Link>{" "}
                <span className="text-xs">({a.status})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={t("actionsTitle")} className="space-y-2">
        <h2 className="text-lg font-semibold">{t("actionsTitle")}</h2>
        <div className="flex flex-wrap gap-2">
          {state.status === "OPEN" && canLock.allowed ? (
            <button type="button" className={buttonClass.primary} onClick={() => setDialog("lock")}>
              {t("actions.lock")}
            </button>
          ) : null}
          {state.status === "GRADING_LOCKED" && canDeliberate.allowed && deliberationFeature.allowed ? (
            <button type="button" className={buttonClass.primary} onClick={() => setDialog("deliberate")}>
              {t("actions.deliberate")}
            </button>
          ) : null}
          {(state.status === "GRADING_LOCKED" || state.status === "DELIBERATED") && canClose.allowed ? (
            <button type="button" className={state.status === "DELIBERATED" ? buttonClass.primary : buttonClass.secondary} onClick={() => setDialog("close")} disabled={state.status === "GRADING_LOCKED" && needsDeliberation} title={state.status === "GRADING_LOCKED" && needsDeliberation ? t("deliberationRequired") : undefined}>
              {t("actions.close")}
            </button>
          ) : null}
          {state.status === "CLOSED" && canReopen.allowed ? (
            <button type="button" className={buttonClass.danger} onClick={() => setDialog("reopen")}>
              {t("actions.reopen")}
            </button>
          ) : null}
          {state.status !== "CLOSED" && canRecompute.allowed ? (
            <button type="button" className={buttonClass.secondary} onClick={() => void runRecompute()} disabled={recompute.isPending}>
              {t("actions.recompute")}
            </button>
          ) : null}
        </div>
        {state.status === "GRADING_LOCKED" && needsDeliberation ? <p className="text-sm text-muted-foreground">{t("deliberationRequired")}</p> : null}
        {actionError ? <ErrorBlock error={actionError} /> : null}
      </section>

      <nav aria-label={t("linksTitle")} className="flex flex-wrap gap-2">
        <Link href={`/v2/results/matrix?${qs}`} className={buttonClass.secondary}>
          {t("links.matrix")}
        </Link>
        <Can permission="decision.record">
          <Link href={`/v2/results/decisions?${qs}`} className={buttonClass.secondary}>
            {t("links.decisions")}
          </Link>
        </Can>
        <Can permission="result.override.request">
          <Link href={`/v2/results/overrides?${qs}`} className={buttonClass.secondary}>
            {t("links.overrides")}
          </Link>
        </Can>
        <Can permission="reportcard.generate">
          <Link href={`/v2/reportcards/issue?${qs}`} className={buttonClass.secondary}>
            {t("links.reportcards")}
          </Link>
        </Can>
      </nav>

      {view.closures.length > 0 ? (
        <section aria-labelledby="closures-h" className="space-y-2">
          <h2 id="closures-h" className="text-lg font-semibold">
            {t("closuresTitle")}
          </h2>
          <ul className="space-y-2">
            {view.closures.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{t("closure", { version: c.resultsVersion, count: c.resultsCount, date: date.instant(c.closedAt) })}</p>
                <p className="text-xs text-muted-foreground">
                  {t("closureHash")} <span title={c.closureHash} className="font-mono">{shortHash(c.closureHash)}</span>
                </p>
                {c.forcedReason ? <p className="text-xs">{t("forced", { reason: c.forcedReason })}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.recompute.length > 0 ? (
        <section aria-labelledby="recompute-h" className="space-y-2">
          <h2 id="recompute-h" className="text-lg font-semibold">
            {t("recomputeTitle")}
          </h2>
          <ul className="space-y-1 text-sm">
            {view.recompute.map((r) => (
              <li key={r.id}>
                {t("recomputeItem", { status: r.status, date: date.instant(r.notBefore), attempts: r.attempts })}
                {r.blockedReason ? ` — ${r.blockedReason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dialog === "lock" ? <LockDialog view={view} classroomId={classroomId} periodId={periodId} onClose={() => setDialog(null)} onDone={() => flash.show(t("done.lock"))} /> : null}
      {dialog === "deliberate" ? <DeliberateDialog classroomId={classroomId} periodId={periodId} onClose={() => setDialog(null)} onDone={() => flash.show(t("done.deliberate"))} /> : null}
      {dialog === "close" ? <CloseDialog view={view} classroomId={classroomId} periodId={periodId} onClose={() => setDialog(null)} onDone={(msg) => flash.show(msg)} /> : null}
      {dialog === "reopen" ? <ReopenDialog classroomId={classroomId} periodId={periodId} onClose={() => setDialog(null)} onDone={() => flash.show(t("done.reopen"))} /> : null}
      {dialog === "repin" ? (
        <RepinDialog
          stateId={state.id}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setRepin(r);
            flash.show(t(r.changed ? "done.repin" : "done.repinNone"));
          }}
        />
      ) : null}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function Count({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${danger ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogues d'action
// ---------------------------------------------------------------------------

function LockDialog({ view, classroomId, periodId, onClose, onDone }: { view: PeriodView; classroomId: string; periodId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Results.lock");
  const lock = useLockPeriod();
  const pending = view.pendingAssessments;
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (force && reason.trim().length < 10) return setError(t("reasonTooShort"));
    setError(null);
    try {
      await lock.mutateAsync({ classroomId, periodId, force: force || undefined, reason: force ? reason.trim() : undefined });
      onDone();
      onClose();
    } catch {
      /* affichée par la boîte de dialogue */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={lock.isPending} error={lock.error}>
      {pending.length > 0 ? (
        <Notice kind="warning">
          <p>{t("pending", { count: pending.length })}</p>
        </Notice>
      ) : null}
      {pending.length > 0 ? (
        <>
          <CheckControl checked={force} onChange={setForce} label={t("force")} hint={t("forceHint")} />
          {force ? (
            <FormField label={t("reason")} required error={error} hint={t("reasonHint")}>
              {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
            </FormField>
          ) : null}
        </>
      ) : (
        <p className="text-sm">{t("confirm")}</p>
      )}
    </FormDialog>
  );
}

function DeliberateDialog({ classroomId, periodId, onClose, onDone }: { classroomId: string; periodId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Results.deliberate");
  const deliberate = useDeliberatePeriod();
  const [confirmProposed, setConfirm] = useState(false);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={deliberate.isPending}
      error={deliberate.error}
      onSubmit={async () => {
        try {
          await deliberate.mutateAsync({ classroomId, periodId, confirmProposed: confirmProposed || undefined });
          onDone();
          onClose();
        } catch {
          /* affichée par la boîte de dialogue */
        }
      }}
    >
      <CheckControl checked={confirmProposed} onChange={setConfirm} label={t("confirmProposed")} hint={t("confirmProposedHint")} />
    </FormDialog>
  );
}

function CloseDialog({ view, classroomId, periodId, onClose, onDone }: { view: PeriodView; classroomId: string; periodId: string; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Results.close");
  const close = useClosePeriod();
  const errors = view.counts.error;
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (force && reason.trim().length < 10) return setError(t("reasonTooShort"));
    setError(null);
    try {
      const r = await close.mutateAsync({ classroomId, periodId, force: force || undefined, reason: force ? reason.trim() : undefined });
      onDone(t("done", { count: r.resultsCount, version: r.resultsVersion, excluded: r.excluded.length }));
      onClose();
    } catch {
      /* affichée par la boîte de dialogue */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={close.isPending} error={close.error}>
      <Notice kind="warning">{t("irreversible")}</Notice>
      {errors > 0 ? (
        <>
          <Notice kind="error">{t("errors", { count: errors })}</Notice>
          <CheckControl checked={force} onChange={setForce} label={t("force")} hint={t("forceHint")} />
          {force ? (
            <FormField label={t("reason")} required error={error} hint={t("reasonHint")}>
              {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
            </FormField>
          ) : null}
        </>
      ) : null}
    </FormDialog>
  );
}

function ReopenDialog({ classroomId, periodId, onClose, onDone }: { classroomId: string; periodId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Results.reopen");
  const reopen = useReopenPeriod();
  const [kind, setKind] = useState<"CORRECTION" | "RESIT_SESSION">("CORRECTION");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 10) return setError(t("reasonTooShort"));
    setError(null);
    try {
      await reopen.mutateAsync({ classroomId, periodId, kind, reason: reason.trim() });
      onDone();
      onClose();
    } catch {
      /* affichée par la boîte de dialogue */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={reopen.isPending} error={reopen.error}>
      <FormField label={t("kind")} required hint={t(`kindHint.${kind}`)}>
        {(c) => (
          <NativeSelect
            {...c}
            value={kind}
            onChange={(v) => setKind(v as "CORRECTION" | "RESIT_SESSION")}
            options={[
              { value: "CORRECTION", label: t("kinds.CORRECTION") },
              { value: "RESIT_SESSION", label: t("kinds.RESIT_SESSION") },
            ]}
          />
        )}
      </FormField>
      <FormField label={t("reason")} required error={error} hint={t("reasonHint")}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}

function RepinDialog({ stateId, onClose, onDone }: { stateId: string; onClose: () => void; onDone: (result: RepinResult) => void }) {
  const t = useTranslations("v2Results.repin");
  const repin = useRepinPeriod();
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={repin.isPending}
      error={repin.error}
      onSubmit={async () => {
        try {
          onDone(await repin.mutateAsync({ stateId }));
          onClose();
        } catch {
          /* affichée par la boîte de dialogue */
        }
      }}
    >
      <Notice kind="info">{t("explain")}</Notice>
    </FormDialog>
  );
}

function RepinReport({ result }: { result: RepinResult }) {
  const t = useTranslations("v2Results.repin");
  const sim = result.simulation;
  if (!sim) return <Notice kind="info">{t("noChange")}</Notice>;
  return (
    <section aria-label={t("reportTitle")} className="space-y-2 rounded-md border p-4 text-sm">
      <h2 className="text-lg font-semibold">{t("reportTitle")}</h2>
      <p>{t("reportFromTo", { from: `${sim.from.ruleSetCode} v${sim.from.ruleVersionNo}`, to: `${sim.to.ruleSetCode} v${sim.to.ruleVersionNo}` })}</p>
      <p data-testid="repin-counts">{t("reportCounts", { computed: sim.computed, changed: sim.changed, unchanged: sim.unchanged, errors: sim.errors })}</p>
      {sim.samples.length > 0 ? (
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t("samples")}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-2">{t("columns.enrollment")}</th>
              <th scope="col" className="py-1 pr-2">{t("columns.field")}</th>
              <th scope="col" className="py-1 pr-2">{t("columns.before")}</th>
              <th scope="col" className="py-1">{t("columns.after")}</th>
            </tr>
          </thead>
          <tbody>
            {sim.samples.map((s, i) => (
              <tr key={i} className="border-t">
                <td className="py-1 pr-2 font-mono">{s.enrollmentId.slice(0, 8)}</td>
                <td className="py-1 pr-2">{s.field}</td>
                <td className="py-1 pr-2">{String(s.before ?? "—")}</td>
                <td className="py-1">{String(s.after ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
