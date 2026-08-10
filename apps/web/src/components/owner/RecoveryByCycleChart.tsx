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
import type { OwnerDashboardResponse } from "@ecoledigitale/contracts";
import { VizTooltip } from "@/components/owner/charts/VizTooltip";
import { VIZ_CHROME, recoveryColor, formatPct } from "@/components/owner/charts/palette";

type Row = OwnerDashboardResponse["finances"]["recoveryByCycle"][number];

/**
 * Recouvrement par cycle.
 *
 * Migré des barres CSS maison vers recharts, comme le reste de l'application.
 * L'API de props est inchangée — l'appelant fournit toujours `rows`.
 *
 * Le composant ne rend PAS de Card : la page qui l'utilise a déjà son propre
 * conteneur titré, et deux cartes imbriquées produiraient un double cadre.
 *
 * La couleur encode un seuil métier (>= 80 % / >= 60 %), pas une série : elle est
 * donc doublée par la valeur chiffrée dans l'infobulle et par les repères tracés.
 */
export function RecoveryByCycleChart({ rows }: { rows: Row[] }) {
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/30">
        Aucune donnée de recouvrement par cycle pour le moment.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 42 + 40)}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid stroke={VIZ_CHROME.grid} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            // Domaine fixé à 0–100 : sans cela un cycle à 40 % occuperait toute la
            // largeur et se lirait comme un bon score.
            domain={[0, 100]}
            tickFormatter={(v) => `${v} %`}
            tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
            axisLine={{ stroke: VIZ_CHROME.axis }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="cycle"
            width={120}
            tick={{ fontSize: 11, fill: VIZ_CHROME.muted }}
            axisLine={{ stroke: VIZ_CHROME.axis }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
            content={<VizTooltip valueFormatter={(v) => formatPct(v)} />}
          />
          {/* Seuils métier matérialisés : la lecture ne repose pas sur la teinte seule. */}
          <ReferenceLine x={60} stroke={VIZ_CHROME.axis} strokeDasharray="4 4" />
          <ReferenceLine x={80} stroke={VIZ_CHROME.axis} strokeDasharray="4 4" />
          <Bar dataKey="rate" name="Taux de recouvrement" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {rows.map((r) => (
              <Cell key={r.cycle} fill={recoveryColor(r.rate)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground">
        Repères à 60 % et 80 %. Vert : au moins 80 %. Ambre : au moins 60 %. Rouge : en
        dessous.
      </p>
    </div>
  );
}
