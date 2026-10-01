import * as React from "react";
import { cn } from "../utils";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Boutons d'action (empilés sous le titre en mobile, à droite dès `sm`). */
  actions?: React.ReactNode;
  /** Niveau de titre rendu (défaut : h1 ; un écran n'a qu'un seul h1). */
  as?: "h1" | "h2";
}

/** En-tête de page : titre, description, actions. Mobile-first (colonne puis ligne dès `sm`). */
export function PageHeader({ title, description, actions, as: Heading = "h1", className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)} {...props}>
      <div className="min-w-0">
        <Heading className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</Heading>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
