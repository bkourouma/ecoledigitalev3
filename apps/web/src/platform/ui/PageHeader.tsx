"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** En-tête d'écran : un seul `h1`, description et actions principales (empilées sur mobile). */
export function PageHeader({ title, description, actions, className }: { title: string; description?: string; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const TONES = {
  success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  warning: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  danger: "border-red-400/40 bg-red-400/10 text-red-300",
  info: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  neutral: "border-white/10 bg-white/5 text-muted-foreground",
} as const;
export type Tone = keyof typeof TONES;

/** Pastille d'état : le texte porte le sens (la couleur seule ne suffit jamais). */
export function StatusBadge({ label, tone = "neutral", className }: { label: string; tone?: Tone; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>{label}</span>;
}

/** Classes des boutons d'action (zone tactile de 44 px sur mobile). */
export const buttonClass = {
  primary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:h-10",
  secondary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:h-10",
  /** Action destructrice DANS UNE LIGNE ou une barre d'actions : contour rouge discret (le texte porte le sens). */
  danger:
    "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:h-10",
  /** Confirmation d'une action destructrice (fenêtre modale) : rouge plein. */
  dangerSolid:
    "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:h-10",
  ghost:
    "inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:h-9",
} as const;
