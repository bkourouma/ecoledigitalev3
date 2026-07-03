"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import Link from "next/link";
import {
  Loader2,
  Layers,
  CalendarRange,
  Plus,
  Trash2,
  FileDown,
  Info,
  CheckCircle2,
  Eye,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useEmploiTemps,
  useEmploiTempsEcue,
  useCreateEmploiTempsSlot,
  useDeleteEmploiTempsSlot,
  useFilieresWithOpenSessions,
  useSemestresWithOpenSessions,
} from "@/lib/hooks/use-professional-emploi-temps";
import { useClassrooms } from "@/lib/hooks/use-classrooms";
import { downloadEmploiTempsDocx } from "@/lib/emploi-temps-docx";

/**
 * Emploi du temps hebdomadaire — Module Professionnel.
 * On construit une LISTE de créneaux (jour + horaire + ECUE + salle) puis on
 * enregistre tout en une fois. Grille de consultation + export Word.
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
// Plage horaire : 08H–09H … 19H–20H (8h → 20h max).
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const NONE = "__none__";
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

// Couleur de fond par UE (fond clair, texte foncé) — stable par clé.
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

// Une ligne-créneau en cours de construction (pas encore enregistrée).
type RowDraft = {
  rowId: string;
  ecueKey: string; // `${ue_session_id}|${ecue_id}`
  jour: string; // "1".."5"
  hDebut: string;
  hFin: string;
  salleId: string; // NONE ou id
};

export default function ProfessionalPlanningPage() {
  const [filiereId, setFiliereId] = useState("");
  const [semestreId, setSemestreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Dates de validité (communes à tous les créneaux saisis).
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");

  // Liste de créneaux à enregistrer.
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const rowIdRef = useRef(0);

  const programmesQuery = useFilieresWithOpenSessions();
  const semestresQuery = useSemestresWithOpenSessions(filiereId || null);
  const etQuery = useEmploiTemps(semestreId || null);
  const ecueQuery = useEmploiTempsEcue(semestreId || null);
  const classroomsQuery = useClassrooms({ limit: 100 } as any);
  const createMut = useCreateEmploiTempsSlot();
  const deleteMut = useDeleteEmploiTempsSlot();

  const filieres: any[] = (programmesQuery.data as any[]) ?? [];
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId
      ? [...list].sort((a, b) => String(a.libelle).localeCompare(String(b.libelle)))
      : [];
  }, [semestresQuery.data, filiereId]);
  const et: any = etQuery.data ?? null;
  const slots: any[] = et?.slots ?? [];
  const ecues: any[] = (ecueQuery.data as any[]) ?? [];
  const classrooms: any[] = (classroomsQuery.data as any)?.data ?? [];

  function ecueByKey(key: string) {
    return ecues.find((e) => `${e.ue_session_id}|${e.ecue_id}` === key) ?? null;
  }

  // Pré-remplit les dates avec la période du semestre + vide la saisie en cours.
  useEffect(() => {
    setDateDebut((et?.date_debut ?? "").slice(0, 10));
    setDateFin((et?.date_fin ?? "").slice(0, 10));
    setRows([]);
  }, [et?.date_debut, et?.date_fin, semestreId]);

  // Occupation jour×heure (créneaux ENREGISTRÉS) : plusieurs ECUE par case possibles.
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

  function selectFiliere(id: string) {
    setFiliereId(id);
    setSemestreId("");
    setRows([]);
  }

  function addRow() {
    rowIdRef.current += 1;
    setRows((prev) => [
      ...prev,
      { rowId: `r-${rowIdRef.current}`, ecueKey: "", jour: "1", hDebut: "8", hFin: "10", salleId: NONE },
    ]);
  }
  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }
  function updateRow(rowId: string, field: keyof RowDraft, value: string) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }

  // Enregistre tous les créneaux saisis en une fois.
  async function saveRows() {
    setError(null);
    if (rows.length === 0) return setError("Ajoutez au moins un créneau.");
    if (!dateDebut || !dateFin) return setError("Renseignez la date de début et la date de fin.");
    if (dateFin < dateDebut)
      return setError("La date de fin doit être postérieure ou égale à la date de début.");
    for (const r of rows) {
      if (!r.ecueKey) return setError("Chaque créneau doit avoir une ECUE.");
      if (Number(r.hFin) <= Number(r.hDebut))
        return setError("Sur chaque créneau, l'heure de fin doit suivre l'heure de début.");
    }
    setSaving(true);
    try {
      for (const r of rows) {
        const ec = ecueByKey(r.ecueKey);
        if (!ec) continue;
        await createMut.mutateAsync({
          ue_session_id: ec.ue_session_id,
          ecue_id: ec.ecue_id,
          jour: Number(r.jour),
          heure_debut: `${pad(Number(r.hDebut))}:00`,
          heure_fin: `${pad(Number(r.hFin))}:00`,
          date_debut: dateDebut,
          date_fin: dateFin,
          enseignant_id: ec.enseignant_id ?? null,
          classroom_id: r.salleId === NONE ? null : r.salleId,
        });
      }
      setRows([]);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement des créneaux.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s: any) {
    setError(null);
    try {
      await deleteMut.mutateAsync(s.id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            Emploi du temps
          </h1>
          <p className="text-muted-foreground mt-2">
            Ajoutez autant de créneaux que nécessaire (jour + horaire + ECUE), puis enregistrez tout
            en une fois.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/professionnel/admin/planning/consultation">
            <Button variant="outline">
              <Eye className="h-4 w-4 mr-2" />
              Consulter
            </Button>
          </Link>
          <Button
            onClick={() => et && downloadEmploiTempsDocx(et)}
            disabled={!et || slots.length === 0}
            className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Exporter en Word
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filière + semestre */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Filière et semestre</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Filière</label>
            <SearchableSelect
              value={filiereId}
              onChange={selectFiliere}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={programmesQuery.isLoading ? "Chargement…" : "Sélectionner une filière"}
              options={filieres.map((f) => ({
                value: f.id,
                label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
              }))}
            />
          </div>
          {filiereId && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Semestre</label>
              <SearchableSelect
                value={semestreId}
                onChange={(v) => {
                  setSemestreId(v);
                  setRows([]);
                }}
                icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
                placeholder={
                  semestresQuery.isLoading
                    ? "Chargement…"
                    : semestres.length === 0
                    ? "Aucun semestre"
                    : "Sélectionner un semestre"
                }
                options={semestres.map((s) => ({ value: s.id, label: s.libelle }))}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {semestreId && et && (
        <>
          {/* Bandeau période */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <span className="font-medium text-foreground">{et.filiere_nom}</span>
            <span>· {et.libelle}</span>
            <span>
              · Du {fmtDate(et.date_debut)} au {fmtDate(et.date_fin)}
            </span>
          </div>

          {/* Construction des créneaux */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Créneaux à enregistrer</CardTitle>
              <CardDescription>
                Une ligne = un créneau. L'enseignant est repris automatiquement de l'ECUE. Les dates
                ci-dessous s'appliquent à tous les créneaux saisis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Dates communes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Date de début</Label>
                  <Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Date de fin</Label>
                  <Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
                </div>
              </div>

              {/* Lignes-créneaux */}
              {rows.map((r) => {
                const ec = ecueByKey(r.ecueKey);
                return (
                  <div
                    key={r.rowId}
                    className="flex flex-col gap-2 p-3 border rounded-lg bg-gray-50"
                  >
                    <div className="flex flex-col md:flex-row md:items-end gap-3">
                      <div className="flex-[2] space-y-1">
                        <Label className="text-xs font-medium">ECUE</Label>
                        <Select
                          value={r.ecueKey}
                          onValueChange={(v) => updateRow(r.rowId, "ecueKey", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner une ECUE" />
                          </SelectTrigger>
                          <SelectContent>
                            {ecues.length > 0 ? (
                              ecues.map((e) => (
                                <SelectItem
                                  key={`${e.ue_session_id}|${e.ecue_id}`}
                                  value={`${e.ue_session_id}|${e.ecue_id}`}
                                >
                                  {e.ecue_code} — {e.ecue_libelle}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="none" disabled>
                                {ecueQuery.isLoading ? "Chargement…" : "Aucune ECUE"}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs font-medium">Jour</Label>
                        <Select value={r.jour} onValueChange={(v) => updateRow(r.rowId, "jour", v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(JOURS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs font-medium">Début</Label>
                        <Select value={r.hDebut} onValueChange={(v) => updateRow(r.rowId, "hDebut", v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HOURS.map((h) => (
                              <SelectItem key={h} value={String(h)}>
                                {pad(h)}H
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs font-medium">Fin</Label>
                        <Select value={r.hFin} onValueChange={(v) => updateRow(r.rowId, "hFin", v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HOURS.map((h) => h + 1).map((h) => (
                              <SelectItem key={h} value={String(h)}>
                                {pad(h)}H
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs font-medium">Salle</Label>
                        <Select value={r.salleId} onValueChange={(v) => updateRow(r.rowId, "salleId", v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Aucune —</SelectItem>
                            {classrooms.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeRow(r.rowId)}
                        className="shrink-0 text-red-600 hover:bg-red-50"
                        title="Retirer ce créneau"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enseignant :{" "}
                      <span className={ec && teacherName(ec) ? "text-red-600 font-medium" : ""}>
                        {ec ? teacherName(ec) || "— non affecté —" : "—"}
                      </span>
                    </p>
                  </div>
                );
              })}

              {/* Ajouter une ligne */}
              <Button type="button" variant="outline" className="w-full" onClick={addRow}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter un créneau
              </Button>

              {/* Enregistrer tout */}
              {rows.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
                  <span className="text-sm font-medium text-indigo-900">
                    {rows.length} créneau{rows.length > 1 ? "x" : ""} à enregistrer
                  </span>
                  <Button
                    type="button"
                    onClick={saveRows}
                    disabled={saving}
                    className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Enregistrer {rows.length} créneau{rows.length > 1 ? "x" : ""}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Grille emploi du temps (créneaux enregistrés) */}
          <Card className="shadow-lg overflow-hidden">
            <CardContent className="p-0 overflow-x-auto bg-white text-gray-900">
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
                        if (cell?.kind === "cont") return null; // couvert par le rowSpan
                        if (cell?.kind === "start") {
                          const groupSlots: any[] = cell.slots;
                          const first = groupSlots[0];
                          const color = ueColor(first.ue_code || first.ue_libelle || first.ecue_id || "");
                          return (
                            <td
                              key={d}
                              rowSpan={cell.span}
                              className="border border-gray-300 align-top p-1.5"
                              style={{
                                backgroundColor: color.bg,
                                borderLeft: `4px solid ${color.border}`,
                              }}
                            >
                              <div className="flex flex-col gap-1.5">
                                {groupSlots.map((s, idx) => (
                                  <div
                                    key={s.id}
                                    className="flex flex-col items-center text-center gap-0.5 relative group"
                                  >
                                    {idx > 0 && <div className="w-full border-t border-gray-300 mb-1" />}
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(s)}
                                      className="absolute top-0 right-0 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Supprimer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                    <span className="font-semibold text-gray-900">{s.ecue_libelle}</span>
                                    <span
                                      className={
                                        teacherName(s)
                                          ? "text-red-700 font-medium"
                                          : "text-gray-500 font-medium"
                                      }
                                    >
                                      {teacherName(s) || "Non affecté"}
                                    </span>
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
                        return (
                          <td key={d} className="border border-gray-300 bg-white px-3 py-2"></td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
