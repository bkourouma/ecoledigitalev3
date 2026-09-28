"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Calendar,
  GraduationCap,
  BookOpen,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useCycle, useUpdateCycle } from "@/lib/hooks/use-cycles";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { AcademicModal } from "@/components/academic/AcademicModal";
import { AntdCycleForm } from "@/components/academic/AntdCycleForm";

export default function CycleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const updateCycleMutation = useUpdateCycle();
  const cycleId = params.id as string;

  const { data: cycle, isLoading, error } = useCycle(cycleId);
  const { data: programmesData } = useProgrammes();
  const programmes = programmesData?.data || [];

  const handleEditSubmit = async (data: any) => {
    try {
      await updateCycleMutation.mutateAsync({ id: cycleId, data });
      setShowEditModal(false);
    } catch (e) {
      // Error handling is done by the mutation
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">Cycle non trouvé</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">Le cycle demandé n'existe pas ou a été supprimé.</p>
          <Button onClick={() => router.push('/academic/cycles')} className="w-full sm:w-auto">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux cycles
          </Button>
        </div>
      </div>
    );
  }

  const cycleProgrammes = programmes.filter(p => p.cycleId === cycle.id);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          onClick={() => router.push('/academic/cycles')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Button>
        <div className="flex-1 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">{cycle.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full font-medium whitespace-nowrap ${
                cycle.status === 'active' 
                  ? 'bg-green-100 text-green-800' 
                  : cycle.status === 'draft'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {cycle.status === 'active' ? 'Actif' :
                 cycle.status === 'draft' ? 'Brouillon' :
                 cycle.status === 'archived' ? 'Archivé' : cycle.status}
              </span>
              <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full bg-gray-100 text-gray-800 whitespace-nowrap">
                {cycle.type === 'academic' ? 'Académique' :
                 cycle.type === 'professional' ? 'Professionnel' :
                 cycle.type === 'short' ? 'Formation courte' :
                 cycle.type === 'certification' ? 'Certification' : cycle.type}
              </span>
            </div>
          </div>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Code: {cycle.code}
          </p>
        </div>
        <Button 
          className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 w-full sm:w-auto" 
          onClick={() => setShowEditModal(true)}
        >
          <Edit className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Modifier</span>
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Durée</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{cycle.durationMonths}</p>
              <p className="text-white/80 text-xs">mois</p>
            </div>
            <Calendar className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
        {cycle.certificationLevel && (
          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-3 sm:p-4 rounded-xl text-white shadow">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-white/80 text-xs">Niveau</p>
                <p className="text-base sm:text-lg font-semibold mt-1 truncate">{cycle.certificationLevel}</p>
              </div>
              <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
            </div>
          </div>
        )}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Programmes</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{cycleProgrammes.length}</p>
            </div>
            <BookOpen className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Cycle Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <GraduationCap className="w-5 h-5" />
                Informations du cycle
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cycle.description && (
                <div>
                  <h3 className="font-medium mb-2 text-sm sm:text-base">Description</h3>
                  <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">{cycle.description}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm sm:text-base">{cycle.durationMonths} mois</span>
                </div>
                {cycle.certificationLevel && (
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base break-words">{cycle.certificationLevel}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sm:space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full justify-start bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-sm sm:text-base"
                onClick={() => setShowEditModal(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                Modifier
              </Button>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Statistiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Programmes</span>
                <span className="text-sm sm:text-base font-medium">{cycleProgrammes.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Durée</span>
                <span className="text-sm sm:text-base font-medium">{cycle.durationMonths} mois</span>
              </div>
              {cycle.certificationLevel && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Niveau</span>
                  <span className="text-sm sm:text-base font-medium break-words text-right">{cycle.certificationLevel}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Modal */}
      <AcademicModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier le cycle"
        description="Modifiez les informations du cycle"
        onSubmit={() => {}}
        isSubmitting={updateCycleMutation.isPending}
        showFooter={false}
        size="xl"
      >
        <AntdCycleForm
          cycle={cycle}
          onSubmit={handleEditSubmit}
          onCancel={() => setShowEditModal(false)}
          isLoading={updateCycleMutation.isPending}
        />
      </AcademicModal>
    </div>
  );
}

