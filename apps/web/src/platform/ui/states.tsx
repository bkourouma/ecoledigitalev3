"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDescribeError } from "./errors";

/** Chargement : annoncé aux lecteurs d'écran (`role="status"`). */
export function LoadingBlock({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations("common");
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center gap-2 py-8 text-sm text-muted-foreground", className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label ?? t("loading")}</span>
    </div>
  );
}

/** Erreur : message de l'API quand il est utile, sinon message technique ; bouton « Réessayer » facultatif. */
export function ErrorBlock({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const describe = useDescribeError();
  const t = useTranslations("actions");
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm", className)}>
      <div className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{describe(error)}</p>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex h-11 items-center rounded-md border border-input sm:h-9 bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("retry")}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
      <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-muted-foreground">
        <Inbox className="h-7 w-7" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Message de retour d'une action (succès : `role="status"`, échec : `role="alert"`). */
export function Notice({ kind, children, className }: { kind: "success" | "error" | "info" | "warning"; children: ReactNode; className?: string }) {
  const palette = {
    success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    error: "border-red-400/40 bg-red-400/10 text-red-200",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    warning: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  }[kind];
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div role={kind === "error" || kind === "warning" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-xl border p-3.5 text-sm", palette, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Message de succès d'une action, annoncé (`role="status"`) ; `show(null)` l'efface. */
export function useFlash() {
  const [message, show] = useState<string | null>(null);
  return { message, show, node: message ? <Notice kind="success">{message}</Notice> : null };
}

function TenantUnknownNotice() {
  const t = useTranslations("common");
  return <Notice kind="warning">{t("tenantUnknown")}</Notice>;
}

interface QueryLike {
  isPending: boolean;
  fetchStatus?: "fetching" | "paused" | "idle";
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Enveloppe standard des trois états d'un écran : chargement -> erreur -> vide -> contenu.
 * `isEmpty` est calculé par l'appelant à partir de la donnée (jamais ici : aucune logique métier).
 */
export function QueryBoundary({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: QueryLike;
  isEmpty?: boolean;
  empty?: ReactNode;
  children: ReactNode;
}) {
  // `useApiQuery` est désactivée tant que le tenant est inconnu : sans cela l'écran resterait en chargement.
  if (query.isPending && query.fetchStatus === "idle") return <TenantUnknownNotice />;
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty && empty) return <>{empty}</>;
  return <>{children}</>;
}
