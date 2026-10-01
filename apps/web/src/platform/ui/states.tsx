"use client";

import type { ReactNode } from "react";
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
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm", className)}>
      <div className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{describe(error)}</p>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("retry")}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
      <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Message de retour d'une action (succès : `role="status"`, échec : `role="alert"`). */
export function Notice({ kind, children, className }: { kind: "success" | "error" | "info" | "warning"; children: ReactNode; className?: string }) {
  const palette = {
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
    error: "border-destructive/40 bg-destructive/5 text-destructive",
    info: "border-blue-300 bg-blue-50 text-blue-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
  }[kind];
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div role={kind === "error" || kind === "warning" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-md border p-3 text-sm", palette, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
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
