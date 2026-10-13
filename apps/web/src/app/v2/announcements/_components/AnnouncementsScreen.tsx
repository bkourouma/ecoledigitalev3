"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Pin } from "lucide-react";
import { MESSAGING_ANNOUNCEMENT_STATUSES, type MessagingAnnouncementDto } from "@ecoledigitale/contracts/v2/messaging";
import { useAnnouncementsInfinite, useMyAudience } from "@/platform/v2/messaging";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { cn } from "@/lib/utils";
import { priorityTone } from "../../messages/_components/messaging-utils";
import { AntSelect } from "@/platform/ui/FormField";

function AnnouncementRow({ a, managed }: { a: MessagingAnnouncementDto; managed: boolean }) {
  const t = useTranslations("v2MessagingAnnouncements");
  const tp = useTranslations("v2Messaging.priority");
  const date = useDateFormat();
  const unread = a.isRecipient && a.myReadAt === null && a.status === "PUBLISHED" && !a.expired;
  const pendingAck = a.isRecipient && a.requireAck && a.myAcknowledgedAt === null && a.status === "PUBLISHED";
  return (
    <li>
      <Link href={`/v2/announcements/${a.id}`} className={cn("block rounded-lg border p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4", unread && "border-primary/40 bg-primary/5")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn("flex items-center gap-2 text-sm", unread ? "font-bold" : "font-medium")}>
              {a.pinned ? <Pin className="h-4 w-4 shrink-0 text-amber-600" aria-label={t("pinned")} /> : null}
              {unread ? <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" /> : null}
              <span className="break-words">{a.title}</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 text-xs">
            {a.priority !== "NORMAL" ? <StatusBadge label={tp(a.priority)} tone={priorityTone(a.priority)} /> : null}
            {a.expired ? <StatusBadge label={t("expired")} /> : null}
            {managed || a.status !== "PUBLISHED" ? <StatusBadge label={t(`status.${a.status}`)} tone={a.status === "PUBLISHED" ? "success" : a.status === "WITHDRAWN" ? "danger" : "warning"} /> : null}
            {pendingAck ? <StatusBadge label={t("ackPending")} tone="warning" /> : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {a.authorName} · {date.instant(a.publishedAt ?? a.publishAt)}
          {managed && a.stats ? ` · ${t("statsLine", { recipients: a.stats.recipients, read: a.stats.read, acknowledged: a.stats.acknowledged })}` : ""}
        </p>
      </Link>
    </li>
  );
}

/** Annonces : boîte du destinataire (non expirées) et, pour les publieurs, leurs annonces avec statistiques. */
export function AnnouncementsScreen() {
  const t = useTranslations("v2MessagingAnnouncements");
  const audience = useMyAudience();
  const canPublish = audience.data?.canPublishAnnouncements === true;
  const [scope, setScope] = useState<"inbox" | "managed">("inbox");
  const [status, setStatus] = useState<"" | (typeof MESSAGING_ANNOUNCEMENT_STATUSES)[number]>("");
  const [includeExpired, setIncludeExpired] = useState(false);
  const [unread, setUnread] = useState(false);
  const list = useAnnouncementsInfinite({ scope, status: status || undefined, includeExpired, unread: scope === "inbox" ? unread : undefined }, scope === "inbox" || canPublish);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canPublish ? (
            <Link href="/v2/announcements/new" className={buttonClass.primary}>
              {t("new")}
            </Link>
          ) : null
        }
      />
      {canPublish ? (
        <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-1">
          {(["inbox", "managed"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={cn("h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9", scope === s ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-accent")}>
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {scope === "managed" ? (
          <label className="inline-flex items-center gap-2">
            {t("filterStatus")}
            <AntSelect value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">{t("allStatuses")}</option>
              {MESSAGING_ANNOUNCEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </AntSelect>
          </label>
        ) : (
          <>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> {t("unreadOnly")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} /> {t("includeExpired")}
            </label>
          </>
        )}
      </div>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t(scope === "inbox" ? "empty" : "emptyManaged")} description={scope === "inbox" ? t("emptyHint") : undefined} />
      ) : (
        <>
          <ul className="space-y-2" aria-label={t("list")}>
            {items.map((a) => (
              <AnnouncementRow key={a.id} a={a} managed={scope === "managed"} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="text-center">
              <button type="button" className={buttonClass.secondary} onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {t("loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
