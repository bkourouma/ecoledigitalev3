"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useLatestNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, useUnreadSummary } from "@/platform/v2/messaging";
import { useDateFormat } from "@/platform/ui/format";
import { ErrorBlock } from "@/platform/ui/states";
import { buttonClass } from "@/platform/ui/PageHeader";
import { READ_PERMISSIONS } from "./messaging-utils";

/**
 * Cloche de notifications : compteur de non-lus relu toutes les 30 s, menu des cinq dernières notifications, lecture d'une
 * notification au clic, « tout marquer comme lu ». Le menu est un bouton à `aria-expanded` (Échap ferme, le focus revient).
 * Montable dans n'importe quelle coquille (`<NotificationBell />`) ; ne s'affiche que si l'utilisateur peut lire sa messagerie.
 */
export function NotificationBell() {
  const t = useTranslations("v2Messaging.bell");
  const date = useDateFormat();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- liste constante
  const allowed = READ_PERMISSIONS.map((p) => usePermission(p).allowed).some(Boolean);
  const unread = useUnreadSummary(allowed);
  const latest = useLatestNotifications(allowed && open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!allowed) return null;
  const count = unread.data?.notifications ?? 0;
  const label = t("count", { count });

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${t("open")} — ${label}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md border border-input bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:w-10"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {count > 0 ? (
          <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      {/* Annonce vocale du compteur (changements de la cloche). */}
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
      {open ? (
        <div id={panelId} role="region" aria-label={t("label")} className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-background p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("label")}</h2>
            {count > 0 ? (
              <button type="button" className="text-xs font-medium text-primary hover:underline" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
                {t("markAll")}
              </button>
            ) : null}
          </div>
          {latest.isPending ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("loading")}</p>
          ) : latest.isError ? (
            <ErrorBlock error={latest.error} onRetry={() => void latest.refetch()} />
          ) : latest.data.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto">
              {latest.data.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? "/v2/messages/notifications"}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate({ id: n.id });
                      setOpen(false);
                    }}
                    className="block rounded-md px-2 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className={n.readAt ? "text-sm" : "text-sm font-semibold"}>
                      {n.title}
                      {n.occurrences > 1 ? <span className="ml-1 text-xs font-normal text-muted-foreground">({n.occurrences})</span> : null}
                    </p>
                    {n.body ? <p className="truncate text-xs text-muted-foreground">{n.body}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">{date.instant(n.updatedAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 border-t pt-2 text-right">
            <Link href="/v2/messages/notifications" onClick={() => setOpen(false)} className={buttonClass.ghost}>
              {t("seeAll")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
