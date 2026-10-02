"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CONTROL_KINDS, type AssignmentDetailDto, type ControlDto } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { useYearPeriods } from "@/platform/v2/academic";
import { useCompleteControl, usePlanControl, useResolveControl, useWaiveControl } from "@/platform/v2/stateassign";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { CONTROL_TONE, PERM, isIsoDate } from "./stateassign-utils";

function PlanDialog({ detail, open, onOpenChange }: { detail: AssignmentDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Stateassign.controls.plan");
  const tKind = useTranslations("v2Stateassign.controlKind");
  const mutation = usePlanControl();
  const periods = useYearPeriods(detail.assignment.academicYearId);
  const [kind, setKind] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const needsPeriod = kind === "ATTENDANCE";
  const problems = { kind: kind ? null : t("errors.kind"), period: needsPeriod && !periodId ? t("errors.period") : null, date: isIsoDate(dueOn) ? null : t("errors.date") };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.values(problems).some(Boolean)) return;
        mutation.mutate({ assignmentId: detail.assignment.id, kind, dueOn, academicPeriodId: periodId || null }, { onSuccess: () => onOpenChange(false) });
      }}
    >
      <FormField label={t("kind")} required error={submitted ? problems.kind : (errors.kind ?? null)}>
        {(c) => <NativeSelect {...c} value={kind} onChange={setKind} placeholder={t("choose")} options={CONTROL_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}
      </FormField>
      <FormField label={t("period")} required={needsPeriod} hint={needsPeriod ? t("periodHint") : undefined} error={submitted ? problems.period : (errors.academicPeriodId ?? null)}>
        {(c) => <NativeSelect {...c} value={periodId} onChange={setPeriodId} placeholder={t("noPeriod")} options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
      </FormField>
      <FormField label={t("dueOn")} required error={submitted ? problems.date : (errors.dueOn ?? null)}>{(c) => <TextControl {...c} type="date" value={dueOn} onChange={setDueOn} />}</FormField>
    </FormDialog>
  );
}

function CompleteDialog({ control, open, onOpenChange }: { control: ControlDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Stateassign.controls.complete");
  const mutation = useCompleteControl();
  const [outcome, setOutcome] = useState<"OK" | "ANOMALY">("OK");
  const [findings, setFindings] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const findingsProblem = outcome === "ANOMALY" && findings.trim().length < 5 ? t("errors.findings") : null;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={control.kind === "ATTENDANCE" ? t("attendanceNote") : t("description")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      onSubmit={() => {
        setSubmitted(true);
        if (findingsProblem) return;
        mutation.mutate({ id: control.id, outcome, findings: findings.trim() || null }, { onSuccess: () => onOpenChange(false) });
      }}
    >
      <FormField label={t("outcome")} required>
        {(c) => <NativeSelect {...c} value={outcome} onChange={(v) => setOutcome(v === "ANOMALY" ? "ANOMALY" : "OK")} options={[{ value: "OK", label: t("outcomes.OK") }, { value: "ANOMALY", label: t("outcomes.ANOMALY") }]} />}
      </FormField>
      <FormField label={t("findings")} required={outcome === "ANOMALY"} error={submitted ? findingsProblem : (errors.findings ?? null)}>{(c) => <TextAreaControl {...c} value={findings} onChange={setFindings} maxLength={4000} />}</FormField>
    </FormDialog>
  );
}

/** Faits consignés par le contrôle : fournis par le module propriétaire (présence), jamais calculés ici. */
function Evidence({ control }: { control: ControlDto }) {
  const t = useTranslations("v2Stateassign.controls.evidence");
  const money = useMoney();
  const e = control.evidence as { attendance?: { available?: boolean; absentMinutes?: number; excusedMinutes?: number; lateCount?: number }; reconciliation?: { status?: string; stateDelta?: number | null; parentDelta?: number | null; currency?: string } };
  if (e.attendance) {
    const a = e.attendance;
    return a.available ? (
      <p className="text-xs text-muted-foreground">{t("attendance", { absent: money.minutes(a.absentMinutes ?? 0), excused: money.minutes(a.excusedMinutes ?? 0), late: a.lateCount ?? 0 })}</p>
    ) : (
      <p className="text-xs text-muted-foreground">{t("attendanceUnavailable")}</p>
    );
  }
  if (e.reconciliation) {
    const r = e.reconciliation;
    const cur = r.currency ?? "XOF";
    return <p className="text-xs text-muted-foreground">{t("reconciliation", { status: r.status ?? "—", state: money.fmt(r.stateDelta ?? null, cur), parent: money.fmt(r.parentDelta ?? null, cur) })}</p>;
  }
  return null;
}

/** Contrôles périodiques : planifiés (humain ou règle de l'établissement), RÉALISÉS par un humain ; anomalie résolue avec motif. */
export function ControlsPanel({ detail }: { detail: AssignmentDetailDto }) {
  const t = useTranslations("v2Stateassign.controls");
  const tStatus = useTranslations("v2Stateassign.controlStatus");
  const tKind = useTranslations("v2Stateassign.controlKind");
  const date = useDateFormat();
  const canPerform = usePermission(PERM.controlPerform).allowed;
  const waive = useWaiveControl();
  const resolve = useResolveControl();
  const [planning, setPlanning] = useState(false);
  const [completing, setCompleting] = useState<ControlDto | null>(null);
  const [waiving, setWaiving] = useState<ControlDto | null>(null);
  const [resolving, setResolving] = useState<ControlDto | null>(null);
  const s = detail.assignment.status;
  const operational = s === "VERIFIED" || s === "ACTIVE" || s === "SUSPENDED";

  const columns = useMemo<DataTableColumn<ControlDto>[]>(
    () => [
      { id: "kind", header: t("columns.kind"), rowHeader: true, cell: (c) => tKind(c.kind) },
      { id: "due", header: t("columns.dueOn"), cell: (c) => date.civil(c.dueOn) },
      {
        id: "status",
        header: t("columns.status"),
        cell: (c) => (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge label={tStatus(c.status)} tone={CONTROL_TONE[c.status]} />
            {c.overdue ? <StatusBadge label={t("overdue")} tone="danger" /> : null}
          </span>
        ),
      },
      {
        id: "findings",
        header: t("columns.findings"),
        className: "hidden md:table-cell",
        cell: (c) => (
          <div className="space-y-1">
            {c.findings ? <p className="text-sm">{c.findings}</p> : null}
            {c.anomalyResolution ? <p className="text-xs text-muted-foreground">{t("resolution", { text: c.anomalyResolution })}</p> : null}
            <Evidence control={c} />
          </div>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("columns.actions")}</span>,
        cell: (c) =>
          canPerform ? (
            <span className="flex flex-wrap gap-1">
              {c.status === "PENDING" ? (
                <>
                  <button type="button" onClick={() => setCompleting(c)} className={buttonClass.ghost}>{t("actions.complete")}<span className="sr-only"> — {tKind(c.kind)}</span></button>
                  <button type="button" onClick={() => setWaiving(c)} className={buttonClass.ghost}>{t("actions.waive")}<span className="sr-only"> — {tKind(c.kind)}</span></button>
                </>
              ) : null}
              {c.status === "ANOMALY" ? <button type="button" onClick={() => setResolving(c)} className={buttonClass.ghost}>{t("actions.resolve")}<span className="sr-only"> — {tKind(c.kind)}</span></button> : null}
            </span>
          ) : null,
      },
    ],
    [t, tKind, tStatus, date, canPerform],
  );

  return (
    <section aria-labelledby="controls-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="controls-title" className="text-base font-semibold">{t("title")}</h2>
        {canPerform && operational ? <button type="button" onClick={() => setPlanning(true)} className={buttonClass.secondary}>{t("plan.button")}</button> : null}
      </div>
      <Notice kind="info">{t("humanNote")}</Notice>
      <DataTable caption={t("caption")} columns={columns} rows={detail.controls} getRowId={(c) => c.id} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      {planning ? <PlanDialog detail={detail} open onOpenChange={(o) => !o && setPlanning(false)} /> : null}
      {completing ? <CompleteDialog control={completing} open onOpenChange={(o) => !o && setCompleting(null)} /> : null}
      <ReasonDialog
        open={waiving !== null}
        onOpenChange={(o) => !o && setWaiving(null)}
        title={t("waive.title")}
        description={t("waive.description")}
        reasonLabel={t("waive.reason")}
        confirmLabel={t("waive.submit")}
        isPending={waive.isPending}
        error={waive.error}
        onConfirm={(reason) => { if (waiving) waive.mutate({ id: waiving.id, reason }, { onSuccess: () => setWaiving(null) }) }}
      />
      <ReasonDialog
        open={resolving !== null}
        onOpenChange={(o) => !o && setResolving(null)}
        title={t("resolve.title")}
        description={t("resolve.description")}
        reasonLabel={t("resolve.reason")}
        confirmLabel={t("resolve.submit")}
        isPending={resolve.isPending}
        error={resolve.error}
        onConfirm={(resolution) => { if (resolving) resolve.mutate({ id: resolving.id, resolution }, { onSuccess: () => setResolving(null) }) }}
      />
    </section>
  );
}
