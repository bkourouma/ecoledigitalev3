"use client";

import { useMemo } from "react";
import type { OwnerAcademicResponse } from "@ecoledigitale/contracts";

type Cell = OwnerAcademicResponse["attendanceByClassWeek"][number];

function cellBg(rate: number, n: number) {
  if (n === 0) return "bg-muted/50 text-muted-foreground";
  if (rate >= 85) return "bg-emerald-600/90 text-white";
  if (rate >= 70) return "bg-amber-500/90 text-white";
  return "bg-red-500/85 text-white";
}

export function AttendanceHeatmap({ cells }: { cells: Cell[] }) {
  const { weekLabels, classRows, matrix } = useMemo(() => {
    if (!cells.length) {
      return { weekLabels: [] as string[], classRows: [] as { id: string; name: string }[], matrix: {} as Record<string, Record<string, { rate: number; n: number } | null>> };
    }

    const weeks = [...new Set(cells.map((c) => c.weekStart))].sort();
    const byClass = new Map<string, string>();
    for (const c of cells) {
      byClass.set(c.classId, c.className);
    }
    const classRows = [...byClass.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

    const matrix: Record<string, Record<string, { rate: number; n: number } | null>> = {};
    for (const cl of classRows) {
      matrix[cl.id] = {};
      for (const w of weeks) {
        matrix[cl.id][w] = null;
      }
    }
    for (const c of cells) {
      if (!matrix[c.classId]) continue;
      matrix[c.classId][c.weekStart] = { rate: c.presentRate, n: c.totalRecords };
    }

    return {
      weekLabels: weeks,
      classRows,
      matrix,
    };
  }, [cells]);

  if (!cells.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/30">
        Aucune donnée d&apos;assiduité sur les 8 dernières semaines (sessions enseignant).
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="w-full text-xs border-collapse min-w-[480px]">
        <thead>
          <tr>
            <th className="text-left font-medium p-2 border-b bg-muted/40 sticky left-0 z-10 min-w-[120px]">
              Classe
            </th>
            {weekLabels.map((w) => (
              <th
                key={w}
                className="p-2 border-b bg-muted/40 font-medium text-center whitespace-nowrap min-w-[72px]"
                title={w}
              >
                {w.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classRows.map((cl) => (
            <tr key={cl.id}>
              <td className="p-2 border-b font-medium sticky left-0 bg-background z-10">{cl.name}</td>
              {weekLabels.map((w) => {
                const v = matrix[cl.id]?.[w];
                const label = v ? `${v.rate.toFixed(0)} % (${v.n} présences)` : "—";
                return (
                  <td key={w} className="p-0.5 border-b text-center align-middle">
                    {v ? (
                      <div
                        className={`rounded px-1 py-2 tabular-nums ${cellBg(v.rate, v.n)}`}
                        title={label}
                      >
                        {v.rate.toFixed(0)}%
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground px-2 py-1.5 border-t bg-muted/20">
        Taux de présences + retards sur enregistrements de la semaine (colonne = lundi de semaine ISO).
      </p>
    </div>
  );
}
