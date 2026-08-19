"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  Loader2,
  AlertCircle,
  UserCheck,
  Layers,
  ListFilter,
  History,
  Eye,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useTeacherSessions, useTeacherAttendanceHistory } from "@/lib/hooks/use-professional-teacher";
import { isSessionActive } from "@/lib/professional-sessions";

/**
 * Présences — Espace enseignant (Module Professionnel).
 * Par défaut : historique de toutes les présences effectuées (filtrable par
 * filière et statut de session). Le bouton « Nouvelle présence » mène à la page
 * dédiée pour choisir une session, planifier ses séances et faire l'appel.
 */

const EN_COURS = ["ouvert", "en_cours", "complet", "brouillon"];

const PAGE_SIZES = [10, 20, 50];

const STATUT_FILTER = [
  { value: "all", label: "Toutes" },
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminées" },
];

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

function statutMatch(sessionStatut: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "termine") return sessionStatut === "termine";
  return EN_COURS.includes(sessionStatut);
}

export default function TeacherAttendancePage() {
  const router = useRouter();
  const sessionsQuery = useTeacherSessions();
  const historyQuery = useTeacherAttendanceHistory();
  const [filiere, setFiliere] = useState("all");
  const [statut, setStatut] = useState("all");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const sessions: any[] = (sessionsQuery.data as any[]) ?? [];
  const history: any[] = (historyQuery.data as any[]) ?? [];

  // L'appel ne se fait que sur des sessions encore actives.
  const activeSessions = useMemo(() => sessions.filter(isSessionActive), [sessions]);

  // Seules les filières ayant encore une session active sont proposées au filtre.
  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSessions) {
      if (s.filiere_id) map.set(s.filiere_id, `${s.filiere_nom ?? s.filiere_code} (${s.filiere_code})`);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [activeSessions]);

  const filteredHistory = useMemo(
    () =>
      history.filter(
        (h) =>
          (filiere === "all" || h.filiere_id === filiere) && statutMatch(h.session_statut, statut)
      ),
    [history, filiere, statut]
  );

  // Pagination client : l'historique est déjà chargé en entier.
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  // Borne la page courante : un filtre plus restrictif peut la rendre caduque.
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const pagedHistory = useMemo(
    () => filteredHistory.slice(firstIndex, firstIndex + pageSize),
    [filteredHistory, firstIndex, pageSize]
  );

  // Tout changement de filtre ou de taille de page ramène en tête de liste.
  function changeFiliere(value: string) {
    setFiliere(value);
    setPage(1);
  }

  function changeStatut(value: string) {
    setStatut(value);
    setPage(1);
  }

  function changePageSize(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  const isLoading = sessionsQuery.isLoading || historyQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (sessionsQuery.isError) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(sessionsQuery.error as Error)?.message ?? "Impossible de charger vos sessions."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
            <UserCheck className="h-7 w-7 text-indigo-500" />
            Présences
          </h1>
          <p className="text-muted-foreground mt-2">
            Historique de vos présences. Cliquez sur « Nouvelle présence » pour faire l'appel.
          </p>
        </div>
        <Button
          onClick={() => router.push("/teacher/attendance/new")}
          disabled={activeSessions.length === 0}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle présence
        </Button>
      </div>

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Filière</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={filiere}
                onChange={changeFiliere}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder="Toutes les filières"
                searchPlaceholder="Rechercher une filière…"
                options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Statut</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={statut}
                onChange={changeStatut}
                icon={<ListFilter className="h-4 w-4 text-gray-400" />}
                placeholder="Toutes"
                options={STATUT_FILTER}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Historique */}
      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
            <History className="h-4 w-4 text-indigo-500" />
            <span className="font-semibold">Historique des présences</span>
            <span className="text-sm text-muted-foreground">
              · {filteredHistory.length} séance{filteredHistory.length > 1 ? "s" : ""}
            </span>
          </div>
          {filteredHistory.length === 0 ? (
            <div className="text-center py-14 px-6">
              <div className="rounded-full bg-indigo-50 p-4 w-fit mx-auto">
                <UserCheck className="h-8 w-8 text-indigo-500" />
              </div>
              <p className="text-muted-foreground mt-3 max-w-md mx-auto">
                {history.length === 0
                  ? "Aucune séance planifiée. Cliquez sur « Nouvelle présence » pour planifier une séance et faire l'appel."
                  : "Aucune séance ne correspond à ces filtres."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border bg-muted/20">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Séance</th>
                    <th className="px-4 py-2.5 font-medium">ECUE</th>
                    <th className="px-3 py-2.5 font-medium text-center">Prés.</th>
                    <th className="px-3 py-2.5 font-medium text-center">Abs.</th>
                    <th className="px-3 py-2.5 font-medium text-center">Ret.</th>
                    <th className="px-3 py-2.5 font-medium text-center">Exc.</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedHistory.map((h) => (
                    <tr key={h.seance_id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {fmtDate(h.date)}
                        {h.heure_debut ? ` · ${String(h.heure_debut).slice(0, 5)}` : ""}
                      </td>
                      <td className="px-4 py-2.5 font-medium">
                        {h.seance_libelle || h.ecue_libelle}
                      </td>
                      <td className="px-4 py-2.5">{h.ecue_libelle}</td>
                      {h.nb_marques > 0 ? (
                        <>
                          <td className="px-3 py-2.5 text-center font-semibold text-green-700">{h.nb_present}</td>
                          <td className="px-3 py-2.5 text-center font-semibold text-red-700">{h.nb_absent}</td>
                          <td className="px-3 py-2.5 text-center text-amber-700">{h.nb_retard}</td>
                          <td className="px-3 py-2.5 text-center text-blue-700">{h.nb_excuse}</td>
                        </>
                      ) : (
                        <td className="px-3 py-2.5 text-center" colSpan={4}>
                          <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
                            Appel à faire
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => router.push(`/teacher/attendance/${h.seance_id}`)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1.5" />
                          Détails
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filteredHistory.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Lignes par page</span>
                <Select value={String(pageSize)} onValueChange={changePageSize}>
                  <SelectTrigger className="h-8 w-[4.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>
                  {firstIndex + 1}–{firstIndex + pagedHistory.length} sur {filteredHistory.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Précédent
                </Button>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  Page {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Suivant
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
