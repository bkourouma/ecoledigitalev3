"use client";

import { useMemo } from "react";
import { ChartCard } from "./ChartCard";

export type HeatmapCell = {
  rowKey: string;
  colKey: string;
  /** Valeur encodée par l'intensité, typiquement un pourcentage 0–100. */
  value: number;
  /** Contexte affiché au survol — un taux sans son effectif n'est pas lisible. */
  hint?: string;
};

type HeatmapGridProps = {
  title: string;
  subtitle?: string;
  footnote?: React.ReactNode;
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  cells: HeatmapCell[];
  /** Libellé de l'échelle, affiché dans la légende. */
  scaleLabel?: string;
  valueFormatter?: (v: number) => string;
  /** Message affiché quand la grille est vide, à adapter au domaine. */
  emptyLabel?: string;
  className?: string;
};

/**
 * Grille de chaleur générique (semaine × entité, jour × créneau).
 *
 * L'encodage est SÉQUENTIEL : une seule teinte, du clair au foncé. Pas d'arc-en-ciel —
 * la magnitude doit se lire sans consulter la légende.
 *
 * Les cellules sans donnée sont rendues en surface neutre et non à l'intensité
 * minimale : « aucune mesure » et « taux nul » ne doivent pas se ressembler.
 */
export function HeatmapGrid({
  title,
  subtitle,
  footnote,
  rows,
  cols,
  cells,
  scaleLabel = "0 → 100 %",
  valueFormatter = (v) => `${v.toFixed(1)} %`,
  emptyLabel,
  className,
}: HeatmapGridProps) {
  const index = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of cells) m.set(`${c.rowKey}|${c.colKey}`, c);
    return m;
  }, [cells]);

  /**
   * Quatre paliers depuis la rampe séquentielle : assez pour lire une tendance,
   * assez peu pour rester distinguables.
   *
   * Chaque palier ramène SON encre. Une couleur de texte fixe ne peut pas marcher :
   * en thème clair le palier bas est presque blanc, en thème sombre c'est le palier
   * haut — l'extrémité illisible change de côté selon le thème.
   */
  function stepFor(v: number): { bg: string; ink: string } {
    if (v >= 85) return { bg: "var(--viz-seq-700)", ink: "var(--viz-seq-700-ink)" };
    if (v >= 70) return { bg: "var(--viz-seq-500)", ink: "var(--viz-seq-500-ink)" };
    if (v >= 50) return { bg: "var(--viz-seq-300)", ink: "var(--viz-seq-300-ink)" };
    return { bg: "var(--viz-seq-100)", ink: "var(--viz-seq-100-ink)" };
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      isEmpty={cells.length === 0 || rows.length === 0 || cols.length === 0}
      emptyLabel={emptyLabel}
      className={className}
    >
      {/* Le tableau défile dans son propre conteneur : la page ne défile jamais
          horizontalement, quel que soit le nombre de semaines. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card text-left font-medium text-muted-foreground pr-2" />
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="font-normal text-muted-foreground whitespace-nowrap px-1 pb-1"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  className="sticky left-0 bg-card text-left font-medium whitespace-nowrap pr-3 max-w-[180px] truncate"
                >
                  {r.label}
                </th>
                {cols.map((c) => {
                  const cell = index.get(`${r.key}|${c.key}`);
                  if (!cell) {
                    return (
                      <td key={c.key} className="p-0">
                        <div
                          className="h-8 min-w-[34px] rounded-[3px] bg-muted/40"
                          title="Aucune donnée"
                          aria-label={`${r.label}, ${c.label} : aucune donnée`}
                        />
                      </td>
                    );
                  }
                  const step = stepFor(cell.value);
                  return (
                    <td key={c.key} className="p-0">
                      <div
                        className="h-8 min-w-[34px] rounded-[3px] flex items-center justify-center text-[10px] font-medium"
                        style={{ background: step.bg, color: step.ink }}
                        title={`${r.label} · ${c.label} — ${valueFormatter(cell.value)}${
                          cell.hint ? ` (${cell.hint})` : ""
                        }`}
                        aria-label={`${r.label}, ${c.label} : ${valueFormatter(cell.value)}`}
                      >
                        {/* La valeur est écrite dans la cellule : l'intensité seule
                            ne porte jamais l'information. */}
                        {Math.round(cell.value)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{scaleLabel}</span>
        <div className="flex gap-[2px]" aria-hidden>
          {["var(--viz-seq-100)", "var(--viz-seq-300)", "var(--viz-seq-500)", "var(--viz-seq-700)"].map(
            (c) => (
              <span key={c} className="h-3 w-6 rounded-[2px]" style={{ background: c }} />
            )
          )}
        </div>
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="h-3 w-6 rounded-[2px] bg-muted/40" aria-hidden />
          aucune donnée
        </span>
      </div>
    </ChartCard>
  );
}
