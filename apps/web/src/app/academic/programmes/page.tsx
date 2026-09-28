"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useFilieres, useDeleteFiliere, type Filiere } from "@/lib/hooks/use-filieres";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openFilieresPdf } from "@/lib/utils/filiere-report";

/**
 * Filières — le domaine d'étude, indépendant du cycle
 * (« AUDIT ET CONTROLE DE GESTION »). Les classes qui la déclinent
 * (« MASTER 2 AUDIT ET CONTROLE DE GESTION ») se gèrent sur /academic/classes.
 */
export default function FilieresPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [domaineFilter, setDomaineFilter] = useState("all");

  const { data: filieres = [], isLoading, error } = useFilieres();
  const deleteMutation = useDeleteFiliere();

  const domaines = useMemo(() => {
    const set = new Set<string>();
    filieres.forEach((f) => {
      if (f.domaine) set.add(f.domaine);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [filieres]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return filieres.filter((f) => {
      const matchesQuery =
        !query ||
        f.name.toLowerCase().includes(query) ||
        (f.domaine ?? "").toLowerCase().includes(query);
      const matchesDomaine = domaineFilter === "all" || f.domaine === domaineFilter;
      return matchesQuery && matchesDomaine;
    });
  }, [filieres, searchQuery, domaineFilter]);

  /** Périmètre exporté : exactement ce que l'écran affiche, filtres compris. */
  const exportOptions = useMemo(
    () => ({
      recherche: searchQuery.trim() || undefined,
      domaine: domaineFilter === "all" ? "Tous les domaines" : domaineFilter,
    }),
    [searchQuery, domaineFilter]
  );

  const handleCreateNew = () => {
    router.push("/academic/programmes/new");
  };

  const handleView = (filiere: Filiere) => {
    router.push(`/academic/programmes/${filiere.id}`);
  };

  const handleEdit = (filiere: Filiere) => {
    router.push(`/academic/programmes/${filiere.id}/edit`);
  };

  const handleDelete = async (filiere: Filiere) => {
    const confirmMessage =
      `Êtes-vous sûr de vouloir supprimer la filière "${filiere.name}" ?` +
      `\n\nCette action est irréversible.`;

    if (!window.confirm(confirmMessage)) return;

    try {
      await deleteMutation.mutateAsync(filiere.id);
    } catch (err: any) {
      alert(err?.message ?? "Erreur lors de la suppression de la filière.");
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Filières</h2>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez les filières de l&apos;établissement
          </p>
        </div>
        <Card className="shadow-lg">
          <CardContent className="flex items-center gap-3 py-10 text-red-600">
            <AlertCircle className="h-6 w-6" />
            <p>Impossible de charger les filières. Vérifiez votre connexion.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Filières
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Le domaine d&apos;étude, indépendant du cycle. Les classes se gèrent dans
            le menu Classes.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            formats={["pdf"]}
            disabled={isLoading || filtered.length === 0}
            onExportPdf={(win) => openFilieresPdf(filtered, exportOptions, win)}
          />
          <Button
            onClick={handleCreateNew}
            className="bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle filière
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Total filières</p>
                <p className="text-3xl font-bold mt-1">{filieres.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Domaines</p>
                <p className="text-3xl font-bold mt-1">{domaines.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Search className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtres */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom ou domaine..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-pink-500 focus:ring-pink-500"
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
                value={domaineFilter}
                onChange={setDomaineFilter}
                placeholder="Filtrer par domaine"
                searchPlaceholder="Rechercher un domaine…"
                options={[
                  { value: "all", label: "Tous les domaines" },
                  ...domaines.map((d) => ({ value: d, label: d })),
                ]}
              />
            </div>

            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filtered.length}</span>
              <span className="ml-1">
                {filtered.length === 1 ? "filière trouvée" : "filières trouvées"}
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
              <div className="bg-gradient-to-br from-pink-100 to-orange-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des filières...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((filiere) => (
            <div
              key={filiere.id}
              className="bg-gradient-to-br from-pink-500 via-purple-500 to-orange-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
            >
              <div className="relative z-10">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{filiere.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  {filiere.domaine && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Domaine:</span> {filiere.domaine}
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
                      handleView(filiere);
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
                      handleEdit(filiere);
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
                      handleDelete(filiere);
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
              <div className="bg-gradient-to-br from-pink-100 to-orange-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <BookOpen className="h-10 w-10 text-pink-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {filieres.length === 0
                    ? "Aucune filière"
                    : "Aucune filière ne correspond à votre recherche"}
                </h3>
                <p className="text-gray-600 text-lg">
                  {filieres.length === 0
                    ? "Commencez par créer votre première filière."
                    : "Modifiez vos critères de recherche."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {filieres.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery("");
                      setDomaineFilter("all");
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Effacer les filtres
                  </Button>
                )}
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle filière
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
