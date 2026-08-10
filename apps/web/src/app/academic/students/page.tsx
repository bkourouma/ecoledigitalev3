"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Users, Plus, Search, Filter, GraduationCap, Loader2, AlertCircle, Eye, EyeOff, Edit, Trash2, FileSpreadsheet, FileText, X, Mail, Phone, Calendar, MapPin } from "lucide-react";
import { useStudents, useDeleteStudent, useResetStudentPassword } from "@/lib/hooks/use-students";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { StudentWithUser } from "@ecoledigitale/contracts";
import { exportStudentsToExcel, exportStudentsToWord, StudentExportData } from "@/lib/utils/student-export";

export default function StudentsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  const [academicYearFilter, setAcademicYearFilter] = useState<string>("all");
  const [programmeFilter, setProgrammeFilter] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [generatedPasswords, setGeneratedPasswords] = useState<Record<string, string>>({});
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);

  const { data: studentsData, isLoading, error } = useStudents({
    search: searchQuery || undefined,
    academicYearId: academicYearFilter !== "all" ? academicYearFilter : undefined,
    page: 1,
    limit: 1000,
  });
  const { data: academicYearsData } = useAcademicYears({ includeStats: true });
  const { data: programmesData } = useProgrammes({ limit: 100 });
  const deleteStudentMutation = useDeleteStudent();
  const resetStudentPasswordMutation = useResetStudentPassword();
  const students = studentsData?.data || [];
  const academicYears = academicYearsData?.data || [];
  const programmes = programmesData?.data || [];
  const userRoles: string[] = (session as any)?.roles || [];
  const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");
  const getDisplayMatricule = (student: StudentWithUser) => {
    const establishmentMatricule = (student as any).establishmentMatricule;
    return establishmentMatricule || student.studentNumber;
  };
  // Matricule saisi par la scolarité, affiché en plus du numéro séquentiel.
  const getStudentMatricule = (student: StudentWithUser) =>
    (student as any).studentMatricule as string | null | undefined;

  const academicYearOptions = useMemo(() => {
    return academicYears.map((year: any) => ({
      value: year.id,
      label: year.name,
    }));
  }, [academicYears]);

  const programmeOptions = useMemo(() => {
    if (programmes.length > 0) {
      return programmes.map((programme: any) => ({
        value: programme.id,
        label: programme.name,
      }));
    }

    const fallbackProgrammes = students
      .map((student: StudentWithUser) => (student as any).programmeName)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return Array.from(new Set(fallbackProgrammes)).map((name) => ({ value: name, label: name }));
  }, [programmes, students]);

  // Filter students (client-side filtering for consistency with courses page)
  const filteredStudents = useMemo(() => {
    return students.filter((student: StudentWithUser) => {
      const matchesSearch = searchQuery === "" ||
        `${student.user?.firstName || ''} ${student.user?.lastName || ''}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.user?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.studentNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (((student as any).establishmentMatricule || "").toLowerCase().includes(searchQuery.toLowerCase())) ||
        ((getStudentMatricule(student) || "").toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesAcademicYear =
        academicYearFilter === "all" ||
        (student as any).academicYearId === academicYearFilter;

      const selectedProgramme = programmeOptions.find((p) => p.value === programmeFilter);
      const matchesProgramme =
        programmeFilter === "all" ||
        (student as any).programmeName === selectedProgramme?.label;

      return matchesSearch && matchesAcademicYear && matchesProgramme;
    });
  }, [students, searchQuery, academicYearFilter, programmeFilter, programmeOptions]);

  const studentTotalCount =
    programmeFilter === "all"
      ? studentsData?.pagination?.total ?? filteredStudents.length
      : filteredStudents.length;

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

  const handleExportToExcel = async () => {
    setIsExporting(true);
    try {
      const exportData: StudentExportData = {
        students: filteredStudents,
        exportDate: new Date().toLocaleDateString('fr-FR'),
        totalCount: filteredStudents.length
      };
      exportStudentsToExcel(exportData);
    } catch (error) {
      console.error("Failed to export to Excel:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportToWord = async () => {
    setIsExporting(true);
    try {
      const exportData: StudentExportData = {
        students: filteredStudents,
        exportDate: new Date().toLocaleDateString('fr-FR'),
        totalCount: filteredStudents.length
      };
      exportStudentsToWord(exportData);
    } catch (error) {
      console.error("Failed to export to Word:", error);
    } finally {
      setIsExporting(false);
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

  const togglePasswordVisibility = (studentId: string) => {
    setRevealedPasswords((prev) => ({ ...prev, [studentId]: !prev[studentId] }));
  };

  const getStudentPassword = (student: StudentWithUser): string | null => {
    const s = student as any;
    const localPassword = generatedPasswords[student.id];
    if (localPassword) return localPassword;

    const candidates = [
      s.initialPassword,
      s.temporaryPassword,
      s.tempPassword,
      s.generatedPassword,
      s.defaultPassword,
      s.plainPassword,
      s.user?.initialPassword,
      s.user?.temporaryPassword,
      s.user?.tempPassword,
      s.user?.generatedPassword,
      s.user?.defaultPassword,
      s.user?.plainPassword,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const value = candidate.trim();
      if (!value) continue;
      // Avoid showing password hashes if backend sends them.
      if (/^\$2[aby]\$/.test(value)) continue;
      return value;
    }

    return null;
  };

  const handlePasswordAction = async (student: StudentWithUser) => {
    const currentPassword = getStudentPassword(student);
    if (currentPassword) {
      togglePasswordVisibility(student.id);
      return;
    }

    if (!isAdmin) return;

    try {
      setResettingPasswordFor(student.id);
      const result = await resetStudentPasswordMutation.mutateAsync(student.id);
      setGeneratedPasswords((prev) => ({ ...prev, [student.id]: result.initialPassword }));
      setRevealedPasswords((prev) => ({ ...prev, [student.id]: true }));
    } catch (error: any) {
      alert(error?.message || "Impossible de générer le mot de passe");
    } finally {
      setResettingPasswordFor(null);
    }
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
            variant="outline"
            onClick={handleExportToExcel}
            disabled={isExporting || filteredStudents.length === 0}
            className="bg-green-50 border-green-200 hover:bg-green-100 text-green-700 hover:text-green-800 shadow-sm"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 mr-2" />
            )}
            Excel
          </Button>
          <Button
            variant="outline"
            onClick={handleExportToWord}
            disabled={isExporting || filteredStudents.length === 0}
            className="bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-700 hover:text-blue-800 shadow-sm"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Word
          </Button>
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

      {/* Search and Filter Controls */}
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

            {/* Status Filter */}
            <div className="lg:w-48">
              <Select value={academicYearFilter} onValueChange={setAcademicYearFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-teal-500 focus:ring-teal-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par année académique" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les années académiques</SelectItem>
                  {academicYearOptions.map((yearOption) => (
                    <SelectItem key={yearOption.value} value={yearOption.value}>
                      {yearOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Programme Filter */}
            <div className="lg:w-48">
              <Select value={programmeFilter} onValueChange={setProgrammeFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-teal-500 focus:ring-teal-500">
                  <GraduationCap className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par programme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les programmes</SelectItem>
                  {programmeOptions.map((programme) => (
                    <SelectItem key={programme.value} value={programme.value}>
                      {programme.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
      {!isLoading && filteredStudents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredStudents.map((student: StudentWithUser) => {
            const studentPassword = getStudentPassword(student);
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
                      <span className="font-medium">Matricule:</span> {getStudentMatricule(student)}
                    </p>
                  )}
                  {((student as any).academicYearName || student.currentYear) && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Année:</span>{" "}
                      {(student as any).academicYearName || `Année ${student.currentYear}`}
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
                    <div className="text-white/90 text-sm">
                      <span className="font-medium">Mot de passe:</span>{" "}
                      {studentPassword
                        ? (revealedPasswords[student.id] ? studentPassword : "********")
                        : "Non disponible"}
                    </div>
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
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 px-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handlePasswordAction(student);
                    }}
                    title={
                      studentPassword
                        ? (revealedPasswords[student.id] ? "Masquer le mot de passe" : "Voir le mot de passe")
                        : (isAdmin ? "Générer puis afficher le mot de passe" : "Mot de passe non disponible")
                    }
                    disabled={
                      resettingPasswordFor === student.id ||
                      (!studentPassword && !isAdmin)
                    }
                  >
                    {resettingPasswordFor === student.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Génération...
                      </>
                    ) : revealedPasswords[student.id] ? (
                      <>
                        <EyeOff className="w-4 h-4 mr-1" />
                        Masquer MDP
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 mr-1" />
                        {studentPassword ? "Voir MDP" : (isAdmin ? "Générer MDP" : "Voir MDP")}
                      </>
                    )}
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

      {/* Empty State - No students at all */}
      {!isLoading && students.length === 0 && (
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
      {!isLoading && students.length > 0 && filteredStudents.length === 0 && (
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
                  onClick={() => {
                    setSearchQuery("");
                    setAcademicYearFilter("all");
                    setProgrammeFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
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
