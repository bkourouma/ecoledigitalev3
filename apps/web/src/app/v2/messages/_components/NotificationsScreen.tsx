"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MESSAGING_EXTERNAL_CHANNELS, type MessagingPreferenceDto } from "@ecoledigitale/contracts/v2/messaging";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useMyPreferences, useNotificationsInfinite, useUpdatePreferences } from "@/platform/v2/messaging";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { isoToLocal, localToIso } from "./messaging-utils";

function PreferencesForm({ initial }: { initial: ReadonlyArray<MessagingPreferenceDto> }) {
  const t = useTranslations("v2Messaging.notifications");
  const describe = useDescribeError();
  const flash = useFlash();
  const update = useUpdatePreferences();
  const [draft, setDraft] = useState<MessagingPreferenceDto[]>(() => initial.map((p) => ({ ...p, externalChannels: [...p.externalChannels] })));
  const patch = (category: MessagingPreferenceDto["category"], next: Partial<MessagingPreferenceDto>) => setDraft((cur) => cur.map((p) => (p.category === category ? { ...p, ...next } : p)));

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ preferences: draft.map((p) => ({ category: p.category, inApp: p.inApp, externalChannels: p.externalChannels, mutedUntil: p.mutedUntil })) }, { onSuccess: () => flash.show(t("prefsSaved")) });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={t("prefsTitle")}>
      <p className="text-sm text-muted-foreground">{t("prefsHint")}</p>
      {draft.map((p) => (
        <fieldset key={p.category} className="space-y-2 rounded-lg border p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold">{t(`categories.${p.category}`)}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={p.inApp} onChange={(e) => patch(p.category, { inApp: e.target.checked })} /> {t("inApp")}
          </label>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("external")}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {MESSAGING_EXTERNAL_CHANNELS.map((ch) => (
                <label key={ch} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={p.externalChannels.includes(ch)} onChange={(e) => patch(p.category, { externalChannels: e.target.checked ? [...p.externalChannels, ch] : p.externalChannels.filter((x) => x !== ch) })} /> {t(`channels.${ch}`)}
                </label>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("mutedUntil")}</span>
            <input type="datetime-local" value={isoToLocal(p.mutedUntil)} onChange={(e) => patch(p.category, { mutedUntil: localToIso(e.target.value) ?? null })} className="h-10 rounded-md border border-input bg-background px-3 text-sm" />
          </label>
        </fieldset>
      ))}
      {flash.node}
      {update.error ? <Notice kind="error">{describe(update.error)}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("prefsSave")}
      </button>
    </form>
  );
}

/** Notifications in-app (liste, lecture, tout lire) et préférences de notification de l'utilisateur. */
export function NotificationsScreen() {
  const t = useTranslations("v2Messaging.notifications");
  const date = useDateFormat();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useNotificationsInfinite(unreadOnly);
  const prefs = useMyPreferences();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          unread > 0 ? (
            <button type="button" className={buttonClass.secondary} onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              {t("markAll")}
            </button>
          ) : null
        }
      />
      <section aria-labelledby="notif-list" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="notif-list" className="text-lg font-semibold">
            {t("listTitle")} {unread > 0 ? <StatusBadge label={t("unread", { count: unread })} tone="info" /> : null}
          </h2>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> {t("unreadOnly")}
          </label>
        </div>
        {list.isPending ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyBlock title={unreadOnly ? t("noneUnread") : t("none")} />
        ) : (
          <>
            <ul className="divide-y rounded-lg border" aria-label={t("listTitle")}>
              {items.map((n) => (
                <li key={n.id} className={n.readAt ? "" : "bg-primary/5"}>
                  <div className="flex items-start gap-3 p-3 sm:p-4">
                    <div className="min-w-0 flex-1">
                      <p className={n.readAt ? "text-sm" : "text-sm font-semibold"}>
                        {n.link ? (
                          <Link href={n.link} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { if (!n.readAt) markRead.mutate({ id: n.id }); }}>
                            {n.title}
                          </Link>
                        ) : (
                          n.title
                        )}
                        {n.occurrences > 1 ? <span className="ml-1 text-xs font-normal text-muted-foreground">({n.occurrences})</span> : null}
                      </p>
                      {n.body ? <p className="text-xs text-muted-foreground">{n.body}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(`categories.${n.category}`)} · {date.instant(n.updatedAt)}
                      </p>
                    </div>
                    {!n.readAt ? (
                      <button type="button" className={buttonClass.ghost} onClick={() => markRead.mutate({ id: n.id })}>
                        {t("markRead")}
                      </button>
                    ) : null}
                  </div>
                </li>
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
      </section>
      <section aria-labelledby="notif-prefs" className="space-y-3">
        <h2 id="notif-prefs" className="text-lg font-semibold">
          {t("prefsTitle")}
        </h2>
        {prefs.isPending ? <LoadingBlock /> : prefs.isError ? <ErrorBlock error={prefs.error} onRetry={() => void prefs.refetch()} /> : <PreferencesForm key={JSON.stringify(prefs.data.items)} initial={prefs.data.items} />}
      </section>
    </div>
  );
}
