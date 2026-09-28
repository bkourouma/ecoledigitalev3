"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Users, CheckCircle2, AlertCircle, Edit, X, Trash2, Search, Filter, BarChart3, GraduationCap, BookOpenCheck, Eye, Plus, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  useDeleteClass,
  useClasses,
} from "@/lib/hooks/use-classes";

export default function AjouterClassePage() {
  const router = useRouter();
  // States for filtering classes
  const [classFilter, setClassFilter] = useState({
    search: "",
    programmeId: "",
  });

  const { data: activeYearData } = useActiveAcademicYear();
  const { data: programmesData } = useProgrammes({ status: "active" });
  const deleteClass = useDeleteClass();
  // Charger toutes les classes pour l'affichage général
  const { data: allClassesData } = useClasses({ includeDetails: true });

  const handleCreateNew = () => {
    router.push("/annee-academique/ajouter-classe/new");
  };

  const handleEditClass = (classItem: any) => {
    router.push(`/annee-academique/ajouter-classe/${classItem.id}/edit`);
  };

  const programmes = programmesData?.data || [];
  const activeYear = activeYearData?.data;

  // Filter and process all classes
  const allClasses = allClassesData?.data || [];
  const filteredClasses = allClasses.filter(classItem => {
    const matchesSearch = !classFilter.search ||
      classItem.name.toLowerCase().includes(classFilter.search.toLowerCase()) ||
      classItem.code.toLowerCase().includes(classFilter.search.toLowerCase()) ||
      classItem.programme?.name.toLowerCase().includes(classFilter.search.toLowerCase());

    const matchesProgramme = !classFilter.programmeId ||
      classItem.programmeId === classFilter.programmeId;

    return matchesSearch && matchesProgramme;
  });

  // Calculate statistics
  const stats = {
    totalClasses: allClasses.length,
    totalStudents: allClasses.reduce((sum, c) => sum + (Number(c.studentCount) || 0), 0),
    totalCourses: allClasses.reduce((sum, c) => sum + (Number(c.courseCount) || 0), 0),
    averageStudentsPerClass: allClasses.length > 0 ?
      Math.round(allClasses.reduce((sum, c) => sum + (Number(c.studentCount) || 0), 0) / allClasses.length) : 0,
  };

  if (!activeYear) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <CardTitle className="text-orange-800">Aucune Année Académique Active</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-orange-700 mb-4">
              Vous devez d'abord créer et activer une année académique avant de pouvoir ajouter des classes.
            </p>
            <Button
              onClick={() => window.location.href = '/annee-academique/demarrer'}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Démarrer une Année Académique
            </Button>
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
          <h1 className="font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Gestion des classes
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez les classes pour l'année académique {activeYear.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-violet-100 text-violet-800 border-violet-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {activeYear.name}
          </Badge>
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
      {allClasses.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-violet-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total classes
                </p>
                <p className="text-3xl font-bold mt-1">{stats.totalClasses}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total étudiants
                </p>
                <p className="text-3xl font-bold mt-1">{stats.totalStudents}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total cours
                </p>
                <p className="text-3xl font-bold mt-1">{stats.totalCourses}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpenCheck className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Moyenne/Classe
                </p>
                <p className="text-3xl font-bold mt-1">{stats.averageStudentsPerClass}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BarChart3 className="h-6 w-6" />
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
                placeholder="Rechercher par nom, code ou programme..."
                value={classFilter.search}
                onChange={(e) => setClassFilter(prev => ({ ...prev, search: e.target.value }))}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-violet-500 focus:ring-violet-500"
              />
              {classFilter.search && (
                <button
                  onClick={() => setClassFilter(prev => ({ ...prev, search: "" }))}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Programme Filter */}
            <div className="lg:w-48">
              <Select
                value={classFilter.programmeId || "all"}
                onValueChange={(value) => setClassFilter(prev => ({ ...prev, programmeId: value === "all" ? "" : value }))}
              >
                <SelectTrigger className="h-11 border-gray-200 focus:border-violet-500 focus:ring-violet-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par programme" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Tous les programmes</SelectItem>
                  {programmes.map((programme) => (
                    <SelectItem key={programme.id} value={programme.id}>
                      {programme.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredClasses.length}</span>
              <span className="ml-1">
                {filteredClasses.length === 1 ? 'classe trouvée' : 'classes trouvées'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Empty State - No classes at all */}
      {filteredClasses.length === 0 && !classFilter.search && !classFilter.programmeId && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-violet-100 to-indigo-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <BookOpen className="h-10 w-10 text-violet-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune classe trouvée</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre première classe
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {filteredClasses.length === 0 && (classFilter.search || classFilter.programmeId) && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucune classe ne correspond à vos critères de recherche
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setClassFilter({ search: "", programmeId: "" });
                }}
                className="border-gray-300 hover:bg-gray-50"
              >
                <X className="h-4 w-4 mr-2" />
                Effacer les filtres
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Classes List */}
      {filteredClasses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClasses.map((classItem) => (
            <div
              key={classItem.id}
              className="bg-gradient-to-br from-violet-500 via-indigo-500 to-purple-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group"
            >
              <div className="relative z-10">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{classItem.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Code:</span> {classItem.code}
                  </p>
                  {classItem.programme && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Programme:</span> {classItem.programme.name} ({classItem.programme.code})
                    </p>
                  )}
                  {classItem.classroom && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Salle:</span> {classItem.classroom.name} ({classItem.classroom.code})
                    </p>
                  )}
                  {classItem.studentCount !== undefined && (
                    <p className="text-white/90 text-sm flex items-center">
                      <GraduationCap className="w-4 h-4 mr-1" />
                      {classItem.studentCount} étudiant{Number(classItem.studentCount) > 1 ? 's' : ''} inscrit{Number(classItem.studentCount) > 1 ? 's' : ''}
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
                      window.location.href = `/annee-academique/classes/${classItem.id}`;
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
                      handleEditClass(classItem);
                    }}
                    title="Modifier"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-red-500/20 hover:bg-red-500/40 text-white border-red-300/20 hover:border-red-300/40 transition-all duration-200 p-2"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const hasRelations = Number(classItem.courseCount || 0) > 0 || Number(classItem.studentCount || 0) > 0;
                      if (hasRelations) return;
                      if (!confirm(`Supprimer la classe ${classItem.name} ?`)) return;
                      try {
                        await deleteClass.mutateAsync(classItem.id);
                      } catch (error) {
                        console.error(error);
                        alert("Suppression impossible. Assurez-vous qu'il n'y a aucun cours ni étudiant.");
                      }
                    }}
                    disabled={Number(classItem.courseCount || 0) > 0 || Number(classItem.studentCount || 0) > 0 || deleteClass.isPending}
                    title={Number(classItem.courseCount || 0) > 0 || Number(classItem.studentCount || 0) > 0 ? "Impossible: cours ou étudiants présents" : "Supprimer"}
                  >
                    {deleteClass.isPending ? (
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
    </div>
  );
}
