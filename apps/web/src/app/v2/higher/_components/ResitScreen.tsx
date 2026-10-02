"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { higherOpenResitWindowBodySchema, type higherResitWindowDtoSchema } from "@ecoledigitale/contracts/v2/higher";
import { useFeature, usePermission } from "@/platform/access";
import { useCloseResitWindow, useOpenResitWindow, useResitCandidates, useResitWindow, useResitWindows } from "@/platform/v2/higher";
import { FeatureNotice } from "@/platform/ui/AccessGate";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { toneOfStatus, useStudentNames } from "../../assessments/_components/shared";
import { ClassPeriodSelector, useClassPeriodSelection } from "../../results/_components/shared";
import { shortId } from "./shared";

type HigherResitWindowRow = z.infer<typeof higherResitWindowDtoSchema>;

/**
 * Rattrapage (session 2) : candidats désignés par les résultats, fenêtre de rattrapage d'une classe et d'une période,
 * inscriptions. La session 2 REMPLACE la session 1 (décision métier) ; ouvrir la fenêtre déverrouille la seule session 2.
 */
export function ResitScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Higher.resit");
  const feature = useFeature("higher.session2");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const hasSelection = Boolean(sel.classroomId && sel.periodId);
  const canManage = usePermission("higher.resit.manage");
  const [opening, setOpening] = useState(false);
  const flash = useFlash();
  if (feature.isLoading) return <LoadingBlock />;
  if (!feature.allowed) return <FeatureNotice />;

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage.allowed && hasSelection ? (
            <button type="button" className={buttonClass.primary} onClick={() => setOpening(true)}>
              {t("open")}
            </button>
          ) : null
        }
      />
      <ClassPeriodSelector classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroom} onPeriod={sel.setPeriod} />
      {flash.node}
      {!hasSelection ? (
        <Notice kind="info">{t("choose")}</Notice>
      ) : (
        <div className="space-y-8">
          <Windows classroomId={sel.classroomId} periodId={sel.periodId} onMessage={flash.show} />
          <Candidates classroomId={sel.classroomId} periodId={sel.periodId} />
        </div>
      )}
      {opening ? <OpenDialog classroomId={sel.classroomId} periodId={sel.periodId} onClose={() => setOpening(false)} onDone={(registered, already) => flash.show(t("opened", { registered, already }))} /> : null}
    </div>
  );
}

function Windows({ classroomId, periodId, onMessage }: { classroomId: string; periodId: string; onMessage: (m: string) => void }) {
  const t = useTranslations("v2Higher.resit");
  const tStatus = useTranslations("v2Higher.resitWindowStatus");
  const date = useDateFormat();
  const query = useResitWindows({ classroomId, periodId });
  const close = useCloseResitWindow();
  const canManage = usePermission("higher.resit.manage");
  const [closing, setClosing] = useState<HigherResitWindowRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="windows-h" className="space-y-3">
      <h2 id="windows-h" className="text-lg font-semibold">
        {t("windows")}
      </h2>
      <QueryBoundary query={query} isEmpty={items.length === 0} empty={<EmptyBlock title={t("noWindow")} description={t("noWindowHint")} />}>
        <ul className="space-y-3" aria-label={t("windowsLabel")}>
          {items.map((w) => (
            <li key={w.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{t("windowDates", { from: date.civil(w.opensOn), to: date.civil(w.closesOn) })}</p>
                <StatusBadge label={tStatus(w.status)} tone={toneOfStatus(w.status === "CANCELLED" ? "CANCELLED" : w.status)} />
              </div>
              <p className="text-xs text-muted-foreground">{w.nodeIds ? t("someCourses", { count: w.nodeIds.length }) : t("allCourses")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.ghost} onClick={() => setExpanded((x) => (x === w.id ? null : w.id))} aria-expanded={expanded === w.id}>
                  {t("registrations")}
                </button>
                {w.status === "OPEN" && canManage.allowed ? (
                  <button type="button" className={buttonClass.secondary} onClick={() => setClosing(w)}>
                    {t("close")}
                  </button>
                ) : null}
              </div>
              {expanded === w.id ? <Registrations windowId={w.id} classroomId={classroomId} /> : null}
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {closing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setClosing(null)}
          title={t("closeTitle")}
          description={t("closeDescription")}
          reasonLabel={t("closeConfirm")}
          reasonRequired={false}
          confirmLabel={t("close")}
          isPending={close.isPending}
          error={close.error}
          onConfirm={async () => {
            try {
              await close.mutateAsync({ id: closing.id });
              onMessage(t("closed"));
              setClosing(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </section>
  );
}

function Registrations({ windowId, classroomId }: { windowId: string; classroomId: string }) {
  const t = useTranslations("v2Higher.resit");
  const tReg = useTranslations("v2Higher.resitRegistrationStatus");
  const query = useResitWindow(windowId);
  const { names } = useStudentNames(classroomId);
  if (query.isPending && query.fetchStatus !== "idle") return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  const regs = query.data?.registrations ?? [];
  if (regs.length === 0) return <p className="text-sm text-muted-foreground">{t("noRegistration")}</p>;
  return (
    <ul className="space-y-1" aria-label={t("registrationsLabel")}>
      {regs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/30 px-3 py-2">
          <span>
            {names.get(r.studentId)?.name ?? t("studentFallback", { id: r.studentId.slice(0, 4) })} <span className="font-mono text-xs text-muted-foreground">{t("courseShort", { id: shortId(r.ecueNodeId) })}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {r.session1Average ? <span className="text-xs text-muted-foreground">{t("session1", { value: showDecimal(r.session1Average) })}</span> : null}
            <StatusBadge label={tReg(r.status)} tone="neutral" />
            {r.outcome ? <StatusBadge label={t(`outcome.${r.outcome}`)} tone={r.outcome === "VALIDATED" ? "success" : "warning"} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Candidates({ classroomId, periodId }: { classroomId: string; periodId: string }) {
  const t = useTranslations("v2Higher.resit");
  const query = useResitCandidates(classroomId, periodId);
  const { names } = useStudentNames(classroomId);
  const items = useMemo(() => [...(query.data?.candidates ?? [])].sort((a, b) => (names.get(a.studentId)?.name ?? "~").localeCompare(names.get(b.studentId)?.name ?? "~", "fr", { sensitivity: "base" })), [query.data, names]);
  return (
    <section aria-labelledby="cand-h" className="space-y-3">
      <h2 id="cand-h" className="text-lg font-semibold">
        {t("candidates")}
      </h2>
      <QueryBoundary query={query} isEmpty={items.length === 0} empty={<EmptyBlock title={t("noCandidate")} description={t("noCandidateHint")} />}>
        <div role="region" aria-label={t("candidatesCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("candidatesCaption")}</caption>
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.student")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.course")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("columns.session1")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={`${c.enrollmentId}-${c.ecueNodeId}`} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {names.get(c.studentId)?.name ?? t("studentFallback", { id: c.studentId.slice(0, 4) })}
                  </th>
                  <td className="px-3 py-2 font-mono text-xs">{t("courseShort", { id: shortId(c.ecueNodeId) })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{showDecimal(c.session1Average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </section>
  );
}

function OpenDialog({ classroomId, periodId, onClose, onDone }: { classroomId: string; periodId: string; onClose: () => void; onDone: (registered: number, already: number) => void }) {
  const t = useTranslations("v2Higher.resit");
  const open = useOpenResitWindow();
  const [form, setForm] = useState({ opensOn: "", closesOn: "" });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const v = validateWith(higherOpenResitWindowBodySchema, { classroomId, academicPeriodId: periodId, opensOn: form.opensOn, closesOn: form.closesOn });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const r = await open.mutateAsync(v.data);
      onDone(r.registrations.length, r.alreadyRegistered);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("openTitle")} description={t("openDescription")} submitLabel={t("openSubmit")} onSubmit={() => void submit()} isPending={open.isPending} error={Object.keys(errors).length === 0 ? open.error : null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("opensOn")} required error={errors.opensOn}>
          {(c) => <TextControl {...c} type="date" value={form.opensOn} onChange={(v) => setForm((f) => ({ ...f, opensOn: v }))} />}
        </FormField>
        <FormField label={t("closesOn")} required error={errors.closesOn}>
          {(c) => <TextControl {...c} type="date" value={form.closesOn} onChange={(v) => setForm((f) => ({ ...f, closesOn: v }))} />}
        </FormField>
      </div>
      <Notice kind="info">{t("openNotice")}</Notice>
    </FormDialog>
  );
}
