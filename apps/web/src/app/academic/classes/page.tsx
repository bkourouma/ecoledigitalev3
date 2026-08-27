"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  Input,
} from "@ecoledigitale/ui";
import {
  AlertCircle,
  BookOpen,
  Edit,
  Eye,
  GraduationCap,
  Layers,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useProgrammes,
  useDeleteProgramme,
  type Programme,
} from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";
import { useFilieres } from "@/lib/hooks/use-filieres";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openClassesPdf } from "@/lib/utils/classe-report";

/**
 * Classes — la déclinaison d'une filière sur un cycle
 * (« MASTER 2 AUDIT ET CONTROLE DE GESTION »). C'est à ce niveau que sont
 * rattachés les UE, les semestres et les bulletins du module professionnel.
 */
// `useSearchParams` impose une frontiere Suspense au rendu statique.
export default function ClassesPage() {
  return (
    <Suspense fallback={null}>
      <ClassesPageContent />
    </Suspense>
  );
}

function ClassesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState("");
  const [filiereFilter, setFiliereFilter] = useState("all");
  const [cycleFilter, setCycleFilter] = useState("all");

  const { data: programmesData, isLoading, error } = useProgrammes();
  const { data: cyclesData } = useCycles();
  const { data: filieres = [] } = useFilieres();
  const deleteMutation = useDeleteProgramme();

  const classes = programmesData?.data || [];
  const cycles = cyclesData?.data || [];

  // Arrivée depuis la fiche d'une filière : /academic/classes?filiereId=...
  useEffect(() => {
    const fromUrl = searchParams?.get("filiereId");
    if (fromUrl) setFiliereFilter(fromUrl);
  }, [searchParams]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return classes.filter((c) => {
      const matchesQuery =
        !query ||
        c.name.toLowerCase().includes(query) ||
        c.code.toLowerCase().includes(query) ||
        (c.filiere?.name ?? "").toLowerCase().includes(query);
      const matchesFiliere = filiereFilter === "all" || c.filiereId === filiereFilter;
      const matchesCycle = cycleFilter === "all" || c.cycleId === cycleFilter;
      return matchesQuery && matchesFiliere && matchesCycle;
    });
  }, [classes, searchQuery, filiereFilter, cycleFilter]);

  /** Périmètre exporté : exactement ce que l'écran affiche, filtres compris. */
  const exportOptions = useMemo(
    () => ({
      recherche: searchQuery.trim() || undefined,
      filiere:
        filiereFilter === "all"
          ? "Toutes les filières"
          : (filieres.find((f) => f.id === filiereFilter)?.name ?? filiereFilter),
      cycle:
        cycleFilter === "all"
          ? "Tous les cycles"
          : (cycles.find((c) => c.id === cycleFilter)?.name ?? cycleFilter),
    }),
    [searchQuery, filiereFilter, cycleFilter, filieres, cycles]
  );

  const handleCreateNew = () => {
    const suffix = filiereFilter !== "all" ? `?filiereId=${filiereFilter}` : "";
    router.push(`/academic/classes/new${suffix}`);
  };

  const handleView = (classe: Programme) => {
    router.push(`/academic/classes/${classe.id}`);
  };

  const handleEdit = (classe: Programme) => {
    router.push(`/academic/classes/${classe.id}/edit`);
  };

  const handleDelete = async (classe: Programme) => {
    const confirmMessage =
      `Êtes-vous sûr de vouloir supprimer la classe "${classe.name}" ?` +
      `\n\nCette action est irréversible et emporte les UE, semestres et cours rattachés.`;

    if (!window.confirm(confirmMessage)) return;

    try {
      await deleteMutation.mutateAsync(classe.id);
    } catch (err: any) {
      alert(err?.message ?? "Erreur lors de la suppression de la classe.");
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Classes</h2>
          <p className="text-muted-foreground">
            Gérez les classes rattachées à chaque filière
          </p>
        </div>
        <Card className="shadow-lg">
          <CardContent className="flex items-center gap-3 py-10 text-red-600">
            <AlertCircle className="h-6 w-6" />
            <p>Impossible de charger les classes. Vérifiez votre connexion.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Classes
          </h1>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            formats={["pdf"]}
            disabled={isLoading || filtered.length === 0}
            onExportPdf={(win) => openClassesPdf(filtered, exportOptions, win)}
          />
          <Button
            onClick={handleCreateNew}
            className="bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle classe
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Total classes</p>
                <p className="text-3xl font-bold mt-1">{classes.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Layers className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Filières couvertes</p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(classes.map((c) => c.filiereId).filter(Boolean)).size}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Cycles utilisés</p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(classes.map((c) => c.cycleId)).size}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <GraduationCap className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtres */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom, code ou filière..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-violet-500 focus:ring-violet-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="sm:w-64">
              <SearchableSelect
                value={filiereFilter}
                onChange={setFiliereFilter}
                icon={<BookOpen className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par filière"
                searchPlaceholder="Rechercher une filière…"
                options={[
                  { value: "all", label: "Toutes les filières" },
                  ...filieres.map((f) => ({ value: f.id, label: f.name })),
                ]}
              />
            </div>

            <div className="sm:w-48">
              <SearchableSelect
                value={cycleFilter}
                onChange={setCycleFilter}
                icon={<GraduationCap className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par cycle"
                searchPlaceholder="Rechercher un cycle…"
                options={[
                  { value: "all", label: "Tous les cycles" },
                  ...cycles.map((cycle) => ({ value: cycle.id, label: cycle.name })),
                ]}
              />
            </div>

            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filtered.length}</span>
              <span className="ml-1">
                {filtered.length === 1 ? "classe trouvée" : "classes trouvées"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chargement */}
      {isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-violet-100 to-indigo-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des classes...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((classe) => (
            <div
              key={classe.id}
              className="bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
            >
              <div className="relative z-10">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{classe.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Code:</span> {classe.code}
                  </p>
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Filière:</span>{" "}
                    {classe.filiere?.name ?? "Non rattachée"}
                  </p>
                  {classe.cycle?.name && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Cycle:</span> {classe.cycle.name}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleView(classe);
                    }}
                    title="Voir les détails"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(classe);
                    }}
                    title="Modifier"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-red-500/20 hover:bg-red-500/40 text-white border-red-300/20 hover:border-red-300/40 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(classe);
                    }}
                    disabled={deleteMutation.isPending}
                    title="Supprimer"
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Decorative background element */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500"></div>
            </div>
          ))}
        </div>
      )}

      {/* Vide */}
      {!isLoading && filtered.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-violet-100 to-indigo-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Layers className="h-10 w-10 text-violet-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {classes.length === 0
                    ? "Aucune classe"
                    : "Aucune classe ne correspond à vos critères"}
                </h3>
                <p className="text-gray-600 text-lg">
                  {classes.length === 0
                    ? "Commencez par créer votre première classe."
                    : "Modifiez vos filtres pour élargir la recherche."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {classes.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery("");
                      setFiliereFilter("all");
                      setCycleFilter("all");
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Effacer les filtres
                  </Button>
                )}
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle classe
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
