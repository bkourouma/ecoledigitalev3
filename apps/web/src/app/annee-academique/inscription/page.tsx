"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Badge } from "@ecoledigitale/ui";
import { Users, Plus, Filter, Search, X, Edit, Trash2, Loader2, AlertCircle, CheckCircle2, GraduationCap, DollarSign } from "lucide-react";
import { useEnrollments, useDeleteEnrollment, type StudentEnrollmentWithDetails } from "@/lib/hooks/use-enrollments";
import { useClasses } from "@/lib/hooks/use-classes";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { formatAmountFCFA } from "@/lib/utils";

export default function InscriptionPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");

  const { data: activeYearData } = useActiveAcademicYear();
  const { data: enrollmentsData, isLoading, error } = useEnrollments({
    academicYearId: activeYearData?.data?.id,
    includeDetails: true
  });
  const { data: classesData } = useClasses({
    academicYearId: activeYearData?.data?.id,
    includeDetails: true
  });
  const deleteEnrollmentMutation = useDeleteEnrollment();

  const enrollments = enrollmentsData?.data || [];
  const classes = classesData?.data || [];
  const activeYear = activeYearData?.data;

  // Filter and search enrollments
  const filteredEnrollments = useMemo(() => {
    return enrollments.filter((enrollment) => {
      const matchesSearch = searchQuery === "" ||
        (enrollment.student?.firstName && enrollment.student.firstName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (enrollment.student?.lastName && enrollment.student.lastName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (enrollment.student?.email && enrollment.student.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (enrollment.student?.studentNumber && enrollment.student.studentNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (enrollment.class?.name && enrollment.class.name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesClass = classFilter === "all" || enrollment.classId === classFilter;

      return matchesSearch && matchesClass;
    });
  }, [enrollments, searchQuery, classFilter]);

  const handleCreateNew = () => {
    router.push("/annee-academique/inscription/new");
  };

  const handleEdit = (enrollment: StudentEnrollmentWithDetails) => {
    router.push(`/annee-academique/inscription/${enrollment.id}/edit`);
  };

  const handleDelete = async (enrollment: StudentEnrollmentWithDetails) => {
    const studentName = enrollment.student 
      ? `${enrollment.student.firstName} ${enrollment.student.lastName}`
      : "cet étudiant";
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer l'inscription de ${studentName} ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteEnrollmentMutation.mutateAsync(enrollment.id);
      } catch (error: any) {
        console.error("Error deleting enrollment:", error);
        alert(`Erreur lors de la suppression: ${error?.message || "Erreur inconnue"}`);
      }
    }
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
              Vous devez d'abord créer et activer une année académique avant de pouvoir inscrire des étudiants.
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

  if (error) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
          <div>
            <h2 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Inscriptions</h2>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Gérez les inscriptions des étudiants
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
                  Impossible de charger les inscriptions. Vérifiez votre connexion.
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

  // Calculate statistics
  const stats = {
    totalEnrollments: enrollments.length,
    activeEnrollments: enrollments.filter(e => e.status === 'active').length,
    totalFees: enrollments.reduce((sum, e) => {
      const fees = typeof e.fees === 'string' ? JSON.parse(e.fees) : e.fees;
      return sum + (fees?.total || 0);
    }, 0),
    classesCount: new Set(enrollments.map(e => e.classId)).size,
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Inscriptions des Étudiants
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez les inscriptions des étudiants pour l'année académique {activeYear.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-cyan-100 text-cyan-800 border-cyan-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {activeYear.name}
          </Badge>
          <Button
            onClick={handleCreateNew}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle inscription
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total inscriptions
                </p>
                <p className="text-3xl font-bold mt-1">{stats.totalEnrollments}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Actives
                </p>
                <p className="text-3xl font-bold mt-1">{stats.activeEnrollments}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Classes
                </p>
                <p className="text-3xl font-bold mt-1">{stats.classesCount}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <GraduationCap className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total frais
                </p>
                <p className="text-3xl font-bold mt-1">
                  {formatAmountFCFA(stats.totalFees)}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <DollarSign className="h-6 w-6" />
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
                placeholder="Rechercher par nom, email, matricule ou classe..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-cyan-500 focus:ring-cyan-500"
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

            {/* Class Filter */}
            <div className="lg:w-48">
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-cyan-500 focus:ring-cyan-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par classe" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {classes.map((classe) => (
                    <SelectItem key={classe.id} value={classe.id}>
                      {classe.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredEnrollments.length}</span>
              <span className="ml-1">
                {filteredEnrollments.length === 1 ? 'inscription trouvée' : 'inscriptions trouvées'}
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
              <div className="bg-gradient-to-br from-cyan-100 to-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des inscriptions...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && filteredEnrollments.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-cyan-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-cyan-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {searchQuery || classFilter !== "all" ? "Aucun résultat trouvé" : "Aucune inscription trouvée"}
                </h3>
                <p className="text-gray-600 text-lg">
                  {searchQuery || classFilter !== "all" 
                    ? "Aucune inscription ne correspond à vos critères de recherche"
                    : "Commencez par créer votre première inscription"}
                </p>
              </div>
              {!searchQuery && classFilter === "all" && (
                <Button onClick={handleCreateNew} className="bg-gradient-to-r from-cyan-500 to-blue-600">
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle inscription
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enrollments List */}
      {!isLoading && filteredEnrollments.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEnrollments.map((enrollment) => {
            return (
              <div
                key={enrollment.id}
                className="bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group"
              >
                <div className="relative z-10">
                  <div className="mb-4">
                    <h3 className="font-semibold text-lg">
                      {enrollment.student?.firstName} {enrollment.student?.lastName}
                    </h3>
                  </div>

                  <div className="space-y-2 mb-4">
                    {enrollment.student?.email && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Email:</span> {enrollment.student.email}
                      </p>
                    )}
                    {enrollment.student?.studentNumber && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Matricule:</span> {enrollment.student.studentNumber}
                      </p>
                    )}
                    {enrollment.class && (
                      <p className="text-white/90 text-sm">
                        <span className="font-medium">Classe:</span> {enrollment.class.name} ({enrollment.class.code})
                      </p>
                    )}
                    {enrollment.class?.programme && (
                      <p className="text-white/80 text-sm truncate" title={enrollment.class.programme.name}>
                        {enrollment.class.programme.name}
                      </p>
                    )}
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Date:</span> {new Date(enrollment.enrollmentDate).toLocaleDateString('fr-FR')}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(enrollment);
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
                        handleDelete(enrollment);
                      }}
                      disabled={deleteEnrollmentMutation.isPending}
                      title="Supprimer"
                    >
                      {deleteEnrollmentMutation.isPending ? (
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
    </div>
  );
}
