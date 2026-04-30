'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, GraduationCap, User, Filter, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { AcademicYearInfo, AcademicYearFilter } from '@ecoledigitale/contracts';
import { useAcademicYearInfo } from '@/lib/hooks/use-parent-academic';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface AcademicYearInfoProps {
  children?: Array<{ id: string; name: string }>;
  filters?: AcademicYearFilter;
  onFiltersChange?: (filters: AcademicYearFilter) => void;
}

export function AcademicYearInfoComponent({
  children = [],
  filters = {},
  onFiltersChange,
}: AcademicYearInfoProps) {
  const [localFilters, setLocalFilters] = useState<AcademicYearFilter>(filters);

  // Use the hook with current filters
  const { data, isLoading, error } = useAcademicYearInfo(
    localFilters.childId,
    localFilters.academicYearId
  );

  const academicYears = data?.data?.academicYears || [];

  // Handle filter change
  const handleFilterChange = (key: keyof AcademicYearFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Get enrollment status badge
  const getEnrollmentStatusBadge = (status: string) => {
    const statuses: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      active: { label: 'Actif', variant: 'default' },
      graduated: { label: 'Diplômé', variant: 'secondary' },
      suspended: { label: 'Suspendu', variant: 'destructive' },
      dropped: { label: 'Abandonné', variant: 'destructive' },
      transfer: { label: 'Transféré', variant: 'outline' },
    };
    return statuses[status] || { label: status, variant: 'outline' };
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Informations sur l'Année Académique
          </CardTitle>
          <CardDescription>
            Consultez les informations sur l'année académique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Chargement des informations...</p>
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
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Informations sur l'Année Académique
          </CardTitle>
          <CardDescription>
            Consultez les informations sur l'année académique
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
  if (academicYears.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Informations sur l'Année Académique
          </CardTitle>
          <CardDescription>
            Consultez les informations sur l'année académique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <GraduationCap className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Aucune information disponible</p>
              <p className="text-gray-500 text-sm">Aucune information sur l'année académique n'est actuellement disponible.</p>
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
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Informations sur l'Année Académique
          </CardTitle>
          <CardDescription>
            Consultez les informations sur l'année académique
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          {children.length > 0 && (
            <div className="mb-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Filtres</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <SelectItem key={`academic-year-info-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Academic Years List */}
          <div className="space-y-6">
            {academicYears.map((year: AcademicYearInfo, index: number) => (
              <Card key={`${year.academicYearId}-${index}`} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl mb-2">{year.academicYearName}</CardTitle>
                      {year.isCurrent && (
                        <Badge variant="default" className="bg-emerald-600">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Année en cours
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Dates */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {year.startDate && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">Date de début:</span>
                          <span>{format(parseISO(year.startDate), 'd MMMM yyyy', { locale: fr })}</span>
                        </div>
                      )}
                      {year.endDate && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">Date de fin:</span>
                          <span>{format(parseISO(year.endDate), 'd MMMM yyyy', { locale: fr })}</span>
                        </div>
                      )}
                    </div>

                    {/* Semester Info */}
                    {year.semesterInfo && Object.keys(year.semesterInfo).length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2">Informations sur les Semestres</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {Object.entries(year.semesterInfo).map(([semester, info]: [string, any], semesterIndex: number) => (
                            <Card key={`${semester}-${semesterIndex}`} className="p-4">
                              <h5 className="font-medium mb-2">{semester}</h5>
                              {info.startDate && (
                                <div className="text-sm text-gray-600 mb-1">
                                  <span className="font-medium">Début:</span>{' '}
                                  {format(parseISO(info.startDate), 'd MMMM yyyy', { locale: fr })}
                                </div>
                              )}
                              {info.endDate && (
                                <div className="text-sm text-gray-600">
                                  <span className="font-medium">Fin:</span>{' '}
                                  {format(parseISO(info.endDate), 'd MMMM yyyy', { locale: fr })}
                                </div>
                              )}
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Enrollment Details */}
                    {year.enrollmentDetails && year.enrollmentDetails.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Détails d'Inscription
                        </h4>
                        <div className="space-y-2">
                          {year.enrollmentDetails.map((enrollment: any, index: number) => {
                            const statusBadge = getEnrollmentStatusBadge(enrollment.status);
                            return (
                              <Card key={index} className="p-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium text-gray-900">{enrollment.childName}</div>
                                    {enrollment.enrollmentDate && (
                                      <div className="text-sm text-gray-600 mt-1">
                                        <span className="font-medium">Date d'inscription:</span>{' '}
                                        {format(parseISO(enrollment.enrollmentDate), 'd MMMM yyyy', { locale: fr })}
                                      </div>
                                    )}
                                  </div>
                                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Academic Milestones */}
                    {year.academicMilestones && year.academicMilestones.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          Jalons Académiques
                        </h4>
                        <div className="space-y-2">
                          {year.academicMilestones.map((milestone: any, index: number) => (
                            <Card key={index} className="p-4">
                              <div className="font-medium text-gray-900 mb-1">{milestone.name}</div>
                              {milestone.date && (
                                <div className="text-sm text-gray-600 mb-1">
                                  <span className="font-medium">Date:</span>{' '}
                                  {format(parseISO(milestone.date), 'd MMMM yyyy', { locale: fr })}
                                </div>
                              )}
                              {milestone.description && (
                                <div className="text-sm text-gray-600">{milestone.description}</div>
                              )}
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

