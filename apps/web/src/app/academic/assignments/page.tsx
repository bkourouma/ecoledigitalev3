"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Settings, Plus, Filter, Loader2, AlertCircle, Edit, Trash2, Search, X, User, BookOpen, Calendar, Clock, CalendarPlus } from "lucide-react";
import { useTeacherAssignments, useDeleteTeacherAssignment, useGenerateMissingAssignmentSessions, TeacherAssignment } from "@/lib/hooks/use-teacher-assignments";
import { useTeachers } from "@/lib/hooks/use-teachers";
import { useClasses } from "@/lib/hooks/use-classes";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { formatAmountFCFA } from "@/lib/utils";

export default function AssignmentsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;

  const { data: assignmentsData, isLoading, error } = useTeacherAssignments({
    page: 1,
    limit: 100,
    showAll: true,
    academicYearId: activeAcademicYearId || undefined,
  });
  const { data: teachersData } = useTeachers({});
  const { data: classesData } = useClasses({ includeDetails: false });
  const deleteAssignmentMutation = useDeleteTeacherAssignment();
  const generateSessionsMutation = useGenerateMissingAssignmentSessions();

  const assignments: TeacherAssignment[] = assignmentsData?.data || [];
  const teachers = teachersData?.data || [];
  const classes = classesData?.data || [];

  // Filter and search assignments
  const filteredAssignments = useMemo(() => {
    return assignments.filter((assignment: TeacherAssignment) => {
      const matchesSearch = searchQuery === "" ||
        (assignment.teacherName && assignment.teacherName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (assignment.courseName && assignment.courseName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (assignment.className && assignment.className.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesTeacher = teacherFilter === "all" || assignment.teacherId === teacherFilter;
      const matchesClass = classFilter === "all" || assignment.classId === classFilter;
      const matchesStatus = statusFilter === "all" || assignment.status === statusFilter;

      return matchesSearch && matchesTeacher && matchesClass && matchesStatus;
    });
  }, [assignments, searchQuery, teacherFilter, classFilter, statusFilter]);

  const handleCreateNew = () => {
    router.push("/academic/assignments/new");
  };

  const handleGenerateMissingSessions = async () => {
    const activeAssignmentIds = assignments
      .filter((assignment: TeacherAssignment) => assignment.status === "active")
      .map((assignment: TeacherAssignment) => assignment.id);

    if (activeAssignmentIds.length === 0) {
      alert("Aucune affectation active disponible pour générer des créneaux.");
      return;
    }

    const confirmed = window.confirm(
      `Générer les créneaux manquants pour ${activeAssignmentIds.length} affectation(s) active(s) ?\n\nLes affectations qui ont déjà des créneaux seront ignorées.`
    );

    if (!confirmed) return;

    try {
      const result = await generateSessionsMutation.mutateAsync({
        assignmentIds: activeAssignmentIds,
      });
      alert(
        `${result.created} créneau(x) généré(s).\n${result.skipped} affectation(s) ignorée(s) car elles avaient déjà des créneaux ou ne pouvaient pas être planifiées.`
      );
    } catch (error: any) {
      console.error("Error generating missing sessions:", error);
      alert(`Erreur lors de la génération des créneaux:\n\n${error?.message || "Erreur inconnue"}`);
    }
  };

  const handleEdit = (assignment: TeacherAssignment) => {
    router.push(`/academic/assignments/${assignment.id}/edit`);
  };

  const handleDelete = async (assignment: TeacherAssignment) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer l'affectation de "${assignment.teacherName || 'l\'enseignant'}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteAssignmentMutation.mutateAsync(assignment.id);
      } catch (error: any) {
        console.error('Error deleting assignment:', error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        alert(`Erreur lors de la suppression de l'affectation:\n\n${errorMessage}`);
      }
    }
  };

  const getStatusLabel = (status: string) => {
    const statuses: Record<string, string> = {
      active: 'Actif',
      paused: 'En pause',
      ended: 'Terminé',
      cancelled: 'Annulé',
    };
    return statuses[status] || status;
  };

  const getContractTypeLabel = (type: string) => {
    return type === 'salarie' ? 'Salarié' : 'Vacataire';
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Affectations des cours
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez l'attribution des cours aux enseignants et le suivi des heures
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={handleGenerateMissingSessions}
            disabled={generateSessionsMutation.isPending || isLoading}
            className="border-red-200 hover:bg-red-50"
          >
            {generateSessionsMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4 mr-2" />
            )}
            Générer les créneaux
          </Button>
          <Button
            onClick={handleCreateNew}
            className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle affectation
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-red-500 to-rose-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total affectations
                </p>
                <p className="text-3xl font-bold mt-1">{assignments.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Settings className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-rose-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Affectations actives
                </p>
                <p className="text-3xl font-bold mt-1">
                  {assignments.filter(a => a.status === 'active').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Clock className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-red-400 to-rose-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Enseignants concernés
                </p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(assignments.map(a => a.teacherId)).size}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <User className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-500 to-red-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Classes concernées
                </p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(assignments.map(a => a.classId).filter(Boolean)).size}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
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
                placeholder="Rechercher par enseignant, cours ou classe..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-red-500 focus:ring-red-500"
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

            {/* Teacher Filter */}
            <div className="lg:w-48">
              <Select value={teacherFilter} onValueChange={setTeacherFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-red-500 focus:ring-red-500">
                  <User className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par enseignant" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Tous les enseignants</SelectItem>
                  {teachers.map((teacher: any) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.firstName} {teacher.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Class Filter */}
            <div className="lg:w-48">
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-red-500 focus:ring-red-500">
                  <BookOpen className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par classe" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {classes.map((cls: any) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name} ({cls.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="lg:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-red-500 focus:ring-red-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par statut" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="active">Actif</SelectItem>
                  <SelectItem value="paused">En pause</SelectItem>
                  <SelectItem value="ended">Terminé</SelectItem>
                  <SelectItem value="cancelled">Annulé</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-foreground/80 whitespace-nowrap">
              <span className="font-medium">{filteredAssignments.length}</span>
              <span className="ml-1">
                {filteredAssignments.length === 1 ? 'affectation trouvée' : 'affectations trouvées'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Erreur de chargement</h3>
                <p className="text-muted-foreground">
                  Impossible de charger les affectations. Vérifiez votre connexion.
                </p>
              </div>
              <Button onClick={() => window.location.reload()}>
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-red-100 to-rose-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-red-600" />
              </div>
              <p className="text-foreground/80 text-lg">Chargement des affectations...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assignments List */}
      {!isLoading && filteredAssignments.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAssignments.map((assignment) => {
            return (
              <div
                key={assignment.id}
                className="bg-gradient-to-br from-red-500 via-rose-500 to-pink-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
              >
                <div className="relative z-10">
                  <div className="mb-4">
                    <h3 className="font-semibold text-lg text-white">{assignment.teacherName || 'Enseignant'}</h3>
                  </div>

                  <div className="space-y-2 mb-4">
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Classe:</span> {assignment.className || 'N/A'} {assignment.classCode && `(${assignment.classCode})`}
                    </p>
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Cours:</span> {assignment.courseName || 'N/A'} {assignment.courseCode && `(${assignment.courseCode})`}
                    </p>
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Type:</span> {getContractTypeLabel(assignment.contractType)}
                    </p>
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Statut:</span> {getStatusLabel(assignment.status)}
                    </p>
                    <p className="text-white/90 text-sm flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      {new Date(assignment.datebut).toLocaleDateString('fr-FR')} - {new Date(assignment.datefin).toLocaleDateString('fr-FR')}
                    </p>
                    {assignment.courseAmount && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Montant:</span> {formatAmountFCFA(assignment.courseAmount)}
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
                        handleEdit(assignment);
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
                        handleDelete(assignment);
                      }}
                      disabled={deleteAssignmentMutation.isPending}
                      title="Supprimer"
                    >
                      {deleteAssignmentMutation.isPending ? (
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

      {/* Empty State - No assignments at all */}
      {!isLoading && assignments.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-red-100 to-rose-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Settings className="h-10 w-10 text-red-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Aucune affectation trouvée</h3>
                <p className="text-foreground/80 text-lg">
                  Commencez par créer votre première affectation
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer une affectation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && assignments.length > 0 && filteredAssignments.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Aucun résultat trouvé</h3>
                <p className="text-foreground/80 text-lg">
                  Aucune affectation ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setTeacherFilter("all");
                    setClassFilter("all");
                    setStatusFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle affectation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
