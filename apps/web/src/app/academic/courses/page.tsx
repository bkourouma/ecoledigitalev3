"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Calendar, Plus, Clock, Loader2, AlertCircle, Edit, Eye, MapPin, Trash2, X, BookOpen } from "lucide-react";
import { useCourses, useDeleteCourse, Course } from "@/lib/hooks/use-courses";
import { useProgrammes } from "@/lib/hooks/use-programmes";

export default function CoursesPage() {
  const router = useRouter();
  const [programmeFilter, setProgrammeFilter] = useState<string>("all");

  const { data: coursesData, isLoading, error } = useCourses();
  const { data: programmesData } = useProgrammes();
  const deleteCourseMutation = useDeleteCourse();

  const courses = coursesData?.data || [];
  const programmes = programmesData?.data || [];

  // Filter and search courses
  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      const matchesProgramme = programmeFilter === "all" || course.programmeId === programmeFilter;

      return matchesProgramme;
    });
  }, [courses, programmeFilter]);

  const handleCreateNew = () => {
    router.push("/academic/courses/new");
  };

  const handleEdit = (course: Course) => {
    router.push(`/academic/courses/${course.id}/edit`);
  };

  const handleDelete = async (course: Course) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer le cours "${course.name}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        console.log("Attempting to delete course:", course.id);
        await deleteCourseMutation.mutateAsync(course.id);
        console.log("Course deleted successfully");
      } catch (error: any) {
        console.error("Error deleting course:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        
        // Check if error mentions materials or assignments
        const hasMaterials = errorMessage.toLowerCase().includes("matériaux");
        const hasAssignments = errorMessage.toLowerCase().includes("devoirs");
        
        let fullMessage = `Erreur lors de la suppression du cours:\n\n${errorMessage}`;
        
        if (hasMaterials || hasAssignments) {
          fullMessage += `\n\nSouhaitez-vous accéder à la page de détails du cours pour supprimer les éléments associés ?`;
          if (window.confirm(fullMessage)) {
            router.push(`/academic/courses/${course.id}`);
          }
        } else {
          alert(fullMessage);
        }
      }
    }
  };


  const getDayName = (day?: number) => {
    const days = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    return day ? days[day] : "";
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
          <div>
            <h2 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Matières</h2>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Gérez les matières et contenus pédagogiques
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
                  Impossible de charger les matières. Vérifiez votre connexion.
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
          <h1 className="font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Matières
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez les matières et contenus pédagogiques
          </p>
        </div>
        <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle matière
        </Button>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total matières
                </p>
                <p className="text-3xl font-bold mt-1">{courses.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Programmes liés
                </p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(courses.map(c => c.programmeId)).size}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Plus className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            {/* Programme Filter */}
            <div className="w-full lg:w-[32rem]">
              <Select value={programmeFilter} onValueChange={setProgrammeFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-green-500 focus:ring-green-500">
                  <BookOpen className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par programme" />
                </SelectTrigger>
                <SelectContent>
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
              <span className="font-medium">{filteredCourses.length}</span>
              <span className="ml-1">
                {filteredCourses.length === 1 ? 'matière affichée' : 'matières affichées'}
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
              <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des matières...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Courses List */}
      {!isLoading && filteredCourses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredCourses.map((course) => {
            const programme = programmes.find(p => p.id === course.programmeId);
            return (
              <div
                key={course.id}
                className="bg-gradient-to-br from-green-500 via-teal-500 to-blue-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg">{course.name}</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                    {programme && (
                      <p className="text-white/90 col-span-2">
                        <span className="font-medium">Programme:</span> {programme.name}
                      </p>
                    )}
                    {course.bilanType && (
                      <p className="text-white/90 col-span-2">
                        <span className="font-medium">Type de bilan:</span> {course.bilanType.name}
                      </p>
                    )}
                    {course.cm && (
                      <p className="text-white/90">
                        <span className="font-medium">CM:</span> {course.cm}
                      </p>
                    )}
                    {course.td && (
                      <p className="text-white/90">
                        <span className="font-medium">TD:</span> {course.td}
                      </p>
                    )}
                    {course.tp && (
                      <p className="text-white/90">
                        <span className="font-medium">TP:</span> {course.tp}
                      </p>
                    )}
                    {course.coef !== undefined && (
                      <p className="text-white/90">
                        <span className="font-medium">COEF:</span> {course.coef}
                      </p>
                    )}
                    {course.vhh && (
                      <p className="text-white/90">
                        <span className="font-medium">VHH:</span> {course.vhh}
                      </p>
                    )}
                    {course.scheduleDay && course.scheduleTime && (
                      <p className="text-white/90 col-span-2 flex items-center">
                        <Calendar className="w-4 h-4 mr-1" />
                        {getDayName(course.scheduleDay)} à {course.scheduleTime}
                      </p>
                    )}
                    {course.classroom && (
                      <p className="text-white/90 col-span-2 flex items-center">
                        <MapPin className="w-4 h-4 mr-1" />
                        Salle {course.classroom}
                      </p>
                    )}
                  </div>

                  {course.description && (
                    <p className="text-white/80 text-sm mb-4 line-clamp-2">
                      {course.description}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/academic/courses/${course.id}`);
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
                        handleEdit(course);
                      }}
                      title="Modifier"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-red-50 hover:bg-red-100 text-red-600 border-red-100 transition-all duration-200 p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(course);
                      }}
                      disabled={deleteCourseMutation.isPending}
                      title="Supprimer"
                    >
                      {deleteCourseMutation.isPending ? (
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

      {/* Empty State - No courses at all */}
      {!isLoading && courses.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Calendar className="h-10 w-10 text-green-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune matière trouvée</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre première matière
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer une matière
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && courses.length > 0 && filteredCourses.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <BookOpen className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucune matière ne correspond au programme sélectionné
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setProgrammeFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle matière
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}



    </div>
  );
}
