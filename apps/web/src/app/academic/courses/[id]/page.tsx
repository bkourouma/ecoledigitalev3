"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Calendar,
  MapPin,
  User,
  Clock,
  BookOpen,
  Users,
  FileText,
  Plus,
  Upload,
  Download,
  Trash2,
  Eye
} from "lucide-react";
import { useCourse } from "@/lib/hooks/use-courses";
import { useAssignments } from "@/lib/hooks/use-evaluations";
import { MaterialsUpload } from "@/components/materials/MaterialsUpload";
import { toast } from "@/components/ui/use-toast";
import { MaterialWithMetadata, getFileCategory } from '@ecoledigitale/contracts';
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

import { useUpdateCourse } from "@/lib/hooks/use-courses";
import { AcademicModal } from "@/components/academic/AcademicModal";
import { CourseForm } from "@/components/academic/CourseForm";
// API functions for materials
const fetchMaterials = async (courseId: string): Promise<MaterialWithMetadata[]> => {
  const response = await fetch(`/api/courses/${courseId}/materials`);
  if (!response.ok) {
    throw new Error('Failed to fetch materials');
  }
  const data = await response.json();
  return data.materials || [];
};

const deleteMaterial = async (materialId: string): Promise<void> => {
  const response = await fetch(`/api/materials/${materialId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete material');
  }
};

const downloadMaterial = async (materialId: string): Promise<void> => {
  try {
    // Use the download route that serves the file directly with authentication
  const response = await fetch(`/api/materials/${materialId}/download`);
  if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to download material' }));
      throw new Error(errorData.error || 'Failed to download material');
    }
    
    // Get the file blob
    const blob = await response.blob();
    
    // Get filename from Content-Disposition header with proper UTF-8 handling
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'download';
    
    if (contentDisposition) {
      // Try to extract filename from RFC 5987 format (filename*=UTF-8''encoded)
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+)/i);
      if (utf8Match) {
        filename = decodeURIComponent(utf8Match[1]);
      } else {
        // Fallback to standard filename="..." format
        const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1].trim();
        }
      }
    }
    
    // Ensure filename has proper extension based on content type
    const contentType = response.headers.get('Content-Type');
    if (contentType && !filename.includes('.')) {
      const extension = contentType.split('/')[1]?.split(';')[0];
      if (extension) {
        filename = `${filename}.${extension}`;
      }
    }
    
    // Create download link and trigger download
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error: any) {
    throw new Error(error?.message || 'Failed to download material');
  }
};

export default function CourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const updateCourseMutation = useUpdateCourse();
  const courseId = params.id as string;
  const queryClient = useQueryClient();

  const [showUpload, setShowUpload] = useState(false);

  const { data: course, isLoading, error } = useCourse(courseId);

  // Fetch materials
  const {
    data: materials = [],
    isLoading: materialsLoading,
    refetch: refetchMaterials
  } = useQuery({
    queryKey: ['materials', courseId],
    queryFn: () => fetchMaterials(courseId),
    enabled: !!courseId,
  });

  // Fetch assignments for this course
  const { data: assignmentsData, isLoading: assignmentsLoading } = useAssignments({
    course_id: courseId,
    limit: 10,
  });

  // Debug logging
  console.log("🔍 Course ID:", courseId);
  console.log("🔍 Assignments loading:", assignmentsLoading);
  console.log("🔍 Assignments data:", assignmentsData);
  console.log("🔍 Assignments count:", assignmentsData?.assignments?.length);

  // Delete material mutation
  const deleteMutation = useMutation({
    mutationFn: deleteMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials', courseId] });
      toast({
        title: "Success",
        description: "Material deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete material",
        variant: "destructive",
      });
    },
  });

  // Handler functions
  const handleDownload = async (material: MaterialWithMetadata) => {
    try {
      await downloadMaterial(material.id);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to download material",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (material: MaterialWithMetadata) => {
    if (confirm(`Are you sure you want to delete "${material.title}"?`)) {
      deleteMutation.mutate(material.id);
    }
  };

  const handleUploadComplete = (uploadedMaterials: any[]) => {
    queryClient.invalidateQueries({ queryKey: ['materials', courseId] });
    setShowUpload(false);
    toast({
      title: "Success",
      description: `${uploadedMaterials.length} material(s) uploaded successfully`,
    });
  };

  const handleEditSubmit = async (data: any) => {
    try {
      await updateCourseMutation.mutateAsync({ id: courseId, data });
      setShowEditModal(false);
    } catch (e) {
      toast({ title: "Erreur", description: "Échec de la mise à jour du cours", variant: "destructive" });
    }
  };
  const handleUploadError = (error: string) => {
    toast({
      title: "Upload Error",
      description: error,
      variant: "destructive",
    });
  };

  const getFileIcon = (fileType: string) => {
    const category = getFileCategory(fileType);
    switch (category) {
      case 'document':
        return <FileText className="h-8 w-8 text-red-500" />;
      case 'image':
        return <Eye className="h-8 w-8 text-green-500" />;
      case 'video':
        return <Eye className="h-8 w-8 text-blue-500" />;
      default:
        return <FileText className="h-8 w-8 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDayName = (day?: number) => {
    const days = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    return day ? days[day] : "";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'draft': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Actif';
      case 'draft': return 'Brouillon';
      case 'completed': return 'Terminé';
      default: return status;
    }
  };

  const getDeliveryModeLabel = (mode?: string) => {
    switch (mode) {
      case 'presential': return 'Présentiel';
      case 'remote': return 'À distance';
      case 'hybrid': return 'Hybride';
      case 'elearning': return 'E-learning';
      default: return mode || '-';
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

  if (error || !course) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">Cours non trouvé</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">Le cours demandé n'existe pas ou a été supprimé.</p>
          <Button onClick={() => router.push('/academic/courses')} className="w-full sm:w-auto">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux cours
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          onClick={() => router.push('/academic/courses')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Button>
        <div className="flex-1 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">{course.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full font-medium whitespace-nowrap ${getStatusColor(course.status)}`}>
              {getStatusLabel(course.status)}
            </span>
              <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full bg-gray-100 text-gray-800 whitespace-nowrap">
              {getDeliveryModeLabel(course.deliveryMode)}
            </span>
            </div>
          </div>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Code: {course.code}
            {course.programme?.name && (
              <>
                {' '}• Programme: <span className="font-medium">{course.programme.code} - {course.programme.name}</span>
              </>
            )}
          </p>
        </div>
        <Button 
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 w-full sm:w-auto" 
          onClick={() => setShowEditModal(true)}
        >
          <Edit className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Modifier</span>
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Volume total</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{course.hoursTotal}h</p>
            </div>
            <Clock className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Théorie</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{course.hoursTheory}h</p>
            </div>
            <Clock className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Pratique</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{course.hoursPractical}h</p>
            </div>
            <Clock className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Mode</p>
              <p className="text-base sm:text-lg font-semibold mt-1 truncate">{getDeliveryModeLabel(course.deliveryMode)}</p>
            </div>
            <BookOpen className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Course Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <BookOpen className="w-5 h-5" />
                Informations du cours
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {course.description && (
                <div>
                  <h3 className="font-medium mb-2 text-sm sm:text-base">Description</h3>
                  <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">{course.description}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {course.bilanType?.name && (
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base">Type de bilan: {course.bilanType.name}</span>
                  </div>
                )}

                {course.scheduleDay && course.scheduleTime && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base">
                      {getDayName(course.scheduleDay)} à {course.scheduleTime}
                    </span>
                  </div>
                )}

                {course.classroom && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base">Salle {course.classroom}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Course Materials */}
          <Card>
            <CardHeader>
              <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl whitespace-nowrap text-2xl leading-tight md:text-3xl">
                  <FileText className="w-5 h-5" />
                  Supports de cours ({materials.length})
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => setShowUpload(!showUpload)}
                  variant={showUpload ? "outline" : "default"}
                  className="w-full sm:w-auto"
                >
                  <Upload className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">{showUpload ? "Annuler" : "Ajouter"}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Upload Section */}
              {showUpload && (
                <div className="border rounded-lg p-4 bg-gray-50">
                  <MaterialsUpload
                    courseId={courseId}
                    onUploadComplete={handleUploadComplete}
                    onUploadError={handleUploadError}
                    maxFiles={10}
                  />
                </div>
              )}

              {/* Materials List */}
              {materialsLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>Chargement des supports...</p>
                </div>
              ) : materials.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Aucun support de cours</p>
                  <p className="text-sm">Commencez par ajouter des documents, vidéos ou liens</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {materials.map((material) => (
                    <Card key={material.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {getFileIcon(material.fileType)}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm truncate" title={material.title}>
                              {material.title}
                            </h4>
                            <p className="text-xs text-gray-500 truncate" title={material.fileName}>
                              {material.fileName}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatFileSize(material.fileSize)}
                            </p>
                            <div className="flex items-center gap-2 mt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownload(material)}
                                className="flex-1 sm:flex-none text-xs sm:text-sm p-2 sm:p-2"
                                title="Télécharger"
                              >
                                <Download className="w-3 h-3 sm:mr-0" />
                                <span className="sm:hidden">Télécharger</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDelete(material)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 p-2 flex-shrink-0"
                                title="Supprimer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assignments */}
          <Card>
            <CardHeader>
              <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl whitespace-nowrap text-2xl leading-tight md:text-3xl">
                  <BookOpen className="w-5 h-5" />
                  Devoirs et évaluations
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => {
                    router.push(`/academic/evaluations/create?courseId=${course.id}`);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Nouveau devoir</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {assignmentsLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Chargement des devoirs...</p>
                </div>
              ) : assignmentsData?.assignments?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Aucun devoir créé</p>
                  <p className="text-sm">Créez des devoirs et évaluations pour vos étudiants</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {assignmentsData?.assignments?.map((assignment: any) => (
                    <div key={assignment.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0 w-full sm:w-auto">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="font-medium text-sm sm:text-base break-words">{assignment.title}</h4>
                          <span className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${
                            assignment.type === 'evaluation'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          }`}>
                            {assignment.type === 'evaluation' ? 'Évaluation' : 'Devoir'}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${
                            assignment.status === 'published'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : assignment.status === 'draft'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                          }`}>
                            {assignment.status === 'published' ? 'Publié' :
                             assignment.status === 'draft' ? 'Brouillon' : 'Archivé'}
                          </span>
                        </div>
                        {assignment.description && (
                          <p className="text-xs sm:text-sm text-muted-foreground mb-1 break-words">{assignment.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs text-muted-foreground">
                          {assignment.duration_minutes && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {assignment.duration_minutes} min
                            </span>
                          )}
                          {assignment.ends_at && (
                            <span className="break-words">
                              Échéance: {formatDistanceToNow(new Date(assignment.ends_at), { addSuffix: true, locale: fr })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end sm:justify-start">
                        <Link href={`/academic/evaluations/${assignment.id}`} className="w-full sm:w-auto">
                          <Button size="sm" variant="outline" className="w-full sm:w-auto">
                            <Eye className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">Voir</span>
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
      {/* Edit Modal */}
      <AcademicModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier le cours"
        description="Modifiez les informations du cours"
        onSubmit={() => {}}
        isSubmitting={updateCourseMutation.isPending}
        showFooter={false}
        size="xl"
      >
        <CourseForm
          course={course as any}
          onSubmit={handleEditSubmit}
          onCancel={() => setShowEditModal(false)}
          isLoading={updateCourseMutation.isPending}
        />
      </AcademicModal>
              <Button className="w-full justify-start text-sm sm:text-base" variant="outline">
                <Users className="w-4 h-4 mr-2" />
                Gérer les étudiants
              </Button>
              <Button className="w-full justify-start text-sm sm:text-base" variant="outline">
                <Calendar className="w-4 h-4 mr-2" />
                Voir le planning
              </Button>
              <Button className="w-full justify-start text-sm sm:text-base" variant="outline">
                <FileText className="w-4 h-4 mr-2" />
                Exporter les données
              </Button>
            </CardContent>
          </Card>

          {/* Students */}
          <Card>
            <CardHeader>
              <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg whitespace-nowrap text-2xl leading-tight md:text-3xl">
                  <Users className="w-5 h-5" />
                  Étudiants inscrits
                </CardTitle>
                <Button size="sm" variant="outline" className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Inscrire</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center py-6 text-muted-foreground">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Aucun étudiant inscrit</p>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Statistiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Étudiants inscrits</span>
                <span className="text-sm sm:text-base font-medium">0</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Supports de cours</span>
                <span className="text-sm sm:text-base font-medium">{materials.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Devoirs</span>
                <span className="text-sm sm:text-base font-medium">{assignmentsData?.assignments?.length || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Taux de présence</span>
                <span className="text-sm sm:text-base font-medium">-</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
