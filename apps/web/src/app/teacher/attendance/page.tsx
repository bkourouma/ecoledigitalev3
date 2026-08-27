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
  History,
  Eye,
  Plus,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useTeacherSessions, useTeacherAttendanceHistory } from "@/lib/hooks/use-professional-teacher";
import { isSessionActive } from "@/lib/professional-sessions";

/**
 * Présences — Espace enseignant (Module Professionnel).
 * Par défaut : historique de toutes les présences effectuées (filtrable par
 * année scolaire et nom de classe). Le bouton « Nouvelle présence » mène à la page
 * dédiée pour choisir une session, planifier ses séances et faire l'appel.
 */

const PAGE_SIZES = [10, 20, 50];

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}


/**
 * Nom de classe porté par une ligne : le libellé de sa session, amputé du
 * suffixe « — CODE UE ». Une classe pouvant porter plusieurs noms, c'est lui
 * qui identifie le groupe suivi, pas la filière.
 */
/**
 * Année scolaire d'une cohorte, d'après sa date de début. La bascule est
 * fixée au 1er septembre, comme dans les requêtes du module professionnel :
 * une même classe doit porter la même année ici et côté administration.
 */
function anneeScolaireOf(date?: string | null): string {
  const d = date ? new Date(date) : null;
  if (!d || isNaN(d.getTime())) return "";
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

function nomDeClasseOf(r: any): string {
  // Les cohortes exposent « libelle », l'historique « session_libelle ».
  const lib = String(r.session_libelle ?? r.libelle ?? "").trim();
  const code = String(r.ue_code ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return lib;
}

export default function TeacherAttendancePage() {
  const router = useRouter();
  const sessionsQuery = useTeacherSessions();
  const historyQuery = useTeacherAttendanceHistory();
  // L'année scolaire commande le filtre : elle restreint les noms proposés.
  const [annee, setAnnee] = useState("all");
  // Filtre au grain du nom de classe : « filiereId|nom ».
  const [filiere, setFiliere] = useState("all");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const sessions: any[] = (sessionsQuery.data as any[]) ?? [];
  const history: any[] = (historyQuery.data as any[]) ?? [];

  // L'appel ne se fait que sur des sessions encore actives.
  const activeSessions = useMemo(() => sessions.filter(isSessionActive), [sessions]);

  // Les séances de l'historique ne portent pas de date de cohorte : leur
  // année scolaire se lit sur la session dont elles relèvent.
  const anneeParSession = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) map.set(s.id, anneeScolaireOf(s.date_debut));
    return map;
  }, [sessions]);

  // Années scolaires des cohortes auxquelles l'enseignant est affecté.
  // Toutes, et pas seulement les actives : l'historique couvre aussi les
  // séances des cohortes déjà terminées.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const a = anneeScolaireOf(s.date_debut);
      if (a) set.add(a);
    }
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [sessions]);

  // Noms de classe de ces mêmes cohortes, restreints à l'année retenue.
  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      const nom = nomDeClasseOf(s);
      if (!s.filiere_id || !nom) continue;
      if (annee !== "all" && anneeScolaireOf(s.date_debut) !== annee) continue;
      map.set(`${s.filiere_id}|${nom}`, nom);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [sessions, annee]);

  const filteredHistory = useMemo(
    () =>
      history.filter(
        (h) =>
          (annee === "all" || anneeParSession.get(h.ue_session_id) === annee) &&
          (filiere === "all" || `${h.filiere_id}|${nomDeClasseOf(h)}` === filiere)
      ),
    [history, annee, anneeParSession, filiere]
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
  function changeAnnee(value: string) {
    setAnnee(value);
    // Le nom retenu peut ne pas exister dans la nouvelle année.
    setFiliere("all");
    setPage(1);
  }

  function changeFiliere(value: string) {
    setFiliere(value);
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
            <label className="text-sm font-medium">Année scolaire</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={annee}
                onChange={changeAnnee}
                icon={<CalendarDays className="h-4 w-4 text-gray-400" />}
                placeholder="Toutes les années"
                searchPlaceholder="Rechercher une année…"
                options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Nom de classe</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={filiere}
                onChange={changeFiliere}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder="Tous les noms de classe"
                searchPlaceholder="Rechercher un nom de classe…"
                options={[
                  { value: "all", label: "Tous les noms de classe" },
                  ...filiereOptions,
                ]}
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
