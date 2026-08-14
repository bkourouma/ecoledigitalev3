"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { BookOpen, Plus, Filter, Loader2, AlertCircle, Edit, Trash2, Search, X, GraduationCap, Eye } from "lucide-react";
import { useProgrammes, useDeleteProgramme, Programme } from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";
import { useCourses } from "@/lib/hooks/use-courses";

export default function ProgrammesPage() {
  const router = useRouter();
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  const { data: programmesData, isLoading, error } = useProgrammes();
  const { data: cyclesData } = useCycles();
  const { data: coursesData } = useCourses();
  const deleteProgrammeMutation = useDeleteProgramme();

  const programmes = programmesData?.data || [];
  const cycles = cyclesData?.data || [];
  const courses = coursesData?.data || [];

  const filteredProgrammes = useMemo(() => {
    return programmes.filter((programme) => {
      return cycleFilter === "all" || programme.cycleId === cycleFilter;
    });
  }, [programmes, cycleFilter]);

  const handleCreateNew = () => {
    router.push("/academic/programmes/new");
  };

  const handleView = (programme: Programme) => {
    router.push(`/academic/programmes/${programme.id}`);
  };

  const handleEdit = (programme: Programme) => {
    router.push(`/academic/programmes/${programme.id}/edit`);
  };

  const handleDelete = async (programme: Programme) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer la filière "${programme.name}" ?\n\nCette action est irréversible et supprimera également tous les cours associés.`;

    if (window.confirm(confirmMessage)) {
      try {
        console.log("Attempting to delete programme:", programme.id);
        await deleteProgrammeMutation.mutateAsync(programme.id);
        console.log("Programme deleted successfully");
      } catch (error: any) {
        console.error("Error deleting programme:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        alert(`Erreur lors de la suppression de la filière: ${errorMessage}\n\nVeuillez vérifier que le serveur API est démarré et réessayer.`);
      }
    }
  };



  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Filières académiques</h2>
            <p className="text-muted-foreground">
              Gérez les filières et unités d'enseignement
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Erreur de chargement</h3>
                <p className="text-muted-foreground">
                  Impossible de charger les filières. Vérifiez votre connexion.
                </p>
              </div>
              <Button onClick={() => window.location.reload()}>
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent">
            Filières académiques
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les filières et unités d'enseignement
          </p>
        </div>
        <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle filière
        </Button>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total filières
                </p>
                <p className="text-3xl font-bold mt-1">{programmes.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-500 to-amber-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Actifs
                </p>
                <p className="text-3xl font-bold mt-1">
                  {programmes.filter(p => p.status === 'active').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Filter className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Brouillons
                </p>
                <p className="text-3xl font-bold mt-1">
                  {programmes.filter(p => p.status === 'draft').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Plus className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Cycles liés
                </p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(programmes.map(p => p.cycleId)).size}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <GraduationCap className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-center">
            {/* Cycle Filter */}
            <div className="lg:w-48">
              <Select value={cycleFilter} onValueChange={setCycleFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-pink-500 focus:ring-pink-500">
                  <GraduationCap className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par cycle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les cycles</SelectItem>
                  {cycles.map((cycle) => (
                    <SelectItem key={cycle.id} value={cycle.id}>
                      {cycle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredProgrammes.length}</span>
              <span className="ml-1">
                {filteredProgrammes.length === 1 ? 'filière trouvée' : 'filières trouvées'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
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

      {/* Programmes List */}
      {!isLoading && filteredProgrammes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProgrammes.map((programme) => {
            const cycle = cycles.find(c => c.id === programme.cycleId);
            return (
              <div
                key={programme.id}
                className="bg-gradient-to-br from-pink-500 via-purple-500 to-orange-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
              >
                <div className="relative z-10">
                  <div className="mb-4">
                    <h3 className="font-semibold text-lg">{programme.name}</h3>
                  </div>

                  <div className="space-y-2 mb-4">
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Code:</span> {programme.code}
                    </p>
                    {cycle && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Cycle:</span> {cycle.name}
                      </p>
                    )}
                    {programme.domaine && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Domaine:</span> {programme.domaine}
                      </p>
                    )}
                  </div>

                  {programme.description && (
                    <p className="text-white/80 text-sm mb-4 line-clamp-2">
                      {programme.description}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleView(programme);
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
                        handleEdit(programme);
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
                        handleDelete(programme);
                      }}
                      disabled={deleteProgrammeMutation.isPending}
                      title="Supprimer"
                    >
                      {deleteProgrammeMutation.isPending ? (
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
            );
          })}
        </div>
      )}

      {/* Empty State - No programmes at all */}
      {!isLoading && programmes.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-pink-100 to-orange-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <BookOpen className="h-10 w-10 text-pink-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune filière trouvée</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre première filière académique
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer une filière
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && programmes.length > 0 && filteredProgrammes.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucune filière ne correspond aux filtres sélectionnés
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setCycleFilter("all")}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
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
