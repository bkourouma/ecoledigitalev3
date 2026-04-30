'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, Filter, AlertCircle, User, Calendar, MapPin, GraduationCap, Clock, RefreshCw } from 'lucide-react';
import { EnrolledCourse, EnrolledCourseFilter } from '@ecoledigitale/contracts';
import { useEnrolledCourses } from '@/lib/hooks/use-parent-academic';

interface EnrolledCoursesProps {
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  teachers?: Array<{ id: string; name: string }>;
  academicYears?: Array<{ id: string; name: string }>;
  filters?: EnrolledCourseFilter;
  onFiltersChange?: (filters: EnrolledCourseFilter) => void;
}

export function EnrolledCourses({
  children = [],
  courses = [],
  teachers = [],
  academicYears = [],
  filters = {},
  onFiltersChange,
}: EnrolledCoursesProps) {
  const [localFilters, setLocalFilters] = useState<EnrolledCourseFilter>(filters);

  // Use the hook with current filters
  const { data, isLoading, error } = useEnrolledCourses(
    localFilters.childId,
    localFilters.courseId,
    localFilters.teacherId,
    localFilters.academicYearId
  );

  const enrolledCourses = data?.data?.courses || [];

  // Handle filter change
  const handleFilterChange = (key: keyof EnrolledCourseFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: EnrolledCourseFilter = {};
    setLocalFilters(resetFilters);
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Get delivery mode badge
  const getDeliveryModeBadge = (mode: string) => {
    const modes: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      presential: { label: 'Présentiel', variant: 'default' },
      remote: { label: 'Distanciel', variant: 'secondary' },
      hybrid: { label: 'Hybride', variant: 'outline' },
      elearning: { label: 'E-learning', variant: 'outline' },
    };
    return modes[mode] || { label: mode, variant: 'outline' };
  };

  // Get course status badge
  const getCourseStatusBadge = (status: string) => {
    const statuses: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      active: { label: 'Actif', variant: 'default' },
      inactive: { label: 'Inactif', variant: 'secondary' },
      draft: { label: 'Brouillon', variant: 'outline' },
    };
    return statuses[status] || { label: status, variant: 'outline' };
  };

  // Get day name
  const getDayName = (day: number | null) => {
    if (!day) return 'N/A';
    const days = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    return days[day] || 'N/A';
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            Cours Inscrits
          </CardTitle>
          <CardDescription>
            Liste des cours auxquels vos enfants sont inscrits
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter skeletons */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          {/* Course item skeletons */}
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state with retry
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            Cours Inscrits
          </CardTitle>
          <CardDescription>
            Liste des cours auxquels vos enfants sont inscrits
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" aria-hidden="true" />
              <p className="text-gray-700 font-medium mb-2">Erreur lors du chargement</p>
              <p className="text-gray-500 text-sm mb-4">{error.message || 'Une erreur est survenue'}</p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                className="flex items-center gap-2"
                aria-label="Réessayer le chargement"
              >
                <RefreshCw className="h-4 w-4" />
                Réessayer
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (enrolledCourses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            Cours Inscrits
          </CardTitle>
          <CardDescription>
            Liste des cours auxquels vos enfants sont inscrits
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Aucun cours inscrit</p>
              <p className="text-gray-500 text-sm">Vos enfants ne sont actuellement inscrits à aucun cours.</p>
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
            <BookOpen className="h-5 w-5 text-emerald-600" />
            Cours Inscrits
          </CardTitle>
          <CardDescription>
            Liste des cours auxquels vos enfants sont inscrits
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                      <SelectItem key={`enrolled-courses-child-${index}`} value={child.id}>
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

              {teachers.length > 0 && (
                <Select
                  value={localFilters.teacherId || 'all'}
                  onValueChange={(value) => handleFilterChange('teacherId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enseignants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enseignants</SelectItem>
                    {teachers.map((teacher) => (
                      <SelectItem key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {academicYears.length > 0 && (
                <Select
                  value={localFilters.academicYearId || 'all'}
                  onValueChange={(value) => handleFilterChange('academicYearId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Toutes les années" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les années</SelectItem>
                    {academicYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Courses List */}
          <div className="space-y-4">
            {enrolledCourses.map((course: EnrolledCourse, index: number) => {
              const deliveryMode = getDeliveryModeBadge(course.deliveryMode);
              const courseStatus = getCourseStatusBadge(course.courseStatus);

              return (
                <Card key={`${course.courseId}-${course.childId}-${course.academicYearId}-${index}`} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{course.courseName}</h3>
                          <Badge variant={courseStatus.variant}>{courseStatus.label}</Badge>
                          <Badge variant={deliveryMode.variant}>{deliveryMode.label}</Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">{course.courseCode}</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <User className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">Enfant:</span>
                            <span>{course.childName}</span>
                          </div>

                          {course.teacherName && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <GraduationCap className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Enseignant:</span>
                              <span>{course.teacherName}</span>
                            </div>
                          )}

                          {course.scheduleDay && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Jour:</span>
                              <span>{getDayName(course.scheduleDay)}</span>
                            </div>
                          )}

                          {course.scheduleTime && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Clock className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Heure:</span>
                              <span>{course.scheduleTime}</span>
                            </div>
                          )}

                          {course.classroom && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <MapPin className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Salle:</span>
                              <span>{course.classroom}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <GraduationCap className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">Année:</span>
                            <span>{course.academicYearName}</span>
                          </div>
                        </div>
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

