"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OwnerAcademicResponse } from "@ecoledigitale/contracts";
import { VizTooltip } from "@/components/owner/charts/VizTooltip";
import { VIZ_CHROME, VIZ_STATUS } from "@/components/owner/charts/palette";

type Row = OwnerAcademicResponse["semesterAverages"][number];

/**
 * Moyennes par période académique.
 *
 * Migré des barres CSS maison vers recharts. L'API de props est inchangée.
 * Ne rend pas de Card : l'appelant a déjà son conteneur titré.
 *
 * La couleur suit le seuil pédagogique (>= 12 / >= 10), pas une série.
 */
function gradeColor(grade: number): string {
  if (grade >= 12) return VIZ_STATUS.good;
  if (grade >= 10) return VIZ_STATUS.warning;
  return VIZ_STATUS.critical;
}

export function SemesterAveragesChart({ rows }: { rows: Row[] }) {
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/30">
        Aucune moyenne par période (semestre / trimestre) saisie pour le moment.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Comparaison des moyennes globales (toutes matières confondues) par période
        académique enregistrée.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={VIZ_CHROME.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="periodName"
            tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
            axisLine={{ stroke: VIZ_CHROME.axis }}
            tickLine={false}
          />
          <YAxis
            // Échelle de notation figée : l'ancienne version cadrait sur la valeur
            // maximale, ce qui faisait paraître haute une moyenne médiocre.
            domain={[0, 20]}
            ticks={[0, 5, 10, 15, 20]}
            tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
            axisLine={{ stroke: VIZ_CHROME.axis }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
            content={<VizTooltip valueFormatter={(v) => `${v.toFixed(2)} / 20`} />}
          />
          {/* Seuil de validation, tracé pour que la lecture ne dépende pas de la couleur. */}
          <ReferenceLine y={10} stroke={VIZ_CHROME.axis} strokeDasharray="4 4" />
          <Bar dataKey="averageGrade" name="Moyenne" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {rows.map((r) => (
              <Cell key={r.periodId} fill={gradeColor(r.averageGrade)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground">
        Repère tracé à 10 / 20. Vert : au moins 12. Ambre : au moins 10. Rouge : en dessous.
      </p>
    </div>
  );
}
