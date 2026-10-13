"use client";

import { CheckCircle2, CloudOff, Loader2, AlertTriangle, WifiOff } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useGradeSync, useGradeSyncStatus } from "@/platform/offline/GradeSyncProvider";
import { describeSync } from "@/platform/offline/grade-sync-status";
import { buttonClass } from "@/platform/ui/PageHeader";

/**
 * Statut de synchronisation des notes de CETTE évaluation : en attente / synchronisé / conflit / échec (et hors ligne, envoi en cours,
 * session expirée, évaluation figée, file locale pleine). Zone `role="status"` `aria-live="polite"` : le changement d'état est annoncé aux
 * lecteurs d'écran sans interrompre la saisie ; le texte porte l'information (jamais la seule couleur). Rien n'est rendu hors fournisseur.
 */
export function GradeSyncIndicator({ assessmentId, className, onDiscard }: { assessmentId: string; className?: string; onDiscard?: () => void }) {
  const t = useTranslations("v2Offline.grades");
  const format = useFormatter();
  const manager = useGradeSync();
  const status = useGradeSyncStatus();
  if (!manager) return null;

  const d = describeSync(status, assessmentId);
  const time = (iso: string | number) => format.dateTime(new Date(iso), { timeStyle: "short" });
  let text: string;
  switch (d.kind) {
    case "synced":
      text = t("synced", { time: time(d.syncedAt as string) });
      break;
    case "failed":
      text = d.nextRetryAt ? t("failedRetryAt", { count: d.count, time: time(d.nextRetryAt) }) : t("failed", { count: d.count });
      break;
    case "idle":
      text = t("idle");
      break;
    default:
      text = t(d.kind, { count: d.count });
  }

  const palette = {
    ok: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    info: "border-sky-400/40 bg-sky-400/10 text-sky-200",
    warn: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    bad: "border-red-400/40 bg-red-400/10 text-red-200",
  }[d.tone];
  const Icon = d.kind === "offline" ? WifiOff : d.kind === "syncing" ? Loader2 : d.tone === "ok" ? CheckCircle2 : d.tone === "bad" ? AlertTriangle : CloudOff;
  const draft = status.drafts.find((x) => x.assessmentId === assessmentId);
  const canDiscard = Boolean(onDiscard) && (d.kind === "locked" || d.kind === "failed");

  return (
    <div className={cn("space-y-2", className)}>
      <div role="status" aria-live="polite" aria-label={t("region")} data-testid="grade-sync-indicator" data-kind={d.kind} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2 text-sm", palette)}>
        <Icon className={cn("h-4 w-4 shrink-0", d.kind === "syncing" && "animate-spin")} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {text}
          {d.kind === "locked" ? <span className="block text-xs">{t("lockedHelp")}</span> : null}
          {draft?.blockedCode && d.kind === "failed" ? <span className="block text-xs">{draft.blockedCode}</span> : null}
        </span>
        {d.action ? (
          <button type="button" onClick={() => (draft?.status === "FAILED" ? void manager.retry(assessmentId) : void manager.syncAssessment(assessmentId))} className={cn(buttonClass.secondary, "h-9 bg-background px-3 sm:h-9")}>
            {d.action === "retry" ? t("retryNow") : t("sendNow")}
          </button>
        ) : null}
        {canDiscard ? (
          <button type="button" onClick={onDiscard} className={cn(buttonClass.ghost, "h-9 px-3 sm:h-9")}>
            {t("discard")}
          </button>
        ) : null}
      </div>
      {status.ready && !status.persistent ? (
        <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          {t("volatile")}
        </p>
      ) : null}
    </div>
  );
}
