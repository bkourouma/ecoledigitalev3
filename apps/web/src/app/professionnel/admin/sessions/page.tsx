"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  Plus,
  Loader2,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  Calendar,
  BookOpen,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import {
  useProfessionalUeSessionsList,
  useDeleteProfessionalUeSession,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useReopenSessions } from "@/lib/hooks/use-professional-semestres";
import { SearchableSelect } from "@/components/SearchableSelect";

const PAGE_SIZE = 12;

/**
 * Liste des sessions professionnelles — Module Professionnel (feature 028, US1).
 * Affichage aligné sur les matières : liste en cartes, statistiques, filtre.
 * Les enseignants sont affectés par ECUE (voir le détail d'une session), donc
 * les cartes n'affichent plus d'enseignant unique ni la capacité/inscriptions.
 */

const STATUT_GRADIENT: Record<string, string> = {
  ouvert: "from-green-500 via-teal-500 to-blue-500",
  en_cours: "from-blue-500 via-indigo-500 to-purple-500",
  complet: "from-amber-500 via-orange-500 to-red-500",
  brouillon: "from-slate-400 via-slate-500 to-slate-600",
  termine: "from-gray-500 via-gray-600 to-gray-700",
  annule: "from-gray-400 via-gray-500 to-gray-600",
};

/** Libellés accentués des statuts de session. */
const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  ouvert: "Ouvert",
  complet: "Complet",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export default function ProfessionalSessionsListPage() {
  const router = useRouter();
  const [filiereFilter, setFiliereFilter] = useState<string>("all");
  const [tab, setTab] = useState<"actives" | "historique">("actives");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const sessionsQuery = useProfessionalUeSessionsList({ pageSize: 500 });
  const deleteMut = useDeleteProfessionalUeSession();
  const reopenMut = useReopenSessions();

  const sessions: any[] = sessionsQuery.data?.items ?? [];

  // Options de filtre par filière (déduites des sessions chargées).
  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.filiere_code) {
        map.set(
          s.filiere_code,
          `${s.filiere_nom ?? s.filiere_code} (${s.filiere_code})`
        );
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

  const nbOuvertes = useMemo(
    () => sessions.filter((s) => s.statut === "ouvert").length,
    [sessions]
  );

  const filteredSessionsCount = useMemo(
    () =>
      sessions.filter((s) => filiereFilter === "all" || s.filiere_code === filiereFilter).length,
    [sessions, filiereFilter]
  );

  // Regroupe les sessions d'un même lot (semestre + dates + libellé) dans une
  // seule carte. Les sessions sans semestre restent individuelles.
  const groups = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of sessions) {
      const suffix = s.ue_code ? ` — ${s.ue_code}` : "";
      const prefix =
        suffix && s.libelle?.endsWith(suffix)
          ? s.libelle.slice(0, -suffix.length)
          : s.libelle;
      // Clé de lot : semestre si dispo, sinon libellé du lot — + la période.
      // (fonctionne même si l'API ne renvoie pas encore le semestre)
      const key = `${s.semestre_id ?? prefix}|${s.date_debut}|${s.date_fin}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          title: prefix,
          semestre_id: s.semestre_id ?? null,
          semestre_libelle: s.semestre_libelle ?? null,
          filiere_nom: s.filiere_nom ?? null,
          filiere_code: s.filiere_code ?? null,
          date_debut: s.date_debut,
          date_fin: s.date_fin,
          statut: s.statut,
          first_id: s.id,
          items: [] as any[],
        };
        map.set(key, g);
      }
      g.items.push(s);
    }
    return Array.from(map.values());
  }, [sessions]);

  // Onglets : actives (en cours / à venir) vs historique (terminées).
  const nbTermines = useMemo(
    () => groups.filter((g) => g.statut === "termine").length,
    [groups]
  );
  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          (filiereFilter === "all" || g.filiere_code === filiereFilter) &&
          (tab === "historique" ? g.statut === "termine" : g.statut !== "termine")
      ),
    [groups, tab, filiereFilter]
  );

  // Pagination d'affichage (côté client) sur les lots de l'onglet courant.
  const pageCount = Math.max(1, Math.ceil(visibleGroups.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedGroups = useMemo(
    () => visibleGroups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [visibleGroups, currentPage]
  );

  useEffect(() => {
    setPage(1);
  }, [filiereFilter, tab]);

  // Suppression de tout un lot (toutes les sessions d'UE du semestre).
  async function handleDeleteBatch(g: any) {
    setError(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Supprimer ce lot « ${g.title} » ?\n\n${g.items.length} session(s) d'UE seront supprimées (supports et présences liés inclus). Action irréversible.`
      )
    ) {
      return;
    }
    try {
      for (const s of g.items) {
        await deleteMut.mutateAsync(s.id);
      }
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression du lot.");
    }
  }

  // Réouverture d'un lot terminé : on demande une nouvelle date de fin (future).
  async function handleReopenBatch(g: any) {
    setError(null);
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const def = d.toISOString().slice(0, 10);
    const input =
      typeof window !== "undefined"
        ? window.prompt(
            `Rouvrir le lot « ${g.title} » jusqu'à quelle date de fin ? (AAAA-MM-JJ)`,
            def
          )
        : null;
    if (!input) return;
    const newDate = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError("Date invalide (format attendu : AAAA-MM-JJ).");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (newDate <= today) {
      setError("La nouvelle date de fin doit être dans le futur.");
      return;
    }
    try {
      await reopenMut.mutateAsync({
        session_ids: g.items.map((s: any) => s.id),
        date_fin: newDate,
      });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la réouverture du lot.");
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Sessions professionnelles
          </h1>
          <p className="text-muted-foreground mt-2">
            Instances datées d'une matière, avec fenêtre d'inscription et capacité.
          </p>
        </div>
        <Button
          onClick={() => router.push("/professionnel/admin/sessions/new")}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle session
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Statistiques rapides */}
      {!sessionsQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Total sessions</p>
                <p className="text-3xl font-bold mt-1">{sessions.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Calendar className="h-6 w-6" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Sessions ouvertes</p>
                <p className="text-3xl font-bold mt-1">{nbOuvertes}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onglets : sessions actives vs historique (terminées) */}
      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {[
            { id: "actives" as const, label: "Sessions actives", count: groups.length - nbTermines },
            { id: "historique" as const, label: "Historique (terminées)", count: nbTermines },
          ].map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    isActive ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Filtre */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            <div className="w-full lg:w-[32rem]">
              <SearchableSelect
                value={filiereFilter}
                onChange={setFiliereFilter}
                icon={<BookOpen className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par filière"
                searchPlaceholder="Rechercher une filière…"
                options={[
                  { value: "all", label: "Toutes les filières" },
                  ...filiereOptions,
                ]}
              />
            </div>
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredSessionsCount}</span>
              <span className="ml-1">
                {filteredSessionsCount === 1 ? "session affichée" : "sessions affichées"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chargement */}
      {sessionsQuery.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des sessions…</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erreur */}
      {sessionsQuery.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <p className="text-muted-foreground">
                {(sessionsQuery.error as Error)?.message ??
                  "Impossible de charger les sessions."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cartes regroupées : un lot (semestre + dates) = une carte */}
      {!sessionsQuery.isLoading && visibleGroups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pagedGroups.map((g) => {
            const gradient =
              STATUT_GRADIENT[g.statut] ?? "from-gray-400 via-gray-500 to-gray-600";
            const totalUv = g.items.reduce((a: number, it: any) => a + (it.ue_nb_uv ?? 0), 0);
            return (
              <div
                key={g.key}
                className={`bg-gradient-to-br ${gradient} p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group`}
              >
                <div className="relative z-10">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h3 className="font-semibold text-lg">{g.title}</h3>
                    <span className="bg-white/20 text-xs font-medium px-2 py-0.5 rounded shrink-0">
                      {STATUT_LABEL[g.statut] ?? g.statut}
                    </span>
                  </div>

                  <div className="space-y-1 mb-3 text-sm">
                    {(g.semestre_libelle || g.filiere_nom) && (
                      <p className="text-white/90">
                        {g.filiere_nom ? (
                          <>
                            {g.filiere_nom}
                            {g.filiere_code ? ` (${g.filiere_code})` : ""}
                            {g.semestre_libelle ? " · " : ""}
                          </>
                        ) : null}
                        {g.semestre_libelle ? (
                          <span className="font-medium">{g.semestre_libelle}</span>
                        ) : null}
                      </p>
                    )}
                    <p className="text-white/90">
                      <span className="font-medium">Période :</span> {fmtDate(g.date_debut)} →{" "}
                      {fmtDate(g.date_fin)}
                    </p>
                    <p className="text-white/80 text-xs">
                      {g.items.length} UE · {totalUv} crédits
                    </p>
                  </div>

                  {/* Actions du lot */}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={() =>
                        router.push(
                          g.semestre_id
                            ? `/professionnel/admin/sessions/semestre/${g.semestre_id}`
                            : `/professionnel/admin/sessions/${g.first_id}`
                        )
                      }
                      title="Voir le détail"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {g.statut === "termine" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                        onClick={() => handleReopenBatch(g)}
                        disabled={reopenMut.isPending}
                        title="Rouvrir le lot (nouvelle date de fin)"
                      >
                        {reopenMut.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                        onClick={() =>
                          router.push(
                            g.semestre_id
                              ? `/professionnel/admin/sessions/semestre/${g.semestre_id}`
                              : `/professionnel/admin/sessions/${g.first_id}/edit`
                          )
                        }
                        title="Modifier"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-red-50 hover:bg-red-100 text-red-600 border-red-100 transition-all duration-200 p-2"
                      onClick={() => handleDeleteBatch(g)}
                      disabled={deleteMut.isPending}
                      title="Supprimer"
                    >
                      {deleteMut.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500"></div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!sessionsQuery.isLoading && visibleGroups.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Précédent
          </Button>
          <span className="text-sm text-gray-600">
            Page <span className="font-medium">{currentPage}</span> / {pageCount}
            <span className="ml-2 text-gray-400">({visibleGroups.length} lots)</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
          >
            Suivant
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Vide */}
      {!sessionsQuery.isLoading && !sessionsQuery.isError && visibleGroups.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Calendar className="h-10 w-10 text-green-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {tab === "historique"
                    ? "Aucune session terminée"
                    : "Aucune session active"}
                </h3>
                <p className="text-gray-600 text-lg">
                  {tab === "historique"
                    ? "Les sessions dont la date de fin est passée apparaîtront ici."
                    : filiereFilter === "all"
                    ? "Commencez par créer votre première session."
                    : "Aucune session pour la filière sélectionnée."}
                </p>
              </div>
              <div className="flex gap-3">
                {filiereFilter !== "all" && (
                  <Button variant="outline" onClick={() => setFiliereFilter("all")}>
                    <X className="h-4 w-4 mr-2" />
                    Effacer le filtre
                  </Button>
                )}
                {tab === "actives" && (
                  <Button
                    onClick={() => router.push("/professionnel/admin/sessions/new")}
                    className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Nouvelle session
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
