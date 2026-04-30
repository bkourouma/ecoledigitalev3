"use client";

import type { OwnerAcademicResponse } from "@ecoledigitale/contracts";

type Row = OwnerAcademicResponse["semesterAverages"][number];

function barColor(grade: number) {
  if (grade >= 12) return "bg-emerald-500";
  if (grade >= 10) return "bg-amber-500";
  return "bg-red-400";
}

export function SemesterAveragesChart({ rows }: { rows: Row[] }) {
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/30">
        Aucune moyenne par période (semestre / trimestre) saisie pour le moment.
      </p>
    );
  }

  const maxGrade = Math.max(20, ...rows.map((r) => r.averageGrade || 0));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Comparaison des moyennes globales (toutes matières confondues) par période académique enregistrée.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.periodId} className="space-y-2 rounded-lg border p-3 bg-card">
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-medium text-sm leading-tight">{r.periodName}</span>
              <span className="text-sm tabular-nums">{r.averageGrade.toFixed(2)} / 20</span>
            </div>
            <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(r.averageGrade)}`}
                style={{ width: `${Math.min(100, (r.averageGrade / maxGrade) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
