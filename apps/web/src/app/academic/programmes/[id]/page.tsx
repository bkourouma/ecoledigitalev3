"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  GraduationCap,
  BookOpen,
} from "lucide-react";
import { useProgramme, useUpdateProgramme } from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";
import { useCourses } from "@/lib/hooks/use-courses";
import { AcademicModal } from "@/components/academic/AcademicModal";
import { ProgrammeForm } from "@/components/academic/ProgrammeForm";

export default function ProgrammeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const updateProgrammeMutation = useUpdateProgramme();
  const programmeId = params.id as string;

  const { data: programme, isLoading, error } = useProgramme(programmeId);
  const { data: cyclesData } = useCycles();
  const { data: coursesData } = useCourses();
  const cycles = cyclesData?.data || [];
  const courses = coursesData?.data || [];

  const handleEditSubmit = async (data: any) => {
    await updateProgrammeMutation.mutateAsync({ id: programmeId, data });
    setShowEditModal(false);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !programme) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">Programme non trouve</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Le programme demande n&apos;existe pas ou a ete supprime.
          </p>
          <Button onClick={() => router.push("/academic/programmes")} className="w-full sm:w-auto">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux programmes
          </Button>
        </div>
      </div>
    );
  }

  const programmeCycle = cycles.find((cycle) => cycle.id === programme.cycleId);
  const programmeCourses = courses.filter((course) => course.programmeId === programme.id);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 sm:mb-8">
        <Button
          variant="outline"
          onClick={() => router.push("/academic/programmes")}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Retour</span>
        </Button>

        <div className="flex-1 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold break-words">{programme.name}</h1>
            <span
              className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full font-medium whitespace-nowrap ${
                programme.status === "active"
                  ? "bg-green-100 text-green-800"
                  : programme.status === "draft"
                    ? "bg-yellow-100 text-yellow-800"
                    : programme.status === "review"
                      ? "bg-blue-100 text-blue-800"
                      : programme.status === "approved"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-gray-100 text-gray-800"
              }`}
            >
              {programme.status === "active"
                ? "Actif"
                : programme.status === "draft"
                  ? "Brouillon"
                  : programme.status === "review"
                    ? "En revision"
                    : programme.status === "approved"
                      ? "Approuve"
                      : programme.status === "archived"
                        ? "Archive"
                        : programme.status}
            </span>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground break-words">
            Code: {programme.code}
            {programmeCycle ? ` | Cycle: ${programmeCycle.code} - ${programmeCycle.name}` : ""}
          </p>
        </div>

        <Button
          className="bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 w-full sm:w-auto"
          onClick={() => setShowEditModal(true)}
        >
          <Edit className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Modifier</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-gradient-to-br from-pink-500 to-orange-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Cours</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{programmeCourses.length}</p>
            </div>
            <BookOpen className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>

        {programmeCycle && (
          <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-3 sm:p-4 rounded-xl text-white shadow">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-white/80 text-xs">Cycle</p>
                <p className="text-base sm:text-lg font-semibold mt-1 truncate">{programmeCycle.code}</p>
              </div>
              <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <BookOpen className="w-5 h-5" />
                Informations du programme
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {programme.description && (
                <div>
                  <h3 className="font-medium mb-2 text-sm sm:text-base">Description</h3>
                  <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">
                    {programme.description}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {programmeCycle && (
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base break-words">{programmeCycle.name}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full justify-start bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 text-sm sm:text-base"
                onClick={() => setShowEditModal(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                Modifier
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Statistiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Cours</span>
                <span className="text-sm sm:text-base font-medium">{programmeCourses.length}</span>
              </div>

              {programmeCycle && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Cycle</span>
                  <span className="text-sm sm:text-base font-medium break-words text-right">{programmeCycle.name}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AcademicModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier le programme"
        description="Modifiez les informations du programme"
        onSubmit={() => {}}
        isSubmitting={updateProgrammeMutation.isPending}
        showFooter={false}
        size="xl"
      >
        <ProgrammeForm
          programme={programme}
          onSubmit={handleEditSubmit}
          onCancel={() => setShowEditModal(false)}
          isLoading={updateProgrammeMutation.isPending}
        />
      </AcademicModal>
    </div>
  );
}
