"use client";

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@ecoledigitale/ui";
import { 
  BookOpen, 
  Clock, 
  Users, 
  Calendar,
  Play,
  CheckCircle,
  Star,
  TrendingUp,
  ArrowLeft,
  User,
  Target,
  FileText,
  Video,
  Download
} from "lucide-react";
import { useStudentCourse, useCourseMaterials } from '@/lib/hooks/use-student-data';

// Helper function to format dates
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Function to download material file
const downloadMaterial = async (materialId: string, materialTitle: string) => {
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
      link.download = data.fileName || materialTitle || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      window.URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    console.error('Download failed:', error);
    alert('Erreur lors du téléchargement du fichier. Veuillez réessayer.');
  }
};

export default function StudentCourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const courseId = params.id as string;

  const { data: courseData, isLoading, error } = useStudentCourse(courseId);
  const { data: materialsData, isLoading: materialsLoading } = useCourseMaterials(courseId);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (error || !courseData?.data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Erreur lors du chargement du cours</p>
          <Button onClick={() => router.back()}>Retour</Button>
        </div>
      </div>
    );
  }

  const course = courseData.data;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-emerald-100 text-emerald-800">En cours</Badge>;
      case 'completed':
        return <Badge className="bg-blue-100 text-blue-800">Terminé</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white">{course.name}</h1>
          <p className="text-gray-300">{course.code}</p>
        </div>
        {getStatusBadge(course.status)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Course Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-emerald-600" />
                Aperçu du cours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-300 mb-4">{course.description}</p>
              
              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium">Progression</span>
                  <span>{course.progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${course.progress}%` }}
                  ></div>
                </div>
              </div>

              {/* Course Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <div className="text-center p-3 bg-gray-700 rounded-lg">
                  <Clock className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Heures</p>
                  <p className="font-semibold text-white">{course.completed_hours}/{course.total_hours}h</p>
                </div>
                <div className="text-center p-3 bg-gray-700 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Crédits</p>
                  <p className="font-semibold text-white">{course.credits}</p>
                </div>
                <div className="text-center p-3 bg-gray-700 rounded-lg">
                  <Target className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Statut</p>
                  <p className="font-semibold text-white">{course.status === 'active' ? 'Actif' : 'Terminé'}</p>
                </div>
                <div className="text-center p-3 bg-gray-700 rounded-lg">
                  <Star className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Favori</p>
                  <p className="font-semibold text-white">{course.is_favorite ? 'Oui' : 'Non'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Course Content */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600" />
                Contenu du cours
              </CardTitle>
            </CardHeader>
            <CardContent>
              {materialsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                </div>
              ) : materialsData?.data?.length > 0 ? (
                <div className="space-y-4">
                  {materialsData.data.map((material: any) => (
                    <div key={material.id} className="flex items-center justify-between p-4 border border-gray-600 rounded-lg hover:bg-gray-700">
                      <div className="flex items-center gap-3">
                        {material.file_type?.includes('video') ? (
                          <Video className="h-5 w-5 text-emerald-400" />
                        ) : (
                          <FileText className="h-5 w-5 text-emerald-400" />
                        )}
                        <div>
                          <p className="font-medium text-white">{material.title}</p>
                          <p className="text-sm text-gray-300">
                            {material.file_type?.includes('pdf') ? 'PDF' :
                             material.file_type?.includes('video') ? 'Vidéo' :
                             material.file_type?.split('/')[1]?.toUpperCase() || 'Fichier'}
                            {material.file_size && ` - ${(material.file_size / (1024 * 1024)).toFixed(1)} MB`}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={material.file_type?.includes('video') ? 'default' : 'outline'}
                        onClick={() => {
                          if (material.file_type?.includes('video')) {
                            // Pour les vidéos, ouvrir dans un nouvel onglet
                          window.open(`/api/materials/${material.id}/content`, '_blank');
                          } else {
                            // Pour les autres fichiers, télécharger
                            downloadMaterial(material.id, material.title);
                          }
                        }}
                      >
                        {material.file_type?.includes('video') ? (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Regarder
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Télécharger
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-400">Aucun support de cours disponible pour le moment</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Instructor Info */}
          {course.instructor && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-emerald-600" />
                  Enseignant
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <User className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-white">{course.instructor.first_name} {course.instructor.last_name}</h3>
                  <p className="text-sm text-gray-300">{course.instructor.email}</p>
                  <Button size="sm" className="mt-3" variant="outline">
                    Contacter
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Next Session */}
          {course.next_session && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-emerald-600" />
                  Prochain cours
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-center">
                  <span className="block font-semibold text-white">{formatDate(course.next_session)}</span>
                  <span className="text-sm text-gray-300">Salle à confirmer</span>
                </p>
                <Button size="sm" className="w-full mt-3">
                  Ajouter au calendrier
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" onClick={() => router.push('/student/assignments')}>
                Voir les devoirs
              </Button>
              <Button className="w-full" variant="outline" onClick={() => router.push('/student/grades')}>
                Consulter les notes
              </Button>
              <Button className="w-full" variant="outline">
                Forum de discussion
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
