"use client";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Upload,
  Download,
  Trash2,
  Eye,
  Plus,
  Calendar,
  Clock,
  Users,
  MapPin,
  Video,
  Image,
  File,
  MoreVertical,
  Edit,
  Share2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { MaterialsUpload } from "@/components/materials/MaterialsUpload";
import { toast } from "@/components/ui/use-toast";
import { MaterialWithMetadata, getFileCategory } from '@ecoledigitale/contracts';
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { createApiHeaders } from "@/lib/api-utils";

// API functions - Use Next.js proxy route
const fetchCourseDetails = async (courseId: string) => {
  const response = await fetch(`/api/teacher/courses/${courseId}`, {
    headers: createApiHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch course details');
  }
  return response.json();
};

const fetchMaterials = async (courseId: string): Promise<MaterialWithMetadata[]> => {
  const response = await fetch(`/api/courses/${courseId}/materials`);
  if (!response.ok) {
    throw new Error('Failed to fetch materials');
  }
  const data = await response.json();
  return data.materials || [];
};

const deleteMaterial = async (materialId: string) => {
  const response = await fetch(`/api/materials/${materialId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete material');
  }
  return response.json();
};

const downloadMaterial = async (materialId: string) => {
  try {
    // Get the download URL from the Next.js proxy route
    const response = await fetch(`/api/materials/${materialId}/content`, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get download URL');
    }

    const data = await response.json();
    if (data.downloadUrl) {
      // Download the file through the proxy route using fetch (which includes auth headers)
      const fileResponse = await fetch(data.downloadUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!fileResponse.ok) {
        throw new Error(`Failed to download file: ${fileResponse.status} ${fileResponse.statusText}`);
      }

      // Get the file as a blob
      const blob = await fileResponse.blob();
      
      // Create a blob URL and trigger download
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = data.fileName || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      window.URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
};

// Helper functions
const getFileIcon = (fileType: string) => {
  const category = getFileCategory(fileType);
  switch (category) {
    case 'document':
      return <FileText className="h-6 w-6 text-red-500" />;
    case 'image':
      return <Image className="h-6 w-6 text-green-500" />;
    case 'video':
      return <Video className="h-6 w-6 text-blue-500" />;
    default:
      return <File className="h-6 w-6 text-gray-500" />;
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function TeacherCourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.id as string;
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);

  // Fetch course details
  const { data: course, isLoading: courseLoading, error: courseError } = useQuery({
    queryKey: ['teacher-course', courseId],
    queryFn: () => fetchCourseDetails(courseId),
    enabled: !!courseId,
  });

  // Fetch materials using the actual courseId from course details
  const actualCourseId = course?.courseId;
  const {
    data: materials = [],
    isLoading: materialsLoading,
    refetch: refetchMaterials
  } = useQuery({
    queryKey: ['materials', actualCourseId],
    queryFn: () => fetchMaterials(actualCourseId),
    enabled: !!actualCourseId,
  });

  // Delete material mutation
  const deleteMutation = useMutation({
    mutationFn: deleteMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials', actualCourseId] });
      toast({
        title: "Succès",
        description: "Matériau supprimé avec succès",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: "Échec de la suppression du matériau",
        variant: "destructive",
      });
    },
  });

  // Handler functions
  const handleDownload = async (material: MaterialWithMetadata) => {
    try {
      await downloadMaterial(material.id);
      toast({
        title: "Succès",
        description: `Téléchargement de "${material.title}" démarré`,
      });
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Échec du téléchargement du matériau",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (material: MaterialWithMetadata) => {
    if (confirm(`Êtes-vous sûr de vouloir supprimer "${material.title}" ?`)) {
      deleteMutation.mutate(material.id);
    }
  };

  const handleUploadComplete = (uploadedMaterials: any[]) => {
    queryClient.invalidateQueries({ queryKey: ['materials', actualCourseId] });
    setShowUpload(false);
    toast({
      title: "Succès",
      description: `${uploadedMaterials.length} matériau(x) téléchargé(s) avec succès`,
    });
  };

  const handleUploadError = (error: string) => {
    toast({
      title: "Erreur",
      description: error,
      variant: "destructive",
    });
  };

  if (courseLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (courseError || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Cours non trouvé</h1>
          <p className="text-muted-foreground mb-4">Le cours demandé n'existe pas ou vous n'y avez pas accès.</p>
          <Button onClick={() => router.push('/teacher/content')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux contenus
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            onClick={() => router.push('/teacher/courses')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-foreground">{course.courseName}</h1>
              <span className="px-3 py-1 text-sm rounded-full font-medium bg-green-100 text-green-800">
                Actif
              </span>
            </div>
            <p className="text-muted-foreground">{course.courseCode} • {course.className}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Course Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <BookOpen className="w-5 h-5 text-purple-400" />
                  Informations du cours
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Code du cours</label>
                    <p className="text-lg font-semibold text-foreground">{course.courseCode}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Classe</label>
                    <p className="text-lg font-semibold text-foreground">{course.className}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Période</label>
                    <p className="text-sm text-foreground">
                      {new Date(course.datebut).toLocaleDateString('fr-FR')} - {new Date(course.datefin).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Type de contrat</label>
                    <p className="text-sm text-foreground capitalize">{course.contractType}</p>
                  </div>
                </div>

                {course.courseAmount && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Montant du cours</label>
                    <p className="text-lg font-semibold text-green-600">{parseFloat(course.courseAmount).toLocaleString('fr-FR')} FCFA</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Course Materials */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-foreground">
                    <FileText className="w-5 h-5 text-purple-400" />
                    Supports de cours ({materials.length})
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setShowUpload(!showUpload)}
                    variant={showUpload ? "outline" : "default"}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {showUpload ? "Annuler" : "Ajouter"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Upload Section */}
                {showUpload && (
                  <div className="border border-border rounded-lg p-4 bg-secondary/30">
                    <MaterialsUpload
                      courseId={actualCourseId}
                      onUploadComplete={handleUploadComplete}
                      onUploadError={handleUploadError}
                      maxFiles={10}
                    />
                  </div>
                )}

                {/* Materials Grid */}
                {materialsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                  </div>
                ) : materials.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">Aucun support de cours</h3>
                    <p className="text-muted-foreground mb-4">
                      Commencez par ajouter des supports pédagogiques pour ce cours.
                    </p>
                    <Button
                      onClick={() => setShowUpload(true)}
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Ajouter le premier support
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {materials.map((material) => (
                      <Card key={material.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            {getFileIcon(material.fileType)}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-foreground truncate">{material.title}</h3>
                              <p className="text-sm text-muted-foreground truncate">{material.fileName}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                <span>{formatFileSize(material.fileSize)}</span>
                                <span>
                                  {formatDistanceToNow(new Date(material.createdAt), { 
                                    addSuffix: true, 
                                    locale: fr 
                                  })}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownload(material)}
                                className="h-8 w-8 p-0"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(material)}
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Statistiques</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Supports de cours</span>
                  <span className="font-semibold text-foreground">{materials.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Taille totale</span>
                  <span className="font-semibold text-foreground">
                    {formatFileSize(materials.reduce((total, material) => total + material.fileSize, 0))}
                  </span>
                </div>
                {course.hoursValidated && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Heures validées</span>
                    <span className="font-semibold text-green-600">{course.hoursValidated}h</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Actions rapides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => setShowUpload(true)}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Ajouter un support
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Share2 className="w-4 h-4 mr-2" />
                  Partager le cours
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Calendar className="w-4 h-4 mr-2" />
                  Voir le planning
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
