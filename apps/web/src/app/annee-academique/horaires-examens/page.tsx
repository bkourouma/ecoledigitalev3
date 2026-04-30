"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Clock, Plus, Filter, Loader2, AlertCircle, Edit, Trash2, Search, X, BookOpen, MapPin, Calendar } from "lucide-react";
import { useExamSchedules, useDeleteExamSchedule, ExamSchedule } from "@/lib/hooks/use-exam-schedules";
import { useCourses } from "@/lib/hooks/use-courses";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

export default function ExamSchedulesPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;

  const { data: examSchedulesData, isLoading, error } = useExamSchedules({
    academicYearId: activeAcademicYearId || undefined,
  });
  const { data: coursesData } = useCourses({ status: 'active' });
  const { data: academicYearsData } = useAcademicYears();
  const deleteExamScheduleMutation = useDeleteExamSchedule();

  const examSchedules = examSchedulesData?.data || [];
  const courses = coursesData?.data || [];
  const academicYears = academicYearsData?.data || [];

  // Filter and search exam schedules
  const filteredExamSchedules = useMemo(() => {
    return examSchedules.filter((examSchedule) => {
      const matchesSearch = searchQuery === "" ||
        examSchedule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (examSchedule.courseName && examSchedule.courseName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (examSchedule.location && examSchedule.location.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCourse = courseFilter === "all" || examSchedule.courseId === courseFilter;
      const matchesType = typeFilter === "all" || examSchedule.type === typeFilter;

      return matchesSearch && matchesCourse && matchesType;
    });
  }, [examSchedules, searchQuery, courseFilter, typeFilter]);

  const handleCreateNew = () => {
    router.push("/annee-academique/horaires-examens/new");
  };

  const handleEdit = (examSchedule: ExamSchedule) => {
    router.push(`/annee-academique/horaires-examens/${examSchedule.id}/edit`);
  };

  const handleDelete = async (examSchedule: ExamSchedule) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer l'horaire d'examen "${examSchedule.name}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteExamScheduleMutation.mutateAsync(examSchedule.id);
      } catch (error: any) {
        console.error("Error deleting exam schedule:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        alert(`Erreur lors de la suppression de l'horaire d'examen:\n\n${errorMessage}`);
      }
    }
  };

  const getExamTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      midterm: { label: 'Contrôle Intermédiaire', variant: 'default' },
      final: { label: 'Examen Final', variant: 'destructive' },
      quiz: { label: 'Quiz', variant: 'secondary' },
      assignment: { label: 'Devoir', variant: 'outline' },
      other: { label: 'Autre', variant: 'outline' },
    };
    return types[type] || types.other;
  };

  const getExamTypeLabel = (type: string) => {
    return getExamTypeBadge(type).label;
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Horaires d'Examens</h2>
            <p className="text-muted-foreground">
              Gérez les horaires d'examens pour les cours
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
                  Impossible de charger les horaires d'examens. Vérifiez votre connexion.
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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
            Horaires d'Examens
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les horaires d'examens pour les cours (examens finaux, contrôles intermédiaires, quiz, devoirs)
          </p>
        </div>
        <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvel horaire
        </Button>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-orange-500 to-amber-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total horaires
                </p>
                <p className="text-3xl font-bold mt-1">{examSchedules.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Clock className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-yellow-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Examens finaux
                </p>
                <p className="text-3xl font-bold mt-1">
                  {examSchedules.filter(e => e.type === 'final').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-400 to-red-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Contrôles
                </p>
                <p className="text-3xl font-bold mt-1">
                  {examSchedules.filter(e => e.type === 'midterm').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Filter className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Cours concernés
                </p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(examSchedules.map(e => e.courseId)).size}
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
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom, cours ou lieu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-orange-500 focus:ring-orange-500"
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

            {/* Course Filter */}
            <div className="lg:w-48">
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-orange-500 focus:ring-orange-500">
                  <BookOpen className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par cours" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Tous les cours</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Type Filter */}
            <div className="lg:w-48">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-orange-500 focus:ring-orange-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par type" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="final">Examen Final</SelectItem>
                  <SelectItem value="midterm">Contrôle Intermédiaire</SelectItem>
                  <SelectItem value="quiz">Quiz</SelectItem>
                  <SelectItem value="assignment">Devoir</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-foreground/80 whitespace-nowrap">
              <span className="font-medium">{filteredExamSchedules.length}</span>
              <span className="ml-1">
                {filteredExamSchedules.length === 1 ? 'horaire trouvé' : 'horaires trouvés'}
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
              <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
              </div>
              <p className="text-foreground/80 text-lg">Chargement des horaires d'examens...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exam Schedules List */}
      {!isLoading && filteredExamSchedules.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExamSchedules.map((examSchedule) => {
            const course = courses.find(c => c.id === examSchedule.courseId);
            const academicYear = academicYears.find(y => y.id === examSchedule.academicYearId);
            return (
              <div
                key={examSchedule.id}
                className="bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
              >
                <div className="relative z-10">
                  <div className="mb-4">
                    <h3 className="font-semibold text-lg text-white">{examSchedule.name}</h3>
                  </div>

                  <div className="space-y-2 mb-4">
                    {course && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Cours:</span> {course.name}
                      </p>
                    )}
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Type:</span> {getExamTypeLabel(examSchedule.type)}
                    </p>
                    <p className="text-white/90 text-sm flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      {new Date(examSchedule.examDate).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                      {examSchedule.examTime && ` à ${examSchedule.examTime}`}
                    </p>
                    {examSchedule.duration && (
                      <p className="text-white/90 text-sm flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        Durée: {examSchedule.duration} min
                      </p>
                    )}
                    {examSchedule.location && (
                      <p className="text-white/90 text-sm flex items-center">
                        <MapPin className="w-4 h-4 mr-1" />
                        {examSchedule.location}
                      </p>
                    )}
                    {academicYear && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Année:</span> {academicYear.name}
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
                        handleEdit(examSchedule);
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
                        handleDelete(examSchedule);
                      }}
                      disabled={deleteExamScheduleMutation.isPending}
                      title="Supprimer"
                    >
                      {deleteExamScheduleMutation.isPending ? (
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

      {/* Empty State - No exam schedules at all */}
      {!isLoading && examSchedules.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Clock className="h-10 w-10 text-orange-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Aucun horaire d'examen trouvé</h3>
                <p className="text-foreground/80 text-lg">
                  Commencez par créer votre premier horaire d'examen
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un horaire
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && examSchedules.length > 0 && filteredExamSchedules.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Aucun résultat trouvé</h3>
                <p className="text-foreground/80 text-lg">
                  Aucun horaire d'examen ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setCourseFilter("all");
                    setTypeFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvel horaire
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
