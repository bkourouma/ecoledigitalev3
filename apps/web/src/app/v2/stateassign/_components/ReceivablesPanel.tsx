"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AssignmentDetailDto, ReceivableDto } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { useCancelReceivable, useReceivableHistory, useScheduleReceivable, useUpdateReceivable } from "@/platform/v2/stateassign";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { PERM, RECEIVABLE_TONE, isIsoDate } from "./stateassign-utils";

function ScheduleDialog({ assignmentId, open, onOpenChange, existing }: { assignmentId: string; open: boolean; onOpenChange: (o: boolean) => void; existing?: ReceivableDto }) {
  const t = useTranslations("v2Stateassign.receivables.form");
  const create = useScheduleReceivable();
  const update = useUpdateReceivable();
  const mutation = existing ? update : create;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? "");
  const [amount, setAmount] = useState(existing ? String(existing.expected.amount) : "");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const parsed = parseAmountInput(amount);
  const problems = { label: label.trim() ? null : t("errors.label"), date: isIsoDate(dueOn) ? null : t("errors.date"), amount: parsed.ok ? null : t("errors.amount") };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? t("editTitle") : t("title")}
      description={t("description")}
      submitLabel={existing ? t("save") : t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.values(problems).some(Boolean) || !parsed.ok) return;
        if (existing) update.mutate({ id: existing.id, label: label.trim(), dueOn, expectedAmount: parsed.amount, rowVersion: existing.rowVersion }, { onSuccess: () => onOpenChange(false) });
        else create.mutate({ assignmentId, body: { label: label.trim(), dueOn, expectedAmount: parsed.amount } }, { onSuccess: () => onOpenChange(false) });
      }}
    >
      <FormField label={t("label")} required error={submitted ? problems.label : (errors.label ?? null)}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}</FormField>
      <FormField label={t("dueOn")} required error={submitted ? problems.date : (errors.dueOn ?? null)}>{(c) => <TextControl {...c} type="date" value={dueOn} onChange={setDueOn} />}</FormField>
      <FormField label={t("amount")} required hint={t("amountHint")} error={submitted ? problems.amount : (errors.expectedAmount ?? null)}>{(c) => <TextControl {...c} inputMode="numeric" value={amount} onChange={setAmount} />}</FormField>
    </FormDialog>
  );
}

function HistoryDialog({ receivable, open, onOpenChange }: { receivable: ReceivableDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Stateassign.receivables.history");
  const tAction = useTranslations("v2Stateassign.receivables.history.actions");
  const date = useDateFormat();
  const money = useMoney();
  const history = useReceivableHistory(open ? receivable.id : null);
  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title", { label: receivable.label })} className="sm:max-w-2xl">
      {history.isPending ? <LoadingBlock /> : null}
      {history.isError ? <ErrorBlock error={history.error} onRetry={() => void history.refetch()} /> : null}
      {history.data ? (
        <ol className="space-y-2" aria-label={t("list")}>
          {history.data.map((e) => (
            <li key={e.id} className="rounded-md border p-2 text-sm">
              <p className="font-medium">{tAction(e.action)}</p>
              <p className="text-xs text-muted-foreground">
                {date.instant(e.occurredAt)} · {t(`actor.${e.actorKind ?? "unknown"}`)}
                {e.fromAmount || e.toAmount ? ` · ${money.of(e.fromAmount)} → ${money.of(e.toAmount)}` : ""}
                {e.reason ? ` · ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </ModalDialog>
  );
}

/** Créances sur l'État d'un dossier : échéances attendues, montants reçus (rapprochés avec `finance`), retards, historique. */
export function ReceivablesPanel({ detail }: { detail: AssignmentDetailDto }) {
  const t = useTranslations("v2Stateassign.receivables");
  const tStatus = useTranslations("v2Stateassign.receivableStatus");
  const date = useDateFormat();
  const money = useMoney();
  const canManage = usePermission(PERM.receivableManage).allowed;
  const cancel = useCancelReceivable();
  const [scheduling, setScheduling] = useState(false);
  const [editing, setEditing] = useState<ReceivableDto | null>(null);
  const [cancelling, setCancelling] = useState<ReceivableDto | null>(null);
  const [history, setHistory] = useState<ReceivableDto | null>(null);
  const a = detail.assignment;
  const operational = a.status === "VERIFIED" || a.status === "ACTIVE" || a.status === "SUSPENDED";
  const s = detail.receivablesSummary;

  const columns = useMemo<DataTableColumn<ReceivableDto>[]>(
    () => [
      { id: "seq", header: t("columns.seq"), rowHeader: true, cell: (r) => `${r.seq}. ${r.label}` },
      { id: "due", header: t("columns.dueOn"), cell: (r) => date.civil(r.dueOn) },
      { id: "expected", header: t("columns.expected"), align: "right", cell: (r) => money.of(r.expected) },
      { id: "received", header: t("columns.received"), align: "right", cell: (r) => money.of(r.received) },
      { id: "outstanding", header: t("columns.outstanding"), align: "right", className: "hidden md:table-cell", cell: (r) => money.of(r.outstanding) },
      {
        id: "status",
        header: t("columns.status"),
        cell: (r) => (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge label={tStatus(r.status)} tone={RECEIVABLE_TONE[r.status]} />
            {r.overdue ? <StatusBadge label={t("overdue", { days: r.daysOverdue })} tone="danger" /> : null}
          </span>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("columns.actions")}</span>,
        cell: (r) => (
          <span className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setHistory(r)} className={buttonClass.ghost}>
              {t("actions.history")}
              <span className="sr-only"> — {r.label}</span>
            </button>
            {canManage && r.status !== "CANCELLED" ? (
              <>
                <button type="button" onClick={() => setEditing(r)} className={buttonClass.ghost}>
                  {t("actions.edit")}
                  <span className="sr-only"> — {r.label}</span>
                </button>
                {r.status === "OPEN" ? (
                  <button type="button" onClick={() => setCancelling(r)} className={buttonClass.ghost}>
                    {t("actions.cancel")}
                    <span className="sr-only"> — {r.label}</span>
                  </button>
                ) : null}
              </>
            ) : null}
          </span>
        ),
      },
    ],
    [t, tStatus, date, money, canManage],
  );

  return (
    <section aria-labelledby="receivables-title" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="receivables-title" className="text-base font-semibold">{t("title")}</h2>
        {canManage && operational ? <button type="button" onClick={() => setScheduling(true)} className={buttonClass.secondary}>{t("schedule")}</button> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-5">
        <div><dt className="text-xs text-muted-foreground">{t("summary.expected")}</dt><dd>{money.of(s.expected)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("summary.received")}</dt><dd>{money.of(s.received)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("summary.outstanding")}</dt><dd>{money.of(s.outstanding)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("summary.overdue")}</dt><dd>{money.of(s.overdue)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("summary.unscheduled")}</dt><dd>{s.unscheduled ? money.of(s.unscheduled) : "—"}</dd></div>
      </dl>
      <DataTable caption={t("caption")} columns={columns} rows={detail.receivables} getRowId={(r) => r.id} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      {scheduling ? <ScheduleDialog assignmentId={a.id} open onOpenChange={(o) => !o && setScheduling(false)} /> : null}
      {editing ? <EditReceivable receivable={editing} onClose={() => setEditing(null)} /> : null}
      {history ? <HistoryDialog receivable={history} open onOpenChange={(o) => !o && setHistory(null)} /> : null}
      <ReasonDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("cancel.title")}
        description={t("cancel.description")}
        reasonLabel={t("cancel.reason")}
        confirmLabel={t("cancel.submit")}
        destructive
        isPending={cancel.isPending}
        error={cancel.error}
        onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason, rowVersion: cancelling.rowVersion }, { onSuccess: () => setCancelling(null) })}
      />
    </section>
  );
}

function EditReceivable({ receivable, onClose }: { receivable: ReceivableDto; onClose: () => void }) {
  return <ScheduleDialog assignmentId={receivable.assignmentId} open onOpenChange={(o) => !o && onClose()} existing={receivable} />;
}
