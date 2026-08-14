"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Users, Plus, Search, Loader2, AlertCircle, Eye, Edit, Trash2, X, Mail, Phone, Calendar, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import { useStudents, useDeleteStudent } from "@/lib/hooks/use-students";
import { StudentWithUser } from "@ecoledigitale/contracts";

/** Tailles de page proposées ; la première est la valeur par défaut. */
const PAGE_SIZES = [10, 50, 100] as const;

export default function StudentsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  // Une nouvelle recherche repart de la première page : rester sur la page 7
  // d'un résultat qui n'en compte que 2 afficherait une liste vide.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  const { data: studentsData, isLoading, error } = useStudents({
    search: searchQuery || undefined,
    page,
    limit: pageSize,
  });
  const deleteStudentMutation = useDeleteStudent();
  // La recherche et la pagination sont faites par l'API : les lignes reçues sont
  // exactement celles à afficher, aucun filtrage client ne s'y ajoute.
  const students = studentsData?.data || [];
  // Matricule saisi par la scolarité, affiché en plus du numéro séquentiel.
  const getStudentMatricule = (student: StudentWithUser) =>
    (student as any).studentMatricule as string | null | undefined;
  // Numéro d'ordre figé de l'étudiant, sur 4 chiffres (`0075`). Attribué à la
  // création de la fiche : présent pour tous, y compris hors module professionnel.
  const getSequenceNumber = (student: StudentWithUser) => {
    const value = (student as any).sequenceNumber as number | null | undefined;
    return value == null ? null : String(value).padStart(4, "0");
  };

  const studentTotalCount: number = studentsData?.pagination?.total ?? students.length;
  const totalPages = Math.max(1, Math.ceil(studentTotalCount / pageSize));
  const firstShown = studentTotalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, studentTotalCount);

  const handleView = (student: StudentWithUser) => {
    router.push(`/academic/students/${student.id}`);
  };

  const handleEdit = (student: StudentWithUser) => {
    router.push(`/academic/students/${student.id}/edit`);
  };

  const handleDelete = async (student: StudentWithUser) => {
    const u: any = (student as any).user ?? {};
    const first = (student as any).firstName ?? u.firstName ?? u.first_name ?? "";
    const last = (student as any).lastName ?? u.lastName ?? u.last_name ?? "";
    const displayName = [first, last].filter(Boolean).join(" ").trim() || u.name || (student as any).email || u.email || "cet étudiant";
    
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer l'étudiant "${displayName}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteStudentMutation.mutateAsync(student.id);
      } catch (error: any) {
        console.error("Error deleting student:", error);
        alert(error?.message || "Erreur lors de la suppression de l'étudiant");
      }
    }
  };

  const getStudentName = (student: StudentWithUser) => {
    const u = (student.user ?? {}) as any;
    const first = u.firstName ?? (student as any).firstName ?? u.first_name ?? "";
    const last = u.lastName ?? (student as any).lastName ?? u.last_name ?? "";
    const nameFromUser = u.name ?? (student as any).name;
    const email = u.email ?? (student as any).email;
    const full = [first, last].filter(Boolean).join(" ").trim();
    if (full) return full;
    if (nameFromUser) return nameFromUser;
    if (email) return String(email).split("@")[0];
    return 'Étudiant inconnu';
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Gestion des étudiants</h2>
            <p className="text-muted-foreground">
              Gérez les profils et informations de vos étudiants
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
                  Impossible de charger les étudiants. Vérifiez votre connexion.
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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
            Gestion des étudiants
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les profils et informations de vos étudiants
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => router.push("/academic/students/new")}
            className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvel étudiant
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-gradient-to-br from-teal-500 to-cyan-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total étudiants
                </p>
                <p className="text-3xl font-bold mt-1">{studentTotalCount}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom, email ou matricule..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-teal-500 focus:ring-teal-500"
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
              <span className="font-medium">{studentTotalCount}</span>
              <span className="ml-1">
                {studentTotalCount === 1 ? 'étudiant trouvé' : 'étudiants trouvés'}
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
              <div className="bg-gradient-to-br from-teal-100 to-cyan-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des étudiants...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Students List */}
      {!isLoading && students.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {students.map((student: StudentWithUser) => {
            return (
              <div
                key={student.id}
                className="bg-gradient-to-br from-teal-500 via-cyan-500 to-blue-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
              >
                <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">{getStudentName(student)}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  {getStudentMatricule(student) && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Matricule DESPS:</span> {getStudentMatricule(student)}
                    </p>
                  )}
                  {getSequenceNumber(student) && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Matricule IPAM:</span> {getSequenceNumber(student)}
                    </p>
                  )}
                  {(student as any).className && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Classe:</span> {(student as any).className}
                    </p>
                  )}
                  {(student as any).programmeName && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Filière:</span> {(student as any).programmeName}
                    </p>
                  )}
                  {student.gender && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Sexe:</span> {student.gender === 'masculin' ? 'Masculin' : 'Féminin'}
                    </p>
                  )}
                  {student.user?.email && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Mail className="w-4 h-4 mr-1" />
                      {student.user.email}
                    </p>
                  )}
                  {student.phone && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Phone className="w-4 h-4 mr-1" />
                      {student.phone}
                    </p>
                  )}
                  {student.dateOfBirth && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      Né(e) le {new Date(student.dateOfBirth).toLocaleDateString('fr-FR')}
                    </p>
                  )}
                  {student.placeOfBirth && (
                    <p className="text-white/90 text-sm flex items-center">
                      <MapPin className="w-4 h-4 mr-1" />
                      {student.placeOfBirth}
                    </p>
                  )}
                </div>

                {student.bio && (
                  <p className="text-white/80 text-sm mb-4 line-clamp-2">
                    {student.bio}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleView(student);
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
                      handleEdit(student);
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
                      handleDelete(student);
                    }}
                    disabled={deleteStudentMutation.isPending}
                    title="Supprimer"
                  >
                    {deleteStudentMutation.isPending ? (
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

      {/* Pagination */}
      {!isLoading && students.length > 0 && (
        <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="whitespace-nowrap">Étudiants par page</span>
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
                {firstShown}–{lastShown} sur {studentTotalCount}
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

      {/* Empty State - No students at all */}
      {!isLoading && students.length === 0 && !searchQuery && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-teal-100 to-cyan-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-teal-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun étudiant trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre premier étudiant
                </p>
              </div>
              <Button
                onClick={() => router.push("/academic/students/new")}
                className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un étudiant
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && students.length === 0 && !!searchQuery && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucun étudiant ne correspond à vos critères de recherche
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
                  onClick={() => router.push("/academic/students/new")}
                  className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvel étudiant
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
