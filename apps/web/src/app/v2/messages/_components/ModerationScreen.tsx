"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { messagingSuperviseMessagesDtoSchema, MessagingConversationSummaryDto, MessagingReportDto } from "@ecoledigitale/contracts/v2/messaging";
import { usePermission } from "@/platform/access";
import {
  superviseRead,
  useDecideReport,
  useLiftRestriction,
  useReportContext,
  useReports,
  useRestrictions,
  useSuperviseConversations,
} from "@/platform/v2/messaging";
import { useDescribeError } from "@/platform/ui/errors";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, AntSelect } from "@/platform/ui/FormField";
import { ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { cn } from "@/lib/utils";

const TABS = ["reports", "restrictions", "supervision"] as const;
type Tab = (typeof TABS)[number];
type Supervised = z.infer<typeof messagingSuperviseMessagesDtoSchema>;

function ReportReview({ report, canDecide, onClose, onDone }: { report: MessagingReportDto; canDecide: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useTranslations("v2MessagingModeration");
  const date = useDateFormat();
  const describe = useDescribeError();
  const context = useReportContext(report.id);
  const decide = useDecideReport();
  const [decision, setDecision] = useState<"DISMISS" | "ACTION">("ACTION");
  const [note, setNote] = useState("");
  const [removeMessage, setRemoveMessage] = useState(true);
  const [restrict, setRestrict] = useState(false);
  const [days, setDays] = useState<string>("7");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setError(t("noteRequired"));
    if (decision === "ACTION" && !removeMessage && !restrict) return setError(t("actionRequired"));
    setError(null);
    decide.mutate(
      {
        id: report.id,
        decision,
        note: note.trim(),
        removeMessage: decision === "ACTION" && removeMessage,
        ...(decision === "ACTION" && restrict ? { restrictSender: { untilDays: days === "forever" ? null : Number(days) } } : {}),
      },
      { onSuccess: () => { onDone(t("decided")); onClose(); } },
    );
  }

  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("reviewTitle")} description={t("reviewDescription")} className="sm:max-w-2xl">
      {context.isPending ? (
        <LoadingBlock />
      ) : context.isError ? (
        <ErrorBlock error={context.error} onRetry={() => void context.refetch()} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{t(`reasons.${report.reason}`)}</strong> — {report.reporterName ?? t("unknownUser")}
            {report.details ? <span className="block text-muted-foreground">« {report.details} »</span> : null}
          </p>
          <ul className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2" aria-label={t("contextMessages")}>
            {context.data.messages.map((m) => (
              <li key={m.id} className={cn("rounded border p-2 text-sm", m.id === report.messageId && "border-destructive bg-destructive/5")}>
                <p className="text-xs text-muted-foreground">
                  {m.senderName ?? t("system")} · {date.instant(m.createdAt)}
                  {m.removed ? ` · ${t("removed")}` : ""}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.rawBody}</p>
              </li>
            ))}
          </ul>
          {report.status !== "OPEN" ? (
            <Notice kind="info">{t("alreadyDecided", { note: report.decisionNote ?? "" })}</Notice>
          ) : canDecide ? (
            <form onSubmit={submit} className="space-y-3" noValidate>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="sr-only">{t("decision")}</legend>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="decision" checked={decision === "ACTION"} onChange={() => setDecision("ACTION")} /> {t("action")}
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="decision" checked={decision === "DISMISS"} onChange={() => setDecision("DISMISS")} /> {t("dismiss")}
                </label>
              </fieldset>
              {decision === "ACTION" ? (
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={removeMessage} onChange={(e) => setRemoveMessage(e.target.checked)} /> {t("removeMessage")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} /> {t("restrictSender")}
                  </label>
                  {restrict ? (
                    <AntSelect aria-label={t("restrictDuration")} value={days} onChange={(e) => setDays(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                      {["1", "7", "30", "90", "forever"].map((d) => (
                        <option key={d} value={d}>
                          {d === "forever" ? t("untilLifted") : t("days", { count: Number(d) })}
                        </option>
                      ))}
                    </AntSelect>
                  ) : null}
                </div>
              ) : null}
              <FormField label={t("note")} required hint={t("noteHint")}>
                {(c) => <textarea {...c} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />}
              </FormField>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              {decide.error ? <p role="alert" className="text-sm text-destructive">{describe(decide.error)}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" className={buttonClass.secondary} onClick={onClose}>
                  {t("close")}
                </button>
                <button type="submit" className={decision === "ACTION" ? buttonClass.danger : buttonClass.primary} disabled={decide.isPending}>
                  {t("confirm")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </ModalDialog>
  );
}

function ReportsTab({ canDecide, onFlash }: { canDecide: boolean; onFlash: (m: string) => void }) {
  const t = useTranslations("v2MessagingModeration");
  const date = useDateFormat();
  const [status, setStatus] = useState<"OPEN" | undefined>("OPEN");
  const reports = useReports(status);
  const [review, setReview] = useState<MessagingReportDto | null>(null);
  const items = reports.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="space-y-3" aria-label={t("tabs.reports")}>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={status === "OPEN"} onChange={(e) => setStatus(e.target.checked ? "OPEN" : undefined)} /> {t("onlyOpen")}
      </label>
      {reports.isPending ? (
        <LoadingBlock />
      ) : reports.isError ? (
        <ErrorBlock error={reports.error} onRetry={() => void reports.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t("noReports")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t(`reasons.${r.reason}`)} <StatusBadge label={t(`status.${r.status}`)} tone={r.status === "OPEN" ? "warning" : r.status === "ACTIONED" ? "danger" : "neutral"} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.reporterName ?? t("unknownUser")} · {date.instant(r.createdAt)}
                </p>
              </div>
              <button type="button" className={buttonClass.secondary} onClick={() => setReview(r)}>
                {r.status === "OPEN" && canDecide ? t("review") : t("see")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {reports.hasNextPage ? (
        <button type="button" className={buttonClass.secondary} onClick={() => void reports.fetchNextPage()}>
          {t("loadMore")}
        </button>
      ) : null}
      {review ? <ReportReview report={review} canDecide={canDecide} onClose={() => setReview(null)} onDone={onFlash} /> : null}
    </section>
  );
}

function RestrictionsTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2MessagingModeration");
  const date = useDateFormat();
  const list = useRestrictions();
  const lift = useLiftRestriction();
  return (
    <section className="space-y-3" aria-label={t("tabs.restrictions")}>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyBlock title={t("noRestrictions")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.data.map((r) => (
            <li key={r.userId} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.displayName ?? r.userId}</p>
                <p className="text-xs text-muted-foreground">
                  {r.restrictedUntil ? t("until", { date: date.instant(r.restrictedUntil) }) : t("untilLifted")} · {r.reason}
                </p>
              </div>
              {canManage ? (
                <button type="button" className={buttonClass.secondary} disabled={lift.isPending} onClick={() => lift.mutate({ userId: r.userId })}>
                  {t("lift")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {lift.error ? <ErrorBlock error={lift.error} /> : null}
    </section>
  );
}

function SupervisionTab() {
  const t = useTranslations("v2MessagingModeration");
  const date = useDateFormat();
  const describe = useDescribeError();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useSuperviseConversations(q);
  const [asking, setAsking] = useState<MessagingConversationSummaryDto | null>(null);
  const [reading, setReading] = useState<{ conversation: MessagingConversationSummaryDto; data: Supervised } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  async function read(reason: string) {
    if (!asking) return;
    setError(null);
    try {
      const data = await superviseRead(asking.id, reason);
      setReading({ conversation: asking, data });
      setAsking(null);
    } catch (e) {
      setError(describe(e));
      setAsking(null);
    }
  }

  return (
    <section className="space-y-3" aria-label={t("tabs.supervision")}>
      <Notice kind="info">{t("superviseNotice")}</Notice>
      <label className="block">
        <span className="sr-only">{t("search")}</span>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("search")} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-10 sm:max-w-sm" />
      </label>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t("noConversations")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.subject ?? t("noSubject")}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.participants.map((p) => p.displayName).join(", ")} · {date.instant(c.lastMessageAt)}
                </p>
              </div>
              <button type="button" className={buttonClass.secondary} onClick={() => setAsking(c)}>
                {t("readWithReason")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <button type="button" className={buttonClass.secondary} onClick={() => void list.fetchNextPage()}>
          {t("loadMore")}
        </button>
      ) : null}
      <ReasonDialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title={t("reasonTitle")}
        description={t("reasonDescription")}
        reasonLabel={t("reasonLabel")}
        confirmLabel={t("reasonConfirm")}
        minLength={3}
        onConfirm={read}
      />
      {reading ? (
        <ModalDialog open onOpenChange={(o) => !o && setReading(null)} title={reading.conversation.subject ?? t("noSubject")} description={t("readOnly")} className="sm:max-w-2xl">
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto" aria-label={t("contextMessages")}>
            {reading.data.items.map((m) => (
              <li key={m.id} className="rounded border p-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {m.senderName ?? t("system")} · {date.instant(m.createdAt)}
                  {m.removed ? ` · ${t("removed")}` : ""}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.rawBody}</p>
              </li>
            ))}
          </ul>
        </ModalDialog>
      ) : null}
    </section>
  );
}

/** Modération : signalements, restrictions d'envoi, supervision motivée (chaque lecture de contenu est auditée par le serveur). */
export function ModerationScreen() {
  const t = useTranslations("v2MessagingModeration");
  const flash = useFlash();
  const canManage = usePermission("messaging.moderation.manage").allowed;
  const canSupervise = usePermission("messaging.moderation.supervise").allowed;
  const [tab, setTab] = useState<Tab>("reports");
  const tabs = TABS.filter((x) => x !== "supervision" || canSupervise);
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-1">
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cn("h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9", tab === x ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-accent")}>
            {t(`tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === "reports" ? <ReportsTab canDecide={canManage} onFlash={flash.show} /> : null}
      {tab === "restrictions" ? <RestrictionsTab canManage={canManage} /> : null}
      {tab === "supervision" && canSupervise ? <SupervisionTab /> : null}
    </div>
  );
}
