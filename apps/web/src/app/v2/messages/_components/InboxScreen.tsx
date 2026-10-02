"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Megaphone, Star } from "lucide-react";
import type { MessagingConversationSummaryDto } from "@ecoledigitale/contracts/v2/messaging";
import { useConversationsInfinite, useMyAudience, useSearchMessages } from "@/platform/v2/messaging";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { cn } from "@/lib/utils";
import { participantsLabel, priorityTone } from "./messaging-utils";

const FOLDERS = ["inbox", "starred", "archived", "sent"] as const;
type Folder = (typeof FOLDERS)[number];

function ConversationRow({ c, folder }: { c: MessagingConversationSummaryDto; folder: Folder }) {
  const t = useTranslations("v2Messaging");
  const date = useDateFormat();
  const system = c.kind === "SYSTEM";
  const who = system ? t("inbox.systemSender") : participantsLabel(c.participants, c.participantCount) || t("inbox.noParticipant");
  const unread = c.unreadCount > 0;
  return (
    <li>
      <Link
        href={`/v2/messages/${c.id}`}
        className={cn("flex gap-3 rounded-lg border p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4", unread && "border-primary/40 bg-primary/5")}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            {unread ? <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" /> : null}
            <p className={cn("truncate text-sm", unread ? "font-bold" : "font-medium")}>{who}</p>
            {c.starred ? <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-label={t("inbox.starred")} /> : null}
            {system ? <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
          </div>
          <p className={cn("truncate text-sm", unread ? "font-semibold" : "")}>{c.subject ?? t("inbox.noSubject")}</p>
          {c.lastPreview ? <p className="truncate text-xs text-muted-foreground">{c.lastPreview}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <time dateTime={c.lastMessageAt ?? undefined}>{date.instant(c.lastMessageAt)}</time>
          <div className="flex flex-wrap justify-end gap-1">
            {c.priority === "HIGH" || c.priority === "URGENT" ? <StatusBadge label={t(`priority.${c.priority}`)} tone={priorityTone(c.priority)} /> : null}
            {unread ? <StatusBadge label={t("inbox.unreadCount", { count: c.unreadCount })} tone="info" /> : null}
            {c.muted ? <StatusBadge label={t("inbox.muted")} /> : null}
            {folder === "sent" && c.broadcastCount !== null ? <StatusBadge label={t("inbox.broadcastCount", { count: c.broadcastCount })} /> : null}
            {c.kind === "GROUP" ? <StatusBadge label={t("inbox.group", { count: c.participantCount })} /> : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Boîte de réception : dossiers, recherche (objet et personnes, ou texte des messages), non-lus, pagination par curseur. */
export function InboxScreen() {
  const t = useTranslations("v2Messaging");
  const audience = useMyAudience();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"people" | "text">("people");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useDebounced(text.trim(), 300);
  const list = useConversationsInfinite({ folder, q: mode === "people" ? q : undefined, unread: unreadOnly }, mode === "people");
  const found = useSearchMessages(q, mode === "text");
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const date = useDateFormat();

  // Le focus ne bouge pas à la frappe ; un changement de dossier remet la recherche de texte à zéro.
  useEffect(() => {
    if (folder !== "inbox" && mode === "text") setMode("people");
  }, [folder, mode]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("inbox.title")}
        description={t("inbox.description")}
        actions={
          audience.data?.canSend ? (
            <Link href="/v2/messages/new" className={buttonClass.primary}>
              {t("inbox.compose")}
            </Link>
          ) : null
        }
      />
      {audience.data?.restricted ? <Notice kind="warning">{t("inbox.restricted")}</Notice> : null}

      <div role="tablist" aria-label={t("inbox.folders")} className="flex flex-wrap gap-1">
        {FOLDERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={folder === f}
            onClick={() => setFolder(f)}
            className={cn("h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9", folder === f ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-accent")}
          >
            {t(`inbox.folder.${f}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="inbox-search">
          {t("inbox.searchLabel")}
        </label>
        <input
          id="inbox-search"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "people" ? t("inbox.searchPeople") : t("inbox.searchText")}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:max-w-sm"
        />
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">{t("inbox.searchMode")}</legend>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="inbox-mode" checked={mode === "people"} onChange={() => setMode("people")} /> {t("inbox.modePeople")}
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="inbox-mode" checked={mode === "text"} onChange={() => setMode("text")} disabled={folder !== "inbox"} /> {t("inbox.modeText")}
          </label>
        </fieldset>
        {mode === "people" ? (
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> {t("inbox.unreadOnly")}
          </label>
        ) : null}
      </div>

      {mode === "text" ? (
        q.length < 2 ? (
          <EmptyBlock title={t("inbox.searchHint")} />
        ) : found.isPending ? (
          <LoadingBlock />
        ) : found.isError ? (
          <ErrorBlock error={found.error} onRetry={() => void found.refetch()} />
        ) : found.data.items.length === 0 ? (
          <EmptyBlock title={t("inbox.noResults")} />
        ) : (
          <ul className="space-y-2" aria-label={t("inbox.results")}>
            {found.data.items.map((h) => (
              <li key={h.messageId}>
                <Link href={`/v2/messages/${h.conversationId}`} className="block rounded-lg border p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="text-sm font-medium">{h.subject ?? t("inbox.noSubject")}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.senderName ?? t("inbox.systemSender")} · {date.instant(h.createdAt)}
                  </p>
                  <p className="mt-1 text-sm">{h.snippet}</p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t(q || unreadOnly ? "inbox.noMatch" : `inbox.empty.${folder}`)} description={q || unreadOnly ? undefined : t("inbox.emptyHint")} />
      ) : (
        <>
          <ul className="space-y-2" aria-label={t("inbox.list")}>
            {items.map((c) => (
              <ConversationRow key={c.id} c={c} folder={folder} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="text-center">
              <button type="button" className={buttonClass.secondary} onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
