'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FileText, Download, BookOpen, Calendar, User, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface CourseMaterial {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string | null;
  childId: string;
  childName: string;
}

interface CourseMaterialsProps {
  materials: CourseMaterial[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  selectedCourseId?: string;
  onChildChange?: (childId: string | undefined) => void;
  onCourseChange?: (courseId: string | undefined) => void;
}

export function CourseMaterials({
  materials,
  isLoading,
  error,
  children,
  courses,
  selectedChildId,
  selectedCourseId,
  onChildChange,
  onCourseChange,
}: CourseMaterialsProps) {
  const handleDownload = (materialId: string, fileName: string) => {
    // Open download URL in new tab
    const downloadUrl = `/api/v1/parent/homework/course-materials/${materialId}/download`;
    window.open(downloadUrl, '_blank');
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('word') || fileType.includes('document')) return '📝';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return '📽️';
    if (fileType.includes('image')) return '🖼️';
    if (fileType.includes('video')) return '🎥';
    return '📎';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Matériels de Cours</h2>
          <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
            Accédez aux documents et ressources des cours de vos enfants
          </p>
        </div>
      </div>

      {/* Filters */}
      {(children && children.length > 0) || (courses && courses.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtres
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {children && children.length > 0 && (
                <div>
                  <Label htmlFor="child-filter">Enfant</Label>
                  <Select
                    value={selectedChildId || 'all'}
                    onValueChange={(value) => onChildChange?.(value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger id="child-filter" className="w-full" aria-label="Filtrer par enfant">
                      <SelectValue placeholder="Tous les enfants" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les enfants</SelectItem>
                      {children.map((child, index) => (
                        <SelectItem key={`materials-child-${index}`} value={child.id}>
                          {child.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {courses && courses.length > 0 && (
                <div>
                  <Label htmlFor="course-filter">Cours</Label>
                  <Select
                    value={selectedCourseId || 'all'}
                    onValueChange={(value) => onCourseChange?.(value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger id="course-filter" className="w-full" aria-label="Filtrer par cours">
                      <SelectValue placeholder="Tous les cours" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les cours</SelectItem>
                      {courses.map((course, index) => (
                        <SelectItem key={`materials-course-${index}`} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Error State */}
      {error && (
        <Card className="border-red-200 bg-red-50" role="alert" aria-live="polite">
          <CardContent className="pt-6">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-red-500 mb-4" aria-hidden="true" />
              <p className="text-red-600 font-medium">Erreur de chargement</p>
              <p className="text-sm text-red-500 mt-2">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Materials List */}
      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-600" />
              Matériels de Cours
            </CardTitle>
            <CardDescription>
              Accédez aux documents et ressources des cours de vos enfants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des matériels de cours">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" aria-hidden="true"></div>
              <span className="sr-only">Chargement en cours...</span>
            </div>
          </CardContent>
        </Card>
      ) : !materials || materials.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-600" />
              Matériels de Cours
            </CardTitle>
            <CardDescription>
              Accédez aux documents et ressources des cours de vos enfants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8" role="status" aria-live="polite">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" aria-hidden="true" />
              <p className="text-gray-600 font-medium">Aucun matériel disponible</p>
              <p className="text-sm text-gray-500 mt-2">
                Les matériels de cours apparaîtront ici une fois qu'ils seront ajoutés
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {materials.map((material, index) => (
            <Card key={`material-${index}`} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{getFileIcon(material.fileType)}</div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">{material.title}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 mb-2">
                          <div className="flex items-center gap-1">
                            <BookOpen className="h-4 w-4" aria-hidden="true" />
                            <span>{material.courseName}</span>
                            {material.courseCode && (
                              <Badge variant="outline" className="ml-1">
                                {material.courseCode}
                              </Badge>
                            )}
                          </div>
                          <span aria-hidden="true">•</span>
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" aria-hidden="true" />
                            <span>{material.childName}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                          {material.uploadedAt && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" aria-hidden="true" />
                              <span>
                                Ajouté {formatDistanceToNow(new Date(material.uploadedAt), { addSuffix: true, locale: fr })}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3" aria-hidden="true" />
                            <span>{formatFileSize(material.fileSize)}</span>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {material.fileType}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="ml-4">
                    <Button
                      onClick={() => handleDownload(material.id, material.fileName)}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                      aria-label={`Télécharger ${material.title}`}
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Télécharger
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

