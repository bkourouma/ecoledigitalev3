"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ChartCardProps = {
  title: string;
  /** Sous-titre : c'est ici qu'on documente la règle de calcul du bloc. */
  subtitle?: string;
  /** Actions alignées à droite du titre (export, bascule tableau…). */
  actions?: ReactNode;
  /** Rendu quand il n'y a rien à tracer — un graphe vide n'est pas un graphe. */
  isEmpty?: boolean;
  emptyLabel?: string;
  /** Note de bas de bloc : écarts de méthode, exclusions, mises en garde. */
  footnote?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function ChartCard({
  title,
  subtitle,
  actions,
  isEmpty = false,
  emptyLabel = "Aucune donnée sur ce périmètre.",
  footnote,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {subtitle ? (
              <p className="text-xs text-muted-foreground font-normal mt-1">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/30">
            {emptyLabel}
          </p>
        ) : (
          children
        )}
        {footnote && !isEmpty ? (
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{footnote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
