"use client";

<<<<<<< HEAD
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
=======
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, Input } from "@ecoledigitale/ui";
import {
  ClipboardCheck,
  Layers,
  CalendarRange,
  Calendar,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Search,
  GraduationCap,
  Clock,
  UserRound,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useNotesFilieres,
  useNotesSemestres,
  usePresencesHistory,
} from "@/lib/hooks/use-professional-bulletins";

/**
 * Présences — Module Professionnel (admin).
 * Historique complet des appels effectués dans l'application : par filière,
 * statut de session (en cours / terminées) et semestre. Récapitulatif par
 * étudiant avec les heures d'absence calculées sur la durée réelle des cours,
 * et journal des séances avec l'enseignant ayant effectué l'appel.
 */

const STATUT_OPTIONS = [
  { value: "all", label: "Toutes les sessions" },
  { value: "en_cours", label: "Sessions en cours" },
  { value: "terminee", label: "Sessions terminées" },
];

/** 4.5 → « 4h30 » ; 2 → « 2h » ; 0 → « 0h ». */
function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

function fmtDuree(min: number | null | undefined): string {
  const v = Number(min ?? 0);
  if (v <= 0) return "—";
  return fmtHeures(v / 60);
}

function fmtDateFr(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString("fr-FR");
}

function hm(t: string | null | undefined): string {
  return t ? String(t).slice(0, 5) : "—";
}

/**
 * Année scolaire (pivot septembre) dérivée de la date de début du semestre,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et les autres
 * pages : un semestre démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export default function AdminPresencesPage() {
  const [filiereId, setFiliereId] = useState("");
  const [annee, setAnnee] = useState("all");
  const [statut, setStatut] = useState("all");
  const [semestreId, setSemestreId] = useState("");
  const [search, setSearch] = useState("");

  const filieresQuery = useNotesFilieres();
  const semestresQuery = useNotesSemestres(filiereId || null);
  const historyQuery = usePresencesHistory({
    filiereId: filiereId || null,
    semestreId: semestreId || undefined,
    statut,
  });

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];
  const semestresRaw: any[] = filiereId ? ((semestresQuery.data as any[]) ?? []) : [];
  const semestres = useMemo(
    () => semestresRaw.map((s) => ({ ...s, annee_scolaire: anneeScolaireOf(s.date_debut) })),
    [semestresRaw]
  );

  // Années scolaires disponibles pour la filière (plus récentes en premier).
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of semestres) if (s.annee_scolaire) set.add(s.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [semestres]);

  // Semestres filtrés par année scolaire sélectionnée.
  const visibleSemestres = useMemo(
    () => semestres.filter((s) => annee === "all" || s.annee_scolaire === annee),
    [semestres, annee]
  );

  // Si l'année sélectionnée n'existe plus (changement de filière), on réinitialise.
  useEffect(() => {
    if (annee !== "all" && !anneeOptions.some((o) => o.value === annee)) setAnnee("all");
  }, [anneeOptions, annee]);

  // Si le semestre sélectionné n'est plus visible (filtre année), on le désélectionne.
  useEffect(() => {
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) setSemestreId("");
  }, [visibleSemestres, semestreId]);

  const seances: any[] = (historyQuery.data as any)?.seances ?? [];
  const students: any[] = (historyQuery.data as any)?.students ?? [];

  const q = search.trim().toLowerCase();
  const filteredStudents = useMemo(
    () =>
      q
        ? students.filter((s) =>
            `${s.first_name} ${s.last_name} ${s.matricule ?? ""}`.toLowerCase().includes(q)
          )
        : students,
    [students, q]
  );
  const filteredSeances = useMemo(
    () =>
      q
        ? seances.filter((s) =>
            `${s.ecue_libelle ?? ""} ${s.ue_libelle ?? ""} ${s.enseignant_nom ?? ""} ${
              s.marque_par ?? ""
            }`
              .toLowerCase()
              .includes(q)
          )
        : seances,
    [seances, q]
  );

  const stats = useMemo(() => {
    const appels = seances.filter((s) => Number(s.nb_marques) > 0);
    const heuresPointees = appels.reduce((sum, s) => sum + Number(s.duree_minutes || 0) / 60, 0);
    const heuresAbsence = students.reduce((sum, s) => sum + Number(s.heures_absence || 0), 0);
    const totalMarques = students.reduce((sum, s) => sum + Number(s.nb_appels || 0), 0);
    const totalPresents = students.reduce((sum, s) => sum + Number(s.nb_present || 0), 0);
    const taux = totalMarques > 0 ? Math.round((totalPresents / totalMarques) * 100) : null;
    return {
      appels: appels.length,
      seances: seances.length,
      heuresPointees,
      heuresAbsence,
      taux,
    };
  }, [seances, students]);

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <ClipboardCheck className="h-7 w-7 text-indigo-500" />
          Présences
        </h1>
        <p className="text-muted-foreground mt-2">
          Historique de tous les appels effectués : heures d'absence par étudiant (selon la durée
          des cours) et journal des séances avec l'enseignant.
        </p>
      </div>

      {/* Filtres — deux en haut (filière, année), deux en bas (statut, semestre) */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={filiereId}
              onChange={(v) => {
                setFiliereId(v);
                setAnnee("all");
                setSemestreId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={filieresQuery.isLoading ? "Chargement…" : "Filière"}
              searchPlaceholder="Rechercher une filière…"
              options={filieres.map((f) => ({
                value: f.id,
                label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
              }))}
            />
            <SearchableSelect
              value={annee}
              onChange={setAnnee}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Toutes les années"}
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={statut}
              onChange={setStatut}
              icon={<CheckCircle2 className="h-4 w-4 text-gray-400" />}
              placeholder="Statut des sessions"
              options={STATUT_OPTIONS}
            />
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Tous les semestres"}
              options={[
                { value: "", label: "Tous les semestres" },
                ...visibleSemestres.map((s) => ({ value: s.id, label: s.libelle })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contenu */}
      {!filiereId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière (puis, au besoin, un statut de session et un semestre) pour
              afficher l'historique des présences.
            </p>
          </CardContent>
        </Card>
      ) : historyQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : historyQuery.isError ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(historyQuery.error as Error)?.message ?? "Impossible de charger les présences."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Appels effectués"
              value={`${stats.appels}/${stats.seances}`}
              hint="séances pointées / planifiées"
              color="from-indigo-500 to-blue-600"
            />
            <StatCard
              label="Heures pointées"
              value={fmtHeures(stats.heuresPointees)}
              hint="volume de cours avec appel"
              color="from-emerald-500 to-green-600"
            />
            <StatCard
              label="Heures d'absence"
              value={fmtHeures(stats.heuresAbsence)}
              hint="cumul de tous les étudiants"
              color="from-red-500 to-rose-600"
            />
            <StatCard
              label="Taux de présence"
              value={stats.taux == null ? "—" : `${stats.taux}%`}
              hint="présents / pointages"
              color="from-amber-500 to-orange-600"
            />
          </div>

          {/* Recherche */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un étudiant, une matière, un enseignant…"
              className="pl-9"
            />
          </div>

          {/* Récapitulatif par étudiant */}
          <Card className="shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <UserRound className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">Récapitulatif par étudiant</span>
              <span className="text-xs text-muted-foreground">
                · heures d'absence calculées sur la durée réelle des séances
              </span>
            </div>
            <CardContent className="p-0 overflow-auto max-h-[60vh]">
              {filteredStudents.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Aucun pointage enregistré pour cette sélection.
                </p>
              ) : (
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Étudiant</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Pointages</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Présent</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Absent</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Retard</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Excusé</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">
                        Heures d'absence
                      </th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium text-right">
                        Taux de présence
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => {
                      const taux =
                        Number(s.nb_appels) > 0
                          ? Math.round((Number(s.nb_present) / Number(s.nb_appels)) * 100)
                          : null;
                      return (
                        <tr
                          key={s.student_id}
                          className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="font-medium">
                              {s.first_name} {s.last_name}
                            </span>
                            {s.matricule && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {s.matricule}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono">{s.nb_appels}</td>
                          <td className="px-3 py-2.5 text-center font-mono text-green-600">
                            {s.nb_present}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-red-600">
                            {s.nb_absent}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-amber-600">
                            {s.nb_retard}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-blue-600">
                            {s.nb_excuse}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                                Number(s.heures_absence) > 0
                                  ? "bg-red-100 text-red-700"
                                  : "bg-green-100 text-green-700"
                              }`}
                              title={
                                Number(s.heures_excusees) > 0
                                  ? `+ ${fmtHeures(s.heures_excusees)} excusées`
                                  : undefined
                              }
                            >
                              <Clock className="h-3 w-3" />
                              {fmtHeures(s.heures_absence)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {taux == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span
                                className={`font-mono font-semibold ${
                                  taux >= 80
                                    ? "text-green-600"
                                    : taux >= 60
                                    ? "text-amber-600"
                                    : "text-red-600"
                                }`}
                              >
                                {taux}%
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Historique des appels (séances) */}
          <Card className="shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <ClipboardCheck className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">Historique des appels</span>
              <span className="text-xs text-muted-foreground">
                · {filteredSeances.length} séance{filteredSeances.length > 1 ? "s" : ""} · de la plus
                récente à la plus ancienne
              </span>
            </div>
            <CardContent className="p-0 overflow-auto max-h-[65vh]">
              {filteredSeances.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Aucune séance pour cette sélection.
                </p>
              ) : (
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Date</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium">Horaire · Durée</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Matière (ECUE)</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Enseignant</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Présents</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Absents</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Retards</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Excusés</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium text-right">Appel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSeances.map((s) => (
                      <tr
                        key={s.seance_id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap font-medium">
                          {fmtDateFr(s.date)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs">
                          {hm(s.heure_debut)}–{hm(s.heure_fin)}
                          <span className="ml-1.5 text-muted-foreground">
                            · {fmtDuree(s.duree_minutes)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div>{s.ecue_libelle ?? s.ecue_code}</div>
                          <div className="text-xs text-muted-foreground">{s.ue_libelle}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {s.enseignant_nom || s.marque_par || (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {s.enseignant_nom &&
                            s.marque_par &&
                            s.marque_par !== s.enseignant_nom && (
                              <div
                                className="text-[10px] text-muted-foreground"
                                title="Utilisateur ayant enregistré l'appel"
                              >
                                appel : {s.marque_par}
                              </div>
                            )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-green-600">
                          {s.nb_present}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-red-600">
                          {s.nb_absent}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-amber-600">
                          {s.nb_retard}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-blue-600">
                          {s.nb_excuse}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {Number(s.nb_marques) > 0 ? (
                            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              Effectué
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                              À faire
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
>>>>>>> 030-pedagogie-ue-ecue
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
<<<<<<< HEAD
=======

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
  hint: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-white/70 text-xs mt-0.5">{hint}</p>
    </div>
  );
}
>>>>>>> 030-pedagogie-ue-ecue
