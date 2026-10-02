"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SchoolLifeConvocationDto } from "@ecoledigitale/contracts/v2/schoollife";
import { useConvocationAction, useConvocations } from "@/platform/v2/schoollife";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary, useFlash } from "@/platform/ui/states";
import { ConvocationFormDialog } from "./forms";
import { StatusLabel, localToIso, useDateTime } from "./shared";

type Pending = { kind: "send" | "hold" | "no-show" | "cancel" | "reschedule"; convocation: SchoolLifeConvocationDto };
const FILTERS = ["", "DRAFT", "SENT", "ACKNOWLEDGED", "HELD", "NO_SHOW", "CANCELLED", "RESCHEDULED"] as const;
const CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"] as const;

/**
 * Convocations des tuteurs : création, envoi (par le module de notifications : une convocation n'est « envoyée » que si la
 * remise est réellement mise en file), accusés de réception des tuteurs, tenue, absence, annulation motivée, report.
 */
export function ConvocationsScreen() {
  const t = useTranslations("v2Schoollife.convocation");
  const ts = useTranslations("v2Schoollife.status");
  const tc = useTranslations("v2Schoollife.channel");
  const dt = useDateTime();
  const flash = useFlash();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [channels, setChannels] = useState<string[]>(["IN_APP", "EMAIL"]);
  const [note, setNote] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [actionError, setActionError] = useState<string | null>(null);
  const q = useConvocations({ status: status || undefined });
  const send = useConvocationAction("send");
  const hold = useConvocationAction("hold");
  const noShow = useConvocationAction("no-show");
  const cancel = useConvocationAction("cancel");
  const reschedule = useConvocationAction("reschedule");
  const close = () => {
    setPending(null);
    setNote("");
    setActionError(null);
  };
  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
            {t("create.open")}
          </button>
        }
      />
      {flash.node}
      <FormField label={t("filter")}>
        {(c) => <NativeSelect {...c} value={status} onChange={setStatus} options={FILTERS.map((s) => ({ value: s, label: s === "" ? t("all") : ts(s) }))} className="max-w-xs" />}
      </FormField>
      <QueryBoundary query={q} isEmpty={rows.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="divide-y rounded-lg border" aria-label={t("listLabel")}>
          {rows.map((c) => (
            <li key={c.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusLabel status={c.status} />
                <span className="font-medium">{c.studentName ?? "—"}</span>
                <span className="text-sm text-muted-foreground">{dt.dateTime(c.scheduledAt)}</span>
                {c.masked || !c.location ? null : <span className="text-sm text-muted-foreground">· {c.location}</span>}
              </div>
              {c.masked ? <p className="text-sm italic text-muted-foreground">{t("masked")}</p> : <p className="text-sm">{c.reason}</p>}
              <p className="text-xs text-muted-foreground">
                {t("convenedBy", { name: c.convenedByName })}
                {c.acknowledgedAt ? ` · ${t("acknowledgedAt", { date: dt.dateTime(c.acknowledgedAt) })}` : ""}
                {c.sentAt ? ` · ${t("sentAt", { date: dt.dateTime(c.sentAt) })}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {c.status === "DRAFT" ? (
                  <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "send", convocation: c })}>
                    {t("actions.send")}
                  </button>
                ) : null}
                {c.status === "SENT" || c.status === "ACKNOWLEDGED" ? (
                  <>
                    <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "hold", convocation: c })}>
                      {t("actions.hold")}
                    </button>
                    <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "no-show", convocation: c })}>
                      {t("actions.noShow")}
                    </button>
                    <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "reschedule", convocation: c })}>
                      {t("actions.reschedule")}
                    </button>
                  </>
                ) : null}
                {c.status === "DRAFT" || c.status === "SENT" || c.status === "ACKNOWLEDGED" ? (
                  <button type="button" className={buttonClass.ghost} onClick={() => setPending({ kind: "cancel", convocation: c })}>
                    {t("actions.cancel")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>

      <ConvocationFormDialog open={creating} onOpenChange={setCreating} onDone={() => flash.show(t("done.created"))} />

      {pending?.kind === "send" ? (
        <FormDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("send.title")}
          description={t("send.description", { student: pending.convocation.studentName ?? "—" })}
          submitLabel={t("send.confirm")}
          isPending={send.isPending}
          error={send.error}
          onSubmit={() => send.mutate({ id: pending.convocation.id, channels }, { onSuccess: () => { flash.show(t("done.sent")); close(); } })}
        >
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("send.channels")}</legend>
            {CHANNELS.map((ch) => (
              <CheckControl key={ch} checked={channels.includes(ch)} label={tc(ch)} onChange={(on) => setChannels(on ? [...channels, ch] : channels.filter((x) => x !== ch))} />
            ))}
            <p className="text-xs text-muted-foreground">{t("send.hint")}</p>
          </fieldset>
        </FormDialog>
      ) : null}

      {pending && (pending.kind === "hold" || pending.kind === "no-show") ? (
        <FormDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t(`outcome.${pending.kind}.title`)}
          submitLabel={t(`outcome.${pending.kind}.confirm`)}
          isPending={hold.isPending || noShow.isPending}
          error={pending.kind === "hold" ? hold.error : noShow.error}
          onSubmit={() => {
            const run = pending.kind === "hold" ? hold : noShow;
            run.mutate(note.trim() ? { id: pending.convocation.id, outcomeNote: note.trim() } : { id: pending.convocation.id }, { onSuccess: () => { flash.show(t(`done.${pending.kind === "hold" ? "held" : "missed"}`)); close(); } });
          }}
        >
          <FormField label={t("outcome.note")}>{(c) => <TextAreaControl {...c} value={note} onChange={setNote} rows={3} maxLength={2000} />}</FormField>
        </FormDialog>
      ) : null}

      {pending?.kind === "cancel" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("cancelDialog.title")}
          description={t("cancelDialog.description")}
          reasonLabel={t("cancelDialog.label")}
          confirmLabel={t("cancelDialog.confirm")}
          destructive
          isPending={cancel.isPending}
          error={cancel.error}
          onConfirm={(reason) => cancel.mutate({ id: pending.convocation.id, reason }, { onSuccess: () => { flash.show(t("done.cancelled")); close(); } })}
        />
      ) : null}

      {pending?.kind === "reschedule" ? (
        <FormDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("rescheduleDialog.title")}
          description={t("rescheduleDialog.description")}
          submitLabel={t("rescheduleDialog.confirm")}
          isPending={reschedule.isPending}
          error={reschedule.error}
          onSubmit={() => {
            if (!rescheduleDate) return setActionError(t("rescheduleDialog.dateRequired"));
            setActionError(null);
            reschedule.mutate({ id: pending.convocation.id, scheduledAt: localToIso(`${rescheduleDate}T${rescheduleTime || "09:00"}`) }, { onSuccess: () => { flash.show(t("done.rescheduled")); close(); } });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("create.scheduledDate")} required error={actionError}>
              {(c) => <TextControl {...c} type="date" value={rescheduleDate} onChange={setRescheduleDate} />}
            </FormField>
            <FormField label={t("create.scheduledTime")} required>
              {(c) => <TextControl {...c} type="time" value={rescheduleTime} onChange={setRescheduleTime} />}
            </FormField>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
