"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  /** Rappel de la règle de calcul — aucun chiffre n'est affiché sans sa règle. */
  hint?: string;
  icon?: LucideIcon;
  /** Variation vs période précédente, en points ou en %. Omise si non calculable. */
  delta?: number;
  deltaSuffix?: string;
  /**
   * Sens métier de la hausse. Un taux de rattrapage qui monte est une mauvaise
   * nouvelle : sans ce réglage, la flèche verte mentirait.
   */
  deltaPolarity?: "higher-is-better" | "lower-is-better";
  className?: string;
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  deltaSuffix = " pts",
  deltaPolarity = "higher-is-better",
  className,
}: StatCardProps) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const flat = hasDelta && Math.abs(delta as number) < 0.05;
  const positive = hasDelta && (delta as number) > 0;
  const good = deltaPolarity === "higher-is-better" ? positive : !positive;

  // La flèche double la couleur : le sens n'est jamais porté par la teinte seule.
  const DeltaIcon = flat ? Minus : positive ? TrendingUp : TrendingDown;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4 opacity-70" aria-hidden /> : null}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <div className="mt-1 flex items-center gap-2">
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                flat
                  ? "text-muted-foreground"
                  : good
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
              )}
            >
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {flat
                ? "stable"
                : `${(delta as number) > 0 ? "+" : ""}${(delta as number).toFixed(1)}${deltaSuffix}`}
            </span>
          ) : null}
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
