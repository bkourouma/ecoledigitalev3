"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { VizTooltip } from "./VizTooltip";
import { VIZ_CHROME } from "./palette";
import type { BarSeries } from "./BarChartCard";

type LineChartCardProps<T extends Record<string, unknown>> = {
  title: string;
  subtitle?: string;
  footnote?: React.ReactNode;
  data: T[];
  categoryKey: keyof T & string;
  series: BarSeries[];
  height?: number;
  /** Domaine imposé — utile pour une note sur 20, qu'on ne laisse pas auto-cadrer. */
  yDomain?: [number, number];
  valueFormatter?: (v: number) => string;
  axisFormatter?: (v: number) => string;
  className?: string;
};

export function LineChartCard<T extends Record<string, unknown>>({
  title,
  subtitle,
  footnote,
  data,
  categoryKey,
  series,
  height = 300,
  yDomain,
  valueFormatter,
  axisFormatter,
  className,
}: LineChartCardProps<T>) {
  const showLegend = series.length >= 2;

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      isEmpty={data.length === 0}
      className={className}
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={VIZ_CHROME.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={categoryKey}
            tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
            axisLine={{ stroke: VIZ_CHROME.axis }}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={axisFormatter}
            tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
            axisLine={{ stroke: VIZ_CHROME.axis }}
            tickLine={false}
          />
          <Tooltip content={<VizTooltip valueFormatter={valueFormatter} />} />
          {showLegend ? (
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="line" iconSize={12} />
          ) : null}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: s.color }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
              // Une série peut ne pas couvrir tous les semestres : on relie les
              // points existants plutôt que de casser la ligne sur un trou.
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
