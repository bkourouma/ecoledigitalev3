"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { VizTooltip } from "./VizTooltip";
import { VIZ_CHROME } from "./palette";

export type BarSeries = {
  key: string;
  label: string;
  /** Couleur de la série. Reste stable quand un filtre retire d'autres séries. */
  color: string;
};

type BarChartCardProps<T extends Record<string, unknown>> = {
  title: string;
  subtitle?: string;
  footnote?: React.ReactNode;
  data: T[];
  /** Clé portant le libellé de catégorie. */
  categoryKey: keyof T & string;
  series: BarSeries[];
  /** `horizontal` = barres couchées, adapté aux libellés longs (noms d'ECUE). */
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  height?: number;
  valueFormatter?: (v: number) => string;
  axisFormatter?: (v: number) => string;
  /**
   * Couleur par ligne, pour les cas où la teinte encode un seuil plutôt qu'une
   * série (recouvrement par filière). Incompatible avec plusieurs séries.
   */
  colorByRow?: (row: T) => string;
  className?: string;
};

export function BarChartCard<T extends Record<string, unknown>>({
  title,
  subtitle,
  footnote,
  data,
  categoryKey,
  series,
  orientation = "vertical",
  stacked = false,
  height = 300,
  valueFormatter,
  axisFormatter,
  colorByRow,
  className,
}: BarChartCardProps<T>) {
  const horizontal = orientation === "horizontal";
  // Une seule série ⇒ pas de boîte de légende : le titre nomme déjà la mesure.
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
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 4, right: 12, bottom: 4, left: horizontal ? 8 : 0 }}
        >
          <CartesianGrid
            stroke={VIZ_CHROME.grid}
            strokeDasharray="3 3"
            // Grille récessive : une seule direction, celle de la lecture des valeurs.
            horizontal={!horizontal}
            vertical={horizontal}
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickFormatter={axisFormatter}
                tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
                axisLine={{ stroke: VIZ_CHROME.axis }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey={categoryKey}
                width={150}
                tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
                axisLine={{ stroke: VIZ_CHROME.axis }}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={categoryKey}
                tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
                axisLine={{ stroke: VIZ_CHROME.axis }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={axisFormatter}
                tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
                axisLine={{ stroke: VIZ_CHROME.axis }}
                tickLine={false}
              />
            </>
          )}
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
            content={<VizTooltip valueFormatter={valueFormatter} />}
          />
          {showLegend ? (
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="square"
              iconSize={10}
            />
          ) : null}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? "stack" : undefined}
              // Extrémité de donnée arrondie, ancrée à la ligne de base.
              radius={
                stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]
              }
              // Filet à la couleur de la surface : crée le jour de 2px entre
              // segments empilés et entre barres adjacentes.
              stroke="hsl(var(--card))"
              strokeWidth={stacked ? 2 : 0}
              maxBarSize={horizontal ? 18 : 42}
            >
              {colorByRow
                ? data.map((row, i) => (
                    <Cell key={`c-${i}`} fill={colorByRow(row)} />
                  ))
                : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
