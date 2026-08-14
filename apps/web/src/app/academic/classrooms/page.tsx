"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input } from "@ecoledigitale/ui";
import { Building, Plus, Loader2, AlertCircle, Edit, Trash2, Search, X } from "lucide-react";
import { useClassrooms, useDeleteClassroom } from "@/lib/hooks/use-classrooms";
import { Classroom, ClassroomType, ClassroomStatus } from "@ecoledigitale/contracts";

export default function ClassroomsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: classroomsData, isLoading, error } = useClassrooms({ 
    limit: 100,
    isActive: true 
  });
  const deleteClassroomMutation = useDeleteClassroom();

  const classrooms = classroomsData?.data || [];

  // Filter and search classrooms
  const filteredClassrooms = useMemo(() => {
    return classrooms.filter((classroom) => {
      return searchQuery === "" ||
        classroom.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        classroom.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (classroom.building && classroom.building.toLowerCase().includes(searchQuery.toLowerCase()));
    });
  }, [classrooms, searchQuery]);

  const handleCreateNew = () => {
    router.push("/academic/classrooms/new");
  };

  const handleEdit = (classroom: Classroom) => {
    router.push(`/academic/classrooms/${classroom.id}/edit`);
  };

  const handleDelete = async (classroom: Classroom) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer la salle "${classroom.name}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        console.log("Attempting to delete classroom:", classroom.id);
        await deleteClassroomMutation.mutateAsync(classroom.id);
        console.log("Classroom deleted successfully");
      } catch (error: any) {
        console.error("Error deleting classroom:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        alert(`Erreur lors de la suppression de la salle: ${errorMessage}\n\nVeuillez vérifier que le serveur API est démarré et réessayer.`);
      }
    }
  };


  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Salles de classe</h2>
            <p className="text-muted-foreground">
              Gérez les salles de classe et leurs réservations
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
                  Impossible de charger les salles de classe. Vérifiez votre connexion.
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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Salles de classe
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les salles de classe et leurs réservations
            </p>
          </div>
            <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <Plus className="h-4 w-4 mr-2" />
          Nouvelle salle
            </Button>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-6">
          <div className="w-full bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total salles
                </p>
                <p className="text-3xl font-bold mt-1">{classrooms.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Building className="h-6 w-6" />
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
                placeholder="Rechercher par nom, code ou bâtiment..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-indigo-500 focus:ring-indigo-500"
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
              <span className="font-medium">{filteredClassrooms.length}</span>
              <span className="ml-1">
                {filteredClassrooms.length === 1 ? 'salle trouvée' : 'salles trouvées'}
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
              <div className="bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des salles...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Classrooms List */}
      {!isLoading && filteredClassrooms.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClassrooms.map((classroom) => {
            return (
              <div
                key={classroom.id}
                className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
              >
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg">{classroom.name}</h3>
                  </div>

                  <div className="space-y-2 mb-4">
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Code:</span> {classroom.code}
                    </p>
                  </div>

                  <div className="flex gap-2">
                        <Button
                      variant="secondary"
                          size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(classroom);
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
                        handleDelete(classroom);
                      }}
                      disabled={deleteClassroomMutation.isPending}
                          title="Supprimer"
                        >
                      {deleteClassroomMutation.isPending ? (
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

      {/* Empty State - No classrooms at all */}
      {!isLoading && classrooms.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Building className="h-10 w-10 text-indigo-600" />
                        </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune salle trouvée</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre première salle de classe
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer une salle
              </Button>
                    </div>
                  </CardContent>
                </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && classrooms.length > 0 && filteredClassrooms.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucune salle ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setSearchQuery("")}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer la recherche
                </Button>
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle salle
                </Button>
              </div>
            </div>
        </CardContent>
      </Card>
      )}

    </div>
  );
}
