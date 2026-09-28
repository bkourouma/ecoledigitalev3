"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  GraduationCap,
  BookOpen,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  ListFilter,
  Plus,
  X,
  Calendar,
  Receipt,
  FileText,
} from "lucide-react";
import { useMyProfessionalEnrollments } from "@/lib/hooks/use-professional-student";
import { SearchableSelect } from "@/components/SearchableSelect";

/**
 * Mes cours — espace étudiant.
 * Reprend les inscriptions professionnelles de l'étudiant : header dégradé,
 * statistiques, cartes par statut. La « Conduite » n'est pas une matière (c'est
 * une note) : elle est filtrée et n'apparaît jamais.
 */

const STATUT_LABEL: Record<string, string> = {
  en_attente_paiement: "En attente de paiement",
  confirmee: "Confirmée",
  terminee: "Terminée",
  annulee: "Annulée",
};

const STATUT_GRADIENT: Record<string, string> = {
  confirmee: "from-green-500 via-emerald-500 to-teal-500",
  terminee: "from-blue-500 via-indigo-500 to-purple-500",
  en_attente_paiement: "from-amber-500 via-orange-500 to-red-500",
  annulee: "from-slate-500 via-slate-600 to-slate-700",
};

/** La Conduite n'est pas une matière (ecue) — filtrée partout. */
function isConduite(e: any): boolean {
  const lib = String(e?.ue_libelle ?? "").toLowerCase();
  const code = String(e?.ue_code ?? "").toUpperCase();
  return lib.startsWith("conduite") || code.includes("EC-CON");
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export default function StudentCoursesPage() {
  const router = useRouter();
  // Cascade : l'année scolaire commande les noms de classe, qui commandent
  // les semestres. Le statut reste transversal.
  const [anneeFilter, setAnneeFilter] = useState<string>("all");
  const [classeFilter, setClasseFilter] = useState<string>("all");
  const [semestreFilter, setSemestreFilter] = useState<string>("all");
  const [statutFilter, setStatutFilter] = useState<string>("all");

  const query = useMyProfessionalEnrollments();
  const enrollments: any[] = useMemo(
    () => ((query.data as any[]) ?? []).filter((e) => !isConduite(e)),
    [query.data]
  );

  // Années scolaires couvertes par les inscriptions.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enrollments) if (e.annee_scolaire) set.add(e.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [enrollments]);

  // Noms de classe de l'année retenue. Une classe pouvant en porter
  // plusieurs, c'est le nom qui identifie le groupe suivi, pas la filière.
  const classeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enrollments) {
      if (anneeFilter !== "all" && e.annee_scolaire !== anneeFilter) continue;
      const nom = e.classe_nom ?? e.filiere_name;
      if (nom) set.add(nom);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((value) => ({ value, label: value }));
  }, [enrollments, anneeFilter]);

  // Semestres de l'année et de la classe retenues.
  const semestreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of enrollments) {
      if (!e.semestre_id) continue;
      if (anneeFilter !== "all" && e.annee_scolaire !== anneeFilter) continue;
      if (classeFilter !== "all" && (e.classe_nom ?? e.filiere_name) !== classeFilter)
        continue;
      map.set(e.semestre_id, e.semestre_libelle ?? "Semestre");
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [enrollments, anneeFilter, classeFilter]);

  const nbConfirmees = useMemo(
    () =>
      enrollments.filter(
        (e) => e.statut === "confirmee" || e.statut === "terminee"
      ).length,
    [enrollments]
  );
  const nbEnAttente = useMemo(
    () => enrollments.filter((e) => e.statut === "en_attente_paiement").length,
    [enrollments]
  );

  const filtered = useMemo(
    () =>
      enrollments.filter(
        (e) =>
          (anneeFilter === "all" || e.annee_scolaire === anneeFilter) &&
          (classeFilter === "all" ||
            (e.classe_nom ?? e.filiere_name) === classeFilter) &&
          (semestreFilter === "all" || e.semestre_id === semestreFilter) &&
          (statutFilter === "all" || e.statut === statutFilter)
      ),
    [enrollments, anneeFilter, classeFilter, semestreFilter, statutFilter]
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-green-500 to-blue-500 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Mes cours
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Le contenu pédagogique est accessible une fois l'inscription
            confirmée.
          </p>
        </div>
        <Button
          onClick={() => router.push("/professionnel/etudiant")}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle inscription
        </Button>
      </div>

      {/* Statistiques rapides */}
      {!query.isLoading && !query.isError && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total cours
                </p>
                <p className="text-3xl font-bold mt-1">{enrollments.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <GraduationCap className="h-6 w-6" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Confirmées</p>
                <p className="text-3xl font-bold mt-1">{nbConfirmees}</p>
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
                  En attente de paiement
                </p>
                <p className="text-3xl font-bold mt-1">{nbEnAttente}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Clock className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtre */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* L'année ouvre la cascade : elle occupe sa propre ligne. */}
              <div className="md:col-span-3">
                <label className="text-sm font-medium">Année scolaire</label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={anneeFilter}
                    onChange={(v) => {
                      setAnneeFilter(v);
                      // Classes et semestres dépendent de l'année.
                      setClasseFilter("all");
                      setSemestreFilter("all");
                    }}
                    icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
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
                    value={classeFilter}
                    onChange={(v) => {
                      setClasseFilter(v);
                      setSemestreFilter("all");
                    }}
                    icon={<GraduationCap className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Tous les noms de classe"
                    searchPlaceholder="Rechercher un nom de classe…"
                    options={[
                      { value: "all", label: "Tous les noms de classe" },
                      ...classeOptions,
                    ]}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Semestre</label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={semestreFilter}
                    onChange={setSemestreFilter}
                    icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Tous les semestres"
                    searchPlaceholder="Rechercher un semestre…"
                    options={[
                      { value: "all", label: "Tous les semestres" },
                      ...semestreOptions,
                    ]}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Statut</label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={statutFilter}
                    onChange={setStatutFilter}
                    icon={<ListFilter className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Tous les statuts"
                    searchPlaceholder="Rechercher un statut…"
                    options={[
                      { value: "all", label: "Tous les statuts" },
                      ...Object.entries(STATUT_LABEL).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center text-sm text-muted-foreground whitespace-nowrap">
              <span className="font-medium text-foreground">
                {filtered.length}
              </span>
              <span className="ml-1">
                {filtered.length === 1 ? "cours affiché" : "cours affichés"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chargement */}
      {query.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-green-400" />
              </div>
              <p className="text-muted-foreground text-lg">
                Chargement des cours…
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erreur */}
      {query.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-500/15 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-400" />
              </div>
              <p className="text-muted-foreground">
                {(query.error as Error)?.message ??
                  "Impossible de charger les cours."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grille des cours */}
      {!query.isLoading && !query.isError && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((e) => {
            const gradient =
              STATUT_GRADIENT[e.statut] ??
              "from-slate-500 via-slate-600 to-slate-700";
            return (
              <div
                key={e.id}
                className={`bg-gradient-to-br ${gradient} p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="font-mono text-xs text-white/70">
                        {e.ue_code}
                      </p>
                      <h3 className="font-semibold text-lg leading-tight">
                        {e.ue_libelle}
                      </h3>
                    </div>
                    <span className="bg-white/20 text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap">
                      {STATUT_LABEL[e.statut] ?? e.statut}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <p className="text-white/90 flex items-center gap-2">
                      <BookOpen className="h-4 w-4 shrink-0" />
                      {e.session_libelle}
                    </p>
                    <p className="text-white/90 flex items-center gap-2">
                      <Calendar className="h-4 w-4 shrink-0" />
                      {fmtDate(e.date_debut)} → {fmtDate(e.date_fin)}
                    </p>
                    <p className="text-white/90 flex items-center gap-2">
                      <Receipt className="h-4 w-4 shrink-0" />
                      <span className="font-mono text-xs">
                        {e.order_reference}
                      </span>
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/student/courses/${e.id}`)}
                      className="inline-flex items-center gap-2 bg-white/25 hover:bg-white/35 transition-colors px-3 py-1.5 rounded-md text-sm font-medium"
                    >
                      <FileText className="h-4 w-4" />
                      Détails du cours
                    </button>
                  </div>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500"></div>
              </div>
            );
          })}
        </div>
      )}

      {/* Vide */}
      {!query.isLoading && !query.isError && filtered.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <GraduationCap className="h-10 w-10 text-green-400" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Aucun cours trouvé
                </h3>
                <p className="text-muted-foreground text-lg">
                  {statutFilter === "all" &&
                  anneeFilter === "all" &&
                  classeFilter === "all" &&
                  semestreFilter === "all"
                    ? "Vous n'avez pas encore de cours."
                    : "Aucun cours pour les filtres sélectionnés."}
                </p>
              </div>
              <div className="flex gap-3">
                {(statutFilter !== "all" ||
                  anneeFilter !== "all" ||
                  classeFilter !== "all" ||
                  semestreFilter !== "all") && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStatutFilter("all");
                      setAnneeFilter("all");
                      setClasseFilter("all");
                      setSemestreFilter("all");
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Effacer les filtres
                  </Button>
                )}
                <Button
                  onClick={() => router.push("/professionnel/etudiant")}
                  className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Découvrir le catalogue
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
