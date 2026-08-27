"use client";

import { useMemo } from "react";
import { Trash2 } from "lucide-react";

/**
 * Grille d'emploi du temps (HORAIRES × jours). Plusieurs ECUE possibles par case,
 * couleur de fond par UE. Si `onDelete` est fourni, un bouton de suppression
 * apparaît au survol de chaque créneau.
 */

const JOURS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
};
const DAY_KEYS = [1, 2, 3, 4, 5, 6];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 08H → 20H
const pad = (n: number) => String(n).padStart(2, "0");

function teacherName(s: any): string {
  return `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
}
function hourOf(t?: string | null): number | null {
  if (!t) return null;
  const h = parseInt(String(t).slice(0, 2), 10);
  return Number.isFinite(h) ? h : null;
}
function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

const UE_PALETTE = [
  { bg: "#E0E7FF", border: "#A5B4FC" },
  { bg: "#DCFCE7", border: "#86EFAC" },
  { bg: "#FEF9C3", border: "#FDE047" },
  { bg: "#FCE7F3", border: "#F9A8D4" },
  { bg: "#E0F2FE", border: "#7DD3FC" },
  { bg: "#F3E8FF", border: "#D8B4FE" },
  { bg: "#FFEDD5", border: "#FDBA74" },
  { bg: "#CCFBF1", border: "#5EEAD4" },
  { bg: "#FEE2E2", border: "#FCA5A5" },
  { bg: "#E2E8F0", border: "#CBD5E1" },
];
function ueColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return UE_PALETTE[h % UE_PALETTE.length];
}

export function EmploiTempsGrid({
  slots,
  onDelete,
  showTeacher = true,
  showFiliere = false,
}: {
  slots: any[];
  onDelete?: (s: any) => void;
  /** Affiche l'enseignant dans la case (vue admin/consultation). */
  showTeacher?: boolean;
  /** Affiche la filière dans la case (vue enseignant). */
  showFiliere?: boolean;
}) {
  // Occupation jour×heure : plusieurs ECUE par case possibles.
  const occ = useMemo(() => {
    const starts: Record<number, Record<number, any[]>> = {};
    for (let d = 1; d <= 6; d++) starts[d] = {};
    for (const s of slots) {
      const d = Number(s.jour);
      if (d < 1 || d > 6) continue;
      const start = hourOf(s.heure_debut);
      let end = hourOf(s.heure_fin);
      if (start == null || end == null) continue;
      if (end <= start) end = start + 1;
      (starts[d][start] ??= []).push({ ...s, _end: end });
    }
    const map: Record<number, Record<number, any>> = {};
    for (let d = 1; d <= 6; d++) map[d] = {};
    for (let d = 1; d <= 6; d++) {
      for (const startStr of Object.keys(starts[d])) {
        const start = Number(startStr);
        const group = starts[d][start];
        const maxEnd = Math.max(...group.map((g) => g._end));
        map[d][start] = { kind: "start", slots: group, span: Math.max(1, maxEnd - start) };
        for (let h = start + 1; h < maxEnd; h++) if (!map[d][h]) map[d][h] = { kind: "cont" };
      }
    }
    return map;
  }, [slots]);

  return (
    <div className="overflow-x-auto bg-white text-gray-900">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-indigo-700 bg-indigo-600 text-white text-left px-3 py-2 w-32">
              HORAIRES
            </th>
            {DAY_KEYS.map((d) => (
              <th
                key={d}
                className="border border-indigo-700 bg-indigo-600 text-white text-left px-3 py-2"
              >
                {JOURS[d].toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h}>
              <td className="border border-gray-300 bg-indigo-50 text-indigo-900 px-3 py-2 font-semibold whitespace-nowrap">
                {pad(h)}H – {pad(h + 1)}H
              </td>
              {DAY_KEYS.map((d) => {
                const cell = occ[d][h];
                if (cell?.kind === "cont") return null;
                if (cell?.kind === "start") {
                  const groupSlots: any[] = cell.slots;
                  const first = groupSlots[0];
                  const color = ueColor(first.ue_code || first.ue_libelle || first.ecue_id || "");
                  return (
                    <td
                      key={d}
                      rowSpan={cell.span}
                      className="border border-gray-300 align-top p-1.5"
                      style={{ backgroundColor: color.bg, borderLeft: `4px solid ${color.border}` }}
                    >
                      <div className="flex flex-col gap-1.5">
                        {groupSlots.map((s, idx) => (
                          <div
                            key={s.id}
                            className="flex flex-col items-center text-center gap-0.5 relative group"
                          >
                            {idx > 0 && <div className="w-full border-t border-gray-300 mb-1" />}
                            {onDelete && (
                              <button
                                type="button"
                                onClick={() => onDelete(s)}
                                className="absolute top-0 right-0 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Supprimer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <span className="font-semibold text-gray-900">{s.ecue_libelle}</span>
                            {/* Le nom de classe identifie le groupe suivi ; le code
                                filière ne sert que de repli pour les créneaux qui
                                n'en portent pas. */}
                            {showFiliere && (s.classe_nom || s.filiere_nom || s.filiere_code) && (
                              <span className="text-indigo-700 font-medium text-[11px]">
                                {s.classe_nom || s.filiere_code || s.filiere_nom}
                              </span>
                            )}
                            {showTeacher && (
                              <span
                                className={
                                  teacherName(s)
                                    ? "text-red-700 font-medium"
                                    : "text-gray-500 font-medium"
                                }
                              >
                                {teacherName(s) || "Non affecté"}
                              </span>
                            )}
                            {(s.classroom_name || s.classroom_code) && (
                              <span className="text-blue-700 font-medium">
                                {s.classroom_name || s.classroom_code}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                }
                return <td key={d} className="border border-gray-300 bg-white px-3 py-2"></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
