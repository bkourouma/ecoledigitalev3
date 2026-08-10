"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartCard } from "./ChartCard";
import { VizTooltip } from "./VizTooltip";
import { VIZ_SERIES } from "./palette";

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** Couleur imposée ; à défaut, le slot catégoriel correspondant à l'ordre. */
  color?: string;
};

type DonutChartCardProps = {
  title: string;
  subtitle?: string;
  footnote?: React.ReactNode;
  slices: DonutSlice[];
  height?: number;
  valueFormatter?: (v: number) => string;
  /** Valeur affichée au centre — le total, le plus souvent. */
  centerLabel?: string;
  centerValue?: string;
  className?: string;
};

export function DonutChartCard({
  title,
  subtitle,
  footnote,
  slices,
  height = 260,
  valueFormatter,
  centerLabel,
  centerValue,
  className,
}: DonutChartCardProps) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const data = slices.map((s, i) => ({
    ...s,
    // Assignation dans l'ordre des slots, jamais en cyclant : au-delà de 8
    // tranches il faudrait regrouper en « Autres » plutôt qu'inventer une teinte.
    color: s.color ?? VIZ_SERIES[i] ?? "var(--viz-muted)",
  }));

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      isEmpty={total <= 0}
      className={className}
    >
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="82%"
              // Le jour de 2px entre tranches remplace un contour appuyé.
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<VizTooltip valueFormatter={valueFormatter} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue ? (
          <div
            className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
            // Centré sur l'anneau, pas sur le bloc : la légende occupe le bas.
            style={{ top: height * 0.32 }}
          >
            <span className="text-lg font-semibold tabular-nums">{centerValue}</span>
            {centerLabel ? (
              <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </ChartCard>
  );
}
