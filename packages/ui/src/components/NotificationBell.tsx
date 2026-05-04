"use client";

import * as React from "react";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { cn } from "../utils";

/**
 * Headless presentation component for the in-app notifications bell.
 *
 * Each app supplies its own data hook (typically SWR/React Query against the
 * /api/v1/notifications-inbox endpoints) and passes the result in via props.
 * The component owns open/close state and click-outside dismissal but stays
 * dumb about how data is fetched.
 */

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationBellProps {
  notifications: NotificationItem[];
  unreadCount: number;
  loading?: boolean;
  onMarkRead: (id: string) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
  /** Optional locale for relative-time formatting. Defaults to fr-FR. */
  locale?: string;
  /** Optional CTA when there are no notifications. */
  emptyState?: React.ReactNode;
  className?: string;
}

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onOutside: () => void,
  enabled: boolean
) {
  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside, enabled]);
}

export function NotificationBell({
  notifications,
  unreadCount,
  loading = false,
  onMarkRead,
  onMarkAllRead,
  locale = "fr-FR",
  emptyState,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const handleItemClick = async (n: NotificationItem) => {
    if (!n.readAt) {
      await onMarkRead(n.id);
    }
    if (n.actionUrl) {
      // Use a same-tab navigation; the consumer can intercept actionUrl rendering
      // via emptyState or by overriding the click behaviour at the wrapper level
      // if they need router-aware navigation.
      window.location.href = n.actionUrl;
    }
  };

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} non lue${unreadCount > 1 ? "s" : ""})`
            : "Notifications"
        }
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute right-0 z-50 mt-2 w-[22rem] origin-top-right rounded-lg border bg-popover text-popover-foreground shadow-lg",
            "max-h-[28rem] overflow-hidden flex flex-col"
          )}
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => onMarkAllRead()}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {emptyState ?? "Aucune notification pour l'instant."}
              </div>
            )}

            <ul className="divide-y">
              {notifications.map((n) => {
                const unread = !n.readAt;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={cn(
                        "w-full text-left px-4 py-3 transition-colors",
                        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                        unread && "bg-accent/30"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {unread && (
                          <span
                            aria-hidden="true"
                            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500"
                          />
                        )}
                        <div className={cn("flex-1 min-w-0", !unread && "pl-4")}>
                          <p
                            className={cn(
                              "text-sm leading-snug",
                              unread ? "font-semibold text-foreground" : "text-foreground"
                            )}
                          >
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                          )}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {relativeTime(n.createdAt, locale)}
                          </p>
                        </div>
                        {!unread && (
                          <Check
                            className="mt-1 h-3.5 w-3.5 text-muted-foreground/60"
                            aria-label="Lu"
                          />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
