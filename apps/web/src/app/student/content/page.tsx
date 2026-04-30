"use client";

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
} from "@ecoledigitale/ui";
import { 
  FolderOpen,
  FileText,
  Download,
  Play,
  Search,
  BookOpen,
  Calendar,
  Loader2,
  AlertCircle,
  Filter
} from "lucide-react";
import { useStudentCourses } from "@/lib/hooks/use-student-data";
import { useQueries } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// Function to download material file
const downloadMaterial = async (materialId: string, materialTitle: string) => {
  try {
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
      const fileResponse = await fetch(data.downloadUrl, {
        method: 'GET',
      });

      if (!fileResponse.ok) {
        throw new Error(`Failed to download file: ${fileResponse.status} ${fileResponse.statusText}`);
      }

      const blob = await fileResponse.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = data.fileName || materialTitle || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    console.error('Download failed:', error);
    alert('Erreur lors du téléchargement du fichier. Veuillez réessayer.');
  }
};

export default function StudentContentPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { data: coursesData, isLoading: isLoadingCourses } = useStudentCourses({ status: 'active' });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');

  // Redirect if not authenticated or not student
  React.useEffect(() => {
    if (status === 'loading') {
      return;
    }

    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Étudiant'].includes(r));

    if (!isStudent) {
      router.push('/');
    }
  }, [session, status, router]);

  const courses = coursesData?.data || [];

  // Fetch materials for all courses using useQueries
  const materialsQueries = useQueries({
    queries: courses.map((course: any) => ({
      queryKey: ['course-materials', course.id],
      queryFn: async () => {
        const headers = createApiHeaders(session);
        
        const response = await fetch(`/api/v1/student/courses/${course.id}/materials`, {
          headers,
        });

        if (!response.ok) {
          throw new Error('Erreur lors de la récupération des supports');
        }

        const data = await response.json();
        return {
          courseId: course.id,
          courseName: course.name,
          courseCode: course.code,
          materials: data.data || [],
        };
      },
      enabled: !!course.id && !!session,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Combine all materials from all courses
  const allMaterials: any[] = [];
  materialsQueries.forEach((query) => {
    if (query.data?.materials) {
      query.data.materials.forEach((material: any) => {
        allMaterials.push({
          ...material,
          courseId: query.data?.courseId,
          courseName: query.data?.courseName,
          courseCode: query.data?.courseCode,
        });
      });
    }
  });

  const isLoadingMaterials = materialsQueries.some(query => query.isLoading);

  // Show loading state
  if (status === 'loading' || isLoadingCourses || isLoadingMaterials) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Filter materials
  let filteredMaterials = allMaterials;
  
  if (selectedCourse !== 'all') {
    filteredMaterials = filteredMaterials.filter(m => m.courseId === selectedCourse);
  }
  
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredMaterials = filteredMaterials.filter(m => 
      m.title?.toLowerCase().includes(query) ||
      m.fileName?.toLowerCase().includes(query) ||
      m.courseName?.toLowerCase().includes(query)
    );
  }

  // Sort by date (most recent first)
  filteredMaterials.sort((a, b) => {
    const dateA = new Date(a.createdAt || a.uploadedAt || 0).getTime();
    const dateB = new Date(b.createdAt || b.uploadedAt || 0).getTime();
    return dateB - dateA;
  });

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Date inconnue';
    try {
      return format(new Date(dateString), "d MMMM yyyy", { locale: fr });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-emerald-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Contenu Récent
              </h1>
              <p className="text-gray-600 mt-2">
                Accédez à tous les supports de cours de vos matières
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Rechercher un support de cours..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="md:w-64">
                <select
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="all">Tous les cours</option>
                  {courses.map((course: any) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Materials List */}
        {filteredMaterials.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMaterials.map((material: any) => (
              <Card key={material.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-2 line-clamp-2">
                        {material.title || material.fileName}
                      </CardTitle>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <BookOpen className="h-4 w-4" />
                        <span>{material.courseName || material.course_name}</span>
                        {material.courseCode && (
                          <Badge variant="outline" className="ml-2">
                            {material.courseCode}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <FileText className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {formatDate(material.createdAt || material.uploadedAt)}
                    </div>
                    {material.fileSize && (
                      <span>{formatFileSize(material.fileSize)}</span>
                    )}
                  </div>

                  {material.fileType && (
                    <Badge variant="secondary">
                      {material.fileType}
                    </Badge>
                  )}

                  <div className="flex gap-2">
                    {material.fileType?.includes('video') ? (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          window.open(`/api/materials/${material.id}/content`, '_blank');
                        }}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Regarder
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => downloadMaterial(material.id, material.title || material.fileName)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Télécharger
                      </Button>
                    )}
                    <Link href={`/student/courses/${material.courseId}`}>
                      <Button size="sm" variant="outline">
                        Voir le cours
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderOpen className="h-16 w-16 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {searchQuery || selectedCourse !== 'all' 
                  ? 'Aucun résultat trouvé' 
                  : 'Aucun contenu disponible'}
              </h3>
              <p className="text-gray-600 text-center max-w-md">
                {searchQuery || selectedCourse !== 'all'
                  ? 'Essayez de modifier vos critères de recherche ou de filtre.'
                  : 'Aucun support de cours n\'a été publié pour vos matières pour le moment.'}
              </p>
              {searchQuery && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCourse('all');
                  }}
                >
                  Réinitialiser les filtres
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

