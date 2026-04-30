"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { GraduationCap, Plus, Filter, Calendar, ArrowLeft, Loader2, AlertCircle, Edit, Trash2, Search, X, Eye, BookOpen } from "lucide-react";
import { useCycles, useDeleteCycle } from "@/lib/hooks/use-cycles";
import { Cycle } from "@ecoledigitale/contracts";
import { useProgrammes } from "@/lib/hooks/use-programmes";

export default function CyclesPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: cyclesData, isLoading, error } = useCycles();
  const { data: programmesData } = useProgrammes();
  const deleteCycleMutation = useDeleteCycle();

  const cycles = cyclesData?.data || [];
  const programmes = programmesData?.data || [];

  // Filter and search cycles
  const filteredCycles = useMemo(() => {
    return cycles.filter((cycle) => {
      const matchesSearch = searchQuery === "" ||
        cycle.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cycle.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cycle.description && cycle.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === "all" || cycle.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [cycles, searchQuery, statusFilter]);

  const handleCreateNew = () => {
    router.push("/academic/cycles/new");
  };

  const handleView = (cycle: Cycle) => {
    router.push(`/academic/cycles/${cycle.id}`);
  };

  const handleEdit = (cycle: Cycle) => {
    router.push(`/academic/cycles/${cycle.id}/edit`);
  };

  const handleDelete = async (cycle: Cycle) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer le cycle "${cycle.name}" ?\n\nCette action est irréversible et supprimera également tous les programmes associés.`;

    if (window.confirm(confirmMessage)) {
      try {
        console.log("Attempting to delete cycle:", cycle.id);
        await deleteCycleMutation.mutateAsync(cycle.id);
        console.log("Cycle deleted successfully");
        // The query will be invalidated automatically by the mutation
      } catch (error: any) {
        console.error("Error deleting cycle:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        alert(`Erreur lors de la suppression du cycle: ${errorMessage}\n\nVeuillez vérifier que le serveur API est démarré et réessayer.`);
      }
    }
  };



  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Cycles académiques</h2>
            <p className="text-muted-foreground">
              Gérez les cycles de formation et leurs programmes
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
                  Impossible de charger les cycles. Vérifiez votre connexion.
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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Cycles académiques
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les cycles de formation et leurs programmes
          </p>
        </div>
        <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouveau cycle
        </Button>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total cycles
                </p>
                <p className="text-3xl font-bold mt-1">{cycles.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <GraduationCap className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Actifs
                </p>
                <p className="text-3xl font-bold mt-1">
                  {cycles.filter(c => c.status === 'active').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Calendar className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-500 to-red-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Brouillons
                </p>
                <p className="text-3xl font-bold mt-1">
                  {cycles.filter(c => c.status === 'draft').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Filter className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Durée moyenne
                </p>
                <p className="text-3xl font-bold mt-1">
                  {cycles.length > 0
                    ? Math.round(cycles.reduce((acc, c) => acc + c.durationMonths, 0) / cycles.length)
                    : 0} <span className="text-lg">mois</span>
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Plus className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filter Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom, code ou description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
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

            {/* Status Filter */}
            <div className="sm:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="active">Actifs</SelectItem>
                  <SelectItem value="draft">Brouillons</SelectItem>
                  <SelectItem value="archived">Archivés</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredCycles.length}</span>
              <span className="ml-1">
                {filteredCycles.length === 1 ? 'cycle trouvé' : 'cycles trouvés'}
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
              <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des cycles...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cycles List */}
      {!isLoading && filteredCycles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCycles.map((cycle) => (
            <div
              key={cycle.id}
              className="bg-gradient-to-br from-blue-500 via-purple-500 to-purple-600 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
            >
              <div className="relative z-10">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{cycle.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Code:</span> {cycle.code}
                  </p>
                  {cycle.certificationLevel && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Niveau:</span> {cycle.certificationLevel}
                    </p>
                  )}
                </div>

                {cycle.description && (
                  <p className="text-white/80 text-sm mb-4 line-clamp-2">
                    {cycle.description}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleView(cycle);
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
                      handleEdit(cycle);
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
                      handleDelete(cycle);
                    }}
                    disabled={deleteCycleMutation.isPending}
                    title="Supprimer"
                  >
                    {deleteCycleMutation.isPending ? (
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

      {/* Empty State - No cycles at all */}
      {!isLoading && cycles.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <GraduationCap className="h-10 w-10 text-blue-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun cycle trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre premier cycle académique
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un cycle
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && cycles.length > 0 && filteredCycles.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucun cycle ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau cycle
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}




    </div>
  );
}

