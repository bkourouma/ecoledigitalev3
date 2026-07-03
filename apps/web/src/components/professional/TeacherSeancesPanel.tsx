"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { Loader2, Plus, Trash2, CheckCircle2 } from "lucide-react";
import {
  useTeacherSessionEcue,
  useTeacherSessionSeances,
  useCreateTeacherSeance,
  useDeleteTeacherSeance,
  useTeacherSeanceAttendance,
  useMarkTeacherSeanceAttendance,
} from "@/lib/hooks/use-professional-teacher";

/**
 * Panneau « Séances & présence » d'une session — Espace enseignant.
 * Création de séances par ECUE (libellé auto-incrémenté « Séance N ») + appel de
 * présence par séance. Réutilisé dans le détail d'une matière et la page Présences.
 */

const ATTENDANCE = ["present", "absent", "retard", "excuse"];
const ATTENDANCE_LABEL: Record<string, string> = {
  present: "Présent",
  absent: "Absent",
  retard: "Retard",
  excuse: "Excusé",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export function TeacherSeancesPanel({ sessionId }: { sessionId: string }) {
  const seancesQuery = useTeacherSessionSeances(sessionId);
  const ecueQuery = useTeacherSessionEcue(sessionId);
  const createMut = useCreateTeacherSeance();
  const deleteMut = useDeleteTeacherSeance();
  const seances: any[] = (seancesQuery.data as any[]) ?? [];
  const ecues: any[] = (ecueQuery.data as any[]) ?? [];

  const [selectedSeance, setSelectedSeance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Indique si l'utilisateur a saisi un libellé manuel (sinon on auto-incrémente).
  const [libelleTouched, setLibelleTouched] = useState(false);
  const [form, setForm] = useState({
    ecue_id: "",
    date: "",
    heure_debut: "",
    heure_fin: "",
    libelle: "",
  });

  // Libellé par défaut : « Séance N » (N = nb de séances de l'ECUE choisie + 1).
  const nextSeanceLabel = useMemo(() => {
    const n = form.ecue_id
      ? seances.filter((s) => s.ecue_id === form.ecue_id).length
      : seances.length;
    return `Séance ${n + 1}`;
  }, [seances, form.ecue_id]);

  // Tant que l'utilisateur n'a pas édité le champ, on le garde synchronisé.
  useEffect(() => {
    if (!libelleTouched) setForm((f) => ({ ...f, libelle: nextSeanceLabel }));
  }, [nextSeanceLabel, libelleTouched]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createMut.mutateAsync({
        sessionId,
        data: {
          ecue_id: form.ecue_id,
          date: form.date,
          heure_debut: form.heure_debut || null,
          heure_fin: form.heure_fin || null,
          libelle: form.libelle || null,
        },
      });
      setForm({ ecue_id: "", date: "", heure_debut: "", heure_fin: "", libelle: "" });
      setLibelleTouched(false); // réactive l'auto-incrément pour la séance suivante
      seancesQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création de la séance.");
    }
  }

  async function remove(seanceId: string) {
    if (!window.confirm("Supprimer cette séance et ses présences ?")) return;
    setError(null);
    try {
      await deleteMut.mutateAsync({ seanceId, sessionId });
      if (selectedSeance === seanceId) setSelectedSeance(null);
      seancesQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression de la séance.");
    }
  }

  if (seancesQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Séances planifiées</CardTitle>
          <CardDescription>
            Créez vos séances par ECUE, puis cliquez « Appel » pour saisir la présence de chacune.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {seances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune séance planifiée. Ajoutez-en une ci-dessous.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Horaire</th>
                    <th className="py-2 pr-3">ECUE</th>
                    <th className="py-2 pr-3">Libellé</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {seances.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{fmtDate(s.date)}</td>
                      <td className="py-2 pr-3">
                        {s.heure_debut ? `${s.heure_debut}${s.heure_fin ? `–${s.heure_fin}` : ""}` : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{s.ecue_code}</span> {s.ecue_libelle}
                      </td>
                      <td className="py-2 pr-3">{s.libelle ?? "—"}</td>
                      <td className="py-2 text-right space-x-2 whitespace-nowrap">
                        <Button variant="outline" size="sm" onClick={() => setSelectedSeance(s.id)}>
                          Appel
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600"
                          disabled={deleteMut.isPending}
                          onClick={() => remove(s.id)}
                          title="Supprimer la séance"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Formulaire de création de séance */}
          {ecues.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucun ECUE rattaché à l'UE de cette session : impossible de créer une séance.
            </p>
          ) : (
            <form
              onSubmit={create}
              className="rounded-lg border p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
            >
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-sm font-medium">ECUE</label>
                <Select value={form.ecue_id} onValueChange={(v) => setForm({ ...form, ecue_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un ECUE" />
                  </SelectTrigger>
                  <SelectContent>
                    {ecues.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.code} — {e.libelle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Date</label>
                <Input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Début</label>
                <Input
                  type="time"
                  value={form.heure_debut}
                  onChange={(e) => setForm({ ...form, heure_debut: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fin</label>
                <Input
                  type="time"
                  value={form.heure_fin}
                  onChange={(e) => setForm({ ...form, heure_fin: e.target.value })}
                />
              </div>
              <div className="md:col-span-4 space-y-1.5">
                <label className="text-sm font-medium">Libellé</label>
                <Input
                  value={form.libelle}
                  onChange={(e) => {
                    setLibelleTouched(true);
                    setForm({ ...form, libelle: e.target.value });
                  }}
                  placeholder={nextSeanceLabel}
                  maxLength={255}
                />
              </div>
              <div className="md:col-span-1 flex md:justify-end">
                <Button type="submit" disabled={createMut.isPending || !form.ecue_id || !form.date}>
                  {createMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Planifier
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {selectedSeance && (
        <SeanceAttendanceSheet seanceId={selectedSeance} onClose={() => setSelectedSeance(null)} />
      )}
    </div>
  );
}

/** Feuille de présence d'une séance : liste des inscrits + statut (éditable). */
export function SeanceAttendanceSheet({
  seanceId,
  onClose,
  subtitle,
}: {
  seanceId: string;
  onClose: () => void;
  subtitle?: string;
}) {
  const query = useTeacherSeanceAttendance(seanceId);
  const markMut = useMarkTeacherSeanceAttendance();
  const items: any[] = (query.data as any[]) ?? [];
  const [statuts, setStatuts] = useState<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const it of items) init[it.student_id] = it.attendance_statut ?? "present";
    setStatuts(init);
  }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const records = Object.entries(statuts).map(([student_id, statut]) => ({ student_id, statut }));
    await markMut.mutateAsync({ seanceId, records });
    query.refetch();
  }

  return (
    <Card className="border-blue-300">
      <CardHeader>
        <CardTitle className="text-lg">Feuille de présence</CardTitle>
        <CardDescription>{subtitle ?? "Inscrits confirmés de la session."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun étudiant inscrit confirmé.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.student_id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {it.first_name} {it.last_name}
                </span>
                <Select
                  value={statuts[it.student_id] ?? "present"}
                  onValueChange={(v) => setStatuts((p) => ({ ...p, [it.student_id]: v }))}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTENDANCE.map((s) => (
                      <SelectItem key={s} value={s}>
                        {ATTENDANCE_LABEL[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={save} disabled={markMut.isPending || items.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Enregistrer l'appel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
