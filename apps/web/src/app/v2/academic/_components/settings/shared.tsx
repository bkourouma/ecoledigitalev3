"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/platform/ui/PageHeader";
import type { FieldErrors } from "@/platform/ui/validation";

/** Bloc d'un onglet : titre, explication, actions (« Ajouter… ») et contenu. */
export function SettingsSection({ id, title, description, actions, children }: { id: string; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Liste de cartes empilées : lisible à 375 px (pas de tableau large), deux colonnes à partir de `md`. */
export function CardList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="grid gap-3 md:grid-cols-2">
      {children}
    </ul>
  );
}

export function ItemCard({ title, code, badges, meta, actions, inactive }: { title: string; code?: string; badges?: ReactNode; meta?: ReactNode; actions?: ReactNode; inactive?: boolean }) {
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border p-3", inactive && "bg-muted/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-medium">{title}</h3>
          {code ? <p className="font-mono text-xs text-muted-foreground">{code}</p> : null}
        </div>
        {badges ? <div className="flex flex-wrap gap-1">{badges}</div> : null}
      </div>
      {meta ? <div className="text-sm text-muted-foreground">{meta}</div> : null}
      {actions ? <div className="mt-auto flex flex-wrap gap-1">{actions}</div> : null}
    </li>
  );
}

export function ActiveBadge({ active, on, off }: { active: boolean; on: string; off: string }) {
  return <StatusBadge label={active ? on : off} tone={active ? "success" : "neutral"} />;
}

/** Les erreurs de corps `{ items: [ … ] }` portent le chemin `items.0.<champ>` : on les ramène au champ du formulaire. */
export function stripItemPath(errors: FieldErrors): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) out[key.replace(/^items\.0\./, "").replace(/^items\.0$/, "_")] = message;
  return out;
}
