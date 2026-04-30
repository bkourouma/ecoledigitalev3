"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Building,
  MapPin,
  Users,
  Settings,
  Calendar,
  Clock,
  Loader2,
  AlertCircle
} from "lucide-react";
import { useClassroom } from "@/lib/hooks/use-classrooms";
import { useUpdateClassroom } from "@/lib/hooks/use-classrooms";
import { AcademicModal } from "@/components/academic/AcademicModal";
import { ClassroomForm } from "@/components/academic/ClassroomForm";
import { UpdateClassroom } from "@ecoledigitale/contracts";

export default function ClassroomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const updateClassroomMutation = useUpdateClassroom();
  const classroomId = params.id as string;

  const { data: classroomData, isLoading, error } = useClassroom(classroomId, true);
  const classroom = classroomData?.data;

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      amphitheatre: "Amphithéâtre",
      salle_cours: "Salle de cours",
      laboratoire: "Laboratoire",
      salle_informatique: "Salle informatique",
      atelier: "Atelier",
      bibliotheque: "Bibliothèque",
      salle_reunion: "Salle de réunion",
      autre: "Autre"
    };
    return labels[type] || type;
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      disponible: "Disponible",
      occupe: "Occupée",
      maintenance: "En maintenance",
      hors_service: "Hors service"
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'disponible':
        return 'bg-green-100 text-green-800';
      case 'occupe':
        return 'bg-orange-100 text-orange-800';
      case 'maintenance':
        return 'bg-yellow-100 text-yellow-800';
      case 'hors_service':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleEditSubmit = async (data: UpdateClassroom) => {
    if (!classroom) return;

    try {
      await updateClassroomMutation.mutateAsync({
        id: classroom.id,
        data,
      });
      setShowEditModal(false);
    } catch (error) {
      console.error("Error updating classroom:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement de la salle...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !classroom) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Erreur de chargement</h3>
                <p className="text-muted-foreground">
                  Impossible de charger la salle de classe. Vérifiez votre connexion.
                </p>
              </div>
              <Button onClick={() => router.push('/academic/classrooms')}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 sm:mb-8">
        <Button
          variant="outline"
          onClick={() => router.push('/academic/classrooms')}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Retour</span>
        </Button>
        <div className="flex-1 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold break-words">{classroom.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full font-medium whitespace-nowrap ${getStatusColor(classroom.status)}`}>
                {getStatusLabel(classroom.status)}
              </span>
              <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full bg-indigo-100 text-indigo-800 whitespace-nowrap">
                {getTypeLabel(classroom.type)}
              </span>
            </div>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground break-words">
            Code: {classroom.code}
            {classroom.building && (
              <>
                {' '}• Bâtiment: <span className="font-medium">{classroom.building}</span>
                {classroom.floor && <span> - Étage {classroom.floor}</span>}
              </>
            )}
          </p>
        </div>
        <Button 
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 w-full sm:w-auto" 
          onClick={() => setShowEditModal(true)}
        >
          <Edit className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Modifier</span>
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <Card className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-white/20 p-2 sm:p-3 rounded-lg flex-shrink-0">
                <Users className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-white/80 font-medium truncate">Capacité</p>
                <p className="text-xl sm:text-2xl font-bold truncate">{classroom.capacity}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-pink-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-white/20 p-2 sm:p-3 rounded-lg flex-shrink-0">
                <Building className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-white/80 font-medium truncate">Bâtiment</p>
                <p className="text-xl sm:text-2xl font-bold truncate">{classroom.building || 'N/A'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-white/20 p-2 sm:p-3 rounded-lg flex-shrink-0">
                <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-white/80 font-medium truncate">Équipements</p>
                <p className="text-xl sm:text-2xl font-bold truncate">{classroom.equipment?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-white/20 p-2 sm:p-3 rounded-lg flex-shrink-0">
                <Calendar className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-white/80 font-medium truncate">Statut</p>
                <p className="text-xl sm:text-2xl font-bold truncate">{getStatusLabel(classroom.status)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6 sm:space-y-8">
          {/* Basic Information */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl sm:text-2xl">Informations générales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Nom</p>
                  <p className="text-base sm:text-lg font-semibold break-words">{classroom.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Code</p>
                  <p className="text-base sm:text-lg font-semibold break-words">{classroom.code}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Type</p>
                  <p className="text-base sm:text-lg font-semibold break-words">{getTypeLabel(classroom.type)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Statut</p>
                  <Badge className={getStatusColor(classroom.status)}>
                    {getStatusLabel(classroom.status)}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Capacité</p>
                  <p className="text-base sm:text-lg font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600" />
                    {classroom.capacity} places
                  </p>
                </div>
                {classroom.building && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Bâtiment</p>
                    <p className="text-base sm:text-lg font-semibold flex items-center gap-2">
                      <Building className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600" />
                      {classroom.building}
                      {classroom.floor && ` - Étage ${classroom.floor}`}
                    </p>
                  </div>
                )}
              </div>

              {classroom.description && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Description</p>
                  <p className="text-sm sm:text-base text-foreground break-words">{classroom.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equipment */}
          {classroom.equipment && classroom.equipment.length > 0 && (
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl sm:text-2xl flex items-center gap-2">
                  <Settings className="h-5 w-5 sm:h-6 sm:w-6 text-indigo-600" />
                  Équipements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {classroom.equipment.map((equipment, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-white rounded-lg border border-gray-200 shadow-sm"
                    >
                      <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600 flex-shrink-0" />
                      <p className="text-sm sm:text-base font-medium text-gray-900 break-words">{equipment}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6 sm:space-y-8">
          {/* Quick Actions */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <Button
                variant="outline"
                className="w-full justify-start text-sm sm:text-base"
                onClick={() => setShowEditModal(true)}
              >
                <Edit className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Modifier la salle
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-sm sm:text-base"
                onClick={() => router.push('/academic/classrooms')}
              >
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Retour à la liste
              </Button>
            </CardContent>
          </Card>

          {/* Additional Info */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Informations supplémentaires</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">Localisation</p>
                  <p className="text-sm sm:text-base break-words">
                    {classroom.building || 'Non spécifié'}
                    {classroom.floor && ` - Étage ${classroom.floor}`}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">Créé le</p>
                  <p className="text-sm sm:text-base break-words">
                    {classroom.createdAt ? new Date(classroom.createdAt).toLocaleDateString('fr-FR') : 'N/A'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Modal */}
      <AcademicModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier la salle"
        description="Modifiez les informations de la salle de classe"
        onSubmit={() => {}} // Form handles submission
        isSubmitting={updateClassroomMutation.isPending}
        showFooter={false}
        size="xl"
      >
        <ClassroomForm
          initialData={classroom}
          onSubmit={handleEditSubmit}
          onCancel={() => setShowEditModal(false)}
          isLoading={updateClassroomMutation.isPending}
        />
      </AcademicModal>
    </div>
  );
}

