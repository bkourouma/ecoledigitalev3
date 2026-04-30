'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileText, Download, Eye, Filter, AlertCircle, Calendar, User, BookOpen } from 'lucide-react';
import { AcademicCourseMaterial, AcademicCourseMaterialFilter } from '@ecoledigitale/contracts';
import { useCourseMaterials } from '@/lib/hooks/use-parent-academic';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface CourseMaterialsProps {
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  filters?: AcademicCourseMaterialFilter;
  onFiltersChange?: (filters: AcademicCourseMaterialFilter) => void;
}

export function CourseMaterials({
  children = [],
  courses = [],
  filters = {},
  onFiltersChange,
}: CourseMaterialsProps) {
  const [localFilters, setLocalFilters] = useState<AcademicCourseMaterialFilter>(filters);
  const [startDate, setStartDate] = useState<string>(filters.startDate || '');
  const [endDate, setEndDate] = useState<string>(filters.endDate || '');

  // Use the hook with current filters
  const { data, isLoading, error } = useCourseMaterials(
    localFilters.childId,
    localFilters.courseId,
    localFilters.materialType,
    localFilters.startDate,
    localFilters.endDate
  );

  const materials = data?.data?.materials || [];

  // Handle filter change
  const handleFilterChange = (key: keyof AcademicCourseMaterialFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    const newFilters = {
      ...localFilters,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: AcademicCourseMaterialFilter = {};
    setLocalFilters(resetFilters);
    setStartDate('');
    setEndDate('');
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number | null): string => {
    if (!bytes || bytes === 0) return 'Taille inconnue';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Get file icon
  const getFileIcon = (fileType: string) => {
    if (fileType?.includes('pdf')) return '📄';
    if (fileType?.includes('word') || fileType?.includes('document')) return '📝';
    if (fileType?.includes('excel') || fileType?.includes('spreadsheet')) return '📊';
    if (fileType?.includes('powerpoint') || fileType?.includes('presentation')) return '📽️';
    if (fileType?.includes('image')) return '🖼️';
    if (fileType?.includes('video')) return '🎥';
    return '📎';
  };

  // Get material type badge
  const getMaterialTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      document: { label: 'Document', variant: 'default' },
      video: { label: 'Vidéo', variant: 'secondary' },
      link: { label: 'Lien', variant: 'outline' },
      other: { label: 'Autre', variant: 'outline' },
    };
    const normalizedType = type?.toLowerCase() || 'other';
    if (normalizedType.includes('pdf') || normalizedType.includes('document') || normalizedType.includes('word')) {
      return types.document;
    }
    if (normalizedType.includes('video')) {
      return types.video;
    }
    if (normalizedType.includes('link') || normalizedType.includes('url')) {
      return types.link;
    }
    return types[normalizedType] || types.other;
  };

  // Handle download
  const handleDownload = (material: AcademicCourseMaterial) => {
    if (material.fileUrl && material.downloadable) {
      window.open(material.fileUrl, '_blank');
    }
  };

  // Handle view
  const handleView = (material: AcademicCourseMaterial) => {
    if (material.fileUrl && material.viewable) {
      window.open(material.fileUrl, '_blank');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Matériels de Cours
          </CardTitle>
          <CardDescription>
            Documents et ressources des cours de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Chargement des matériels...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Matériels de Cours
          </CardTitle>
          <CardDescription>
            Documents et ressources des cours de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Erreur lors du chargement</p>
              <p className="text-gray-500 text-sm">{error.message || 'Une erreur est survenue'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (materials.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Matériels de Cours
          </CardTitle>
          <CardDescription>
            Documents et ressources des cours de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Aucun matériel disponible</p>
              <p className="text-gray-500 text-sm">Aucun matériel de cours n'est actuellement disponible pour vos enfants.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Matériels de Cours
          </CardTitle>
          <CardDescription>
            Documents et ressources des cours de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {children.length > 0 && (
                <Select
                  value={localFilters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`academic-course-materials-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {courses.length > 0 && (
                <Select
                  value={localFilters.courseId || 'all'}
                  onValueChange={(value) => handleFilterChange('courseId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les cours" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les cours</SelectItem>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select
                value={localFilters.materialType || 'all'}
                onValueChange={(value) => handleFilterChange('materialType', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="video">Vidéo</SelectItem>
                  <SelectItem value="link">Lien</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>

              <div>
                <Label htmlFor="start-date">Date début</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    handleFilterChange('startDate', e.target.value || undefined);
                  }}
                />
              </div>

              <div>
                <Label htmlFor="end-date">Date fin</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    handleFilterChange('endDate', e.target.value || undefined);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Materials List */}
          <div className="space-y-4">
            {materials.map((material: AcademicCourseMaterial, index: number) => {
              const materialType = getMaterialTypeBadge(material.materialType);

              return (
                <Card key={`${material.materialId}-${index}`} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">{getFileIcon(material.materialType)}</span>
                          <h3 className="text-lg font-semibold text-gray-900">{material.materialName}</h3>
                          <Badge variant={materialType.variant}>{materialType.label}</Badge>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <BookOpen className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">Cours:</span>
                            <span>{material.courseName}</span>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <User className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">Enfant:</span>
                            <span>{material.childName}</span>
                          </div>

                          {material.uploadDate && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Uploadé:</span>
                              <span>{formatDistanceToNow(new Date(material.uploadDate), { addSuffix: true, locale: fr })}</span>
                            </div>
                          )}

                          {material.fileSize && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <FileText className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Taille:</span>
                              <span>{formatFileSize(material.fileSize)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        {material.viewable && material.fileUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleView(material)}
                            className="flex items-center gap-2"
                          >
                            <Eye className="h-4 w-4" />
                            Voir
                          </Button>
                        )}
                        {material.downloadable && material.fileUrl && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleDownload(material)}
                            className="flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            Télécharger
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

