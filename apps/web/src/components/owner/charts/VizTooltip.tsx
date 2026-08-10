"use client";

import type { TooltipProps } from "recharts";

type VizTooltipProps = TooltipProps<number, string> & {
  valueFormatter?: (v: number) => string;
  /** Libellé de l'en-tête, si la clé d'axe n'est pas directement lisible. */
  labelFormatter?: (label: string) => string;
};

/**
 * Infobulle commune aux graphiques owner.
 *
 * La pastille de couleur porte l'identité de la série ; le texte reste en encre
 * standard — une valeur ne s'écrit jamais dans la couleur de sa série.
 */
export function VizTooltip({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
}: VizTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const fmt = valueFormatter ?? ((v: number) => new Intl.NumberFormat("fr-FR").format(v));

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-popover-foreground">
      <p className="text-xs font-medium mb-1.5">
        {labelFormatter ? labelFormatter(String(label)) : String(label)}
      </p>
      <ul className="space-y-1">
        {payload.map((entry, i) => (
          <li key={`${entry.dataKey}-${i}`} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-[2px] shrink-0"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums">
              {typeof entry.value === "number" ? fmt(entry.value) : String(entry.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
