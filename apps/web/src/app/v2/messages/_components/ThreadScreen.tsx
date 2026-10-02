"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, BellOff, Bell, ChevronLeft, Flag, Paperclip, Star, Trash2 } from "lucide-react";
import { MESSAGING_REPORT_REASONS, type MessagingAttachmentDto, type MessagingMessageDto } from "@ecoledigitale/contracts/v2/messaging";
import {
  fetchAttachmentUrl,
  useConversation,
  useConversationMessages,
  useLeaveConversation,
  useMarkConversationRead,
  useParticipantState,
  usePostMessage,
  useRemoveMessage,
  useReportMessage,
} from "@/platform/v2/messaging";
import { useDateFormat } from "@/platform/ui/format";
import { FormField } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { cn } from "@/lib/utils";
import { AttachmentPicker } from "./AttachmentPicker";
import { formatBytes, newClientId, priorityTone } from "./messaging-utils";

/** Relecture périodique du fil ouvert (nouveaux messages), tant que l'onglet est visible. */
const POLL_MS = 20_000;

function AttachmentLink({ a }: { a: MessagingAttachmentDto }) {
  const t = useTranslations("v2Messaging.thread");
  const describe = useDescribeError();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function open() {
    setError(null);
    setBusy(true);
    try {
      // URL signée COURTE demandée au clic, jamais conservée.
      const { url } = await fetchAttachmentUrl(a.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <button type="button" onClick={() => void open()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="max-w-[14rem] truncate">{a.fileName}</span>
        <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
        <span className="sr-only">{t("openAttachment")}</span>
      </button>
      {error ? (
        <span role="alert" className="ml-2 text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </li>
  );
}

function ReportDialog({ message, onClose, onDone }: { message: MessagingMessageDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Messaging.report");
  const report = useReportMessage();
  const describe = useDescribeError();
  const [reason, setReason] = useState<(typeof MESSAGING_REPORT_REASONS)[number]>("INAPPROPRIATE");
  const [details, setDetails] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    report.mutate({ messageId: message.id, reason, ...(details.trim() ? { details: details.trim() } : {}) }, { onSuccess: () => { onDone(); onClose(); } });
  }
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormField label={t("reason")} required>
          {(c) => (
            <select {...c} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-10">
              {MESSAGING_REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reasons.${r}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={t("details")} hint={t("detailsHint")}>
          {(c) => <textarea {...c} rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />}
        </FormField>
        {report.error ? (
          <p role="alert" className="text-sm text-destructive">
            {describe(report.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className={buttonClass.danger} disabled={report.isPending}>
            {t("submit")}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

function MessageBubble({ m, onReport, onRemove }: { m: MessagingMessageDto; onReport: () => void; onRemove: () => void }) {
  const t = useTranslations("v2Messaging");
  const date = useDateFormat();
  const system = m.kind === "SYSTEM";
  return (
    <li className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
      <article
        aria-label={`${m.senderName ?? t("inbox.systemSender")}, ${date.instant(m.createdAt)}`}
        className={cn("max-w-[92%] rounded-lg border p-3 text-sm sm:max-w-[75%]", m.mine ? "border-primary/30 bg-primary/10" : system ? "border-amber-300 bg-amber-50" : "bg-background")}
      >
        <header className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{m.mine ? t("common.you") : (m.senderName ?? t("inbox.systemSender"))}</span>
          <time dateTime={m.createdAt}>{date.instant(m.createdAt)}</time>
        </header>
        {m.removed ? (
          <p className="italic text-muted-foreground">{m.removalKind === "MODERATOR" ? t("thread.removedByModerator") : t("thread.removed")}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
        )}
        {m.attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("thread.attachments")}>
            {m.attachments.map((a) => (
              <AttachmentLink key={a.id} a={a} />
            ))}
          </ul>
        ) : null}
        {!m.removed && !system ? (
          <footer className="mt-1 flex justify-end gap-1">
            {m.mine ? (
              <button type="button" className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t("thread.remove")}
              </button>
            ) : (
              <button type="button" className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onReport}>
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                {t("thread.report")}
              </button>
            )}
          </footer>
        ) : null}
      </article>
    </li>
  );
}

/** Fil de conversation : lecture (marquée lue à l'ouverture), réponse, pièces jointes, signalement, archivage, sourdine, favori. */
export function ThreadScreen({ conversationId }: { conversationId: string }) {
  const t = useTranslations("v2Messaging");
  const router = useRouter();
  const describe = useDescribeError();
  const flash = useFlash();
  const detail = useConversation(conversationId);
  const messages = useConversationMessages(conversationId);
  const post = usePostMessage(conversationId);
  const markRead = useMarkConversationRead(conversationId);
  const state = useParticipantState(conversationId);
  const leave = useLeaveConversation(conversationId);
  const remove = useRemoveMessage();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<MessagingAttachmentDto[]>([]);
  const [reporting, setReporting] = useState<MessagingMessageDto | null>(null);
  const [clientId, setClientId] = useState(newClientId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastRead = useRef<number>(-1);

  // Pages accumulées : la première est la plus récente ; on les remet dans l'ordre chronologique.
  const pages = messages.data?.pages ?? [];
  const items = [...pages].reverse().flatMap((p) => p.items);
  const unread = detail.data?.conversation.unreadCount ?? 0;
  const lastSeq = items.length > 0 ? items[items.length - 1]!.seq : 0;

  // Marque le fil lu une fois les messages affichés (un POST explicite : aucun GET n'écrit).
  useEffect(() => {
    if (unread > 0 && lastSeq > 0 && lastRead.current !== lastSeq) {
      lastRead.current = lastSeq;
      markRead.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation stable
  }, [unread, lastSeq]);

  // Nouveaux messages : relecture périodique, onglet visible seulement.
  useEffect(() => {
    const handle = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void messages.refetch();
        void detail.refetch();
      }
    }, POLL_MS);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch stables
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [lastSeq]);

  function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    post.mutate(
      { body: body.trim(), attachmentIds: attachments.map((a) => a.id), clientId },
      {
        onSuccess: () => {
          setBody("");
          setAttachments([]);
          setClientId(newClientId());
        },
      },
    );
  }

  if (detail.isPending || messages.isPending) return <LoadingBlock />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  if (messages.isError) return <ErrorBlock error={messages.error} onRetry={() => void messages.refetch()} />;
  const c = detail.data.conversation;
  const system = c.kind === "SYSTEM";

  return (
    <div className="space-y-4">
      <div>
        <Link href="/v2/messages" className="inline-flex h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("common.back")}
        </Link>
        <header className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold tracking-tight">{c.subject ?? (system ? t("inbox.systemSender") : t("inbox.noSubject"))}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {detail.data.participants
                .map((p) => p.displayName)
                .slice(0, 8)
                .join(", ")}
              {detail.data.participants.length > 8 ? ` +${detail.data.participants.length - 8}` : ""}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.priority === "HIGH" || c.priority === "URGENT" ? <StatusBadge label={t(`priority.${c.priority}`)} tone={priorityTone(c.priority)} /> : null}
              {c.kind === "GROUP" ? <StatusBadge label={t("inbox.group", { count: c.participantCount })} /> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("thread.actions")}>
            <button type="button" className={buttonClass.secondary} aria-pressed={c.starred} onClick={() => state.mutate({ starred: !c.starred })}>
              <Star className={cn("h-4 w-4", c.starred && "fill-amber-400 text-amber-500")} aria-hidden="true" />
              {c.starred ? t("thread.unstar") : t("thread.star")}
            </button>
            <button type="button" className={buttonClass.secondary} aria-pressed={c.muted} onClick={() => state.mutate({ muted: !c.muted })}>
              {c.muted ? <Bell className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
              {c.muted ? t("thread.unmute") : t("thread.mute")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => state.mutate({ archived: !c.archived }, { onSuccess: () => { if (!c.archived) router.push("/v2/messages"); } })}>
              {c.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
              {c.archived ? t("thread.unarchive") : t("thread.archive")}
            </button>
            {c.kind === "GROUP" ? (
              <button type="button" className={buttonClass.ghost} onClick={() => leave.mutate(undefined, { onSuccess: () => router.push("/v2/messages") })}>
                {t("thread.leave")}
              </button>
            ) : null}
          </div>
        </header>
      </div>

      {flash.node}
      {[state.error, leave.error, remove.error].filter(Boolean).map((e, i) => (
        <Notice key={i} kind="error">
          {describe(e)}
        </Notice>
      ))}

      {messages.hasNextPage ? (
        <div className="text-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void messages.fetchNextPage()} disabled={messages.isFetchingNextPage}>
            {messages.isFetchingNextPage ? t("common.loading") : t("thread.older")}
          </button>
        </div>
      ) : null}

      <ol role="log" aria-live="polite" aria-label={t("thread.messages")} className="space-y-3">
        {items.map((m) => (
          <MessageBubble key={m.id} m={m} onReport={() => setReporting(m)} onRemove={() => remove.mutate({ messageId: m.id })} />
        ))}
      </ol>
      <div ref={bottomRef} />

      {system ? (
        <Notice kind="info">{t("thread.systemNoReply")}</Notice>
      ) : detail.data.canReply ? (
        <form onSubmit={send} className="space-y-3 rounded-lg border p-3 sm:p-4" aria-label={t("thread.replyForm")}>
          <label htmlFor="reply-body" className="sr-only">
            {t("thread.replyLabel")}
          </label>
          <textarea
            id="reply-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("thread.replyPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <AttachmentPicker value={attachments} onChange={setAttachments} disabled={post.isPending} />
          {post.error ? (
            <p role="alert" className="text-sm text-destructive">
              {describe(post.error)}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button type="submit" className={buttonClass.primary} disabled={post.isPending || !body.trim()}>
              {post.isPending ? t("common.sending") : t("common.send")}
            </button>
          </div>
        </form>
      ) : (
        <Notice kind="warning">{detail.data.replyBlockedReason ?? t("thread.cannotReply")}</Notice>
      )}

      {reporting ? <ReportDialog message={reporting} onClose={() => setReporting(null)} onDone={() => flash.show(t("report.done"))} /> : null}
    </div>
  );
}
