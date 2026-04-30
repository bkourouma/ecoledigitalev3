'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BookOpen, Calendar, MessageSquare, Award, Filter, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { ParentGrade, GradeFilter } from '@ecoledigitale/contracts';
import { Skeleton } from '@/components/ui/skeleton';

interface AssignmentGradesProps {
  grades: ParentGrade[] | null;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  selectedCourseId?: string;
  onChildChange?: (childId: string | undefined) => void;
  onCourseChange?: (courseId: string | undefined) => void;
  onDateRangeChange?: (startDate: string | undefined, endDate: string | undefined) => void;
  onPageChange?: (page: number) => void;
}

export function AssignmentGrades({
  grades,
  pagination,
  isLoading,
  error,
  children,
  courses,
  selectedChildId,
  selectedCourseId,
  onChildChange,
  onCourseChange,
  onDateRangeChange,
  onPageChange,
}: AssignmentGradesProps) {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Handle course filter change
  const handleCourseChange = (value: string) => {
    if (onCourseChange) {
      onCourseChange(value === 'all' ? undefined : value);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    if (onDateRangeChange) {
      onDateRangeChange(
        startDate ? new Date(startDate).toISOString() : undefined,
        endDate ? new Date(endDate).toISOString() : undefined
      );
    }
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Get grade badge color
  const getGradeBadge = (percentage: number) => {
    if (percentage >= 90) {
      return <Badge className="bg-green-100 text-green-800 border-green-300">Excellent</Badge>;
    } else if (percentage >= 80) {
      return <Badge className="bg-blue-100 text-blue-800 border-blue-300">Très bien</Badge>;
    } else if (percentage >= 70) {
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Bien</Badge>;
    } else if (percentage >= 60) {
      return <Badge className="bg-orange-100 text-orange-800 border-orange-300">Assez bien</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 border-red-300">Insuffisant</Badge>;
    }
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card aria-label="Chargement des notes des devoirs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Notes des Devoirs
          </CardTitle>
          <CardDescription>Chargement des notes...</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter skeletons */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          </div>
          {/* Grade item skeletons */}
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <Skeleton className="h-6 w-16 ml-auto" />
                    <Skeleton className="h-4 w-12 ml-auto" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state with retry option
  if (error) {
    return (
      <Card role="alert" aria-live="polite">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Notes des Devoirs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" aria-hidden="true" />
            <p className="text-lg font-semibold text-red-600 mb-2">Erreur lors du chargement des notes</p>
            <p className="text-sm text-gray-600 mb-4">{error.message || 'Une erreur est survenue lors du chargement des notes.'}</p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              aria-label="Réessayer de charger les notes"
            >
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!grades || grades.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-emerald-600" />
            Notes des Devoirs
          </CardTitle>
          <CardDescription>Aucune note disponible</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Award className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <p>Aucune note de devoir disponible pour le moment.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-emerald-600" />
          Notes des Devoirs
        </CardTitle>
        <CardDescription>
          {pagination ? `${pagination.total} note${pagination.total > 1 ? 's' : ''} au total` : `${grades.length} note${grades.length > 1 ? 's' : ''}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filter Controls */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filtres</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Child Filter */}
            {children && children.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="child-filter">Enfant</Label>
                <Select
                  value={selectedChildId || 'all'}
                  onValueChange={handleChildChange}
                >
                  <SelectTrigger id="child-filter" aria-label="Filtrer par enfant">
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`assignment-grades-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Course Filter */}
            {courses && courses.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="course-filter">Cours</Label>
                <Select
                  value={selectedCourseId || 'all'}
                  onValueChange={handleCourseChange}
                >
                  <SelectTrigger id="course-filter">
                    <SelectValue placeholder="Tous les cours" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les cours</SelectItem>
                    {courses.map((course, index) => (
                      <SelectItem key={`assignment-grades-course-${index}`} value={course.id}>
                        {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Start Date Filter */}
            <div className="space-y-2">
              <Label htmlFor="start-date">Date de début</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value && endDate) {
                    onDateRangeChange?.(
                      new Date(e.target.value).toISOString(),
                      new Date(endDate).toISOString()
                    );
                  }
                }}
              />
            </div>

            {/* End Date Filter */}
            <div className="space-y-2">
              <Label htmlFor="end-date">Date de fin</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  if (startDate && e.target.value) {
                    onDateRangeChange?.(
                      new Date(startDate).toISOString(),
                      new Date(e.target.value).toISOString()
                    );
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Grades List */}
        <div className="space-y-4" role="list" aria-label="Liste des notes des devoirs">
          {grades.map((grade, index) => (
            <div
              key={`assignment-grade-${index}`}
              className="border rounded-lg p-4 hover:bg-emerald-50/50 transition-colors focus-within:ring-2 focus-within:ring-emerald-500 focus-within:outline-none group"
              role="listitem"
              tabIndex={0}
              aria-label={`Note: ${grade.assignmentName}, ${grade.grade} sur ${grade.maxPoints}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-lg text-white group-hover:text-white">{grade.assignmentName}</h3>
                    {getGradeBadge(grade.percentage)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-2 group-hover:text-gray-700">
                    <div className="flex items-center gap-1">
                      <BookOpen className="h-4 w-4" />
                      <span>{grade.courseName}</span>
                      {grade.courseCode && (
                        <span className="text-gray-400 group-hover:text-gray-500">({grade.courseCode})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span>{grade.childName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 group-hover:text-gray-600">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>Soumis: {formatDate(grade.submittedAt)}</span>
                    </div>
                    {grade.gradedAt && (
                      <div className="flex items-center gap-1">
                        <Award className="h-4 w-4" />
                        <span>Noté: {formatDate(grade.gradedAt)}</span>
                      </div>
                    )}
                  </div>
                  {grade.feedback && (
                    <div className="mt-3 flex items-start gap-2">
                      <MessageSquare className="h-4 w-4 text-gray-400 group-hover:text-gray-500 mt-0.5" />
                      <p className="text-sm text-gray-600 group-hover:text-gray-700 italic">{grade.feedback}</p>
                    </div>
                  )}
                </div>
                <div className="text-right ml-4">
                  <div className="text-2xl font-bold text-emerald-600 group-hover:text-emerald-700">
                    {grade.grade}/{grade.maxPoints}
                  </div>
                  <div className="text-sm text-gray-500 group-hover:text-gray-600">
                    {grade.percentage.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <nav className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4" aria-label="Navigation de pagination">
            <div className="text-sm text-gray-600" aria-live="polite">
              Page {pagination.page} sur {pagination.totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(pagination.page - 1)}
                disabled={pagination.page <= 1}
                aria-label="Page précédente"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Précédent</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange?.(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                aria-label="Page suivante"
              >
                <span className="sr-only sm:not-sr-only">Suivant</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

