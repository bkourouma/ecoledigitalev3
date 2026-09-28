"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  UserCheck,
  CalendarDays,
  Clock,
  BookOpen,
  Layers,
  GraduationCap,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import {
  useTeacherSeanceDetail,
  useTeacherSeanceAttendance,
  useMarkTeacherSeanceAttendance,
} from "@/lib/hooks/use-professional-teacher";

/**
 * Détail d'une séance — Espace enseignant (Module Professionnel).
 * Ouvert depuis l'action « Détails » de la page Présences : contexte complet de
 * la séance (ECUE, UE, session, filière) et feuille de présence modifiable.
 */

const ATTENDANCE = ["present", "absent", "retard", "excuse"];
const ATTENDANCE_LABEL: Record<string, string> = {
  present: "Présent",
  absent: "Absent",
  retard: "Retard",
  excuse: "Excusé",
};
const ATTENDANCE_TONE: Record<string, string> = {
  present: "bg-green-50 text-green-700 border-green-200",
  absent: "bg-red-50 text-red-700 border-red-200",
  retard: "bg-amber-50 text-amber-700 border-amber-200",
  excuse: "bg-blue-50 text-blue-700 border-blue-200",
};

const STATUT_LABEL: Record<string, string> = {
  ouvert: "Ouverte",
  en_cours: "En cours",
  termine: "Terminée",
  complet: "Complète",
  annule: "Annulée",
  brouillon: "Brouillon",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function fmtHeure(value?: string | null): string {
  return value ? String(value).slice(0, 5) : "—";
}

/** Ligne « libellé / valeur » du bloc d'informations. */
function InfoItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-indigo-50 p-2 text-indigo-500">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="font-medium break-words">{children}</div>
      </div>
    </div>
  );
}

/** Compteur coloré d'un statut de présence. */
function StatTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${tone}`}>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="text-xs font-medium">{label}</div>
    </div>
  );
}

export default function TeacherSeanceDetailPage() {
  const router = useRouter();
  const params = useParams<{ seanceId: string }>();
  const seanceId = String(params?.seanceId ?? "");

  const detailQuery = useTeacherSeanceDetail(seanceId);
  const attendanceQuery = useTeacherSeanceAttendance(seanceId);
  const markMut = useMarkTeacherSeanceAttendance();

  const seance = (detailQuery.data as any) ?? null;

  const students: any[] = (attendanceQuery.data as any[]) ?? [];

  // Statuts en cours d'édition + copie de référence pour détecter les changements.
  const [statuts, setStatuts] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const s of students) next[s.student_id] = s.attendance_statut ?? "present";
    setStatuts(next);
    setInitial(next);
    setSaved(false);
  }, [attendanceQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () => Object.keys(statuts).some((id) => statuts[id] !== initial[id]),
    [statuts, initial]
  );

  // Décomptes recalculés à la volée : ils suivent les modifications non enregistrées.
  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, retard: 0, excuse: 0 };
    for (const v of Object.values(statuts)) if (v in c) c[v] += 1;
    return c;
  }, [statuts]);

  const nonPointes = students.filter((s) => !s.attendance_statut).length;

  function setAll(statut: string) {
    setStatuts(Object.fromEntries(students.map((s) => [s.student_id, statut])));
    setSaved(false);
  }

  async function save() {
    setError(null);
    try {
      const records = Object.entries(statuts).map(([student_id, statut]) => ({
        student_id,
        statut,
      }));
      await markMut.mutateAsync({ seanceId, records });
      setInitial(statuts);
      setSaved(true);
    } catch (e) {
      setError((e as Error)?.message ?? "L'enregistrement de l'appel a échoué.");
    }
  }

  if (detailQuery.isLoading || attendanceQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  const loadError = (detailQuery.error ?? attendanceQuery.error) as Error | null;
  if (detailQuery.isError || attendanceQuery.isError || !seance) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/teacher/attendance")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux présences
        </Button>
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {loadError?.message ??
                "Cette séance est introuvable ou ne vous est pas affectée."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/teacher/attendance")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux présences
        </Button>
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
          <div>
            <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
              <UserCheck className="h-7 w-7 text-indigo-500" />
              {seance.seance_libelle || seance.ecue_libelle}
            </h1>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              <span className="font-mono">{seance.ecue_code}</span> {seance.ecue_libelle}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="w-fit">
                {seance.nb_marques > 0 ? "Appel effectué" : "Appel à faire"}
              </Badge>
              <Button
                onClick={save}
                disabled={markMut.isPending || students.length === 0}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
              >
                {markMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Enregistrer l'appel
              </Button>
            </div>
            <div className="text-sm">
              {error ? (
                <span className="text-red-700 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </span>
              ) : dirty ? (
                <span className="text-amber-700">Modifications non enregistrées.</span>
              ) : saved ? (
                <span className="text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Appel enregistré.
                </span>
              ) : (
                <span className="text-muted-foreground">Aucune modification en attente.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contexte de la séance */}
      <Card className="shadow-sm">
        <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <InfoItem icon={<CalendarDays className="h-4 w-4" />} label="Date">
            {fmtDate(seance.date)}
          </InfoItem>
          <InfoItem icon={<Clock className="h-4 w-4" />} label="Horaire">
            {seance.heure_debut || seance.heure_fin
              ? `${fmtHeure(seance.heure_debut)} – ${fmtHeure(seance.heure_fin)}`
              : "Non précisé"}
          </InfoItem>
          <InfoItem icon={<BookOpen className="h-4 w-4" />} label="ECUE">
            <span className="font-mono text-sm">{seance.ecue_code}</span> {seance.ecue_libelle}
          </InfoItem>
          <InfoItem icon={<Layers className="h-4 w-4" />} label="UE">
            <span className="font-mono text-sm">{seance.ue_code}</span> {seance.ue_libelle}
          </InfoItem>
          <InfoItem icon={<GraduationCap className="h-4 w-4" />} label="Filière">
            {seance.filiere_nom ?? seance.filiere_code}
          </InfoItem>
          <InfoItem icon={<UserCheck className="h-4 w-4" />} label="Session">
            <span className="block">{seance.session_libelle}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {STATUT_LABEL[seance.session_statut] ?? seance.session_statut}
            </span>
          </InfoItem>
        </CardContent>
      </Card>

      {/* Synthèse */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Présents" value={counts.present} tone={ATTENDANCE_TONE.present} />
        <StatTile label="Absents" value={counts.absent} tone={ATTENDANCE_TONE.absent} />
        <StatTile label="Retards" value={counts.retard} tone={ATTENDANCE_TONE.retard} />
        <StatTile label="Excusés" value={counts.excuse} tone={ATTENDANCE_TONE.excuse} />
        <StatTile
          label="Inscrits"
          value={students.length}
          tone="bg-muted/40 text-foreground border-border"
        />
      </div>

      {/* Feuille de présence */}
      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-indigo-500" />
              <span className="font-semibold">Liste de présence</span>
              <span className="text-sm text-muted-foreground">
                · {students.length} inscrit{students.length > 1 ? "s" : ""}
                {nonPointes > 0 ? ` · ${nonPointes} non pointé${nonPointes > 1 ? "s" : ""}` : ""}
              </span>
            </div>
            {students.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setAll("present")}>
                  Tout présent
                </Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setAll("absent")}>
                  Tout absent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!dirty}
                  onClick={() => {
                    setStatuts(initial);
                    setSaved(false);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Annuler
                </Button>
              </div>
            )}
          </div>

          {students.length === 0 ? (
            <div className="text-center py-14 px-6">
              <div className="rounded-full bg-indigo-50 p-4 w-fit mx-auto">
                <UserCheck className="h-8 w-8 text-indigo-500" />
              </div>
              <p className="text-muted-foreground mt-3 max-w-md mx-auto">
                Aucun étudiant inscrit confirmé sur cette session : il n'y a pas d'appel à faire. Si des étudiants y sont pourtant inscrits, leurs frais d'inscription ne sont pas soldés — une inscription « en attente de paiement » n'ouvre pas la scolarité. Signalez-le à la scolarité.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border bg-muted/20">
                    <th className="px-4 py-2.5 font-medium w-12">#</th>
                    <th className="px-4 py-2.5 font-medium">Étudiant</th>
                    <th className="px-4 py-2.5 font-medium w-52">Présence</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, i) => (
                    <tr
                      key={s.student_id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium">
                          {s.last_name} {s.first_name}
                        </span>
                        {!s.attendance_statut && (
                          <span className="ml-2 inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
                            Non pointé
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Select
                          value={statuts[s.student_id] ?? "present"}
                          onValueChange={(v) => {
                            setStatuts((p) => ({ ...p, [s.student_id]: v }));
                            setSaved(false);
                          }}
                        >
                          <SelectTrigger
                            className={`h-9 ${ATTENDANCE_TONE[statuts[s.student_id] ?? "present"]}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ATTENDANCE.map((a) => (
                              <SelectItem key={a} value={a}>
                                {ATTENDANCE_LABEL[a]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
