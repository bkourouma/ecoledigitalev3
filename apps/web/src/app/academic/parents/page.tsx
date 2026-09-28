"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Users, Plus, Search, Filter, Loader2, AlertCircle, Eye, Edit, Trash2, X, Mail, Phone, UserCheck, Heart, ChevronLeft, ChevronRight } from "lucide-react";
import { useParents, useDeleteParent, Parent } from "@/lib/hooks/use-parents";

/** Tailles de page proposées ; la première est la valeur par défaut. */
const PAGE_SIZES = [10, 50, 100] as const;

export default function ParentsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  // Une nouvelle recherche repart de la première page : rester sur la page 5
  // d'un résultat qui n'en compte que 2 afficherait une liste vide.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  const { data: parentsData, isLoading, error } = useParents({
    search: searchQuery || undefined,
    page,
    limit: pageSize,
  });
  const deleteParentMutation = useDeleteParent();

  // `useParents` renvoie `response.json()` sans type : sans cette annotation,
  // `parents` est `any` et les callbacks de filter/reduce perdent leur type
  // contextuel (TS7006 sur les tuiles de statistiques ci-dessous).
  // La recherche et la pagination sont faites par l'API : les lignes reçues sont
  // exactement celles à afficher, aucun filtrage client ne s'y ajoute.
  const parents: Parent[] = parentsData?.data?.parents || [];
  const pagination = parentsData?.data;

  // Les compteurs portent sur tout le résultat de la recherche, pas sur la seule
  // page affichée : l'API renvoie les agrégats avec la page.
  const totalCount: number = pagination?.total ?? parents.length;
  const withChildrenCount: number =
    pagination?.withChildren ?? parents.filter((p) => p.childrenCount > 0).length;
  const childrenCount: number =
    pagination?.totalChildren ?? parents.reduce((sum, p) => sum + p.childrenCount, 0);
  const averageChildren = totalCount > 0 ? (childrenCount / totalCount).toFixed(1) : "0";
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const firstShown = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, totalCount);

  const handleView = (parent: Parent) => {
    router.push(`/academic/parents/${parent.id}`);
  };

  const handleEdit = (parent: Parent) => {
    router.push(`/academic/parents/${parent.id}/edit`);
  };

  const handleDelete = async (parent: Parent) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer le parent "${parent.name}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteParentMutation.mutateAsync(parent.id);
      } catch (error: any) {
        console.error("Error deleting parent:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        
        // Check if error mentions students
        const hasStudents = errorMessage.toLowerCase().includes("étudiants") || 
                           errorMessage.toLowerCase().includes("students") ||
                           errorMessage.toLowerCase().includes("enfants");
        
        if (hasStudents) {
          alert(errorMessage);
        } else {
          alert(`Erreur lors de la suppression du parent:\n\n${errorMessage}`);
        }
      }
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
          <div>
            <h2 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Gestion des parents</h2>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Gérez les parents et leurs relations avec les étudiants
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
                  Impossible de charger les parents. Vérifiez votre connexion.
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
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Gestion des parents
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez les parents et leurs relations avec les étudiants
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => router.push('/academic/parents/new')}
            className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouveau parent
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-rose-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total parents
                </p>
                <p className="text-3xl font-bold mt-1">{totalCount}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Avec enfants
                </p>
                <p className="text-3xl font-bold mt-1">{withChildrenCount}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Heart className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-fuchsia-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total enfants
                </p>
                <p className="text-3xl font-bold mt-1">{childrenCount}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <UserCheck className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-rose-400 to-pink-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Moyenne enfants
                </p>
                <p className="text-3xl font-bold mt-1">{averageChildren}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filter Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom, email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-rose-500 focus:ring-rose-500"
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

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{totalCount}</span>
              <span className="ml-1">
                {totalCount === 1 ? 'parent trouvé' : 'parents trouvés'}
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
              <div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-rose-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des parents...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Parents List */}
      {!isLoading && parents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {parents.map((parent: Parent) => (
            <div
              key={parent.id}
              className="bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">{parent.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  <p className="text-white/90 text-sm flex items-center">
                    <Mail className="w-4 h-4 mr-1" />
                    {parent.email}
                  </p>
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Nom complet:</span> {parent.firstName} {parent.lastName}
                  </p>
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Nombre d'enfants:</span> {parent.childrenCount || 0}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleView(parent);
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
                      handleEdit(parent);
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
                      handleDelete(parent);
                    }}
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
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

      {/* Empty State - No parents at all */}
      {!isLoading && parents.length === 0 && !searchQuery && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-rose-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun parent trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre premier parent
                </p>
              </div>
              <Button
                onClick={() => router.push('/academic/parents/new')}
                className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un parent
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && parents.length === 0 && !!searchQuery && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucun parent ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setPage(1);
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={() => router.push('/academic/parents/new')}
                  className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau parent
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && parents.length > 0 && (
        <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="whitespace-nowrap">Parents par page</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => setPageSize(Number(value))}
                >
                  <SelectTrigger className="h-9 w-[84px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-gray-600 whitespace-nowrap">
                {firstShown}–{lastShown} sur {totalCount}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="border-gray-300"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Précédent
                </Button>
                <span className="text-sm text-gray-600 whitespace-nowrap px-1">
                  Page {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="border-gray-300"
                >
                  Suivant
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
