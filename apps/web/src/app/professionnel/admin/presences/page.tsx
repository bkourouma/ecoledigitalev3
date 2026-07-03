"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ecoledigitale/ui";
import {
  CalendarDays,
  Users,
  CheckCircle2,
  HelpCircle,
  ClipboardCheck,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  useProfessionalUeSessionsList,
  useProfessionalSeances,
  useSeanceAttendance,
} from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Présences professionnelles — Module Professionnel (feature 028, US4/US6).
 * Consultation admin des présences enregistrées par les enseignants, par session.
 */

const ATTENDANCE_LABEL: Record<string, string> = {
  present: "Présent",
  absent: "Absent",
  retard: "Retard",
  excuse: "Excusé",
};

const ATTENDANCE_BADGE: Record<string, string> = {
  present: "bg-green-500/15 text-green-400",
  absent: "bg-red-500/15 text-red-400",
  retard: "bg-amber-500/15 text-amber-400",
  excuse: "bg-blue-500/15 text-blue-400",
};

function AttendanceBadge({ statut }: { statut: string | null }) {
  if (!statut) {
    return (
      <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        Non pointé
      </span>
    );
  }
  const cls = ATTENDANCE_BADGE[statut] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {ATTENDANCE_LABEL[statut] ?? statut}
    </span>
  );
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function ProfessionalAttendancePage() {
  const [sessionId, setSessionId] = useState("");
  const [seanceId, setSeanceId] = useState("");

  const sessionsQuery = useProfessionalUeSessionsList({});
  const seancesQuery = useProfessionalSeances(sessionId || null);
  const attendanceQuery = useSeanceAttendance(seanceId || null);

  const sessions: any[] = sessionsQuery.data?.items ?? [];
  const seances: any[] = seancesQuery.data ?? [];
  const attendance: any[] = attendanceQuery.data?.items ?? [];

  const nbPresents = useMemo(
    () => attendance.filter((a) => a.attendance_statut === "present").length,
    [attendance]
  );
  const nbNonPointes = useMemo(
    () => attendance.filter((a) => !a.attendance_statut).length,
    [attendance]
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-green-500 to-blue-500 bg-clip-text text-transparent">
          Présences professionnelles
        </h1>
        <p className="text-muted-foreground mt-2">
          Consultez les présences enregistrées par les enseignants pour chaque
          session.
        </p>
      </div>

      {/* Sélection de la session */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="w-full lg:w-[40rem]">
            <label className="text-sm font-medium text-foreground mb-1.5 block">Session</label>
            <Select
              value={sessionId || undefined}
              onValueChange={(v) => {
                setSessionId(v);
                setSeanceId("");
              }}
            >
              <SelectTrigger className="h-11">
                <CalendarDays className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Choisir une session" />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.ue_code} — {s.libelle} ({fmtDate(s.date_debut)} →{" "}
                    {fmtDate(s.date_fin)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sessionId && (
            <div className="w-full lg:w-[40rem] mt-4">
              <label className="text-sm font-medium text-foreground mb-1.5 block">Séance</label>
              <Select value={seanceId || undefined} onValueChange={setSeanceId}>
                <SelectTrigger className="h-11">
                  <ClipboardCheck className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Choisir une séance" />
                </SelectTrigger>
                <SelectContent>
                  {seances.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {fmtDate(s.date)} · {s.ecue_code} {s.ecue_libelle}
                      {s.heure_debut ? ` (${s.heure_debut})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aucune séance sélectionnée */}
      {!seanceId && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <ClipboardCheck className="h-10 w-10 text-green-400" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Sélectionnez une séance
                </h3>
                <p className="text-muted-foreground">
                  Choisissez une session puis une séance pour consulter la feuille de présence.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {seanceId && (
        <>
          {/* Statistiques rapides */}
          {!attendanceQuery.isLoading && !attendanceQuery.isError && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/80 text-sm font-medium">
                      Étudiants inscrits
                    </p>
                    <p className="text-3xl font-bold mt-1">
                      {attendance.length}
                    </p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-lg">
                    <Users className="h-6 w-6" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/80 text-sm font-medium">
                      Présents
                    </p>
                    <p className="text-3xl font-bold mt-1">{nbPresents}</p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-lg">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/80 text-sm font-medium">
                      Non pointés
                    </p>
                    <p className="text-3xl font-bold mt-1">{nbNonPointes}</p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-lg">
                    <HelpCircle className="h-6 w-6" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Feuille de présence */}
          <Card className="shadow-lg">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-green-400" />
                <h2 className="font-semibold text-foreground">
                  Feuille de présence
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({attendance.length})
                  </span>
                </h2>
              </div>

              {attendanceQuery.isLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-14 h-14 flex items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-green-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    Chargement des présences…
                  </p>
                </div>
              ) : attendanceQuery.isError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-14 h-14 bg-red-500/15 rounded-full flex items-center justify-center">
                    <AlertCircle className="h-7 w-7 text-red-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    {(attendanceQuery.error as Error)?.message ??
                      "Impossible de charger les présences."}
                  </p>
                </div>
              ) : attendance.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-14 h-14 flex items-center justify-center">
                    <Users className="h-7 w-7 text-green-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    Aucun étudiant confirmé sur cette session.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead>Étudiant</TableHead>
                        <TableHead>Présence</TableHead>
                        <TableHead>Pointé le</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.map((a) => (
                        <TableRow key={a.student_id}>
                          <TableCell className="font-medium text-foreground">
                            {a.first_name} {a.last_name}
                          </TableCell>
                          <TableCell>
                            <AttendanceBadge statut={a.attendance_statut} />
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {fmtDateTime(a.marked_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
