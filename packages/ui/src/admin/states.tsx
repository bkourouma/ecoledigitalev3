import * as React from "react";
import { cn } from "../utils";
import { Button } from "../button";

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Texte annoncé aux lecteurs d'écran (obligatoire : fourni par le catalogue i18n de l'appelant). */
  label: string;
  /** Nombre de lignes d'ossature affichées. */
  rows?: number;
}

/** État de chargement : ossature + `role="status"` (annoncé, jamais bloquant). */
export function LoadingState({ label, rows = 3, className, ...props }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("space-y-3", className)} {...props}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  );
}

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

/** Liste vide : message explicite et, si possible, l'action qui permet de commencer. */
export function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center", className)}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  message: React.ReactNode;
  /** Référence de support (identifiant de requête) affichée discrètement. */
  reference?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Erreur de chargement : `role="alert"`, bouton « Réessayer » si `onRetry` est fourni. */
export function ErrorState({ title, message, reference, onRetry, retryLabel, className, ...props }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm", className)}
      {...props}
    >
      {title ? <p className="mb-1 font-medium text-destructive">{title}</p> : null}
      <p>{message}</p>
      {reference ? <p className="mt-1 text-xs text-muted-foreground">{reference}</p> : null}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11 sm:min-h-9" onClick={onRetry}>
          {retryLabel ?? "Retry"}
        </Button>
      ) : null}
    </div>
  );
}
