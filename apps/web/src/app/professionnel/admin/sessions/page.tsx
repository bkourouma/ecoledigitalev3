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
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useProfessionalUeSessionsList,
  useDeleteProfessionalUeSession,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useToutesPortees } from "@/lib/hooks/use-professional-semestres";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { SearchableSelect } from "@/components/SearchableSelect";
import { openSessionReportPdf } from "@/lib/utils/session-report";
import { ouvrirOngletPdf, POPUP_BLOQUEE } from "@/lib/utils/report-pdf";

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

/**
 * Année scolaire (pivot septembre) dérivée de la date de début d'une session,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) : une session
 * démarrant en septembre ou après appartient à « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export default function ProfessionalSessionsListPage() {
  const router = useRouter();
  const [filiereFilter, setFiliereFilter] = useState<string>("all");
  const [anneeFilter, setAnneeFilter] = useState<string>("all");
  const [tab, setTab] = useState<"actives" | "historique">("actives");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** Clé « <lot>:<format> » de l'export en cours, pour n'animer que ce bouton. */
  const [exportEnCours, setExportEnCours] = useState<string | null>(null);

  const sessionsQuery = useProfessionalUeSessionsList({ pageSize: 500 });
  const deleteMut = useDeleteProfessionalUeSession();

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

  // Portées déclarées, indexées comme les cartes : « classe|nom ».
  const porteesQuery = useToutesPortees();
  const porteeParNom = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of porteesQuery.data ?? []) {
      m.set(`${p.classe_id}|${p.nom}`, p.semestre_ids ?? []);
    }
    return m;
  }, [porteesQuery.data]);

  const nbOuvertes = useMemo(
    () => sessions.filter((s) => s.statut === "ouvert").length,
    [sessions]
  );

  /*
   * Filière académique de chaque classe. Le module professionnel appelle
   * « filiere_id » ce qui est en réalité l'identifiant de la CLASSE (table
   * `programmes`) : la vraie filière — celle gérée dans /academic/programmes —
   * se lit sur la classe, d'où cette table de correspondance.
   */
  const programmesQuery = useProgrammes();
  const filiereDeClasse = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of programmesQuery.data?.data ?? []) {
      if (p.filiere?.name) m.set(String(p.id), p.filiere.name);
    }
    return m;
  }, [programmesQuery.data]);

  // Une carte = un NOM DE CLASSE, pas un semestre. Ouvrir un semestre
  // supplémentaire sous le même nom enrichit la carte existante au lieu d'en
  // créer une nouvelle.
  const groups = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of sessions) {
      const suffix = s.ue_code ? ` — ${s.ue_code}` : "";
      const nom =
        suffix && s.libelle?.endsWith(suffix)
          ? s.libelle.slice(0, -suffix.length)
          : s.libelle;
      const key = `${s.filiere_id ?? s.filiere_code ?? ""}|${nom}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          title: nom,
          classe_id: s.filiere_id ?? null,
          filiere_nom: s.filiere_nom ?? null,
          filiere_code: s.filiere_code ?? null,
          first_id: s.id,
          items: [] as any[],
          // Un sous-groupe par semestre, avec sa propre période.
          semestres: new Map<string, any>(),
        };
        map.set(key, g);
      }
      g.items.push(s);

      const semKey = s.semestre_id ?? `__sans__|${s.date_debut}|${s.date_fin}`;
      let sem = g.semestres.get(semKey);
      if (!sem) {
        sem = {
          semestre_id: s.semestre_id ?? null,
          semestre_libelle: s.semestre_libelle ?? null,
          date_debut: s.date_debut,
          date_fin: s.date_fin,
          statut: s.statut,
          first_id: s.id,
          items: [] as any[],
        };
        g.semestres.set(semKey, sem);
      }
      sem.items.push(s);
      if (s.statut !== "termine") sem.statut = s.statut;
      if (s.date_debut < sem.date_debut) sem.date_debut = s.date_debut;
      if (s.date_fin > sem.date_fin) sem.date_fin = s.date_fin;
    }

    return Array.from(map.values()).map((g) => {
      const semestres = (Array.from(g.semestres.values()) as any[]).sort((a: any, b: any) =>
        String(a.semestre_libelle ?? "").localeCompare(String(b.semestre_libelle ?? ""))
      );
      const portee = porteeParNom.get(g.key) ?? null;
      // Nombre de semestres attendus : la portée déclarée, sinon ce qui existe.
      const nbAttendus = portee ? portee.length : semestres.length;
      const nbOuverts = semestres.length;
      const toutesTerminees = g.items.every((it: any) => it.statut === "termine");
      // Un nom part à l'historique seulement quand sa portée est entièrement
      // ouverte ET que la dernière période est expirée.
      const termine = toutesTerminees && nbOuverts >= nbAttendus;
      const dateDebut = semestres.reduce(
        (min: string, sm: any) => (sm.date_debut < min ? sm.date_debut : min),
        semestres[0]?.date_debut
      );
      const dateFin = semestres.reduce(
        (max: string, sm: any) => (sm.date_fin > max ? sm.date_fin : max),
        semestres[0]?.date_fin
      );
      return {
        ...g,
        semestres,
        nb_semestres_ouverts: nbOuverts,
        nb_semestres_attendus: nbAttendus,
        portee_declaree: Boolean(portee),
        date_debut: dateDebut,
        date_fin: dateFin,
        annee_scolaire: anneeScolaireOf(dateDebut),
        statut: termine ? "termine" : semestres.find((sm: any) => sm.statut !== "termine")?.statut ?? "ouvert",
        termine,
      };
    });
  }, [sessions, porteeParNom]);

  // Onglets : actives (en cours / à venir) vs historique (terminées).
  const nbTermines = useMemo(() => groups.filter((g) => g.termine).length, [groups]);

  // Années scolaires disponibles dans l'historique, adaptées à la filière choisie.
  // (dérivées de la date de début, pivot septembre — voir anneeScolaireOf)
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (!g.termine) continue;
      if (filiereFilter !== "all" && g.filiere_code !== filiereFilter) continue;
      if (g.annee_scolaire) set.add(g.annee_scolaire);
    }
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a)) // plus récentes en premier
      .map((value) => ({ value, label: value }));
  }, [groups, filiereFilter]);

  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          (filiereFilter === "all" || g.filiere_code === filiereFilter) &&
          (tab === "historique" ? g.termine : !g.termine) &&
          (tab !== "historique" ||
            anneeFilter === "all" ||
            g.annee_scolaire === anneeFilter)
      ),
    [groups, tab, filiereFilter, anneeFilter]
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
  }, [filiereFilter, tab, anneeFilter]);

  // La liste des années dépend de la filière/onglet : si l'année sélectionnée
  // n'existe plus dans les options, on revient à « Toutes les années ».
  useEffect(() => {
    if (anneeFilter !== "all" && !anneeOptions.some((o) => o.value === anneeFilter)) {
      setAnneeFilter("all");
    }
  }, [anneeOptions, anneeFilter]);

  /**
   * Export PDF d'UN SEUL semestre de la classe : sa fiche et la liste des
   * étudiants inscrits, UE par UE. Volontairement pas d'export global — une
   * fiche couvrant tous les semestres à la fois n'est pas exploitable.
   */
  async function handleExportSemestre(g: any, sm: any) {
    setError(null);
    const win = ouvrirOngletPdf();
    if (!win) {
      setError(POPUP_BLOQUEE);
      return;
    }
    setExportEnCours(`${g.key}|${sm.semestre_id ?? sm.first_id}`);
    try {
      await openSessionReportPdf(
        {
          ...g,
          semestre_libelle: sm.semestre_libelle ?? null,
          date_debut: sm.date_debut,
          date_fin: sm.date_fin,
          annee_scolaire: anneeScolaireOf(sm.date_debut),
          statut: sm.statut,
          items: sm.items,
          classe_filiere_nom: filiereDeClasse.get(String(g.classe_id)) ?? null,
        },
        win
      );
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'export de ce semestre.");
    } finally {
      setExportEnCours(null);
    }
  }

  // Suppression de tout un lot (toutes les sessions d'UE du semestre).
  async function handleDeleteBatch(g: any) {
    setError(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Supprimer ce lot « ${g.title} » ?\n\n${g.items.length} classe(s) d'UE seront supprimées (supports et présences liés inclus). Action irréversible.`
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

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Ouvertures de classe
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Une classe ouverte sur un semestre, avec ses dates et son équipe enseignante.
          </p>
        </div>
        <Button
          onClick={() => router.push("/professionnel/admin/sessions/new")}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Ouvrir une classe
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
                <p className="text-white/80 text-sm font-medium">Total classes</p>
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
                <p className="text-white/80 text-sm font-medium">Classes ouvertes</p>
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
            { id: "actives" as const, label: "Classes ouvertes", count: groups.length - nbTermines },
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
            <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
              <div className="w-full lg:w-[32rem]">
                <SearchableSelect
                  value={filiereFilter}
                  onChange={setFiliereFilter}
                  icon={<BookOpen className="h-4 w-4 text-gray-400" />}
                  placeholder="Filtrer par classe"
                  searchPlaceholder="Rechercher une classe…"
                  options={[
                    { value: "all", label: "Toutes les classes" },
                    ...filiereOptions,
                  ]}
                />
              </div>
              {tab === "historique" && (
                <div className="w-full lg:w-64">
                  <SearchableSelect
                    value={anneeFilter}
                    onChange={setAnneeFilter}
                    icon={<Calendar className="h-4 w-4 text-gray-400" />}
                    placeholder="Filtrer par année scolaire"
                    searchPlaceholder="Rechercher une année…"
                    options={[
                      { value: "all", label: "Toutes les années" },
                      ...anneeOptions,
                    ]}
                  />
                </div>
              )}
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
              <p className="text-gray-600 text-lg">Chargement des classes…</p>
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
                  "Impossible de charger les classes."}
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

                  <div className="space-y-2 mb-3 text-sm">
                    {g.filiere_nom && (
                      <p className="text-white/90">
                        {g.filiere_nom}
                        {g.filiere_code ? ` (${g.filiere_code})` : ""}
                      </p>
                    )}

                    {/* Avancement du nom sur sa portée. */}
                    <p className="text-white/90">
                      <span className="font-medium">Semestres :</span>{" "}
                      {g.nb_semestres_ouverts}/{g.nb_semestres_attendus} ouverts
                      {!g.portee_declaree && (
                        <span className="text-white/70"> · portée non déclarée</span>
                      )}
                    </p>

                    {/* Un semestre par ligne, avec sa période et son statut. */}
                    <div className="space-y-1 rounded-lg bg-white/10 p-2">
                      {g.semestres.map((sm: any) => {
                        const cle = `${g.key}|${sm.semestre_id ?? sm.first_id}`;
                        return (
                          <div
                            key={sm.semestre_id ?? sm.first_id}
                            className="flex items-center gap-1"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                router.push(
                                  sm.semestre_id
                                    ? `/professionnel/admin/sessions/semestre/${sm.semestre_id}`
                                    : `/professionnel/admin/sessions/${sm.first_id}`
                                )
                              }
                              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-white/15 transition-colors"
                              title="Voir le détail de ce semestre"
                            >
                              <span className="min-w-0">
                                <span className="block font-medium truncate">
                                  {sm.semestre_libelle ?? "Sans semestre"}
                                </span>
                                <span className="block text-white/75">
                                  {fmtDate(sm.date_debut)} → {fmtDate(sm.date_fin)} ·{" "}
                                  {sm.items.length} UE
                                </span>
                              </span>
                              <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5">
                                {STATUT_LABEL[sm.statut] ?? sm.statut}
                              </span>
                            </button>
                            {/* Fiche de classe restreinte à CE semestre : seul
                                export de l'écran, dans les deux onglets. */}
                            <button
                              type="button"
                              onClick={() => handleExportSemestre(g, sm)}
                              disabled={exportEnCours !== null}
                              title={`Exporter en PDF la fiche de ${
                                sm.semestre_libelle ?? "ce semestre"
                              }`}
                              className="shrink-0 rounded bg-white/20 p-1.5 hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {exportEnCours === cle ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FileText className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-white/80 text-xs">
                      {g.items.length} UE au total · {totalUv} crédits
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
                          g.semestres[0]?.semestre_id
                            ? `/professionnel/admin/sessions/semestre/${g.semestres[0].semestre_id}`
                            : `/professionnel/admin/sessions/${g.first_id}`
                        )
                      }
                      title="Voir le détail"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {g.statut !== "termine" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                        onClick={() =>
                          router.push(
                            g.semestres[0]?.semestre_id
                              ? `/professionnel/admin/sessions/semestre/${g.semestres[0].semestre_id}`
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
                    ? "Aucune classe terminée"
                    : "Aucune classe ouverte"}
                </h3>
                <p className="text-gray-600 text-lg">
                  {tab === "historique"
                    ? "Les classes dont la date de fin est passée apparaîtront ici."
                    : filiereFilter === "all"
                    ? "Commencez par créer votre première classe."
                    : "Aucun résultat pour la classe sélectionnée."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
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
                    Ouvrir une classe
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
