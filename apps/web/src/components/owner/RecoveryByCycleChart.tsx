"use client";

import type { OwnerDashboardResponse } from "@ecoledigitale/contracts";

type Row = OwnerDashboardResponse["finances"]["recoveryByCycle"][number];

function barColor(rate: number) {
  if (rate >= 80) return "bg-emerald-500";
  if (rate >= 60) return "bg-amber-500";
  return "bg-red-500";
}

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
      {rows.map((r) => (
        <div key={r.cycle} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{r.cycle}</span>
            <span>{r.rate.toFixed(1)} %</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor(r.rate)}`}
              style={{ width: `${Math.min(100, Math.max(0, r.rate))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
