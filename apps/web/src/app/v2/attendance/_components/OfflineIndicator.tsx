"use client";

import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useOutboxManager, useOutboxStatus } from "@/platform/offline/OutboxProvider";
import { buttonClass } from "@/platform/ui/PageHeader";

/**
 * Indicateur d'état réseau et de la file hors ligne. Annoncé (`role="status"`) : la personne qui fait l'appel sait
 * toujours si ses pointages sont déjà chez le serveur, en attente sur l'appareil, ou à reprendre.
 */
export function OfflineIndicator({ className }: { className?: string }) {
  const t = useTranslations("v2Attendance.offline");
  const format = useFormatter();
  const manager = useOutboxManager();
  const s = useOutboxStatus();

  let tone: "ok" | "info" | "warn" | "bad" = "ok";
  let text = t("upToDate");
  let action: "sync" | "retry" | null = null;

  if (!s.available && s.ready) {
    tone = "warn";
    text = t("noUser");
  } else if (!s.online) {
    tone = "warn";
    text = s.pending.records > 0 || s.pending.calls > 0 ? t("offlinePending", { count: s.pending.records }) : t("offline");
  } else if (s.syncing) {
    tone = "info";
    text = t("syncing");
  } else if (s.failure === "auth") {
    tone = "bad";
    text = t("authExpired", { count: s.pending.records });
  } else if (s.failure && s.pending.calls > 0) {
    tone = "bad";
    text = s.nextRetryAt ? t("failedRetryAt", { count: s.pending.records, time: format.dateTime(new Date(s.nextRetryAt), { timeStyle: "short" }) }) : t("failed", { count: s.pending.records });
    action = "retry";
  } else if (s.pending.calls > 0) {
    tone = "info";
    text = t("pending", { count: s.pending.records });
    action = "sync";
  } else if (s.lastSyncAt) {
    text = t("synced", { time: format.dateTime(new Date(s.lastSyncAt), { timeStyle: "short" }) });
  }

  const palette = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
    info: "border-blue-300 bg-blue-50 text-blue-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    bad: "border-red-300 bg-red-50 text-red-900",
  }[tone];
  const Icon = !s.online ? WifiOff : tone === "bad" || tone === "warn" ? CloudOff : RefreshCw;

  return (
    <div className={cn("space-y-2", className)}>
      <div role="status" aria-live="polite" data-testid="offline-indicator" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm", palette)}>
        <Icon className={cn("h-4 w-4 shrink-0", s.syncing && "animate-spin")} aria-hidden="true" />
        <span className="min-w-0 flex-1">{text}</span>
        {action ? (
          <button type="button" onClick={() => void manager.syncNow()} className={cn(buttonClass.secondary, "h-9 bg-background px-3 sm:h-9")}>
            {action === "retry" ? t("retryNow") : t("syncNow")}
          </button>
        ) : null}
      </div>
      {s.ready && !s.persistent ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("volatile")}
        </p>
      ) : null}
    </div>
  );
}
