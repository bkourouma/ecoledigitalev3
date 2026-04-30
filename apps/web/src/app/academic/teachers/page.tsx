"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { Card, CardContent, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Users, Plus, Search, Filter, UserCheck, Loader2, AlertCircle, Eye, EyeOff, Edit, Trash2, FileSpreadsheet, FileText, X, Mail, Phone, Calendar, Award } from "lucide-react";
import { toast } from "sonner";
import { useAllTeachers, useDeleteTeacher, useResetTeacherPassword, useUpdateTeacher } from "@/lib/hooks/use-teachers";
import { Teacher, ContractType, TeacherStatus } from "@ecoledigitale/contracts";
import { exportTeachersToExcel, exportTeachersToWord, TeacherExportData } from "@/lib/utils/teacher-export";

function TeachersPageContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [contractFilter, setContractFilter] = useState<string>("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [generatedPasswords, setGeneratedPasswords] = useState<Record<string, string>>({});
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);

  const { data: teachersData, isLoading, error } = useAllTeachers();
  const deleteTeacherMutation = useDeleteTeacher();
  const resetTeacherPasswordMutation = useResetTeacherPassword();
  const updateTeacherMutation = useUpdateTeacher();
  const teachers = teachersData?.data || [];

  const userRoles: string[] = (session as any)?.roles || [];
  const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");

  // Get all unique specialties for filter dropdown
  const allSpecialties = Array.from(
    new Set(
      teachers.flatMap((teacher: Teacher) => teacher.specialties || [])
    )
  ).sort();

  // Filter teachers
  const filteredTeachers = useMemo(() => {
    return teachers.filter((teacher: Teacher) => {
      const matchesSearch = searchQuery === "" ||
        `${teacher.firstName} ${teacher.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        teacher.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        teacher.employeeNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        teacher.specialties?.some(specialty =>
          specialty.toLowerCase().includes(searchQuery.toLowerCase())
        ) ||
        teacher.qualifications?.some(qualification =>
          qualification.toLowerCase().includes(searchQuery.toLowerCase())
        );

      const matchesStatus = statusFilter === "all" || teacher.status === statusFilter;
      const matchesContract = contractFilter === "all" || teacher.contractType === contractFilter;
      const matchesSpecialty = specialtyFilter === "all" ||
        teacher.specialties?.includes(specialtyFilter);

      return matchesSearch && matchesStatus && matchesContract && matchesSpecialty;
    });
  }, [teachers, searchQuery, statusFilter, contractFilter, specialtyFilter]);

  const handleView = (teacher: Teacher) => {
    router.push(`/academic/teachers/${teacher.id}`);
  };

  const handleEdit = (teacher: Teacher) => {
    router.push(`/academic/teachers/${teacher.id}/edit`);
  };

  const togglePasswordVisibility = (teacherId: string) => {
    setRevealedPasswords((prev) => ({ ...prev, [teacherId]: !prev[teacherId] }));
  };

  const getTeacherPassword = (teacher: Teacher): string | null => {
    const localPassword = generatedPasswords[teacher.id];
    if (localPassword) return localPassword;

    const raw = (teacher as any).initialPassword;
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (!value) return null;
    if (/^\$2[aby]\$/.test(value)) return null;
    return value;
  };

  const handlePasswordAction = async (teacher: Teacher) => {
    const currentPassword = getTeacherPassword(teacher);
    if (currentPassword) {
      togglePasswordVisibility(teacher.id);
      return;
    }

    if (!isAdmin) return;

    if (!teacher.userId) {
      const email = teacher.email?.trim();
      if (!email) {
        toast.message("Aucun compte de connexion", {
          description:
            "Ajoutez une adresse e-mail sur la fiche enseignant, enregistrez, puis générez le mot de passe.",
          action: {
            label: "Modifier la fiche",
            onClick: () => router.push(`/academic/teachers/${teacher.id}/edit`),
          },
        });
        return;
      }

      try {
        setResettingPasswordFor(teacher.id);
        const updated = await updateTeacherMutation.mutateAsync({
          id: teacher.id,
          data: {},
        });
        const initial = (updated as { initialPassword?: string | null }).initialPassword;
        if (typeof initial === "string" && initial.trim()) {
          setGeneratedPasswords((prev) => ({ ...prev, [teacher.id]: initial.trim() }));
          setRevealedPasswords((prev) => ({ ...prev, [teacher.id]: true }));
          toast.success("Compte créé. Le mot de passe s'affiche sur la carte.");
          return;
        }
        const result = await resetTeacherPasswordMutation.mutateAsync(teacher.id);
        setGeneratedPasswords((prev) => ({ ...prev, [teacher.id]: result.initialPassword }));
        setRevealedPasswords((prev) => ({ ...prev, [teacher.id]: true }));
      } catch (error: any) {
        toast.error(error?.message || "Impossible de créer le compte ou le mot de passe");
      } finally {
        setResettingPasswordFor(null);
      }
      return;
    }

    try {
      setResettingPasswordFor(teacher.id);
      const result = await resetTeacherPasswordMutation.mutateAsync(teacher.id);
      setGeneratedPasswords((prev) => ({ ...prev, [teacher.id]: result.initialPassword }));
      setRevealedPasswords((prev) => ({ ...prev, [teacher.id]: true }));
    } catch (error: any) {
      toast.error(error?.message || "Impossible de générer le mot de passe");
    } finally {
      setResettingPasswordFor(null);
    }
  };

  const handleDelete = async (teacher: Teacher) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer l'enseignant "${teacher.firstName} ${teacher.lastName}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteTeacherMutation.mutateAsync(teacher.id);
      } catch (error: any) {
        console.error("Error deleting teacher:", error);
        alert(error?.message || "Erreur lors de la suppression de l'enseignant");
      }
    }
  };

  const handleExportToExcel = async () => {
    setIsExporting(true);
    try {
      const exportData: TeacherExportData = {
        teachers: filteredTeachers,
        exportDate: new Date().toLocaleDateString('fr-FR'),
        totalCount: filteredTeachers.length
      };
      exportTeachersToExcel(exportData);
    } catch (error) {
      console.error("Failed to export to Excel:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportToWord = async () => {
    setIsExporting(true);
    try {
      const exportData: TeacherExportData = {
        teachers: filteredTeachers,
        exportDate: new Date().toLocaleDateString('fr-FR'),
        totalCount: filteredTeachers.length
      };
      exportTeachersToWord(exportData);
    } catch (error) {
      console.error("Failed to export to Word:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusLabel = (status: TeacherStatus) => {
    switch (status) {
      case 'active': return 'Actif';
      case 'inactive': return 'Inactif';
      case 'suspended': return 'Suspendu';
      default: return status;
    }
  };

  const getContractLabel = (contract: ContractType) => {
    switch (contract) {
      case 'permanent': return 'CDI';
      case 'temporary': return 'CDD';
      case 'freelance': return 'Vacataire';
      default: return contract;
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Enseignants et vacataires</h2>
            <p className="text-muted-foreground">
              Gérez votre équipe pédagogique et les intervenants
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
                  Impossible de charger les enseignants. Vérifiez votre connexion.
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
            Enseignants et vacataires
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez votre équipe pédagogique et les intervenants
          </p>
        </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleExportToExcel}
            disabled={isExporting || filteredTeachers.length === 0}
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
            disabled={isExporting || filteredTeachers.length === 0}
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
            onClick={() => router.push("/academic/teachers/new")}
            className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvel enseignant
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-orange-500 to-red-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
                <div>
                <p className="text-white/80 text-sm font-medium">
                  Total enseignants
                </p>
                <p className="text-3xl font-bold mt-1">{teachers.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
      </div>

          <div className="bg-gradient-to-br from-amber-500 to-yellow-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Actifs
                </p>
                <p className="text-3xl font-bold mt-1">
                  {teachers.filter(t => t.status === 'active').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <UserCheck className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-red-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Permanents (CDI)
                </p>
                <p className="text-3xl font-bold mt-1">
                  {teachers.filter(t => t.contractType === 'permanent').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-400 to-amber-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Vacataires
                </p>
                <p className="text-3xl font-bold mt-1">
                  {teachers.filter(t => t.contractType === 'freelance').length}
                </p>
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
                placeholder="Rechercher par nom, email, spécialité ou qualification..."
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

            {/* Status Filter */}
            <div className="lg:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-orange-500 focus:ring-orange-500">
                  <Filter className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="active">Actifs</SelectItem>
                  <SelectItem value="inactive">Inactifs</SelectItem>
                  <SelectItem value="suspended">Suspendus</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Contract Filter */}
            <div className="lg:w-48">
              <Select value={contractFilter} onValueChange={setContractFilter}>
                <SelectTrigger className="h-11 border-gray-200 focus:border-orange-500 focus:ring-orange-500">
                  <Users className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Filtrer par contrat" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les contrats</SelectItem>
                  <SelectItem value="permanent">CDI</SelectItem>
                  <SelectItem value="temporary">CDD</SelectItem>
                  <SelectItem value="freelance">Vacataire</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Specialty Filter */}
            {allSpecialties.length > 0 && (
              <div className="lg:w-48">
                <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
                  <SelectTrigger className="h-11 border-gray-200 focus:border-orange-500 focus:ring-orange-500">
                    <Filter className="h-4 w-4 mr-2 text-gray-400" />
                    <SelectValue placeholder="Filtrer par spécialité" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les spécialités</SelectItem>
                    {allSpecialties.map((specialty) => (
                      <SelectItem key={specialty} value={specialty}>
                        {specialty}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredTeachers.length}</span>
              <span className="ml-1">
                {filteredTeachers.length === 1 ? 'enseignant trouvé' : 'enseignants trouvés'}
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
              <p className="text-gray-600 text-lg">Chargement des enseignants...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Teachers List */}
      {!isLoading && filteredTeachers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTeachers.map((teacher: Teacher) => {
            const teacherPassword = getTeacherPassword(teacher);
            return (
            <div
              key={teacher.id}
              className="bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">{teacher.firstName} {teacher.lastName}</h3>
                  <div className="flex gap-2">
                    <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-medium">
                      {getStatusLabel(teacher.status)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  {teacher.employeeNumber && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">N°:</span> {teacher.employeeNumber}
                    </p>
                  )}
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Contrat:</span> {getContractLabel(teacher.contractType)}
                  </p>
                  {teacher.email && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Mail className="w-4 h-4 mr-1" />
                      {teacher.email}
                    </p>
                  )}
                  <div className="text-white/90 text-sm">
                    <span className="font-medium">Mot de passe:</span>{" "}
                    {teacher.userId
                      ? teacherPassword
                        ? (revealedPasswords[teacher.id] ? teacherPassword : "********")
                        : "Non affiché"
                      : "Sans compte"}
                  </div>
                  {teacher.phone && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Phone className="w-4 h-4 mr-1" />
                      {teacher.phone}
                    </p>
                  )}
                  {teacher.hireDate && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      Embauché le {new Date(teacher.hireDate).toLocaleDateString('fr-FR')}
                    </p>
              )}
                  {teacher.specialties && teacher.specialties.length > 0 && (
                    <p className="text-white/90 text-sm flex items-center">
                      <Award className="w-4 h-4 mr-1" />
                      {teacher.specialties.slice(0, 2).join(', ')}
                      {teacher.specialties.length > 2 && ` +${teacher.specialties.length - 2}`}
                    </p>
                  )}
                </div>

                {teacher.bio && (
                  <p className="text-white/80 text-sm mb-4 line-clamp-2">
                    {teacher.bio}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleView(teacher);
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
                      handleEdit(teacher);
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
                      void handlePasswordAction(teacher);
                    }}
                    title={
                      teacherPassword
                        ? (revealedPasswords[teacher.id] ? "Masquer le mot de passe" : "Voir le mot de passe")
                        : (isAdmin ? "Générer puis afficher le mot de passe" : "Mot de passe non disponible")
                    }
                    disabled={
                      resettingPasswordFor === teacher.id ||
                      (!teacherPassword && !isAdmin)
                    }
                  >
                    {resettingPasswordFor === teacher.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Génération...
                      </>
                    ) : revealedPasswords[teacher.id] ? (
                      <>
                        <EyeOff className="w-4 h-4 mr-1" />
                        Masquer MDP
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 mr-1" />
                        {teacherPassword ? "Voir MDP" : (isAdmin ? "Générer MDP" : "Voir MDP")}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-red-500/20 hover:bg-red-500/40 text-white border-red-300/20 hover:border-red-300/40 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(teacher);
                    }}
                    disabled={deleteTeacherMutation.isPending}
                    title="Supprimer"
                  >
                    {deleteTeacherMutation.isPending ? (
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

      {/* Empty State - No teachers at all */}
      {!isLoading && teachers.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-orange-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun enseignant trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre premier enseignant
                </p>
              </div>
              <Button
                onClick={() => router.push("/academic/teachers/new")}
                className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un enseignant
              </Button>
            </div>
        </CardContent>
      </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && teachers.length > 0 && filteredTeachers.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucun enseignant ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setContractFilter("all");
                    setSpecialtyFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={() => router.push("/academic/teachers/new")}
                  className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvel enseignant
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Assure next-auth/react pour cette route (useTeachers + useSession partagent le même contexte). */
export default function TeachersPage() {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <TeachersPageContent />
    </SessionProvider>
  );
}
