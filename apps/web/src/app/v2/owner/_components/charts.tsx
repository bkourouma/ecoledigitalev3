"use client";

/**
 * Graphiques accessibles des écrans de pilotage. Chaque graphique :
 *  - porte un nom et un résumé (`role="img"` + `aria-label` pour les colonnes SVG ; liste étiquetée pour les barres) ;
 *  - donne les VALEURS en texte (la couleur ne porte jamais seule l'information) ;
 *  - propose son ALTERNATIVE TABLEAU (`<details>`) avec les mêmes données ;
 *  - utilise les couleurs du thème (clair et sombre) et se replie sur mobile (pas de défilement horizontal de la page).
 *
 * Les proportions des barres sont un calcul de PRÉSENTATION (plus grande valeur affichée = 100 %), jamais un indicateur.
 */

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export interface ChartRow {
  key: string;
  label: string;
  value: number;
  /** Valeur mise en forme par l'écran (devise, pourcentage…) : c'est ce que lit l'utilisateur. */
  display: string;
  /** Texte complémentaire (ex. « 12 sur 40 »). */
  note?: string;
}

function TableAlternative({ title, rows, valueHeader, noteHeader }: { title: string; rows: readonly ChartRow[]; valueHeader: string; noteHeader?: string }) {
  const t = useTranslations("v2Owner.chart");
  return (
    <details className="text-sm">
      <summary className="cursor-pointer select-none text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("showTable")}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[16rem] text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">
                {t("category")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {valueHeader}
              </th>
              {noteHeader ? (
                <th scope="col" className="py-1 text-right font-medium">
                  {noteHeader}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {r.label}
                </th>
                <td className="py-1 pr-3 text-right tabular-nums">{r.display}</td>
                {noteHeader ? <td className="py-1 text-right tabular-nums text-muted-foreground">{r.note ?? ""}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Barres horizontales : étiquette, barre, valeur en texte. */
export function BarChart({ title, rows, valueHeader, noteHeader, empty }: { title: string; rows: readonly ChartRow[]; valueHeader: string; noteHeader?: string; empty?: ReactNode }) {
  const id = useId();
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure aria-labelledby={`${id}-title`} className="space-y-3 rounded-2xl border border-white/10 bg-card/60 p-4">
      <figcaption id={`${id}-title`} className="text-sm font-medium">
        {title}
      </figcaption>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
              <span aria-hidden="true" className="h-3 rounded-full bg-white/10">
                <span className="block h-3 rounded-full bg-gradient-to-r from-violet-500 to-blue-400" style={{ width: `${max > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
              </span>
              <span className="tabular-nums">
                {r.display}
                {r.note ? <span className="ml-1 text-xs text-muted-foreground">{r.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 ? <TableAlternative title={title} rows={rows} valueHeader={valueHeader} noteHeader={noteHeader} /> : null}
    </figure>
  );
}

/** Colonnes verticales (série temporelle, histogramme) : SVG nommé, valeurs en texte dans l'alternative tableau. */
export function ColumnChart({ title, rows, valueHeader, noteHeader, summary, empty }: { title: string; rows: readonly ChartRow[]; valueHeader: string; noteHeader?: string; summary: string; empty?: ReactNode }) {
  const id = useId();
  const max = Math.max(0, ...rows.map((r) => r.value));
  const width = Math.max(rows.length * 28, 120);
  const height = 120;
  const barWidth = Math.min(22, Math.floor(width / Math.max(rows.length, 1)) - 6);
  return (
    <figure aria-labelledby={`${id}-title`} className="space-y-3 rounded-2xl border border-white/10 bg-card/60 p-4">
      <figcaption id={`${id}-title`} className="text-sm font-medium">
        {title}
      </figcaption>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{empty}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg role="img" aria-label={`${title}. ${summary}`} viewBox={`0 0 ${width} ${height + 18}`} className="h-40 w-full min-w-[16rem] text-primary" preserveAspectRatio="none">
              {rows.map((r, i) => {
                const h = max > 0 ? Math.max(r.value > 0 ? 2 : 0, (r.value / max) * height) : 0;
                const x = i * (width / rows.length) + (width / rows.length - barWidth) / 2;
                return (
                  <g key={r.key}>
                    <rect x={x} y={height - h} width={barWidth} height={h} rx={2} className="fill-current" />
                    <text x={x + barWidth / 2} y={height + 12} textAnchor="middle" fontSize="8" className="fill-muted-foreground">
                      {r.label.length > 5 ? r.label.slice(0, 5) : r.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <TableAlternative title={title} rows={rows} valueHeader={valueHeader} noteHeader={noteHeader} />
        </>
      )}
    </figure>
  );
}
